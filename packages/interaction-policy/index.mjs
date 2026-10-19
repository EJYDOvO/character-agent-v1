import { Interaction, options, replyPolicy } from './policy.mjs';
export const name='interaction-policy';
export const inject=['systemPrompt'];
export function apply(ctx,input={}){
 const config=options(input);if(!config.enabled)return;
 const controllers=new Map();let disposed=false;
 // Native scoped callbacks admit real Agents. The public lookup cannot enroll
 // an arbitrary Agent or a model-supplied Session ID.
 const admit=agent=>{
  if(disposed||!agent?.session)throw Error('Interaction scope unavailable');
  let policy=controllers.get(agent);if(!policy){policy=new Interaction(agent,config);controllers.set(agent,policy);}return policy;
 };
 const get=agent=>{const p=controllers.get(agent);if(disposed||!p)throw Error('Agent outside Interaction scope');return p;};
 ctx.provide('interactionPolicy',Object.freeze({contractVersion:1,get}));
 // This is a native serial hook: returning a value would consume the event and
 // prevent later listeners (including Creator's subagent tools) from running.
 ctx.on('agent/created',({agent})=>{admit(agent);});
 ctx.systemPrompt.context({name:'interaction:reply-policy',order:85,text:({agent}={})=>{if(agent)admit(agent);return replyPolicy;}});
 ctx.on('agent/assistant-stream',({agent,frame})=>admit(agent).frame(frame));
 ctx.on('session/event',(session,event)=>{for(const [agent,policy]of controllers)if(agent.session===session)policy.event(event);});
 ctx.on('agent/status',({agent,status})=>{const p=admit(agent);if(status==='idle'&&p.active){p.active=false;p.invalidate();}});
 ctx.on('agent/disposed',async({agent})=>{const p=controllers.get(agent);controllers.delete(agent);await p?.dispose();});
 ctx.effect(()=>async()=>{disposed=true;await Promise.all([...controllers.values()].map(p=>p.dispose()));controllers.clear();});
}
