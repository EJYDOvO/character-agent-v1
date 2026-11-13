// Test provider is ready before overdue native Schedule resumes task roots.
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {defineTool} from '@deepseek-ai/dsh-tools';
import * as Tasks from '../packages/long-tasks/index.mjs';
export const name='isolated-task-fixture';
export const inject=['llm',...Tasks.inject];
export async function apply(ctx,config){
 const control={waiting:false,release(){}};
 const Conversations=await import(config.conversationModule);
 let conversations=await ctx.plugin(Conversations,{stateFile:config.conversationStateFile});
 control.reloadConversations=async()=>{await conversations.dispose();conversations=await ctx.plugin(Conversations,{stateFile:config.conversationStateFile});};
 globalThis[Symbol.for('fixture.tasks.read.calls')]=0;
 globalThis[Symbol.for('fixture.tasks.llm.calls')]=0;
 class Fixture extends LlmAdapter{async *stream(request){
  globalThis[Symbol.for('fixture.tasks.llm.calls')]++;
  const input=JSON.stringify(request.messages.filter(m=>m.role==='user')),tool=request.messages.some(m=>m.role==='tool');
  const name=input.includes('owner-busy-fixture')?'task_fixture_wait':input.includes('read-tool-fixture')?'task_fixture_read':input.includes('slow-tool-fixture')?'task_fixture_slow':null;
  if(name&&!tool){yield {type:'tool-call-delta',index:0,id:'fixture-call',name,argumentsDelta:'{}'};yield {type:'finish',reason:{kind:'stop'}};return;}
  yield {type:'text-delta',index:0,text:'Synthetic task result; goal not independently verified.'};yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['task-fixture'],new Fixture());
 ctx.tools.register(defineTool({name:'task_fixture_wait',description:'Hold synthetic user work',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){control.waiting=true;await new Promise(r=>control.release=r);return 'released';}}));
 // Test-only pause points for the restart gate (isolated test Profile only;
 // production Profiles never load this fixture). holdPreStep(id) parks the
 // first step whose receipt names Schedule id, ahead of the long-task role's
 // admission hook: the DSH loop has already claimed the receipt. holdResolve()
 // parks the next native Schedule activation of a Session that did not exist
 // when it was armed: its pendingDelivery is reserved and the Session created,
 // nothing delivered. Neither is ever released; the gate stops the Host.
 const parked=new Promise(()=>{}),holds={preStep:null,resolve:null};
 // {release:true}: the parked step can be released (it then reaches the role admission).
 control.holdPreStep=(scheduleId,{release=false}={})=>new Promise(resolve=>{holds.preStep={scheduleId,resolve,release};});
 control.holdResolve=()=>new Promise(resolve=>{holds.resolve={known:new Set(ctx.agents.list?.().map(a=>a.id)??[]),resolve};});
 ctx.on('agent/created',({agent})=>{
  agent.ctx.on('agent/pre-step',async(event,next)=>{
   const hold=holds.preStep,text=JSON.stringify(event.messages??[]);
   if(hold&&text.includes(JSON.stringify(hold.scheduleId).slice(1,-1))){holds.preStep=null;let go;const gate=hold.release?new Promise(r=>go=r):parked;hold.resolve({agent:event.agent,messages:event.messages,release:()=>go?.()});await gate;}
   return next();
  },true);
 },true);
 ctx.on('schedule/resolve-agent',async(sessionId,next)=>{
  const hold=holds.resolve;
  if(hold&&!hold.known.has(sessionId)&&ctx.agents.get(sessionId)){holds.resolve=null;hold.resolve(sessionId);await parked;}
  return next();
 },true);
 ctx.provide('lifecycleFixture',control);
 const plugin=await ctx.plugin(Tasks,config);control.disable=()=>plugin.dispose();
}
