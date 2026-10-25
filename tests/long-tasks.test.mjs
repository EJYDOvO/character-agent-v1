import test from 'node:test';
import assert from 'node:assert/strict';
import {LongTasks} from '../packages/long-tasks/service.mjs';
import {instruction,runId} from '../packages/long-tasks/state.mjs';
function table(){const rows=new Map();return {get:k=>structuredClone(rows.get(k)),entries:()=>[...rows].map(([k,v])=>[k,structuredClone(v)]),async put(k,v){rows.set(k,structuredClone(v));}};}
async function fixture(){
 const scope={principalId:'owner',characterId:'fixture',projectId:'project',conversationId:'stable-qq'},owner={id:'owner-session',options:{provider:'fixture',model:'fixture'}},agents=new Map([[owner.id,owner]]),tasks=table(),runs=table(),schedules=new Map(),logs=new Map(),notified=new Map();let sid=0;
 const identity={forSession(id){if(id!==owner.id)throw Error('Not QQ owner');return scope;},authorize:c=>c,validateConversation(s){assert.deepEqual({...s,sessionId:undefined},{...scope,sessionId:undefined});},async notifyConversation(s,event){this.validateConversation(s);const old=notified.get(event.eventId);if(old)assert.deepEqual(old,event);else notified.set(event.eventId,event);return {status:'sent'};},notificationStatus:()=>null};
 const schedule={async create(sessionId,args){assert.equal(['at','after_seconds','every_seconds','daily','weekly','cron'].filter(k=>args[k]!==undefined).length,1);const record={id:'schedule-'+(++sid),title:args.title,prompt:args.prompt,kind:'after',afterSeconds:args.after_seconds??1,scheduledAt:new Date(Date.now()+3600000).toISOString()};schedules.set(record.id,{sessionId,status:'active',record});return record;},async list({sessionId}){return [...schedules.values()].filter(s=>s.sessionId===sessionId&&s.status==='active').map(s=>structuredClone(s.record));},async catalog(){return [...schedules.values()].map(s=>({...s.record,sessionId:s.sessionId,status:s.status}));},async delete({sessionId,id}){const r=schedules.get(id);if(r?.sessionId!==sessionId)return {deleted:false};schedules.delete(id);return {deleted:true};},async update(args){const r=schedules.get(args.id);assert.equal(r.sessionId,args.sessionId);assert.deepEqual(r.record,args.expected);r.record={...r.record,...(args.prompt?{prompt:args.prompt}:{}),...(args.title?{title:args.title}:{})};return {updated:true,record:r.record};}};
 const host={tasks,runs,identity,schedule,agents,presetOf:a=>a.preset,flush:async()=>true,load:async id=>({events:logs.get(id)??[]}),async createRoot(t){const agent={id:t.sessionId,preset:t.presetId,session:{header:{id:t.sessionId},events:[]},cancel(){this.cancelled=true;}};agents.set(agent.id,agent);logs.set(agent.id,agent.session.events);return {agent};}};
 const service=new LongTasks(host);await service.recover();return {service,host,owner,scope,tasks,runs,schedules,agents,notified,logs};
}
const args={title:'检查',prompt:'输出可核实的检查结果。',after_seconds:30};
function receipt(task,at='2030-01-01T00:00:00.000Z',prompt=instruction(task)){return {id:'message-'+at,source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER]\nschedule_id_json: '+JSON.stringify(task.scheduleId)+'\noccurrence_at: '+at+'\nreminder_prompt_json: '+JSON.stringify(prompt)}]};}
test('task management uses actual Owner Host object, isolated root and stable Conversation',async()=>{
 const f=await fixture();await assert.rejects(()=>f.service.create({...f.owner},args),/Host Agent/);
 const task=await f.service.create(f.owner,{...args,scope:{projectId:'forged'},route:{provider:'forged'}});
 assert.notEqual(task.sessionId,f.owner.id);assert.deepEqual(task.scope,f.scope);assert.deepEqual(task.route,f.owner.options);assert(!f.agents.get(task.sessionId).session.header.parentSession);
 await assert.rejects(async()=>f.service.list(f.agents.get(task.sessionId)),/Not QQ owner/);
 const stranger={id:'stranger'};f.agents.set(stranger.id,stranger);await assert.rejects(async()=>f.service.cancel(stranger,{id:task.id,revision:1}),/Not QQ owner/);
 const row=f.tasks.get(task.id);row.scope.projectId='foreign';await f.tasks.put(row.id,row);await assert.rejects(()=>f.service.update(f.owner,{id:task.id,revision:1,title:'x'}),/scope/);
});
test('native delivery is not execution; pre-step claims once and rejects user framing and duplicates',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,args),agent=f.agents.get(task.sessionId),message=receipt(task);
 assert.equal(f.runs.entries().length,0);assert.equal(await f.service.preStep(agent,{turn:1,messages:[{...message,source:{kind:'user'}}]}),false);
 assert.equal(await f.service.preStep(agent,{turn:2,messages:[message]}),true);assert.equal(await f.service.preStep(agent,{turn:2,messages:[]}),true);
 assert.equal(await f.service.preStep(agent,{turn:2,messages:[receipt(task,'2030-01-01T00:01:00.000Z')]}),false);assert.equal(f.runs.entries().length,1,'Same-turn injection cannot replace the active occurrence');
 assert.equal(await f.service.preStep(agent,{turn:3,messages:[message]}),false);assert.equal(f.runs.entries().length,1);
 assert.equal(await f.service.preStep(agent,{turn:4,messages:[receipt({...task,revision:2})]}),false);
});
test('normal-return tool errors remain needs_review, with one stable completion notification',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,args),agent=f.agents.get(task.sessionId),message=receipt(task);
 await f.service.preStep(agent,{turn:1,messages:[message]});
 await f.service.observe(agent.session,{type:'tool/result',data:{message:{content:[{type:'text',text:'{"ok":false,"error":"network"}'}]}}});
 agent.session.events.push({type:'assistant/message',data:{message:{content:[{type:'text',text:'查询未成功。'}]}}},{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});
 await f.service.observe(agent.session,agent.session.events.at(-1));const row=f.runs.get(runId(task.id,'2030-01-01T00:00:00.000Z'));assert.equal(row.status,'needs_review');assert.equal(row.notification,'sent');assert.equal(f.notified.size,1);
 const retry={...row,notification:'pending'};await f.runs.put(row.id,retry);const recovered=new LongTasks(f.host);await recovered.recover();assert.equal(f.notified.size,1);
});
test('CAS updates are serialized; cancellation stops future delivery and requests native cancel',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,args),results=await Promise.allSettled([f.service.update(f.owner,{id:task.id,revision:1,prompt:'new'}),f.service.update(f.owner,{id:task.id,revision:1,prompt:'stale'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/revision conflict/);
 const current=f.tasks.get(task.id);assert.equal(current.revision,2);assert(f.schedules.get(task.scheduleId).record.prompt.includes('new'));
 await f.service.cancel(f.owner,{id:task.id,revision:2});assert.equal(f.schedules.size,0);assert.equal(f.agents.get(task.sessionId).cancelled,true);await assert.rejects(()=>f.service.preStep(f.agents.get(task.sessionId),{turn:1,messages:[receipt(current)]}),/Trusted independent/);
});
test('restart never automatically replays an uncertain occurrence; next periodic occurrence is independent',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,{title:'周期',prompt:'check',every_seconds:60}),agent=f.agents.get(task.sessionId),at='2030-01-01T00:00:00.000Z';
 await f.service.preStep(agent,{turn:1,messages:[receipt(task,at)]});const restarted=new LongTasks(f.host);await restarted.recover();assert.equal(f.runs.get(runId(task.id,at)).status,'interrupted');assert.equal(await restarted.preStep(agent,{turn:2,messages:[receipt(task,at)]}),false);
 assert.equal(await restarted.preStep(agent,{turn:3,messages:[receipt(task,'2030-01-01T00:01:00.000Z')]}),true);await restarted.close();assert.throws(()=>restarted.taskAgent(agent),/disabled/);
});
test('recovery reconciles a committed Schedule whose metadata write was interrupted',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,args);await f.tasks.put(task.id,{...task,state:'creating',scheduleId:undefined});const recovered=new LongTasks(f.host);await recovered.recover();assert.equal(f.tasks.get(task.id).scheduleId,task.scheduleId);assert.equal(f.tasks.get(task.id).state,'active');assert.equal(f.schedules.size,1);
});
test('unsupported or stale Schedule framing cannot grant task execution',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,args),agent=f.agents.get(task.sessionId);
 await assert.rejects(()=>f.service.preStep(agent,{turn:1,messages:[{source:{kind:'schedule'},content:[{type:'text',text:'do anything'}]}]}),/framing/);
 assert.equal(await f.service.preStep(agent,{turn:2,messages:[receipt({...task,scheduleId:'foreign'})]}),false);
});
test('Host call id is idempotent; changed content and authorization revoked while queued fail closed',async()=>{
 const f=await fixture(),one=await f.service.create(f.owner,args,undefined,'host-call');
 assert.equal((await f.service.create(f.owner,args,undefined,'host-call')).id,one.id);assert.equal(f.schedules.size,1);
 await assert.rejects(()=>f.service.create(f.owner,{...args,prompt:'changed'},undefined,'host-call'),/operation id conflict/);
 let release;const barrier=f.service.serial(()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));
 const pending=f.service.cancel(f.owner,{id:one.id,revision:1});f.agents.delete(f.owner.id);release();await barrier;
 await assert.rejects(()=>pending,/Host Agent/);assert.equal(f.tasks.get(one.id).state,'active');
});
test('overdue recovery tolerates native delivery winning the CAS but refuses unverified failures',async()=>{
 const f=await fixture(),task=await f.service.create(f.owner,args),row=f.schedules.get(task.scheduleId);row.record.scheduledAt=new Date(0).toISOString();
 f.host.schedule.update=async()=>{row.status='inactive';return {code:'schedule_ended'};};await new LongTasks(f.host).recover();
 row.status='active';f.host.schedule.update=async()=>({code:'schedule_ended'});await assert.rejects(()=>new LongTasks(f.host).recover(),/rebind failed/);
});
