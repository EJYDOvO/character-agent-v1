import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {upgrade,stageManager}=createRequire(import.meta.url)('../scripts/worker-upgrade.cjs');
test('Profile cutover preserves optional Preset Manager state and custom skill versions',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'character-manager-cutover-')),live=path.join(root,'data/profiles/desktop'),candidate=path.join(root,'data/profiles/candidate'),state=path.join(root,'data/maintenance/character-deploy');
 for(const dir of [live,candidate,state,path.join(root,'data/qqbot'),path.join(root,'data/character'),path.join(root,'maintenance'),path.join(live,'.dsh-preset-manager/skill-versions/fixture/v1/files')])fs.mkdirSync(dir,{recursive:true});
 const binding={appId:'fixture',ownerId:'owner',characterId:'fixture'},prefs={sessionIds:{'qqbot:fixture:c2c:owner':'existing-session'},presets:{'qqbot:fixture:c2c:owner':'qq-character'}};
 fs.writeFileSync(path.join(root,'data/qqbot/model-prefs.json'),JSON.stringify(prefs));fs.writeFileSync(path.join(root,'maintenance/plugin-policy.json'),JSON.stringify({localPackages:{}}));
 fs.writeFileSync(path.join(root,'data/character/binding.json'),JSON.stringify(binding));fs.writeFileSync(path.join(state,'binding.json'),JSON.stringify(binding));
 fs.writeFileSync(path.join(state,'candidate.json'),JSON.stringify({candidate,verifiedAt:new Date().toISOString(),sealed:{},artifacts:{}}));
 const settings='{"version":1,"presets":{"custom":{"base":[]}}}',skill='Synthetic saved version';
 fs.writeFileSync(path.join(live,'.dsh-preset-manager/state.json'),settings);fs.writeFileSync(path.join(live,'.dsh-preset-manager/skill-versions/fixture/v1/files/SKILL.md'),skill);
 execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/switch-profile.cjs',import.meta.url))],{env:{...process.env,DSH_INSTALL_ROOT:root},windowsHide:true,stdio:'pipe'});
 assert.equal(fs.readFileSync(path.join(live,'.dsh-preset-manager/state.json'),'utf8'),settings);
 assert.equal(fs.readFileSync(path.join(live,'.dsh-preset-manager/skill-versions/fixture/v1/files/SKILL.md'),'utf8'),skill);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'data/qqbot/model-prefs.json'))),prefs);
 assert(fs.existsSync(JSON.parse(fs.readFileSync(path.join(state,'candidate.json'))).previousProfile));
});

for(const failure of [false,true])test(`Character Profile upgrade preserves real configuration and manager state; rollback=${failure}`,()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'character-manager-upgrade-')),live=path.join(root,'data/profiles/desktop'),candidate=path.join(root,'data/profiles/candidate'),state=path.join(root,'data/maintenance/character-deploy');
 for(const dir of [live,candidate,state,path.join(root,'data/qqbot'),path.join(root,'data/character'),path.join(root,'maintenance'),path.join(live,'.dsh-preset-manager/skill-versions/fixture/v1/files')])fs.mkdirSync(dir,{recursive:true});
 const boundary={id:'worker-boundary',name:'dsh-character-memory-tools/worker.mjs'},persona=prefix=>({id:'persona',name:'persona',config:{prefix}}),tool={id:'custom-tool',name:'installed-tool',config:{count:2}};
 const old=[{insert:[{config:{id:'worker-general',plugins:[boundary,persona('old shipped persona')]}}]}],next=[{insert:[{config:{id:'worker-general',plugins:[persona('new shipped persona')]}}]}];
 const profile=[{id:'preset-worker-general',config:{plugins:[boundary,persona('old shipped persona'),{id:'group',group:true,config:[tool]}]}},{id:'manager-custom',config:{presets:[{id:'custom',plugins:[persona('private custom persona'),boundary,tool]}]}}];
 fs.writeFileSync(path.join(live,'cordis.patch.yml'),JSON.stringify(profile));
 const migrated=upgrade(profile,old,next);assert.equal(migrated.removed,2);assert.equal(migrated.personas,1);
 fs.writeFileSync(path.join(candidate,'cordis.patch.yml'),JSON.stringify(migrated.value));
 const manager=path.join(live,'.dsh-preset-manager'),settings={version:1,presets:{'worker-general':{base:[boundary,persona('old shipped persona')]},custom:{origin:'worker-general',base:[boundary,persona('custom persona')]}}};
 const files={'state.json':JSON.stringify(settings),'skills.json':JSON.stringify({version:1,presets:{custom:{off:['fixture']}},skills:{fixture:{versions:['v1']}}}),'history.json':JSON.stringify({version:1,presets:{custom:['old prompt']}}),'tool-descriptions.json':JSON.stringify({version:1,presets:{custom:{tools:{fixture:{text:'custom description'}}}}}),'skill-versions/fixture/v1/files/SKILL.md':'Synthetic skill version'};
 for(const [name,content]of Object.entries(files))fs.writeFileSync(path.join(manager,name),content);
 const staged=stageManager(live,candidate,old,next);assert.equal(staged.changed,3);
 const binding={appId:'fixture',ownerId:'owner'},prefs={sessionIds:{'qqbot:fixture:c2c:owner':'keep-session'},presets:{'qqbot:fixture:c2c:owner':'qq-character'}};
 fs.writeFileSync(path.join(root,'data/qqbot/model-prefs.json'),JSON.stringify(prefs));fs.writeFileSync(path.join(root,'maintenance/plugin-policy.json'),'{"localPackages":{}}');fs.writeFileSync(path.join(root,'data/character/binding.json'),JSON.stringify(binding));
 if(!failure)fs.writeFileSync(path.join(state,'binding.json'),JSON.stringify(binding));
 fs.writeFileSync(path.join(state,'candidate.json'),JSON.stringify({candidate,managerState:staged,verifiedAt:new Date().toISOString(),sealed:{},artifacts:{}}));
 const run=()=>execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/switch-profile.cjs',import.meta.url))],{env:{...process.env,DSH_INSTALL_ROOT:root},windowsHide:true,stdio:'pipe'});
 if(failure)assert.throws(run);else run();
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(live,'cordis.patch.yml'))),failure?profile:migrated.value);
 for(const [name,content]of Object.entries(files))if(name!=='state.json'||failure)assert.equal(fs.readFileSync(path.join(live,'.dsh-preset-manager',name),'utf8'),content);
 if(!failure){const saved=JSON.parse(fs.readFileSync(path.join(live,'.dsh-preset-manager/state.json')));assert.deepEqual(saved.presets['worker-general'].base,[persona('new shipped persona')]);assert.deepEqual(saved.presets.custom.base,[persona('custom persona')]);}
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'data/qqbot/model-prefs.json'))),prefs);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'data/character/binding.json'))),binding);
});

test('stale manager state blocks cutover before renaming either Profile',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'character-manager-stale-')),live=path.join(root,'data/profiles/desktop'),candidate=path.join(root,'data/profiles/candidate'),state=path.join(root,'data/maintenance/character-deploy');
 for(const dir of [live,candidate,state,path.join(live,'.dsh-preset-manager')])fs.mkdirSync(dir,{recursive:true});
 const staged=stageManager(live,candidate,[],[]);fs.writeFileSync(path.join(live,'.dsh-preset-manager/settings.json'),'{"changed":true}');
 fs.writeFileSync(path.join(state,'candidate.json'),JSON.stringify({candidate,managerState:staged,verifiedAt:new Date().toISOString(),sealed:{},artifacts:{}}));
 assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/switch-profile.cjs',import.meta.url))],{env:{...process.env,DSH_INSTALL_ROOT:root},windowsHide:true,stdio:'pipe'}),/Manager state changed/);
 assert(fs.existsSync(candidate));assert(fs.existsSync(live));
});
