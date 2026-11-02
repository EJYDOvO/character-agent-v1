// Explicit, reviewed native pi-ai metadata, applied only while staging a Profile.
// Never infer image support from a model name or enable it for an entire provider.
const assert=require('node:assert/strict'),fs=require('node:fs');
function apply(rows,entries){
 assert(Array.isArray(entries)&&entries.length>0&&entries.length<=64,'Model input declarations must be a nonempty array');
 const next=structuredClone(rows),seen=new Set();
 for(const entry of entries){
  assert(entry&&Object.keys(entry).sort().join(',')==='input,model,provider','Expected provider, model and input only');
  for(const field of ['provider','model'])assert(typeof entry[field]==='string'&&entry[field].trim()===entry[field]&&entry[field].length>0&&entry[field].length<=200,'Invalid model route');
  assert(Array.isArray(entry.input)&&entry.input.includes('text')&&entry.input.length<=2&&new Set(entry.input).size===entry.input.length&&entry.input.every(v=>['text','image'].includes(v)),'Only explicit text/image inputs are supported');
  const key=JSON.stringify([entry.provider,entry.model]);assert(!seen.has(key),'Duplicate model input target');seen.add(key);
  const routes=next.filter(r=>r.id==='llm-pi-ai');assert(routes.length===1&&!routes[0].disabled,'Enabled native pi-ai declaration required');
  const provider=routes[0].config?.providers?.[entry.provider];assert(provider,'Model provider is not configured');
  // In rc.3, models replaces the catalog. modelOverrides beside models is
  // INVALID_CONFIG, and custom providers cannot use catalog overrides at all.
  assert(!Object.keys(provider.modelOverrides??{}).length,'Resolve conflicting modelOverrides before staging');
  const models=provider.models?.filter(m=>m.id===entry.model);assert(models?.length===1,'Target must already appear once in the native models list');
  models[0].input=[...entry.input];
 }
 return next;
}
function fromArgs(rows,args,read=fs.readFileSync){
 assert(!args.includes('--model-inputs'),'Use --model-inputs=<reviewed JSON file>');
 const flags=args.filter(a=>a.startsWith('--model-inputs='));assert(flags.length<=1,'Duplicate model-inputs option');
 return flags.length?apply(rows,JSON.parse(read(flags[0].slice('--model-inputs='.length),'utf8').replace(/^\uFEFF/u,''))):rows;
}
module.exports={apply,fromArgs};
