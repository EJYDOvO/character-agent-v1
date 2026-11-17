// Derived, rebuildable vector index in a *sidecar* SQLite file. The Memory Core database and schema are
// never touched. Every entry is bound to (memoryId, revision, contentHash, embeddingModelVersion);
// an entry whose binding does not match the row the Core returns for the trusted handle is ignored,
// so a stale or orphaned vector can neither rank nor resurrect anything. Search is an exact scan over
// the valid set of the handle only (ACL first, similarity second): no ANN, no cross-scope neighbours.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

// Identical to memories.fingerprint (sha256 of the NFKC-normalised, trimmed statement).
export const contentHash=text=>createHash('sha256').update(text.normalize('NFKC').trim()).digest('hex');

export class VectorIndex{
 #db;#cache=new Map();
 constructor(file=':memory:'){
  this.#db=new DatabaseSync(file);
  this.#db.exec(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS vectors(memory_id TEXT NOT NULL,model_version TEXT NOT NULL,revision INTEGER NOT NULL,
    content_hash TEXT NOT NULL,dim INTEGER NOT NULL,vec BLOB NOT NULL,PRIMARY KEY(memory_id,model_version))`);
 }
 #model(modelVersion){
  let m=this.#cache.get(modelVersion);
  if(!m){
   m=new Map();
   for(const r of this.#db.prepare('SELECT memory_id,revision,content_hash,vec FROM vectors WHERE model_version=?').all(modelVersion))
    m.set(r.memory_id,{revision:r.revision,contentHash:r.content_hash,vec:new Float32Array(r.vec.buffer.slice(r.vec.byteOffset,r.vec.byteOffset+r.vec.byteLength))});
   this.#cache.set(modelVersion,m);
  }
  return m;
 }
 upsert({memoryId,revision,contentHash:hash,modelVersion,vector}){
  this.#db.prepare('INSERT INTO vectors VALUES(?,?,?,?,?,?) ON CONFLICT(memory_id,model_version) DO UPDATE SET revision=excluded.revision,content_hash=excluded.content_hash,dim=excluded.dim,vec=excluded.vec')
   .run(memoryId,modelVersion,revision,hash,vector.length,Buffer.from(vector.buffer,vector.byteOffset,vector.byteLength));
  this.#model(modelVersion).set(memoryId,{revision,contentHash:hash,vec:vector});
 }
 remove(memoryId){this.#db.prepare('DELETE FROM vectors WHERE memory_id=?').run(memoryId);for(const m of this.#cache.values())m.delete(memoryId);}
 has(memoryId,modelVersion){return this.#model(modelVersion).has(memoryId);}
 count(modelVersion){return this.#db.prepare('SELECT count(*) n FROM vectors WHERE model_version=?').get(modelVersion).n;}
 dropCache(){this.#cache.clear();}
 // rows: Map id -> authoritative row ({revision, fingerprint}) from the gate. Returns ranked {id, score}.
 search(queryVector,rows,modelVersion,{topN=Infinity}={}){
  const model=this.#model(modelVersion),out=[],pending=[];let missing=0,stale=0;
  for(const [id,row]of rows){
   const e=model.get(id);if(!e){missing++;pending.push(id);continue;}
   if(e.revision!==row.revision||e.contentHash!==row.fingerprint||e.vec.length!==queryVector.length){stale++;pending.push(id);continue;}
   let s=0;const v=e.vec;for(let i=0;i<v.length;i++)s+=v[i]*queryVector[i];
   out.push({id,score:s});
  }
  out.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  return {ranked:topN<out.length?out.slice(0,topN):out,missing,stale,scanned:out.length,pending};
 }
 // Ids of a handle whose vector is absent or bound to another revision/content: to (re-)embed, never served.
 pending(rows,modelVersion){
  const model=this.#model(modelVersion),todo=[];
  for(const [id,row]of rows){const e=model.get(id);if(!e||e.revision!==row.revision||e.contentHash!==row.fingerprint)todo.push(id);}
  return todo;
 }
 close(){this.#db.close();}
}
