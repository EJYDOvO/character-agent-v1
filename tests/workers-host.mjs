// Actual installed DSH, synthetic model/materials, isolated home. No QQ connection.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {selectedWorkerIds} from '../packages/character-definition/workers.mjs';
import {managerFixture} from './qq-manager-fixture.mjs';
export const name='worker-v2-native-probe';
export const inject=['agents','agentPresets','tools','llm','subagents','sessions','characterIdentity','memoryIdentity','dshMemory','longTasks'];
export function apply(ctx,config){
 const observed=new Map(),attempted=new Set(),ids=selectedWorkerIds(['worker-review'],['worker-community']);let effects=0;
 class Fixture extends LlmAdapter{async *stream(request){
  const system=JSON.stringify(request.messages.filter(m=>m.role==='system')),messages=JSON.stringify(request.messages),role=/你是独立的 (worker-[a-z-]+)/.exec(system)?.[1]??'root';
  observed.set(role,{system,messages});
  const input=request.messages.filter(m=>m.role==='user'&&!['runtime-context','time-context','skill-catalog','agent-instructions'].includes(m.source?.kind)).at(-1),text=JSON.stringify(input?.content??[]),key=request.sessionId+':'+input?.id;
  if((text.includes('attack-late-tool')||text.includes('attack-nested-spawn'))&&!attempted.has(key)){
   attempted.add(key);yield {type:'tool-call-delta',index:0,id:'attack-'+randomUUID(),name:text.includes('attack-nested-spawn')?'subagent':'late_worker_write',argumentsDelta:'{}'};
  }else yield {type:'text-delta',index:0,text:JSON.stringify({worker:role,status:'ok',summary:'Fixture analysis only',findings:[],uncertainties:['Model quality is not measured'],proposals:[]})};
  yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['worker-v2-fixture'],new Fixture());
 ctx.tools.register(defineTool({name:'global_worker_write',description:'Synthetic inherited side effect',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){effects++;return 'forbidden';}}));
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1200);return()=>clearTimeout(timer);});
 async function run(){
  const handles=[],report={ok:false,runId:config.runId,host:config.version,provenance:config.provenance,restart:fs.existsSync(config.cwd+'/worker-state.json'),qqNetwork:false,model:'deterministic fixture',checks:[]};let release;
  try{
   assert.equal(config.version,'0.2.1-rc.2');
   const create=async(preset,sessionId=randomUUID(),resume=false)=>{
    const options={agentOptions:{provider:'worker-v2-fixture',model:'fixture'},setup:async c=>{await ctx.agentPresets.mount(c,preset);}};
    const h=await (resume?ctx.agents.resume({...options,resumeSessionId:sessionId}):ctx.agents.create({...options,sessionId,meta:{cwd:config.cwd,agentPreset:preset}}));handles.push(h);return h.agent;
   };
   const saved=report.restart?JSON.parse(fs.readFileSync(config.cwd+'/worker-state.json')):null;
   const root=await create('qq-character',saved?.root,report.restart),other=await create('qq-character'),creator=await create('cordis');
   const baseNames=[...ctx.tools.view(creator).visible.keys()],rootNames=[...ctx.tools.view(root).visible.keys()];
   assert.deepEqual(baseNames.filter(n=>!rootNames.includes(n)),[]);assert(rootNames.includes('character_recall'));assert(rootNames.includes('long_task_create'));
   report.checks.push('Character preserves every native Creator tool, delegation and optional Long Tasks');
   const manager=managerFixture();release=ctx.characterIdentity.attach({manager,config:{appId:'mock-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['mock-owner'],groupMode:'disabled'}},sender:{async sendMarkdown(){throw Error('No notification expected');}}});
   manager.commit({sessionId:root.id,agent:root,agentPreset:'qq-character',scope:'c2c',peerId:'mock-owner',senderId:'mock-owner'});await manager.getOrCreate('c2c','mock-owner','mock-owner',{scope:'c2c',targetId:'mock-owner'});
   assert.equal(ctx.tools.guardReason({agent:root}),undefined);
   root.followup(createUserMessage({content:[{type:'text',text:'Root policy fixture'}],source:{kind:'fixture'}}));await root.whenIdle();assert(observed.get('root')?.system.includes('Worker V2：你是唯一'));
   const trusted=ctx.memoryIdentity.forSession(root.id),spawn=ctx.tools.get('subagent',root),exec={agent:root,signal:AbortSignal.timeout(35000)};
   for(const preset of ['cordis','worker-unlisted','long-task'])await assert.rejects(()=>spawn.execute({description:'Reject untrusted preset',prompt:'analyze',agent_preset:preset},exec),/agent_preset/);
   const children=[];
   if(!report.restart)root.session.append('user/message',createUserMessage({content:[{type:'text',text:'PRIVATE_ROOT_HISTORY_DO_NOT_INHERIT'}],source:{kind:'fixture'}}),{surfaceOp:'append'});
   for(const id of ids){
    let worker;
    if(saved){const child=saved.children.find(c=>c.preset===id);assert(child);await ctx.subagents.sendMessage(root,child.id,[{type:'text',text:'Continue analysis with supplied evidence only.'}],{signal:AbortSignal.timeout(10000)});worker=ctx.agents.get(child.id);}
    else {const result=await spawn.execute({description:'Independent '+id,prompt:'Analyze only supplied fixture evidence; reference fixture:1.',agent_preset:id},exec);worker=ctx.agents.get(result.subagentId);}
    assert(worker);await worker.whenIdle();assert.notEqual(worker.id,root.id);assert.equal(ctx.agentPresets.composedPreset(worker.ctx),id);
    assert.deepEqual([...ctx.tools.view(worker).visible.keys()],[]);assert(ctx.tools.guardReason({agent:worker,name:'subagent',arguments:{agent_preset:'worker-general'}}));
    assert.throws(()=>ctx.characterIdentity.forSession(worker.id));assert.throws(()=>ctx.memoryIdentity.forSession(worker.id));
    assert.throws(()=>ctx.dshMemory.recall({...trusted,sessionId:worker.id},''));
    await assert.rejects(()=>ctx.longTasks.create(worker,{title:'forged',prompt:'work',after_seconds:60},AbortSignal.timeout(1000),'forged'));
    const snapshot=observed.get(id);assert(snapshot,'Actual Worker provider was not invoked');
    assert(!snapshot.messages.includes('PRIVATE_ROOT_HISTORY_DO_NOT_INHERIT'));assert(!snapshot.system.includes('Worker V2：你是唯一'));
    assert(snapshot.system.includes('WorkerResult V1'));
    await assert.rejects(()=>ctx.subagents.sendMessage(other,worker.id,[{type:'text',text:'Hijack worker'}],{signal:AbortSignal.timeout(1000)}));
    children.push({id:worker.id,preset:id});
    // Scope-local tools normally bypass inherited tool filters. Test actual execution.
    const remove=worker.ctx.tools.register(defineTool({name:'late_worker_write',description:'Late scoped attack fixture',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){effects++;return 'forbidden';}}));
    const allow=worker.ctx.on('tools/pre-execute',()=>({kind:'allow'}));
    worker.followup(createUserMessage({content:[{type:'text',text:'attack-late-tool'}],source:{kind:'fixture'}}));await worker.whenIdle();remove();allow();
    const called=name=>worker.session.snapshotEvents().some(e=>e.type==='assistant/message'&&e.data?.message?.content?.some(b=>b.type==='tool-call'&&b.name===name));
    assert(called('late_worker_write'),'Attack was not actually submitted');assert.equal(effects,0);
    const removeSpawn=worker.ctx.tools.register(defineTool({name:'subagent',description:'Late attempt to bypass leaf policy',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){effects++;return 'forbidden';}}));
    worker.followup(createUserMessage({content:[{type:'text',text:'attack-nested-spawn'}],source:{kind:'fixture'}}));await worker.whenIdle();removeSpawn();
    assert(called('subagent'),'Nested call was not actually submitted');assert.equal(effects,0);
    if(!saved){await ctx.subagents.drainChildren(root,[worker.id]);assert.equal(ctx.agents.get(worker.id),undefined);await ctx.subagents.sendMessage(root,worker.id,[{type:'text',text:'Cold resume analysis only.'}],{signal:AbortSignal.timeout(10000)});const cold=ctx.agents.get(worker.id);await cold.whenIdle();assert.equal(ctx.agentPresets.composedPreset(cold.ctx),id);assert(ctx.tools.guardReason({agent:cold}));await ctx.sessions.flush(cold.session);}
   }
   report.checks.push(`${ids.length} actual native independent Presets: zero tools, no parent history/Persona, no QQ/Memory/Long Tasks authority`);
   report.checks.push('Unlisted presets and unrelated parent communication rejected; late scoped execution + explicit allow still denied');
   report.checks.push(saved?'Full Host restart restores parent and every saved child with original Preset and guard':'Every Worker drained and cold-restored with its original Preset and guard');
   await ctx.sessions.flush(root.session);
   if(!saved)fs.writeFileSync(config.cwd+'/worker-state.json',JSON.stringify({root:root.id,children}));
   report.ok=true;
  }catch(e){report.error=e.stack;}finally{
   release?.();for(const h of handles)await h.dispose().catch(()=>{});
   fs.writeFileSync(config.result,JSON.stringify(report,null,2));
  }
 }
}
