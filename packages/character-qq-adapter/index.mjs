import * as upstream from '@tencent-connect/dsh-qqbot';
export const name='character-qq-adapter';
export const Config=upstream.Config;
export const inject=['agents','qqRemoteOps','characterIdentity','characterMemory'];
export async function apply(ctx,config){
  const remote=ctx.get('qqRemoteOps'),identity=ctx.get('characterIdentity');
  const previous=remote.attach;
  const attach=function(runtime){
    const original=runtime.manager.composePreset.bind(runtime.manager);
    runtime.manager.composePreset=async preset=>{
      const result=await original(preset);
      if(preset==='qq-character'&&(!result.agentPreset||!result.setup))throw Error('Character preset unavailable; host fallback prohibited');
      return result;
    };
    identity.attach(runtime);
    return previous.call(remote,runtime);
  };
  remote.attach=attach;
  ctx.effect(()=>()=>{if(remote.attach===attach)remote.attach=previous;});
  await upstream.apply(ctx,config);
}
