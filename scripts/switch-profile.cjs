const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const root=require('./installation.cjs').install,state=root+'/data/maintenance/character-deploy',live=root+'/data/profiles/desktop';const record=JSON.parse(fs.readFileSync(state+'/candidate.json','utf8'));const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert(record.verifiedAt&&Date.now()-Date.parse(record.verifiedAt)<60000,'Fresh gate required');
for(const [f,h]of Object.entries(record.sealed))assert.equal(hash(record.candidate+'/'+f),h);
if(record.managerState){const {snapshot}=require('./worker-upgrade.cjs');assert.deepEqual(snapshot(live+'/.dsh-preset-manager'),record.managerState.baseline,'Manager state changed after staging; restage required');assert.deepEqual(snapshot(record.candidate+'/.dsh-preset-manager'),record.managerState.sealed,'Staged Manager state changed');}
const before=root+'/data/maintenance/character-profile-before-'+Date.now();assert(!fs.existsSync(before));
fs.copyFileSync(root+'/data/qqbot/model-prefs.json',state+'/prefs-before.json');
fs.copyFileSync(root+'/maintenance/plugin-policy.json',state+'/policy-before.json');
const bindingPath=root+'/data/character/binding.json',hadBinding=fs.existsSync(bindingPath);
if(hadBinding)fs.copyFileSync(bindingPath,state+'/binding-before.json');
for(const target of [live,before,record.candidate])assert(path.resolve(target).startsWith(path.resolve(root+'/data')+path.sep),'Profile path outside installation data');
record.previousProfile=before;fs.writeFileSync(state+'/candidate.json',JSON.stringify(record,null,2));
fs.renameSync(live,before);
try{
 fs.renameSync(record.candidate,live);
 for(const name of ['.plugin-manager','.dsh-preset-manager','cordis.yml'])if(fs.existsSync(before+'/'+name)&&!(name==='.dsh-preset-manager'&&record.managerState))fs.cpSync(before+'/'+name,live+'/'+name,{recursive:true});
 fs.mkdirSync(root+'/data/character',{recursive:true});fs.copyFileSync(state+'/binding.json',root+'/data/character/binding.json');
 const binding=JSON.parse(fs.readFileSync(state+'/binding.json','utf8')),prefs=JSON.parse(fs.readFileSync(state+'/prefs-before.json','utf8'));
 const key=`qqbot:${binding.appId}:c2c:${binding.ownerId}`;prefs.sessionIds??={};prefs.presets??={};if(prefs.presets[key]!=='qq-character'||!prefs.sessionIds[key])prefs.sessionIds[key]=crypto.randomUUID();prefs.presets[key]='qq-character';
 fs.writeFileSync(root+'/data/qqbot/model-prefs.json',JSON.stringify(prefs,null,2));
 const policy=JSON.parse(fs.readFileSync(state+'/policy-before.json','utf8'));
 for(const [name,pin]of Object.entries(record.artifacts))policy.localPackages[name]=pin;
 fs.writeFileSync(root+'/maintenance/plugin-policy.json',JSON.stringify(policy,null,2));
 record.switchedAt=new Date().toISOString();fs.writeFileSync(state+'/candidate.json',JSON.stringify(record,null,2));console.log(JSON.stringify({switched:true,previousProfile:before,oldSessionsRetained:true,newPreset:'qq-character'}));
}catch(e){if(fs.existsSync(live))fs.renameSync(live,state+'/failed-profile-'+Date.now());fs.renameSync(before,live);fs.copyFileSync(state+'/prefs-before.json',root+'/data/qqbot/model-prefs.json');fs.copyFileSync(state+'/policy-before.json',root+'/maintenance/plugin-policy.json');if(hadBinding)fs.copyFileSync(state+'/binding-before.json',bindingPath);else if(fs.existsSync(bindingPath))fs.renameSync(bindingPath,state+'/failed-binding-'+Date.now()+'.json');throw e;}
