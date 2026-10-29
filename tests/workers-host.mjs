// Actual installed DSH, synthetic model/materials, isolated home. No QQ connection.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import {defineTool} from '@deepseek-ai/dsh-tools';
import AgentPreset from '@deepseek-ai/dsh-agent-preset';
import {selectedWorkerIds} from '../packages/character-definition/workers.mjs';
import {workerGlobalTools} from '../packages/character-memory-tools/worker-policy.mjs';
import {calls as nativeToolExecutions} from './worker-tool-fixture.mjs';
import {managerFixture} from './qq-manager-fixture.mjs';
export const name='worker-v2-native-probe';
export const inject=['agents','agentPresets','tools','llm','subagents','sessions','characterIdentity','memoryIdentity','dshMemory','longTasks','connection','webServer','skills'];
let brokenMountAttempts=0;
export function apply(ctx,config){
 if(config.brokenFixture){brokenMountAttempts++;throw Error('Fixture target cannot be mounted');}
 const observed=new Map(),bySession=new Map(),attempted=new Set(),ids=selectedWorkerIds(['worker-review'],['worker-community',{id:'root-planner-worker',alias:'external-planner'}]);let effects=0,globalEffects=0;
 class Fixture extends LlmAdapter{async *stream(request){
  const system=JSON.stringify(request.messages.filter(m=>m.role==='system')),messages=JSON.stringify(request.messages),role=/你是独立的 ([a-z-]+)/.exec(system)?.[1]??'root';
  observed.set(role,{system,messages});
  bySession.set(request.sessionId,{system,messages});
  const input=request.messages.filter(m=>m.role==='user'&&!['runtime-context','time-context','skill-catalog','agent-instructions'].includes(m.source?.kind)).at(-1),text=JSON.stringify(input?.content??[]),key=request.sessionId+':'+input?.id;
  const attack=text.includes('invoke-configured-tool')?'worker_fixture_tool':text.includes('attack-late-tool')?'late_worker_write':text.includes('attack-global-tool')?'global_write_fixture':text.includes('attack-late-global')?'late_global_fixture':text.includes('attack-long-task')?'long_task_create':undefined;
  if(attack&&!attempted.has(key)){
   attempted.add(key);yield {type:'tool-call-delta',index:0,id:'attack-'+randomUUID(),name:attack,argumentsDelta:attack==='long_task_create'?JSON.stringify({title:'forged',prompt:'work',after_seconds:60}):'{}'};
  }else yield {type:'text-delta',index:0,text:JSON.stringify({worker:role,status:'ok',summary:'Fixture analysis only',findings:[],uncertainties:['Model quality is not measured'],proposals:[]})};
  yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['worker-v2-fixture'],new Fixture());
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1200);return()=>clearTimeout(timer);});
 async function run(){
  const handles=[],registrations=[],report={ok:false,runId:config.runId,host:config.version,provenance:config.provenance,restart:fs.existsSync(config.cwd+'/worker-state.json'),qqNetwork:false,model:'deterministic fixture',checks:[]};let release;
  try{
   assert.match(config.version,/^0\.2\.1-rc\.[23]$/);
   const create=async(preset,sessionId=randomUUID(),resume=false)=>{
    const options={agentOptions:{provider:'worker-v2-fixture',model:'fixture'},setup:async c=>{await ctx.agentPresets.mount(c,preset);}};
    const h=await (resume?ctx.agents.resume({...options,resumeSessionId:sessionId}):ctx.agents.create({...options,sessionId,meta:{cwd:config.cwd,agentPreset:preset}}));handles.push(h);return h.agent;
   };
   const register=async(id,plugins)=>{const fork=await ctx.plugin(AgentPreset,{id,name:id,plugins});registrations.push(fork);return fork;};
   const parentFor=async(id,target)=>{await register(id,[{id:'spawn',name:'@deepseek-ai/dsh-tool-subagent',config:{provider:'spawn',agentPreset:'worker-general',allowedAgentPresets:['worker-general',target],maxDepth:1}}]);return create(id);};
   await assert.rejects(()=>parentFor('fixture-missing-parent','missing-community-preset'),/Unknown agent preset/);
   // This SDK eagerly validates a registered preset and caches a failed mount.
   const beforeBroken=brokenMountAttempts;
   const broken=await register('unmountable-community-preset',[{id:'broken',name:import.meta.url,config:{brokenFixture:true}}]);
   const brokenParent=await parentFor('fixture-broken-parent','unmountable-community-preset');
   await assert.rejects(()=>ctx.tools.get('subagent',brokenParent).execute({description:'Reject broken target',prompt:'fixture',agent_preset:'unmountable-community-preset'},{agent:brokenParent,signal:AbortSignal.timeout(5000)}));
   assert.equal(brokenMountAttempts,beforeBroken+1,'Broken target must actually attempt native mounting');
   await broken.dispose();
   const targetPlugins=[{id:'legacy-boundary',name:new URL('../packages/character-memory-tools/worker.mjs',import.meta.url).href},{id:'persona',name:'@deepseek-ai/dsh-persona',config:{prefix:'你是独立的 restore-community-worker。WorkerResult V1。Only analyze supplied evidence.'}}];
   const target=await register('restore-community-worker',targetPlugins),recoveryParent=await parentFor('fixture-recovery-parent','restore-community-worker');
   const native=ctx.tools.get('subagent',recoveryParent),child=await native.execute({description:'Persist real preset',prompt:'fixture',agent_preset:'restore-community-worker'},{agent:recoveryParent,signal:AbortSignal.timeout(10000)});
   await ctx.agents.get(child.subagentId).whenIdle();await ctx.subagents.drainChildren(recoveryParent,[child.subagentId]);await target.dispose();
   await assert.rejects(()=>ctx.subagents.sendMessage(recoveryParent,child.subagentId,[{type:'text',text:'Must not fall back to Creator'}],{signal:AbortSignal.timeout(5000)}));
   assert.equal(ctx.agents.get(child.subagentId),undefined);
   await register('restore-community-worker',targetPlugins);
   await ctx.subagents.sendMessage(recoveryParent,child.subagentId,[{type:'text',text:'Restore original real ID only'}],{signal:AbortSignal.timeout(10000)});
   const restored=ctx.agents.get(child.subagentId);assert.equal(ctx.agentPresets.composedPreset(restored.ctx),'restore-community-worker');assert.equal(ctx.tools.guardReason({agent:restored}),undefined);await restored.whenIdle();
   report.checks.push('Native missing declaration, broken mount and removed cold target reject without Creator fallback; original ID can be restored');
   const saved=report.restart?JSON.parse(fs.readFileSync(config.cwd+'/worker-state.json')):null;
   if(config.managerProbe){
    const origin=ctx.webServer.getOrigin(),login=await fetch(ctx.connection.authenticatedUrl(origin+'/'),{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0];
    const call=async(action,body={})=>{const response=await fetch(origin+'/api/dsh-preset-manager',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({action,...body})});assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
    const preset=async id=>(await call('list')).presets.find(p=>p.id===id);
    if(!saved)for(const id of ids){
     for(const row of [{rowId:'managed-tool',module:'dsh-character-worker-fixture',config:{}},{rowId:'managed-depth-fixture',module:'@deepseek-ai/dsh-tool-subagent',config:{provider:'spawn',agentPreset:'worker-general',allowedAgentPresets:['worker-general'],maxDepth:1}}])await call('editPlugin',{id,base:(await preset(id)).pluginRevision,op:'add',...row});
     await call('assignSkill',{id,base:(await preset(id)).pluginRevision,skill:'worker-probe',enabled:true});
    }
    for(const id of ids){const lease=await ctx.agentPresets.acquireScope(id);try{assert((await ctx.skills.snapshot({scope:lease.key})).skills.some(s=>s.name==='worker-probe'));}finally{await lease[Symbol.asyncDispose]();}}
    report.checks.push('Independent Preset Manager actually configures all Character Worker Presets/Skills through Owner API; Overrides survive full Host restart');
   }
   const root=await create('qq-character',saved?.root,report.restart),other=await create('qq-character'),creator=await create('cordis');
   const baseNames=[...ctx.tools.view(creator).visible.keys()],rootNames=[...ctx.tools.view(root).visible.keys()];
   assert.deepEqual(baseNames.filter(n=>!rootNames.includes(n)),[]);assert(rootNames.includes('character_recall'));assert(rootNames.includes('long_task_create'));
   const globalTool=name=>defineTool({name,description:'Host-global side-effect fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){globalEffects++;return 'global-tool-executed';}});
   if(!ctx.tools.get('global_write_fixture'))registrations.push({dispose:ctx.tools.register(globalTool('global_write_fixture'))});
   root.ctx.tools.register(defineTool({name:'root_only_fixture',description:'Root scoped authority must not inherit',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){throw Error('Root only');}}));
   report.checks.push('Character preserves every native Creator tool, delegation and optional Long Tasks');
   const manager=managerFixture();release=ctx.characterIdentity.attach({manager,config:{appId:'mock-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['mock-owner'],groupMode:'disabled'}},sender:{async sendMarkdown(){throw Error('No notification expected');}}});
   manager.commit({sessionId:root.id,agent:root,agentPreset:'qq-character',scope:'c2c',peerId:'mock-owner',senderId:'mock-owner'});await manager.getOrCreate('c2c','mock-owner','mock-owner',{scope:'c2c',targetId:'mock-owner'});
   assert.equal(ctx.tools.guardReason({agent:root}),undefined);
   root.followup(createUserMessage({content:[{type:'text',text:'Root policy fixture'}],source:{kind:'fixture'}}));await root.whenIdle();assert(bySession.get(root.id)?.system.includes('Worker V2：你是唯一'));
   const trusted=ctx.memoryIdentity.forSession(root.id),spawn=ctx.tools.get('subagent',root),exec={agent:root,signal:AbortSignal.timeout(35000)};
   for(const preset of ['cordis','worker-unlisted','long-task','external-planner','root-admin'])await assert.rejects(()=>spawn.execute({description:'Reject untrusted preset or alias',prompt:'analyze',agent_preset:preset},exec),/agent_preset/);
   assert(bySession.get(root.id).system.includes('agent_preset 必须传'));
   const children=[];
   if(!report.restart)root.session.append('user/message',createUserMessage({content:[{type:'text',text:'PRIVATE_ROOT_HISTORY_DO_NOT_INHERIT'}],source:{kind:'fixture'}}),{surfaceOp:'append'});
   for(const id of ids){
    let worker;
    if(saved){const child=saved.children.find(c=>c.preset===id);assert(child);await ctx.subagents.sendMessage(root,child.id,[{type:'text',text:'Continue analysis with supplied evidence only.'}],{signal:AbortSignal.timeout(10000)});worker=ctx.agents.get(child.id);}
    else {const result=await spawn.execute({description:'Independent '+id,prompt:'Analyze only supplied fixture evidence; reference fixture:1.',agent_preset:id},exec);worker=ctx.agents.get(result.subagentId);}
    assert(worker);await worker.whenIdle();
    assert.notEqual(worker.id,root.id);assert.equal(ctx.agentPresets.composedPreset(worker.ctx),id);
    assert(ctx.tools.get('worker_fixture_tool',worker));assert(!ctx.tools.get('root_only_fixture',worker));assert(!ctx.tools.get('character_recall',worker));// Host-global tools may be visible natively; visibility never grants task identity.
    // Host-global tools are masked on the Worker scope: lookup, schema and execution agree.
    assert(ctx.tools.get('long_task_create',root)&&ctx.tools.get('global_write_fixture',root));
    for(const masked of ['long_task_create','global_write_fixture','working_directory','web_fetch','qqbot_send_file','mcp__browser__browser_run_code_unsafe'])assert.equal(ctx.tools.get(masked,worker),undefined,masked+' must be masked for '+id);
    assert(!ctx.tools.schemas(worker).some(s=>s.name==='global_write_fixture'||s.name==='long_task_create'));
    for(const name of workerGlobalTools)if(ctx.tools.get(name,creator))assert(ctx.tools.get(name,worker),name+' read-only search must stay available');
    assert.equal(ctx.tools.guardReason({agent:worker}),undefined);
    const lateGlobal=ctx.tools.get('late_global_fixture')?undefined:ctx.tools.register(globalTool('late_global_fixture'));
    const beforeGlobal=globalEffects,allowGlobal=worker.ctx.on('tools/pre-execute',()=>({kind:'allow'}));
    for(const prompt of ['attack-global-tool','attack-late-global','attack-long-task']){worker.followup(createUserMessage({content:[{type:'text',text:prompt}],source:{kind:'fixture'}}));await worker.whenIdle();}
    allowGlobal();lateGlobal?.();
    const submitted=name=>worker.session.snapshotEvents().some(e=>e.type==='assistant/message'&&e.data?.message?.content?.some(b=>b.type==='tool-call'&&b.name===name));
    for(const name of ['global_write_fixture','late_global_fixture','long_task_create'])assert(submitted(name),name+' attack was not submitted');
    assert.equal(globalEffects,beforeGlobal,'Masked Host-global tool executed for '+id);
    assert(!worker.session.snapshotEvents().some(e=>e.type==='tool/result'&&JSON.stringify(e.data?.message?.content??[]).includes('global-tool-executed')));
    await assert.rejects(()=>ctx.tools.get('subagent',worker).execute({description:'Reject nested native Spawn',prompt:'fixture',agent_preset:'worker-general'},{agent:worker,signal:AbortSignal.timeout(5000)}),/depth .* exceeds maxDepth 1/);
    const configuredBefore=nativeToolExecutions.get(worker.id)??0;worker.followup(createUserMessage({content:[{type:'text',text:'invoke-configured-tool'}],source:{kind:'fixture'}}));await worker.whenIdle();assert.equal(nativeToolExecutions.get(worker.id),configuredBefore+1);
    assert.throws(()=>ctx.characterIdentity.forSession(worker.id));assert.throws(()=>ctx.memoryIdentity.forSession(worker.id));
    assert.throws(()=>ctx.dshMemory.recall({...trusted,sessionId:worker.id},''));
    await assert.rejects(()=>ctx.longTasks.create(worker,{title:'forged',prompt:'work',after_seconds:60},AbortSignal.timeout(1000),'forged'));
    const snapshot=observed.get(id);assert(snapshot,'Actual Worker provider was not invoked');
    assert(!snapshot.messages.includes('PRIVATE_ROOT_HISTORY_DO_NOT_INHERIT'));assert(!snapshot.system.includes('Worker V2：你是唯一'));
    assert(snapshot.system.includes('WorkerResult V1'));
    await assert.rejects(()=>ctx.subagents.sendMessage(other,worker.id,[{type:'text',text:'Hijack worker'}],{signal:AbortSignal.timeout(1000)}));
    children.push({id:worker.id,preset:id});
    // Scope-local tools normally bypass inherited tool filters. Test actual execution.
    const beforeLate=effects;const remove=worker.ctx.tools.register(defineTool({name:'late_worker_write',description:'Late scoped attack fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){effects++;return 'scoped-tool-executed';}}));
    const allow=worker.ctx.on('tools/pre-execute',()=>({kind:'allow'}));
    worker.followup(createUserMessage({content:[{type:'text',text:'attack-late-tool'}],source:{kind:'fixture'}}));await worker.whenIdle();remove();allow();
    const called=name=>worker.session.snapshotEvents().some(e=>e.type==='assistant/message'&&e.data?.message?.content?.some(b=>b.type==='tool-call'&&b.name===name));
    assert(called('late_worker_write'),'Attack was not actually submitted');assert.equal(effects,beforeLate+1);
    // The WorkerResult reaches the Root as a native settlement, not via job_output.
    if(!saved){
     const settled=()=>root.session.snapshotEvents().find(e=>e.type==='user/message'&&(e.data?.message??e.data)?.source?.kind==='subagent-settled'&&(e.data?.message??e.data).source.senderSessionId===worker.id);
     for(let i=0;i<200&&!settled();i++)await new Promise(r=>setTimeout(r,50));
     const note=settled();assert(note,'Worker result must reach the Root as a native settlement for '+id);
     assert(JSON.stringify((note.data?.message??note.data).content).includes(`\\"worker\\":\\"${id}\\"`),'Settlement must carry the WorkerResult');
    }
    if(!saved){await ctx.subagents.drainChildren(root,[worker.id]);assert.equal(ctx.agents.get(worker.id),undefined);await ctx.subagents.sendMessage(root,worker.id,[{type:'text',text:'Cold resume analysis only.'}],{signal:AbortSignal.timeout(10000)});const cold=ctx.agents.get(worker.id);await cold.whenIdle();assert.equal(ctx.agentPresets.composedPreset(cold.ctx),id);assert.equal(ctx.tools.guardReason({agent:cold}),undefined);assert(ctx.tools.get('worker_fixture_tool',cold));const beforeCold=nativeToolExecutions.get(cold.id)??0;cold.followup(createUserMessage({content:[{type:'text',text:'invoke-configured-tool after cold recovery'}],source:{kind:'fixture'}}));await cold.whenIdle();assert.equal(nativeToolExecutions.get(cold.id),beforeCold+1);await ctx.sessions.flush(cold.session);}
   }
   report.checks.push(`${ids.length} actual native independent Presets: configured tools execute, no parent history/Persona or inherited QQ/Memory/Long Tasks authority`);
   report.checks.push('Every WorkerResult reaches the Root as a native subagent-settled message');
   report.checks.push('Worker scope masks Host-global tools, including ones registered after spawn; model-submitted calls to them never execute; read-only search allowlist stays available');
   report.checks.push('Native whitelist, depth=1 and parent communication restrictions hold; configured and late scoped tools execute');
   report.checks.push('Real root-planner-worker ID spawns and persists; display alias and undeclared high-privilege roots rejected');
   report.checks.push(saved?'Full Host restart restores parent and every saved child with original Preset and native tools':'Every Worker drained and cold-restored with its original Preset and native tools');
   await ctx.sessions.flush(root.session);
   if(!saved)fs.writeFileSync(config.cwd+'/worker-state.json',JSON.stringify({root:root.id,children}));
   report.ok=true;
  }catch(e){report.error=e.stack;}finally{
   release?.();for(const h of handles)await h.dispose().catch(()=>{});for(const fork of registrations.reverse())await Promise.resolve().then(()=>fork.dispose()).catch(()=>{});
   fs.writeFileSync(config.result,JSON.stringify(report,null,2));
  }
 }
}
