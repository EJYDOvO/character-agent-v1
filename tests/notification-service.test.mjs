// Iteration 07 Notification: the Character Identity Outbox (single durable writer)
// delivering through an Agent I/O notifier stand-in with the real contract
// (authorize(target) before the part, SendResult back). Real SQLite in temp
// directories; nothing touches production state or QQ.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {apply} from '../packages/character-identity/index.mjs';
import {createOutbox} from '../packages/character-identity/outbox.mjs';
import {managerFixture} from './qq-manager-fixture.mjs';

const tick=async(n=10)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const SCHEMA=`CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,conversation TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS identity_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`;
function database(file=join(mkdtempSync(join(tmpdir(),'outbox-')),'state.sqlite')){const db=new DatabaseSync(file);db.exec(SCHEMA);return {db,file};}
// The notifier contract: authorize(target) is checked before the part, then the platform outcome.
// queued: awaited while the hand-over still waits in the I/O queue (cancellable); inFlight: after it reached the platform.
function notifier({outcome=()=>({status:'sent'}),before,inFlight}={}){
 const n={sent:[],requests:[],async send(request){n.requests.push(request);if(before)await before(request);
  if(request.signal?.aborted)return {status:'not-sent',reason:'cancelled',stage:'before-platform',parts:[]};
  if(request.authorize({type:request.conversation.type,id:request.conversation.id})!==true)return {status:'not-sent',reason:'unauthorized',stage:'before-platform',parts:[]};
  if(inFlight)await inFlight(request);
  const r=outcome(request);if(r.status==='sent'||r.status==='unknown'||r.status==='partial')n.sent.push(request.text);return r;}};
 return n;
}
const options=(n,extra={})=>({notifier:n,conversation:'qq-c',target:{type:'direct',id:'owner'},eligible:()=>true,authorize:()=>true,...extra});
const event=(id,kind='task_completed',text='[测试] '+id)=>({eventId:id,kind,text,conversation:'qq-c'});
const rows=db=>Object.fromEntries(db.prepare('SELECT id,status FROM outbox').all().map(r=>[r.id,r.status]));

test('pending → sending → sent once; the same event enqueued twice or concurrently is one row and one send',async()=>{
 const {db,file}=database(),o=createOutbox({db,key:file}),n=notifier();
 assert.equal(o.enqueue(event('e1')),true);assert.equal(o.enqueue(event('e1')),false,'same id and content: no second row');
 assert.throws(()=>o.enqueue({...event('e1'),text:'other'}),/id conflict/);
 await Promise.all([o.pump(options(n)),o.pump(options(n)),o.pump(options(n))]);
 assert.deepEqual(rows(db),{e1:'sent'});assert.deepEqual(n.sent,['[测试] e1']);
 assert.match(n.requests[0].id,/^notify:e1:1$/);assert.deepEqual(n.requests[0].conversation,{type:'direct',id:'owner'});
 await o.pump(options(n));assert.equal(n.sent.length,1,'a sent row is never sent again');
 await o.close();db.close();
});
test('outcomes: unknown and partial are kept and never resent; a platform refusal is not-sent; provably unsent attempts return to pending',async()=>{
 const {db,file}=database();let now=1000;const o=createOutbox({db,key:file,now:()=>now,retryAfterMs:60_000});
 const results={u:{status:'unknown',reason:'timeout-or-network'},p:{status:'partial',reason:'platform-rejected'},r:{status:'not-sent',reason:'platform-rejected',stage:'platform'},l:{status:'not-sent',reason:'rate-limited',stage:'platform'},q:{status:'not-sent',reason:'queue-full',stage:'before-platform'}};
 for(const id of Object.keys(results))o.enqueue(event(id));
 const n=notifier({outcome:r=>results[r.id.split(':')[1]]});
 await o.pump(options(n));
 assert.deepEqual(rows(db),{u:'unknown',p:'partial',r:'not-sent',l:'pending',q:'pending'});
 await o.pump(options(n));assert.equal(n.requests.length,5,'held: the rate-limited and queue-full rows are not hammered');
 now+=61_000;results.l={status:'sent'};results.q={status:'sent'};
 await o.pump(options(n));
 assert.deepEqual(rows(db),{u:'unknown',p:'partial',r:'not-sent',l:'sent',q:'sent'});
 assert.deepEqual(n.requests.filter(r=>r.id.startsWith('notify:l:')).map(r=>r.id),['notify:l:1','notify:l:2'],'a retry is a new I/O id');
 assert.equal(n.requests.filter(r=>/^notify:[upr]:/.test(r.id)).length,3,'unknown, partial and refused rows were attempted exactly once');
 await o.close();db.close();
});
test('an attempt refused by authorization stays pending and held until the next Gateway attachment',async()=>{
 const {db,file}=database(),o=createOutbox({db,key:file});let allowed=false;const n=notifier();
 o.enqueue(event('a'));
 await o.pump(options(n,{authorize:()=>allowed}));await o.pump(options(n,{authorize:()=>allowed}));
 assert.deepEqual(rows(db),{a:'pending'});assert.equal(n.requests.length,1);assert.equal(n.sent.length,0);
 allowed=true;o.releaseHeld();await o.pump(options(n,{authorize:()=>allowed}));
 assert.deepEqual(rows(db),{a:'sent'});await o.close();db.close();
});
test('a crash while sending: the next owner records unknown and never resends; a failed claim or result write sends nothing again',async()=>{
 const {db,file}=database();
 db.prepare("INSERT INTO outbox VALUES('c','task_completed','qq-c','[测试] c','sending',?)").run(new Date().toISOString());
 const o=createOutbox({db,key:file}),n=notifier();await o.ready;
 await o.pump(options(n));assert.deepEqual(rows(db),{c:'unknown'});assert.equal(n.requests.length,0);
 await o.close();
 // Claim write fails (disk, lock): nothing is handed over.
 const failing=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SET status='sending'/.test(sql))throw Error('disk full');return target.prepare(sql);};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const o2=createOutbox({db:failing,key:file+'#2'});o2.enqueue(event('d'));await o2.pump(options(n));
 assert.equal(n.requests.length,0,'no send without a durable claim');assert.equal(rows(db).d,'pending');await o2.close();
 // Result write fails after the send: the row stays sending → unknown at the next start, never resent.
 const after=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(/SET status=\? WHERE id=\? AND status=\?/.test(sql))throw Error('disk full');return target.prepare(sql);};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const o3=createOutbox({db:after,key:file+'#3'});await o3.pump(options(n));assert.equal(rows(db).d,'sending');assert.equal(n.sent.length,1);await o3.close();
 const o4=createOutbox({db,key:file+'#3'});await o4.ready;await o4.pump(options(n));assert.equal(rows(db).d,'unknown');assert.equal(n.sent.length,1);await o4.close();
 db.close();
});
test('HMR overlap: a new owner waits for the old one; an in-flight send of the old owner is recorded, not clobbered to unknown',async()=>{
 const {db,file}=database();let release;const gate=new Promise(r=>{release=r;});
 const old=createOutbox({db,key:file}),slow=notifier({inFlight:()=>gate});old.enqueue(event('h'));
 const inFlight=old.pump(options(slow));await tick();assert.equal(rows(db).h,'sending');
 const next=createOutbox({db,key:file});let recovered=false;next.ready.then(()=>{recovered=true;});await tick();
 assert.equal(recovered,false,'the new owner does not recover while the old one is open');
 const closing=old.close();release();await inFlight;await closing;await next.ready;
 assert.equal(rows(db).h,'sent');assert.equal(slow.sent.length,1);await next.close();db.close();
});
test('close: a hand-over still queued is cancelled and returns to pending; nothing is lost or resent',async()=>{
 const {db,file}=database();let release;const gate=new Promise(r=>{release=r;});
 const o=createOutbox({db,key:file}),n=notifier({before:async request=>{await gate;}});o.enqueue(event('k'));
 const p=o.pump(options(n));await tick();const closing=o.close();release();await p;await closing;
 assert.deepEqual(rows(db),{k:'pending'});assert.equal(n.sent.length,0);
 const again=createOutbox({db,key:file}),m=notifier();await again.pump(options(m));assert.deepEqual(rows(db),{k:'sent'});await again.close();db.close();
});

// ── Character Identity: entry points, historical reminders and the send-time checks ──
function identity(directory=mkdtempSync(join(tmpdir(),'notify-service-')),{notify}={}){
 const bindingFile=join(directory,'binding.json'),stateFile=join(directory,'state.sqlite');writeFileSync(bindingFile,JSON.stringify({appId:'app',ownerId:'owner'}));
 let service,dispose;const events=new Map(),host={agents:new Map(),agentPresets:{composedPreset:()=>'qq-character'}};
 const makeAgent=id=>{const a={id,session:{header:{id},seq:1},guards:[],gates:new Map()};a.ctx={get:n=>n==='characterIdentity'?service:n==='tools'?{guard:f=>a.guards.push(f)}:undefined,on:(n,f)=>a.gates.set(n,f)};host.agents.set(id,a);return a;};
 apply({get:n=>host[n],on:(n,fn)=>events.set(n,fn),provide:(n,s)=>{if(n==='characterIdentity')service=s;},effect:f=>dispose=f()},{bindingFile,stateFile});
 const manager=managerFixture(),n=notifier(notify);
 manager.commit({sessionId:'old',scope:'c2c',peerId:'owner',senderId:'owner',agentPreset:'qq-character',agent:makeAgent('old')});
 const runtime={manager,config:{appId:'app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['owner'],groupMode:'disabled'}},sender:{sendMarkdown:async()=>{throw Error('no direct Gateway send');}},notifications:n};
 return {directory,stateFile,service,runtime,manager,n,events,makeAgent,host,dispose:()=>dispose()};
}
const reminder=(scheduleId,at='2026-11-01T08:00:00.000Z',prompt='喝水')=>({type:'user/message',data:{message:{source:{kind:'schedule'},content:[{type:'text',text:`[SCHEDULE REMINDER]\nschedule_id_json: ${JSON.stringify(scheduleId)}\noccurrence_at: ${at}\nreminder_prompt_json: ${JSON.stringify(prompt)}`}]}}});
async function scheduleOn(f,agent,message){f.events.get('session/event')(agent.session,message);await tick(30);}

test('a reminder from a rotated (historical) Session with its persisted binding is delivered; the chat route of that Session stays refused',async()=>{
 const f=identity();try{
  f.service.attach(f.runtime);await f.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});
  const old=f.host.agents.get('old');f.manager.commit({...f.manager.record,sessionId:'new',agent:f.makeAgent('new')});
  assert.throws(()=>f.service.forSession('old'),/not bound|Historical/,'the old Session has no chat authority any more');
  await scheduleOn(f,old,reminder('s-1'));
  assert.deepEqual(f.n.sent,['[提醒到期]\n喝水']);
  const db=new DatabaseSync(f.stateFile);assert.equal(db.prepare("SELECT value FROM identity_state WHERE key LIKE 'outbox-source:%'").get().value,'old');db.close();
  await scheduleOn(f,old,reminder('s-1'));assert.equal(f.n.sent.length,1,'the same occurrence is one event');
  await scheduleOn(f,old,{type:'user/message',data:{message:{source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER BATCH]\nreminders_json: '+JSON.stringify([{schedule_id:'s-2',occurrence_at:'2026-11-01T09:00:00.000Z',reminder_prompt:'一'},{schedule_id:'s-3',occurrence_at:'2026-11-01T09:00:00.000Z',reminder_prompt:'二'}])}]}}});
  assert.deepEqual(f.n.sent.slice(1),['[提醒到期]\n一','[提醒到期]\n二'],'a batch is one event per reminder, in order');
 }finally{await f.dispose();}
});
test('an unproven or forged reminder root is refused; a binding revoked before the send and an Owner revoked by policy are refused at send time',async()=>{
 const f=identity();try{
  f.service.attach(f.runtime);await f.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});
  const ghost=f.makeAgent('ghost');await scheduleOn(f,ghost,reminder('forged'));
  assert.equal(f.n.requests.length,0,'no binding, no audit evidence: nothing enqueued, nothing sent');
  // Binding removed between enqueue and hand-over (the send-time re-check).
  let release;const gate=new Promise(r=>{release=r;});const slow=notifier({before:()=>gate});f.runtime.notifications=slow;
  const old=f.host.agents.get('old');const pending=scheduleOn(f,old,reminder('s-9'));await tick(5);
  const db=new DatabaseSync(f.stateFile);db.prepare("DELETE FROM qq_bindings WHERE session='old'").run();release();await pending;await tick(10);
  assert.equal(slow.sent.length,0);assert.equal(db.prepare("SELECT status FROM outbox WHERE kind='scheduled_reminder'").get().status,'pending','refused, kept for review, not sent');
  db.close();
  // Owner revoked by the Gateway policy: an explicit task event is refused as well.
  const n=notifier();f.runtime.notifications=n;f.runtime.config.access.c2cAllow=['someone-else'];
  const status=await f.service.notifyConversation(f.service.conversationScope(),{eventId:'long-task:r1',kind:'task_completed',text:'[长期任务] 完成'});
  assert.deepEqual(status,{status:'pending'});assert.equal(n.sent.length,0);
 }finally{await f.dispose();}
});
test('a legacy pending reminder without its recorded source stays pending; other legacy rows are delivered once',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'notify-legacy-'));let f=identity(directory);await f.dispose();
 const conversation=f.service.conversationScope().conversationId,db=new DatabaseSync(f.stateFile);
 for(const [id,kind] of [['legacy-reminder','scheduled_reminder'],['legacy-task','task_completed']])db.prepare("INSERT INTO outbox VALUES(?,?,?,?,'pending',?)").run(id,kind,conversation,'[旧] '+id,new Date().toISOString());db.close();
 f=identity(directory);try{
  f.service.attach(f.runtime);await tick(30);
  assert.deepEqual(f.n.sent,['[旧] legacy-task']);
  const after=new DatabaseSync(f.stateFile);assert.equal(after.prepare("SELECT status FROM outbox WHERE id='legacy-reminder'").get().status,'pending');after.close();
 }finally{await f.dispose();}
});
test('notifySystem waits for its own row even while another pump runs, and reports a non-sent Outbox status with the error',async()=>{
 const f=identity();try{
  f.service.attach(f.runtime);await f.manager.getOrCreate('c2c','owner','owner',{scope:'c2c',targetId:'owner'});
  let release;const gate=new Promise(r=>{release=r;});
  f.runtime.notifications=notifier({before:r=>r.text.includes('first')?gate:undefined});
  const trusted=f.service.forSession('old');
  const first=f.service.notify(trusted,{eventId:'t1',kind:'task_completed',text:'first'});await tick(5);
  const system=f.service.notifySystem({eventId:'qqtk:job:1',kind:'maintenance_result',text:'维护 完成',target:{scope:'c2c',targetId:'owner'}});
  await tick(5);release();
  assert.deepEqual(await first,{status:'sent'});assert.deepEqual(await system,{status:'sent'},'not a false failure while another pump ran');
  f.runtime.notifications=notifier({outcome:()=>({status:'unknown',reason:'timeout'})});
  await assert.rejects(f.service.notifySystem({eventId:'qqtk:job:2',kind:'maintenance_result',text:'维护 2',target:{scope:'c2c',targetId:'owner'}}),e=>e.status==='unknown');
 }finally{await f.dispose();}
});
