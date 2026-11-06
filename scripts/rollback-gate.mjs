// Offline, read-only rollback gate for a DSH Host switch (0.2.1 <-> 0.2.2).
// Run with the Host stopped (maintenance lock). Never writes the inspected data.
//
//   record: node scripts/rollback-gate.mjs record --home <DSH_HOME> [--sqlite <db>]... [--file <json>]... --out <manifest.json>
//   check:  node scripts/rollback-gate.mjs check  --home <DSH_HOME> [--sqlite <db>]... [--file <json>]... --manifest <manifest.json>
//
// `record` belongs to the consistent pre-switch snapshot. `check` compares the
// current data with it and decides whether swapping back to the previous Host
// and packages (data left in place) is admissible:
//   host_rollback_allowed      exit 0  nothing changed since the snapshot
//   host_rollback_needs_replay exit 2  formats unchanged, but the new Host wrote data the old Host
//                                      has not read: load a copy in an isolated old Host first
//   host_rollback_refused      exit 3  a storage unit/session format or SQLite schema advanced, or work
//                                      is in flight; only a full snapshot restore remains, which loses
//                                      the listed changes and needs an explicit maintainer decision
// A Schedule file hash alone is not the gate: other units, Session formats,
// SQLite content (including WAL frames), Outbox and the Long Task ledger count.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {pathToFileURL} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const walk=(dir,base=dir,out=[])=>{if(!fs.existsSync(dir))return out;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,base,out);else out.push(path.relative(base,p).split(path.sep).join('/'));}return out;};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const value=v=>v instanceof Uint8Array?'x'+Buffer.from(v).toString('hex'):typeof v==='bigint'?v.toString():v;
// DSH storages: single-file units carry {unit:{name,version}}; per-record domains carry {version,record} per file.
function storages(home){
 const root=path.join(home,'storages'),units={},records={};
 if(!fs.existsSync(root))return {units,records};
 for(const e of fs.readdirSync(root,{withFileTypes:true})){
  const p=path.join(root,e.name);
  if(e.isFile()&&e.name.endsWith('.json')){const raw=fs.readFileSync(p),doc=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));units[doc.unit?.name??e.name]={version:doc.unit?.version??null,sha256:sha(raw)};}
  else if(e.isDirectory()&&e.name!=='session_projcache'){const files={},versions=new Set();for(const rel of walk(p)){if(!rel.endsWith('.json'))continue;const raw=fs.readFileSync(path.join(p,rel));let doc;try{doc=JSON.parse(raw.toString('utf8'));}catch{doc={};}versions.add(doc.version??null);files[rel]={sha256:sha(raw),status:doc.record?.status??null};}records[e.name]={versions:[...versions].sort(),files};}
 }
 return {units,records};
}
// Session logs: the file name carries the format version (session.v4.jsonl.zstd).
function sessions(home){const out={};for(const rel of walk(path.join(home,'sessions'))){const m=/\.v(\d+)\./.exec(path.basename(rel));out[rel]={format:m?Number(m[1]):null,sha256:sha(fs.readFileSync(path.join(home,'sessions',rel)))};}return out;}
// Logical SQLite content through a read-only connection, so committed WAL frames count.
function sqlite(file){
 const wal=file+'-wal',shm=file+'-shm',walBytes=fs.existsSync(wal)?fs.statSync(wal).size:0;
 if(!fs.existsSync(file))return {missing:true};
 if(walBytes>0&&!fs.existsSync(shm))return {walBytes,unreadable:'WAL without shared-memory file'};
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const schema=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables={};
  for(const t of schema.filter(s=>s.type==='table'&&!/^CREATE VIRTUAL/i.test(s.sql??''))){
   const rows=db.prepare(`SELECT * FROM "${t.name.replaceAll('"','""')}"`).all().map(r=>JSON.stringify(Object.entries(r).map(([k,v])=>[k,value(v)]))).sort();
   tables[t.name]={count:rows.length,sha256:sha(rows.join('\n'))};
  }
  const outbox=tables.outbox?Object.fromEntries(db.prepare('SELECT status,count(*) n FROM outbox GROUP BY status').all().map(r=>[r.status,Number(r.n)])):undefined;
  return {walBytes,userVersion:Number(db.prepare('PRAGMA user_version').get().user_version),schemaSha256:sha(JSON.stringify(schema)),tables,...outbox?{outbox}:{}};
 }finally{db.close();}
}
export function observe({home,sqlites=[],files=[]}){
 return {home:path.resolve(home),storages:storages(home),sessions:sessions(home),
  sqlite:Object.fromEntries(sqlites.map(f=>[path.resolve(f),sqlite(path.resolve(f))])),
  files:Object.fromEntries(files.map(f=>[path.resolve(f),fs.existsSync(f)?sha(fs.readFileSync(f)):null]))};
}
const IN_FLIGHT_RUNS=new Set(['running']);// Long Task occurrence ledger: started, outcome not recorded
export function decide(before,now){
 const blockers=[],changes=[];
 for(const [name,u] of Object.entries(now.storages.units)){const b=before.storages.units[name];
  if(!b){blockers.push(`storage unit ${name} created by the new Host (version ${u.version})`);continue;}
  if(u.version!==b.version)blockers.push(`storage unit ${name} version ${b.version} -> ${u.version}`);else if(u.sha256!==b.sha256)changes.push(`storage unit ${name} rewritten`);}
 for(const name of Object.keys(before.storages.units))if(!now.storages.units[name])blockers.push(`storage unit ${name} missing`);
 for(const [name,d] of Object.entries(now.storages.records)){const b=before.storages.records[name]??{versions:[],files:{}};
  const added=d.versions.filter(v=>!b.versions.includes(v));if(b.versions.length&&added.length)blockers.push(`storage domain ${name} record version ${added.join(',')} not in snapshot`);
  const changed=Object.entries(d.files).filter(([rel,f])=>b.files[rel]?.sha256!==f.sha256).length,removed=Object.keys(b.files).filter(rel=>!d.files[rel]).length;
  if(changed||removed)changes.push(`storage domain ${name}: ${changed} records added/changed, ${removed} removed`);
  const running=Object.values(d.files).filter(f=>IN_FLIGHT_RUNS.has(f.status)).length;if(running)blockers.push(`storage domain ${name}: ${running} records in flight`);}
 const formats=new Set(Object.values(before.sessions).map(s=>s.format));
 const newer=Object.entries(now.sessions).filter(([,s])=>formats.size&&!formats.has(s.format));if(newer.length)blockers.push(`${newer.length} Session logs use format ${[...new Set(newer.map(([,s])=>s.format))].join(',')} not present in the snapshot`);
 const sessionChanges=Object.entries(now.sessions).filter(([rel,s])=>before.sessions[rel]?.sha256!==s.sha256).length;if(sessionChanges)changes.push(`${sessionChanges} Session logs added/changed`);
 for(const [file,s] of Object.entries(now.sqlite)){const b=before.sqlite[file];
  if(!b){blockers.push(`SQLite ${file} not in snapshot`);continue;}
  if(s.missing||s.unreadable){blockers.push(`SQLite ${file} ${s.missing?'missing':s.unreadable}`);continue;}
  if(s.schemaSha256!==b.schemaSha256||s.userVersion!==b.userVersion)blockers.push(`SQLite ${file} schema/user_version changed`);
  for(const [t,v] of Object.entries(s.tables))if(b.tables?.[t]?.sha256!==v.sha256)changes.push(`SQLite ${path.basename(file)}.${t}: ${b.tables?.[t]?.count??0} -> ${v.count} rows (content changed)`);
  if(s.outbox?.sending)blockers.push(`Outbox ${file}: ${s.outbox.sending} rows sending`);
  if(s.walBytes>0)changes.push(`SQLite ${path.basename(file)} has ${s.walBytes} WAL bytes: copy or restore it only together with -wal/-shm`);}
 for(const file of Object.keys(before.sqlite))if(!now.sqlite[file])blockers.push(`SQLite ${file} not inspected`);
 for(const [file,h] of Object.entries(now.files))if(before.files[file]!==h)changes.push(`${file} changed`);
 const decision=blockers.length?'host_rollback_refused':changes.filter(c=>!/WAL bytes/.test(c)).length?'host_rollback_needs_replay':'host_rollback_allowed';
 return {readOnly:true,decision,blockers,changes,
  restore:blockers.length?'Only a full restore of the pre-switch snapshot remains; it discards every change listed here and needs an explicit maintainer decision.':undefined};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [mode,...rest]=process.argv.slice(2),all=n=>rest.flatMap((a,i)=>a==='--'+n&&rest[i+1]?[rest[i+1]]:[]),one=n=>{const v=all(n);if(v.length!==1)throw Error('Required --'+n);return v[0];};
 const input={home:one('home'),sqlites:all('sqlite'),files:all('file')};
 if(mode==='record'){const out=one('out');if(fs.existsSync(out))throw Error('Manifest exists; never overwrite a snapshot manifest');fs.writeFileSync(out,JSON.stringify({recordedAt:new Date().toISOString(),...observe(input)},null,1),{flag:'wx'});console.log(JSON.stringify({recorded:path.resolve(out)}));}
 else if(mode==='check'){const result=decide(json(one('manifest')),observe(input));console.log(JSON.stringify(result,null,2));process.exitCode={host_rollback_allowed:0,host_rollback_needs_replay:2,host_rollback_refused:3}[result.decision];}
 else throw Error('Mode must be record or check');
}
