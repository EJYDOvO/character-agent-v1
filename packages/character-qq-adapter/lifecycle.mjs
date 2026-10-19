// Host-only lifecycle: a preset never owns a gateway. No model-facing bind API.
const leases=new WeakMap();
export async function activate(ctx,config,upstream){
 const presetId=config.preset??'qq-character';
 const remote=ctx.get('qqRemoteOps'),identity=ctx.get('characterIdentity');
 if(leases.has(remote))throw Error('Duplicate Character QQ gateway');
 identity.validateGateway(config);
 const lease={};leases.set(remote,lease);
 try{const preset=await ctx.get('agentPresets')?.resolve(presetId);if(!preset||preset.broken||preset.id!==presetId)throw Error('Character preset unavailable');}catch(e){leases.delete(remote);throw e;}
 const previous=remote.attach;let detach,closed=false;
 const attach=function(runtime){
  if(closed||detach)throw Error('Duplicate or disposed Character gateway');
  const compose=runtime.manager.composePreset;
  runtime.manager.composePreset=async function(id){
   if(id!==presetId)throw Error('Only Character preset is allowed');
   const result=await compose.call(this,id);
   if(result.agentPreset!==presetId||!result.setup)throw Error('Character preset unavailable; fallback prohibited');
   return result;
  };
  const release=identity.attach(runtime);
  detach=()=>{release();runtime.manager.composePreset=compose;};
  // QQTK notifications go through the same durable ledger, not a second sender.
  const wrapped={...runtime,notifyEvent:({eventId,kind,text})=>identity.notifySystem({eventId,kind,text,target:{scope:'c2c',targetId:runtime.config.access.c2cAllow[0]}})};
  return previous.call(remote,wrapped);
 };
 remote.attach=attach;
 const cleanup=()=>{if(closed)return;closed=true;detach?.();if(remote.attach===attach)remote.attach=previous;if(leases.get(remote)===lease)leases.delete(remote);};
 ctx.effect(()=>cleanup);
 try{await upstream(ctx,config);}catch(e){cleanup();throw e;}
}
