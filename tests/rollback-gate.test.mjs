import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {zstdCompressSync} from 'node:zlib';
import {observe,decide} from '../scripts/rollback-gate.mjs';
function fixture(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'rollback-gate-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const write=(rel,v)=>{const p=path.join(home,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,rel.endsWith('.zstd')?zstdCompressSync(JSON.stringify({type:'session',version:Number(/\.v(\d+)\./.exec(rel)[1])})+'\n'):typeof v==='string'?v:JSON.stringify(v));};
 write('storages/schedule.json',{unit:{name:'schedule',version:1},global:null,tables:{tasks:{a:{record:{id:'a'},sessionId:'s1'}}}});
 write('storages/workspace.json',{unit:{name:'workspace',version:2},global:{},tables:{}});
 write('storages/character_long_tasks/runs/r1.json',{version:1,record:{id:'r1',status:'completed'}});
 write('sessions/w/s1/session.v4.jsonl.zstd','log-1');
 const state=path.join(home,'coordination.sqlite'),db=new DatabaseSync(state);
 db.exec("PRAGMA journal_mode=WAL;CREATE TABLE outbox(id TEXT PRIMARY KEY,status TEXT NOT NULL);CREATE TABLE qq_bindings(session TEXT PRIMARY KEY);INSERT INTO outbox VALUES('e1','sent');INSERT INTO qq_bindings VALUES('s1');");
 const input={home,sqlites:[state],files:[]};return {home,write,state,db,input,before:observe(input)};
}
test('identical data allows swapping only the Host back',t=>{
 const f=fixture(t);f.db.close();f.before=observe(f.input);const r=decide(f.before,observe(f.input));assert.equal(r.decision,'host_rollback_allowed');assert.deepEqual(r.blockers,[]);assert.equal(r.readOnly,true);
});
test('Schedule v2 written by the new Host refuses Host rollback even when other data is unchanged',t=>{
 const f=fixture(t);f.db.close();f.write('storages/schedule.json',{unit:{name:'schedule',version:2},global:null,tables:{tasks:{}}});
 const r=decide(f.before,observe(f.input));assert.equal(r.decision,'host_rollback_refused');assert(r.blockers.some(b=>/schedule version 1 -> 2/.test(b)));assert.match(r.restore,/explicit maintainer decision/);
});
test('an unchanged Schedule hash is not enough: committed WAL rows, Sessions and ledger records need an old-Host replay',t=>{
 const f=fixture(t);f.db.exec("INSERT INTO outbox VALUES('e2','pending');INSERT INTO qq_bindings VALUES('s2')");// still in WAL: connection open, no checkpoint
 f.write('sessions/w/s2/session.v4.jsonl.zstd','log-2');f.write('storages/character_long_tasks/runs/r2.json',{version:1,record:{id:'r2',status:'completed'}});
 const now=observe(f.input);assert.equal(now.storages.units.schedule.sha256,f.before.storages.units.schedule.sha256,'Schedule file unchanged');assert(now.sqlite[path.resolve(f.state)].walBytes>0);
 const r=decide(f.before,now);f.db.close();
 assert.equal(r.decision,'host_rollback_needs_replay');assert.deepEqual(r.blockers,[]);
 for(const re of [/coordination\.sqlite\.outbox: 1 -> 2/,/qq_bindings: 1 -> 2/,/1 Session logs/,/character_long_tasks: 1 records/,/WAL bytes/])assert(r.changes.some(c=>re.test(c)),String(re));
});
test('in-flight Outbox or Long Task work, schema changes, new unit or Session formats refuse Host rollback',t=>{
 const f=fixture(t);
 f.db.exec("UPDATE outbox SET status='sending' WHERE id='e1';CREATE TABLE extra(x)");f.db.close();
 f.write('storages/character_long_tasks/runs/r3.json',{version:1,record:{id:'r3',status:'running'}});
 f.write('storages/new_unit.json',{unit:{name:'new_unit',version:1},tables:{}});f.write('sessions/w/s3/session.v5.jsonl.zstd','log-3');
 const r=decide(f.before,observe(f.input));assert.equal(r.decision,'host_rollback_refused');
 for(const re of [/rows sending/,/schema\/user_version changed/,/1 records in flight/,/new_unit created/,/format 5 not present/])assert(r.blockers.some(b=>re.test(b)),String(re));
});
test('missing or unreadable SQLite state refuses instead of guessing',t=>{
 const f=fixture(t);f.db.close();fs.rmSync(f.state);
 const r=decide(f.before,observe(f.input));assert.equal(r.decision,'host_rollback_refused');assert(r.blockers.some(b=>/missing/.test(b)));
});

for(const [name,mutate,expected] of [
 ['Session deletion',f=>fs.rmSync(path.join(f.home,'sessions/w/s1/session.v4.jsonl.zstd')),'needs_replay'],
 ['record deletion',f=>fs.rmSync(path.join(f.home,'storages/character_long_tasks/runs/r1.json')),'needs_replay'],
 ['domain deletion',f=>fs.rmSync(path.join(f.home,'storages/character_long_tasks'),{recursive:true}),'needs_replay'],
 ['Schedule deletion',f=>fs.rmSync(path.join(f.home,'storages/schedule.json')),'refused'],
 ['corrupt unit',f=>f.write('storages/schedule.json','{bad'),'refused'],
 ['corrupt record',f=>f.write('storages/character_long_tasks/runs/r1.json','{bad'),'refused'],
 ['corrupt Session',f=>fs.writeFileSync(path.join(f.home,'sessions/w/s1/session.v4.jsonl.zstd'),'bad'),'refused'],
 ['corrupt SQLite',f=>fs.writeFileSync(f.state,'bad'),'refused'],
 ['missing Session root',f=>fs.rmSync(path.join(f.home,'sessions'),{recursive:true}),'refused'],
 ['missing storage root',f=>fs.rmSync(path.join(f.home,'storages'),{recursive:true}),'refused'],
 ['omitted SQLite argument',f=>f.input.sqlites=[],'refused'],
 ['wrong Home',f=>f.input.home=path.dirname(f.home),'refused'],
])test(name,t=>{const f=fixture(t);f.db.close();f.before=observe(f.input);mutate(f);assert.equal(decide(f.before,observe(f.input)).decision,'host_rollback_'+expected);});
for(const action of ['omit','delete','corrupt','modify','add'])test('state files: '+action,t=>{const f=fixture(t);f.db.close();f.write('prefs.json',{a:1});f.input.files=[path.join(f.home,'prefs.json')];f.before=observe(f.input);
 if(action==='omit')f.input.files=[];if(action==='delete')fs.rmSync(f.input.files[0]);if(action==='corrupt')f.write('prefs.json','bad');if(action==='modify')f.write('prefs.json',{a:2});if(action==='add'){f.write('extra.json',{});f.input.files.push(path.join(f.home,'extra.json'));}
 assert.equal(decide(f.before,observe(f.input)).decision,'host_rollback_'+(action==='modify'?'needs_replay':'refused'));
});
test('WAL without SHM refuses',t=>{const f=fixture(t);f.db.close();f.before=observe(f.input);fs.writeFileSync(f.state+'-wal','invalid');assert.equal(decide(f.before,observe(f.input)).decision,'host_rollback_refused');});
test('invalid snapshot fails closed',()=>{assert.equal(decide({},{}).decision,'host_rollback_refused');});

test('damaged WAL frame/checksum refuses even with SHM present',t=>{const f=fixture(t);try{const wal=fs.readFileSync(f.state+'-wal');wal[wal.length-1]^=1;fs.writeFileSync(f.state+'-wal',wal);assert.equal(decide(f.before,observe(f.input)).decision,'host_rollback_refused');}finally{f.db.close();}});
test('corrupt historical Session frame tail refuses',t=>{const f=fixture(t);f.db.close();fs.appendFileSync(path.join(f.home,'sessions/w/s1/session.v4.jsonl.zstd'),'tail');assert.equal(decide(f.before,observe(f.input)).decision,'host_rollback_refused');});

for(const mutation of ['unchanged','change','delete','add','corrupt','invalid'])test('legacy task-memory vault: '+mutation,t=>{const f=fixture(t);f.db.close();const vault={taskId:'fixture',title:'fixture',updatedAt:1,entries:[]};f.write('storages/task-memory/fixture.json',vault);f.before=observe(f.input);
 if(mutation==='change')f.write('storages/task-memory/fixture.json',{...vault,updatedAt:2});if(mutation==='delete')fs.rmSync(path.join(f.home,'storages/task-memory/fixture.json'));if(mutation==='add')f.write('storages/task-memory/another.json',{...vault,taskId:'another'});if(mutation==='corrupt')f.write('storages/task-memory/fixture.json','{bad');if(mutation==='invalid')f.write('storages/task-memory/fixture.json',{});
 assert.equal(decide(f.before,observe(f.input)).decision,'host_rollback_'+(mutation==='unchanged'?'allowed':'refused'));
});
