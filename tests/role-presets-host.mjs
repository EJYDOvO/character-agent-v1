import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';import {defineTool} from '@deepseek-ai/dsh-tools';
export const inject=['agents','agentPresets','tools','llm','sessions'];
export function apply(ctx,config){let calls=0;const attempted=new Set();
 class Fixture extends LlmAdapter{async *stream(request){if(!attempted.has(request.sessionId)){attempted.add(request.sessionId);yield {type:'tool-call-delta',index:0,id:randomUUID(),name:'role_global_probe',argumentsDelta:'{}'};}else yield {type:'text-delta',index:0,text:'Isolated conversation completed.'};yield {type:'finish',reason:{kind:'stop'}};}}
 ctx.llm.registerAdapter(['role-fixture'],new Fixture());
 const tool=name=>defineTool({name,description:'Synthetic inherited tool',parameters:{},output:{schema:{type:'string'},render:()=>[{type:'text',text:'fixture'}]},execute(){calls++;return 'fixture';}});
 ctx.tools.register(tool('role_global_probe'));
 ctx.effect(()=>{const timer=setTimeout(async()=>{const report={ok:false,checks:[]},handles=[];try{
  const ids=new Set();for(const preset of ['character','character-contact','character-guest']){
   const h=await ctx.agents.create({sessionId:randomUUID(),meta:{agentPreset:preset,cwd:config.home},agentOptions:{provider:'role-fixture',model:'fixture'},setup:async c=>{await ctx.agentPresets.mount(c,preset);}});handles.push(h);ids.add(h.agent.id);
   if(preset==='character'){assert(ctx.tools.get('role_global_probe',h.agent));continue;}
   assert.equal(ctx.tools.schemas(h.agent).length,0);assert.equal(ctx.tools.checkGuards({agent:h.agent}),undefined,'Chat itself must remain available');
   const remove=ctx.tools.register(tool('late_role_probe'));assert(!ctx.tools.get('late_role_probe',h.agent));
   h.agent.followup(createUserMessage({content:[{type:'text',text:'Attempt inherited tool then reply normally.'}],source:{kind:'fixture'}}));await h.agent.whenIdle();assert(attempted.has(h.agent.id));assert.equal(calls,0);remove();
   await ctx.sessions.flush(h.agent.session);report.checks.push(preset+': native chat completes; inherited/late tools hidden and submitted tool does not execute');
  }assert.equal(ids.size,3);report.ok=true;
 }catch(e){report.error=e.stack;}finally{for(const h of handles)await h.dispose();fs.writeFileSync(config.result,JSON.stringify(report));}},1000);return()=>clearTimeout(timer);});
}
