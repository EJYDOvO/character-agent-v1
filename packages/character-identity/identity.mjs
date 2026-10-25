import { createHash } from 'node:crypto';
export class Identity {
  #contexts = new WeakSet();
  #sessions = new Map();
  #binding;
  constructor({appId,ownerId,characterId='character-a',projectId='personal'}){if(!appId||!ownerId)throw Error('Owner binding required');this.#binding=Object.freeze({appId,ownerId,characterId,projectId});}
  bind({appId,scope,senderId,peerId,sessionId}) {
    const b=this.#binding;
    if(appId!==b.appId||scope!=='c2c'||senderId!==b.ownerId||peerId!==b.ownerId||typeof sessionId!=='string'||!sessionId)throw Error('Owner private context required');
    if(this.#sessions.has(sessionId))return this.#sessions.get(sessionId);
    const digest=createHash('sha256').update(`${appId}:c2c:${peerId}`).digest('hex');
    const ctx=Object.freeze({principalId:`owner-${digest.slice(0,24)}`,characterId:b.characterId,conversationId:`qq-${digest}`,projectId:b.projectId,sessionId,role:'character'});
    this.#contexts.add(ctx);this.#sessions.set(sessionId,ctx);return ctx;
  }
  forSession(id){const ctx=this.#sessions.get(id);if(!ctx)throw Error('Session is not bound to trusted QQ owner');return ctx;}
  conversationScope(){const b=this.#binding,digest=createHash('sha256').update(`${b.appId}:c2c:${b.ownerId}`).digest('hex');return Object.freeze({principalId:`owner-${digest.slice(0,24)}`,characterId:b.characterId,conversationId:`qq-${digest}`,projectId:b.projectId});}
  revoke(id){const c=this.#sessions.get(id);if(c)this.#contexts.delete(c);this.#sessions.delete(id);}
  clear(){for(const id of this.#sessions.keys())this.revoke(id);}
  authorize(ctx,action){if(!this.#contexts.has(ctx)||this.#sessions.get(ctx.sessionId)!==ctx||!['read','write','send'].includes(action)||ctx.role!=='character')throw Error('Unauthorized context');return ctx;}
}
