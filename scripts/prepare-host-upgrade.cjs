// Prepare a fresh candidate only. Deployment, an offline snapshot and restart
// are separate operations. Never point the candidate at a running QQ gateway.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const install=require('./installation.cjs').install,project=path.resolve(__dirname,'..');
const live=path.join(install,'data/profiles/desktop');
const target=process.argv[2];
assert(target&&/^[a-z][a-z0-9-]+$/.test(target)&&target!=='desktop','Supply a new candidate profile name');
const candidate=path.join(install,'data/profiles',target),yaml=require(require.resolve('js-yaml',{paths:[live]}));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert(!fs.existsSync(candidate),'Candidate already exists');
const archive=require('./host-archive.cjs').openArchive();let version,nativeSchedule;
try{version=JSON.parse(archive.read('dsh/package.json')).version;nativeSchedule=archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml').includes('@deepseek-ai/dsh-tool-schedule');}finally{archive.close();}
require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'ensure-build.cjs'),'--check'],{stdio:'inherit'});
const release=JSON.parse(fs.readFileSync(project+'/package.json')).version;
const manifest=JSON.parse(fs.readFileSync(live+'/package.json'));
const rows=yaml.load(fs.readFileSync(live+'/cordis.patch.yml','utf8'));
const qq=rows.find(r=>r.id==='im-qqbot');
assert.equal(qq?.config?.access?.c2cMode,'allowlist');assert.equal(qq.config.access.c2cAllow.length,1);assert.equal(qq.config.access.groupMode,'disabled');
const record={at:new Date().toISOString(),runtime:version,release,candidate,baseline:{},artifacts:{}};
for(const f of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','cordis.patch.yml'])record.baseline[f]=hash(live+'/'+f);
record.officialBefore=hash(install+'/resources/app.asar');
record.officialTarget=hash(require('./host-archive.cjs').runtimeRoot+'/resources/app.asar');
for(const n of ['core','extras','identity','memory-core','memory-tools','qq-adapter']){
 const name='dsh-character-'+n,file=name+'-'+release+'.tgz',source=project+'/artifacts/packages/'+file,dest=install+'/plugin-packages/'+file;
 assert(fs.existsSync(source),'Missing package '+name);
 if(fs.existsSync(dest))assert.equal(hash(source),hash(dest),'Immutable package differs');else fs.copyFileSync(source,dest);
 manifest.dependencies[name]='file:'+dest.replaceAll('\\','/');record.artifacts[name]=hash(dest);
}
if(nativeSchedule)manifest.dsh.profile.bundles=manifest.dsh.profile.bundles.filter(n=>n!=='@deepseek-ai/dsh-experimental-schedule-bundle');
const legacyMemory=rows.find(r=>r.id==='task-memory');
if(legacyMemory?.disabled===true){
 manifest.dsh.profile.bundles=manifest.dsh.profile.bundles.filter(n=>n!=='dsh-task-memory-local');
 rows.splice(rows.indexOf(legacyMemory),1); // Retain installed dependency and all legacy data.
}
// Retain the two existing optional capabilities through their native bundles
// when replacing the former non-empty Extras with the user's empty template.
const oldExtras=live+'/node_modules/dsh-character-extras/cordis.patch.yml';
const newExtras=yaml.load(fs.readFileSync(project+'/bundles/character-extras/cordis.patch.yml','utf8'));
if(newExtras.length===0&&fs.existsSync(oldExtras)){
 const old=yaml.load(fs.readFileSync(oldExtras,'utf8'));
 for(const row of old.flatMap(x=>x.insert??[])){
  assert(['dsh-free-search','dsh-plugin-bilibili'].includes(row.name),'Unrecognized old Extras entry requires review');
  assert(!row.disabled&&!row.config,'Custom Extras entry requires explicit migration');
  if(!manifest.dsh.profile.bundles.includes(row.name))manifest.dsh.profile.bundles.push(row.name);
 }
}
fs.cpSync(live,candidate,{recursive:true,filter:s=>path.basename(s)!=='node_modules'});
fs.writeFileSync(candidate+'/package.json',JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(candidate+'/cordis.patch.yml',yaml.dump(rows,{noRefs:true,lineWidth:120}));
fs.writeFileSync(candidate+'/host-upgrade.json',JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({prepared:true,candidate,version,release,ownerCount:1,groups:'disabled',optionalBundlesRetained:true}));
