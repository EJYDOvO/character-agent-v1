import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {apply} from '../packages/character-identity/index.mjs';
import {DatabaseSync} from 'node:sqlite';
import {managerFixture} from './qq-manager-fixture.mjs';
// Stand-in for the Gateway's Agent I/O notifier (openNotifications): the target must
// pass the Outbox's own authorization, the result is an Agent I/O SendResult.
// calls keeps the former [target, text] shape.
export function notifier(calls,result=()=>({status:'sent',parts:[{index:0,status:'sent'}]})){
 return {requests:[],async send(request){this.requests.push(request);
  if(request.authorize({type:request.conversation.type,id:request.conversation.id})!==true)return {status:'not-sent',reason:'unauthorized',stage:'before-platform',parts:[]};
  calls.push([{scope:'c2c',targetId:request.conversation.id},request.text]);return result(request);}};
}
function fixture(directory=mkdtempSync(join(tmpdir(),'character-notify-')),binding={},host={}){const bindingFile=join(directory,'binding.json'),stateFile=join(directory,'state.sqlite');writeFileSync(bindingFile,JSON.stringify({appId:'app',ownerId:'owner',...binding}));let service,dispose;const events=new Map();host.agents??=new Map();const makeAgent=id=>{const a={id,session:{header:{id},seq:1},guards:[],gates:new Map()};a.ctx={get:n=>n==='characterIdentity'?service:n==='tools'?{guard:f=>a.guards.push(f)}:undefined,on:(n,f)=>a.gates.set(n,f)};host.agents.set(id,a);return a;};host.agentPresets??={composedPreset:()=> 'qq-character'};apply({get:n=>host[n],on:(n,fn)=>events.set(n,fn),provide:(n,s)=>{if(n==='characterIdentity')service=s;},effect:f=>dispose=f()},{bindingFile,stateFile});const calls=[],manager=managerFixture();manager.commit({sessionId:'session',scope:'c2c',peerId:'owner',senderId:'owner',agentPreset:'qq-character',agent:makeAgent('session')});const runtime={manager,config:{appId:'app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['owner'],groupMode:'disabled'}},sender:{sendMarkdown:async()=>{throw Error('no direct Gateway send');}},notifications:notifier(calls)};return{directory,service,dispose,runtime,calls,events,makeAgent,host};}
test('unique gateway and real trusted mock route; non-owner denied before session creation',async()=>{const f=fixture();try{f.service.attach(f.runtime);await assert.rejects(()=>f.runtime.manager.getOrCreate('c2c','stranger','stranger',{}),/Owner/);await assert.rejects(()=>f.runtime.manager.getOrCreate('group','owner','owner',{scope:'c2c',targetId:'owner'}),/Owner/);assert.throws(()=>f.service.attach(f.runtime),/Duplicate/);await f.runtime.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});assert.equal(f.service.forSession('session').role,'character');}finally{f.dispose();}});
test('route inspection persists generation, keeps rotation opt-in, and preserves original Schedule roots',async()=>{
 let f=fixture();const directory=f.directory;
 for(let attempt=0;attempt<2;attempt++){
  if(attempt)f=fixture(directory);f.service.attach(f.runtime);await f.runtime.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});
  try{const c=f.service.forSession('session'),route=f.service.route(c);assert.equal(route.session,'session');assert.equal(route.generation,1);assert.equal(route.automaticRotation,false);assert.equal(route.scheduleTarget,'original_session');assert.deepEqual(route.blockers,[]);assert.throws(()=>f.service.route({...c}),/Unauthorized/);}finally{f.dispose();}
 }
});
test('explicit notification is deduplicated across restart and only targets owner',async()=>{let f=fixture();const directory=f.directory;f.service.attach(f.runtime);await f.runtime.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});let c=f.service.forSession('session');const event={eventId:'task-1:completed',kind:'task_completed',text:'[测试] 已完成'};assert.equal((await f.service.notify(c,event)).status,'sent');await f.service.notify(c,event);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0].targetId,'owner');f.dispose();f=fixture(directory);try{f.service.attach(f.runtime);await f.runtime.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});c=f.service.forSession('session');assert.equal((await f.service.notify(c,event)).status,'sent');assert.equal(f.calls.length,0);await assert.rejects(()=>f.service.notify(c,{...event,eventId:'social',kind:'heartbeat'}),/Invalid/);}finally{f.dispose();}});
test('ambiguous send is unknown and is never blindly retried',async()=>{const f=fixture();try{f.runtime.notifications.send=async()=>{f.calls.push(1);return {status:'unknown',reason:'timeout-or-network',parts:[{index:0,status:'unknown'}]};};f.service.attach(f.runtime);await f.runtime.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});const c=f.service.forSession('session'),event={eventId:'reminder-1:due',kind:'scheduled_reminder',text:'[测试] 到期'};assert.equal((await f.service.notify(c,event)).status,'unknown');await f.service.notify(c,event);assert.equal(f.calls.length,1);}finally{f.dispose();}});
test('restart sends pending exactly once and quarantines interrupted sending',async()=>{let f=fixture();const directory=f.directory;f.service.attach(f.runtime);await f.runtime.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});const conversation=f.service.forSession('session').conversationId;f.dispose();const db=new DatabaseSync(join(directory,'state.sqlite'));for(const status of ['pending','sending'])db.prepare('INSERT INTO outbox VALUES(?,?,?,?,?,?)').run(status,'task_completed',conversation,'[测试] '+status,status,new Date().toISOString());db.close();f=fixture(directory);try{f.service.attach(f.runtime);await new Promise(r=>setImmediate(r));await f.runtime.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});const rows=f.service.inspect(f.service.forSession('session'));assert.equal(rows.find(r=>r.id==='pending').status,'sent');assert.equal(rows.find(r=>r.id==='sending').status,'unknown');assert.equal(f.calls.length,1);}finally{f.dispose();}});
test('detach while restore awaits cannot issue a trusted capability',async()=>{const f=fixture();let resolve;const original=f.runtime.manager.getOrCreate;f.runtime.manager.getOrCreate=()=>new Promise(r=>resolve=r);const detach=f.service.attach(f.runtime);try{const pending=f.runtime.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});detach();resolve(await original.call(f.runtime.manager));await assert.rejects(pending,/detached/);assert.throws(()=>f.service.forSession('session'),/not bound/);}finally{f.dispose();}});
test('explicit correction admission retains Owner validation and raw evidence, then revokes on detach',async()=>{
 const f=fixture(),evidence=[];f.service.onIngress((_h,e)=>evidence.push(e));const detach=f.service.attach(f.runtime),admit=f.runtime.manager.admitInteractionInput;
 try{
  await assert.rejects(()=>admit({message:{kind:'c2c',senderId:'other',content:'更正：假来源'}}),/Owner/);
  await admit({message:{kind:'c2c',senderId:'owner',messageId:'correction-1',content:'更正：保留原文件'},state:{injected:'错误内容'}});
  assert.equal(evidence.length,1);assert.equal(evidence[0].text,'更正：保留原文件');assert.equal(evidence[0].origin,'direct_user');
  detach();assert.equal(f.runtime.manager.admitInteractionInput,undefined);await assert.rejects(()=>admit({message:{kind:'c2c',senderId:'owner'}}),/detached/);
 }finally{f.dispose();}
});
test('pending outbox belonging to a different owner is never sent to current binding',async()=>{let f=fixture();const directory=f.directory;f.dispose();const db=new DatabaseSync(join(directory,'state.sqlite'));db.prepare('INSERT INTO outbox VALUES(?,?,?,?,?,?)').run('other-owner','scheduled_reminder','qq-foreign','private previous-owner content','pending',new Date().toISOString());db.close();f=fixture(directory);try{f.service.attach(f.runtime);await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,0);}finally{f.dispose();}});
test('scope fingerprint rejects reuse under another project; stable descriptors are not Memory capabilities',()=>{
 const f=fixture();try{assert.throws(()=>f.service.authorize(f.service.conversationScope(),'read'),/Unauthorized/);}finally{f.dispose();}
 assert.throws(()=>fixture(f.directory,{projectId:'another-project'}),/scope changed/);
});
test('retired Schedule roots stay reminder-only across restart and Gateway reload; stale handles and direct tools fail closed',async()=>{
 let f=fixture();const directory=f.directory,target={scope:'c2c',targetId:'owner'};f.service.attach(f.runtime);const old=f.runtime.manager.record.agent,c=f.service.forSession(old.id);
 f.runtime.manager.commit({...f.runtime.manager.record,sessionId:'main-root',agent:f.makeAgent('main-root')});
 assert.throws(()=>f.service.authorize(c,'read'),/Historical/); // prefs change before async admission finishes
 await f.runtime.manager.getOrCreate('c2c','owner','owner',target);assert.throws(()=>f.service.forSession(old.id));assert(old.guards[0]({agent:old}));
 assert.deepEqual(await old.gates.get('agent/pre-step')({agent:old},()=>assert.fail()),{kind:'reject'});f.dispose();
 f=fixture(directory);try{
  const manager=f.runtime.manager,oldRoot=manager.record.agent;manager.commit({...manager.record,sessionId:'main-root',agent:f.makeAgent('main-root')});
  const detach=f.service.attach(f.runtime);await f.events.get('agent/created')({agent:oldRoot});
  assert.throws(()=>f.service.forSession(oldRoot.id));assert.equal(manager.preserveScheduledSession(oldRoot.id),true);
  assert.equal(f.service.route(f.service.forSession('main-root')).session,'main-root');
  const text='[SCHEDULE REMINDER]\nschedule_id_json: "task-1"\noccurrence_at: 2026-10-17T00:00:00Z\nreminder_prompt_json: "Synthetic reminder"',message={source:{kind:'schedule'},content:[{type:'text',text}]};
  f.events.get('session/event')(oldRoot.session,{type:'user/message',data:message});await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);
  f.events.get('session/event')(oldRoot.session,{type:'user/message',data:message});await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);
  const stranger=f.makeAgent('unproven');await f.events.get('agent/created')({agent:stranger});f.events.get('session/event')(stranger.session,{type:'user/message',data:message});await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);
  detach();assert.throws(()=>f.service.forSession('main-root'));assert(oldRoot.guards[0]({agent:oldRoot}));assert.equal(manager.preserveScheduledSession,undefined);f.service.attach(f.runtime);assert.throws(()=>f.service.forSession(oldRoot.id));assert.equal(f.service.route(f.service.forSession('main-root')).session,'main-root');
 }finally{f.dispose();}
});

test('late completion of an old admission cannot restore its identity or hijack the route',async()=>{
 const f=fixture(),manager=f.runtime.manager,old=manager.record;let release;
 manager.getOrCreate=async()=>manager.record===old?new Promise(r=>release=()=>r(old)):manager.record;
 f.service.attach(f.runtime);try{
  const pending=manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});
  manager.commit({...old,sessionId:'next',agent:f.makeAgent('next')});await manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});release();
  await assert.rejects(pending,/Superseded/);assert.throws(()=>f.service.forSession(old.sessionId));assert.equal(f.service.route(f.service.forSession('next')).session,'next');
 }finally{f.dispose();}
});
test('reattaching the exact Gateway object cannot revive a detached admission or let its old disposer detach the new epoch',async()=>{
 const f=fixture(),manager=f.runtime.manager;let release;manager.getOrCreate=()=>new Promise(r=>release=()=>r(manager.record));const detach=f.service.attach(f.runtime);
 try{const pending=manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});detach();f.service.attach(f.runtime);detach();assert(f.service.forSession('session'));release();await assert.rejects(pending,/detached/);assert.equal(f.service.route(f.service.forSession('session')).session,'session');}
 finally{f.dispose();}
});
test('Identity detach does not overwrite a rebuild wrapper installed later',()=>{
 const f=fixture();f.runtime.manager.rebuildSession=async()=>{};const detach=f.service.attach(f.runtime),later=async()=>{};f.runtime.manager.rebuildSession=later;
 try{detach();assert.equal(f.runtime.manager.rebuildSession,later);}finally{f.dispose();}
});
test('a retained detached rebuild wrapper cannot start another model switch',async()=>{
 const f=fixture();let called=0;f.runtime.manager.rebuildSession=async()=>called++;const detach=f.service.attach(f.runtime),wrapped=f.runtime.manager.rebuildSession;detach();
 try{await assert.rejects(()=>wrapped(f.runtime.manager.record,{}),/detached/);assert.equal(called,0);}finally{f.dispose();}
});
test('an old rebuild completing after detach cannot grant authority in the new epoch',async()=>{
 const f=fixture(),manager=f.runtime.manager;let release;manager.rebuildSession=async record=>{await new Promise(r=>release=r);manager.commit({...record,sessionId:'next',agent:f.makeAgent('next')});};
 const detach=f.service.attach(f.runtime),rebuilding=manager.rebuildSession(manager.record,{});detach();f.service.attach(f.runtime);
 try{release();await assert.rejects(rebuilding,/detached/);assert.throws(()=>f.service.forSession('next'));assert.throws(()=>f.service.forSession('session'));await manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});assert(f.service.forSession('next'));}finally{f.dispose();}
});

test('evidenced binding repair is atomic, read-only audit changes nothing, and failed repair can be retried after restart',async()=>{
 const host={schedule:{catalog:async()=>[{id:'legacy',sessionId:'old-root',status:'active'}]},sessionPersistence:{stat:async id=>({header:{id,agentPreset:'qq-character',parentSession:id==='session'?'middle':id==='middle'?'old-root':undefined}})}};
 let f=fixture(undefined,{},host);const directory=f.directory,db=new DatabaseSync(join(directory,'state.sqlite'));
 db.exec("CREATE TRIGGER fail_repair BEFORE INSERT ON qq_bindings WHEN NEW.session='old-root' BEGIN SELECT RAISE(ABORT,'fixture disk failure');END;");
 f.service.attach(f.runtime);await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.deepEqual(db.prepare('SELECT session FROM qq_bindings').all().map(r=>r.session),['session'],'Failed insert must roll back earlier inserts');
 const before=db.prepare('SELECT * FROM qq_bindings').all();const report=await f.service.auditSchedules();assert.equal(report.rows[0].binding,'verified_missing');assert.deepEqual(db.prepare('SELECT * FROM qq_bindings').all(),before);
 db.exec('DROP TRIGGER fail_repair');db.close();f.dispose();f=fixture(directory,{},host);
 try{f.service.attach(f.runtime);const old=f.makeAgent('old-root');await f.events.get('agent/created')({agent:old,source:'resume'});assert.equal(f.runtime.manager.preserveScheduledSession(old.id),true);assert.throws(()=>f.service.forSession(old.id));assert.equal((await f.service.auditSchedules()).rows[0].binding,'bound');assert.deepEqual(f.host.schedule.catalog&&await f.host.schedule.catalog(),[{id:'legacy',sessionId:'old-root',status:'active'}]);}
 finally{f.dispose();}
});
