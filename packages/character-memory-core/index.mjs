import { MemoryStore } from './store.mjs';
import { processJob, EXTRACTION_PROMPT } from './extraction.mjs';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
export const name='character-memory-core';
export const inject=['characterIdentity','llm','agents','agentDefaultModel'];
export function apply(ctx,config){
 const identity=ctx.get('characterIdentity'),store=new MemoryStore(config.database,(c,a)=>identity.authorize(c,a));
 let closed=false,busy=false;const abort=new AbortController();
 ctx.provide('characterMemory',store);
 const removeIngress=identity.onIngress((trusted,evidence)=>{if(config.autoCapture!==false)store.enqueue(trusted,evidence);});
 async function drain(){
  if(busy||closed||config.autoCapture===false)return;busy=true;
  try{for(const job of store.db.prepare("SELECT * FROM extraction_jobs WHERE status='pending' AND attempts<3 ORDER BY at LIMIT 4").all()){
   if(closed)break;
   let trusted;try{trusted=identity.forSession(job.session);}catch{try{trusted=identity.current();}catch{continue;}}
   const agent=ctx.agents.get(trusted.sessionId);if(!agent||agent.status==='running')continue;
   const route=agent.session.requestHeader()?.config??ctx.agentDefaultModel.currentSelection();
   if(!route?.provider||!route.model)continue;
   store.db.prepare("UPDATE extraction_jobs SET status='running',attempts=attempts+1 WHERE id=?").run(job.id);
   try{
    const result=await processJob(store,identity,job,async input=>{
     const assembler=new BlockAssembler();
     const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(config.extractTimeoutMs??45000)]);
     for await(const chunk of ctx.llm.stream({provider:route.provider,model:route.model,system:EXTRACTION_PROMPT,messages:[createUserMessage({content:[{type:'text',text:JSON.stringify(input)}],source:{kind:'character-memory-extraction'}})],sessionId:job.session,maxTokens:1600,purpose:'memory-extraction',signal}))assembler.push(chunk);
     signal.throwIfAborted();if(assembler.finish.kind!=='stop')throw Error('Extraction stream failed: '+JSON.stringify(assembler.finish));const blocks=assembler.blocks();if(blocks.some(b=>!['text','reasoning'].includes(b.type)))throw Error('Non-text extraction output');const text=blocks.filter(b=>b.type==='text').map(b=>b.text).join('');if(!text.trim())throw Error('Empty extraction output');return text;
    });
    if(!closed)store.db.prepare("UPDATE extraction_jobs SET status='done',error=?,evidence='{}' WHERE id=?").run(JSON.stringify(result),job.id);
   }catch{if(!closed)store.db.prepare("UPDATE extraction_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,error='extraction_failed' WHERE id=?").run(job.id);}
  }}finally{busy=false;}
 }
 ctx.effect(()=>{const timer=setInterval(()=>void drain(),5000);return()=>{closed=true;abort.abort();clearInterval(timer);removeIngress();store.close();};});
}
