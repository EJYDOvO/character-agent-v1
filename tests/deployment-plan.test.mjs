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
function tarball(file,version,name='dsh-remote-ops-local',extra={}){
 const entry=(path,body)=>{const header=Buffer.alloc(512);header.write(path);header.write(body.length.toString(8).padStart(11,'0'),124);return Buffer.concat([header,body,Buffer.alloc(Math.ceil(body.length/512)*512-body.length)]);};
 writeFileSync(file,gzipSync(Buffer.concat([entry('package/package.json',Buffer.from(JSON.stringify({name,version}))),...Object.entries(extra).map(([p,t])=>entry('package/'+p,Buffer.from(t))),Buffer.alloc(1024)])));
}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'deployment-contract-')),live=join(root,'data/profiles/desktop'),project=join(root,'source');
 const binding={appId:'synthetic-app',ownerId:'synthetic-owner',characterId:'character-a',projectId:'preserve-project'};
 write(join(root,'data/character/binding.json'),binding);write(join(root,'data/maintenance/owner.json'),{openid:binding.ownerId});write(join(root,'data/qqbot/model-prefs.json'),{});write(join(root,'maintenance/plugin-policy.json'),{localPackages:{}});write(join(root,'resources/app.asar'),'synthetic placeholder');
 const remote=join(root,'remote.tgz');tarball(remote,'1.1.1-test.1');
 write(join(live,'package.json'),{dependencies:{'dsh-remote-ops-local':'file:'+remote},dsh:{profile:{bundles:['dsh-character-core','dsh-free-search']}}});
 write(join(live,'character-artifacts.json'),{'dsh-remote-ops-local':{source:'file:'+remote,sha256:plan.hash(remote)}});
 write(join(live,'node_modules/dsh-remote-ops-local/package.json'),{name:'dsh-remote-ops-local',version:'1.1.1-test.1'});
 write(join(live,'node_modules/dsh-character-core/cordis.patch.yml'),[]);
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
 for(const name of ['prepare-deploy','prepare-host-upgrade','installation','deployment-plan','package-plan','inspector-declaration','worker-upgrade'])cpSync(fileURLToPath(new URL('../scripts/'+name+'.cjs',import.meta.url)),join(project,'scripts',name+'.cjs'),{recursive:true});
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
test('Conversation extraction refuses unreviewed routes, missing state and unpinned dependencies',()=>{
 const f=fixture(),stateFile=join(f.root,'conversations.json'),core=[{insert:[{id:'conversation-manager',name:'dsh-conversation-manager',config:{stateFile}}]}];
 assert.throws(()=>plan.verifiedConversation(f.live,core,[],[]),/offline routing/);
 assert.throws(()=>plan.verifiedConversation(f.live,core,[],['--conversation-state-reviewed']),/state missing/);
 write(stateFile,{});assert.throws(()=>plan.verifiedConversation(f.live,core,[],['--conversation-state-reviewed']));
 const name='dsh-conversation-manager',file=join(f.root,'manager.tgz');tarball(file,'0.1.0-test.1',name);
 const manifest=JSON.parse(readFileSync(join(f.live,'package.json')));manifest.dependencies[name]='file:'+file;write(join(f.live,'package.json'),manifest);
 const pins=JSON.parse(readFileSync(join(f.live,'character-artifacts.json')));pins[name]={source:'file:'+file,sha256:plan.hash(file),version:'0.1.0-test.1'};write(join(f.live,'character-artifacts.json'),pins);write(join(f.live,'node_modules',name,'package.json'),{name,version:'0.1.0-test.1'});
 assert.equal(plan.verifiedConversation(f.live,core,[],['--conversation-state-reviewed']).name,name);
 assert.equal(plan.verifiedConversation(f.live,core,core,[]).version,'0.1.0-test.1');
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
test('A QQ patch that needs the Unified Agent I/O requires a Core row and a reviewed, pinned dsh-agent-io artifact',()=>{
 const f=fixture(),qqPatch=join(f.root,'maintenance/patches/dsh-qqbot@0.5.2.patch'),name='dsh-agent-io';
 write(qqPatch,"+export const inject = ['agents', 'conversationManager', 'agentIO'];\n");
 const patches=plan.patchPlan(f.live,f.root,{load:JSON.parse}).patches,core=[{insert:[{id:'agent-io',name,config:{}}]}];
 assert.throws(()=>plan.verifiedAgentIO(f.live,[],patches,[]),/requires dsh-agent-io; rebuild/,'no silent start without the service');
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,[]),/reviewed tarball/,'no implicit first install');
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact=relative.tgz']),/missing/);
 const wrong=join(f.root,'wrong.tgz');tarball(wrong,'0.1.0-test.2','dsh-other');assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+wrong]),/Invalid dsh-agent-io/);
 const file=join(f.root,'agent-io.tgz');tarball(file,'0.1.0-test.2',name);
 const fresh=plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+file]);assert.deepEqual([fresh.fresh,fresh.version,fresh.sha256],[true,'0.1.0-test.2',plan.hash(file)]);
 const pin=plan.pinAgentIO(fresh,f.root);assert.equal(plan.hash(join(f.root,'plugin-packages','dsh-agent-io-0.1.0-test.2.tgz')),pin.sha256);assert(pin.source.startsWith('file:'));
 const other=join(f.root,'other.tgz');tarball(other,'0.1.0-test.2',name);writeFileSync(other,Buffer.concat([readFileSync(other),Buffer.alloc(1)]));
 assert.throws(()=>plan.pinAgentIO(plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+other]),f.root),/Immutable artifact differs/);
 // Once installed and pinned in the Profile it is re-verified like the Manager.
 const manifest=JSON.parse(readFileSync(join(f.live,'package.json')));manifest.dependencies[name]=pin.source;write(join(f.live,'package.json'),manifest);
 const pins=JSON.parse(readFileSync(join(f.live,'character-artifacts.json')));pins[name]={source:pin.source,sha256:pin.sha256,version:pin.version};write(join(f.live,'character-artifacts.json'),pins);
 write(join(f.live,'node_modules',name,'package.json'),{name,version:'0.1.0-test.2'});
 assert.deepEqual(plan.verifiedAgentIO(f.live,core,patches,[]),{name,source:pin.source,sha256:pin.sha256,version:'0.1.0-test.2'});
 // The real preparation CLI pins it into the candidate and its record.
 write(join(f.project,'bundles/character-core/cordis.patch.yml'),core);
 execFileSync(process.execPath,[join(f.project,'scripts/prepare-deploy.cjs')],{env:{...process.env,DSH_INSTALL_ROOT:f.root,DSH_QQTK_PROJECT:f.root},stdio:'pipe'});
 const candidate=JSON.parse(readFileSync(join(f.root,'data/profiles/character-candidate/package.json'))),record=JSON.parse(readFileSync(join(f.root,'data/maintenance/character-deploy/candidate.json')));
 assert.equal(candidate.dependencies[name],pin.source);assert.deepEqual(record.artifacts[name],{name,source:pin.source,sha256:pin.sha256,version:'0.1.0-test.2'});
});
test('A QQ patch that opens the Conversation wiring refuses a dsh-agent-io without openConversation, installed or fresh',()=>{
 const f=fixture(),qqPatch=join(f.root,'maintenance/patches/dsh-qqbot@0.5.2.patch'),name='dsh-agent-io',core=[{insert:[{id:'agent-io',name,config:{}}]}];
 write(qqPatch,"+export const inject = ['agents', 'conversationManager', 'agentIO'];\n+    const conversation = io.openConversation({ platform: QQ_OFFICIAL });\n");
 const patches=plan.patchPlan(f.live,f.root,{load:JSON.parse}).patches;
 const old=join(f.root,'old.tgz');tarball(old,'0.1.0-test.3',name,{'index.mjs':"ctx.provide('agentIO',{sendMessage,registerAdapter,openInbound});"});
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+old]),/openConversation \(0\.1\.0-test\.4 or later\)/);
 const next=join(f.root,'next.tgz');tarball(next,'0.1.0-test.4',name,{'index.mjs':"ctx.provide('agentIO',{sendMessage,registerAdapter,openInbound,openConversation});"});
 assert.equal(plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+next]).version,'0.1.0-test.4');
 // An installed, pinned older package is not silently kept under the new patch.
 const pin=plan.pinAgentIO(plan.verifiedAgentIO(f.live,core,[],['--agent-io-artifact='+old]),f.root);
 const manifest=JSON.parse(readFileSync(join(f.live,'package.json')));manifest.dependencies[name]=pin.source;write(join(f.live,'package.json'),manifest);
 const pins=JSON.parse(readFileSync(join(f.live,'character-artifacts.json')));pins[name]={source:pin.source,sha256:pin.sha256,version:pin.version};write(join(f.live,'character-artifacts.json'),pins);
 write(join(f.live,'node_modules',name,'package.json'),{name,version:'0.1.0-test.3'});write(join(f.live,'node_modules',name,'index.mjs'),"ctx.provide('agentIO',{sendMessage,registerAdapter,openInbound});");
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,[]),/installed dsh-agent-io 0\.1\.0-test\.3 lacks it: upgrade it with --agent-io-artifact/);
 assert.equal(plan.verifiedAgentIO(f.live,core,[],[]).version,'0.1.0-test.3','the previous patch keeps the installed package');
 // Explicit upgrade: verified like a first install, a new version, the old tarball kept.
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+old]),/openConversation \(0\.1\.0-test\.4 or later\)/,'an upgrade to a package without the interface is refused');
 const same=join(f.root,'same.tgz');tarball(same,'0.1.0-test.3',name,{'index.mjs':"ctx.provide('agentIO',{sendMessage,registerAdapter,openInbound,openConversation});"});
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+same]),/already installed; a changed package needs a new version/);
 const wrong=join(f.root,'wrong.tgz');tarball(wrong,'0.1.0-test.4','dsh-other',{'index.mjs':'openConversation'});
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+wrong]),/Invalid dsh-agent-io tarball/);
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+join(f.root,'missing.tgz')]),/tarball missing/);
 const upgrade=plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+next]);
 assert.deepEqual([upgrade.fresh,upgrade.version,upgrade.upgradeFrom,upgrade.sha256],[true,'0.1.0-test.4','0.1.0-test.3',plan.hash(next)]);
 const pinned=plan.pinAgentIO(upgrade,f.root);assert.deepEqual(pinned,{name,source:'file:'+join(f.root,'plugin-packages','dsh-agent-io-0.1.0-test.4.tgz').replaceAll('\\','/'),sha256:plan.hash(next),version:'0.1.0-test.4'});
 assert.equal(plan.hash(join(f.root,'plugin-packages','dsh-agent-io-0.1.0-test.3.tgz')),pin.sha256,'the replaced tarball stays for rollback');
 // A tampered installed artifact is still refused before any upgrade.
 writeFileSync(join(f.root,'plugin-packages','dsh-agent-io-0.1.0-test.3.tgz'),Buffer.concat([readFileSync(old),Buffer.alloc(1)]));
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+next]),/artifact hash changed/);
});
test('A QQ patch that opens the I/O command router refuses dsh-agent-io without openCommands and upgrades to one that has it',()=>{
 const f=fixture(),qqPatch=join(f.root,'maintenance/patches/dsh-qqbot@0.5.2.patch'),name='dsh-agent-io',core=[{insert:[{id:'agent-io',name,config:{}}]}];
 write(qqPatch,"+export const inject = ['agents', 'conversationManager', 'agentIO'];\n+    const conversation = io.openConversation({ platform: QQ_OFFICIAL });\n+    const router = conversation.openCommands({ prefixes: ['/'] });\n");
 const patches=plan.patchPlan(f.live,f.root,{load:JSON.parse}).patches;
 const test4=join(f.root,'test4.tgz');tarball(test4,'0.1.0-test.4',name,{'index.mjs':"ctx.provide('agentIO',{sendMessage,registerAdapter,openInbound,openConversation});",'conversation.mjs':'export function createConversations(){}'});
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+test4]),/openCommands \(0\.1\.0-test\.5 or later\)/);
 const noIndex=join(f.root,'half.tgz');tarball(noIndex,'0.1.0-test.5',name,{'index.mjs':"ctx.provide('agentIO',{sendMessage});",'conversation.mjs':'openCommands'});
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+noIndex]),/openCommands/,'both interfaces are required');
 // Installed test.4 under the new patch: refused without an upgrade, upgraded with a reviewed test.5.
 const pin=plan.pinAgentIO(plan.verifiedAgentIO(f.live,core,[],['--agent-io-artifact='+test4]),f.root);
 const manifest=JSON.parse(readFileSync(join(f.live,'package.json')));manifest.dependencies[name]=pin.source;write(join(f.live,'package.json'),manifest);
 const pins=JSON.parse(readFileSync(join(f.live,'character-artifacts.json')));pins[name]={source:pin.source,sha256:pin.sha256,version:pin.version};write(join(f.live,'character-artifacts.json'),pins);
 write(join(f.live,'node_modules',name,'package.json'),{name,version:'0.1.0-test.4'});
 write(join(f.live,'node_modules',name,'index.mjs'),"ctx.provide('agentIO',{sendMessage,registerAdapter,openInbound,openConversation});");write(join(f.live,'node_modules',name,'conversation.mjs'),'export function createConversations(){}');
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,[]),/installed dsh-agent-io 0\.1\.0-test\.4 lacks it/);
 const test5=join(f.root,'test5.tgz');tarball(test5,'0.1.0-test.5',name,{'index.mjs':"ctx.provide('agentIO',{sendMessage,registerAdapter,openInbound,openConversation});",'conversation.mjs':'function openCommands(){}'});
 assert.deepEqual([plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+test5]).upgradeFrom],['0.1.0-test.4']);
});
test('A QQ patch that opens the HITL Bridge refuses dsh-agent-io test.5 and accepts a test.6 with openHITL and its hitl module',()=>{
 const f=fixture(),qqPatch=join(f.root,'maintenance/patches/dsh-qqbot@0.5.2.patch'),name='dsh-agent-io',core=[{insert:[{id:'agent-io',name,config:{}}]}];
 write(qqPatch,"+export const inject = ['agents', 'conversationManager', 'agentIO'];\n+    const conversation = io.openConversation({ platform: QQ_OFFICIAL });\n+    const router = conversation.openCommands({ prefixes: ['/'] });\n+    return conversation.openHITL({\n");
 const patches=plan.patchPlan(f.live,f.root,{load:JSON.parse}).patches,index="ctx.provide('agentIO',{sendMessage,registerAdapter,openInbound,openConversation});";
 const test5=join(f.root,'test5.tgz');tarball(test5,'0.1.0-test.5',name,{'index.mjs':index,'conversation.mjs':'function openCommands(){}'});
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+test5]),/openHITL \(0\.1\.0-test\.6 or later\)/);
 const noModule=join(f.root,'half6.tgz');tarball(noModule,'0.1.0-test.6',name,{'index.mjs':index,'conversation.mjs':'function openCommands(){} function openHITL(){}'});
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+noModule]),/openHITL/,'the Bridge module itself is required');
 const test6=join(f.root,'test6.tgz');tarball(test6,'0.1.0-test.6',name,{'index.mjs':index,'conversation.mjs':'function openCommands(){} function openHITL(){}','hitl.mjs':'export function createHITLBridge(){}'});
 assert.equal(plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+test6]).version,'0.1.0-test.6');
});
test('A QQ patch that opens the Agent I/O notifier refuses dsh-agent-io test.6 and accepts a test.7 with openNotifications',()=>{
 const f=fixture(),qqPatch=join(f.root,'maintenance/patches/dsh-qqbot@0.5.2.patch'),name='dsh-agent-io',core=[{insert:[{id:'agent-io',name,config:{}}]}];
 write(qqPatch,"+export const inject = ['agents', 'conversationManager', 'agentIO'];\n+    const conversation = io.openConversation({ platform: QQ_OFFICIAL });\n+    const router = conversation.openCommands({ prefixes: ['/'] });\n+    return conversation.openHITL({\n+    const notifications = conversation.openNotifications();\n");
 const patches=plan.patchPlan(f.live,f.root,{load:JSON.parse}).patches,index="ctx.provide('agentIO',{sendMessage,registerAdapter,openInbound,openConversation});",hitl='export function createHITLBridge(){}';
 const test6=join(f.root,'test6.tgz');tarball(test6,'0.1.0-test.6',name,{'index.mjs':index,'conversation.mjs':'function openCommands(){} function openHITL(){}','hitl.mjs':hitl});
 assert.throws(()=>plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+test6]),/openNotifications \(0\.1\.0-test\.7 or later\)/);
 const test7=join(f.root,'test7.tgz');tarball(test7,'0.1.0-test.7',name,{'index.mjs':index,'conversation.mjs':'function openCommands(){} function openHITL(){} function openNotifications(){}','hitl.mjs':hitl});
 assert.equal(plan.verifiedAgentIO(f.live,core,patches,['--agent-io-artifact='+test7]).version,'0.1.0-test.7');
});
test('the Character QQ wrapper declares agentIO and generated Core installs dsh-agent-io',()=>{
 const adapter=readFileSync(new URL('../packages/character-qq-adapter/index.mjs',import.meta.url),'utf8'),build=readFileSync(new URL('../scripts/build.cjs',import.meta.url),'utf8');
 assert.match(adapter,/export const inject=\[[^\]]*'agentIO'/);
 assert.match(build,/\{id:'agent-io',name:'dsh-agent-io',config:\{\}\}/);assert(build.indexOf("id:'agent-io'")<build.indexOf("id:'im-qqbot'"));
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
