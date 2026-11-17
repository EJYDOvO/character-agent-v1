// Derived index for index-time document expansion (arm F1): statement tokens plus model-written
// aliases, in a sidecar FTS5 table. Like the vector index it is rebuildable, bound to
// (memoryId, revision, contentHash, expansionModelVersion), and only consulted for rows the Core
// returns for the trusted handle. An entry with a stale binding contributes nothing.
import {DatabaseSync} from 'node:sqlite';
import {relevance} from '../../../../packages/character-memory-core/store.mjs';
import {matchExpr,tokens} from './fts.mjs';
import {expansionTerms} from './terms.mjs';

export class AliasIndex{
 #db;
 constructor(file=':memory:'){
  this.#db=new DatabaseSync(file);
  this.#db.exec(`PRAGMA journal_mode=WAL;
   CREATE VIRTUAL TABLE IF NOT EXISTS alias_fts USING fts5(id UNINDEXED,tokens);
   CREATE TABLE IF NOT EXISTS alias_meta(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,content_hash TEXT NOT NULL,model_version TEXT NOT NULL)`);
 }
 upsert({memoryId,revision,contentHash,modelVersion,statement,aliases}){
  const base=tokens(statement),all=[...base,...expansionTerms(base,aliases,{cap:Infinity})];
  this.#db.exec('BEGIN IMMEDIATE');
  try{
   this.#db.prepare('DELETE FROM alias_fts WHERE id=?').run(memoryId);
   this.#db.prepare('INSERT INTO alias_fts(id,tokens) VALUES(?,?)').run(memoryId,all.join(' '));
   this.#db.prepare('INSERT INTO alias_meta VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,content_hash=excluded.content_hash,model_version=excluded.model_version').run(memoryId,revision,contentHash,modelVersion);
   this.#db.exec('COMMIT');
  }catch(error){this.#db.exec('ROLLBACK');throw error;}
 }
 remove(memoryId){this.#db.prepare('DELETE FROM alias_fts WHERE id=?').run(memoryId);this.#db.prepare('DELETE FROM alias_meta WHERE id=?').run(memoryId);}
 count(){return this.#db.prepare('SELECT count(*) n FROM alias_meta').get().n;}
 rank(terms,rows,query,modelVersion){
  if(!terms.length)return {ranked:[],stale:0};
  const meta=new Map(this.#db.prepare('SELECT id,revision,content_hash,model_version FROM alias_meta').all().map(m=>[m.id,m])),ranked=[];let stale=0;
  for(const r of this.#db.prepare('SELECT id,bm25(alias_fts) rank FROM alias_fts WHERE alias_fts MATCH ?').all(matchExpr(terms))){
   const row=rows.get(r.id);if(!row)continue;const m=meta.get(r.id);
   if(!m||m.revision!==row.revision||m.content_hash!==row.fingerprint||m.model_version!==modelVersion){stale++;continue;}
   ranked.push({id:r.id,score:relevance({...row,rank:r.rank},query)});
  }
  ranked.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));return {ranked,stale};
 }
 close(){this.#db.close();}
}
