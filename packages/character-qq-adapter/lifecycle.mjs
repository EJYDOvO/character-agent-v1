// Host-only composition hook. Neither a Preset nor Remote Ops owns admission.
const leases=new WeakMap();
export async function activate(ctx,config,upstream){
 const presetId=config.preset??'qq-character',identity=ctx.get('characterIdentity');
 if(leases.has(identity))throw Error('Duplicate Character QQ gateway');
 identity.validateGateway(config);
 const lease={};leases.set(identity,lease);
 try{const preset=await ctx.get('agentPresets')?.resolve(presetId);if(!preset||preset.broken||preset.id!==presetId)throw Error('Character preset unavailable');}catch(e){leases.delete(identity);throw e;}
 let detach,closed=false;
 const attach=runtime=>{
  if(closed||detach)throw Error('Duplicate or disposed Character gateway');
  if(runtime.platform!=='qq-official'||runtime.adapter!=='qq-official-gateway'||runtime.accountId!==config.appId)throw Error('Character Gateway scope mismatch');
  const manager=runtime.manager,compose=manager.composePreset;
  const guarded=async function(id){
   if(id!==presetId)throw Error('Only Character preset is allowed');
   const result=await compose.call(this,id);
   if(result.agentPreset!==presetId||!result.setup)throw Error('Character preset unavailable; fallback prohibited');
   return result;
  };
  manager.composePreset=guarded;
  let release;try{release=identity.attach(runtime);}catch(error){manager.composePreset=compose;throw error;}
  let released=false;
  detach=()=>{if(released)return;released=true;release();if(manager.composePreset===guarded)manager.composePreset=compose;};
  return Object.freeze({close:detach,notifyEvent:({eventId,kind,text})=>{
   if(closed||released)throw Error('Character Gateway detached');
   return identity.notifySystem({eventId,kind,text,target:{scope:'c2c',targetId:runtime.config.access.c2cAllow[0]}});
  }});
 };
 const cleanup=()=>{if(closed)return;closed=true;detach?.();if(leases.get(identity)===lease)leases.delete(identity);};
 try{ctx.effect(()=>cleanup);await upstream(ctx,config,{qqGatewayLifecycle:Object.freeze({contractVersion:1,attach})});}catch(e){cleanup();throw e;}
}
