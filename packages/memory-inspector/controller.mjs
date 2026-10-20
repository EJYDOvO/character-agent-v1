import {randomUUID} from 'node:crypto';

// No browser-provided identity, project, namespace or Session can mint authority.
export function controller(memory,identity,{writable=false}={}){
 function contexts(){
  const candidates=memory.activeContexts();try{candidates.push(identity.current());}catch{}
  const unique=new Map();for(const handle of candidates)try{const p=memory.policy(handle);unique.set(handle.sessionId,{handle,p});}catch{}
  return unique;
 }
 return (request)=>{
  if(!request||typeof request!=='object'||Array.isArray(request))throw Error('Invalid request');
  const {operation='contexts',context,filter,id,revision,targetRevision,statement}=request;
  if(Object.keys(request).some(k=>!['operation','context','filter','id','revision','targetRevision','statement'].includes(k)))throw Error('Unknown request field');
  const entries=contexts();
  if(operation==='contexts')return {writable,contexts:[...entries].map(([id,{p}])=>({id,agent:p.agentId,mode:p.mode,scope:JSON.parse(p.key)}))};
  const selected=entries.get(context);if(!selected)throw Error('Unauthorized memory context');
  const c=selected.handle;memory.policy(c);
  if(operation==='browse')return memory.browse(c,filter);
  if(operation==='stats')return memory.inspectorStats(c);
  if(operation==='detail')return {...memory.trace(c,id),revisions:memory.revisionHistory(c,id)};
  if(!writable)throw Error('Inspector is read only');
  memory.policy(c,'write');
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('Revision required');
  if(!['correct','confirm','forget','restore'].includes(operation))throw Error('Unknown operation');
  // This endpoint is admitted only for the authenticated native Host owner.
  // Its input is a new explicit management action, not a forged QQ event.
  const source={sessionId:c.sessionId,eventSeq:0,messageId:'inspector:'+randomUUID(),origin:'direct_user',channel:'memory-inspector',quote:operation==='correct'?statement:operation+':'+id,confirmedAt:new Date().toISOString()};
  if(operation==='forget')return memory.forget(c,id,revision);
  if(operation==='correct')return memory.correct(c,id,statement,revision,source);
  if(operation==='confirm')return memory.confirm(c,id,revision,source);
  return memory.restoreRevision(c,id,targetRevision,revision,source);
 };
}
