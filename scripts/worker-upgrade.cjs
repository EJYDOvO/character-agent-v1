// Offline candidate migration only. Never touches Sessions, skills or the source Profile.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const legacy='dsh-character-memory-tools/worker.mjs';
function templates(rows){return new Map(rows.flatMap(r=>r.insert??[r]).filter(r=>r.id?.startsWith('preset-worker-')&&r.id==='preset-'+r.config?.id&&Array.isArray(r.config.plugins)).map(r=>[r.config.id,r.config.plugins.find(p=>p.id==='persona')?.config?.prefix]));}
function upgrade(value,oldRows=[],newRows=[]){
 const old=templates(oldRows),latest=templates(newRows);let removed=0,personas=0;
 function plugins(rows,id){return rows.filter(r=>{if(r?.name===legacy){removed++;return false;}return true;}).map(r=>{
  if(r.group===true&&Array.isArray(r.config))r.config=plugins(r.config,id);
  if(r.id==='persona'&&old.has(id)&&latest.has(id)&&r.config?.prefix===old.get(id)&&r.config.prefix!==latest.get(id)){r.config.prefix=latest.get(id);personas++;}
  return r;
 });}
 function visit(v,id){if(!v||typeof v!=='object')return;
  if(Array.isArray(v)){for(const item of v)visit(item,id);return;}
  const own=typeof v.config?.id==='string'?v.config.id:typeof v.id==='string'?v.id.replace(/^preset-/,''):id;
  for(const [key,item]of Object.entries(v)){
   if((key==='plugins'||key==='base')&&Array.isArray(item))v[key]=plugins(item,own);
   else if(key==='presets'&&item&&!Array.isArray(item))for(const [preset,state]of Object.entries(item))visit(state,preset);
   else visit(item,own);
  }
 }
 const result=structuredClone(value);visit(result);return {value:result,removed,personas};
}
function snapshot(dir){const files={};if(!fs.existsSync(dir))return files;
 function walk(current){for(const e of fs.readdirSync(current,{withFileTypes:true})){assert(!e.isSymbolicLink(),'Manager state symlinks require manual review');const file=path.join(current,e.name);if(e.isDirectory())walk(file);else if(e.isFile())files[path.relative(dir,file).replaceAll('\\','/')]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}
 walk(dir);return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
function stageManager(live,candidate,oldRows,newRows){const from=path.join(live,'.dsh-preset-manager'),to=path.join(candidate,'.dsh-preset-manager'),baseline=snapshot(from);
 assert(!fs.existsSync(to),'Manager candidate state must be staged once into an empty directory');
 if(fs.existsSync(from))fs.cpSync(from,to,{recursive:true});
 const file=path.join(to,'state.json');let changed=0;
 if(fs.existsSync(file)){const next=upgrade(JSON.parse(fs.readFileSync(file,'utf8')),oldRows,newRows);changed=next.removed+next.personas;if(changed)fs.writeFileSync(file,JSON.stringify(next.value,null,2)+'\n');}
 assert.deepEqual(snapshot(from),baseline,'Manager state changed while staging; retry');return {baseline,sealed:snapshot(to),changed};
}
module.exports={upgrade,snapshot,stageManager};
