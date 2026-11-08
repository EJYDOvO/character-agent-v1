import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {DatabaseSync} from 'node:sqlite';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {notifierFixture} from './notifier-fixture.mjs';
import {verifySubagentLifecycle} from './subagent-lifecycle-host.mjs';
import {callTool,denied} from './tool-call-fixture.mjs';
export const name='isolated-lifecycle-probe';
export const inject=['agents','agentPresets','tools','skills','sessions','schedule','characterIdentity','memoryIdentity','dshMemory','longTasks','lifecycleFixture'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function apply(ctx,config){
 const control=ctx.lifecycleFixture;
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1000);return()=>clearTimeout(timer);});
 async function run(){
  const checkpoint=config.cwd+'/checkpoint.json',restart=fs.existsSync(checkpoint),state=restart?JSON.parse(fs.readFileSync(checkpoint)):null,report={ok:false,runId:config.runId,restart,host:config.version,provenance:config.provenance,qqNetwork:false,provider:'deterministic fixture',checks:[]};let manager,detach;
  try{
   report.phase='subagent-disposal-hmr';
   const cycles=await verifySubagentLifecycle(ctx,{cwd:config.cwd,native:config.nativeSubagent===true});
   report.checks.push(`Native Spawn reload during Context disposal: ${cycles} cycles; live/new Agents keep tools`);
   report.phase='conversation-recovery';
   const conversations=ctx.get('conversationManager');assert(conversations);
   const fakeOptions={context:ctx,preset:'cordis',cwd:config.cwd,provider:'task-fixture',model:'fixture',sessionIdleTimeout:0,sessionLifecycle:{enabled:false},adapter:{
    key:(scope,peer)=>'mock:tenant:'+JSON.stringify([scope,peer]),lifecycleScope:()=>true,acceptActivity:()=>true,isUserInput:t=>!!t?.inputId,inputId:t=>t?.inputId,
   }};
   const mock=conversations.openAdapter('mock:tenant',fakeOptions);
   assert.throws(()=>conversations.openAdapter('mock:tenant',fakeOptions));
   try{
    const [a,b]=await Promise.all([mock.getOrCreate('direct','user','user',{inputId:'mock-1'}),mock.getOrCreate('direct','user','user',{inputId:'mock-2'})]);assert.equal(a,b);assert(mock.isCurrentSession(a));assert(!mock.isCurrentSession({...a}));
    assert.throws(()=>ctx.memoryIdentity.forSession(a.sessionId));
    const saved=config.cwd+'/mock-session.json';if(restart)assert.equal(a.sessionId,JSON.parse(fs.readFileSync(saved)).id);else fs.writeFileSync(saved,JSON.stringify({id:a.sessionId}));
    assert.equal(mock.ownershipState(a.sessionKey).sessionId,a.sessionId);
    await a.handle.dispose();assert.equal(mock.size,0);
    const nativeCtx=mock.ctx,nativeAgents=mock.agents;let unexpectedCreates=0;
    mock.ctx={get:n=>n==='sessionPersistence'?{async open(){throw Object.assign(Error('fixture persistence ENOENT'),{code:'ENOENT'});}}:nativeCtx.get(n)};
    await assert.rejects(mock.getOrCreate('direct','user','user',{}),/persistence ENOENT/);assert.equal(mock.size,0);mock.ctx=nativeCtx;
    mock.agents=new Proxy(nativeAgents,{get(target,key){if(key==='resume')return async()=>{throw Object.assign(Error('fixture Preset dependency ENOENT'),{code:'ENOENT'});};if(key==='create')return async()=>{unexpectedCreates++;throw Error('Must not create');};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
    await assert.rejects(mock.getOrCreate('direct','user','user',{}),/dependency ENOENT/);assert.equal(unexpectedCreates,0);mock.agents=nativeAgents;
    assert.equal((await mock.getOrCreate('direct','user','user',{})).sessionId,a.sessionId);
   }finally{await mock.disposeAll();}
   report.checks.push('Second non-QQ Adapter: namespace lease, concurrent root, cold resume and Memory denial');
   const {SessionManager}=await import(pathToFileURL(config.qqFixture+'/dist/session/session-manager.js').href),deliveries=[];
   manager=new SessionManager(ctx,ctx.agents,{appId:'fixture-app',preset:'qq-character',cwd:config.cwd,provider:'task-fixture',model:'fixture',sessionIdleTimeout:600000,sessionLifecycle:{enabled:true,freshOnHostRestart:true,inactivityMs:43200000}},ctx.logger);
   detach=ctx.characterIdentity.attach({manager,config:{appId:'fixture-app',preset:'qq-character',sessionLifecycle:manager.config.sessionLifecycle,access:{c2cMode:'allowlist',c2cAllow:['fixture-owner'],groupMode:'disabled'}},sender:{sendMarkdown:async()=>{throw Error('no direct Gateway send');}},notifications:notifierFixture(async(target,text)=>{deliveries.push({target,text});})});
   const get=id=>manager.getOrCreate('c2c','fixture-owner','fixture-owner',{scope:'c2c',targetId:'fixture-owner',msgId:id});
   const warm=await manager.getOrCreate('c2c','fixture-owner','fixture-owner',{scope:'c2c',targetId:'fixture-owner'});
   const warmState=manager.modelResolver.prefs.getLifecycle(warm.sessionKey);
   if(restart){assert.equal(warm.sessionId,state.session,'Startup restore must preserve the route until QQ input');assert.equal(warmState.lastUserAt,state.lastUserAt,'Startup restore must not refresh user activity');}else assert.equal(warmState,undefined);
   let record=await get(restart?'after-restart':'first-input');
   assert.notEqual(record.sessionId,warm.sessionId,'First actual user input creates the blank Session');
   assert.equal(ctx.agentPresets.composedPreset(record.agent.ctx),'qq-character');assert.equal(record.agent.options.provider,'task-fixture');assert.equal(record.agent.options.model,'fixture');
   if(!restart){
    record.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'OLD_QQ_HISTORY_FIXTURE'}]}));await record.agent.whenIdle();
    const trusted=ctx.characterIdentity.forSession(record.sessionId),fact=ctx.dshMemory.remember(trusted,{kind:'semantic',statement:'SAFE_MEMORY_CONTINUES'},{sessionId:record.sessionId,eventSeq:1,messageId:'safe-memory',origin:'direct_user',quote:'SAFE_MEMORY_CONTINUES'});
    const oldReminder=await ctx.schedule.create({title:'Legacy root reminder',prompt:'Legacy reminder still reaches owner.',timing:{kind:'after',after_seconds:40},target:{kind:'session',sessionId:record.sessionId}},record.sessionId);
    assert.deepEqual(oldReminder.target,{kind:'session',sessionId:record.sessionId});
    const unproven=await ctx.agents.create({sessionId:crypto.randomUUID(),agentOptions:{provider:'task-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:'qq-character'},setup:async c=>{await ctx.agentPresets.mount(c,'qq-character');}});
    const unknownReminder=await ctx.schedule.create({title:'Unproven ownership fixture',prompt:'Must never execute or notify.',timing:{kind:'after',after_seconds:25},target:{kind:'session',sessionId:unproven.agent.id}});await unproven.dispose();
    // Owner reminders of this root that stay active across rotation, for management from a later Owner root.
    const historical=title=>ctx.schedule.create({title,prompt:title+' prompt.',timing:{kind:'after',after_seconds:3600},target:{kind:'session',sessionId:record.sessionId}},record.sessionId);
    const historyReminder=await historical('Historical owner reminder'),moveReminder=await historical('Historical move fixture'),raceReminder=await historical('Historical race fixture');
    const reminderSession=record.sessionId,retiredCapability=trusted;
    await manager.setModelOverride('c2c','fixture-owner',{provider:'task-fixture',model:'fixture'});
    assert.notEqual(record.sessionId,reminderSession);assert.equal(record.agent.session.header.parentSession,reminderSession);
    assert.throws(()=>ctx.memoryIdentity.authorize(retiredCapability,'read'));assert.throws(()=>ctx.characterIdentity.forSession(reminderSession));
    const once=await ctx.longTasks.create(record.agent,{title:'Once',prompt:'Synthetic one-time work.',after_seconds:8});
    const error=await ctx.longTasks.create(record.agent,{title:'Tool-error',prompt:'read-tool-fixture',after_seconds:3600});
    const modified=await ctx.longTasks.update(record.agent,{id:error.id,revision:1,prompt:'read-tool-fixture updated',change:{kind:'at',at:new Date(Date.now()+10000).toISOString()}});assert.equal(modified.revision,2);
    const cancelled=await ctx.longTasks.create(record.agent,{title:'Cancelled',prompt:'must not execute',after_seconds:3600});await ctx.longTasks.cancel(record.agent,{id:cancelled.id,revision:1});
    const periodic=await ctx.longTasks.create(record.agent,{title:'Periodic',prompt:'Synthetic recurring work.',every_seconds:60});
    // daily/weekly/cron through Long Tasks: native time_zone mapping, create, update, restart and one delivery.
    const due=Math.ceil((Date.now()+40000)/60000)*60000,at=new Date(due),clock=at.toISOString().slice(11,19),isoDay=(at.getUTCDay()+6)%7+1;
    const daily=await ctx.longTasks.create(record.agent,{title:'Daily',prompt:'Synthetic daily work.',daily:{time:'03:00:00',timeZone:'UTC'}});
    const weekly=await ctx.longTasks.create(record.agent,{title:'Weekly',prompt:'Synthetic weekly work.',weekly:{time:clock,timeZone:'UTC',weekdays:[isoDay]}});
    const cron=await ctx.longTasks.create(record.agent,{title:'Cron',prompt:'Synthetic cron work.',cron:{expression:'0 3 * * *',timeZone:'UTC'}});
    for(const [task,kind] of [[daily,'daily'],[weekly,'weekly'],[cron,'cron']]){const row=await ctx.schedule.view({id:task.scheduleId});assert.equal(row.kind,kind);assert.equal(row.timeZone,'UTC');assert.deepEqual(row.target,{kind:'session',sessionId:task.sessionId});}
    assert.equal((await ctx.longTasks.update(record.agent,{id:daily.id,revision:1,change:{kind:'daily',daily:{time:clock,timeZone:'UTC'}}})).revision,2);
    assert.equal((await ctx.longTasks.update(record.agent,{id:cron.id,revision:1,change:{kind:'cron',cron:{expression:`${at.getUTCMinutes()} ${at.getUTCHours()} * * *`,timeZone:'UTC'}}})).revision,2);
    await assert.rejects(ctx.longTasks.update(record.agent,{id:weekly.id,revision:1,change:{kind:'daily',weekly:{time:clock,timeZone:'UTC',weekdays:[isoDay]}}}),/kind must match/);
    for(const task of [daily,weekly,cron])assert.equal(Date.parse((await ctx.schedule.view({id:task.scheduleId})).scheduledAt),due,'Next occurrence at the updated clock time');
    const zonedTasks={daily:{id:daily.id,schedule:daily.scheduleId,period:86400000},weekly:{id:weekly.id,schedule:weekly.scheduleId,period:604800000},cron:{id:cron.id,schedule:cron.scheduleId,period:86400000}};
    const taskAgent=ctx.agents.get(once.sessionId);assert(taskAgent);assert(!taskAgent.session.header.parentSession);assert.equal(ctx.agentPresets.composedPreset(taskAgent.ctx),'long-task');
    assert.throws(()=>ctx.characterIdentity.forSession(taskAgent.id));assert.throws(()=>ctx.memoryIdentity.forSession(taskAgent.id));
    await assert.rejects(async()=>ctx.longTasks.create(taskAgent,{title:'forged',prompt:'x',after_seconds:1}));
    const ownerTools=ctx.tools.view(record.agent).visible;assert(ownerTools.has('long_task_create'));assert(ownerTools.has('schedule_create'));
    // DSH 0.2.2 Schedule tools are Host-wide; the Owner root must not reach a task root's Schedule through them.
    const catalog=await ctx.schedule.catalog(),onceRow=catalog.find(r=>r.id===once.scheduleId);assert.deepEqual(onceRow.target,{kind:'session',sessionId:once.sessionId});assert(onceRow.involvedSessionIds.includes(record.sessionId),'Owner Session is the recorded actor');
    for(const [name,args] of [['schedule_edit',{id:once.scheduleId,action:'delete'}],['schedule_edit',{id:periodic.scheduleId,action:'update',target:'this_session'}],['schedule_view',{id:once.scheduleId}]]){
     const result=await callTool(ctx,record.agent,name,args,{signal:AbortSignal.timeout(5000)});assert(denied(result),name+' on a task root Schedule must be denied');}
    assert.deepEqual((await ctx.schedule.view({id:periodic.scheduleId})).target,{kind:'session',sessionId:periodic.sessionId});assert((await ctx.schedule.view({id:once.scheduleId})).target);
    report.checks.push('Owner root cannot view, delete or retarget independent task Schedules through native tools');
    assert.deepEqual([...ctx.tools.view(taskAgent).visible.keys()].sort(),['task_fixture_read','task_fixture_slow']);
    assert((await ctx.skills.list({scope:record.agent,cwd:config.cwd})).some(s=>s.name==='long-tasks'));
    await ctx.sessions.flush(record.agent.session);
    // Deliberate pre-upgrade missing binding in this synthetic DB only. The
    // persisted native fork header is the only evidence for its ownership.
    const db=new DatabaseSync(config.cwd+'/coordination.sqlite');db.prepare('DELETE FROM qq_bindings WHERE session=?').run(reminderSession);db.close();
    const audit=await ctx.characterIdentity.auditSchedules();assert.equal(audit.rows.find(r=>r.id===oldReminder.id).binding,'verified_missing');
    fs.writeFileSync(checkpoint,JSON.stringify({session:record.sessionId,reminderSession,unknownReminder:unknownReminder.id,unknownSession:unknownReminder.target.sessionId,unknownAt:unknownReminder.scheduledAt,lastUserAt:manager.modelResolver.prefs.getLifecycle(record.sessionKey).lastUserAt,fact:fact.id,oldReminder:oldReminder.id,historyReminder:historyReminder.id,moveReminder:moveReminder.id,raceReminder:raceReminder.id,onceSchedule:once.scheduleId,periodicSchedule:periodic.scheduleId,zonedTasks,zonedDue:due,once:once.id,error:error.id,periodic:periodic.id,cancelled:cancelled.id}));
    report.checks.push('Actual native Schedule create/update/cancel; independent roots, tool allowlist, Memory/Owner ACL and Skill');
   }else{
    const liveUnknown=await ctx.agents.create({sessionId:crypto.randomUUID(),agentOptions:{provider:'task-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:'qq-character'},setup:async c=>{await ctx.agentPresets.mount(c,'qq-character');}});
    const liveUnknownReminder=await ctx.schedule.create({title:'Unproven live fixture',prompt:'Must not consume a live unproven target.',timing:{kind:'after',after_seconds:1},target:{kind:'session',sessionId:liveUnknown.agent.id}});
    assert.notEqual(record.sessionId,state.session);assert(!JSON.stringify(record.agent.session.snapshotEvents()).includes('OLD_QQ_HISTORY_FIXTURE'));assert(!record.agent.session.header.parentSession);
    assert(ctx.dshMemory.recall(ctx.characterIdentity.forSession(record.sessionId),'SAFE_MEMORY_CONTINUES').some(m=>m.id===state.fact));report.checks.push('Real Host restart creates blank QQ Session; Identity, Memory, Preset and model retained');
    const first=record.sessionId,key=record.sessionKey,prefs=manager.modelResolver.prefs;
    const expire=()=>prefs.commitLifecycle(key,{...prefs.getLifecycle(key),lastUserAt:Date.now()-43200001,lastMessageId:'old',due:null});
    record.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'owner-busy-fixture'}]}));const waitDeadline=Date.now()+5000;while(!control.waiting&&Date.now()<waitDeadline)await sleep(20);assert(control.waiting);
    expire();assert.equal((await get('busy-input')).sessionId,first);record.lastActivity=0;manager.evictor.check();assert(manager.sessions.has(key));control.release();await record.agent.whenIdle();
    report.phase='idle-session-rotation';record=await get('after-busy');assert.notEqual(record.sessionId,first);
    expire();const concurrent=await Promise.all(Array.from({length:5},(_,i)=>get('parallel-'+i)));assert.equal(new Set(concurrent.map(r=>r.sessionId)).size,1);assert.notEqual(concurrent[0].sessionId,record.sessionId);record=concurrent[0];report.checks.push('12h user inactivity, busy/eviction protection, no fork and concurrent rotation');
    const zoned=Object.entries(state.zonedTasks);let expected=7;
    for(const [kind,z] of zoned){const row=await ctx.schedule.view({id:z.schedule});assert.equal(row.kind,kind,'Restarted Host keeps the '+kind+' rule');assert.equal(row.timeZone,'UTC');assert(row.status==='active');}
    const deadline=Math.max(Date.now()+72000,state.zonedDue+30000);let tasks;
    while(Date.now()<deadline){tasks=await ctx.longTasks.list(record.agent);if([state.once,state.error,state.periodic,...zoned.map(([,z])=>z.id)].every(id=>{const r=tasks.find(t=>t.id===id)?.runs[0];return r&&r.status!=='running'&&r.notification==='sent';})&&deliveries.some(d=>d.text.includes('Legacy reminder')))break;await sleep(150);}
    for(const id of [state.once,state.error,state.periodic])assert.equal(tasks.find(t=>t.id===id)?.runs.length,1,'Exactly one executed occurrence per task');
    assert.equal(tasks.find(t=>t.id===state.once).runs[0].status,'completed');assert.equal(tasks.find(t=>t.id===state.periodic).runs[0].status,'completed');assert.equal(tasks.find(t=>t.id===state.error).runs[0].status,'needs_review');assert(globalThis[Symbol.for('fixture.tasks.read.calls')]>0);
    for(const [kind,z] of zoned){const run=tasks.find(t=>t.id===z.id)?.runs;assert.equal(run?.length,1,'Exactly one '+kind+' occurrence');assert.equal(run[0].status,'completed');
     assert.equal(Date.parse((await ctx.schedule.view({id:z.schedule})).scheduledAt),state.zonedDue+z.period,kind+' advances to its next period');}
    report.checks.push('Long Tasks daily/weekly/cron: native time_zone rules created, updated, kept across restart, delivered once, advanced one period');
    assert.equal(tasks.find(t=>t.id===state.cancelled).runs.length,0);assert.equal(deliveries.length,expected,'Six results plus one legacy reminder');assert(deliveries.every(d=>d.target.targetId==='fixture-owner'));
    assert(!deliveries.some(d=>d.text.includes('任务尚未结束')),'Short tasks send no activity report');
    const old=ctx.agents.get(state.reminderSession);assert(old,'Official Schedule cold-resumed its original Session');assert.equal(ctx.characterIdentity.route(ctx.characterIdentity.forSession(record.sessionId)).session,record.sessionId);
    assert.throws(()=>ctx.characterIdentity.forSession(old.id));assert.throws(()=>ctx.memoryIdentity.forSession(old.id));await assert.rejects(()=>ctx.longTasks.create(old,{title:'bypass',prompt:'no',after_seconds:1}));
    const audit=await ctx.characterIdentity.auditSchedules();assert.equal(audit.rows.find(r=>r.id===state.oldReminder).binding,'bound');
    assert.equal(audit.rows.find(r=>r.id===state.unknownReminder).binding,'unproven');const unknown=(await ctx.schedule.catalog()).find(r=>r.id===state.unknownReminder);assert.equal(unknown.status,'active');assert.equal(unknown.lastDelivery,undefined);assert.equal(unknown.scheduledAt,state.unknownAt);assert.equal(unknown.target.sessionId,state.unknownSession);assert(!ctx.agents.get(unknown.target.sessionId));
    const unknownLive=(await ctx.schedule.catalog()).find(r=>r.id===liveUnknownReminder.id);assert.equal(unknownLive.status,'active');assert.equal(unknownLive.lastDelivery,undefined);
    // DSH 0.2.2 injects a "[SCHEDULE CHANGE] change: created" notice into involved live Sessions; it carries no
    // authority. The reminder itself must never reach the unproven inbox, and the root must not run.
    const pendingTexts=[...liveUnknown.agent.inbox.nextTurn,...liveUnknown.agent.inbox.nextStep].map(m=>m.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')??'');
    assert(pendingTexts.every(t=>t.startsWith('[SCHEDULE CHANGE]\n')),'Only native change notices may be pending: '+JSON.stringify(pendingTexts.map(t=>t.split('\n')[0])));
    assert(!pendingTexts.some(t=>t.includes('Must not consume a live unproven target')),'Unproven reminder must not be in the inbox');
    assert.equal(liveUnknown.agent.status,'idle');await liveUnknown.dispose();
    report.phase='historical-reminder-management';
    // After restart and two rotations the current Owner root manages reminders of an earlier Owner Session
    // (binding recovered from the persisted fork header), never task-root, unproven or retargeted tasks.
    assert.notEqual(record.sessionId,state.reminderSession);assert(ctx.characterIdentity.isCurrentAgent(record.agent));
    const tool=(name,args)=>callTool(ctx,record.agent,name,args,{signal:AbortSignal.timeout(5000)}),value=r=>JSON.parse(r.content.find(b=>b.type==='text').text),why=r=>JSON.stringify(r.content);
    let r=await tool('schedule_view',{id:state.historyReminder});assert(!denied(r),'Owner views an earlier Owner reminder: '+why(r));assert.deepEqual(value(r).target,{kind:'session',sessionId:state.reminderSession});
    r=await tool('schedule_edit',{id:state.historyReminder,action:'update',title:'Historical owner reminder renamed'});assert(!denied(r),why(r));const renamed=value(r);assert.equal(renamed.title,'Historical owner reminder renamed');assert.equal(typeof renamed.updatedAt,'string');assert.deepEqual(renamed.target,{kind:'session',sessionId:state.reminderSession},'Update keeps the destination');
    r=await tool('schedule_edit',{id:state.historyReminder,action:'update',prompt:'stale write',expectedUpdatedAt:'2000-01-01T00:00:00.000Z'});assert(denied(r),'Stale caller revision is refused');
    assert.equal((await ctx.schedule.view({id:state.historyReminder})).prompt,'Historical owner reminder prompt.');
    r=await tool('schedule_edit',{id:state.moveReminder,action:'update',target:'this_session'});assert(!denied(r),why(r));assert.deepEqual(value(r).target,{kind:'session',sessionId:record.sessionId},'Historical reminder moves to the current Owner Session');
    for(const target of ['new_once','new']){r=await tool('schedule_edit',{id:state.historyReminder,action:'update',target});assert(denied(r),'retarget '+target);}
    // Concurrent retarget between verification and the native body: the pinned CAS (or the fresh view) refuses the Owner write.
    r=await tool('schedule_edit',{id:state.raceReminder,action:'update',title:'Historical race fixture v2'});assert(!denied(r),why(r));const verifiedRevision=value(r).updatedAt;
    let armed=true,race;const off=record.agent.ctx.on('tools/execute',async(exec,next)=>{
     if(armed&&exec.name==='schedule_edit'&&exec.arguments?.id===state.raceReminder){armed=false;race={pinned:exec.arguments.expectedUpdatedAt};await ctx.schedule.edit({id:state.raceReminder,action:'update',patch:{target:{kind:'session',sessionId:state.unknownSession}}},record.sessionId);}
     return next();});
    try{r=await tool('schedule_edit',{id:state.raceReminder,action:'update',prompt:'owner write after retarget'});}finally{off?.();}
    assert(race,'Race hook ran');const raced=await ctx.schedule.view({id:state.raceReminder});
    assert.deepEqual(raced.target,{kind:'session',sessionId:state.unknownSession});assert.equal(raced.prompt,'Historical race fixture prompt.','Owner write must not land on a retargeted task');
    if(race.pinned!==undefined){assert.equal(race.pinned,verifiedRevision,'CAS pinned to the verified revision');assert(!denied(r));assert.equal(value(r).code,'schedule_conflict');report.checks.push('Concurrent retarget after verification: native CAS pinned to the verified revision returned schedule_conflict');}
    else{assert(denied(r));report.checks.push('Concurrent retarget before verification: fresh execution-time view refused the Owner write');}
    for(const [name,args] of [['schedule_view',{id:state.raceReminder}],['schedule_edit',{id:state.raceReminder,action:'delete'}],['schedule_view',{id:state.unknownReminder}],['schedule_edit',{id:state.unknownReminder,action:'delete'}],['schedule_edit',{id:state.unknownReminder,action:'update',target:'this_session'}],['schedule_view',{id:state.periodicSchedule}],['schedule_edit',{id:state.periodicSchedule,action:'update',prompt:'hijack'}],['schedule_edit',{id:state.onceSchedule,action:'delete'}]])
     assert(denied(await tool(name,args)),name+' '+args.id+' must be denied');
    const unknownAfter=await ctx.schedule.view({id:state.unknownReminder});assert.equal(unknownAfter.status,'active');assert.equal(unknownAfter.target.sessionId,state.unknownSession);
    assert.equal(await ctx.schedule.edit({id:state.raceReminder,action:'delete'},record.sessionId).then(x=>x.deleted),true);
    for(const id of [state.historyReminder,state.moveReminder]){r=await tool('schedule_edit',{id,action:'delete'});assert(!denied(r),why(r));assert.equal(value(r).deleted,true);assert.equal((await ctx.schedule.view({id})).code,'schedule_not_found');}
    report.checks.push('After restart and rotation the Owner views, updates, moves and deletes earlier Owner reminders; task-root, unproven, retargeted and stale-revision writes are refused');
    const once=tasks.find(t=>t.id===state.once),agent=ctx.agents.get(once.sessionId),before=once.runs.length,delivery=agent.session.snapshotEvents().find(e=>e.type==='user/message'&&(e.data?.message??e.data)?.source?.kind==='schedule'),duplicate=delivery?.data?.message??delivery?.data;
    assert(duplicate);agent.followup(duplicate);await agent.whenIdle();await sleep(100);assert.equal((await ctx.longTasks.list(record.agent)).find(t=>t.id===state.once).runs.length,before);assert.equal(deliveries.length,expected);
    await ctx.longTasks.cancel(record.agent,{id:state.periodic,revision:tasks.find(t=>t.id===state.periodic).revision});
    // C2 Lite: a task whose one tool call outlasts the first-report window gets
    // one activity report from native step/tool events through the same Outbox,
    // then its unchanged terminal notification. Runs after the periodic task is
    // cancelled so its 20 s cannot admit another periodic occurrence.
    const slow=await ctx.longTasks.create(record.agent,{title:'Activity',prompt:'slow-tool-fixture',after_seconds:1}),slowEnd=Date.now()+60000;let slowRun;
    while(Date.now()<slowEnd){slowRun=(await ctx.longTasks.list(record.agent)).find(t=>t.id===slow.id)?.runs[0];if(slowRun&&slowRun.status!=='running'&&slowRun.notification==='sent')break;await sleep(150);}
    assert.equal(slowRun?.status,'completed');const slowTexts=deliveries.filter(d=>d.text.startsWith('[长期任务] Activity')).map(d=>d.text);
    assert.equal(slowTexts.length,2,'one activity report, then the terminal notification');assert.match(slowTexts[1],/本轮执行结束/u);
    assert.match(slowTexts[0],/任务尚未结束[\s\S]*当前处于第 1 个执行步骤；发起 1 次工具调用（工具 task_fixture_slow）[\s\S]*正在等待工具 task_fixture_slow 返回/u);
    assert.equal(slowRun.report.count,1);assert(slowRun.report.eventId.startsWith('long-task:'+slowRun.id+':activity:'));assert.equal(slowRun.activity.calls,1);assert.equal(slowRun.activity.results,1);assert.deepEqual(slowRun.activity.open,[]);
    {const db=new DatabaseSync(config.cwd+'/coordination.sqlite');try{assert.deepEqual({...db.prepare('SELECT kind,status FROM outbox WHERE id=?').get(slowRun.report.eventId)},{kind:'task_activity',status:'sent'});}finally{db.close();}}
    expected+=2;report.checks.push('Long Task activity: native step/tool events give one report after the first window through the same Outbox, beside the unchanged terminal notification; short tasks send none');
    const llmCalls=globalThis[Symbol.for('fixture.tasks.llm.calls')],oldReads=globalThis[Symbol.for('fixture.tasks.read.calls')];
    old.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'read-tool-fixture'}]}));await old.whenIdle();await sleep(100);
    assert.equal(globalThis[Symbol.for('fixture.tasks.llm.calls')],llmCalls,'Retired root must not call the model');
    const refused=await callTool(ctx,old,'task_fixture_read',{},{id:'retired-tool',signal:AbortSignal.timeout(5000)});assert(denied(refused),'Native tool invoker must deny retired Session');assert.equal(globalThis[Symbol.for('fixture.tasks.read.calls')],oldReads);
    let lateExecuted=false;old.ctx.get('tools').register(defineTool({name:'retired_late_tool',description:'Synthetic late scoped tool',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){lateExecuted=true;return 'not allowed';}}));
    const late=await callTool(ctx,old,'retired_late_tool',{},{id:'retired-late',signal:AbortSignal.timeout(5000)});assert(denied(late));assert.equal(lateExecuted,false);
    assert.equal(deliveries.length,expected);report.checks.push('Retired native root denies model, native tool dispatch, Memory and long-task creation; evidenced pre-upgrade fork reminder still notifies');
    const reads=globalThis[Symbol.for('fixture.tasks.read.calls')];
    agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'read-tool-fixture'}]}));await agent.whenIdle();assert.equal(globalThis[Symbol.for('fixture.tasks.read.calls')],reads);
    const tools=ctx.tools;assert(tools.checkGuards({agent,name:'late_scoped_tool'}),'Late scoped tools cannot bypass the allowlist');
    report.checks.push('Cold task Sessions, native periodic execution, result-vs-delivery ledger, tool-error review, stable outbox and replay rejection');
    report.checks.push('Old Session Schedule survives main rotation and cold restore without hijacking current QQ route');
    report.checks.push('Actual plugin disposal removes service and keeps retained root execution gates fail-closed');
    const previousService=ctx.get('conversationManager'),previousManager=manager,oldRecord=record,oldId=record.sessionId;
    record.typingKeepAlive=setInterval(()=>{},60000);detach();detach=undefined;
    await control.reloadConversations();assert.notEqual(ctx.get('conversationManager'),previousService);
    assert.throws(()=>previousService.openAdapter('late',{}));assert.equal(previousManager.isCurrentSession(oldRecord),false);assert.equal(oldRecord.typingKeepAlive,undefined);
    manager=new SessionManager(ctx,ctx.agents,previousManager.config,ctx.logger);
    detach=ctx.characterIdentity.attach({manager,config:{appId:'fixture-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['fixture-owner'],groupMode:'disabled'}},sender:{sendMarkdown:async()=>{throw Error('no direct Gateway send');}},notifications:notifierFixture(async(target,text)=>{deliveries.push({target,text});})});
    record=await manager.getOrCreate('c2c','fixture-owner','fixture-owner',{scope:'c2c',targetId:'fixture-owner'});assert.equal(record.sessionId,oldId);assert(ctx.characterIdentity.forSession(oldId));assert.equal(deliveries.length,expected);
    report.checks.push('Native Manager unload/remount revokes old leases, releases Typing, restores one authoritative route and rebinds Identity without outbox replay');
    await control.disable();assert(!ctx.get('longTasks'));assert(tools.checkGuards({agent,name:'task_fixture_read'}),'Unloaded service must deny retained task tools');
    agent.followup(duplicate);await agent.whenIdle();assert.equal(globalThis[Symbol.for('fixture.tasks.read.calls')],reads);assert.equal(deliveries.length,expected);
   }
   report.phase='complete';report.ok=true;
  }catch(error){report.error=error.stack;}finally{control.release();detach?.();await manager?.disposeAll().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
