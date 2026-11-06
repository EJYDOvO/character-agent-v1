import {setTimeout as delay} from 'node:timers/promises';
// Host-only composition hook. Neither a Preset nor Remote Ops owns admission.
const leases=new WeakMap();
export async function activate(ctx,config,upstream){
 const presetId=config.preset??'qq-character',identity=ctx.get('characterIdentity');
 if(leases.has(identity))throw Error('Duplicate Character QQ gateway');
 identity.validateGateway(config);
 const lease={};leases.set(identity,lease);
 let detach,closed=false;const abort=new AbortController();
 const cleanup=()=>{if(closed)return;closed=true;abort.abort();detach?.();if(leases.get(identity)===lease)leases.delete(identity);};
 ctx.effect(()=>cleanup);
 // Owner Presets (current and legacy) and, with roles, the role Presets; each must resolve now.
 const presets=identity.allowedPresets?.()??{owner:[presetId],roles:[]},allowed=new Set([...presets.owner,...presets.roles]);
 try{if(!presets.owner.includes(presetId))throw Error('Character preset unavailable');for(const id of allowed){const registry=ctx.get('agentPresets'),deadline=Date.now()+2000;let preset;
 for(;;){if(closed)throw Error('Character Gateway disposed during preset registration');try{preset=await registry?.resolve(id);break;}catch(error){
  // Native declarations initialize concurrently on 0.2.2. Wait only for this
  // specific transient absence; broken presets and all other errors fail closed.
  if(error?.code!=='agent-preset/not-found'||Date.now()>=deadline)throw error;
  await delay(20,undefined,{signal:abort.signal});
 }}
if(!preset||preset.broken||preset.id!==id)throw Error('Character preset unavailable');}}catch(e){cleanup();throw e;}
 const attach=runtime=>{
  if(closed||detach)throw Error('Duplicate or disposed Character gateway');
  if(runtime.platform!=='qq-official'||runtime.adapter!=='qq-official-gateway'||runtime.accountId!==config.appId)throw Error('Character Gateway scope mismatch');
  const manager=runtime.manager,compose=manager.composePreset;
  const guarded=async function(id){
   if(!allowed.has(id))throw Error('Only Character preset is allowed');
   const result=await compose.call(this,id);
   if(result.agentPreset!==id||!result.setup)throw Error('Character preset unavailable; fallback prohibited');
   return result;
  };
  manager.composePreset=guarded;
  let release;try{release=identity.attach(runtime);}catch(error){manager.composePreset=compose;throw error;}
  let released=false;
  detach=()=>{if(released)return;released=true;release();if(manager.composePreset===guarded)manager.composePreset=compose;};
  return Object.freeze({close:detach,notifyEvent:({eventId,kind,text})=>{
   if(closed||released)throw Error('Character Gateway detached');
   return identity.notifySystem({eventId,kind,text});
  }});
 };
 try{if(closed)throw Error('Character Gateway disposed before startup');await upstream(ctx,config,{qqGatewayLifecycle:Object.freeze({contractVersion:1,attach})});}catch(e){cleanup();throw e;}
}
