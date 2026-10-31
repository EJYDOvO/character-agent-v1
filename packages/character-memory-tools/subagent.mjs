// rc.3 may keep an Agent published while its Context is already disposed.
// A standing Spawn reload must not inject tools into that closing Context.
// Keep the native schema, implementation, providers and permission checks.
import {apply as nativeApply} from '@deepseek-ai/dsh-tool-subagent';
export {Config,inject,name} from '@deepseek-ai/dsh-tool-subagent';
export function apply(ctx,config,session){
 let registry,view;
 const nativeContext=new Proxy(ctx,{get(target,key,receiver){
  if(key!=='get')return Reflect.get(target,key,receiver);
  return name=>{
   const service=target.get(name);if(name!=='agents'||!service)return service;
   if(registry!==service){registry=service;view=new Proxy(service,{get(agents,property,agentReceiver){
    if(property!=='list')return Reflect.get(agents,property,agentReceiver);
    return (...args)=>agents.list(...args).filter(agent=>{
     try{agent.ctx.fiber.assertActive();return true;}
     catch(error){if(error?.code==='INACTIVE_EFFECT')return false;throw error;}
    });
   }});}
   return view;
  };
 }});
 return nativeApply(nativeContext,config,session);
}
