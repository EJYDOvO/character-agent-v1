const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=require('./installation.cjs').install,state=root+'/data/maintenance/character-deploy',live=root+'/data/profiles/desktop';
const record=JSON.parse(fs.readFileSync(state+'/candidate.json','utf8'));
assert(record.previousProfile&&path.resolve(record.previousProfile).startsWith(path.resolve(root+'/data/maintenance')+path.sep));assert(fs.existsSync(record.previousProfile+'/package.json'));
// Caller must stop the installation and hold maintenance.lock first. Preserve failed state for diagnosis.
fs.renameSync(live,state+'/failed-profile-'+Date.now());fs.renameSync(record.previousProfile,live);fs.copyFileSync(state+'/prefs-before.json',root+'/data/qqbot/model-prefs.json');
record.rolledBackAt=new Date().toISOString();fs.writeFileSync(state+'/candidate.json',JSON.stringify(record,null,2));console.log('Previous profile and QQ routing restored; new Character databases retained for diagnosis.');
