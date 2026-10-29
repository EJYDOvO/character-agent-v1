import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Interaction, options, replyPolicy } from './policy.mjs';
export const name='interaction-policy';
export const inject=['systemPrompt','llm'];
const PERSONA_SECTIONS=['deployment:persona-prefix','deployment:persona-suffix'];
export const hangOnPrompt=persona=>`${persona?persona+'\n\n':''}【等待提示】当前请求仍在处理中，还没有结果。请沿用上面的 Persona 语气，写一句不超过 30 字的简短等待提示，只表达仍在处理、请对方稍等。不要描述进度、步骤、结果或剩余时间，不要承诺，不要提问，不使用数字、Markdown 或引号。只输出这一句话。`;
// hangon-model.json holds exactly {provider, model}. Missing means inherit.
export function hangOnModel(file,read=readFileSync){
 if(!file)return null;
 let raw;try{raw=read(file,'utf8');}catch(error){if(error?.code==='ENOENT')return null;throw Error('hangon-model.json unreadable');}
 const value=JSON.parse(raw.replace(/^﻿/u,''));
 const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[];
 if(keys.join()!=='model,provider'||[value.provider,value.model].some(v=>typeof v!=='string'||!v.trim()||v.length>200))throw Error('hangon-model.json must contain only provider and model');
 return {provider:value.provider,model:value.model};
}
export function apply(ctx,input={}){
 const config=options(input);if(!config.enabled)return;
 const controllers=new Map();let disposed=false,warned='';
 const warn=message=>{if(warned!==message){warned=message;ctx.logger?.warn?.(message);}};
 const route=agent=>{
  try{const own=hangOnModel(config.hangOnModelFile);if(own)return own;}catch(error){warn('Interaction hang-on model ignored: '+error.message);}
  const header=agent.session?.requestHeader?.()?.config;if(header?.provider&&header.model)return {provider:header.provider,model:header.model};
  let selected;try{selected=ctx.get('agentDefaultModel')?.currentSelection?.();}catch{}
  if(selected?.provider&&selected.model)return {provider:selected.provider,model:selected.model};
  throw Error('Hang-on model route unavailable');
 };
 // Only the scoped Persona sections are read. Running the full assembly would
 // invoke Memory and other context providers for a presentation-only line.
 const persona=agent=>{
  const sections=ctx.systemPrompt.layers?.merge?.(agent,layer=>layer.sections);
  if(!sections)throw Error('Persona sections unavailable');
  return PERSONA_SECTIONS.map(id=>{const s=sections.get(id);return String((typeof s?.text==='function'?s.text({agent,scope:agent}):s?.text)??'');}).join('\n\n').trim().slice(0,8000);
 };
 // No sessionId or purpose: the call stays outside Session checkpoints, titles
 // and history. The result is presentation only and is never persisted.
 const drafter=async({agent,state,signal})=>{
  const target=route(agent),system=hangOnPrompt(persona(agent));
  const message={id:randomUUID(),role:'user',source:{kind:'interaction-hang-on'},content:[{type:'text',text:state==='tool'?'当前状态：正在执行工具。':'当前状态：正在处理。'}]};
  let text='',finish;
  for await(const chunk of ctx.llm.stream({...target,system,messages:[message],maxTokens:256,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])})){
   if(chunk.type==='text-delta')text+=chunk.text;
   else if(chunk.type==='tool-call-delta')throw Error('Hang-on draft requested a tool');
   else if(chunk.type==='finish')finish=chunk.reason;
  }
  if(finish?.kind!=='stop')throw Error('Hang-on draft incomplete');
  return text;
 };
 // Native scoped callbacks admit real Agents. The public lookup cannot enroll
 // an arbitrary Agent or a model-supplied Session ID.
 const admit=agent=>{
  if(disposed||!agent?.session)throw Error('Interaction scope unavailable');
  let policy=controllers.get(agent);if(!policy){policy=new Interaction(agent,config,undefined,drafter);controllers.set(agent,policy);}return policy;
 };
 const get=agent=>{const p=controllers.get(agent);if(disposed||!p)throw Error('Agent outside Interaction scope');return p;};
 ctx.provide('interactionPolicy',Object.freeze({contractVersion:1,get}));
 // This is a native serial hook: returning a value would consume the event and
 // prevent later listeners (including Creator's subagent tools) from running.
 ctx.on('agent/created',({agent})=>{admit(agent);});
 ctx.systemPrompt.context({name:'interaction:reply-policy',order:85,text:({agent}={})=>{if(agent)admit(agent);return replyPolicy;}});
 ctx.on('agent/assistant-stream',({agent,frame})=>admit(agent).frame(frame));
 ctx.on('session/event',(session,event)=>{for(const [agent,policy]of controllers)if(agent.session===session)policy.event(event);});
 ctx.on('agent/status',({agent,status})=>{const p=admit(agent);if(status==='idle'&&p.active){p.active=false;p.invalidate();}});
 ctx.on('agent/disposed',async({agent})=>{const p=controllers.get(agent);controllers.delete(agent);await p?.dispose();});
 ctx.effect(()=>async()=>{disposed=true;await Promise.all([...controllers.values()].map(p=>p.dispose()));controllers.clear();});
}
