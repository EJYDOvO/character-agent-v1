import {defineTool} from '@deepseek-ai/dsh-tools';
export const name='synthetic-task-tools';
export const inject=['tools'];
export function apply(ctx){ctx.tools.register(defineTool({name:'task_fixture_read',description:'Synthetic bounded read',parameters:{},output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},execute(){const key=Symbol.for('fixture.tasks.read.calls');globalThis[key]=(globalThis[key]??0)+1;return '{"ok":false,"error":"synthetic offline read"}';}}));}
