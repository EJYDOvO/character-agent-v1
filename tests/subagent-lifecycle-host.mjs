// Real rc.3 Context disposal + native plugin HMR. Only synthetic isolated Agents.
import assert from 'node:assert/strict';
import {scopeOf,scopeParentOf} from '@deepseek-ai/dsh-scope';
import * as Compatibility from '../packages/character-memory-tools/subagent.mjs';
import * as Native from '@deepseek-ai/dsh-tool-subagent';
export async function verifySubagentLifecycle(ctx,{cwd,native=false,cycles=3}){
 const module=native?Native:Compatibility;
 const create=()=>ctx.agents.create({sessionId:crypto.randomUUID(),meta:{cwd,agentPreset:'qq-character'},setup:async c=>{await ctx.agentPresets.mount(c,'qq-character');}});
 for(let i=0;i<cycles;i++){
  const closingHandle=await create(),active=await create(),scope=closingHandle.agent.scope,dispose=scope.dispose;
  let release,entered;const hold=new Promise(r=>release=r),atWindow=new Promise(r=>entered=r);
  // The factory really closes the Context before unregistering the Agent. Hold
  // that native boundary; never forge registry entries or mark a live scope dead.
  scope.dispose=async()=>{await dispose();entered();await hold;};
  const closing=closingHandle.dispose();let operationError;
  try{
   await Promise.race([atWindow,closing.then(()=>{throw Error('Disposal window was not observed');})]);
   assert.throws(()=>closingHandle.agent.ctx.fiber.assertActive(),e=>e.code==='INACTIVE_EFFECT');
   assert.equal(ctx.agents.get(closingHandle.agent.id),closingHandle.agent);
   const fibers=Array.from(ctx.registry.get(module)?.fibers??[]).filter(f=>f.config.provider==='spawn'&&scopeOf(f.ctx)===scopeParentOf(scopeOf(active.agent.ctx)));
   assert.equal(fibers.length,1,'one standing Spawn composition');
   await fibers[0].restart(); // Old native implementation rejects INACTIVE_EFFECT here.
   assert(ctx.tools.get('subagent',active.agent),'live Agent retains native Spawn after reload');
   const fresh=await create();try{assert(ctx.tools.get('subagent',fresh.agent),'new Agent receives native Spawn');}finally{await fresh.dispose();}
  }catch(error){operationError=error;}
  finally{
   release();const results=await Promise.allSettled([closing,active.dispose()]);scope.dispose=dispose;
   const failures=results.filter(r=>r.status==='rejected').map(r=>r.reason);
   if(failures.length)throw new AggregateError(operationError?[operationError,...failures]:failures,'Subagent lifecycle cleanup failed');
  }
  if(operationError)throw operationError;
  assert.equal(ctx.agents.get(closingHandle.agent.id),undefined,'closing Agent is eventually unregistered');
 }
 return cycles;
}
