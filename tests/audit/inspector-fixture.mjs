import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {LayeredMemory} from '../../packages/character-memory-core/layered.mjs';
export function fixture(mode='assistant'){
 const issued=new WeakMap(),c={sessionId:'audit-session'},scope={principalId:'fixture-owner',namespaceId:'fixture-space',projectId:'fixture-project',agentId:'agent-a',memoryMode:mode};issued.set(c,scope);
 const authorize=(h)=>{const s=issued.get(h);if(!s)throw Error('Unauthorized capability');return s;};const file=join(mkdtempSync(join(tmpdir(),'inspector-audit-')),'memory.sqlite');let memory=new LayeredMemory(file,authorize);
 const source=(n,text='新鲜的管理证据')=>({sessionId:c.sessionId,eventSeq:n,messageId:'event-'+n,origin:'direct_user',quote:text});
 function personal(){for(let n=1;n<=2;n++)memory.admit(c,{...source(n),text:'每次排查故障我都会先核对变更记录，第'+n+'次。'});const input=memory.consolidationInput(c);memory.applyConsolidation(c,input,{memories:[{purpose:'user',kind:'procedural',statement:'用户排查故障时偏好先核对变更记录。',evidence:input.events.map(e=>({id:e.id,quote:e.text}))}]});return memory.recall(c,'变更')[0];}
 return {c,scope,issued,authorize,file,source,personal,get memory(){return memory;},reopen(){memory.close();memory=new LayeredMemory(file,authorize);}};
}
