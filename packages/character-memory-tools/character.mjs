import { defineTool } from '@deepseek-ai/dsh-tools';
import { apply as applyMemoryTools } from './index.mjs';
import {rootWorkerPolicy} from './worker-policy.mjs';
import {rootExecutionPolicy} from './root-policy.mjs';
export const name='character-memory-tools';
export const inject=['tools','systemPrompt','memoryIdentity','dshMemory','characterIdentity'];
export function apply(ctx,config={}){
 applyMemoryTools(ctx,{toolPrefix:'character',legacyQueueNames:true});
 const identity=ctx.get('characterIdentity');
 ctx.tools.register(defineTool({name:'character_notifications',description:'检查明确触发的 QQ 通知账本；sent 仅代表 API 接受，unknown 不自动重发。',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute(_args,exec){const trusted=identity.forSession(exec.agent.session.header.id);return JSON.stringify(identity.inspect(trusted));}}));
  ctx.effect(()=>ctx.systemPrompt.section({name:'character:execution',order:100,text:rootExecutionPolicy}));
 ctx.effect(()=>ctx.systemPrompt.section({name:'character:workers',order:105,text:rootWorkerPolicy(config.workerPresets,config.communityWorkerPresets,{characterPresetId:config.characterPresetId??'qq-character'})}));
}
