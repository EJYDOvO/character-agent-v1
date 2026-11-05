import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {managerFixture} from './qq-manager-fixture.mjs';
import {notifierFixture} from './notifier-fixture.mjs';
import {onceAfter} from './rrule-fixture.mjs';
import {callTool,denied} from './tool-call-fixture.mjs';
const {LlmAdapter}=await import(pathToFileURL((process.env.DSH_CHARACTER_HOST_ROOT||process.env.DSH_INSTALL_ROOT)+'/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js').href);
export const name='isolated-schedule-restart';export const inject=['agents','agentPresets','tools','llm','characterIdentity','schedule'];
export function apply(ctx,config){
 class Fixture extends LlmAdapter{async *stream(){yield {type:'text-delta',index:0,text:'Synthetic scheduled task completed.'};yield {type:'finish',reason:{kind:'stop'}};}}
 ctx.llm.registerAdapter(['schedule-fixture'],new Fixture());ctx.effect(()=>{const timer=setTimeout(()=>void run(),1000);return()=>clearTimeout(timer);});
 async function run(){const stateFile=config.cwd+'/schedule-checkpoint.json',restart=fs.existsSync(stateFile),report={ok:false,runId:config.runId,provenance:config.provenance,restart,qqNetwork:false,checks:[]};let handle,release;
  try{const state=restart?JSON.parse(fs.readFileSync(stateFile)):null,setup=async c=>{await ctx.agentPresets.mount(c,'qq-character');};
   handle=restart?await ctx.agents.resume({resumeSessionId:state.session,setup}):await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'schedule-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:'qq-character'},setup});
   const agent=handle.agent;assert.equal(ctx.agentPresets.composedPreset(agent.ctx),'qq-character');if(state)assert.equal(agent.id,state.session);
   const deliveries=[],record={sessionId:agent.id,agent,agentPreset:'qq-character',scope:'c2c',peerId:'mock-owner',senderId:'mock-owner'},manager=managerFixture();manager.commit(record);
   release=ctx.characterIdentity.attach({manager,config:{appId:'mock-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['mock-owner'],groupMode:'disabled'}},sender:{async sendMarkdown(){throw Error('No direct Gateway send');}},notifications:notifierFixture(async(target,text)=>{deliveries.push({target,text});})});
   await manager.getOrCreate('c2c','mock-owner','mock-owner',{scope:'c2c',targetId:'mock-owner'});const capability=ctx.characterIdentity.forSession(agent.id);
   const exec={agent,signal:AbortSignal.timeout(30000)};
   if(!restart){const cancelled=await ctx.tools.get('schedule_create',agent).execute({title:'cancel fixture',prompt:'must not run',rrule:onceAfter(3600),target:'this_session'},exec);assert.deepEqual(cancelled.target,{kind:'session',sessionId:agent.id});
    assert.equal((await ctx.tools.get('schedule_edit',agent).execute({id:cancelled.id,action:'delete'},exec)).deleted,true);
    assert(!(await ctx.tools.get('schedule_list',agent).execute({},exec)).items.some(x=>x.id===cancelled.id));
    const scheduled=await ctx.tools.get('schedule_create',agent).execute({title:'restart fixture',prompt:'Synthetic reminder after restart.',rrule:onceAfter(15),target:'this_session'},exec);
    // Through the native tool pipeline (pre-execute policy + guards): Owner roots cannot open new Sessions or touch foreign tasks.
    const call=(name,args)=>callTool(ctx,agent,name,args);
    for(const target of ['new_once','new']){const result=await call('schedule_create',{title:'escape',prompt:'must not exist',rrule:onceAfter(3600),target});assert(denied(result),'Owner root must not create a '+target+' task');}
    const other=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'schedule-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:'qq-character'},setup});
    const foreign=await ctx.schedule.create({title:'foreign fixture',prompt:'not the Owner root',timing:{kind:'after',after_seconds:3600},target:{kind:'session',sessionId:other.agent.id}});await other.dispose();
    await new Promise(r=>setTimeout(r,200));
    for(const [name,args] of [['schedule_view',{id:foreign.id}],['schedule_edit',{id:foreign.id,action:'delete'}],['schedule_edit',{id:scheduled.id,action:'update',target:'new'}]]){const result=await call(name,args);assert(denied(result),name+' must be denied');}
    const own=await call('schedule_view',{id:scheduled.id});assert(!denied(own),'Owner root can read its own reminder: '+JSON.stringify(own.content));
    assert((await ctx.schedule.catalog()).every(r=>r.title!=='escape'));assert.equal((await ctx.schedule.view({id:foreign.id})).id,foreign.id);await ctx.schedule.edit({id:foreign.id,action:'delete'});
    report.checks.push('Native tool pipeline denies new/new_once targets, foreign view/edit and retargeting from an Owner root');
    fs.writeFileSync(stateFile,JSON.stringify({session:agent.id,schedule:scheduled.id}));report.checks.push('Native Schedule created; another reminder cancelled');
   }else{const deadline=Date.now()+25000;while(!deliveries.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
    assert.equal(deliveries.length,1,'Restarted pending reminder must be delivered exactly once');assert.equal(deliveries[0].target.targetId,'mock-owner');assert(deliveries[0].text.startsWith('[提醒到期]'));
    assert.equal(ctx.characterIdentity.route(capability).session,state.session);await agent.whenIdle();report.checks.push('Separate Host process resumed same Session; persisted reminder reached same owner once');
   }report.ok=true;
  }catch(error){report.error=error.stack;}finally{release?.();await handle?.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
