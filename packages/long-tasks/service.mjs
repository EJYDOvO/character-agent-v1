import {randomUUID} from 'node:crypto';
import {changeSelector,deliveredRevision,instruction,nativeTiming,occurrences,ownsTarget,pendingMessageIds,perRun,runId,taskTarget,timingSelector} from './state.mjs';
import {FIRST_REPORT_MS,REPORT_INTERVAL_MS,activityText,emptyActivity,foldActivity,reportDue,reportMarker,unreported} from './activity.mjs';
const terminal=new Set(['completed','failed','interrupted','cancelled','needs_review']);
const text=m=>m?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')??'';
// Instructions rebound by the pre-0.2.2 overdue recovery carry this suffix in
// retained Schedule rows. Historical data only; nothing writes it any more.
const unbound=prompt=>typeof prompt==='string'?prompt.replace(/\n\[HOST BINDING [0-9a-f-]{36}\]$/u,''):prompt;
const stopped=task=>!task||['cancelled','cancelling','failed'].includes(task.state);
const missed=result=>!result||typeof result!=='object'||'code' in result;
const actorOf=agent=>agent?.session?.id??agent?.id;
// Per-run Sessions bound in one Host process before new occurrences are refused (see residentCount).
export const RUN_SESSION_BUDGET=1000;
// Newest native deliveries of a per-run task checked for an unexecuted receipt after a restart.
const ORPHAN_SCAN=20;
// Why a consumed, trusted delivery did not execute (run.executed === false).
const UNEXECUTED={stale_revision:'未执行：投递的是旧版本指令（任务已修改），待检查',unverified_delivery:'未执行：无法核实这次投递，待检查',task_unavailable:'未执行：任务当前不可执行，待检查',restart_unclaimed:'未执行：Host 重启前已投递但尚未开始执行，未自动补跑'};
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
 constructor(host,{presetId='long-task',allowTools=[],activity={},clock={},sessionMode='per-run',cwd,runSessionBudget=RUN_SESSION_BUDGET}={}){this.h=host;this.presetId=presetId;this.allowTools=allowTools;
  if(!Number.isSafeInteger(runSessionBudget)||runSessionBudget<1)throw Error('Invalid run Session budget');
  this.runSessionBudget=runSessionBudget;this.resident=new Set();this.budgetNotified=new Set();
  // New tasks: one native Session per occurrence (`per-run`, default) or the
  // historical fixed task root (`task-root`, explicit compatibility choice).
  if(!['per-run','task-root'].includes(sessionMode))throw Error('Invalid task Session mode');
  this.sessionMode=sessionMode;this.cwd=cwd;
  // Activity reports: one bounded timer per running run, in memory only. A
  // restart settles every running run (recover), so no timer is ever rebuilt.
  this.activity={firstMs:activity.firstMs??FIRST_REPORT_MS,intervalMs:activity.intervalMs??REPORT_INTERVAL_MS,timeZone:activity.timeZone};
  this.clock={now:clock.now??Date.now,setTimeout:clock.setTimeout??setTimeout,clearTimeout:clock.clearTimeout??clearTimeout};this.timers=new Map();this.chain=Promise.resolve();this.active=new Map();this.closed=false;this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});this.ready.catch(()=>{});}
 serial(fn){const p=this.chain.then(()=>{if(this.closed)throw Error('Long tasks disabled');return fn();});this.chain=p.catch(()=>{});return p;}
 owner(agent){if(this.h.agents.get(agent?.id)!==agent)throw Error('Actual Host Agent required');const c=this.h.identity.forSession(agent.id);return this.h.identity.authorize(c,'write');}
 scoped(task,scope){if(!task||['principalId','characterId','projectId','conversationId'].some(k=>task.scope[k]!==scope[k]))throw Error('Task not found in authorized scope');return task;}
 // options.sessionMode: Host-internal override (compatibility tests); the
 // model tool never passes it.
 async create(agent,args,signal,operationId,{sessionMode=this.sessionMode}={}){await this.ready;return this.serial(async()=>{
  const scope=this.owner(agent);
  signal?.throwIfAborted();this.h.identity.validateConversation(scope);
  if(typeof args.title!=='string'||!args.title.trim()||args.title.length>120||typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>8000)throw Error('Task title and bounded instruction required');
  const route={provider:agent.options.provider,model:agent.options.model};if(!route.provider||!route.model)throw Error('Explicit resolved task model required');
  const id='task-'+(operationId?runId(agent.id,String(operationId)):randomUUID()),timing=timingSelector(args);
  const existing=this.h.tasks.get(id);if(existing){this.scoped(existing,scope);if(existing.title!==args.title.trim()||existing.prompt!==args.prompt.trim()||JSON.stringify(existing.timing)!==JSON.stringify(timing))throw Error('Task operation id conflict');return existing;}
  if(!['per-run','task-root'].includes(sessionMode))throw Error('Invalid task Session mode');
  // Per-run Sessions are created by native Schedule through the Host's Session
  // creation provider. Without it the task is refused: never a silent fallback
  // to a shared root or to the QQ Session.
  if(sessionMode==='per-run'&&(typeof this.cwd!=='string'||!this.cwd||this.h.canCreateSessions?.()!==true))throw Error('This Host cannot create a Session per task run (native sessionController unavailable); long task not created');
  const base={id,presetId:this.presetId,title:args.title.trim(),prompt:args.prompt.trim(),timing,revision:1,state:'creating',scope:{principalId:scope.principalId,characterId:scope.characterId,projectId:scope.projectId,conversationId:scope.conversationId},route,createdAt:new Date().toISOString()};
  const task=sessionMode==='per-run'?{...base,delivery:'new',cwd:this.cwd}:{...base,sessionId:randomUUID()};
  await this.h.tasks.put(task.id,task);
  try{
   if(!perRun(task)){const handle=await this.h.createRoot(task);if(!await this.h.flush(handle.agent.session))throw Error('Task root was not durably saved');}
   // The target is the task's own destination: a fresh task-Preset Session per
   // occurrence, or the historical fixed root. The acting Owner Session is only
   // the actor that DSH records as involved, never the delivery target.
   const record=await this.h.schedule.create({title:task.title,prompt:instruction(task),timing:nativeTiming(timing),target:taskTarget(task)},actorOf(agent),signal);
   const next={...task,state:'active',scheduleId:record.id};await this.h.tasks.put(task.id,next);return next;
  }catch(error){await this.h.tasks.put(task.id,{...task,state:'failed',error:'create_incomplete'});throw error;}
 });}
 async list(agent){await this.ready;return this.serial(async()=>{
  const scope=this.owner(agent);
  const catalog=await this.h.schedule.catalog();
  const byTask=new Map();for(const [,run]of this.h.runs.entries()){const rows=byTask.get(run.taskId)??[];rows.push(run);byTask.set(run.taskId,rows);}
  const state=(t,schedule)=>t.state!=='active'||!schedule?t.state:!ownsTarget(t,schedule)?'schedule_mismatch':schedule.status==='ended'?'ended':schedule.status==='paused'?'paused':t.state;
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
  if(!current||current.status!=='active'||!ownsTarget(task,current))throw Error('Schedule ended; create a new task');
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
  // Every running Session of this task: its root, or each per-run Session.
  const sessions=new Set([...this.active].filter(([,run])=>run.taskId===task.id).map(([id])=>id));if(task.sessionId)sessions.add(task.sessionId);
  for(const id of sessions){this.disarm(id);this.h.agents.get(id)?.cancel({kind:'user'});}
  const cancelled={...cancelling,state:'cancelled'};await this.h.tasks.put(id,cancelled);return cancelled;
 });}
 // The task a Session is bound to: the running run's task, a historical task
 // root, or the per-run task whose run (running or settled) owns this Session.
 // Binding is established only by a persisted pre-step decision (admitRun or
 // settleUnexecuted). Session -> task is indexed in memory so a pre-step does
 // not scan the whole, ever-growing run ledger.
 boundTask(sessionId){
  if(!sessionId)return undefined;
  const run=this.active.get(sessionId);if(run)return this.h.tasks.get(run.taskId);
  const tasks=[...this.h.tasks.entries()].map(([,t])=>t),root=tasks.find(t=>!perRun(t)&&t.sessionId===sessionId);if(root)return root;
  const taskId=this.sessionIndex().get(sessionId),task=taskId&&this.h.tasks.get(taskId);
  return perRun(task)?task:undefined;
 }
 sessionIndex(){if(!this.index){this.index=new Map();for(const [,r]of this.h.runs.entries())this.index.set(r.sessionId,r.taskId);}return this.index;}
 async putNewRun(run){await this.h.runs.put(run.id,run);this.sessionIndex().set(run.sessionId,run.taskId);if(perRun(this.h.tasks.get(run.taskId)))this.resident.add(run.sessionId);}
 // Independent task Session: the actual Host Agent, composed with the task
 // Preset, a root (no parent, not delegated), never an Owner or QQ Session.
 trustedRoot(agent,presetId){return !!agent&&this.h.agents.get(agent.id)===agent&&this.h.presetOf(agent)===presetId&&!agent.session?.header?.parentSession&&!(agent.session?.header?.delegationDepth>0);}
 taskAgent(agent){if(this.closed)throw Error('Long tasks disabled');const task=this.boundTask(agent?.id);if(!task||!this.trustedRoot(agent,task.presetId)||['cancelled','cancelling','failed'].includes(task.state))throw Error('Trusted independent task root required');this.h.identity.validateConversation(task.scope);return task;}
 // Per-run Sessions this Host process bound and still holds. DSH 0.2.2-rc.1
 // offers no public way to release them, so they stay resident until restart.
 residentCount(){for(const id of this.resident)if(!this.h.agents.get(id))this.resident.delete(id);return this.resident.size;}
 async preStep(agent,event){await this.ready;return this.serial(async()=>{
  if(this.closed)throw Error('Long tasks disabled');
  // A Session native Schedule created for one occurrence is unbound until its
  // run is admitted here.
  if(!this.boundTask(agent?.id))return this.admitRun(agent,event);
  const task=this.taskAgent(agent),current=this.active.get(agent.id);
  // Same turn: a new occurrence cannot join the running one. A DSH 0.2.2 change
  // notice is not an occurrence; unsupported framing still rejects the step.
  if(current?.turn===event.turn){try{return occurrences(event.messages??[]).length===0;}catch{return false;}}
  // One per-run Session executes exactly one run; a later turn there (a typed
  // message, a duplicate delivery) grants nothing.
  if(perRun(task))return false;
  if(task.state!=='active')return false;
  const receipts=occurrences(event.messages??[]);if(!receipts.length)return false;
  const unique=new Map(receipts.map(r=>[runId(task.id,r.occurrence_at),r]));
  // One task root executes one occurrence per turn. No silent batching of goals.
  if(unique.size!==1)throw Error('Multiple occurrences require operator review');
  const [id,receipt]=[...unique][0];
  const admittedPrompt=unbound(receipt.reminder_prompt);
  if(receipt.schedule_id!==task.scheduleId)return false;
  if(this.h.runs.get(id))return false;
  if(admittedPrompt!==instruction(task)){
   // The native receipt of an earlier revision of this task, consumed by the
   // turn: settle it, never execute the superseded instruction.
   const rev=deliveredRevision(task,admittedPrompt);
   if(rev!==undefined&&rev<task.revision)await this.settleUnexecuted(task,{sessionId:agent.id,messageId:receipt.messageId,occurrenceAt:receipt.occurrence_at,revision:rev},{status:'needs_review',review:'stale_revision'});
   return false;
  }
  const run={id,taskId:task.id,sessionId:agent.id,status:'running',occurrenceAt:receipt.occurrence_at,turn:event.turn,startSeq:agent.session.seq??0,revision:task.revision,title:task.title,startedAt:new Date(this.clock.now()).toISOString(),toolError:false,activity:emptyActivity()};
  await this.putNewRun(run);this.active.set(agent.id,run);this.arm(agent.id,run);return true;
 });}
 /**
  * Admit the first step of a Session that native Schedule created for one
  * occurrence of a per-run task (target kind `new`). Runs inside the serial
  * chain. The DSH agent loop has already claimed the receipt out of the
  * Session's durable inbox, and a rejected step does not return it, so every
  * trusted receipt is either executed or settled here; none is dropped.
  *
  * Trust (all required, else refused with no ledger row): the actual Host
  * Agent, a root composed with the task Preset; exactly one Host Schedule
  * receipt (producer kind `schedule`) naming a per-run task's own Schedule,
  * with that task's instruction header at a revision it has had; a native view
  * in which that Schedule still delivers to a new task-Preset Session in the
  * task directory, and whose lastDelivery, when it is this message, names this
  * Session.
  *
  * Execution additionally needs the current revision of an active task, no
  * earlier run of this occurrence, and room in the resident-Session budget.
  * A trusted receipt that fails only these is settled unexecuted (cancelled /
  * needs_review) and notified. The run row is persisted before the step may
  * proceed.
  */
 async admitRun(agent,event){
  const refuse=()=>{throw Error('Trusted independent task root required');};
  if(!this.trustedRoot(agent,this.presetId))refuse();
  const receipts=occurrences(event.messages??[]);if(!receipts.length)refuse();
  const unique=new Map(receipts.map(r=>[r.schedule_id+'\n'+r.occurrence_at,r]));
  if(unique.size!==1)throw Error('Multiple occurrences require operator review');
  const [receipt]=unique.values();
  const task=[...this.h.tasks.entries()].map(([,t])=>t).find(t=>perRun(t)&&t.scheduleId===receipt.schedule_id);
  if(!task||task.presetId!==this.presetId)refuse();
  this.h.identity.validateConversation(task.scope);
  const rev=deliveredRevision(task,receipt.reminder_prompt);
  if(rev===undefined||rev>task.revision||rev===task.revision&&receipt.reminder_prompt!==instruction(task))return false;
  const id=runId(task.id,receipt.occurrence_at);if(this.h.runs.get(id))return false;
  const delivery={sessionId:agent.id,messageId:receipt.messageId,occurrenceAt:receipt.occurrence_at,revision:rev};
  let entry;try{entry=await this.scheduleOf(task);}catch{entry=null;}
  // Re-read after the await: the task may have been cancelled or changed.
  const now=this.h.tasks.get(task.id);
  if(this.closed||this.h.runs.get(id)||this.boundTask(agent.id)||!this.trustedRoot(agent,task.presetId))return false;
  const stopped=['cancelled','cancelling'].includes(now?.state);
  if(entry===null)return this.settleUnexecuted(now,delivery,stopped?{status:'cancelled'}:{status:'needs_review',review:'unverified_delivery'}).then(()=>false);
  if(entry===undefined&&!stopped)return this.settleUnexecuted(now,delivery,{status:'needs_review',review:'unverified_delivery'}).then(()=>false);
  if(entry){
   if(!ownsTarget(now,entry))return false;
   const last=entry.lastDelivery;if(last?.messageId===receipt.messageId&&last.targetSessionId!==agent.id)return false;
  }
  if(stopped)return this.settleUnexecuted(now,delivery,{status:'cancelled'}).then(()=>false);
  if(now.state!=='active')return this.settleUnexecuted(now,delivery,{status:'needs_review',review:'task_unavailable'}).then(()=>false);
  if(rev<now.revision||receipt.reminder_prompt!==instruction(now))return this.settleUnexecuted(now,delivery,{status:'needs_review',review:'stale_revision'}).then(()=>false);
  if(this.residentCount()>=this.runSessionBudget)return this.settleUnexecuted(now,delivery,{status:'needs_review',review:'session_budget'}).then(()=>false);
  const run={id,taskId:task.id,sessionId:agent.id,scheduleId:task.scheduleId,messageId:receipt.messageId,status:'running',occurrenceAt:receipt.occurrence_at,turn:event.turn,startSeq:agent.session.seq??0,revision:task.revision,title:task.title,startedAt:new Date(this.clock.now()).toISOString(),toolError:false,activity:emptyActivity()};
  await this.putNewRun(run);this.active.set(agent.id,run);this.arm(agent.id,run);return true;
 }
 /**
  * Record a trusted delivery that was consumed but not executed as a terminal
  * run (executed:false), bind its Session, and notify through the Outbox. It
  * is never `completed`, never re-delivered, and its occurrence cannot run
  * later (same Run ID). A budget refusal is notified once per task per Host
  * process; later ones are recorded with notification 'suppressed' and stay
  * visible as delivery attention.
  */
 async settleUnexecuted(task,{sessionId,messageId,occurrenceAt,revision},{status,review,reason}){
  const id=runId(task.id,occurrenceAt);if(this.h.runs.get(id))return;
  const at=new Date(this.clock.now()).toISOString();
  const quiet=review==='session_budget'&&this.budgetNotified.has(task.id);if(review==='session_budget')this.budgetNotified.add(task.id);
  const run={id,taskId:task.id,sessionId,...(task.scheduleId?{scheduleId:task.scheduleId}:{}),...(messageId?{messageId}:{}),status,...(review?{review}:{}),executed:false,reason:reason??review??'cancelled_before_start',occurrenceAt,revision:revision??task.revision,title:task.title,endedAt:at,result:'',notification:quiet?'suppressed':'pending'};
  await this.putNewRun(run);
  if(!quiet)await this.notify(task,run);
 }
 observe(session,event){return this.serial(async()=>{
  const run=this.active.get(session.header.id);if(!run)return;
  // One ownership rule for activity and execution state: foldActivity accepts
  // only a new event of this run's turn after its admission, so an earlier
  // occurrence's result, a replay or an event without a log position changes
  // neither the counters nor run.toolError.
  const change=event.type==='turn/end'?false:foldActivity(run,event,new Date(this.clock.now()).toISOString());
  if(change)this.arm(session.header.id,run);
  if(change==='error'&&!run.toolError){run.toolError=true;await this.h.runs.put(run.id,run);}
  if(event.type==='turn/end'&&event.data.turn===run.turn){
   this.disarm(session.header.id);
   const events=typeof session.snapshotEvents==='function'?session.snapshotEvents():session.events??[];
   const messages=events.filter(e=>e.type==='assistant/message'&&(e.seq??0)>=run.startSeq).map(e=>e.data?.message??e.data),answer=text(messages.at(-1));
   const task=this.h.tasks.get(run.taskId),reason=event.data.reason?.kind;
   // A turn that ended normally is not a verified goal. Without a usable final
   // reply there is nothing to report as the result: it needs review as well.
   const review=run.toolError?'tool_error':answer.trim()?undefined:'no_result';
   const status=task.state==='cancelled'||task.state==='cancelling'?'cancelled':reason==='completed'?(review?'needs_review':'completed'):reason==='aborted'||reason==='interrupted'?'interrupted':'failed';
   const settled={...run,status,...(status==='needs_review'?{review}:{}),reason:reason??'unknown',result:answer.slice(0,2200),endedAt:new Date().toISOString(),notification:'pending'};
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
  const eventId='long-task:'+run.id+':activity:'+(run.activity?.seq??'start'),text=activityText(run.title??task.title,run,now,this.activity).slice(0,2900);
  run.report=reportMarker(run,new Date(now).toISOString(),eventId);if(run.activity)run.activity.recent=[];
  await this.h.runs.put(run.id,run);
  // Enqueue is synchronous inside notifyConversation; the send is not awaited here.
  try{void Promise.resolve(this.h.identity.notifyConversation(task.scope,{eventId,kind:'task_activity',text})).catch(()=>this.h.warn?.('Long task activity notification not recorded; the run is unchanged'));}
  catch{this.h.warn?.('Long task activity notification not recorded; the run is unchanged');}
 }
 async notify(task,run){
  if(!terminal.has(run.status))return;
  const kind=run.status==='completed'?'task_completed':'task_failed';
  const unexecuted=run.executed!==false?undefined:run.status==='cancelled'?'已取消（本次触发尚未开始执行）':run.review==='session_budget'?`未执行：本次 Host 运行中的任务 Session 已达上限（${this.runSessionBudget}），Host 重启前本任务后续触发都不会执行，也不再逐次通知`:UNEXECUTED[run.review??run.reason]??'未执行，待检查';
  const labels={completed:'本轮执行结束（不等同于目标已独立验收）',needs_review:run.review==='no_result'?'执行结束，但没有可用的最终回复，待检查':'执行结束，工具报告异常，待检查',failed:'执行失败',interrupted:'执行中断，未自动重放',cancelled:'已取消'};
  const result=await this.h.identity.notifyConversation(task.scope,{eventId:'long-task:'+run.id,kind,text:`[长期任务] ${run.title??task.title}\n${unexecuted??labels[run.status]}\n${run.result??''}`.slice(0,2900)});
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
  // Only rows delivering to this task's own destination can belong to it: its
  // fixed root, or (per-run) a new-Session target with this task's Preset,
  // directory and instruction header.
  const records=(await this.h.schedule.catalog()).filter(s=>ownsTarget(task,s)),match=records.find(s=>unbound(s.prompt)===instruction(task.pending??task));
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
    // The run's own Session: its per-run Session, or the historical task root.
    const log=await this.h.load(run.sessionId),end=(log.events??[]).find(e=>e.type==='turn/end'&&e.data.turn===run.turn);
    const next={...run,status:end?.data.reason?.kind==='completed'?'needs_review':'interrupted',reason:'restart_recovery',endedAt:new Date().toISOString(),notification:'pending'};await this.h.runs.put(run.id,next);await this.notify(task,next);
   }else if(run.notification==='pending')await this.notify(task,run);
  }
  for(const [,task]of this.h.tasks.entries())if(perRun(task)&&task.scheduleId)await this.settleOrphans(task);
  // Overdue work: DSH 0.2.2 Schedule resumes due tasks itself (latest-only
  // catch-up, restored-inbox recovery). The occurrence ledger above still
  // rejects any repeat execution; no rebind, timer or replay queue here.
 });recovery.then(this.resolveReady,this.rejectReady);return recovery;}
 /**
  * After a restart: a per-run delivery of the previous Host process with no
  * run was consumed without a pre-step decision (the turn claimed the receipt,
  * then the Host stopped before admission). Native Schedule re-wakes only the
  * latest receipt still pending in its inbox, so that one is left alone; any
  * other is settled as interrupted and unexecuted, once (same Run ID). Live
  * turns and deliveries of this process are never touched.
  */
 async settleOrphans(task){
  const started=this.h.startedAt;if(!Number.isFinite(started)||typeof this.h.schedule.history!=='function')return;
  let page;try{page=await this.h.schedule.history({id:task.scheduleId,limit:ORPHAN_SCAN});}catch{this.h.warn?.('Long task delivery history unavailable; unexecuted receipts are not reconciled');return;}
  if(!Array.isArray(page?.records))return;
  for(const [i,rec] of page.records.entries()){
   if(typeof rec?.targetSessionId!=='string'||!(Date.parse(rec.deliveredAt)<started)||this.h.runs.get(runId(task.id,rec.scheduledAt)))continue;
   if(await this.receiptPending(rec,i===0))continue;
   await this.settleUnexecuted(task,{sessionId:rec.targetSessionId,messageId:rec.messageId,occurrenceAt:rec.scheduledAt,revision:deliveredRevision(task,rec.prompt)},{status:'interrupted',reason:'restart_unclaimed'});
  }
 }
 // Whether a delivery may still be executed: a live turn holds it, or it is
 // the latest receipt and still pending (native re-wakes it).
 async receiptPending(rec,latest){
  const agent=this.h.agents.get(rec.targetSessionId);
  if(agent){if(agent.status!=='idle')return true;return latest&&[...(agent.inbox?.nextTurn??[]),...(agent.inbox?.nextStep??[])].some(m=>m?.id===rec.messageId);}
  let pending;try{pending=pendingMessageIds((await this.h.load(rec.targetSessionId)).events);}catch{pending=undefined;}
  if(pending===undefined){this.h.warn?.('Long task receipt state unreadable; left for inspection');return true;}
  return latest&&pending.has(rec.messageId);
 }
 async close(){this.closed=true;for(const id of [...this.timers.keys()])this.disarm(id);this.rejectReady(Error('Long tasks disabled'));await this.chain;this.active.clear();}
}
