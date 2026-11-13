// Per-run Long Tasks: every occurrence of a task runs in a fresh Session that
// native Schedule creates (DSH 0.2.2-rc.1 target {kind:'new'}), one Task, one
// Run per occurrence, through the same claim / activity / Outbox lifecycle as
// historical fixed-root tasks (tests/long-tasks.test.mjs).
//
// The fake Schedule follows dsh-schedule lib/index.js resolveTarget/send/
// delivered: reserve a Session id, create it through the Session controller
// with target.create {agentPreset,cwd}, enqueue one one-shot receipt, then
// commit lastDelivery {scheduledAt,deliveredAt,messageId,targetSessionId}.
// Catalog entries expose lastDelivery but never pendingDelivery (entry()).
import test from 'node:test';
import assert from 'node:assert/strict';
import {LongTasks} from '../packages/long-tasks/service.mjs';
import {instruction,runId} from '../packages/long-tasks/state.mjs';
function table(){const rows=new Map();return {rows,get:k=>structuredClone(rows.get(k)),entries:()=>[...rows].map(([k,v])=>[k,structuredClone(v)]),async put(k,v){rows.set(k,structuredClone(v));}};}
const CWD='C:/dsh-test/task-workspace';
function receiptMessage(id,scheduleId,at,prompt){return {id,source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER]\nschedule_id_json: '+JSON.stringify(scheduleId)+'\noccurrence_at: '+at+'\nreminder_prompt_json: '+JSON.stringify(prompt)}]};}
function nativeSchedule(rows,controller){
 let clock=Date.parse('2030-01-01T00:00:00.000Z'),sid=0,mid=0;const tick=()=>new Date(++clock).toISOString(),calls=[];
 const entry=r=>structuredClone({...r.record,target:r.target,involvedSessionIds:r.involved,status:r.status,...(r.updatedAt===undefined?{}:{updatedAt:r.updatedAt}),...(r.lastDelivery?{lastDelivery:r.lastDelivery}:{})});
 return {calls,
  async create(request,actor){calls.push(['create',structuredClone(request),actor]);
   if(request.target.kind==='new'&&!controller())throw Error('This Host cannot create Sessions; choose an existing Session target.');
   const at=tick(),record={id:'schedule-'+(++sid),kind:request.timing.kind,title:request.title,prompt:request.prompt,scheduledAt:new Date(Date.now()+3600000).toISOString()};
   rows.set(record.id,{record,target:structuredClone(request.target),involved:[...new Set([actor,request.target.sessionId].filter(Boolean))],status:'active',createdAt:at,updatedAt:at});return entry(rows.get(record.id));},
  async catalog(){return [...rows.values()].map(entry);},
  async view({id}){const r=rows.get(id);return r?entry(r):{id,code:'schedule_not_found'};},
  async edit(request,actor){calls.push(['edit',structuredClone(request),actor]);const r=rows.get(request.id);if(!r)return {id:request.id,code:'schedule_not_found'};
   if(request.expectedUpdatedAt!==undefined&&request.expectedUpdatedAt!==(r.updatedAt??null))return {id:request.id,code:'schedule_conflict'};
   if(request.action==='delete'){rows.delete(request.id);return {id:request.id,deleted:true};}
   r.record={...r.record,...(request.patch.title===undefined?{}:{title:request.patch.title}),...(request.patch.prompt===undefined?{}:{prompt:request.patch.prompt})};r.updatedAt=tick();return entry(r);},
  // One native delivery of an occurrence. commit:false stops before the
  // lastDelivery write (the pre-step can run first); sessionId reuses a
  // reserved Session (retry after a failed commit).
  async deliver(id,at,{commit=true,sessionId}={}){
   const r=rows.get(id);let agent;
   if(r.target.kind==='new'){const reserved=sessionId??'session-run-'+(++mid);agent=await controller().create({sessionId:reserved,...r.target.create});}
   else agent=controller().get(r.target.sessionId);
   const message=receiptMessage('message-'+(++mid),id,at,r.record.prompt);
   if(commit)r.lastDelivery={scheduledAt:at,deliveredAt:tick(),messageId:message.id,targetSessionId:agent.id};
   return {agent,message};
  }};
}
async function fixture(options={},{controller=true}={}){
 const scope={principalId:'owner',characterId:'fixture',projectId:'project',conversationId:'stable-qq'},owner={id:'owner-session',preset:'qq-character',session:{header:{id:'owner-session'}},options:{provider:'fixture',model:'fixture'}};
 const agents=new Map([[owner.id,owner]]),tasks=table(),runs=table(),schedules=new Map(),logs=new Map(),notified=new Map(),sent=[],created=[];let status='sent';
 const makeAgent=(id,preset,header={})=>{const agent={id,preset,session:{header:{id,...header},events:[],seq:0},cancel(reason){this.cancelled=reason;}};agents.set(id,agent);logs.set(id,agent.session.events);return agent;};
 // Session controller: creates a root Session with the requested Preset (DSH composeAgent + mount).
 const sessionController={async create({sessionId,agentPreset,cwd}){created.push({sessionId,agentPreset,cwd});return agents.get(sessionId)??makeAgent(sessionId,agentPreset,{cwd});},get:id=>agents.get(id)};
 const identity={forSession(id){if(id!==owner.id)throw Error('Not QQ owner');return scope;},authorize:c=>c,
  validateConversation(s){if(['principalId','characterId','projectId','conversationId'].some(k=>s?.[k]!==scope[k]))throw Error('Foreign task conversation');return scope;},
  async notifyConversation(s,event){this.validateConversation(s);if(!event.eventId.startsWith('long-task:'))throw Error('Stable task event id required');sent.push(event);if(!notified.has(event.eventId))notified.set(event.eventId,event);return {status};},notificationStatus:()=>null};
 let available=controller;
 const schedule=nativeSchedule(schedules,()=>available?sessionController:undefined);
 const host={tasks,runs,identity,schedule,agents,canCreateSessions:()=>available,presetOf:a=>a.preset,flush:async()=>true,load:async id=>({events:logs.get(id)??[]}),
  async createRoot(t){return {agent:makeAgent(t.sessionId,t.presetId)};}};
 const service=new LongTasks(host,{cwd:CWD,...options});await service.recover();
 return {service,host,owner,scope,tasks,runs,schedules,agents,notified,sent,created,makeAgent,setStatus:v=>status=v,setController:v=>available=v,
  restart:async(extra={})=>{await service.close().catch(()=>{});const next=new LongTasks(host,{cwd:CWD,...options,...extra});await next.recover();return next;}};
}
const once={title:'检查',prompt:'输出可核实的检查结果。',after_seconds:30};
const periodic={title:'新闻',prompt:'查询今日新闻并总结。',every_seconds:3600};
const T0='2030-01-01T00:00:00.000Z',T1='2030-01-01T01:00:00.000Z';
let turnSeq=100;
async function start(f,task,at,service=f.service,opts){const d=await f.host.schedule.deliver(task.scheduleId,at,opts),turn=++turnSeq;d.agent.session.seq=d.agent.session.events.length;return {...d,turn,admitted:await service.preStep(d.agent,{turn,messages:[d.message]}),id:runId(task.id,at)};}
async function emit(f,r,type,data,service=f.service){const event={type,seq:r.agent.session.events.length,data:{turn:r.turn,...data}};r.agent.session.events.push(event);await service.observe(r.agent.session,event);return event;}
async function end(f,r,{reason='completed',answer='已核实：3 条结果。'}={},service=f.service){if(answer!==null)r.agent.session.events.push({type:'assistant/message',seq:r.agent.session.events.length,data:{message:{content:[{type:'text',text:answer}]}}});return emit(f,r,'turn/end',{reason:{kind:reason}},service);}
const finals=f=>f.sent.filter(e=>e.kind!=='task_activity');

test('one-shot task: native new-Session target, one Session, one Run, one result notification',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,once);
 const [,request,actor]=f.host.schedule.calls.find(c=>c[0]==='create');
 assert.deepEqual(request.target,{kind:'new',create:{agentPreset:'long-task',cwd:CWD}},'every occurrence gets a fresh task-Preset Session');
 assert.equal(actor,f.owner.id,'the Owner Session is only the recorded actor');assert.equal(task.sessionId,undefined,'a per-run task has no Session of its own');
 assert.equal(task.delivery,'new');assert.equal(request.prompt,instruction(task));
 const r=await start(f,task,T0);assert.equal(r.admitted,true);assert.notEqual(r.agent.id,f.owner.id);
 assert.deepEqual(f.created,[{sessionId:r.agent.id,agentPreset:'long-task',cwd:CWD}]);
 const running=f.runs.get(r.id);assert.equal(running.status,'running');assert.equal(running.sessionId,r.agent.id);assert.equal(running.scheduleId,task.scheduleId);assert.equal(running.messageId,r.message.id);
 assert.equal(f.service.taskAgent(r.agent).id,task.id);
 await end(f,r);const run=f.runs.get(r.id);
 assert.equal(run.status,'completed');assert.equal(run.notification,'sent');
 const [note]=finals(f);assert.equal(note.eventId,'long-task:'+r.id);assert.equal(note.kind,'task_completed');assert.match(note.text,/^\[长期任务\] 检查\n本轮执行结束（不等同于目标已独立验收）\n已核实：3 条结果。/u);
 const [listed]=await f.service.list(f.owner);assert.equal(listed.executionState,'active');assert.equal(listed.runs[0].sessionId,r.agent.id);assert.equal(listed.runs[0].goalVerification,'unverified');
 assert.equal(await f.service.preStep(r.agent,{turn:++turnSeq,messages:[{id:'typed',source:{kind:'user'},content:[{type:'text',text:'再做一次'}]}]}),false,'a finished run Session admits nothing more');
});

test('periodic task: two occurrences, two Sessions, two independently settled Runs',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,periodic);
 const a=await start(f,task,T0);await emit(f,a,'tool/result',{step:1,message:{role:'tool',toolCallId:'x',source:{kind:'tool',callId:'x'},content:[{type:'text',text:'{"ok":false}'}]}});await end(f,a,{answer:'部分查询失败。'});
 const b=await start(f,task,T1);assert.equal(b.admitted,true);assert.notEqual(a.agent.id,b.agent.id,'each occurrence has its own Session');
 assert.equal(b.agent.session.events.length,0,'the second Run starts without the first Run\'s history');await end(f,b,{answer:'今日 5 条新闻。'});
 const ra=f.runs.get(a.id),rb=f.runs.get(b.id);assert.notEqual(ra.id,rb.id);
 assert.deepEqual([ra.status,rb.status],['needs_review','completed'],'an earlier tool error stays with its own Run');
 assert.deepEqual([ra.sessionId,rb.sessionId],[a.agent.id,b.agent.id]);
 assert.deepEqual(finals(f).map(e=>e.eventId),['long-task:'+a.id,'long-task:'+b.id]);
 assert.equal(await f.service.preStep(a.agent,{turn:++turnSeq,messages:[b.message]}),false,'a Session of Run A cannot take Run B\'s receipt');
 const T2='2030-01-01T02:00:00.000Z',late=receiptMessage('message-late',task.scheduleId,T2,instruction(task));
 assert.equal(await f.service.preStep(a.agent,{turn:++turnSeq,messages:[late]}),false,'a finished run Session never hosts a later occurrence');
 assert.equal(f.runs.get(runId(task.id,T2)),undefined);assert.equal(f.runs.entries().length,2);
});

test('pre-step may run before or after native commits lastDelivery; a receipt committed to another Session is refused',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,periodic);
 const early=await start(f,task,T0,f.service,{commit:false});assert.equal(early.admitted,true,'uncommitted receipt: the Schedule id, target and instruction suffice');await end(f,early);
 const d=await f.host.schedule.deliver(task.scheduleId,T1);const other=f.makeAgent('session-foreign','long-task');
 await assert.rejects(()=>f.service.preStep(other,{turn:1,messages:[{...d.message}]}).then(v=>{if(v===false)throw Error('refused');}),/refused|Trusted/);
 assert.equal(f.runs.get(runId(task.id,T1)),undefined,'the native receipt names a different Session');
 assert.equal(await f.service.preStep(d.agent,{turn:2,messages:[d.message]}),true);
});

test('duplicate occurrence, replayed receipt, retried delivery and batch framing never execute twice',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,periodic);
 const r=await start(f,task,T0);assert.equal(r.admitted,true);
 assert.equal(await f.service.preStep(r.agent,{turn:r.turn,messages:[]}),true,'later steps of the same turn continue');
 assert.equal(await f.service.preStep(r.agent,{turn:r.turn,messages:[r.message]}),false,'same receipt injected into the running turn');
 await end(f,r);await end(f,r);assert.equal(finals(f).length,1,'a replayed turn/end does not notify twice');
 assert.equal(await f.service.preStep(r.agent,{turn:++turnSeq,messages:[r.message]}),false,'replayed receipt in the same Session');
 const retry=await start(f,task,T0,f.service,{commit:false});assert.equal(retry.admitted,false,'the same occurrence in another Session is the same Run');
 const reuse=await start(f,task,T0,f.service,{sessionId:retry.agent.id});assert.equal(reuse.admitted,false);
 assert.equal(f.runs.entries().length,1);
 const d=await f.host.schedule.deliver(task.scheduleId,T1);
 const batch={id:'batch',source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER BATCH]\nreminders_json: '+JSON.stringify([{schedule_id:task.scheduleId,occurrence_at:T1,reminder_prompt:instruction(task)},{schedule_id:task.scheduleId,occurrence_at:'2030-01-01T02:00:00.000Z',reminder_prompt:instruction(task)}])}]};
 await assert.rejects(()=>f.service.preStep(d.agent,{turn:1,messages:[batch]}),/Multiple occurrences/);
 const twice={...batch,content:[{type:'text',text:'[SCHEDULE REMINDER BATCH]\nreminders_json: '+JSON.stringify([{schedule_id:task.scheduleId,occurrence_at:T1,reminder_prompt:instruction(task)},{schedule_id:task.scheduleId,occurrence_at:T1,reminder_prompt:instruction(task)}])}]};
 assert.equal(await f.service.preStep(d.agent,{turn:2,messages:[twice]}),true,'one occurrence listed twice is still one Run');
 assert.equal(f.runs.entries().length,2);
});

test('out-of-order, foreign-turn and pre-admission events neither count nor settle the Run',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,once);const d=await f.host.schedule.deliver(task.scheduleId,T0);
 const stale={type:'tool/result',seq:0,data:{turn:1,step:1,message:{role:'tool',toolCallId:'x',source:{kind:'tool',callId:'x'},content:[],isError:true}}};d.agent.session.events.push(stale);
 await f.service.observe(d.agent.session,stale);assert.equal(f.runs.entries().length,0,'events before admission are ignored');
 d.agent.session.seq=d.agent.session.events.length;const r={...d,turn:7,id:runId(task.id,T0)};assert.equal(await f.service.preStep(d.agent,{turn:7,messages:[d.message]}),true);
 await f.service.observe(d.agent.session,stale);
 await emit(f,r,'tool/result',{step:1,message:{role:'tool',toolCallId:'late',source:{kind:'tool',callId:'late'},content:[]}});
 await emit(f,r,'tool/call',{step:1,callId:'late',name:'web_fetch'});
 await f.service.observe(d.agent.session,{type:'turn/end',seq:99,data:{turn:6,reason:{kind:'completed'}}});assert.equal(f.runs.get(r.id).status,'running','another turn\'s end does not settle this Run');
 await end(f,r);const run=f.runs.get(r.id);assert.equal(run.status,'completed');assert.equal(run.toolError,false);assert.equal(run.activity.results,1);assert.equal(run.activity.calls,1);
});

test('tool error, cancellation, interruption, failure and a missing final reply settle truthfully',async()=>{
 const f=await fixture(),cases=[['tool',{answer:'有一个工具失败。'},'needs_review',/工具报告异常/u],['abort',{reason:'aborted'},'interrupted',/执行中断/u],['error',{reason:'error'},'failed',/执行失败/u],['silent',{answer:null},'needs_review',/没有可用的最终回复/u],['blank',{answer:'  '},'needs_review',/没有可用的最终回复/u]];
 for(const [name,how,status,label] of cases){
  const task=await f.service.create(f.owner,{...once,title:name}),r=await start(f,task,T0);
  if(name==='tool')await emit(f,r,'tool/result',{step:1,message:{role:'tool',toolCallId:'t',source:{kind:'tool',callId:'t'},content:[],isError:true}});
  await end(f,r,how);const run=f.runs.get(r.id);assert.equal(run.status,status,name);
  const note=f.notified.get('long-task:'+r.id);assert.match(note.text,label,name);assert.equal(note.kind,status==='completed'?'task_completed':'task_failed');
  if(name==='silent')assert.equal(run.review,'no_result');if(name==='tool')assert.equal(run.review,'tool_error');
 }
 const task=await f.service.create(f.owner,{...once,title:'cancel'}),r=await start(f,task,T0);
 await f.service.cancel(f.owner,{id:task.id,revision:1});assert.deepEqual(r.agent.cancelled,{kind:'user'},'native cancel reaches the per-run Session');assert.equal(f.schedules.has(task.scheduleId),false);
 await end(f,r,{reason:'aborted'});assert.equal(f.runs.get(r.id).status,'cancelled');assert.match(f.notified.get('long-task:'+r.id).text,/已取消/u);
 assert.throws(()=>f.service.taskAgent(r.agent),/Trusted independent/,'a cancelled task grants no tools');
});

test('restart: a running Run is settled once without replay; a queued receipt is admitted once',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,periodic);
 const a=await start(f,task,T0);await emit(f,a,'tool/call',{step:1,callId:'c',name:'web_fetch'});
 const queued=await f.host.schedule.deliver(task.scheduleId,T1);
 const restarted=await f.restart();
 assert.equal(f.runs.get(a.id).status,'interrupted');assert.equal(f.runs.get(a.id).reason,'restart_recovery');assert.match(f.notified.get('long-task:'+a.id).text,/执行中断，未自动重放/u);
 assert.equal(await restarted.preStep(a.agent,{turn:++turnSeq,messages:[a.message]}),false,'the uncertain occurrence is not replayed');
 assert.equal(await restarted.preStep(queued.agent,{turn:++turnSeq,messages:[queued.message]}),true,'native Schedule re-wakes the restored inbox; the Run is admitted once');
 const done={...queued,turn:turnSeq,id:runId(task.id,T1)};await end(f,done,{},restarted);assert.equal(f.runs.get(done.id).status,'completed');
 const again=await f.restart();assert.equal(finals(f).filter(e=>e.eventId==='long-task:'+a.id).length,1,'a settled Run is not renotified');
 const ended=await start(f,task,'2030-01-01T02:00:00.000Z',again);ended.agent.session.events.push({type:'turn/end',seq:5,data:{turn:ended.turn,reason:{kind:'completed'}}});
 const third=await f.restart();assert.equal(f.runs.get(ended.id).status,'needs_review','a turn that ended before the restart is settled from its own Session log');
 await third.close();
});

test('pending notification is retried with the same event id; unknown is never resent',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,periodic);
 f.setStatus('unknown');const a=await start(f,task,T0);await end(f,a);assert.equal(f.runs.get(a.id).notification,'unknown');
 f.setStatus('sent');const b=await start(f,task,T1);await f.runs.put(b.id,{...f.runs.get(b.id)});
 await end(f,b);await f.runs.put(b.id,{...f.runs.get(b.id),notification:'pending'});
 const before=f.sent.length;await f.restart();
 const resent=f.sent.slice(before);assert.deepEqual(resent.map(e=>e.eventId),['long-task:'+b.id],'only the pending row is handed over again, under its stable id');
});

test('concurrent tasks keep Runs, Sessions, activity and Conversation apart',async()=>{
 const clock=(()=>{let t=Date.parse(T0);const timers=new Set();return {now:()=>t,setTimeout(fn,ms){const h={at:t+ms,fn};timers.add(h);return h;},clearTimeout:h=>timers.delete(h),async advance(ms,s){const e=t+ms;for(;;){const [n]=[...timers].filter(h=>h.at<=e).sort((x,y)=>x.at-y.at);if(!n)break;t=n.at;timers.delete(n);n.fn();await s.serial(()=>{}).catch(()=>{});}t=e;await s.serial(()=>{}).catch(()=>{});},pending:()=>timers.size};})();
 const f=await fixture({clock,activity:{timeZone:'UTC'}});
 const one=await f.service.create(f.owner,{...once,title:'甲'}),two=await f.service.create(f.owner,{...once,title:'乙'});
 const a=await start(f,one,T0),b=await start(f,two,T0);assert.notEqual(a.agent.id,b.agent.id);
 await emit(f,a,'tool/call',{step:1,callId:'k',name:'tool_a'});await emit(f,b,'tool/call',{step:1,callId:'k',name:'tool_b'});
 await clock.advance(89_000,f.service);assert.equal(f.sent.length,0,'no report before 90 s');
 await clock.advance(1_000,f.service);const reports=f.sent.filter(e=>e.kind==='task_activity');assert.equal(reports.length,2);
 const ra=reports.find(e=>e.text.startsWith('[长期任务] 甲')),rb=reports.find(e=>e.text.startsWith('[长期任务] 乙'));
 assert(ra.eventId.startsWith(`long-task:${a.id}:activity:`));assert(rb.eventId.startsWith(`long-task:${b.id}:activity:`));
 assert.match(ra.text,/tool_a/u);assert.doesNotMatch(ra.text,/tool_b/u);assert.match(rb.text,/tool_b/u);assert.doesNotMatch(rb.text,/tool_a/u);
 await emit(f,b,'tool/result',{step:1,message:{role:'tool',toolCallId:'k',source:{kind:'tool',callId:'k'},content:[],isError:true}});await clock.advance(0,f.service);
 const alert=f.sent.filter(e=>e.kind==='task_activity').at(-1);assert(alert.eventId.startsWith(`long-task:${b.id}:activity:`));assert.match(alert.text,/检测到工具执行异常/u);
 await end(f,a);await end(f,b);assert.equal(clock.pending(),0,'timers are released with each Run');
 assert.deepEqual([f.runs.get(a.id).status,f.runs.get(b.id).status],['completed','needs_review']);
 assert(f.sent.every(e=>!/"token"|secret/u.test(e.text)),'no tool arguments or results');
});

test('untrusted Sessions and Hosts cannot execute, gain tools or notify',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,once),d=await f.host.schedule.deliver(task.scheduleId,T0);
 const ownerReceipt=f.owner;await assert.rejects(()=>f.service.preStep(ownerReceipt,{turn:1,messages:[d.message]}),/Trusted independent/,'the QQ Owner Session cannot run a task occurrence');
 const sub=f.makeAgent('session-sub','long-task',{parentSession:d.agent.id});await assert.rejects(()=>f.service.preStep(sub,{turn:1,messages:[d.message]}),/Trusted independent/,'a delegated Session is not a task root');
 const typed=f.makeAgent('session-ui','long-task');await assert.rejects(()=>f.service.preStep(typed,{turn:1,messages:[{id:'u',source:{kind:'user'},content:[{type:'text',text:instruction(task)}]}]}),/Trusted independent/,'a hand-made task-Preset Session with copied text');
 const fake={...d.agent};await assert.rejects(()=>f.service.preStep(fake,{turn:1,messages:[d.message]}),/Trusted independent/,'not the actual Host Agent object');
 assert.throws(()=>f.service.taskAgent(d.agent),/Trusted independent/,'an unadmitted Session has no task tools');
 const foreign=receiptMessage('m-foreign','schedule-unknown',T0,instruction(task));await assert.rejects(()=>f.service.preStep(d.agent,{turn:1,messages:[foreign]}),/Trusted independent/,'a Schedule this plugin does not own');
 assert.equal(await f.service.preStep(d.agent,{turn:1,messages:[receiptMessage(d.message.id,task.scheduleId,T0,instruction({...task,revision:2}))]}),false,'stale instruction');
 const row=f.tasks.get(task.id);await f.tasks.put(task.id,{...row,scope:{...row.scope,conversationId:'someone-else'}});
 await assert.rejects(()=>f.service.preStep(d.agent,{turn:2,messages:[d.message]}),/Foreign task conversation/,'unverifiable Conversation: no execution, no guessed QQ target');
 await f.tasks.put(task.id,row);f.schedules.get(task.scheduleId).target={kind:'new',create:{agentPreset:'qq-character',cwd:CWD}};
 assert.equal(await f.service.preStep(d.agent,{turn:3,messages:[d.message]}),false,'Schedule retargeted elsewhere: refused');
 f.schedules.get(task.scheduleId).target={kind:'new',create:{agentPreset:'long-task',cwd:CWD}};
 assert.equal(await f.service.preStep(d.agent,{turn:4,messages:[d.message]}),true);
 assert.equal(f.sent.length,0);assert.equal(f.runs.entries().length,1);
});

test('a Host without a Session creation provider refuses per-run tasks explicitly, arming nothing',async()=>{
 const f=await fixture({}, {controller:false});
 await assert.rejects(()=>f.service.create(f.owner,once),/cannot create a Session per task run/);
 assert.equal(f.tasks.entries().length,0);assert.equal(f.schedules.size,0);assert.equal(f.host.schedule.calls.length,0,'no fallback to a shared root or the QQ Session');
 const explicit=await f.service.create(f.owner,once,undefined,undefined,{sessionMode:'task-root'});assert.equal(explicit.delivery,undefined);assert.equal(typeof explicit.sessionId,'string','the historical root mode stays an explicit choice');
});

test('historical fixed-root tasks keep executing, updating, cancelling and recovering next to per-run tasks',async()=>{
 const f=await fixture(),legacy=await f.service.create(f.owner,periodic,undefined,undefined,{sessionMode:'task-root'});
 const service=await f.restart(),root=f.agents.get(legacy.sessionId);
 assert.equal(f.schedules.get(legacy.scheduleId).target.kind,'session');
 const fresh=await service.create(f.owner,once);assert.equal(fresh.delivery,'new','new tasks default to per-run Sessions');
 const msg=receiptMessage('legacy-1',legacy.scheduleId,T0,instruction(legacy));root.session.seq=0;
 assert.equal(await service.preStep(root,{turn:1,messages:[msg]}),true,'the historical root still executes its occurrence');
 root.session.events.push({type:'assistant/message',seq:1,data:{message:{content:[{type:'text',text:'旧任务结果'}]}}},{type:'turn/end',seq:2,data:{turn:1,reason:{kind:'completed'}}});
 await service.observe(root.session,root.session.events.at(-1));assert.equal(f.runs.get(runId(legacy.id,T0)).status,'completed');assert.equal(f.runs.get(runId(legacy.id,T0)).sessionId,legacy.sessionId);
 const updated=await service.update(f.owner,{id:legacy.id,revision:1,prompt:'查询并总结（新版）'});assert.equal(updated.revision,2);assert.deepEqual(f.schedules.get(legacy.scheduleId).target,{kind:'session',sessionId:legacy.sessionId});
 assert.equal(await service.preStep(root,{turn:2,messages:[receiptMessage('legacy-2',legacy.scheduleId,T1,instruction(updated))]}),true,'the next period of the same root');
 const restarted=await f.restart();assert.equal(f.runs.get(runId(legacy.id,T1)).status,'interrupted','restart recovery reads the root log');
 const listed=await restarted.list(f.owner);assert.equal(listed.find(t=>t.id===legacy.id).executionState,'active');assert.equal(listed.find(t=>t.id===fresh.id).executionState,'active');
 await restarted.cancel(f.owner,{id:legacy.id,revision:2});assert.equal(f.schedules.has(legacy.scheduleId),false);assert.deepEqual(root.cancelled,{kind:'user'});
});

test('per-run update keeps the new-Session target; creation interrupted after the native write reconciles by instruction',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,periodic);
 const updated=await f.service.update(f.owner,{id:task.id,revision:1,title:'新闻摘要'});assert.equal(updated.revision,2);
 const row=f.schedules.get(task.scheduleId);assert.deepEqual(row.target,{kind:'new',create:{agentPreset:'long-task',cwd:CWD}});assert.equal(row.record.prompt,instruction(updated));
 const r=await start(f,updated,T0);assert.equal(r.admitted,true);await end(f,r);assert.equal(f.notified.get('long-task:'+r.id).text.split('\n')[0],'[长期任务] 新闻摘要');
 row.target={kind:'new',create:{agentPreset:'long-task',cwd:'C:/elsewhere'}};assert.equal((await f.service.list(f.owner))[0].executionState,'schedule_mismatch');
 await assert.rejects(()=>f.service.update(f.owner,{id:task.id,revision:2,title:'x'}),/Schedule ended/);
 const other=await f.service.create(f.owner,once);await f.service.create(f.owner,{...once,title:'第三'});
 await f.tasks.put(other.id,{...f.tasks.get(other.id),state:'creating',scheduleId:undefined});await f.restart();
 assert.equal(f.tasks.get(other.id).state,'active');assert.equal(f.tasks.get(other.id).scheduleId,other.scheduleId,'matched by its own instruction among several new-Session rows');
});
