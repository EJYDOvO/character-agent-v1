import { Identity } from './identity.mjs';
import { scheduledEvents } from './schedule.mjs';
import { confirmationEvidence } from './confirmation.mjs';
import { auditBindings } from './bindings.mjs';
import { protectSession } from './boundary.mjs';
import { createOutbox } from './outbox.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export const name='character-identity';
const digest=s=>createHash('sha256').update(s).digest('hex');
export function apply(ctx,config) {
  const presetId=config.presetId??'qq-character';
 const binding=JSON.parse(readFileSync(config.bindingFile,'utf8').replace(/^\uFEFF/,''));
 const identity=new Identity(binding);mkdirSync(dirname(config.stateFile),{recursive:true});
 const db=new DatabaseSync(config.stateFile);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS routes(conversation TEXT PRIMARY KEY,session TEXT NOT NULL,generation INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,conversation TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS qq_bindings(session TEXT PRIMARY KEY,conversation TEXT NOT NULL,preset TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS identity_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 const conversationScope=identity.conversationScope();
 const fingerprint=digest(JSON.stringify({...conversationScope,presetId})),previous=db.prepare("SELECT value FROM identity_state WHERE key='scope'").get();
 if(previous&&previous.value!==fingerprint){db.close();throw Error('Identity scope changed; use a separate state directory or an explicit reviewed migration');}
 db.prepare("INSERT OR IGNORE INTO identity_state VALUES('scope',?)").run(fingerprint);
 db.prepare('INSERT OR IGNORE INTO qq_bindings SELECT session,conversation,? FROM routes WHERE conversation=?').run(presetId,conversationScope.conversationId);
 // The durable Outbox (single writer); interrupted 'sending' rows become unknown once the previous owner closed.
 // I/O is optional and may activate or reload after Identity. Never capture an
 // absent/stale service at apply time, and never turn diagnostics into a dependency.
 const diagnosticContext={platform:'qq-official',adapter:'qq-official-gateway',accountId:binding.appId,conversation:{type:'direct',id:binding.ownerId}};
 const diagnostics={emit(component,event,fields){try{const view=runtime?.diagnostics??ctx.get?.('agentIO')?.diagnostics?.scope(diagnosticContext);view?.emit(component,event,{conversation:diagnosticContext.conversation,...fields});}catch{}}};
 const outbox=createOutbox({db,key:resolve(config.stateFile),logger:ctx.logger,diagnostics});
 let runtime,detach,closed=false,auditing,gatewayEpoch=0;const listeners=new Set(),bound=new Set(),inputs=new Map();
 function isCurrentId(id){
  if(closed||!runtime||!gatewayValid(runtime))return false;
  const manager=runtime.manager,record=[...manager.records()].find(r=>r.scope==='c2c'&&r.peerId===binding.ownerId&&r.sessionId===id);
  if(!record||!manager.isCurrentSession(record))return false;
  try{record.agent.ctx?.fiber?.assertActive?.();}catch{return false;}
  return true;
 }
 function authorize(c,a){
  let trusted;try{trusted=identity.authorize(c,a);if(!isCurrentId(trusted.sessionId))throw Error('Historical QQ Session is not authorized');}
  catch(error){diagnostics?.emit('identity','authorize',{status:'rejected',reason:'unauthorized'});throw error;}
  diagnostics?.emit('identity','authorize',{sessionId:trusted.sessionId,status:'accepted'});return trusted;
 }
 function forSession(id){const trusted=identity.forSession(id);authorize(trusted,'read');return trusted;}
 function hasReminderBinding(id){return !!db.prepare('SELECT 1 FROM qq_bindings WHERE session=? AND conversation=? AND preset=?').get(id,conversationScope.conversationId,presetId);}
 function protect(agent){if(ctx.get?.('agentPresets')?.composedPreset(agent.ctx)===presetId)protectSession(agent);}
 function evidence(){
  const manager=runtime?.manager,key=manager?.sessionKey('c2c',binding.ownerId),state=manager?.ownershipState(key);
  // scope fingerprint pins routes/qq_bindings; QQ prefs and native parentSession
  // are Host persistence. A matching Preset without this chain grants nothing.
  return {bindings:db.prepare('SELECT session FROM qq_bindings WHERE conversation=? AND preset=?').all(conversationScope.conversationId,presetId).map(r=>r.session),
   roots:[db.prepare('SELECT session FROM routes WHERE conversation=?').get(conversationScope.conversationId)?.session,
    state?.sessionId,state?.previousSessionId].filter(Boolean)};
 }
 async function auditSchedules(){
  if(closed)throw Error('Identity disposed');
  const state=evidence(),schedule=ctx.get?.('schedule'),persistence=ctx.get?.('sessionPersistence');
  if(!schedule||!persistence)throw Error('Native Schedule/persistence audit unavailable');
  const result=await auditBindings({...state,schedules:await schedule.catalog(),presetId,readHeader:async id=>(await persistence.stat(id))?.header});
  return {...result,evidence:JSON.stringify(state)};
 }
 async function reconcile(){
  if(auditing)return auditing;
  auditing=(async()=>{
   const value=runtime,epoch=gatewayEpoch,result=await auditSchedules();
   // A concurrent rotation/reload invalidates the observation; never apply a
   // stale audit or replace the main route. The next restore audits afresh.
   if(closed||runtime!==value||gatewayEpoch!==epoch||JSON.stringify(evidence())!==result.evidence)throw Error('QQ ownership evidence changed during audit');
   db.exec('BEGIN IMMEDIATE');try{for(const id of result.missing)db.prepare('INSERT OR IGNORE INTO qq_bindings VALUES(?,?,?)').run(id,conversationScope.conversationId,presetId);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   if(result.anomalies.length||result.issues.length)ctx.logger?.warn(`QQ Schedule ownership audit: ${result.rows.filter(r=>r.binding==='unproven'||r.binding==='unverifiable_binding').length} unproven tasks; ${result.missing.length} evidenced reminder bindings recovered; ${result.issues.length} header issues`);
   return result;
  })();try{return await auditing;}finally{auditing=undefined;}
 }
  function validateGateway(c){if(c.appId!==binding.appId||c.preset!==presetId||c.access?.c2cMode!=='allowlist'||c.access.c2cAllow?.length!==1||c.access.c2cAllow[0]!==binding.ownerId||c.access.groupMode!=='disabled')throw Error('Owner gateway policy mismatch');}
 function bind(record){
  const preset=ctx.get?.('agentPresets')?.composedPreset(record.agent.ctx)??record.agentPreset??record.agent.session.header?.agentPreset;
   if(record.scope!=='c2c'||record.peerId!==binding.ownerId||record.senderId!==binding.ownerId||preset!==presetId)throw Error('Untrusted restored QQ record');
  if(!runtime?.manager.isCurrentSession(record))throw Error('Superseded QQ Session admission');
  protect(record.agent);
  for(const id of bound)if(id!==record.sessionId){identity.revoke(id);bound.delete(id);inputs.delete(id);}
  const trusted=identity.bind({appId:binding.appId,scope:'c2c',peerId:binding.ownerId,senderId:binding.ownerId,sessionId:record.sessionId});bound.add(record.sessionId);
  db.prepare('INSERT OR IGNORE INTO qq_bindings VALUES(?,?,?)').run(record.sessionId,trusted.conversationId,presetId);
  db.prepare('INSERT INTO routes VALUES(?,?,1) ON CONFLICT(conversation) DO UPDATE SET generation=generation+CASE WHEN session!=excluded.session THEN 1 ELSE 0 END,session=excluded.session').run(trusted.conversationId,record.sessionId);return trusted;
 }
 function restoreBinding(agent){
  if(closed)return;protect(agent);
  // Persisted bindings authorize only the Host reminder bridge. Full identity
  // must be issued by current, live QQ manager admission, never cold restore.
  if(hasReminderBinding(agent.id)&&ctx.get?.('agentPresets')?.composedPreset(agent.ctx)!==presetId)throw Error('Restored QQ Schedule preset mismatch');
 }
 // Delivery of the Owner Conversation's pending rows through the attached
 // Gateway's Agent I/O notifier (no direct Gateway send). Before every part the
 // notifier re-runs this check: still this Gateway attachment with the Owner-only
 // policy, the Owner's private Conversation, and for a reminder the persisted
 // binding of the Session it came from (a rotated Session is fine; an unproven
 // one is refused). Without a notifier rows stay pending.
 function gatewayValid(value){try{validateGateway(value.config);return true;}catch{return false;}}
 function pump(){
  const value=runtime,epoch=gatewayEpoch;
  if(closed||!value?.notifications)return Promise.resolve();
  return outbox.pump({notifier:value.notifications,conversation:conversationScope.conversationId,target:{type:'direct',id:binding.ownerId},
   // A reminder without its recorded source Session cannot be re-verified: it stays pending, explicitly.
   eligible:(row,source)=>row.kind!=='scheduled_reminder'||!!source,
   authorize:(row,source,target)=>!closed&&runtime===value&&gatewayEpoch===epoch&&gatewayValid(value)&&target.type==='direct'&&target.id===binding.ownerId
    &&row.conversation===conversationScope.conversationId&&(row.kind!=='scheduled_reminder'||hasReminderBinding(source))});
 }
 const enqueue=event=>outbox.enqueue(event);
 const statusOf=id=>({status:outbox.status(id)});
 const service=Object.freeze({
  authorize,forSession,validateGateway,
  isCurrentAgent(agent){return !!agent&&ctx.get?.('agents')?.get(agent.id)===agent&&isCurrentId(agent.id)&&!!forSession(agent.id);},
  canDeliverReminder(agent){return !closed&&!!agent&&ctx.get?.('agents')?.get(agent.id)===agent&&ctx.get?.('agentPresets')?.composedPreset(agent.ctx)===presetId&&hasReminderBinding(agent.id);},
  auditSchedules:async()=>{const {evidence:_,...report}=await auditSchedules();return report;},
  // Host-only stable scope descriptors are not Memory capabilities.
  conversationScope:()=>conversationScope,
  validateConversation(scope){if(closed||['principalId','characterId','projectId','conversationId'].some(k=>scope?.[k]!==conversationScope[k]))throw Error('Foreign task conversation');return conversationScope;},
  current(){if(!runtime)throw Error('Gateway unavailable');for(const record of runtime.manager.records()){try{return forSession(record.sessionId);}catch{}}throw Error('No active trusted owner session');},
  latestInput(trusted){authorize(trusted,'read');return inputs.get(trusted.sessionId);},
  route(trusted){authorize(trusted,'read');const manager=runtime.manager,state=manager.ownershipState(manager.sessionKey('c2c',binding.ownerId));return {conversation:trusted.conversationId,session:state.sessionId,generation:state.generation,automaticRotation:runtime.config.sessionLifecycle?.enabled===true,scheduleTarget:'original_session',blockers:state.blocker?[state.blocker]:[]};},
  onIngress(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  attach(value){
   if(closed||runtime)throw Error('Duplicate Character QQ gateway');validateGateway(value.config);
   if(value.platform!==undefined&&(value.platform!=='qq-official'||value.adapter!=='qq-official-gateway'||value.accountId!==binding.appId))throw Error('Foreign Gateway identity');
   const manager=value.manager;if(!['sessionKey','currentSessionId','isCurrentSession','ownershipState','records'].every(k=>typeof manager[k]==='function'))throw Error('Conversation Manager ownership contract required');
   runtime=value;const epoch=++gatewayEpoch,original=manager.getOrCreate,rebuild=manager.rebuildSession;
   diagnostics?.emit('identity','attach',{status:'active'});
   const wrap=async function(scope,peerId,senderId,target){
    if(runtime!==value||gatewayEpoch!==epoch||scope!=='c2c'||peerId!==binding.ownerId||senderId!==binding.ownerId||target?.scope!=='c2c'||target.targetId!==binding.ownerId)throw Error('Owner-only gateway');
    const record=await original.call(this,scope,peerId,senderId,target);if(runtime!==value||gatewayEpoch!==epoch)throw Error('Gateway detached during restore');bind(record);return record;
   };
   manager.getOrCreate=wrap;
   const wrapRebuild=async function(record,options){if(runtime!==value||gatewayEpoch!==epoch)throw Error('Gateway detached before model switch');const old=record.sessionId;const result=await rebuild.call(this,record,options);if(runtime!==value||gatewayEpoch!==epoch)throw Error('Gateway detached during model switch');identity.revoke(old);bound.delete(old);if(manager.isCurrentSession(record))bind(record);return result;};
   if(rebuild)manager.rebuildSession=wrapRebuild;
   try{for(const record of manager.records())bind(record);for(const row of db.prepare('SELECT session FROM qq_bindings WHERE conversation=?').all(conversationScope.conversationId)){const agent=ctx.get?.('agents')?.get(row.session);if(agent)restoreBinding(agent);}}catch(e){manager.getOrCreate=original;manager.rebuildSession=rebuild;runtime=undefined;identity.clear();bound.clear();throw e;}
   // Shared trusted ingress for the ordinary pipeline and explicit correction.
   // The early correction adapter must not bypass Owner binding or L1 evidence.
   const previousAdmission=manager.admitInteractionInput,previousInput=manager.admitInput,previousScheduleBridge=manager.preserveScheduledSession;
   const preserve=id=>!closed&&hasReminderBinding(id);
   manager.preserveScheduledSession=preserve;
   const admit=async m=>{
    if(runtime!==value||gatewayEpoch!==epoch)throw Error('Gateway detached');
    const msg=m.message;
    if(msg.kind!=='c2c'||msg.senderId!==binding.ownerId)throw Error('Owner ingress required');
    const record=await manager.getOrCreate('c2c',binding.ownerId,binding.ownerId,{scope:'c2c',targetId:binding.ownerId,msgId:msg.messageId});
    return record;
   };
   const capture=(record,input)=>{
    if(runtime!==value||gatewayEpoch!==epoch)throw Error('Gateway detached');
    if(!input||input.platform!=='qq-official'||input.adapter!=='qq-official-gateway'||input.accountId!==binding.appId||input.conversation?.type!=='direct'||input.conversation.id!==binding.ownerId||input.sender?.id!==binding.ownerId)throw Error('Untrusted Owner input');
    if(!manager.isCurrentSession(record))throw Error('Superseded QQ input');
    const trusted=forSession(record.sessionId),msg=input.message;
    if(typeof msg?.text==='string'&&msg.text.trim()&&msg.id){
     const evidence=Object.freeze({sessionId:record.sessionId,eventSeq:record.agent.session.seq,origin:'direct_user',receivedAt:Date.now(),messageId:msg.id,text:msg.text.slice(0,8000)});
     inputs.set(record.sessionId,evidence);
     for(const fn of listeners)try{fn(trusted,evidence);}catch{ctx.logger?.warn('Character ingress capture rejected');}
    }
   };
   manager.admitInteractionInput=admit;
   manager.admitInput=capture;
   detach=()=>{if(runtime!==value||gatewayEpoch!==epoch)return;runtime=undefined;gatewayEpoch++;if(manager.admitInput===capture){if(previousInput===undefined)delete manager.admitInput;else manager.admitInput=previousInput;}if(manager.admitInteractionInput===admit){if(previousAdmission===undefined)delete manager.admitInteractionInput;else manager.admitInteractionInput=previousAdmission;}if(manager.preserveScheduledSession===preserve){if(previousScheduleBridge===undefined)delete manager.preserveScheduledSession;else manager.preserveScheduledSession=previousScheduleBridge;}if(manager.getOrCreate===wrap)manager.getOrCreate=original;if(manager.rebuildSession===wrapRebuild)manager.rebuildSession=rebuild;identity.clear();bound.clear();inputs.clear();};
   void reconcile().catch(()=>ctx.logger?.warn('QQ Schedule ownership audit blocked; unproven Sessions remain unauthorized'));outbox.releaseHeld();void pump().catch(()=>ctx.logger?.warn('Character Outbox pump blocked; durable state retained'));return detach;
  },
  async notify(trusted,event){authorize(trusted,'send');enqueue({...event,conversation:trusted.conversationId,source:trusted.sessionId});await pump();return statusOf(event.eventId);},
  async notifySystem({eventId,kind,text,target}){
   if(!runtime||target.scope!=='c2c'||target.targetId!==binding.ownerId)throw Error('Owner notification required');
   // Existing QQTK ledger provides stable event text (maintenance job id / task status).
   if(typeof eventId!=='string'||!eventId.startsWith('qqtk:'))throw Error('Stable QQTK event id required');
   const conversation='qq-'+digest(`${binding.appId}:c2c:${binding.ownerId}`);
   enqueue({eventId,kind,text,conversation});await pump();const result=statusOf(eventId);
   // The status travels with the error: Remote Ops records the Outbox status, not a guess.
   if(result.status!=='sent')throw Object.assign(Error('Notification delivery '+result.status),{status:result.status});return result;
  },
  async notifyConversation(scope,event){service.validateConversation(scope);if(typeof event.eventId!=='string'||!event.eventId.startsWith('long-task:'))throw Error('Stable task event id required');enqueue({...event,conversation:conversationScope.conversationId});await pump();return statusOf(event.eventId);},
  notificationStatus(scope,id){service.validateConversation(scope);return outbox.status(id,conversationScope.conversationId);},
  inspect(trusted){authorize(trusted,'read');return outbox.inspect(trusted.conversationId);},
  cancel(trusted,eventId){authorize(trusted,'write');return outbox.cancel(eventId,trusted.conversationId);}
 });
 // Retired/unknown Character roots cannot run tools or an LLM, including Web
 // followups. Cold Schedule recovery only installs the fail-closed boundary.
 ctx.on?.('agent/created',async({agent,source})=>{
  restoreBinding(agent);
  if(!closed&&ctx.get?.('agentPresets')?.composedPreset(agent.ctx)===presetId&&!hasReminderBinding(agent.id)){
   await reconcile().catch(()=>{});
   // Native Schedule awaits resume before inbox/receipt publication. Refusing
   // an unproven cold root preserves the original active task, rather than
   // consuming its occurrence and merely rejecting the subsequent model step.
   if(source==='resume'&&!hasReminderBinding(agent.id))throw Error('Unproven QQ reminder Session: cold recovery blocked; inspect ownership audit');
  }
 });
 ctx.on?.('agent/disposed',({agent})=>{identity.revoke(agent.id);bound.delete(agent.id);inputs.delete(agent.id);});
 ctx.on?.('session/event',(session,event)=>{
  const messages=event.type==='user/message'?[event.data?.message??event.data]:event.type==='agent/inbox/spliced'?event.data?.inserted??[]:[];
  for(const message of messages){if(message?.source?.kind!=='schedule')continue;
   void (async()=>{try{
    const id=session.header.id,agent=ctx.get?.('agents')?.get(id);
    if(!agent||agent.session!==session||ctx.get?.('agentPresets')?.composedPreset(agent.ctx)!==presetId)throw Error('Untrusted reminder root');
    if(!hasReminderBinding(id))await reconcile();
    if(closed||!hasReminderBinding(id))throw Error('Unproven reminder ownership');
    // The Session the reminder came from is recorded with the row, so the binding is checked again at send time.
    for(const notification of scheduledEvents(message))enqueue({...notification,conversation:conversationScope.conversationId,source:id});await pump();
   }catch{ctx.logger?.warn('Schedule notification blocked: ownership or native framing not verified');}})();}
 });
 ctx.provide('characterIdentity',service);
 // HMR may retain roots created by a previous provider, including legacy
 // roots missing qq_bindings. Guard all actual Character roots, not just rows.
 for(const agent of ctx.get?.('agents')?.list?.()??[])restoreBinding(agent);
  ctx.provide('memoryIdentity',Object.freeze({
   contractVersion:1,
   authorize(c,a){const trusted=authorize(c,a);return Object.freeze({...trusted,namespaceId:trusted.characterId,agentId:config.memoryAgentId??presetId,memoryMode:config.memoryMode??'off',l3Tokens:config.l3Tokens});},
   forSession,
   current(scope){const trusted=service.current();if(scope&&JSON.stringify([trusted.principalId,trusted.characterId,trusted.projectId])!==JSON.stringify(scope))throw Error('No current session for memory scope');return trusted;},
   onEvidence:fn=>service.onIngress(fn),
   confirmationEvidence(c,{memory,quote}){authorize(c,'write');return confirmationEvidence(service.latestInput(c),memory,quote);}
  }));
 // Close order: no new pumps, Gateway detached, queued hand-overs cancelled and
 // their rows returned to pending, in-flight parts settled, then the database.
 ctx.effect(()=>{const timer=setInterval(()=>void pump().catch(()=>ctx.logger?.warn('Character Outbox pump blocked; durable state retained')),5000);return async()=>{clearInterval(timer);detach?.();closed=true;await outbox.close();identity.clear();listeners.clear();db.close();};});
}
