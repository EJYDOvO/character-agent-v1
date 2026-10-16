import {createHash} from 'node:crypto';
// Parse only the installed official Schedule framing, after host source validation.
export function scheduledEvents(message){
 if(message?.source?.kind!=='schedule')return [];
 const text=message.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')??'';
 const field=name=>text.split('\n').find(l=>l.startsWith(name+': '))?.slice(name.length+2);
 let rows;if(text.startsWith('[SCHEDULE REMINDER BATCH]\n'))rows=JSON.parse(field('reminders_json'));
 else if(text.startsWith('[SCHEDULE REMINDER]\n'))rows=[{schedule_id:JSON.parse(field('schedule_id_json')),occurrence_at:field('occurrence_at'),reminder_prompt:JSON.parse(field('reminder_prompt_json'))}];else throw Error('Unknown official schedule framing');
 if(!Array.isArray(rows)||rows.length>100)throw Error('Invalid schedule batch');
 return rows.map(r=>{if(typeof r.schedule_id!=='string'||typeof r.reminder_prompt!=='string'||!Number.isFinite(Date.parse(r.occurrence_at)))throw Error('Invalid schedule receipt');return {eventId:'schedule:'+createHash('sha256').update(r.schedule_id+'\n'+r.occurrence_at).digest('hex'),kind:'scheduled_reminder',text:('[提醒到期]\n'+r.reminder_prompt).slice(0,3000)};});
}
