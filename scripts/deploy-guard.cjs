const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const root=require('./installation.cjs').install,project=path.resolve(__dirname,'..'),state=root+'/data/maintenance/character-deploy';
const record=JSON.parse(fs.readFileSync(state+'/candidate.json','utf8')),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
for(const [f,h]of Object.entries(record.baseline)){const target=f==='prefs'?root+'/data/qqbot/model-prefs.json':f==='asar'?root+'/resources/app.asar':root+'/data/profiles/desktop/'+f;assert.equal(hash(target),h,'Baseline changed: '+f);}
for(const p of Object.values(record.artifacts))assert.equal(hash(p.source.slice(5)),p.sha256,'Artifact changed');
const audit=JSON.parse(fs.readFileSync(project+'/reports/nightly-2026-10-16/offline-state.json','utf8'));assert.equal(audit.pendingTurns,0);assert.equal(audit.parseErrors,0);assert.equal(audit.legacyScheduleEvents,0);assert.equal(audit.types['approval/asked'],audit.types['approval/decided']);
assert(!fs.existsSync(root+'/data/storages/schedule.json')&&!fs.existsSync(root+'/data/storages/schedule'),'Schedule storage exists: inspect active tasks before switch');
const checkpoints=root+'/data/maintenance/character-checkpoints';const checkpoint=checkpoints+'/'+fs.readdirSync(checkpoints).filter(n=>/^\d{8}-\d{6}$/.test(n)).sort().at(-1);const snapshot=JSON.parse(fs.readFileSync(checkpoint+'/manifest.json','utf8').replace(/^\uFEFF/,''));
for(const f of snapshot.files)assert.equal(hash(checkpoint+'/'+f.path).toUpperCase(),f.sha256,'Checkpoint integrity failure');
assert.equal(hash(root+'/resources/app.asar').toUpperCase(),snapshot.officialAsarSha256);
const probe=JSON.parse(fs.readFileSync(project+'/artifacts/host-probe.json','utf8'));assert(probe.ok);
record.sealed={};for(const f of ['package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml','character-artifacts.json'])record.sealed[f]=hash(record.candidate+'/'+f);
record.checkpoint=checkpoint;record.verifiedAt=new Date().toISOString();fs.writeFileSync(state+'/candidate.json',JSON.stringify(record,null,2));
console.log(JSON.stringify({gate:'passed',checkpointFiles:snapshot.files.length,pendingTurns:0,scheduleStorageAbsent:true,officialAsarUnchanged:true}));
