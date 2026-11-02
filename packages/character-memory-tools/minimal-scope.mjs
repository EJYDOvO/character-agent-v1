// Native Preset-local policy. Includes inherited and late global tools, not just the prompt catalog.
export const name='character-minimal-tool-scope';
export const inject=['tools'];
export function apply(ctx,config={}){
 const allow=config.allow??[];
 if(!Array.isArray(allow)||allow.some(n=>typeof n!=='string'||!/^\w+$/.test(n))||new Set(allow).size!==allow.length)throw Error('Invalid minimal Preset tool policy');
 ctx.effect(()=>ctx.tools.restrict({allow:[...allow]}));
 const names=new Set(allow);
 ctx.tools.guard(exec=>typeof exec.name!=='string'||names.has(exec.name)?undefined:'Minimal Character Preset does not authorize this tool');
}
