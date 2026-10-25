import {createHash} from 'node:crypto';
export const runId=(task,at)=>createHash('sha256').update(task+'\n'+at).digest('hex');
export const instruction=t=>`[LONG TASK ${t.id} REV ${t.revision}]\n${t.prompt}`;
export function occurrences(messages){
 const result=[];
 for(const m of messages){
  if(m?.source?.kind!=='schedule')continue;
  const text=m.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')??'';
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
