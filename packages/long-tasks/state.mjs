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
// Fixed destination of a DSH 0.2.2 catalog entry; Long Tasks only use `session`.
export const targetSession=entry=>entry?.target?.kind==='session'?entry.target.sessionId:undefined;
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
 for(const key of kind==='task'?['id','sessionId','presetId','title','prompt','state']:['id','taskId','sessionId','status','occurrenceAt'])if(typeof v[key]!=='string'||!v[key])throw Error('Missing '+kind+'.'+key);
 if(kind==='task'){
  if(!Number.isSafeInteger(v.revision)||v.revision<1||!v.scope||!v.route?.provider||!v.route?.model)throw Error('Invalid task authority metadata');
  if(!['creating','active','updating','cancelling','cancelled','failed','completed'].includes(v.state))throw Error('Invalid task state');
 }else if(!['running','completed','failed','interrupted','cancelled','needs_review'].includes(v.status))throw Error('Invalid task run status');
 return v;
}};}
