// Native Cordis lifecycle regression; synthetic data only, no QQ or LLM calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {composeEntries,loadOptionalPatches} from '@deepseek-ai/dsh-app-boot';
import deployment from '../scripts/deployment-plan.cjs';
import {defineTool} from '@deepseek-ai/dsh-tools';
import * as localIdentity from '../examples/local-agent/identity.mjs';
import * as memoryCore from '../packages/character-memory-core/index.mjs';
import * as inspector from '../packages/memory-inspector/index.mjs';
import * as interaction from '../packages/interaction-policy/index.mjs';
export const name='module-lifecycle-regression';
export const inject=['agents','agentPresets','tools','webServer','connection'];
export function apply(ctx,config){
 if(config.role==='extras'){
  ctx.tools.register(defineTool({name:'extras_contract_fixture',description:'Synthetic optional tool',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){return 'synthetic';}}));
  ctx.provide('moduleExtras',{dispose:()=>ctx.fiber.dispose()});return;
 }
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),1000);return()=>clearTimeout(timer);});
 async function run(){
  const report={ok:false,runId:config.runId,host:config.version,provenance:config.provenance,qqNetwork:false,model:'none',checks:[]},fibers=[];let handle;
  try{
   {
   const yaml=createRequire(import.meta.url)(process.env.DSH_INSTALL_ROOT+'/resources/app.asar/dsh/node_modules/js-yaml');
   const expression='- insert:\n    - id: conditional\n      name: dsh-interaction-policy\n      disabled: !!js process.platform !== "win32"\n';
   const dialect=deployment.entryYaml(yaml),parsed=dialect.load(expression);
   const fixturePath=config.cwd+'/expression.patch.yml';fs.writeFileSync(fixturePath,expression);
   assert.deepEqual(parsed,loadOptionalPatches('deployment-regression',fixturePath));
   assert.deepEqual(dialect.load(dialect.dump(parsed)),parsed);
   const core=[{insert:[{id:'preset',config:{plugins:[{id:'policy',name:'dsh-interaction-policy'}]}},{id:'group',group:true,config:[{id:'ui',name:'dsh-memory-inspector'}]}]}];
   const names=rows=>rows.flatMap(r=>r.disabled===true?[]:[r.name,...names(Array.isArray(r.config)?r.config:r.config?.plugins??[])]);
   for(const profile of [[],[{id:'policy',disabled:true}],[{id:'preset',config:{plugins:[]}}],[{id:'preset',disabled:true}],[{id:'ui',disabled:true}],[{id:'group',config:[]}],[{id:'ui',name:'wrong',disabled:true}],[{id:'group',insert:[{id:'policy-extra',name:'dsh-interaction-policy'}]}]]){
    const actual=new Set(names(composeEntries([core,profile]))),selected=deployment.select({core,profile,extras:[]});
    for(const [name,folder]of [['dsh-memory-inspector','packages/memory-inspector'],['dsh-interaction-policy','packages/interaction-policy']])assert.equal(selected.includes(folder),actual.has(name));
   }
   report.checks.push('Deployment selection and !!js round-trip agree with installed native composer/schema');
   }
   assert(!ctx.get('characterIdentity'));assert(!ctx.get('qqRemoteOps'));assert(!ctx.get('qqGateway'));
   handle=await ctx.agents.create({sessionId:randomUUID(),meta:{cwd:config.cwd,agentPreset:'cordis'},setup:async c=>{await ctx.agentPresets.mount(c,'cordis');}});
   const agent=handle.agent;
   const identity=await ctx.plugin(localIdentity,{principalId:'fixture-user',namespaceId:'fixture-agent',projectId:'fixture-project',allowedPresetId:'cordis'});fibers.push(identity);
   const core=await ctx.plugin(memoryCore,{database:config.cwd+'/generic-memory.sqlite',autoCapture:false,consolidation:false});fibers.push(core);
   const store=ctx.get('dshMemory'),trusted=ctx.get('memoryIdentity').forSession(agent.id);
   const row=store.remember(trusted,{kind:'semantic',statement:'通用项目保持来源与权限。'},{sessionId:agent.id,eventSeq:1,messageId:'fixture',origin:'direct_user',quote:'通用项目保持来源与权限。'});
   const origin=ctx.webServer.getOrigin(),login=await fetch(ctx.connection.authenticatedUrl(origin+'/'),{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0];
   const call=async(payload)=>fetch(origin+'/memory-inspector/api',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(payload)});
   const absentStatus=(await call({operation:'contexts'})).status;assert.equal(absentStatus,405,'Installed native shell rejects POST to an unregistered route');
   const ui=await ctx.plugin(inspector,{writable:false});fibers.push(ui);
   assert.equal((await call({operation:'detail',context:agent.id,id:row.id})).status,200);
   assert.equal((await call({operation:'detail',context:'forged-session',id:row.id})).status,403);
   assert.equal((await call({operation:'forget',context:agent.id,id:row.id,revision:row.revision})).status,403);
   await ui.dispose();assert.equal((await call({operation:'contexts'})).status,absentStatus);assert.equal(store.get(trusted,row.id).statement,row.statement);
   const again=await ctx.plugin(inspector,{writable:false});fibers.push(again);assert.equal((await call({operation:'contexts'})).status,200);
   report.checks.push('Ordinary native Creator + generic Identity/Core/Inspector; ACL, UI detach/remount, Core survives');
   const before=[...ctx.tools.view(agent).visible.keys()].sort();
   const policy=await agent.ctx.plugin(interaction,{enabled:true});fibers.push(policy);
   await agent.ctx.systemPrompt.assemble({agent,scope:agent});const oldService=agent.ctx.get('interactionPolicy');assert(oldService.get(agent));
   await policy.dispose();assert.throws(()=>oldService.get(agent));assert(!agent.ctx.get('interactionPolicy'));
   assert.deepEqual([...ctx.tools.view(agent).visible.keys()].sort(),before);
   const restarted=await agent.ctx.plugin(interaction,{enabled:true});fibers.push(restarted);await agent.ctx.systemPrompt.assemble({agent,scope:agent});assert(agent.ctx.get('interactionPolicy').get(agent));
   report.checks.push('Independent Interaction attach/detach/remount revokes old service and retains ordinary tools');
   await identity.dispose();assert.throws(()=>store.get(trusted,row.id));assert.equal((await call({operation:'contexts'})).status,absentStatus);
   report.checks.push('Provider disposal deactivates dependent Core/Inspector; retained capability cannot authorize');
   report.ok=true;
  }catch(error){report.error=error.stack;}finally{for(const fiber of fibers.reverse())try{await fiber.dispose();}catch{}await handle?.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
