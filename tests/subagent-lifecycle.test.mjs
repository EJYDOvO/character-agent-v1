// Contract tests use a native-API stand-in. The separate Host probe exercises
// actual Cordis, Agent teardown, standing native Spawn reload and tool visibility.
import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
const stub='data:text/javascript,'+encodeURIComponent(`export const Config=Object.freeze({native:true}),inject=['agents'],name='tool-subagent';export async function apply(ctx,config,session){return {ctx,config,session,list:ctx.get('agents')?.list(),tools:ctx.get('tools')};}`);
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='@deepseek-ai/dsh-tool-subagent'&&context.parentURL?.endsWith('/character-memory-tools/subagent.mjs'))return next(stub,context);return next(specifier,context);}});
const compat=await import('../packages/character-memory-tools/subagent.mjs');hooks.deregister();
const agent=(id,check=()=>{})=>({id,ctx:{fiber:{assertActive:check}}});
test('native Spawn adapter filters only confirmed closed Contexts and preserves configuration, services and live identities',async()=>{
 const live=agent('live'),closed=agent('closing',()=>{throw Object.assign(Error('closed'),{code:'INACTIVE_EFFECT'});});
 const registry={list:()=>[closed,live],get(id){return id==='live'?live:closed;}},tools={},scope={},config=Object.freeze({provider:'spawn',allowedAgentPresets:['worker-general'],maxDepth:1,modelSelectionSettings:true}),session={};
 const ctx={scope,get:n=>n==='agents'?registry:n==='tools'?tools:undefined,on(){return this.scope;}};
 const r=await compat.apply(ctx,config,session);assert.deepEqual(r.list,[live]);assert.equal(r.config,config);assert.equal(r.session,session);assert.equal(r.tools,tools);assert.equal(r.ctx.on(),scope);
 assert.equal(r.ctx.get('agents').get('live'),live);assert.deepEqual(registry.list(),[closed,live],'no registry mutation');assert.deepEqual(compat.inject,['agents']);assert.equal(compat.name,'tool-subagent');assert.equal(compat.Config.native,true);
});
test('native Spawn adapter propagates unexpected Context failures and never hides active initialization errors',async()=>{
 const failure=Object.assign(Error('unexpected context error'),{code:'OTHER'}),broken=agent('broken',()=>{throw failure;});
 await assert.rejects(()=>compat.apply({get:()=>({list:()=>[broken]})},{}),e=>e===failure);
});
test('native Spawn adapter does not invent an unavailable Agent service',async()=>{
 const r=await compat.apply({get:()=>undefined},{provider:'fork'});assert.equal(r.list,undefined);assert.equal(r.ctx.get('agents'),undefined);
});
test('native Spawn view follows a replaced registry without mutating or globally owning either registry',async()=>{
 const first=agent('first'),second=agent('second');let registry={list:()=>[first]};
 const result=await compat.apply({get:()=>registry},{}),old=result.ctx.get('agents');
 assert.deepEqual(old.list(),[first]);registry={list:()=>[second]};
 assert.deepEqual(result.ctx.get('agents').list(),[second]);assert.deepEqual(old.list(),[first]);assert.deepEqual(registry.list(),[second]);
});
test('missing Context initialization and registry lookup failures propagate instead of filtering live Agents',async()=>{
 await assert.rejects(()=>compat.apply({get:()=>({list:()=>[{id:'not-initialized'}]})},{}),TypeError);
 const failure=Error('registry initialization failed');await assert.rejects(()=>compat.apply({get(){throw failure;}},{}),e=>e===failure);
});
