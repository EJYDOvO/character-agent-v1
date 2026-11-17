// Shared experiment environment: synthetic store, authoritative valid sets, derived indexes.
import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {buildFixture} from '../fixture.mjs';
import {visibleSet} from './gate.mjs';
import {tokens} from './fts.mjs';
import {segmentedTokens,expansionTerms} from './terms.mjs';
import {VectorIndex,contentHash} from './vector-index.mjs';
import {EmbeddingCache} from './embed-cache.mjs';
import {loadExpansions} from '../expand/generate.mjs';
import {scopes} from '../../dataset/corpus.mjs';

export const sha=text=>createHash('sha256').update(text).digest('hex');
export const DENSE_MODELS=[['qwen3-0.6b','fp32'],['bge-m3','fp32'],['embeddinggemma','fp32'],['me5-small','fp32'],['qwen3-0.6b','q8'],['bge-m3','q8'],['embeddinggemma','q8'],['me5-small','q8']];
export const denseKey=(name,dtype)=>dtype==='fp32'?name:`${name}-${dtype}`;

export function buildShadow(db,table,rows,tokenize){
 db.exec(`DROP TABLE IF EXISTS ${table};CREATE VIRTUAL TABLE ${table} USING fts5(id UNINDEXED,tokens)`);
 const insert=db.prepare(`INSERT INTO ${table}(id,tokens) VALUES(?,?)`);
 db.exec('BEGIN');for(const row of rows)insert.run(row.id,tokenize(row).join(' '));db.exec('COMMIT');
}

export async function setup({noise=300,models=DENSE_MODELS,llm='qwen2.5:7b',dense=true}={}){
 const fx=await buildFixture({noise}),ctx={},visible={};
 for(const key of Object.keys(scopes)){ctx[key]=fx.ctx(key);visible[key]=visibleSet(fx.store,ctx[key]);}
 // Everything the production FTS index currently holds (all scopes), for the shadow FTS variants.
 const indexed=fx.store.db.prepare('SELECT m.id,m.statement FROM memory_fts f JOIN memories m ON m.id=f.id').all();
 const derived=new DatabaseSync(path.join(fx.dir,'derived.sqlite'));
 buildShadow(derived,'fts_seg',indexed,row=>segmentedTokens(row.statement));
 let docExpansion=null,queryExpansion=null;
 try{queryExpansion=loadExpansions('query',llm);}catch{}
 try{docExpansion=loadExpansions('doc',llm);}catch{}
 const aliasesOf=statement=>docExpansion?.items[sha(statement)]?.aliases;
 if(docExpansion){
  const missing=indexed.filter(r=>!aliasesOf(r.statement));
  if(missing.length){console.warn(`WARNING: doc expansion missing for ${missing.length} records; F1/F2 arms are skipped`);docExpansion=null;}
 }
 if(docExpansion){
  buildShadow(derived,'fts_docexp',indexed,row=>{const base=tokens(row.statement);return [...base,...expansionTerms(base,aliasesOf(row.statement),{cap:Infinity})];});
 }
 const index=new VectorIndex(path.join(fx.dir,'vectors.sqlite')),embedders={};
 if(dense)for(const [name,dtype]of models){
  const cache=new EmbeddingCache(name,dtype);let ready=true;
  for(const rows of Object.values(visible))for(const row of rows.values()){
   assert.equal(contentHash(row.statement),row.fingerprint,'contentHash must equal the Core fingerprint');
   if(!cache.has('doc',row.statement)){ready=false;break;}
   index.upsert({memoryId:row.id,revision:row.revision,contentHash:row.fingerprint,modelVersion:cache.modelVersion,vector:cache.get('doc',row.statement)});
  }
  if(ready)embedders[denseKey(name,dtype)]={name,dtype,cache,modelVersion:cache.modelVersion};
 }
 const label=id=>fx.labels.get(id)??id;
 return {fx,ctx,visible,derived,index,embedders,queryExpansion,docExpansion,label,db:fx.store.db,
  close(){try{derived.close();}catch{}try{index.close();}catch{}fx.close();}};
}
