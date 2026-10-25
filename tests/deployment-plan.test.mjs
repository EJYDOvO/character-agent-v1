import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
const require=createRequire(import.meta.url),plan=require('../scripts/deployment-plan.cjs'),packages=require('../scripts/package-plan.cjs');
const write=(file,value)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
// Real gzip/tar metadata: do not substitute a filename assertion for package version.
function tarball(file,version){const body=Buffer.from(JSON.stringify({name:'dsh-remote-ops-local',version})),header=Buffer.alloc(512);header.write('package/package.json');header.write(body.length.toString(8).padStart(11,'0'),124);writeFileSync(file,gzipSync(Buffer.concat([header,body,Buffer.alloc(Math.ceil(body.length/512)*512-body.length+1024)])));}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'deployment-contract-')),live=join(root,'data/profiles/desktop'),project=join(root,'source');
 const binding={appId:'synthetic-app',ownerId:'synthetic-owner',characterId:'character-a',projectId:'preserve-project'};
 write(join(root,'data/character/binding.json'),binding);write(join(root,'data/maintenance/owner.json'),{openid:binding.ownerId});write(join(root,'data/qqbot/model-prefs.json'),{});write(join(root,'maintenance/plugin-policy.json'),{localPackages:{}});write(join(root,'resources/app.asar'),'synthetic placeholder');
 const remote=join(root,'remote.tgz');tarball(remote,'1.1.1-test.1');
 write(join(live,'package.json'),{dependencies:{'dsh-remote-ops-local':'file:'+remote},dsh:{profile:{bundles:['dsh-character-core','dsh-free-search']}}});
 write(join(live,'character-artifacts.json'),{'dsh-remote-ops-local':{source:'file:'+remote,sha256:plan.hash(remote)}});
 write(join(live,'node_modules/dsh-remote-ops-local/package.json'),{name:'dsh-remote-ops-local',version:'1.1.1-test.1'});
 write(join(live,'cordis.patch.yml'),[{id:'im-qqbot',config:{appId:binding.appId,access:{c2cMode:'allowlist',c2cAllow:[binding.ownerId],groupMode:'disabled'}}}]);
 write(join(live,'pnpm-workspace.yaml'),{});write(join(live,'pnpm-lock.yaml'),{importers:{'.':{dependencies:{}}}});
 for(const [name,version]of [['dsh-qqbot','0.5.2'],['qqbot-nodejs','1.0.5']]){write(join(live,'node_modules/@tencent-connect',name,'package.json'),{version});write(join(root,'maintenance/patches',name+'@'+version+'.patch'),'synthetic '+name);}
 // JSON is a YAML subset. This codec isolates preparation logic without a CI SDK dependency.
 write(join(live,'node_modules/js-yaml/index.js'),'exports.load=JSON.parse;exports.dump=JSON.stringify;exports.Type=function(){};exports.JSON_SCHEMA={extend(){return {}}};');
 write(join(project,'package.json'),{version:'candidate'});write(join(project,'artifacts/build-manifest.json'),{settings:{presetId:'qq-character',dataDirectory:join(root,'data/character')},characterId:binding.characterId});
 write(join(project,'bundles/character-core/cordis.patch.yml'),[]);write(join(project,'bundles/character-extras/cordis.patch.yml'),[]);
 const names={'packages/character-identity':'dsh-character-identity','packages/character-memory-core':'dsh-character-memory-core','packages/character-memory-tools':'dsh-character-memory-tools','packages/character-qq-adapter':'dsh-character-qq-adapter','bundles/character-core':'dsh-character-core'};
 for(const folder of packages.requiredFolders){const name=names[folder];write(join(project,folder,'package.json'),{name,version:'candidate'});write(join(project,'artifacts/packages',name+'-candidate.tgz'),'synthetic own package');}
 write(join(project,'artifacts/package-source.json'),{sourceDigest:'fixture',artifacts:packages.inventory(project,packages.requiredFolders)});
 for(const name of ['prepare-deploy','prepare-host-upgrade','installation','deployment-plan','package-plan','inspector-declaration'])cpSync(fileURLToPath(new URL('../scripts/'+name+'.cjs',import.meta.url)),join(project,'scripts',name+'.cjs'),{recursive:true});
 write(join(project,'scripts/ensure-build.cjs'),'// build validation independently covered by native probes\n');write(join(project,'scripts/source-digest.cjs'),"module.exports=()=> 'fixture';");
 write(join(project,'scripts/host-archive.cjs'),"module.exports={runtimeRoot:process.env.DSH_INSTALL_ROOT,openArchive:()=>({read:f=>f==='dsh/package.json'?'{\"version\":\"fixture\"}':'@deepseek-ai/dsh-tool-schedule',close(){}})};");
 mkdirSync(join(root,'plugin-packages'));return {root,live,project,remote,binding};
}
test('Core selection does not require absent optional artifacts; active nested declarations and overrides do',()=>{
 const core=[{insert:[{id:'preset-main',config:{plugins:[{id:'interaction',name:'dsh-interaction-policy'}]}}]}],extras=[{insert:[{id:'memory-inspector',name:'dsh-memory-inspector'}]}];
 assert.deepEqual(plan.select({profile:[],core:[],extras}),packages.requiredFolders);
 assert(plan.select({profile:[],core,extras}).includes('packages/interaction-policy'));
 // Native patch composition cannot address entries inside Preset config.plugins.
 assert(plan.select({profile:[{id:'interaction',disabled:true}],core,extras}).includes('packages/interaction-policy'));
 assert(!plan.select({profile:[{id:'preset-main',disabled:true}],core,extras}).includes('packages/interaction-policy'));
 assert(!plan.select({profile:[{id:'preset-main',config:{plugins:[]}}],core,extras}).includes('packages/interaction-policy'));
 assert(plan.select({profile:[{id:'preset-main',name:'other-preset',disabled:true}],core,extras}).includes('packages/interaction-policy'));
 assert(!plan.select({profile:[{id:'unused',name:'dsh-memory-inspector'}],core:[],extras}).includes('packages/memory-inspector'));
 assert(plan.select({profile:[],core:[],extras,extrasEnabled:true}).includes('packages/memory-inspector'));
 assert(!plan.select({profile:[{id:'memory-inspector',disabled:true}],core:[],extras,extrasEnabled:true}).includes('packages/memory-inspector'));
 assert.throws(()=>plan.select({profile:[],core:[],extras:[{id:'im-qqbot'}],extrasEnabled:true}),/authority/);
 const tasks=[{insert:[{id:'long-tasks',name:'dsh-character-long-tasks'}]}];
 assert(!plan.select({profile:[],core:[],extras:tasks}).includes('packages/long-tasks'));
 assert(plan.select({profile:[],core:[],extras:tasks,extrasEnabled:true}).includes('packages/long-tasks'));
 assert(!plan.select({profile:[{id:'long-tasks',disabled:true}],core:[],extras:tasks,extrasEnabled:true}).includes('packages/long-tasks'));
});
test('Remote Ops requires matching installed version, pinned artifact hash and tar metadata',()=>{
 const f=fixture();assert.equal(plan.verifiedRemote(f.live).version,'1.1.1-test.1');
 tarball(f.remote,'1.1.0');assert.throws(()=>plan.verifiedRemote(f.live),/hash/);
 write(join(f.live,'character-artifacts.json'),{'dsh-remote-ops-local':{source:'file:'+f.remote,sha256:plan.hash(f.remote)}});assert.throws(()=>plan.verifiedRemote(f.live),/version/);
});
test('Real preparation CLI accepts absent, disabled and active legacy memory without optional packages or identity changes',()=>{
 for(const state of ['absent','disabled','active']){
  const f=fixture(),file=join(f.live,'cordis.patch.yml'),rows=JSON.parse(readFileSync(file));if(state!=='absent')rows.push({id:'task-memory',disabled:state==='disabled'});write(file,rows);
  execFileSync(process.execPath,[join(f.project,'scripts/prepare-deploy.cjs')],{env:{...process.env,DSH_INSTALL_ROOT:f.root,DSH_QQTK_PROJECT:f.root},stdio:'pipe'});
  const candidate=join(f.root,'data/profiles/character-candidate'),manifest=JSON.parse(readFileSync(join(candidate,'package.json'))),record=JSON.parse(readFileSync(join(f.root,'data/maintenance/character-deploy/candidate.json')));
  assert.equal(record.artifacts['dsh-remote-ops-local'].version,'1.1.1-test.1');assert(!manifest.dependencies['dsh-memory-inspector']);assert(!manifest.dependencies['dsh-interaction-policy']);assert(!manifest.dsh.profile.bundles.includes('dsh-character-extras'));assert(manifest.dsh.profile.bundles.includes('dsh-free-search'));
  assert.deepEqual(JSON.parse(readFileSync(join(f.root,'data/maintenance/character-deploy/binding.json'))),f.binding);
  const legacy=JSON.parse(readFileSync(join(candidate,'cordis.patch.yml'))).find(r=>r.id==='task-memory');assert(state==='absent'?!legacy:legacy.disabled);
  assert.equal(Object.keys(record.patches).length,2);
  assert.throws(()=>plan.verifyCandidate(candidate,record,{load:JSON.parse}),/lockfile/);
  // Installed but disabled old Extras must not be converted into active native Bundles.
  write(join(f.live,'node_modules/dsh-character-extras/cordis.patch.yml'),[{insert:[{name:'dsh-plugin-bilibili'}]}]);
  execFileSync(process.execPath,[join(f.project,'scripts/prepare-host-upgrade.cjs'),'upgrade-fixture'],{env:{...process.env,DSH_INSTALL_ROOT:f.root,DSH_QQTK_PROJECT:f.root},stdio:'pipe'});
  const upgrade=join(f.root,'data/profiles/upgrade-fixture'),up=JSON.parse(readFileSync(join(upgrade,'package.json'))),meta=JSON.parse(readFileSync(join(upgrade,'host-upgrade.json')));
  assert(!up.dsh.profile.bundles.includes('dsh-plugin-bilibili'));assert(!up.dependencies['dsh-memory-inspector']);assert.deepEqual(meta.artifacts['dsh-remote-ops-local'],record.artifacts['dsh-remote-ops-local']);assert.deepEqual(meta.patches,record.patches);
 }
});
test('Candidate gate requires matching lockfile, installed versions and both patch hashes',()=>{
 const f=fixture(),remote=plan.verifiedRemote(f.live),patch=plan.patchPlan(f.live,f.root,{load:JSON.parse}),record={artifacts:{[remote.name]:remote},patches:patch.patches};
 for(const [rel,p]of Object.entries(patch.patches)){write(join(f.live,rel),readFileSync(p.source,'utf8'));}
 write(join(f.live,'pnpm-workspace.yaml'),patch.workspace);
 const lock={importers:{'.':{dependencies:{[remote.name]:{specifier:remote.source}}}},patchedDependencies:Object.fromEntries(Object.values(patch.patches).map(p=>[p.package,p.sha256]))};
 const manifest=JSON.parse(readFileSync(join(f.live,'package.json')));manifest.dependencies[remote.name]=remote.source;write(join(f.live,'package.json'),manifest);write(join(f.live,'pnpm-lock.yaml'),lock);
 assert.doesNotThrow(()=>plan.verifyCandidate(f.live,record,{load:JSON.parse}));
 write(join(f.live,'node_modules/@tencent-connect/qqbot-nodejs/package.json'),{version:'1.0.4'});
 assert.throws(()=>plan.verifyCandidate(f.live,record,{load:JSON.parse}),/Installed patched package/);
 write(join(f.live,'node_modules/@tencent-connect/qqbot-nodejs/package.json'),{version:'1.0.5'});
 const mismatched={...patch.workspace,overrides:{'@tencent-connect/qqbot-nodejs':'1.0.4'}};write(join(f.live,'pnpm-workspace.yaml'),mismatched);
 assert.throws(()=>plan.verifyCandidate(f.live,record,{load:JSON.parse}),/SDK override/);
 write(join(f.live,'pnpm-workspace.yaml'),patch.workspace);
 lock.patchedDependencies['@tencent-connect/qqbot-nodejs@1.0.5']='old-hash';write(join(f.live,'pnpm-lock.yaml'),lock);assert.throws(()=>plan.verifyCandidate(f.live,record,{load:JSON.parse}),/patch hash/);
});
test('disabled optional task template preserves legacy native Extras and refuses silent task-policy changes',()=>{
 const task={id:'long-tasks',name:'dsh-character-long-tasks',disabled:true,config:{presetId:'long-task',allowTools:[]}};
 for(const active of [false,true]){
  const f=fixture(),manifest=JSON.parse(readFileSync(join(f.live,'package.json')));manifest.dsh.profile.bundles.push('dsh-character-extras');write(join(f.live,'package.json'),manifest);
  write(join(f.project,'bundles/character-extras/package.json'),{name:'dsh-character-extras',version:'candidate'});write(join(f.project,'bundles/character-extras/cordis.patch.yml'),[{insert:[task]}]);
  write(join(f.project,'artifacts/packages/dsh-character-extras-candidate.tgz'),'synthetic extras artifact');
  write(join(f.project,'artifacts/package-source.json'),{sourceDigest:'fixture',artifacts:packages.inventory(f.project,[...packages.requiredFolders,'bundles/character-extras'])});
  write(join(f.live,'node_modules/dsh-character-extras/cordis.patch.yml'),[{insert:[{...task,disabled:!active},{name:'dsh-plugin-bilibili'}]}]);
  const prepare=()=>execFileSync(process.execPath,[join(f.project,'scripts/prepare-host-upgrade.cjs'),'upgrade-fixture'],{env:{...process.env,DSH_INSTALL_ROOT:f.root,DSH_QQTK_PROJECT:f.root},stdio:'pipe'});
  if(active){assert.throws(prepare,error=>error.stderr.toString().includes('Long task Extras policy changed'));assert.throws(()=>execFileSync(process.execPath,[join(f.project,'scripts/prepare-deploy.cjs')],{env:{...process.env,DSH_INSTALL_ROOT:f.root,DSH_QQTK_PROJECT:f.root},stdio:'pipe'}),error=>error.stderr.toString().includes('Long task Extras policy changed'));}
  else{prepare();const result=JSON.parse(readFileSync(join(f.root,'data/profiles/upgrade-fixture/package.json')));assert(result.dsh.profile.bundles.includes('dsh-plugin-bilibili'));assert(!result.dependencies['dsh-character-long-tasks']);}
 }
});
