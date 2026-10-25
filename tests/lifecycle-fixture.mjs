// Test provider is ready before overdue native Schedule resumes task roots.
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {defineTool} from '@deepseek-ai/dsh-tools';
import * as Tasks from '../packages/long-tasks/index.mjs';
export const name='isolated-task-fixture';
export const inject=['llm',...Tasks.inject];
export async function apply(ctx,config){
 const control={waiting:false,release(){}};
 globalThis[Symbol.for('fixture.tasks.read.calls')]=0;
 globalThis[Symbol.for('fixture.tasks.llm.calls')]=0;
 class Fixture extends LlmAdapter{async *stream(request){
  globalThis[Symbol.for('fixture.tasks.llm.calls')]++;
  const input=JSON.stringify(request.messages.filter(m=>m.role==='user')),tool=request.messages.some(m=>m.role==='tool');
  const name=input.includes('owner-busy-fixture')?'task_fixture_wait':input.includes('read-tool-fixture')?'task_fixture_read':null;
  if(name&&!tool){yield {type:'tool-call-delta',index:0,id:'fixture-call',name,argumentsDelta:'{}'};yield {type:'finish',reason:{kind:'stop'}};return;}
  yield {type:'text-delta',index:0,text:'Synthetic task result; goal not independently verified.'};yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['task-fixture'],new Fixture());
 ctx.tools.register(defineTool({name:'task_fixture_wait',description:'Hold synthetic user work',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){control.waiting=true;await new Promise(r=>control.release=r);return 'released';}}));
 ctx.provide('lifecycleFixture',control);
 const plugin=await ctx.plugin(Tasks,config);control.disable=()=>plugin.dispose();
}
