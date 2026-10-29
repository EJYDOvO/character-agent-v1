// Native mask over the Host-global tools a Worker inherits. It runs inside the
// Worker Preset's own composition, so it constrains only Agents bound to that
// Preset: ctx.tools.restrict() keeps presentation, lookup and execution aligned,
// and ctx.tools.guard() refuses execution in the window before a newly
// registered global tool is masked. Tools the Worker's own Preset mounts (for
// example ones an Owner adds through Preset Manager) stay usable.
// Not an approval path or second permission system.
import {workerToolAllowlist} from './worker-policy.mjs';
export const name='character-worker-tool-scope';
export const inject=['tools'];
export function apply(ctx,config={}){
 const allow=new Set(workerToolAllowlist(config.allow));
 const masked=()=>ctx.tools.schemas().map(s=>s.name).filter(n=>n!=='run_code'&&!allow.has(n)).sort();
 let current='',lift;
 // Global tools can appear after the Preset is composed (MCP, late plugins).
 const refresh=()=>{
  const deny=masked(),key=deny.join('\n');if(key===current)return;
  const previous=lift;current=key;lift=deny.length?ctx.tools.restrict({deny}):undefined;previous?.();
 };
 refresh();ctx.on('tools/change',refresh);
 ctx.effect(()=>()=>{lift?.();lift=undefined;current='';});
 ctx.tools.guard(exec=>{
  const tool=exec.name;if(typeof tool!=='string'||allow.has(tool)||exec.agent===undefined)return;
  const global=ctx.tools.get(tool);
  if(global!==undefined&&ctx.tools.get(tool,exec.agent)===global)return `Worker cannot run the Host-global tool ${tool}. Report needs_input and let the Root supply the material or perform the action.`;
 });
}
