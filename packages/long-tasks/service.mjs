import {randomUUID} from 'node:crypto';
import {changeSelector,instruction,nativeTiming,occurrences,runId,targetSession,timingSelector} from './state.mjs';
import {FIRST_REPORT_MS,REPORT_INTERVAL_MS,activityText,emptyActivity,foldActivity,reportDue,reportMarker,toolFailed,unreported} from './activity.mjs';
const terminal=new Set(['completed','failed','interrupted','cancelled','needs_review']);
const text=m=>m?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')??'';
// Instructions rebound by the pre-0.2.2 overdue recovery carry this suffix in
// retained Schedule rows. Historical data only; nothing writes it any more.
const unbound=prompt=>typeof prompt==='string'?prompt.replace(/\n\[HOST BINDING [0-9a-f-]{36}\]$/u,''):prompt;
const stopped=task=>!task||['cancelled','cancelling','failed'].includes(task.state);
const missed=result=>!result||typeof result!=='object'||'code' in result;
const actorOf=agent=>agent?.session?.id??agent?.id;
// Three separate facts per run, derived for display; stored rows are unchanged.
// execution: how the Agent turn settled. goalVerification: no independent
// verifier exists, so a settled run is never reported as goal-achieved.
// delivery: the Outbox row for the run's stable event id (API acceptance at
// most; never proof the user read it). With no row in the current Owner
// Conversation's Outbox (never enqueued, or recorded elsewhere) it is
// 'unrecorded' and the run's last reported status is kept beside it.
function runView(identity,scope,run){
 const eventId='long-task:'+run.id,settled=terminal.has(run.status);
 const record=identity.notificationRecord?.(scope,eventId)??null;
 const status=record?.status??identity.notificationStatus?.(scope,eventId)??null;
 const delivery=!settled?{eventId,status:status??'not-due',attention:null}
  :status?{eventId,status,enqueuedAt:record?.at??null,attention:record?.attention??null,...(record?.held?{held:record.held}:{})}
  :{eventId,status:'unrecorded',lastReported:run.notification??null,enqueuedAt:null,attention:'unrecorded'};
 return {...run,notification:status??run.notification,execution:run.status,goalVerification:settled?'unverified':'pending',delivery};
}
export class LongTasks {
 constructor(host,{presetId='long-task',allowTools=[],activity={},clock={}}={}){this.h=host;this.presetId=presetId;this.allowTools=allowTools;
  // Activity reports: one bounded timer per running run, in memory only. A
  // restart settles every running run (recover), so no timer is ever rebuilt.
  this.activity={firstMs:activity.firstMs??FIRST_REPORT_MS,intervalMs:activity.intervalMs??REPORT_INTERVAL_MS};
  this.clock={now:clock.now??Date.now,setTimeout:clock.setTimeout??setTimeout,clearTimeout:clock.clearTimeout??clearTimeout};this.timers=new Map();this.chain=Promise.resolve();this.active=new Map();this.closed=false;this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});this.ready.catch(()=>{});}
 serial(fn){const p=this.chain.then(()=>{if(this.closed)throw Error('Long tasks disabled');return fn();});this.chain=p.catch(()=>{});return p;}
 owner(agent){if(this.h.agents.get(agent?.id)!==agent)throw Error('Actual Host Agent required');const c=this.h.identity.forSession(agent.id);return this.h.identity.authorize(c,'write');}
 scoped(task,scope){if(!task||['principalId','characterId','projectId','conversationId'].some(k=>task.scope[k]!==scope[k]))throw Error('Task not found in authorized scope');return task;}
 async create(agent,args,signal,operationId){await this.ready;return this.serial(async()=>{
  const scope=this.owner(agent);
  signal?.throwIfAborted();this.h.identity.validateConversation(scope);
  if(typeof args.title!=='string'||!args.title.trim()||args.title.length>120||typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>8000)throw Error('Task title and bounded instruction required');
  const route={provider:agent.options.provider,model:agent.options.model};if(!route.provider||!route.model)throw Error('Explicit resolved task model required');
  const id='task-'+(operationId?runId(agent.id,String(operationId)):randomUUID()),timing=timingSelector(args);
  const existing=this.h.tasks.get(id);if(existing){this.scoped(existing,scope);if(existing.title!==args.title.trim()||existing.prompt!==args.prompt.trim()||JSON.stringify(existing.timing)!==JSON.stringify(timing))throw Error('Task operation id conflict');return existing;}
  const task={id,sessionId:randomUUID(),presetId:this.presetId,title:args.title.trim(),prompt:args.prompt.trim(),timing,revision:1,state:'creating',scope:{principalId:scope.principalId,characterId:scope.characterId,projectId:scope.projectId,conversationId:scope.conversationId},route,createdAt:new Date().toISOString()};
  await this.h.tasks.put(task.id,task);
  try{
   const handle=await this.h.createRoot(task);if(!await this.h.flush(handle.agent.session))throw Error('Task root was not durably saved');
   // Fixed target: the task's own independent root. The acting Owner Session is
   // only the actor that DSH records as involved, never the delivery target.
   const record=await this.h.schedule.create({title:task.title,prompt:instruction(task),timing:nativeTiming(timing),target:{kind:'session',sessionId:task.sessionId}},actorOf(agent),signal);
   const next={...task,state:'active',scheduleId:record.id};await this.h.tasks.put(task.id,next);return next;
  }catch(error){await this.h.tasks.put(task.id,{...task,state:'failed',error:'create_incomplete'});throw error;}
 });}
 async list(agent){await this.ready;return this.serial(async()=>{
  const scope=this.owner(agent);
  const catalog=await this.h.schedule.catalog();
  const byTask=new Map();for(const [,run]of this.h.runs.entries()){const rows=byTask.get(run.taskId)??[];rows.push(run);byTask.set(run.taskId,rows);}
  const state=(t,schedule)=>t.state!=='active'||!schedule?t.state:targetSession(schedule)!==t.sessionId?'schedule_mismatch':schedule.status==='ended'?'ended':schedule.status==='paused'?'paused':t.state;
  return [...this.h.tasks.entries()].map(([,t])=>t).filter(t=>['principalId','characterId','projectId','conversationId'].every(k=>t.scope[k]===scope[k])).map(t=>{const schedule=catalog.find(s=>s.id===t.scheduleId),all=(byTask.get(t.id)??[]).map(r=>runView(this.h.identity,t.scope,r)),runs=all.slice(-20);
   // Attention covers every run, not only the 20 shown: an older uncertain or
   // never-enqueued notification must stay visible. Ids, times and states only.
   const deliveryAttention=all.filter(r=>r.delivery.attention).slice(-20).map(r=>({runId:r.id,occurrenceAt:r.occurrenceAt,endedAt:r.endedAt??null,execution:r.execution,...r.delivery}));
   return {...t,schedule,executionState:all.some(r=>r.status==='running')?'running':state(t,schedule),runs,deliveryAttention};});
 });}
 async update(agent,{id,revision,title,prompt,change},signal){await this.ready;return this.serial(async()=>{
  signal?.throwIfAborted();
  const scope=this.owner(agent);
  const task=this.scoped(this.h.tasks.get(id),scope);if(task.revision!==revision)throw Error('Task revision conflict');if(task.state!=='active')throw Error('Only active schedules can be modified; create a new task to rerun ended work');
  if((title!==undefined&&(typeof title!=='string'||!title.trim()||title.length>120))||(prompt!==undefined&&(typeof prompt!=='string'||!prompt.trim()||prompt.length>8000)))throw Error('Invalid replacement content');
  const selector=change===undefined?undefined:changeSelector(change);
  const current=await this.scheduleOf(task);
  if(!current||current.status!=='active'||targetSession(current)!==task.sessionId)throw Error('Schedule ended; create a new task');
  const pending={...task,title:title?.trim()??task.title,prompt:prompt?.trim()??task.prompt,timing:selector??task.timing,revision:revision+1};
  await this.h.tasks.put(id,{...task,state:'updating',pending});
  // CAS on the observed row; a v1 row without updatedAt compares as null.
  try{const result=await this.h.schedule.edit({id:task.scheduleId,action:'update',expectedUpdatedAt:current.updatedAt??null,patch:{title:pending.title,prompt:instruction(pending),...(selector?{timing:nativeTiming(selector)}:{})}},actorOf(agent),signal);if(missed(result))throw Error('Schedule update rejected: '+(result?.code??'unknown'));await this.h.tasks.put(id,pending);return pending;}
  catch(error){await this.reconcile(task.id);throw error;}
 });}
 async cancel(agent,{id,revision},signal){await this.ready;return this.serial(async()=>{
  signal?.throwIfAborted();
  const scope=this.owner(agent);
  const task=this.scoped(this.h.tasks.get(id),scope);if(task.revision!==revision)throw Error('Task revision conflict');
  const cancelling={...task,state:'cancelling',revision:revision+1};await this.h.tasks.put(id,cancelling);
  await this.removeSchedule(task,actorOf(agent),signal);
  this.disarm(task.sessionId);this.h.agents.get(task.sessionId)?.cancel({kind:'user'});
  const cancelled={...cancelling,state:'cancelled'};await this.h.tasks.put(id,cancelled);return cancelled;
 });}
 taskAgent(agent){if(this.closed)throw Error('Long tasks disabled');const task=[...this.h.tasks.entries()].map(([,t])=>t).find(t=>t.sessionId===agent?.id);if(!task||this.h.agents.get(agent.id)!==agent||this.h.presetOf(agent)!==task.presetId||agent.session.header.parentSession||['cancelled','cancelling','failed'].includes(task.state))throw Error('Trusted independent task root required');this.h.identity.validateConversation(task.scope);return task;}
 async preStep(agent,event){await this.ready;return this.serial(async()=>{
  const task=this.taskAgent(agent),current=this.active.get(agent.id);
  // Same turn: a new occurrence cannot join the running one. A DSH 0.2.2 change
  // notice is not an occurrence; unsupported framing still rejects the step.
  if(current?.turn===event.turn){try{return occurrences(event.messages??[]).length===0;}catch{return false;}}
  if(task.state!=='active')return false;
  const receipts=occurrences(event.messages??[]);if(!receipts.length)return false;
  const unique=new Map(receipts.map(r=>[runId(task.id,r.occurrence_at),r]));
  // One task root executes one occurrence per turn. No silent batching of goals.
  if(unique.size!==1)throw Error('Multiple occurrences require operator review');
  const [id,receipt]=[...unique][0];
  const admittedPrompt=unbound(receipt.reminder_prompt);
  if(receipt.schedule_id!==task.scheduleId||admittedPrompt!==instruction(task))return false;
  if(this.h.runs.get(id))return false;
  const run={id,taskId:task.id,sessionId:agent.id,status:'running',occurrenceAt:receipt.occurrence_at,turn:event.turn,startSeq:agent.session.seq??0,revision:task.revision,title:task.title,startedAt:new Date(this.clock.now()).toISOString(),toolError:false,activity:emptyActivity()};
  await this.h.runs.put(id,run);this.active.set(agent.id,run);this.arm(agent.id,run);return true;
 });}
 observe(session,event){return this.serial(async()=>{
  const run=this.active.get(session.header.id);if(!run)return;
  if(event.type!=='turn/end'&&foldActivity(run,event,new Date(this.clock.now()).toISOString()))this.arm(session.header.id,run);
  if(event.type==='tool/result'&&toolFailed(event.data)&&!run.toolError){run.toolError=true;await this.h.runs.put(run.id,run);}
  if(event.type==='turn/end'&&event.data.turn===run.turn){
   this.disarm(session.header.id);
   const events=typeof session.snapshotEvents==='function'?session.snapshotEvents():session.events??[];
   const messages=events.filter(e=>e.type==='assistant/message'&&(e.seq??0)>=run.startSeq).map(e=>e.data?.message??e.data),answer=text(messages.at(-1));
   const task=this.h.tasks.get(run.taskId),reason=event.data.reason?.kind;
   const status=task.state==='cancelled'||task.state==='cancelling'?'cancelled':reason==='completed'?(run.toolError?'needs_review':'completed'):reason==='aborted'||reason==='interrupted'?'interrupted':'failed';
   const settled={...run,status,reason:reason??'unknown',result:answer.slice(0,2200),endedAt:new Date().toISOString(),notification:'pending'};
   await this.h.runs.put(run.id,settled);this.active.delete(session.header.id);await this.notify(task,settled);
  }
 });}
 // One pending timer per running run, at the earliest due report. Fires into
 // the serial chain; the run, task and coverage are re-checked there.
 arm(sessionId,run){
  if(this.closed||!unreported(run))return;
  const due=reportDue(run,this.activity),current=this.timers.get(sessionId);
  if(current&&current.run===run&&current.due<=due)return;
  this.disarm(sessionId);
  const handle=this.clock.setTimeout(()=>{if(this.timers.get(sessionId)?.handle!==handle)return;this.timers.delete(sessionId);void this.serial(()=>this.report(sessionId,run)).catch(()=>{});},Math.max(0,due-this.clock.now()));
  handle?.unref?.();this.timers.set(sessionId,{handle,due,run});
 }
 disarm(sessionId){const t=this.timers.get(sessionId);if(t){this.clock.clearTimeout(t.handle);this.timers.delete(sessionId);}}
 // A non-terminal activity notification through the same Outbox. The marker is
 // written first: a crash before the enqueue loses one report, never repeats
 // it. The id names the last native event covered, so a report can never be
 // re-created for the same activity. Delivery never changes the run.
 async report(sessionId,run){
  if(this.active.get(sessionId)!==run||!unreported(run))return;
  const task=this.h.tasks.get(run.taskId);if(stopped(task))return;
  const now=this.clock.now();if(now<reportDue(run,this.activity))return this.arm(sessionId,run);
  const eventId='long-task:'+run.id+':activity:'+(run.activity?.seq??'start'),text=activityText(run.title??task.title,run,now).slice(0,2900);
  run.report=reportMarker(run,new Date(now).toISOString(),eventId);if(run.activity)run.activity.recent=[];
  await this.h.runs.put(run.id,run);
  // Enqueue is synchronous inside notifyConversation; the send is not awaited here.
  try{void Promise.resolve(this.h.identity.notifyConversation(task.scope,{eventId,kind:'task_activity',text})).catch(()=>this.h.warn?.('Long task activity notification not recorded; the run is unchanged'));}
  catch{this.h.warn?.('Long task activity notification not recorded; the run is unchanged');}
 }
 async notify(task,run){
  if(!terminal.has(run.status))return;
  const kind=run.status==='completed'?'task_completed':'task_failed';
  const labels={completed:'本轮执行结束（不等同于目标已独立验收）',needs_review:'执行结束，工具报告异常，待检查',failed:'执行失败',interrupted:'执行中断，未自动重放',cancelled:'已取消'};
  const result=await this.h.identity.notifyConversation(task.scope,{eventId:'long-task:'+run.id,kind,text:`[长期任务] ${run.title??task.title}\n${labels[run.status]}\n${run.result??''}`.slice(0,2900)});
  await this.h.runs.put(run.id,{...run,notification:result.status});
 }
 // DSH 0.2.2 view(): the entry, or a miss with `code`.
 async scheduleOf(task){if(!task.scheduleId)return undefined;const row=await this.h.schedule.view({id:task.scheduleId});return missed(row)?undefined:row;}
 // Stop future delivery. An already-removed task is the goal state, not a failure.
 async removeSchedule(task,actor,signal){
  if(!task.scheduleId)return;
  const result=await this.h.schedule.edit({id:task.scheduleId,action:'delete'},actor,signal);
  if(result?.deleted!==true&&result?.code!=='schedule_not_found')throw Error('Schedule delete failed: '+(result?.code??'unknown'));
 }
 async reconcile(id){
  const task=this.h.tasks.get(id);this.h.identity.validateConversation(task.scope);
  // Only rows whose fixed target is this task's own root can belong to it.
  const records=(await this.h.schedule.catalog()).filter(s=>targetSession(s)===task.sessionId),match=records.find(s=>unbound(s.prompt)===instruction(task.pending??task));
  if(task.state==='updating'){
   if(match)await this.h.tasks.put(id,{...task.pending,state:'active',scheduleId:match.id});
   else if(records.some(s=>unbound(s.prompt)===instruction(task))) {const {pending,...old}=task;await this.h.tasks.put(id,{...old,state:'active'});}
   else await this.h.tasks.put(id,{...task,state:'failed',error:'update_state_unknown'});
  }else if(task.state==='creating'||task.error==='create_incomplete'){
   if(records.length===1&&match)await this.h.tasks.put(id,{...task,state:'active',scheduleId:match.id});
   else await this.h.tasks.put(id,{...task,state:'failed',error:'create_state_unknown'});
  }else if(task.state==='cancelling'){
   await this.removeSchedule(task,undefined);await this.h.tasks.put(id,{...task,state:'cancelled'});
  }
 }
 recover(){const recovery=this.serial(async()=>{
  for(const [,task]of this.h.tasks.entries())await this.reconcile(task.id);
  for(const [,run]of this.h.runs.entries()){
   const task=this.h.tasks.get(run.taskId);if(!task)throw Error('Orphan task run');this.h.identity.validateConversation(task.scope);
   if(run.status==='running'){
    const log=await this.h.load(task.sessionId),end=(log.events??[]).find(e=>e.type==='turn/end'&&e.data.turn===run.turn);
    const next={...run,status:end?.data.reason?.kind==='completed'?'needs_review':'interrupted',reason:'restart_recovery',endedAt:new Date().toISOString(),notification:'pending'};await this.h.runs.put(run.id,next);await this.notify(task,next);
   }else if(run.notification==='pending')await this.notify(task,run);
  }
  // Overdue work: DSH 0.2.2 Schedule resumes due tasks itself (latest-only
  // catch-up, restored-inbox recovery). The occurrence ledger above still
  // rejects any repeat execution; no rebind, timer or replay queue here.
 });recovery.then(this.resolveReady,this.rejectReady);return recovery;}
 async close(){this.closed=true;for(const id of [...this.timers.keys()])this.disarm(id);this.rejectReady(Error('Long tasks disabled'));await this.chain;this.active.clear();}
}
