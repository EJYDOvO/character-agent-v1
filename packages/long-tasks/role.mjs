export const name='long-task-role';
export const inject=['tools','longTasks'];
export function apply(ctx,config={}){
 // rc.2 retains Preset tools on an ancestor plane. Restrict the actual Agent
 // after setup, when all configured task tools exist, before its loop starts.
 ctx.on('agent/created',({agent})=>{
  const own=agent.ctx,tasks=()=>own.get('longTasks');
  own.get('tools').restrict({allow:config.allowTools??[]});
  // The guard/gates belong to the actual Agent, so removal of the service's
  // dependency scope cannot remove the fail-closed boundary from a live root.
  own.get('tools').guard(({agent:caller,name})=>{try{const service=tasks();service.taskAgent(caller);if(!service.allowTools.includes(name)||!service.active.has(caller.id))return 'Background tool is not authorized for this run';return undefined;}catch{return 'Untrusted or disabled background task';}});
  own.on('agent/pre-step',async(event,next)=>tasks()&&await tasks().preStep(event.agent,event)?next():{kind:'reject'});
  own.on('agent/request',async(event,next)=>({...await next(),...tasks().taskAgent(event.agent).route}));
 });
}
