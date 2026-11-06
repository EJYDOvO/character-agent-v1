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
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {zstdDecompressSync} from 'node:zlib';import {pathToFileURL} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const walk=(dir,base=dir,out=[])=>{if(!fs.existsSync(dir))throw Error('Missing monitored directory: '+dir);for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Monitored symlink: '+p);if(e.isDirectory())walk(p,base,out);else out.push(path.relative(base,p).split(path.sep).join('/'));}return out;};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const value=v=>v instanceof Uint8Array?'x'+Buffer.from(v).toString('hex'):typeof v==='bigint'?v.toString():v;
// DSH storages: single-file units carry {unit:{name,version}}; per-record domains carry {version,record} per file.
function storages(home){
 const root=path.join(home,'storages'),units={},records={};
 if(!fs.existsSync(root))throw Error('Missing storages directory');
 for(const e of fs.readdirSync(root,{withFileTypes:true})){
  const p=path.join(root,e.name);if(e.isSymbolicLink())throw Error('Monitored symlink: '+p);
  if(e.isFile()&&e.name.endsWith('.json')){const raw=fs.readFileSync(p),doc=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));if(!doc.unit?.name||!Number.isInteger(doc.unit.version))throw Error('Invalid storage unit '+p);if(units[doc.unit.name])throw Error('Duplicate storage unit');units[doc.unit.name]={version:doc.unit.version,path:e.name,sha256:sha(raw)};}
  else if(e.isDirectory()&&e.name!=='session_projcache'){const files={},versions=new Set();for(const rel of walk(p)){if(!rel.endsWith('.json'))throw Error('Unknown storage record '+rel);const raw=fs.readFileSync(path.join(p,rel));const doc=JSON.parse(raw.toString('utf8'));if(!Number.isInteger(doc.version)||!doc.record||typeof doc.record!=='object')throw Error('Invalid storage record '+rel);versions.add(doc.version??null);files[rel]={sha256:sha(raw),status:doc.record?.status??null};}records[e.name]={versions:[...versions].sort(),files};}
 }
 return {units,records};
}
function validateSession(raw,format){
 let offset=0,first=true;
 while(offset<raw.length){const start=offset;if(raw.readUInt32LE(offset)!==0xfd2fb528)throw Error('Invalid Session frame');offset+=4;const d=raw[offset++];if(d&24)throw Error('Invalid zstd header');const single=!!(d&32),flag=d>>>6,dict=d&3;offset+=(single?0:1)+(dict===3?4:dict)+(flag===0?(single?1:0):1<<flag);
 for(;;){const h=raw.readUIntLE(offset,3);offset+=3;const type=(h>>>1)&3;if(type===3)throw Error('Invalid zstd block');offset+=type===1?1:h>>>3;if(h&1)break;}
 if(d&4)offset+=4;if(offset>raw.length)throw Error('Truncated Session');const lines=zstdDecompressSync(raw.subarray(start,offset)).toString('utf8').trim().split('\n');for(const line of lines){const row=JSON.parse(line);if(first){if(row.type!=='session'||row.version!==format)throw Error('Session header mismatch');first=false;}}
 }if(first)throw Error('Empty Session');
}
// Session logs: the file name carries the format version (session.v4.jsonl.zstd).
function sessions(home){const out={};for(const rel of walk(path.join(home,'sessions'))){const m=/\.v(\d+)\./.exec(path.basename(rel));const raw=fs.readFileSync(path.join(home,'sessions',rel));if(!m||!rel.endsWith('.jsonl.zstd'))throw Error('Unknown Session format '+rel);validateSession(raw,Number(m[1]));out[rel]={format:Number(m[1]),sha256:sha(raw)};}return out;}
function validateWal(raw){
 if(raw.length<32)throw Error('Truncated WAL');const magic=raw.readUInt32BE(0);if(![0x377f0682,0x377f0683].includes(magic)||raw.readUInt32BE(4)!==3007000)throw Error('Invalid WAL header');
 const size=raw.readUInt32BE(8);if(size<512||size>65536||(size&(size-1))||((raw.length-32)%(24+size)))throw Error('Invalid WAL size');
 let a=0,b=0;const word=(buf,i)=>magic===0x377f0682?buf.readUInt32LE(i):buf.readUInt32BE(i),sum=buf=>{for(let i=0;i<buf.length;i+=8){a=(a+word(buf,i)+b)>>>0;b=(b+word(buf,i+4)+a)>>>0;}};
 sum(raw.subarray(0,24));if(a!==raw.readUInt32BE(24)||b!==raw.readUInt32BE(28))throw Error('WAL header checksum');
 for(let i=32;i<raw.length;i+=24+size){if(!raw.readUInt32BE(i)||!raw.subarray(i+8,i+16).equals(raw.subarray(16,24)))throw Error('WAL frame salt/page');sum(raw.subarray(i,i+8));sum(raw.subarray(i+24,i+24+size));if(a!==raw.readUInt32BE(i+16)||b!==raw.readUInt32BE(i+20))throw Error('WAL frame checksum');}
 if(raw.length>32&&!raw.readUInt32BE(raw.length-size-20))throw Error('Uncommitted WAL tail');
}
// Logical SQLite content through a read-only connection, so committed WAL frames count.
function sqlite(file){
 const wal=file+'-wal',shm=file+'-shm',walBytes=fs.existsSync(wal)?fs.statSync(wal).size:0;
 if(!fs.existsSync(file))return {missing:true};
 if(walBytes>0&&!fs.existsSync(shm))return {walBytes,unreadable:'WAL without shared-memory file'};
 if(walBytes)validateWal(fs.readFileSync(wal));
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('SQLite quick_check failed');
  const schema=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables={};
  for(const t of schema.filter(s=>s.type==='table'&&!/^CREATE VIRTUAL/i.test(s.sql??''))){
   const rows=db.prepare(`SELECT * FROM "${t.name.replaceAll('"','""')}"`).all().map(r=>JSON.stringify(Object.entries(r).map(([k,v])=>[k,value(v)]))).sort();
   tables[t.name]={count:rows.length,sha256:sha(rows.join('\n'))};
  }
  const outbox=tables.outbox?Object.fromEntries(db.prepare('SELECT status,count(*) n FROM outbox GROUP BY status').all().map(r=>[r.status,Number(r.n)])):undefined;
  return {walBytes,walSha256:walBytes?sha(fs.readFileSync(wal)):null,userVersion:Number(db.prepare('PRAGMA user_version').get().user_version),schemaSha256:sha(JSON.stringify(schema)),tables,...outbox?{outbox}:{}};
 }finally{db.close();}
}
export function observe({home,sqlites=[],files=[]}){
 const errors=[],capture=(label,fn)=>{try{return fn();}catch(e){errors.push(label+': '+e.message);return null;}};
 return {formatVersion:2,home:path.resolve(home),realHome:capture('home',()=>fs.realpathSync(home)),errors,storages:capture('storages',()=>storages(home)),sessions:capture('sessions',()=>sessions(home)),
 sqlite:Object.fromEntries(sqlites.map(f=>[path.resolve(f),capture(f,()=>sqlite(path.resolve(f)))])),
 files:Object.fromEntries(files.map(f=>[path.resolve(f),capture(f,()=>{const raw=fs.readFileSync(f);JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));return sha(raw);})]))};
}
const IN_FLIGHT_RUNS=new Set(['running']);// Long Task occurrence ledger: started, outcome not recorded
function decideState(before,now){
 const blockers=[],changes=[];
 const refused=reason=>({readOnly:true,decision:'host_rollback_refused',blockers:[reason],changes:[]});
 const valid=x=>x?.formatVersion===2&&typeof x.home==='string'&&Array.isArray(x.errors)&&x.storages?.units&&x.storages?.records&&x.sessions&&x.sqlite&&x.files;
 if(!valid(before)||!valid(now))return refused('Invalid or legacy manifest/observation; take a new consistent snapshot');
 if(before.errors.length||now.errors.length)return refused('Uncertain monitored state: '+[...before.errors,...now.errors].join('; '));
 if(!before.realHome||before.realHome!==now.realHome||before.home!==now.home)return refused('Home path mismatch');
 for(const key of ['sqlite','files'])if(JSON.stringify(Object.keys(before[key]).sort())!==JSON.stringify(Object.keys(now[key]).sort()))return refused('Monitored '+key+' paths differ from snapshot');
 for(const [file,h] of Object.entries(before.files))if(typeof h!=='string'||typeof now.files[file]!=='string')return refused('Missing/invalid monitored file '+file);
 for(const [file,v] of Object.entries(before.sqlite))if(!v||v.missing||v.unreadable||!now.sqlite[file])return refused('Missing/unreadable SQLite '+file);

 for(const [name,u] of Object.entries(now.storages.units)){const b=before.storages.units[name];if(!/^[a-f0-9]{64}$/.test(u.sha256)||!Number.isInteger(u.version))throw Error('Invalid unit observation');
  if(!b){blockers.push(`storage unit ${name} created by the new Host (version ${u.version})`);continue;}
  if(u.path!==b.path)changes.push('storage unit '+name+' path changed');if(u.version!==b.version)blockers.push(`storage unit ${name} version ${b.version} -> ${u.version}`);else if(u.sha256!==b.sha256)changes.push(`storage unit ${name} rewritten`);}
 for(const name of Object.keys(before.storages.units))if(!now.storages.units[name])blockers.push(`storage unit ${name} missing`);
 for(const [name,d] of Object.entries(now.storages.records)){const b=before.storages.records[name]??{versions:[],files:{}};
  const added=d.versions.filter(v=>!b.versions.includes(v));if(b.versions.length&&added.length)blockers.push(`storage domain ${name} record version ${added.join(',')} not in snapshot`);
  const changed=Object.entries(d.files).filter(([rel,f])=>b.files[rel]?.sha256!==f.sha256).length,removed=Object.keys(b.files).filter(rel=>!d.files[rel]).length;
  if(changed||removed)changes.push(`storage domain ${name}: ${changed} records added/changed, ${removed} removed`);
  const running=Object.values(d.files).filter(f=>IN_FLIGHT_RUNS.has(f.status)).length;if(running)blockers.push(`storage domain ${name}: ${running} records in flight`);}
 for(const name of Object.keys(before.storages.records))if(!now.storages.records[name])changes.push('storage domain '+name+' removed');
 const formats=new Set(Object.values(before.sessions).map(s=>s.format));
 const newer=Object.entries(now.sessions).filter(([,s])=>formats.size&&!formats.has(s.format));if(newer.length)blockers.push(`${newer.length} Session logs use format ${[...new Set(newer.map(([,s])=>s.format))].join(',')} not present in the snapshot`);
 const sessionChanges=Object.entries(now.sessions).filter(([rel,s])=>before.sessions[rel]?.sha256!==s.sha256).length;const removedSessions=Object.keys(before.sessions).filter(rel=>!now.sessions[rel]).length;if(removedSessions)changes.push(removedSessions+' Session logs removed');if(sessionChanges)changes.push(`${sessionChanges} Session logs added/changed`);
 for(const [file,s] of Object.entries(now.sqlite)){const b=before.sqlite[file];
  if(!b){blockers.push(`SQLite ${file} not in snapshot`);continue;}
  if(s.missing||s.unreadable){blockers.push(`SQLite ${file} ${s.missing?'missing':s.unreadable}`);continue;}
  if(s.schemaSha256!==b.schemaSha256||s.userVersion!==b.userVersion)blockers.push(`SQLite ${file} schema/user_version changed`);
  for(const [t,v] of Object.entries(s.tables))if(b.tables?.[t]?.sha256!==v.sha256)changes.push(`SQLite ${path.basename(file)}.${t}: ${b.tables?.[t]?.count??0} -> ${v.count} rows (content changed)`);
  if(s.outbox?.sending)blockers.push(`Outbox ${file}: ${s.outbox.sending} rows sending`);
  if(s.walSha256!==b.walSha256)changes.push('SQLite '+file+' WAL changed');
  if(s.walBytes>0)changes.push(`SQLite ${path.basename(file)} has ${s.walBytes} WAL bytes: copy or restore it only together with -wal/-shm`);}
 for(const file of Object.keys(before.sqlite))if(!now.sqlite[file])blockers.push(`SQLite ${file} not inspected`);
 for(const [file,h] of Object.entries(now.files))if(before.files[file]!==h)changes.push(`${file} changed`);
 const decision=blockers.length?'host_rollback_refused':changes.filter(c=>!/WAL bytes/.test(c)).length?'host_rollback_needs_replay':'host_rollback_allowed';
 return {readOnly:true,decision,blockers,changes,
  restore:blockers.length?'Only a full restore of the pre-switch snapshot remains; it discards every change listed here and needs an explicit maintainer decision.':undefined};
}
export function decide(before,now){try{return decideState(before,now);}catch(error){return {readOnly:true,decision:'host_rollback_refused',blockers:['Invalid/uncertain state: '+error.message],changes:[]};}}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try {
 const [mode,...rest]=process.argv.slice(2),all=n=>rest.flatMap((a,i)=>a==='--'+n&&rest[i+1]?[rest[i+1]]:[]),one=n=>{const v=all(n);if(v.length!==1)throw Error('Required --'+n);return v[0];};
 const input={home:one('home'),sqlites:all('sqlite'),files:all('file')};
 if(mode==='record'){const out=one('out');if(fs.existsSync(out))throw Error('Manifest exists; never overwrite a snapshot manifest');fs.writeFileSync(out,JSON.stringify((()=>{const state=observe(input);const gate=decide(state,state);if(gate.decision!=='host_rollback_allowed')throw Error(JSON.stringify(gate));return {recordedAt:new Date().toISOString(),...state};})(),null,1),{flag:'wx'});console.log(JSON.stringify({recorded:path.resolve(out)}));}
 else if(mode==='check'){const result=decide(json(one('manifest')),observe(input));console.log(JSON.stringify(result,null,2));process.exitCode={host_rollback_allowed:0,host_rollback_needs_replay:2,host_rollback_refused:3}[result.decision];}
 else throw Error('Mode must be record or check');
 }catch(error){console.log(JSON.stringify({readOnly:true,decision:'host_rollback_refused',blockers:[error.message],changes:[]}));process.exitCode=3;}
}
