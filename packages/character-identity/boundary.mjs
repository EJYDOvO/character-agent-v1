import {isScheduleTool,UNAVAILABLE} from './schedule-scope.mjs';
const RETIRED='Historical or unbound QQ Session: tools are disabled';
const refusal=message=>({content:[{type:'text',text:'Error: '+message}],isError:true,error:{message}});
// Install on the actual Agent plane. Dynamic service lookup survives provider HMR;
// no permanent restrict([]), since a newly created main root is admitted after setup.
// v2 adds the execution-time Schedule check: an Agent fenced by an earlier
// boundary (provider HMR) is fenced again, so it never keeps the guard alone.
const installed=globalThis[Symbol.for('dsh.character.session-boundary.v2')]??=new WeakSet();
export function protectSession(agent){
 if(installed.has(agent))return;installed.add(agent);
 const own=agent.ctx,allowed=caller=>{try{return own.get('characterIdentity')?.isCurrentAgent(caller)===true;}catch{return false;}};
 own.get('tools').guard(exec=>{
  if(!allowed(exec?.agent))return RETIRED;
  if(!isScheduleTool(exec.name))return undefined;
  // DSH 0.2.2 Schedule tools are Host-wide; keep Owner roots on Owner reminders.
  try{const service=own.get('characterIdentity');return typeof service?.scheduleToolDenial==='function'?service.scheduleToolDenial(exec):UNAVAILABLE;}catch{return UNAVAILABLE;}
 });
 // Schedule ownership is re-verified when the call actually runs (after
 // approval waits and earlier calls of the batch), from a fresh native view, and
 // an edit is pinned to the verified revision. Missing service fails closed.
 own.on('tools/execute',async(exec,next)=>{
  if(!isScheduleTool(exec?.name))return next();
  if(!allowed(exec.agent))return refusal(RETIRED);
  let decision;
  try{const service=own.get('characterIdentity');decision=typeof service?.verifyScheduleCall==='function'?await service.verifyScheduleCall(exec):{denied:UNAVAILABLE};}catch{decision={denied:UNAVAILABLE};}
  if(decision?.denied)return refusal(decision.denied);
  if(!decision?.arguments)return next();
  const original=exec.arguments;exec.arguments=decision.arguments;
  try{return await next();}finally{exec.arguments=original;}
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
