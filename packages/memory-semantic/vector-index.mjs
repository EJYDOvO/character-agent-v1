// Derived, rebuildable vector index in a sidecar SQLite file next to (never inside) the Memory Core
// database. It holds no statement, scope or source: only (memoryId, modelVersion) -> revision,
// contentHash, vector. It decides nothing: search() scores only the ids Core passes in for one
// trusted handle, and only entries whose contentHash equals the row Core currently holds.
// Deleting the file loses nothing; the indexer rebuilds it.
//
// A vector is a lossy copy of a statement, so removal is treated like removal of the text:
// secure_delete overwrites freed pages, and scrub() truncates the write-ahead log so a removed
// vector does not linger in the -wal file. Backups of this file are never needed; if a backup of the
// data directory includes it, restoring an old copy cannot bring a forgotten record back (Core
// decides what is valid), and the next orphan sweep deletes whatever no longer matches live content.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';

const SCHEMA=`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000;PRAGMA secure_delete=ON;
 CREATE TABLE IF NOT EXISTS vectors(memory_id TEXT NOT NULL,model_version TEXT NOT NULL,revision INTEGER NOT NULL,content_hash TEXT NOT NULL,dim INTEGER NOT NULL,vec BLOB NOT NULL,PRIMARY KEY(memory_id,model_version));
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`;

export class VectorIndex{
 #db;#model;#vectors=new Map();#rebind=new Map();#dirty=false;
 constructor(file,modelVersion,dim){
  if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});
  this.#model=modelVersion;this.dim=dim;this.recreated=false;
  try{this.#open(file);}
  catch(error){
   // A damaged sidecar holds nothing that cannot be recomputed: discard it and start empty rather than
   // leave semantic recall broken. Anything else (permissions, locked file) is reported to the caller.
   if(file===':memory:'||!/malformed|not a database|corrupt/i.test(String(error?.message)))throw error;
   try{this.#db?.close();}catch{}
   for(const suffix of ['','-wal','-shm'])rmSync(file+suffix,{force:true});
   this.#vectors.clear();this.#open(file);this.recreated=true;
  }
 }
 #open(file){
  this.#db=new DatabaseSync(file);this.#db.exec(SCHEMA);
  if(this.#db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('database disk image is malformed');
  // Vectors of another model version are never comparable with this one: drop them.
  if(this.#db.prepare('DELETE FROM vectors WHERE model_version!=? OR dim!=?').run(this.#model,this.dim).changes)this.#dirty=true;
  for(const r of this.#db.prepare('SELECT memory_id,revision,content_hash,vec FROM vectors WHERE model_version=?').all(this.#model)){
   if(r.vec.byteLength!==this.dim*4)continue;
   this.#vectors.set(r.memory_id,{revision:r.revision,contentHash:r.content_hash,vec:new Float32Array(r.vec.buffer.slice(r.vec.byteOffset,r.vec.byteOffset+r.vec.byteLength))});
  }
  this.scrub();
 }
 get size(){return this.#vectors.size;}
 upsert(memoryId,revision,contentHash,vector){
  if(!(vector instanceof Float32Array)||vector.length!==this.dim)throw Error('Vector dimension mismatch');
  this.#db.prepare('INSERT INTO vectors VALUES(?,?,?,?,?,?) ON CONFLICT(memory_id,model_version) DO UPDATE SET revision=excluded.revision,content_hash=excluded.content_hash,dim=excluded.dim,vec=excluded.vec')
   .run(memoryId,this.#model,revision,contentHash,this.dim,Buffer.from(vector.buffer,vector.byteOffset,vector.byteLength));
  this.#vectors.set(memoryId,{revision,contentHash,vec:vector});this.#rebind.delete(memoryId);
 }
 // The in-memory entry goes first: even if the file write fails the vector can no longer rank anything
 // in this process, and the caller learns about the failure.
 remove(memoryId){
  this.#vectors.delete(memoryId);this.#rebind.delete(memoryId);
  if(this.#db.prepare('DELETE FROM vectors WHERE memory_id=?').run(memoryId).changes)this.#dirty=true;
 }
 // Make removals durable outside the main file too: fold the WAL back and truncate it.
 scrub(){if(!this.#dirty)return false;this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');this.#dirty=false;return true;}
 entries(){return [...this.#vectors].map(([id,e])=>({id,revision:e.revision,contentHash:e.contentHash}));}
 // true when the entry describes exactly this content. A revision that changed without a content change
 // (confirm, restore) keeps the same vector by construction: it is re-bound, not re-embedded.
 current(key){
  const e=this.#vectors.get(key.id);if(!e||e.contentHash!==key.fingerprint)return false;
  if(e.revision!==key.revision){e.revision=key.revision;this.#rebind.set(key.id,key.revision);}
  return true;
 }
 flushRebinds(){
  if(!this.#rebind.size)return 0;const n=this.#rebind.size,update=this.#db.prepare('UPDATE vectors SET revision=? WHERE memory_id=? AND model_version=?');
  for(const [id,revision]of this.#rebind)update.run(revision,id,this.#model);this.#rebind.clear();return n;
 }
 // keys: [{id, revision, fingerprint}] from Core for one trusted handle. Exact scan, no ANN.
 search(queryVector,keys,{minScore=-1,topK=50}={}){
  const hits=[],pending=[];
  for(const key of keys){
   if(!this.current(key)){pending.push(key.id);continue;}
   const v=this.#vectors.get(key.id).vec;let s=0;for(let i=0;i<v.length;i++)s+=v[i]*queryVector[i];
   if(s>=minScore)hits.push({id:key.id,score:s});
  }
  hits.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  return {ids:hits.slice(0,topK).map(h=>h.id),top:hits[0]?.score??null,pending,scanned:keys.length-pending.length};
 }
 meta(key,value){
  if(value===undefined){const r=this.#db.prepare('SELECT value FROM meta WHERE key=?').get(key);return r?JSON.parse(r.value):undefined;}
  this.#db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 }
 close(){try{this.flushRebinds();}catch{}try{this.#dirty=true;this.scrub();}catch{}this.#db.close();}
}
