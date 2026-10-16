const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const root=require('./installation.cjs').install,project=path.resolve(__dirname,'..'),state=root+'/data/maintenance/character-deploy';
const record=JSON.parse(fs.readFileSync(state+'/candidate.json','utf8')),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
for(const [f,h]of Object.entries(record.baseline)){const target=f==='policy'?root+'/maintenance/plugin-policy.json':f==='prefs'?root+'/data/qqbot/model-prefs.json':f==='asar'?root+'/resources/app.asar':root+'/data/profiles/desktop/'+f;assert.equal(hash(target),h,'Baseline changed: '+f);}
for(const p of Object.values(record.artifacts))assert.equal(hash(p.source.slice(5)),p.sha256,'Artifact changed');
const audit=JSON.parse(fs.readFileSync(project+'/reports/nightly-2026-10-16/offline-state.json','utf8'));assert.equal(audit.pendingTurns,0);assert.equal(audit.parseErrors,0);assert.equal(audit.legacyScheduleEvents,0);assert.equal(audit.types['approval/asked'],audit.types['approval/decided']);
assert(!fs.existsSync(root+'/data/storages/schedule'),'Unknown legacy Schedule directory: inspect before switch');
if(fs.existsSync(root+'/data/storages/schedule.json')){const schedule=JSON.parse(fs.readFileSync(root+'/data/storages/schedule.json','utf8'));assert.equal(schedule.unit?.name,'schedule');assert.equal(schedule.unit.version,1);assert(schedule.tables?.tasks&&typeof schedule.tables.tasks==='object');assert(Object.values(schedule.tables.tasks).every(t=>t.status==='inactive'),'Active reminders require an explicit migration/recovery check before switch');}
const checkpoints=root+'/data/maintenance/character-checkpoints';const checkpoint=checkpoints+'/'+fs.readdirSync(checkpoints).filter(n=>/^\d{8}-\d{6}$/.test(n)).sort().at(-1);const snapshot=JSON.parse(fs.readFileSync(checkpoint+'/manifest.json','utf8').replace(/^\uFEFF/,''));
for(const f of snapshot.files)assert.equal(hash(checkpoint+'/'+f.path).toUpperCase(),f.sha256,'Checkpoint integrity failure');
assert.equal(hash(root+'/resources/app.asar').toUpperCase(),snapshot.officialAsarSha256);
const probe=JSON.parse(fs.readFileSync(project+'/artifacts/host-probe.json','utf8'));assert(probe.ok);
const digest=require('./source-digest.cjs')();assert.equal(digest,record.sourceDigest,'Source changed after packaging');assert.equal(probe.sourceDigest,digest,'Host probe belongs to other source');
const unit=JSON.parse(fs.readFileSync(project+'/artifacts/test-results.json','utf8'));assert(unit.ok);assert.equal(unit.sourceDigest,digest,'Unit results belong to other source');
record.sealed={};for(const f of ['package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml','character-artifacts.json'])record.sealed[f]=hash(record.candidate+'/'+f);
record.checkpoint=checkpoint;record.verifiedAt=new Date().toISOString();fs.writeFileSync(state+'/candidate.json',JSON.stringify(record,null,2));
console.log(JSON.stringify({gate:'passed',checkpointFiles:snapshot.files.length,pendingTurns:0,activeScheduleTasks:0,officialAsarUnchanged:true}));
