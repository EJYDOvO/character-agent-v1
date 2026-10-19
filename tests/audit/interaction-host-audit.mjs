// Real installed DSH Agent loop; synthetic provider and static output only.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
const {LlmAdapter,createUserMessage}=await import(pathToFileURL(process.env.DSH_INSTALL_ROOT+'/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js'));
export const inject=['agents','agentPresets','llm'];
export function apply(ctx,config){
 let calls=0;
 class Provider extends LlmAdapter {async *stream(){
  if(++calls===1){yield {type:'text-delta',index:0,text:'失败尝试的未提交草稿'};yield {type:'finish',reason:{kind:'error',failure:{code:'AUDIT_RETRY',message:'synthetic failure'}}};}
  else {yield {type:'text-delta',index:0,text:'最终成功的结果'};yield {type:'finish',reason:{kind:'stop'}};}
 }}
 ctx.llm.registerAdapter(['audit-fixture'],new Provider());
 ctx.on('agent/request-error',()=>({kind:'retry'}));
 ctx.effect(()=>{const timer=setTimeout(()=>void run(),700);return()=>clearTimeout(timer);});
 async function run(){let h;const report={ok:false,runId:config.runId,qqNetwork:false,provider:'deterministic',checks:[]};
  try{
   assert(!ctx.get('qqGateway'));assert(!ctx.get('characterMemory'));
   h=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'audit-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:'interaction-test'},setup:async c=>{await ctx.agentPresets.mount(c,'interaction-test');}});
   const a=h.agent,p=ctx.agentPresets.serviceFor(a,'interactionPolicy').get(a),sent=[];p.bind({key:{},sendText:async text=>sent.push(text)});
   a.followup(createUserMessage({content:[{type:'text',text:'Synthetic retry case'}],source:{kind:'user'}}));await a.whenIdle();await p.idle();
   report.calls=calls;report.sent=sent;report.eventTypes=Array.from({length:a.session.seq},(_,i)=>a.session.eventAt(i)?.type);
   assert.equal(calls,2,'Expected actual native retry');assert(report.eventTypes.includes('assistant/attempt'));assert(report.eventTypes.includes('assistant/message'));
   report.nativeRetryVerified=true;
   assert.deepEqual(sent,['最终成功的结果'],'Native failed attempt must not become a completed bubble');report.ok=true;
  }catch(e){report.error=e.message;}finally{await h?.dispose();fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
