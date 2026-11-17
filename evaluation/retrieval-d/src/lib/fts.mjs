// FTS5 retrieval. Arm A calls the real LayeredMemory.recall. The other arms need BM25 for a modified
// term list (expansion) or a shadow index, so the same computation is re-expressed here on top of the
// production helpers (recallTerms, relevance, the MATCH syntax); run.mjs asserts that with unmodified
// terms it reproduces LayeredMemory.recall exactly.
import {recallTerms,relevance} from '../../../../packages/character-memory-core/store.mjs';
import {tokenizeText} from '../../../../packages/character-memory-core/tokenize.mjs';
import {render,OUTPUT} from './gate.mjs';
export {recallTerms,relevance};

export const normalize=text=>text.normalize('NFKC').toLowerCase();
export const tokens=text=>[...new Set(tokenizeText(normalize(text)))];
export const matchExpr=terms=>terms.map(t=>'"'+t.replaceAll('"','""')+'"').join(' OR ');

export function productionRecall(store,ctx,query){return store.recall(ctx,query,OUTPUT.chars,{render}).map(r=>r.id);}

export function bm25(db,terms,table='memory_fts'){
 const out=new Map();if(!terms.length)return out;
 for(const r of db.prepare(`SELECT id,bm25(${table}) rank FROM ${table} WHERE ${table} MATCH ?`).all(matchExpr(terms)))out.set(r.id,r.rank);
 return out;
}

// Ranked list of *valid* ids with the production relevance formula. `query` is always the original
// user text (substring bonus + Jaccard are computed against it); `terms` may include expansions.
export function ftsRank(db,visible,terms,query,{table='memory_fts'}={}){
 const ranks=bm25(db,terms,table),rows=[];
 for(const [id,rank]of ranks){const row=visible.get(id);if(row)rows.push({id,score:relevance({...row,rank},query),bm25:-rank});}
 rows.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 return rows;
}
