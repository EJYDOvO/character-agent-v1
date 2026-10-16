import { createHash } from 'node:crypto';
export class Identity {
  #contexts = new WeakSet();
  constructor({appId,ownerId,characterId='character-a',projectId='personal'}){if(!appId||!ownerId)throw Error('Owner binding required');Object.assign(this,{appId,ownerId,characterId,projectId});this.sessions=new Map();}
  bind({appId,scope,senderId,peerId,sessionId}) {
    if(appId!==this.appId||scope!=='c2c'||senderId!==this.ownerId||peerId!==this.ownerId||!sessionId)throw Error('Owner private context required');
    const digest=createHash('sha256').update(`${appId}:c2c:${peerId}`).digest('hex');
    const ctx=Object.freeze({principalId:`owner-${digest.slice(0,24)}`,characterId:this.characterId,conversationId:`qq-${digest}`,projectId:this.projectId,sessionId,role:'character'});
    this.#contexts.add(ctx);this.sessions.set(sessionId,ctx);return ctx;
  }
  forSession(id){const ctx=this.sessions.get(id);if(!ctx)throw Error('Session is not bound to trusted QQ owner');return ctx;}
  authorize(ctx,action){if(!this.#contexts.has(ctx)||!['read','write','send'].includes(action)||ctx.role!=='character')throw Error('Unauthorized context');return ctx;}
}
