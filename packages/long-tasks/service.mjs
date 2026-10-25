import {randomUUID} from 'node:crypto';
import {instruction,occurrences,runId} from './state.mjs';
const terminal=new Set(['completed','failed','interrupted','cancelled','needs_review']);
const text=m=>m?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')??'';
export class LongTasks {
 constructor(host,{presetId='long-task',allowTools=[]}={}){this.h=host;this.presetId=presetId;this.allowTools=allowTools;this.chain=Promise.resolve();this.active=new Map();this.closed=false;this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});this.ready.catch(()=>{});}
 serial(fn){const p=this.chain.then(()=>{if(this.closed)throw Error('Long tasks disabled');return fn();});this.chain=p.catch(()=>{});return p;}
 owner(agent){if(this.h.agents.get(agent?.id)!==agent)throw Error('Actual Host Agent required');const c=this.h.identity.forSession(agent.id);return this.h.identity.authorize(c,'write');}
 scoped(task,scope){if(!task||['principalId','characterId','projectId','conversationId'].some(k=>task.scope[k]!==scope[k]))throw Error('Task not found in authorized scope');return task;}
 async create(agent,args,signal,operationId){await this.ready;return this.serial(async()=>{
  const scope=this.owner(agent);
  signal?.throwIfAborted();this.h.identity.validateConversation(scope);
  if(typeof args.title!=='string'||!args.title.trim()||args.title.length>120||typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>8000)throw Error('Task title and bounded instruction required');
  const route={provider:agent.options.provider,model:agent.options.model};if(!route.provider||!route.model)throw Error('Explicit resolved task model required');
  const id='task-'+(operationId?runId(agent.id,String(operationId)):randomUUID()),timing=Object.fromEntries(['at','after_seconds','every_seconds','daily','weekly','cron'].filter(k=>args[k]!==undefined).map(k=>[k,args[k]]));
  if(Object.keys(timing).length!==1)throw Error('Exactly one native timing selector required');
  const existing=this.h.tasks.get(id);if(existing){this.scoped(existing,scope);if(existing.title!==args.title.trim()||existing.prompt!==args.prompt.trim()||JSON.stringify(existing.timing)!==JSON.stringify(timing))throw Error('Task operation id conflict');return existing;}
  const task={id,sessionId:randomUUID(),presetId:this.presetId,title:args.title.trim(),prompt:args.prompt.trim(),timing,revision:1,state:'creating',scope:{principalId:scope.principalId,characterId:scope.characterId,projectId:scope.projectId,conversationId:scope.conversationId},route,createdAt:new Date().toISOString()};
  await this.h.tasks.put(task.id,task);
  try{
   const handle=await this.h.createRoot(task);if(!await this.h.flush(handle.agent.session))throw Error('Task root was not durably saved');
   const record=await this.h.schedule.create(task.sessionId,{...args,prompt:instruction(task),title:task.title},signal);
   const next={...task,state:'active',scheduleId:record.id};await this.h.tasks.put(task.id,next);return next;
  }catch(error){await this.h.tasks.put(task.id,{...task,state:'failed',error:'create_incomplete'});throw error;}
 });}
 async list(agent){await this.ready;return this.serial(async()=>{
  const scope=this.owner(agent);
  const catalog=await this.h.schedule.catalog();
  const byTask=new Map();for(const [,run]of this.h.runs.entries()){const rows=byTask.get(run.taskId)??[];rows.push(run);byTask.set(run.taskId,rows);}
  return [...this.h.tasks.entries()].map(([,t])=>t).filter(t=>['principalId','characterId','projectId','conversationId'].every(k=>t.scope[k]===scope[k])).map(t=>{const schedule=catalog.find(s=>s.id===t.scheduleId),runs=(byTask.get(t.id)??[]).slice(-20).map(r=>({...r,notification:this.h.identity.notificationStatus?.(t.scope,'long-task:'+r.id)??r.notification}));return {...t,schedule,executionState:runs.some(r=>r.status==='running')?'running':t.state==='active'&&schedule?.status==='inactive'?'ended':t.state,runs};});
 });}
 async update(agent,{id,revision,title,prompt,change},signal){await this.ready;return this.serial(async()=>{
  signal?.throwIfAborted();
  const scope=this.owner(agent);
  const task=this.scoped(this.h.tasks.get(id),scope);if(task.revision!==revision)throw Error('Task revision conflict');if(task.state!=='active')throw Error('Only active schedules can be modified; create a new task to rerun ended work');
  if((title!==undefined&&(typeof title!=='string'||!title.trim()||title.length>120))||(prompt!==undefined&&(typeof prompt!=='string'||!prompt.trim()||prompt.length>8000)))throw Error('Invalid replacement content');
  const expected=(await this.h.schedule.list({sessionId:task.sessionId})).find(s=>s.id===task.scheduleId);if(!expected)throw Error('Schedule ended; create a new task');
  const pending={...task,title:title?.trim()??task.title,prompt:prompt?.trim()??task.prompt,timing:change?Object.fromEntries(Object.entries(change).filter(([key])=>key!=='kind')):task.timing,revision:revision+1};
  await this.h.tasks.put(id,{...task,state:'updating',pending});
  try{const result=await this.h.schedule.update({sessionId:task.sessionId,id:task.scheduleId,expected,title:pending.title,prompt:instruction(pending),...(change?{change}: {})},signal);if(!result.record)throw Error('Schedule update rejected: '+result.code);await this.h.tasks.put(id,pending);return pending;}
  catch(error){await this.reconcile(task.id);throw error;}
 });}
 async cancel(agent,{id,revision},signal){await this.ready;return this.serial(async()=>{
  signal?.throwIfAborted();
  const scope=this.owner(agent);
  const task=this.scoped(this.h.tasks.get(id),scope);if(task.revision!==revision)throw Error('Task revision conflict');
  const cancelling={...task,state:'cancelling',revision:revision+1};await this.h.tasks.put(id,cancelling);
  if(task.scheduleId)await this.h.schedule.delete({sessionId:task.sessionId,id:task.scheduleId},signal);
  this.h.agents.get(task.sessionId)?.cancel({kind:'user'});
  const cancelled={...cancelling,state:'cancelled'};await this.h.tasks.put(id,cancelled);return cancelled;
 });}
 taskAgent(agent){if(this.closed)throw Error('Long tasks disabled');const task=[...this.h.tasks.entries()].map(([,t])=>t).find(t=>t.sessionId===agent?.id);if(!task||this.h.agents.get(agent.id)!==agent||this.h.presetOf(agent)!==task.presetId||agent.session.header.parentSession||['cancelled','cancelling','failed'].includes(task.state))throw Error('Trusted independent task root required');this.h.identity.validateConversation(task.scope);return task;}
 async preStep(agent,event){await this.ready;return this.serial(async()=>{
  const task=this.taskAgent(agent),current=this.active.get(agent.id);
  if(current?.turn===event.turn)return !(event.messages??[]).some(m=>m.source?.kind==='schedule');
  if(task.state!=='active')return false;
  const receipts=occurrences(event.messages??[]);if(!receipts.length)return false;
  const unique=new Map(receipts.map(r=>[runId(task.id,r.occurrence_at),r]));
  // One task root executes one occurrence per turn. No silent batching of goals.
  if(unique.size!==1)throw Error('Multiple occurrences require operator review');
  const [id,receipt]=[...unique][0];
  const admittedPrompt=receipt.reminder_prompt.replace(/\n\[HOST BINDING [0-9a-f-]{36}\]$/u,'');
  if(receipt.schedule_id!==task.scheduleId||admittedPrompt!==instruction(task))return false;
  if(this.h.runs.get(id))return false;
  const run={id,taskId:task.id,sessionId:agent.id,status:'running',occurrenceAt:receipt.occurrence_at,turn:event.turn,startSeq:agent.session.seq??0,revision:task.revision,title:task.title,startedAt:new Date().toISOString(),toolError:false};
  await this.h.runs.put(id,run);this.active.set(agent.id,run);return true;
 });}
 observe(session,event){return this.serial(async()=>{
  const run=this.active.get(session.header.id);if(!run)return;
  if(event.type==='tool/result'){
   const m=event.data?.message??event.data;let payload;try{payload=JSON.parse(text(m));}catch{}
   if(m?.isError||m?.error||m?.source?.isError||payload?.error||payload?.ok===false){run.toolError=true;await this.h.runs.put(run.id,run);}
  }
  if(event.type==='turn/end'&&event.data.turn===run.turn){
   const events=typeof session.snapshotEvents==='function'?session.snapshotEvents():session.events??[];
   const messages=events.filter(e=>e.type==='assistant/message'&&(e.seq??0)>=run.startSeq).map(e=>e.data?.message??e.data),answer=text(messages.at(-1));
   const task=this.h.tasks.get(run.taskId),reason=event.data.reason?.kind;
   const status=task.state==='cancelled'||task.state==='cancelling'?'cancelled':reason==='completed'?(run.toolError?'needs_review':'completed'):reason==='aborted'||reason==='interrupted'?'interrupted':'failed';
   const settled={...run,status,reason:reason??'unknown',result:answer.slice(0,2200),endedAt:new Date().toISOString(),notification:'pending'};
   await this.h.runs.put(run.id,settled);this.active.delete(session.header.id);await this.notify(task,settled);
  }
 });}
 async notify(task,run){
  if(!terminal.has(run.status))return;
  const kind=run.status==='completed'?'task_completed':'task_failed';
  const labels={completed:'本轮执行结束（不等同于目标已独立验收）',needs_review:'执行结束，工具报告异常，待检查',failed:'执行失败',interrupted:'执行中断，未自动重放',cancelled:'已取消'};
  const result=await this.h.identity.notifyConversation(task.scope,{eventId:'long-task:'+run.id,kind,text:`[长期任务] ${run.title??task.title}\n${labels[run.status]}\n${run.result??''}`.slice(0,2900)});
  await this.h.runs.put(run.id,{...run,notification:result.status});
 }
 async reconcile(id){
  const task=this.h.tasks.get(id);this.h.identity.validateConversation(task.scope);
  const records=(await this.h.schedule.catalog()).filter(s=>s.sessionId===task.sessionId),match=records.find(s=>s.prompt===instruction(task.pending??task));
  if(task.state==='updating'){
   if(match)await this.h.tasks.put(id,{...task.pending,state:'active',scheduleId:match.id});
   else if(records.some(s=>s.prompt===instruction(task))) {const {pending,...old}=task;await this.h.tasks.put(id,{...old,state:'active'});}
   else await this.h.tasks.put(id,{...task,state:'failed',error:'update_state_unknown'});
  }else if(task.state==='creating'||task.error==='create_incomplete'){
   if(records.length===1&&match)await this.h.tasks.put(id,{...task,state:'active',scheduleId:match.id});
   else await this.h.tasks.put(id,{...task,state:'failed',error:'create_state_unknown'});
  }else if(task.state==='cancelling'){
   if(task.scheduleId)await this.h.schedule.delete({sessionId:task.sessionId,id:task.scheduleId});await this.h.tasks.put(id,{...task,state:'cancelled'});
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
  // rc.2 does not retry a failed cold-resume automatically. A public, CAS
  // instruction update rebinds overdue work without changing its due time or
  // adding a timer/queue. The occurrence ledger still rejects repeat execution.
  const catalog=await this.h.schedule.catalog();
  for(const [,task]of this.h.tasks.entries()){
   const row=catalog.find(r=>r.id===task.scheduleId&&r.status==='active');
   if(task.state!=='active'||!row||Date.parse(row.scheduledAt)>Date.now())continue;
   const expected=(await this.h.schedule.list({sessionId:task.sessionId})).find(r=>r.id===task.scheduleId);if(!expected)continue;
   const result=await this.h.schedule.update({sessionId:task.sessionId,id:task.scheduleId,expected,prompt:instruction(task)+'\n[HOST BINDING '+randomUUID()+']'});
   if(!result.record){
    const current=(await this.h.schedule.catalog()).find(r=>r.id===task.scheduleId&&r.sessionId===task.sessionId);
    // Native dispatch may win between list() and CAS. It has already persisted
    // delivery; this is not a failed plugin activation or a reason to replay.
    if(result.code==='schedule_ended'&&current?.status==='inactive')continue;
    if(result.code==='schedule_conflict'&&current?.lastDelivery&&Date.parse(current.scheduledAt)>Date.now())continue;
    throw Error('Overdue task rebind failed: '+result.code);
   }
  }
 });recovery.then(this.resolveReady,this.rejectReady);return recovery;}
 async close(){this.closed=true;this.rejectReady(Error('Long tasks disabled'));await this.chain;this.active.clear();}
}
