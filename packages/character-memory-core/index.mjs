import { LayeredMemory } from './layered.mjs';
import { processJob, EXTRACTION_PROMPT } from './extraction.mjs';
import { CONSOLIDATION_PROMPT } from './personality.mjs';
import { observeLifecycle } from './lifecycle.mjs';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { isAbsolute } from 'node:path';
import { requireMemoryIdentity } from './identity-contract.mjs';
export const name='character-memory-core';
export const inject=['memoryIdentity','llm','agents','agentDefaultModel'];
export function apply(ctx,config){
 if(!config.database||!isAbsolute(config.database))throw Error('An explicit absolute project database path is required');
 const identity=requireMemoryIdentity(ctx.get('memoryIdentity'));
 // The installed SDK uses a character heuristic. The store uses a more
 // conservative Unicode-aware estimate; it is not a model tokenizer.
 const store=new LayeredMemory(config.database,(c,a)=>identity.authorize(c,a),{consolidateIntervalMs:config.consolidateIntervalMs??21600000});
 let closed=false,busy=false,lastActivity=Date.now();const abort=new AbortController();
 ctx.provide('characterMemory',store);ctx.provide('dshMemory',store);
 const removeIngress=identity.onEvidence((trusted,evidence)=>{
  lastActivity=Date.now();
  try{store.noteInput(trusted,evidence);}catch{ctx.logger?.warn('Memory topic rejected');}
  if(config.autoCapture===false)return;
  try{if(evidence.text?.trim().length>=8&&!/^confirm:/u.test(evidence.text))store.enqueue(trusted,evidence);}catch{ctx.logger?.warn('Memory evidence rejected');}
 });
 ctx.on('session/event',(session,event)=>{
  if(config.autoCapture===false)return;
  try{if(observeLifecycle(store,identity,ctx.agents,session,event))lastActivity=Date.now();}catch{ctx.logger?.warn('Memory lifecycle requires a trusted live Session');}
 });
 async function generate(trusted,input,system,purpose){
  const agent=ctx.agents.get(trusted.sessionId);if(!agent||agent.status==='running')throw Error('Memory work requires idle Agent');
  const route=agent.session.requestHeader()?.config??ctx.agentDefaultModel.currentSelection();
  if(!route?.provider||!route.model)throw Error('Memory model route unavailable');
  const assembler=new BlockAssembler(),signal=AbortSignal.any([abort.signal,AbortSignal.timeout(config.extractTimeoutMs??45000)]);
  for await(const chunk of ctx.llm.stream({provider:route.provider,model:route.model,system,messages:[createUserMessage({content:[{type:'text',text:JSON.stringify(input)}],source:{kind:purpose}})],sessionId:trusted.sessionId,maxTokens:2400,purpose,signal}))assembler.push(chunk);
  signal.throwIfAborted();if(assembler.finish.kind!=='stop')throw Error('Memory stream incomplete');
  const blocks=assembler.blocks();if(blocks.some(b=>!['text','reasoning'].includes(b.type)))throw Error('Non-text memory output');
  const text=blocks.filter(b=>b.type==='text').map(b=>b.text).join('');if(!text.trim())throw Error('Empty memory output');return text;
 }
 async function drain(){
  if(busy||closed||config.autoCapture===false||Date.now()-lastActivity<(config.idleMs??10000))return;busy=true;
  try{
   for(const job of store.db.prepare("SELECT * FROM extraction_jobs WHERE status='pending' AND attempts<3 ORDER BY at LIMIT 4").all()){
    if(closed)break;
    let trusted;try{trusted=identity.forSession(job.session);}catch{try{trusted=identity.current(JSON.parse(job.scope));}catch{continue;}}
    const agent=ctx.agents.get(trusted.sessionId);if(!agent||agent.status==='running')continue;
    store.db.prepare("UPDATE extraction_jobs SET status='running',attempts=attempts+1 WHERE id=?").run(job.id);
    try{const result=await processJob(store,identity,job,input=>generate(trusted,input,EXTRACTION_PROMPT,'memory-extraction'));
     if(!closed)store.db.prepare("UPDATE extraction_jobs SET status='done',error=?,evidence='{}' WHERE id=? AND status='running'").run(JSON.stringify(result),job.id);
    }catch(error){if(!closed)store.db.prepare("UPDATE extraction_jobs SET status=CASE WHEN ? OR attempts>=3 THEN 'failed' ELSE 'pending' END,error=? WHERE id=? AND status='running'").run(error?.code==='MEMORY_SOURCE_REVIEW'?1:0,error?.code==='MEMORY_SOURCE_REVIEW'?'source_review_required':'extraction_failed',job.id);}
   }
   if(!closed&&config.consolidation!==false)for(const trusted of store.activeContexts()){
    if(closed)break;
    const agent=ctx.agents.get(trusted.sessionId);if(!agent||agent.status==='running')continue;
    try{await store.consolidate(trusted,input=>generate(trusted,input,CONSOLIDATION_PROMPT,'memory-consolidation'));}catch{ctx.logger?.warn('Memory consolidation deferred or rejected');}
   }
  }finally{busy=false;}
 }
 ctx.effect(()=>{const timer=setInterval(()=>void drain().catch(()=>ctx.logger?.warn('Memory background cycle failed')),5000);return()=>{closed=true;abort.abort();clearInterval(timer);removeIngress();store.close();};});
}
