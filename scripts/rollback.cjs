const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=require('./installation.cjs').install,state=root+'/data/maintenance/character-deploy',live=root+'/data/profiles/desktop';
const record=JSON.parse(fs.readFileSync(state+'/candidate.json','utf8'));
(async()=>{
assert(record.previousProfile&&path.resolve(record.previousProfile).startsWith(path.resolve(root+'/data/maintenance')+path.sep));assert(fs.existsSync(record.previousProfile+'/package.json'));
// Caller must stop the installation and hold maintenance.lock first. Preserve failed state for diagnosis.
const checkpoint=path.resolve(record.checkpoint);assert(checkpoint.startsWith(path.resolve(root+'/data/maintenance/character-checkpoints')+path.sep));
const snapshot=JSON.parse(fs.readFileSync(checkpoint+'/manifest.json','utf8').replace(/^\uFEFF/,'')),crypto=require('crypto');
const memory=snapshot.files.filter(f=>/^data[\\/]character[\\/]memory\.sqlite(?:-wal|-shm)?$/.test(f.path));assert(memory.some(f=>/[\\/]memory\.sqlite$/.test(f.path)),'Missing schema rollback checkpoint');
for(const f of memory)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(checkpoint,f.path))).digest('hex').toUpperCase(),f.sha256);
// A checkpoint is a disaster-recovery resource, not an automatic replacement
// for newer user data. Old code must accept a copy of the current schema first.
const compatibility=await require('./rollback-memory.cjs')({database:root+'/data/character/memory.sqlite',previousCore:record.previousProfile+'/node_modules/dsh-character-memory-core',output:state+'/rollback-validation-'+Date.now()+'/memory.sqlite'});
fs.copyFileSync(state+'/policy-before.json',root+'/maintenance/plugin-policy.json');
if(fs.existsSync(state+'/binding-before.json'))fs.copyFileSync(state+'/binding-before.json',root+'/data/character/binding.json');
fs.renameSync(live,state+'/failed-profile-'+Date.now());fs.renameSync(record.previousProfile,live);fs.copyFileSync(state+'/prefs-before.json',root+'/data/qqbot/model-prefs.json');
record.rolledBackAt=new Date().toISOString();record.memoryRollback=compatibility;fs.writeFileSync(state+'/candidate.json',JSON.stringify(record,null,2));console.log('Previous profile, QQ routing and policy restored; current memory and newer records preserved in place.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
