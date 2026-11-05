import test from 'node:test';import assert from 'node:assert/strict';
import {scheduleToolDenial,scheduleIndex,CREATE_TARGET_DENIED,RETARGET_DENIED,UNVERIFIED_TASK,UNAVAILABLE} from '../packages/character-identity/schedule-scope.mjs';
import {scheduledEvents} from '../packages/character-identity/schedule.mjs';
const ctx=(owners,ready=true)=>({sessionId:'owner',ownerOf:id=>owners[id],ready});
test('schedule_create from an Owner root may only target this Session',()=>{
 for(const target of ['new_once','new',undefined,'other'])assert.equal(scheduleToolDenial({name:'schedule_create',arguments:{title:'t',prompt:'p',rrule:'x',target}},ctx({})),CREATE_TARGET_DENIED,String(target));
 assert.equal(scheduleToolDenial({name:'schedule_create',arguments:{title:'t',prompt:'p',rrule:'x',target:'this_session'}},ctx({})),undefined);
});
test('view/edit act only on tasks that deliver to the calling Session and never retarget',()=>{
 const scope=ctx({mine:'owner',theirs:'long-task-root',fresh:undefined});
 assert.equal(scheduleToolDenial({name:'schedule_view',arguments:{id:'mine'}},scope),undefined);
 assert.equal(scheduleToolDenial({name:'schedule_edit',arguments:{id:'mine',action:'update',prompt:'x'}},scope),undefined);
 assert.equal(scheduleToolDenial({name:'schedule_edit',arguments:{id:'mine',action:'update',target:'this_session'}},scope),undefined);
 assert.equal(scheduleToolDenial({name:'schedule_edit',arguments:{id:'mine',action:'update',target:'new_once'}},scope),RETARGET_DENIED);
 for(const id of ['theirs','fresh','unknown',undefined]){
  assert.equal(scheduleToolDenial({name:'schedule_view',arguments:{id}},scope),UNVERIFIED_TASK,String(id));
  assert.equal(scheduleToolDenial({name:'schedule_edit',arguments:{id,action:'delete'}},scope),UNVERIFIED_TASK,String(id));
 }
 assert.equal(scheduleToolDenial({name:'schedule_edit',arguments:{id:'mine',action:'delete'}},ctx({mine:'owner'},false)),UNAVAILABLE,'Stale index fails closed');
 assert.equal(scheduleToolDenial({name:'schedule_list',arguments:{}},scope),undefined);assert.equal(scheduleToolDenial({name:'memory_recall',arguments:{target:'new'}},scope),undefined);
});
test('ownership index keeps only fixed session targets and the newest refresh',async()=>{
 let release,calls=0;const rows=[[{id:'a',target:{kind:'session',sessionId:'s1'}},{id:'b',target:{kind:'new_once',sessionId:'s1'}}],[{id:'a',target:{kind:'session',sessionId:'s2'}}]];
 const index=scheduleIndex(()=>{const mine=calls++;return mine===0?new Promise(r=>release=()=>r(rows[0])):Promise.resolve(rows[1]);});
 assert.equal(index.ready,false);const slow=index.refresh();await index.refresh();release();await slow;
 assert.equal(index.ownerOf('a'),'s2','An older refresh cannot overwrite a newer one');assert.equal(index.ownerOf('b'),undefined);assert.equal(index.ready,true);
 const failing=scheduleIndex(async()=>{throw Error('down');});await assert.rejects(failing.refresh());assert.equal(failing.ready,false);
});
test('Character reminders ignore DSH 0.2.2 change notices; reminder framing is unchanged',()=>{
 const notice={source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE CHANGE]\nA scheduled task involving this session was changed outside this session. This notice is not a delivery of the task and needs no action.\nchange: deleted\nschedule_id_json: "s"\nschedule_title_json: "t"'}]};
 assert.deepEqual(scheduledEvents(notice),[]);
 const due={source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER]\nframing\nschedule_id_json: "s"\noccurrence_at: 2030-01-01T00:00:00.000Z\nreminder_prompt_json: "drink water"'}]};
 const [event]=scheduledEvents(due);assert.equal(event.kind,'scheduled_reminder');assert.match(event.text,/drink water/);
 assert.throws(()=>scheduledEvents({source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE CHANGEX]\n'}]}),/Unknown official schedule framing/);
});
