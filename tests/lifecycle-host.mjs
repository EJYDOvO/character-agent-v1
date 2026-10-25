import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {DatabaseSync} from 'node:sqlite';
import {defineTool} from '@deepseek-ai/dsh-tools';
export const name='isolated-lifecycle-probe';
export const inject=['agents','agentPresets','tools','skills','sessions','schedule','characterIdentity','memoryIdentity','dshMemory','longTasks','lifecycleFixture'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function apply(ctx,config){
 const control=ctx.lifecycleFixture;
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1000);return()=>clearTimeout(timer);});
 async function run(){
  const checkpoint=config.cwd+'/checkpoint.json',restart=fs.existsSync(checkpoint),state=restart?JSON.parse(fs.readFileSync(checkpoint)):null,report={ok:false,runId:config.runId,restart,host:config.version,provenance:config.provenance,qqNetwork:false,provider:'deterministic fixture',checks:[]};let manager,detach;
  try{
   const {SessionManager}=await import(pathToFileURL(config.qqFixture+'/dist/session/session-manager.js').href),deliveries=[];
   manager=new SessionManager(ctx,ctx.agents,{appId:'fixture-app',preset:'qq-character',cwd:config.cwd,provider:'task-fixture',model:'fixture',sessionIdleTimeout:600000,sessionLifecycle:{enabled:true,freshOnHostRestart:true,inactivityMs:43200000}},ctx.logger);
   detach=ctx.characterIdentity.attach({manager,config:{appId:'fixture-app',preset:'qq-character',sessionLifecycle:manager.config.sessionLifecycle,access:{c2cMode:'allowlist',c2cAllow:['fixture-owner'],groupMode:'disabled'}},sender:{async sendMarkdown(target,text){deliveries.push({target,text});}}});
   const get=id=>manager.getOrCreate('c2c','fixture-owner','fixture-owner',{scope:'c2c',targetId:'fixture-owner',msgId:id});
   const warm=await manager.getOrCreate('c2c','fixture-owner','fixture-owner',{scope:'c2c',targetId:'fixture-owner'});
   const warmState=manager.modelResolver.prefs.getLifecycle(warm.sessionKey);
   if(restart){assert.equal(warm.sessionId,state.session,'Startup restore must preserve the route until QQ input');assert.equal(warmState.lastUserAt,state.lastUserAt,'Startup restore must not refresh user activity');}else assert.equal(warmState,undefined);
   let record=await get(restart?'after-restart':'first-input');
   assert.notEqual(record.sessionId,warm.sessionId,'First actual user input creates the blank Session');
   assert.equal(ctx.agentPresets.composedPreset(record.agent.ctx),'qq-character');assert.equal(record.agent.options.provider,'task-fixture');assert.equal(record.agent.options.model,'fixture');
   if(!restart){
    record.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'OLD_QQ_HISTORY_FIXTURE'}]}));await record.agent.whenIdle();
    const trusted=ctx.characterIdentity.forSession(record.sessionId),fact=ctx.dshMemory.remember(trusted,{kind:'semantic',statement:'SAFE_MEMORY_CONTINUES'},{sessionId:record.sessionId,eventSeq:1,messageId:'safe-memory',origin:'direct_user',quote:'SAFE_MEMORY_CONTINUES'});
    const oldReminder=await ctx.schedule.create(record.sessionId,{title:'Legacy root reminder',prompt:'Legacy reminder still reaches owner.',after_seconds:40});
    const unproven=await ctx.agents.create({sessionId:crypto.randomUUID(),agentOptions:{provider:'task-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:'qq-character'},setup:async c=>{await ctx.agentPresets.mount(c,'qq-character');}});
    const unknownReminder=await ctx.schedule.create(unproven.agent.id,{title:'Unproven ownership fixture',prompt:'Must never execute or notify.',after_seconds:25});await unproven.dispose();
    const reminderSession=record.sessionId,retiredCapability=trusted;
    await manager.setModelOverride('c2c','fixture-owner',{provider:'task-fixture',model:'fixture'});
    assert.notEqual(record.sessionId,reminderSession);assert.equal(record.agent.session.header.parentSession,reminderSession);
    assert.throws(()=>ctx.memoryIdentity.authorize(retiredCapability,'read'));assert.throws(()=>ctx.characterIdentity.forSession(reminderSession));
    const once=await ctx.longTasks.create(record.agent,{title:'Once',prompt:'Synthetic one-time work.',after_seconds:8});
    const error=await ctx.longTasks.create(record.agent,{title:'Tool-error',prompt:'read-tool-fixture',after_seconds:3600});
    const modified=await ctx.longTasks.update(record.agent,{id:error.id,revision:1,prompt:'read-tool-fixture updated',change:{kind:'at',at:new Date(Date.now()+10000).toISOString()}});assert.equal(modified.revision,2);
    const cancelled=await ctx.longTasks.create(record.agent,{title:'Cancelled',prompt:'must not execute',after_seconds:3600});await ctx.longTasks.cancel(record.agent,{id:cancelled.id,revision:1});
    const periodic=await ctx.longTasks.create(record.agent,{title:'Periodic',prompt:'Synthetic recurring work.',every_seconds:60});
    const taskAgent=ctx.agents.get(once.sessionId);assert(taskAgent);assert(!taskAgent.session.header.parentSession);assert.equal(ctx.agentPresets.composedPreset(taskAgent.ctx),'long-task');
    assert.throws(()=>ctx.characterIdentity.forSession(taskAgent.id));assert.throws(()=>ctx.memoryIdentity.forSession(taskAgent.id));
    await assert.rejects(async()=>ctx.longTasks.create(taskAgent,{title:'forged',prompt:'x',after_seconds:1}));
    const ownerTools=ctx.tools.view(record.agent).visible;assert(ownerTools.has('long_task_create'));assert(ownerTools.has('schedule_create'));
    assert.deepEqual([...ctx.tools.view(taskAgent).visible.keys()],['task_fixture_read']);
    assert((await ctx.skills.list({scope:record.agent,cwd:config.cwd})).some(s=>s.name==='long-tasks'));
    await ctx.sessions.flush(record.agent.session);
    // Deliberate pre-upgrade missing binding in this synthetic DB only. The
    // persisted native fork header is the only evidence for its ownership.
    const db=new DatabaseSync(config.cwd+'/coordination.sqlite');db.prepare('DELETE FROM qq_bindings WHERE session=?').run(reminderSession);db.close();
    const audit=await ctx.characterIdentity.auditSchedules();assert.equal(audit.rows.find(r=>r.id===oldReminder.id).binding,'verified_missing');
    fs.writeFileSync(checkpoint,JSON.stringify({session:record.sessionId,reminderSession,unknownReminder:unknownReminder.id,unknownSession:unknownReminder.sessionId,unknownAt:unknownReminder.scheduledAt,lastUserAt:manager.modelResolver.prefs.getLifecycle(record.sessionKey).lastUserAt,fact:fact.id,oldReminder:oldReminder.id,once:once.id,error:error.id,periodic:periodic.id,cancelled:cancelled.id}));
    report.checks.push('Actual native Schedule create/update/cancel; independent roots, tool allowlist, Memory/Owner ACL and Skill');
   }else{
    const liveUnknown=await ctx.agents.create({sessionId:crypto.randomUUID(),agentOptions:{provider:'task-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:'qq-character'},setup:async c=>{await ctx.agentPresets.mount(c,'qq-character');}});
    const liveUnknownReminder=await ctx.schedule.create(liveUnknown.agent.id,{title:'Unproven live fixture',prompt:'Must not consume a live unproven target.',after_seconds:1});
    assert.notEqual(record.sessionId,state.session);assert(!JSON.stringify(record.agent.session.snapshotEvents()).includes('OLD_QQ_HISTORY_FIXTURE'));assert(!record.agent.session.header.parentSession);
    assert(ctx.dshMemory.recall(ctx.characterIdentity.forSession(record.sessionId),'SAFE_MEMORY_CONTINUES').some(m=>m.id===state.fact));report.checks.push('Real Host restart creates blank QQ Session; Identity, Memory, Preset and model retained');
    const first=record.sessionId,key=record.sessionKey,prefs=manager.modelResolver.prefs;
    const expire=()=>prefs.commitLifecycle(key,{...prefs.getLifecycle(key),lastUserAt:Date.now()-43200001,lastMessageId:'old',due:null});
    record.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'owner-busy-fixture'}]}));const waitDeadline=Date.now()+5000;while(!control.waiting&&Date.now()<waitDeadline)await sleep(20);assert(control.waiting);
    expire();assert.equal((await get('busy-input')).sessionId,first);record.lastActivity=0;manager.evictor.check();assert(manager.sessions.has(key));control.release();await record.agent.whenIdle();
    record=await get('after-busy');assert.notEqual(record.sessionId,first);
    expire();const concurrent=await Promise.all(Array.from({length:5},(_,i)=>get('parallel-'+i)));assert.equal(new Set(concurrent.map(r=>r.sessionId)).size,1);assert.notEqual(concurrent[0].sessionId,record.sessionId);record=concurrent[0];report.checks.push('12h user inactivity, busy/eviction protection, no fork and concurrent rotation');
    const deadline=Date.now()+72000;let tasks;
    while(Date.now()<deadline){tasks=await ctx.longTasks.list(record.agent);if([state.once,state.error,state.periodic].every(id=>{const r=tasks.find(t=>t.id===id)?.runs[0];return r&&r.status!=='running'&&r.notification==='sent';})&&deliveries.some(d=>d.text.includes('Legacy reminder')))break;await sleep(150);}
    for(const id of [state.once,state.error,state.periodic])assert.equal(tasks.find(t=>t.id===id)?.runs.length,1,'Exactly one executed occurrence per task');
    assert.equal(tasks.find(t=>t.id===state.once).runs[0].status,'completed');assert.equal(tasks.find(t=>t.id===state.periodic).runs[0].status,'completed');assert.equal(tasks.find(t=>t.id===state.error).runs[0].status,'needs_review');assert(globalThis[Symbol.for('fixture.tasks.read.calls')]>0);
    assert.equal(tasks.find(t=>t.id===state.cancelled).runs.length,0);assert.equal(deliveries.length,4,'Three results plus one legacy reminder');assert(deliveries.every(d=>d.target.targetId==='fixture-owner'));
    const old=ctx.agents.get(state.reminderSession);assert(old,'Official Schedule cold-resumed its original Session');assert.equal(ctx.characterIdentity.route(ctx.characterIdentity.forSession(record.sessionId)).session,record.sessionId);
    assert.throws(()=>ctx.characterIdentity.forSession(old.id));assert.throws(()=>ctx.memoryIdentity.forSession(old.id));await assert.rejects(()=>ctx.longTasks.create(old,{title:'bypass',prompt:'no',after_seconds:1}));
    const audit=await ctx.characterIdentity.auditSchedules();assert.equal(audit.rows.find(r=>r.id===state.oldReminder).binding,'bound');
    assert.equal(audit.rows.find(r=>r.id===state.unknownReminder).binding,'unproven');const unknown=(await ctx.schedule.catalog()).find(r=>r.id===state.unknownReminder);assert.equal(unknown.status,'active');assert.equal(unknown.lastDelivery,undefined);assert.equal(unknown.scheduledAt,state.unknownAt);assert(!ctx.agents.get(unknown.sessionId));
    const unknownLive=(await ctx.schedule.catalog()).find(r=>r.id===liveUnknownReminder.id);assert.equal(unknownLive.status,'active');assert.equal(unknownLive.lastDelivery,undefined);assert.equal(liveUnknown.agent.inbox.hasPending,false);await liveUnknown.dispose();
    const once=tasks.find(t=>t.id===state.once),agent=ctx.agents.get(once.sessionId),before=once.runs.length,delivery=agent.session.snapshotEvents().find(e=>e.type==='user/message'&&(e.data?.message??e.data)?.source?.kind==='schedule'),duplicate=delivery?.data?.message??delivery?.data;
    assert(duplicate);agent.followup(duplicate);await agent.whenIdle();await sleep(100);assert.equal((await ctx.longTasks.list(record.agent)).find(t=>t.id===state.once).runs.length,before);assert.equal(deliveries.length,4);
    await ctx.longTasks.cancel(record.agent,{id:state.periodic,revision:tasks.find(t=>t.id===state.periodic).revision});
    const llmCalls=globalThis[Symbol.for('fixture.tasks.llm.calls')],oldReads=globalThis[Symbol.for('fixture.tasks.read.calls')];
    old.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'read-tool-fixture'}]}));await old.whenIdle();await sleep(100);
    assert.equal(globalThis[Symbol.for('fixture.tasks.llm.calls')],llmCalls,'Retired root must not call the model');
    const denied=await ctx.tools.execute({agent:old,name:'task_fixture_read',arguments:{},callId:'retired-tool',signal:AbortSignal.timeout(5000)});assert(denied.error,'Native tool invoker must deny retired Session');assert.equal(globalThis[Symbol.for('fixture.tasks.read.calls')],oldReads);
    let lateExecuted=false;old.ctx.get('tools').register(defineTool({name:'retired_late_tool',description:'Synthetic late scoped tool',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){lateExecuted=true;return 'not allowed';}}));
    const late=await ctx.tools.execute({agent:old,name:'retired_late_tool',arguments:{},callId:'retired-late',signal:AbortSignal.timeout(5000)});assert(late.error);assert.equal(lateExecuted,false);
    assert.equal(deliveries.length,4);report.checks.push('Retired native root denies model, native tool dispatch, Memory and long-task creation; evidenced pre-upgrade fork reminder still notifies');
    const reads=globalThis[Symbol.for('fixture.tasks.read.calls')];
    agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'read-tool-fixture'}]}));await agent.whenIdle();assert.equal(globalThis[Symbol.for('fixture.tasks.read.calls')],reads);
    const tools=ctx.tools;assert(tools.guardReason({agent,name:'late_scoped_tool'}),'Late scoped tools cannot bypass the allowlist');
    await control.disable();assert(!ctx.get('longTasks'));assert(tools.guardReason({agent,name:'task_fixture_read'}),'Unloaded service must deny retained task tools');
    agent.followup(duplicate);await agent.whenIdle();assert.equal(globalThis[Symbol.for('fixture.tasks.read.calls')],reads);assert.equal(deliveries.length,4);
    report.checks.push('Cold task Sessions, native periodic execution, result-vs-delivery ledger, tool-error review, stable outbox and replay rejection');
    report.checks.push('Old Session Schedule survives main rotation and cold restore without hijacking current QQ route');
    report.checks.push('Actual plugin disposal removes service and keeps retained root execution gates fail-closed');
   }
   report.ok=true;
  }catch(error){report.error=error.stack;}finally{control.release();detach?.();await manager?.disposeAll().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
