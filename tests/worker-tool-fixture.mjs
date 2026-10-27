// Native Preset fixture: minimal dependency, no Character services or authority.
import {defineTool} from '@deepseek-ai/dsh-tools';
export const inject=['tools'];
export const calls=new Map();
export function apply(ctx){ctx.tools.register(defineTool({name:'worker_fixture_tool',description:'Explicitly installed scoped fixture tool',parameters:{},output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},execute(_args,{agent}){calls.set(agent.id,(calls.get(agent.id)??0)+1);return 'preset-tool-executed';}}));}
