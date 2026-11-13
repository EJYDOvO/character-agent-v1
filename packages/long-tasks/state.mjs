import {createHash} from 'node:crypto';
export const runId=(task,at)=>createHash('sha256').update(task+'\n'+at).digest('hex');
export const instruction=t=>`[LONG TASK ${t.id} REV ${t.revision}]\n${t.prompt}`;
// Tool-level selectors (stored as task.timing) and their DSH 0.2.2 timing kinds.
// The tool keeps its `timeZone` field; the native rule names it `time_zone`.
const SELECTORS=Object.freeze({at:'at',after_seconds:'after',every_seconds:'every',daily:'daily',weekly:'weekly',cron:'cron'});
export const TIMING_KEYS=Object.freeze(Object.keys(SELECTORS));
export function timingSelector(args){
 const keys=TIMING_KEYS.filter(k=>args?.[k]!==undefined);
 if(keys.length!==1)throw Error('Exactly one native timing selector required');
 return {[keys[0]]:args[keys[0]]};
}
const zoned=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const {timeZone,...rest}=value;return timeZone===undefined?value:{...rest,time_zone:timeZone};
};
// ScheduleCreateRequest.timing / edit patch.timing: exactly kind plus its selector.
export function nativeTiming(selector){
 const [[key,value]]=Object.entries(timingSelector(selector));
 return {kind:SELECTORS[key],[key]:['daily','weekly','cron'].includes(key)?zoned(value):value};
}
// long_task_update `change`: {kind, <matching selector>}. `after` is creation-only.
export function changeSelector(change){
 const {kind,...rest}=change??{},selector=timingSelector(rest),[key]=Object.keys(selector);
 if(SELECTORS[key]!==kind||kind==='after')throw Error('Timing change kind must match exactly one selector');
 return selector;
}
// Fixed destination of a DSH 0.2.2 catalog entry (`session` target only).
export const targetSession=entry=>entry?.target?.kind==='session'?entry.target.sessionId:undefined;
// Two delivery modes share one Task/Run lifecycle. `per-run` (task.delivery
// 'new', the default for new tasks): native Schedule creates a fresh Session
// with the task Preset for every occurrence (target kind `new`), so each Run
// has its own Session and no history. Historical tasks (no `delivery` field)
// keep their fixed independent root (target kind `session`).
export const perRun=task=>task?.delivery==='new';
export const taskTarget=task=>perRun(task)?{kind:'new',create:{agentPreset:task.presetId,cwd:task.cwd}}:{kind:'session',sessionId:task.sessionId};
/**
 * Whether a native catalog entry still delivers to this task's own destination.
 * A historical task owns the rows aimed at its root. A per-run task's `new`
 * target names no Session, so the row must also carry this task's instruction
 * header (written only by this plugin; the task id is unique).
 */
export function ownsTarget(task,entry){
 if(!perRun(task))return targetSession(entry)===task.sessionId;
 const t=entry?.target;
 return t?.kind==='new'&&t.create?.agentPreset===task.presetId&&t.create?.cwd===task.cwd&&typeof entry.prompt==='string'&&entry.prompt.startsWith(`[LONG TASK ${task.id} REV `);
}
const CHANGE_NOTICE='[SCHEDULE CHANGE]\n';
export function occurrences(messages){
 const result=[];
 for(const m of messages){
  if(m?.source?.kind!=='schedule')continue;
  const text=m.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')??'';
  // DSH 0.2.2 management notice ("needs no action"): not an occurrence, grants nothing.
  if(text.startsWith(CHANGE_NOTICE))continue;
  const field=name=>{const line=text.split('\n').find(l=>l.startsWith(name+': '));if(!line)throw Error('Incomplete Schedule framing');return line.slice(name.length+2);};
  let rows;
  if(text.startsWith('[SCHEDULE REMINDER BATCH]\n'))rows=JSON.parse(field('reminders_json'));
  else if(text.startsWith('[SCHEDULE REMINDER]\n'))rows=[{schedule_id:JSON.parse(field('schedule_id_json')),occurrence_at:field('occurrence_at'),reminder_prompt:JSON.parse(field('reminder_prompt_json'))}];
  else throw Error('Unsupported Schedule framing');
  if(!Array.isArray(rows)||rows.length>100)throw Error('Invalid Schedule receipt');
  for(const r of rows){if(typeof r.schedule_id!=='string'||typeof r.reminder_prompt!=='string'||!Number.isFinite(Date.parse(r.occurrence_at)))throw Error('Invalid Schedule receipt');result.push({...r,messageId:m.id});}
 }
 return result;
}
// Native storageDomain consumes parse-capable record schemas. No new database.
export function recordSchema(kind){return {parse(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid '+kind+' record');
 const v=structuredClone(value);
 // A per-run task has no Session of its own: each run row names the Session
 // native Schedule created for that occurrence.
 for(const key of kind==='task'?['id',...(v.delivery==='new'?['cwd']:['sessionId']),'presetId','title','prompt','state']:['id','taskId','sessionId','status','occurrenceAt'])if(typeof v[key]!=='string'||!v[key])throw Error('Missing '+kind+'.'+key);
 if(kind==='task'){
  if(v.delivery!==undefined&&v.delivery!=='new'||v.delivery==='new'&&v.sessionId!==undefined)throw Error('Invalid task delivery mode');
  if(!Number.isSafeInteger(v.revision)||v.revision<1||!v.scope||!v.route?.provider||!v.route?.model)throw Error('Invalid task authority metadata');
  if(!['creating','active','updating','cancelling','cancelled','failed','completed'].includes(v.state))throw Error('Invalid task state');
 }else if(!['running','completed','failed','interrupted','cancelled','needs_review'].includes(v.status))throw Error('Invalid task run status');
 return v;
}};}
// The revision named by a delivered instruction header of this task, or
// undefined when the prompt is not this task's instruction.
export function deliveredRevision(task,prompt){
 const head=`[LONG TASK ${task.id} REV `;
 if(typeof prompt!=='string'||!prompt.startsWith(head))return undefined;
 const rest=prompt.slice(head.length),end=rest.indexOf(']\n'),rev=end>0?Number(rest.slice(0,end)):NaN;
 return Number.isSafeInteger(rev)&&rev>=1&&String(rev)===rest.slice(0,end)?rev:undefined;
}
// Message ids still pending in a Session's durable inbox, folded from its
// persisted agent/inbox/spliced events (dsh-agent-loop inbox projection).
// undefined when the history cannot be folded.
export function pendingMessageIds(events){
 const lists={'next-turn':[],'next-step':[]};
 for(const e of events??[]){
  if(e?.type!=='agent/inbox/spliced')continue;
  const d=e.data,list=lists[d?.target],removed=d?.removedCount??0;
  if(!list||!Number.isSafeInteger(d.start)||d.start<0||d.start>list.length||!Number.isSafeInteger(removed)||removed<0||d.start+removed>list.length||!Array.isArray(d.inserted??[]))return undefined;
  list.splice(d.start,removed,...(d.inserted??[]).map(m=>m?.id));
 }
 return new Set([...lists['next-turn'],...lists['next-step']]);
}
