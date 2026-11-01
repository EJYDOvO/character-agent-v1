// Prepare a fresh candidate only. Deployment, an offline snapshot and restart
// are separate operations. Never point the candidate at a running QQ gateway.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const install=require('./installation.cjs').install,project=path.resolve(__dirname,'..');
const live=path.join(install,'data/profiles/desktop');
const target=process.argv[2];
assert(target&&/^[a-z][a-z0-9-]+$/.test(target)&&target!=='desktop','Supply a new candidate profile name');
const candidate=path.join(install,'data/profiles',target),yaml=require('./deployment-plan.cjs').entryYaml(require(require.resolve('js-yaml',{paths:[live]})));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert(!fs.existsSync(candidate),'Candidate already exists');
const archive=require('./host-archive.cjs').openArchive();let version,nativeSchedule;
try{version=JSON.parse(archive.read('dsh/package.json')).version;nativeSchedule=archive.read('dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml').includes('@deepseek-ai/dsh-tool-schedule');}finally{archive.close();}
require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'ensure-build.cjs'),'--check'],{stdio:'inherit'});
const release=JSON.parse(fs.readFileSync(project+'/package.json')).version;
const manifest=JSON.parse(fs.readFileSync(live+'/package.json'));
let rows=yaml.load(fs.readFileSync(live+'/cordis.patch.yml','utf8'));
const plan=require('./deployment-plan.cjs'),sourceDigest=require('./source-digest.cjs')();
const core=yaml.load(fs.readFileSync(project+'/bundles/character-core/cordis.patch.yml','utf8')),extras=yaml.load(fs.readFileSync(project+'/bundles/character-extras/cordis.patch.yml','utf8'))||[];
const workerUpgrade=require('./worker-upgrade.cjs'),oldCore=yaml.load(fs.readFileSync(live+'/node_modules/dsh-character-core/cordis.patch.yml','utf8'));
const patchPlan=plan.patchPlan(live,path.resolve(process.env.DSH_QQTK_PROJECT||install),yaml);
const conversation=plan.verifiedConversation(live,core,oldCore,process.argv,patchPlan.patches);
const migration=workerUpgrade.upgrade(rows,oldCore,core);rows=migration.value;
const extrasEnabled=manifest.dsh.profile.bundles.includes('dsh-character-extras');
plan.verifyTaskExtras(live,extras,extrasEnabled,yaml);
if(process.argv.includes('--inspector'))require('./inspector-declaration.cjs')(rows,extrasEnabled?extras:[]);
const artifacts=require('./package-plan.cjs').verifiedPlan(project,sourceDigest,plan.select({profile:rows,core,extras,extrasEnabled}));
const remote=plan.verifiedRemote(live);
const agentIO=plan.verifiedAgentIO(live,core,patchPlan.patches);
const qq=rows.find(r=>r.id==='im-qqbot');
assert.equal(qq?.config?.access?.c2cMode,'allowlist');assert.equal(qq.config.access.c2cAllow.length,1);assert.equal(qq.config.access.groupMode,'disabled');
const record={at:new Date().toISOString(),runtime:version,release,candidate,baseline:{},artifacts:{},sourceDigest,patches:patchPlan.patches};
for(const f of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','cordis.patch.yml'])record.baseline[f]=hash(live+'/'+f);
record.officialBefore=hash(install+'/resources/app.asar');
record.officialTarget=hash(require('./host-archive.cjs').runtimeRoot+'/resources/app.asar');
for(const pkg of artifacts){
 const {name,filename:file,version}=pkg,source=project+'/artifacts/packages/'+file,dest=install+'/plugin-packages/'+file;
 assert(fs.existsSync(source),'Missing package '+name);
 if(fs.existsSync(dest))assert.equal(hash(source),hash(dest),'Immutable package differs');else fs.copyFileSync(source,dest);
 manifest.dependencies[name]='file:'+dest.replaceAll('\\','/');record.artifacts[name]={source:manifest.dependencies[name],sha256:hash(dest),version};
}
const remotePin=plan.pinArtifact(remote,install);manifest.dependencies[remotePin.name]=remotePin.source;record.artifacts[remotePin.name]=remotePin;
if(conversation){const pin=plan.pinArtifact(conversation,install);manifest.dependencies[pin.name]=pin.source;record.artifacts[pin.name]=pin;}
if(agentIO){const pin=plan.pinAgentIO(agentIO,install);manifest.dependencies[pin.name]=pin.source;record.artifacts[pin.name]=pin;}
if(nativeSchedule)manifest.dsh.profile.bundles=manifest.dsh.profile.bundles.filter(n=>n!=='@deepseek-ai/dsh-experimental-schedule-bundle');
plan.disableLegacyMemory(rows);
manifest.dsh.profile.bundles=manifest.dsh.profile.bundles.filter(n=>n!=='dsh-task-memory-local');
// Retain the two existing optional capabilities through their native bundles
// when replacing former third-party Extras with only our optional declarations.
const oldExtras=live+'/node_modules/dsh-character-extras/cordis.patch.yml';
const newExtras=yaml.load(fs.readFileSync(project+'/bundles/character-extras/cordis.patch.yml','utf8'));
const retainsLegacy=newExtras.flatMap(r=>r.insert??[]).some(r=>['dsh-free-search','dsh-plugin-bilibili'].includes(r.name));
if(extrasEnabled&&!retainsLegacy&&fs.existsSync(oldExtras)){
 const old=yaml.load(fs.readFileSync(oldExtras,'utf8'));
 for(const row of old.flatMap(x=>x.insert??[])){
   if(row.name==='dsh-character-long-tasks')continue;
   assert(['dsh-free-search','dsh-plugin-bilibili'].includes(row.name),'Unrecognized old Extras entry requires review');
  assert(!row.disabled&&!row.config,'Custom Extras entry requires explicit migration');
  if(!manifest.dsh.profile.bundles.includes(row.name))manifest.dsh.profile.bundles.push(row.name);
 }
}
fs.cpSync(live,candidate,{recursive:true,filter:s=>!['node_modules','.dsh-preset-manager'].includes(path.basename(s))});
record.managerState=workerUpgrade.stageManager(live,candidate,oldCore,core);
record.workerMigration={removed:migration.removed,personas:migration.personas};
fs.mkdirSync(candidate+'/patches',{recursive:true});
for(const [rel,p]of Object.entries(patchPlan.patches))fs.copyFileSync(p.source,candidate+'/'+rel);
fs.writeFileSync(candidate+'/pnpm-workspace.yaml',yaml.dump(patchPlan.workspace));
fs.writeFileSync(candidate+'/package.json',JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(candidate+'/cordis.patch.yml',yaml.dump(rows,{noRefs:true,lineWidth:120}));
// Rebuild pins from the exact candidate artifacts; copying an older profile's
// manifest would make subsequent QQTK verification refer to the old release.
const pins={...JSON.parse(fs.readFileSync(live+'/character-artifacts.json')), ...record.artifacts};
fs.writeFileSync(candidate+'/character-artifacts.json',JSON.stringify(pins,null,2)+'\n');
fs.writeFileSync(candidate+'/host-upgrade.json',JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({prepared:true,candidate,version,release,ownerCount:1,groups:'disabled',optionalBundlesRetained:true}));
