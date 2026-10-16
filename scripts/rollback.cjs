const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=require('./installation.cjs').install,state=root+'/data/maintenance/character-deploy',live=root+'/data/profiles/desktop';
const record=JSON.parse(fs.readFileSync(state+'/candidate.json','utf8'));
assert(record.previousProfile&&path.resolve(record.previousProfile).startsWith(path.resolve(root+'/data/maintenance')+path.sep));assert(fs.existsSync(record.previousProfile+'/package.json'));
// Caller must stop the installation and hold maintenance.lock first. Preserve failed state for diagnosis.
const checkpoint=path.resolve(record.checkpoint);assert(checkpoint.startsWith(path.resolve(root+'/data/maintenance/character-checkpoints')+path.sep));
const snapshot=JSON.parse(fs.readFileSync(checkpoint+'/manifest.json','utf8').replace(/^\uFEFF/,'')),crypto=require('crypto');
const memory=snapshot.files.filter(f=>/^data[\\/]character[\\/]memory\.sqlite(?:-wal|-shm)?$/.test(f.path));assert(memory.some(f=>/[\\/]memory\.sqlite$/.test(f.path)),'Missing schema rollback checkpoint');
for(const f of memory)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(checkpoint,f.path))).digest('hex').toUpperCase(),f.sha256);
const preserved=state+'/schema2-before-rollback-'+Date.now();fs.mkdirSync(preserved);
for(const suffix of ['','-wal','-shm']){const file=root+'/data/character/memory.sqlite'+suffix;if(fs.existsSync(file))fs.renameSync(file,preserved+'/memory.sqlite'+suffix);}
for(const f of memory)fs.copyFileSync(path.join(checkpoint,f.path),path.join(root,f.path));
fs.copyFileSync(state+'/policy-before.json',root+'/maintenance/plugin-policy.json');
fs.renameSync(live,state+'/failed-profile-'+Date.now());fs.renameSync(record.previousProfile,live);fs.copyFileSync(state+'/prefs-before.json',root+'/data/qqbot/model-prefs.json');
record.rolledBackAt=new Date().toISOString();record.preservedMemory=preserved;fs.writeFileSync(state+'/candidate.json',JSON.stringify(record,null,2));console.log('Previous profile, QQ routing, policy and checkpoint memory schema restored; newer memory retained separately.');
