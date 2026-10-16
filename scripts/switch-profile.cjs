const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const root=require('./installation.cjs').install,state=root+'/data/maintenance/character-deploy',live=root+'/data/profiles/desktop';const record=JSON.parse(fs.readFileSync(state+'/candidate.json','utf8'));const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert(record.verifiedAt&&Date.now()-Date.parse(record.verifiedAt)<60000,'Fresh gate required');
for(const [f,h]of Object.entries(record.sealed))assert.equal(hash(record.candidate+'/'+f),h);
const before=root+'/data/maintenance/character-profile-before-'+Date.now();assert(!fs.existsSync(before));
fs.copyFileSync(root+'/data/qqbot/model-prefs.json',state+'/prefs-before.json');
fs.copyFileSync(root+'/maintenance/plugin-policy.json',state+'/policy-before.json');
for(const target of [live,before,record.candidate])assert(path.resolve(target).startsWith(path.resolve(root+'/data')+path.sep),'Profile path outside installation data');
record.previousProfile=before;fs.writeFileSync(state+'/candidate.json',JSON.stringify(record,null,2));
fs.renameSync(live,before);
try{
 fs.renameSync(record.candidate,live);
 for(const name of ['.plugin-manager','cordis.yml'])if(fs.existsSync(before+'/'+name))fs.cpSync(before+'/'+name,live+'/'+name,{recursive:true});
 fs.mkdirSync(root+'/data/character',{recursive:true});fs.copyFileSync(state+'/binding.json',root+'/data/character/binding.json');
 const binding=JSON.parse(fs.readFileSync(state+'/binding.json','utf8')),prefs=JSON.parse(fs.readFileSync(state+'/prefs-before.json','utf8'));
 const key=`qqbot:${binding.appId}:c2c:${binding.ownerId}`;prefs.sessionIds??={};prefs.presets??={};if(prefs.presets[key]!=='qq-character'||!prefs.sessionIds[key])prefs.sessionIds[key]=crypto.randomUUID();prefs.presets[key]='qq-character';
 fs.writeFileSync(root+'/data/qqbot/model-prefs.json',JSON.stringify(prefs,null,2));
 const policy=JSON.parse(fs.readFileSync(state+'/policy-before.json','utf8'));policy.localPackages['dsh-remote-ops-local']=record.artifacts['dsh-remote-ops-local'];fs.writeFileSync(root+'/maintenance/plugin-policy.json',JSON.stringify(policy,null,2));
 record.switchedAt=new Date().toISOString();fs.writeFileSync(state+'/candidate.json',JSON.stringify(record,null,2));console.log(JSON.stringify({switched:true,previousProfile:before,oldSessionsRetained:true,newPreset:'qq-character'}));
}catch(e){if(fs.existsSync(live))fs.renameSync(live,state+'/failed-profile-'+Date.now());fs.renameSync(before,live);fs.copyFileSync(state+'/prefs-before.json',root+'/data/qqbot/model-prefs.json');throw e;}
