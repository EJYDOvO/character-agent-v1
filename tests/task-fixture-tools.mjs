import {defineTool} from '@deepseek-ai/dsh-tools';
export const name='synthetic-task-tools';
export const inject=['tools'];
export function apply(ctx){ctx.tools.register(defineTool({name:'task_fixture_read',description:'Synthetic bounded read',parameters:{},output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},execute(){const key=Symbol.for('fixture.tasks.read.calls');globalThis[key]=(globalThis[key]??0)+1;return '{"ok":false,"error":"synthetic offline read"}';}}));
 // Outlasts the lifecycle gate's 15 s first activity-report window (synthetic runs on a real Host take ~3-4 s).
 ctx.tools.register(defineTool({name:'task_fixture_slow',description:'Synthetic slow bounded work',parameters:{},output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},async execute(_args,execution){await new Promise((resolve,reject)=>{const t=setTimeout(resolve,20000);execution?.signal?.addEventListener('abort',()=>{clearTimeout(t);reject(execution.signal.reason);},{once:true});});return 'synthetic slow work finished';}}));
}
