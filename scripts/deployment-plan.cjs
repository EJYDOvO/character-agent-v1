// Shared by both candidate preparers. No credentials, data or running services.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {requiredFolders}=require('./package-plan.cjs');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function entries(rows){return rows.flatMap(r=>r.insert?entries(r.insert):[r,...entries(Array.isArray(r.config)?r.config:r.config?.plugins??[])]);}
function select({profile,core,extras,extrasEnabled=false}){
 // Offline dependency selection follows the Host patch dialect: only groups
 // are addressable; config is replaced, not merged. Preset plugins are data.
 const rows=[],index=new Map();
 function register(list){for(const r of list){if(r.id)index.set(r.id,r);if(r.group&&Array.isArray(r.config))register(r.config);}}
 for(const p of structuredClone([...core,...(extrasEnabled?extras:[]),...profile])){
  const {id,insert,name,...override}=p,target=index.get(id);
  if(insert){
   if(id&&(!target||!target.group))continue;
   const dest=id?(Array.isArray(target.config)?target.config:(target.config=[])):rows;
   dest.push(...insert);register(insert);
  }else if(target&&(!name||name===target.name))Object.assign(target,override);
 }
 // Expression-valued disabled flags are conservatively included: evaluating
 // arbitrary configuration is not part of packaging.
 function active(list){return list.flatMap(r=>r.disabled===true?[]:[...(r.name?[r.name]:[]),...active(Array.isArray(r.config)?r.config:r.config?.plugins??[])]);}
 if(extrasEnabled)for(const r of entries(extras))assert(!['im-qqbot','qq-remote-ops','character-identity','preset-qq-character'].includes(r.id),'Extras cannot replace Core authority');
 const names=new Set(active(rows));
 const selected=[...requiredFolders];
 if(extrasEnabled)selected.push('bundles/character-extras');
 for(const [name,folder]of [['dsh-memory-inspector','packages/memory-inspector'],['dsh-interaction-policy','packages/interaction-policy'],['dsh-character-long-tasks','packages/long-tasks']])if([...names].some(n=>n===name||n.startsWith(name+'/')))selected.push(folder);
 return selected;
}
function disableLegacyMemory(rows){for(const row of entries(rows))if(row.id==='task-memory')row.disabled=true;}
function verifyTaskExtras(live,nextRows,enabled,yaml){
 const file=path.join(live,'node_modules/dsh-character-extras/cordis.patch.yml');if(!enabled||!fs.existsSync(file))return;
 for(const row of entries(yaml.load(fs.readFileSync(file,'utf8'))??[])){
  if(row.name!=='dsh-character-long-tasks')continue;
  const next=entries(nextRows).find(n=>n.id===row.id&&n.name===row.name);
  assert(next&&next.disabled===row.disabled&&JSON.stringify(next.config??{})===JSON.stringify(row.config??{}),'Long task Extras policy changed; review explicitly before preparing upgrade');
 }
}
function tarEntry(file,wanted){
 const tar=require('node:zlib').gunzipSync(fs.readFileSync(file));let found;
 for(let offset=0;offset+512<=tar.length;){const header=tar.subarray(offset,offset+512),size=parseInt(header.subarray(124,136).toString().replace(/\0/g,'').trim()||'0',8),entry=header.subarray(0,100).toString().replace(/\0.*$/s,'');if(!entry)break;if(entry===wanted)found=tar.subarray(offset+512,offset+512+size);offset+=512+Math.ceil(size/512)*512;}
 return found;
}
function tarPackage(file){
 // Inspect the tarball metadata: filenames alone are not version evidence.
 const body=tarEntry(file,'package/package.json');return body&&JSON.parse(body);
}
function localFile(profile,source){assert(typeof source==='string'&&source.startsWith('file:'),'Reviewed local artifact required');return path.resolve(profile,source.slice(5));}
function verifiedArtifact(live,name){
 const manifest=JSON.parse(fs.readFileSync(path.join(live,'package.json'))),source=manifest.dependencies?.[name];
 const installed=JSON.parse(fs.readFileSync(path.join(live,'node_modules',name,'package.json')));
 const pin=JSON.parse(fs.readFileSync(path.join(live,'character-artifacts.json')))[name],file=localFile(live,source);
 assert.equal(installed.name,name);assert(pin&&pin.source===source,name+' artifact is not pinned to this Profile');
 assert.equal(hash(file),pin.sha256,name+' artifact hash changed');
 if(pin.version)assert.equal(pin.version,installed.version,name+' installed version differs from pin');
 const pkg=tarPackage(file);
 assert.equal(pkg?.name,name,'Invalid '+name+' tarball');assert.equal(pkg?.version,installed.version,name+' tarball would change installed version; explicit upgrade required');
 return {name,source:'file:'+file.replaceAll('\\','/'),sha256:pin.sha256,version:installed.version};
}
const verifiedRemote=live=>verifiedArtifact(live,'dsh-remote-ops-local');
function verifiedConversation(live,core,oldCore,args=process.argv){
 const row=entries(core).find(r=>r.name==='dsh-conversation-manager');if(!row)return;
 assert(entries(oldCore).some(r=>r.name==='dsh-conversation-manager')||args.includes('--conversation-state-reviewed'),'Conversation extraction requires an offline routing/Schedule/notification inventory and explicit --conversation-state-reviewed');
 assert(path.isAbsolute(row.config?.stateFile)&&fs.existsSync(row.config.stateFile),'Reviewed Conversation state missing; never silently reset legacy routes');
 return verifiedArtifact(live,'dsh-conversation-manager');
}
// The reviewed QQ patch injects agentIO and the gateway refuses to start without
// it, so Core must declare dsh-agent-io and the candidate must pin its artifact.
// An installed pin is re-verified; a first install takes only an explicitly named,
// reviewed tarball. There is no fallback to the former direct send path.
function verifiedAgentIO(live,core,patches,args=process.argv){
 const name='dsh-agent-io',sources=Object.values(patches??{}).map(p=>fs.readFileSync(p.source,'utf8')),required=sources.some(s=>/inject = \[[^\]]*'agentIO'/.test(s));
 // The Iteration 03 QQ patch opens its Conversation wiring through dsh-agent-io,
 // the Iteration 05 patch its command router (and sends attachments): an older
 // package would stop the Gateway at start, so it is refused here.
 const wiring=sources.some(s=>/io\.openConversation\(/.test(s)),commands=sources.some(s=>/\.openCommands\(/.test(s));
 const needs=name+(commands?' with openCommands (0.1.0-test.5 or later)':' with openConversation (0.1.0-test.4 or later)');
 const offers=read=>(!wiring||/\bopenConversation\b/.test(read('index.mjs')??''))&&(!commands||/\bopenCommands\b/.test(read('conversation.mjs')??''));
 const fromFile=dir=>file=>{try{return fs.readFileSync(path.join(dir,file),'utf8');}catch{return undefined;}};
 const row=entries(core).find(r=>r.name===name);
 if(!row){assert(!required,'Reviewed QQ patch requires '+name+'; rebuild Character Core');return;}
 const manifest=JSON.parse(fs.readFileSync(path.join(live,'package.json')));
 const arg=args.find(a=>a.startsWith('--agent-io-artifact='));
 const reviewed=()=>{
  const file=arg.slice('--agent-io-artifact='.length);
  assert(path.isAbsolute(file)&&fs.existsSync(file),'Reviewed '+name+' tarball missing');
  const pkg=tarPackage(file);assert.equal(pkg?.name,name,'Invalid '+name+' tarball');assert(typeof pkg.version==='string'&&pkg.version,'Invalid '+name+' version');
  assert(offers(f=>tarEntry(file,'package/'+f)?.toString()),'Reviewed QQ patch needs '+needs);
  return {name,file,sha256:hash(file),version:pkg.version,fresh:true};
 };
 if(manifest.dependencies?.[name]){
  const installed=verifiedArtifact(live,name);
  if(!arg){
   assert(offers(fromFile(path.join(live,'node_modules',name))),'Reviewed QQ patch needs '+needs+'; the installed '+name+' '+installed.version+' lacks it: upgrade it with --agent-io-artifact=<absolute reviewed .tgz>');
   return installed;
  }
  // Explicit upgrade of the installed, verified package. Pinned artifacts are
  // immutable, so the replacement must carry another version; the previous
  // tarball stays in plugin-packages and in the previous Profile for rollback.
  const next=reviewed();
  assert.notEqual(next.version,installed.version,name+' '+installed.version+' is already installed; a changed package needs a new version');
  return {...next,upgradeFrom:installed.version};
 }
 assert(arg,'First '+name+' install requires a reviewed tarball: --agent-io-artifact=<absolute .tgz>');
 return reviewed();
}
// Copy a first-install artifact next to the other immutable packages and pin it.
function pinAgentIO(agentIO,root){
 if(!agentIO?.fresh)return agentIO;
 const dest=path.join(root,'plugin-packages',agentIO.name+'-'+agentIO.version+'.tgz');
 if(fs.existsSync(dest))assert.equal(hash(dest),agentIO.sha256,'Immutable artifact differs: '+agentIO.name);else fs.copyFileSync(agentIO.file,dest);
 return {name:agentIO.name,source:'file:'+dest.replaceAll('\\','/'),sha256:agentIO.sha256,version:agentIO.version};
}
function patchPlan(live,toolkit,yaml){
 const workspace=yaml.load(fs.readFileSync(path.join(live,'pnpm-workspace.yaml'),'utf8'))??{},patches={};
 workspace.patchedDependencies??={};
 for(const name of ['dsh-qqbot','qqbot-nodejs']){
  const pkg=JSON.parse(fs.readFileSync(path.join(live,'node_modules/@tencent-connect',name,'package.json'))),key='@tencent-connect/'+name+'@'+pkg.version;
  const relative='patches/'+name+'@'+pkg.version+'.patch',source=path.join(toolkit,'maintenance',relative);
  assert(fs.existsSync(source),'Missing reviewed patch for installed '+key);
  for(const old of Object.keys(workspace.patchedDependencies))if(old.startsWith('@tencent-connect/'+name+'@')&&old!==key)throw Error('Conflicting patch version: '+old);
  workspace.patchedDependencies[key]=relative;patches[relative]={source,sha256:hash(source),package:key};
  if(name==='qqbot-nodejs')workspace.overrides={...workspace.overrides,'@tencent-connect/qqbot-nodejs':pkg.version};
 }
 return {workspace,patches};
}
function verifyCandidate(candidate,record,yaml){
 const manifest=JSON.parse(fs.readFileSync(path.join(candidate,'package.json'))),lock=yaml.load(fs.readFileSync(path.join(candidate,'pnpm-lock.yaml'),'utf8'));
 for(const [name,pin]of Object.entries(record.artifacts)){
  assert.equal(manifest.dependencies[name],pin.source,'Candidate dependency changed: '+name);
  assert.equal(hash(localFile(candidate,pin.source)),pin.sha256,'Artifact changed: '+name);
  assert.equal(lock.importers?.['.']?.dependencies?.[name]?.specifier,pin.source,'Candidate lockfile requires installation: '+name);
  assert.equal(JSON.parse(fs.readFileSync(path.join(candidate,'node_modules',name,'package.json'))).version,pin.version,'Installed candidate version mismatch: '+name);
 }
 const workspace=yaml.load(fs.readFileSync(path.join(candidate,'pnpm-workspace.yaml'),'utf8'));
 for(const [relative,patch]of Object.entries(record.patches??{})){
  assert.equal(hash(path.join(candidate,relative)),patch.sha256,'Candidate patch changed');
  assert.equal(workspace.patchedDependencies?.[patch.package],relative,'Workspace patch mismatch');
  const split=patch.package.lastIndexOf('@'),name=patch.package.slice(0,split),version=patch.package.slice(split+1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(candidate,'node_modules',name,'package.json'))).version,version,'Installed patched package version mismatch: '+name);
  if(name==='@tencent-connect/qqbot-nodejs')assert.equal(workspace.overrides?.[name],version,'SDK override mismatch');
  const locked=lock.patchedDependencies?.[patch.package];
  assert.equal(typeof locked==='string'?locked:locked?.hash,patch.sha256,'Lockfile patch hash mismatch; reinstall candidate');
  if(locked?.path)assert.equal(locked.path,relative,'Lockfile patch path mismatch');
 }
}
function entryYaml(yaml){
 // Preserve Host !!js nodes when reading/writing generated Creator presets.
 const type=new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:value=>({__jsExpr:value}),predicate:value=>value&&typeof value.__jsExpr==='string',represent:value=>value.__jsExpr});
 const schema=yaml.JSON_SCHEMA.extend(type);
 return {load:(text,options)=>yaml.load(text,{...options,schema}),dump:(value,options)=>yaml.dump(value,{...options,schema})};
}
module.exports={select,disableLegacyMemory,verifyTaskExtras,verifiedRemote,verifiedConversation,verifiedAgentIO,pinAgentIO,patchPlan,verifyCandidate,entryYaml,hash};
