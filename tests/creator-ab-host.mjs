// Small real-provider comparison, not a general intelligence/approval benchmark.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
const sdk=(process.env.DSH_CHARACTER_HOST_ROOT||process.env.DSH_INSTALL_ROOT)+'/resources/app.asar/dsh/node_modules/@deepseek-ai/';
const {createUserMessage}=await import(pathToFileURL(sdk+'dsh-llm/lib/index.js').href);
const {defineTool}=await import(pathToFileURL(sdk+'dsh-tools/lib/index.js').href);
export const name='real-creator-character-ab';export const inject=['agents','agentPresets','tools'];
export function apply(ctx,config){ctx.effect(()=>{const timer=setTimeout(()=>void run(),1000);return()=>clearTimeout(timer);});
 async function run(){const report={ok:false,runId:config.runId,provenance:config.provenance,host:config.version,modelRoute:config.modelRoute,realModel:true,qqNetwork:false,tasks:[],limitations:['Two synthetic tasks per preset; identical restricted lookup tool; no real approval or delegated quality evaluation','Actual configured Persona is used privately; no prompts, answers or credentials in this report']};let handle;
 try{for(const preset of ['cordis','qq-character'])for(const task of ['arithmetic','lookup']){
  const lookupValue='fixture-'+randomUUID().slice(0,8);let calls=0;
  handle=await ctx.agents.create({sessionId:randomUUID(),agentOptions:config.modelRoute,meta:{cwd:config.cwd,agentPreset:preset},setup:async c=>{await ctx.agentPresets.mount(c,preset);}});const agent=handle.agent;
  agent.ctx.tools.register(defineTool({name:'ab_lookup',description:'Look up the synthetic acceptance record. Use this to obtain its current value.',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(){calls++;return lookupValue;}}));
  agent.ctx.tools.restrict({allow:[]});assert.deepEqual([...ctx.tools.view(agent).visible.keys()].sort(),['ab_lookup','subagent']);agent.ctx.tools.guard(exec=>exec.name==='ab_lookup'?undefined:'A/B fixture only permits synthetic lookup execution');assert(ctx.tools.guardReason({agent,name:'subagent'}));
  const start=Date.now(),begin=agent.session.seq;const prompt=task==='arithmetic'?'请计算 17 乘以 23，给出结果。':'请调用 ab_lookup 查询合成验收记录，回复工具给出的完整值，不要猜测。';
  agent.followup(createUserMessage({content:[{type:'text',text:prompt}],source:{kind:'user'}}));
  let timer;try{await Promise.race([agent.whenIdle(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Real provider A/B timed out')),75000);})]);}finally{clearTimeout(timer);}
  const events=Array.from({length:agent.session.seq-begin},(_,i)=>agent.session.eventAt(begin+i));const answers=events.filter(e=>e.type==='assistant/message').map(e=>JSON.stringify(e.data??e.payload??e));
  const usage=events.filter(e=>e.type==='assistant/message').map(e=>e.data??e.payload??{}).flatMap(e=>e.usage?[e.usage]:[]);
  const success=task==='arithmetic'?answers.some(s=>s.includes('391')):calls>0&&answers.some(s=>s.includes(lookupValue));
  report.tasks.push({preset,task,success,toolCalls:calls,elapsedMs:Date.now()-start,usage});await handle.dispose();handle=null;
 }report.ok=report.tasks.length===4&&report.tasks.every(t=>t.success);
 }catch(error){fs.writeFileSync(config.cwd+'/ab-error.private.log',error.stack);report.errorType=error.name;report.error=error.message.includes('timed out')?'provider_timeout':'isolated_ab_failed';}finally{await handle?.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
