import test from 'node:test';import assert from 'node:assert/strict';
import {scheduleToolDenial,verifyScheduleCall,CREATE_TARGET_DENIED,RETARGET_DENIED,UNVERIFIED_TASK,UNAVAILABLE,STALE_REVISION} from '../packages/character-identity/schedule-scope.mjs';
import {protectSession} from '../packages/character-identity/boundary.mjs';
import {scheduledEvents} from '../packages/character-identity/schedule.mjs';
const task=(id,target,updatedAt)=>({id,kind:'rrule',rrule:'x',title:'t',prompt:'p',status:'active',target,...updatedAt===undefined?{}:{updatedAt}});
const session=id=>({kind:'session',sessionId:id});
// Owner root 'owner'; 'retired' is an earlier Owner Session with a persisted reminder binding.
function scope(rows,{trusted=['retired'],view}={}){
 const tasks=new Map(Object.entries(rows));
 return {sessionId:'owner',trusted:id=>trusted.includes(id),view:view??(async id=>tasks.get(id)??{id,code:'schedule_not_found'}),tasks};
}
const call=(name,args)=>({name,arguments:Object.freeze(args)});
test('schedule_create from an Owner root may only target this Session',()=>{
 for(const target of ['new_once','new',undefined,'other'])assert.equal(scheduleToolDenial(call('schedule_create',{title:'t',prompt:'p',rrule:'x',target})),CREATE_TARGET_DENIED,String(target));
 assert.equal(scheduleToolDenial(call('schedule_create',{title:'t',prompt:'p',rrule:'x',target:'this_session'})),undefined);
 assert.equal(scheduleToolDenial(call('schedule_list',{})),undefined);assert.equal(scheduleToolDenial(call('memory_recall',{target:'new'})),undefined);
 assert.equal(scheduleToolDenial(call('schedule_edit',{id:'a',action:'update',target:'new_once'})),RETARGET_DENIED);
 assert.equal(scheduleToolDenial(call('schedule_edit',{action:'delete'})),UNVERIFIED_TASK);
});
test('Owner manages its own and historical bound reminders; task roots, foreign and unproven targets are refused',async()=>{
 const s=scope({mine:task('mine',session('owner'),'r1'),old:task('old',session('retired'),'r2'),legacy:task('legacy',session('retired')),
  root:task('root',session('long-task-root'),'r3'),role:task('role',session('contact-session'),'r4'),unproven:task('unproven',session('unbound-owner-preset'),'r5'),
  fresh:task('fresh',{kind:'new_once',sessionId:'retired',create:{}},'r6'),every:task('every',{kind:'new',create:{}},'r7')});
 for(const id of ['mine','old','legacy'])assert.deepEqual(await verifyScheduleCall(call('schedule_view',{id}),s),{},id);
 assert.deepEqual(await verifyScheduleCall(call('schedule_edit',{id:'old',action:'update',title:'x'}),s),{arguments:{id:'old',action:'update',title:'x',expectedUpdatedAt:'r2'}},'Edit is pinned to the verified revision');
 assert.deepEqual(await verifyScheduleCall(call('schedule_edit',{id:'old',action:'update',target:'this_session'}),s),{arguments:{id:'old',action:'update',target:'this_session',expectedUpdatedAt:'r2'}},'Historical reminder may move to the current Owner Session');
 assert.deepEqual(await verifyScheduleCall(call('schedule_edit',{id:'old',action:'delete'}),s),{arguments:{id:'old',action:'delete',expectedUpdatedAt:'r2'}});
 assert.deepEqual(await verifyScheduleCall(call('schedule_edit',{id:'legacy',action:'delete'}),s),{unpinned:true},'A never-rewritten 0.2.1 row has no revision to pin');
 assert.equal((await verifyScheduleCall(call('schedule_edit',{id:'old',action:'update',target:'new'}),s)).denied,RETARGET_DENIED);
 for(const id of ['root','role','unproven','fresh','every','missing'])for(const c of [call('schedule_view',{id}),call('schedule_edit',{id,action:'delete'}),call('schedule_edit',{id,action:'update',target:'this_session'})])
  assert.equal((await verifyScheduleCall(c,s)).denied,UNVERIFIED_TASK,c.name+' '+id);
 assert.equal((await verifyScheduleCall(call('schedule_view',{id:'mine'}),{...s,sessionId:undefined})).denied,UNVERIFIED_TASK);
});
test('ownership is read at execution: a concurrent retarget after admission is refused',async()=>{
 const s=scope({x:task('x',session('retired'),'r1')}),edit=call('schedule_edit',{id:'x',action:'update',prompt:'owner change'});
 assert.equal(scheduleToolDenial(edit),undefined,'Admission (sync guard) passes on arguments alone');
 s.tasks.set('x',task('x',session('long-task-root'),'r2'));// retargeted by another actor before the body runs
 assert.equal((await verifyScheduleCall(edit,s)).denied,UNVERIFIED_TASK);
 s.tasks.set('x',task('x',session('retired'),'r3'));s.trusted=()=>false;// binding no longer present
 assert.equal((await verifyScheduleCall(edit,s)).denied,UNVERIFIED_TASK);
});
test('a failed fresh view or trust lookup fails closed',async()=>{
 const down=scope({},{view:async()=>{throw Error('storage down');}});
 for(const c of [call('schedule_view',{id:'x'}),call('schedule_edit',{id:'x',action:'delete'})])assert.equal((await verifyScheduleCall(c,down)).denied,UNAVAILABLE);
 const broken={...scope({x:task('x',session('retired'),'r1')}),trusted:()=>{throw Error('db closed');}};
 assert.equal((await verifyScheduleCall(call('schedule_edit',{id:'x',action:'delete'}),broken)).denied,UNAVAILABLE);
 assert.equal((await verifyScheduleCall(call('schedule_view',{id:'x'}),scope({x:{id:'x',code:'internal_error'}}))).denied,UNVERIFIED_TASK);
});
test('a caller revision other than the verified one is refused before the native CAS',async()=>{
 const s=scope({x:task('x',session('owner'),'r2')});
 assert.equal((await verifyScheduleCall(call('schedule_edit',{id:'x',action:'delete',expectedUpdatedAt:'r1'}),s)).denied,STALE_REVISION);
 assert.deepEqual(await verifyScheduleCall(call('schedule_edit',{id:'x',action:'delete',expectedUpdatedAt:'r2'}),s),{},'Matching caller revision keeps the native CAS as given');
});
test('tools/execute boundary re-checks the caller, pins the CAS, restores arguments, and fails closed',async()=>{
 let provider,current=true;const guards=[],gates=new Map(),agent={ctx:{get:n=>n==='tools'?{guard:f=>guards.push(f)}:provider,on:(n,f)=>gates.set(n,f)}};
 protectSession(agent);const around=gates.get('tools/execute');assert(around,'Execution-time boundary installed with the guard');
 const exec={agent,name:'schedule_edit',arguments:Object.freeze({id:'x',action:'delete'})},seen=[];
 provider={isCurrentAgent:()=>current,verifyScheduleCall:async()=>({arguments:{id:'x',action:'delete',expectedUpdatedAt:'r9'}})};
 const ok=await around(exec,async()=>{seen.push(exec.arguments);return 'native';});assert.equal(ok,'native');assert.equal(seen[0].expectedUpdatedAt,'r9');assert.equal(exec.arguments.expectedUpdatedAt,undefined,'Original arguments restored');
 provider={isCurrentAgent:()=>current,verifyScheduleCall:async()=>({denied:UNVERIFIED_TASK})};
 const refused=await around(exec,()=>assert.fail('native body must not run'));assert.equal(refused.isError,true);assert.equal(refused.error.message,UNVERIFIED_TASK);
 provider={isCurrentAgent:()=>current,verifyScheduleCall:async()=>{throw Error('boom');}};assert.equal((await around(exec,()=>assert.fail())).error.message,UNAVAILABLE);
 provider={isCurrentAgent:()=>current};assert.equal((await around(exec,()=>assert.fail())).error.message,UNAVAILABLE,'Missing verifier fails closed');
 current=false;provider={isCurrentAgent:()=>current,verifyScheduleCall:async()=>({})};assert.match((await around(exec,()=>assert.fail())).error.message,/Historical or unbound/,'Rotated out between admission and execution');
 assert.equal(await around({agent,name:'other_tool',arguments:{}},async()=>'untouched'),'untouched');
});
test('Character reminders ignore DSH 0.2.2 change notices; reminder framing is unchanged',()=>{
 const notice={source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE CHANGE]\nA scheduled task involving this session was changed outside this session. This notice is not a delivery of the task and needs no action.\nchange: deleted\nschedule_id_json: "s"\nschedule_title_json: "t"'}]};
 assert.deepEqual(scheduledEvents(notice),[]);
 const due={source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER]\nframing\nschedule_id_json: "s"\noccurrence_at: 2030-01-01T00:00:00.000Z\nreminder_prompt_json: "drink water"'}]};
 const [event]=scheduledEvents(due);assert.equal(event.kind,'scheduled_reminder');assert.match(event.text,/drink water/);
 assert.throws(()=>scheduledEvents({source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE CHANGEX]\n'}]}),/Unknown official schedule framing/);
});
