import { MemoryStore } from './store.mjs';
export const name='character-memory-core';
export const inject=['characterIdentity'];
export function apply(ctx,config){
  const identity=ctx.get('characterIdentity');const store=new MemoryStore(config.database,(c,a)=>identity.authorize(c,a));
  ctx.provide('characterMemory',store);
  ctx.on('session/event',(session,event)=>{
    if(event.type!=='user/message'||config.autoCapture===false)return;
    try{const trusted=identity.forSession(session.header.id);const text=(event.data?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
      store.capture(trusted,session.header.id,event.seq??session.seq,text);
    }catch{/* Background capture never interrupts the QQ turn. Unknown identities are rejected. */}
  });
  ctx.effect(()=>()=>store.close());
}
