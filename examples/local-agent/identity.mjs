// Example for a trusted, single-user local DSH project. This is not a multi-user login system.
export const name='local-project-memory-identity';
export const inject=['agents','agentPresets'];
export function apply(ctx,config){
 for(const key of ['principalId','namespaceId','projectId','allowedPresetId'])if(typeof config[key]!=='string'||!config[key])throw Error('Explicit local identity '+key+' required');
 const handles=new Map(),issued=new WeakSet(),listeners=new Set(),latest=new Map();let closed=false;
 const scope=Object.freeze({principalId:config.principalId,namespaceId:config.namespaceId,projectId:config.projectId,agentId:config.agentId??config.allowedPresetId,memoryMode:config.memoryMode??'off',l3Tokens:config.l3Tokens});
 function agentFor(id){const a=ctx.agents.get(id);if(!a||ctx.agentPresets.composedPreset(a.ctx)!==config.allowedPresetId)throw Error('Session not authorized for this local project');return a;}
 const provider=Object.freeze({contractVersion:1,
  forSession(id){if(closed)throw Error('Identity disposed');const agent=agentFor(id);let entry=handles.get(id);if(entry?.agent!==agent){if(entry)issued.delete(entry.handle);const handle=Object.freeze({...scope,sessionId:id});issued.add(handle);entry={agent,handle};handles.set(id,entry);}return entry.handle;},
  authorize(handle,action){if(closed||!issued.has(handle)||!['read','write'].includes(action))throw Error('Unauthorized local memory capability');const entry=handles.get(handle.sessionId);if(entry?.handle!==handle||agentFor(handle.sessionId)!==entry.agent)throw Error('Revoked session');return scope;},
  current(wanted){for(const entry of handles.values())try{provider.authorize(entry.handle,'read');if(!wanted||JSON.stringify(wanted)===JSON.stringify([scope.principalId,scope.namespaceId,scope.projectId]))return entry.handle;}catch{}throw Error('No authorized live session');},
  onEvidence(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  confirmationEvidence(handle,{memory,quote}){provider.authorize(handle,'write');const e=latest.get(handle.sessionId);if(!e||Date.now()-e.receivedAt>600000||quote!==e.text||quote!==`confirm:${memory.id}`)throw Error('Exact recent local Host confirmation required');return {sessionId:e.sessionId,eventSeq:e.eventSeq,messageId:e.messageId,origin:'direct_user',quote:e.text,confirmedAt:new Date().toISOString()};}
 });
 ctx.provide('memoryIdentity',provider);
 // Only authenticated Host ingress code may call this service. Never register it as a model tool.
 ctx.provide('localMemoryIngress',Object.freeze({admit(agent,{messageId,text,eventSeq}){
  if(agentFor(agent.session.header.id)!==agent||typeof messageId!=='string'||!messageId||typeof text!=='string'||!Number.isSafeInteger(eventSeq))throw Error('Trusted local ingress required');
  const handle=provider.forSession(agent.session.header.id);const evidence=Object.freeze({sessionId:handle.sessionId,eventSeq,messageId,text,origin:'direct_user',receivedAt:Date.now()});
  latest.set(handle.sessionId,evidence);
  for(const listener of listeners)listener(handle,evidence);
 }}));
 ctx.effect(()=>()=>{closed=true;for(const e of handles.values())issued.delete(e.handle);handles.clear();listeners.clear();latest.clear();});
}
