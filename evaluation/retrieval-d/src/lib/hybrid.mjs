// Reference shape of a hybrid retriever that keeps the SQLite Memory Core as the only source of truth.
// Research code: it wraps the Core from the outside and changes no runtime path.
//
//   trusted handle ──► Core valid set (ACL, status, expiry, evidence, forget barriers)   [authoritative]
//                         │
//        FTS5 candidates ─┤  (transactional index inside the Core database)
//      dense candidates ──┤  (derived sidecar; entries bound to id/revision/contentHash/modelVersion)
//                         ▼
//                 rank fusion ─► context budget ─► rows re-read from the valid set
//
// Similarity only orders rows that the Core already returned for this handle. If the embedding side
// fails in any way the result is exactly the FTS5 ranking.
//
// Index lag: a record that was just written or corrected has no current vector yet. With plain RRF it
// would appear in one list only and be outranked by older records that appear in both. Such "pending"
// rows therefore receive, as their dense contribution, the reciprocal rank they hold in the FTS list:
// they are ranked as if both retrievers agreed, until the indexer has embedded them.
import {visibleSet,applyBudget} from './gate.mjs';
import {ftsRank,recallTerms} from './fts.mjs';
import {rrf} from './fusion.mjs';

export class HybridRetriever{
 constructor({store,index,embedder,k=60,denseWeight=1,candidates=50,embedTimeoutMs=2000}){Object.assign(this,{store,index,embedder,k,denseWeight,candidates,embedTimeoutMs});}
 async #queryVector(query){
  let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('embedding timeout')),this.embedTimeoutMs);});
  try{const [vector]=await Promise.race([this.embedder.embed([query],'query'),timeout]);if(!(vector instanceof Float32Array)||!vector.length||vector.some(Number.isNaN))throw Error('invalid embedding');return vector;}
  finally{clearTimeout(timer);}
 }
 async retrieve(ctx,query){
  const rows=visibleSet(this.store,ctx); // throws for an unauthorised handle: nothing is searched
  const fts=ftsRank(this.store.db,rows,recallTerms(query),query);
  let dense=null,degraded=null,stats={missing:0,stale:0,scanned:0,pending:[]};
  try{const result=this.index.search(await this.#queryVector(query),rows,this.embedder.modelVersion,{topN:this.candidates});dense=result.ranked;stats=result;}
  catch(error){degraded=String(error?.message??error);}
  let ranked=fts;
  if(dense?.length){
   const head=fts.slice(0,this.candidates),pending=new Set(stats.pending),imputed=head.filter(x=>pending.has(x.id));
   ranked=rrf([head,dense],{k:this.k,weights:[1,this.denseWeight]});
   if(imputed.length){const bonus=new Map(head.map((x,rank)=>[x.id,this.denseWeight/(this.k+rank+1)]));
    ranked=ranked.map(x=>pending.has(x.id)?{id:x.id,score:x.score+(bonus.get(x.id)??0)}:x).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));}
  }
  const ids=applyBudget(ranked.map(x=>x.id),rows);
  return {rows:ids.map(id=>rows.get(id)),ids,degraded,dense:{missing:stats.missing,stale:stats.stale,scanned:stats.scanned}};
 }
 // Indexer step for one trusted handle: (re-)embed rows whose vector is absent or bound to other content.
 // Safe to interrupt at any point; each row is an independent atomic upsert.
 async sync(ctx,{limit=Infinity}={}){
  const rows=visibleSet(this.store,ctx),todo=this.index.pending(rows,this.embedder.modelVersion).slice(0,limit);
  for(const id of todo){const row=rows.get(id),[vector]=await this.embedder.embed([row.statement],'doc');
   this.index.upsert({memoryId:id,revision:row.revision,contentHash:row.fingerprint,modelVersion:this.embedder.modelVersion,vector});}
  return {embedded:todo.length};
 }
}
