import {isScheduleTool,UNAVAILABLE} from './schedule-scope.mjs';
// Install on the actual Agent plane. Dynamic service lookup survives provider HMR;
// no permanent restrict([]), since a newly created main root is admitted after setup.
const installed=globalThis[Symbol.for('dsh.character.session-boundary.v1')]??=new WeakSet();
export function protectSession(agent){
 if(installed.has(agent))return;installed.add(agent);
 const own=agent.ctx,allowed=caller=>{try{return own.get('characterIdentity')?.isCurrentAgent(caller)===true;}catch{return false;}};
 own.get('tools').guard(exec=>{
  if(!allowed(exec?.agent))return 'Historical or unbound QQ Session: tools are disabled';
  if(!isScheduleTool(exec.name))return undefined;
  // DSH 0.2.2 Schedule tools are Host-wide; keep Owner roots on this Session.
  try{const service=own.get('characterIdentity');return typeof service?.scheduleToolDenial==='function'?service.scheduleToolDenial(exec):UNAVAILABLE;}catch{return UNAVAILABLE;}
 });
 own.on('agent/pre-step',async({agent:caller},next)=>allowed(caller)?next():{kind:'reject'});
 own.on('agent/request',async({agent:caller},next)=>{if(!allowed(caller))throw Error('Historical or unbound QQ Session cannot call the model');return next();});
 // rc.2 Schedule resolves already-live roots without agent/created. Refuse an
 // unproven receipt before followup appends/flushes it, not after delivery has
 // been acknowledged. This is a Host admission fence, not a second inbox/loop.
 if(typeof agent.followup==='function'){
  const followup=agent.followup;
  agent.followup=function(message){
   if(message?.source?.kind==='schedule'&&own.get('characterIdentity')?.canDeliverReminder(agent)!==true)throw Error('Unproven QQ reminder ownership; inbox admission blocked');
   return followup.call(this,message);
  };
 }
}
