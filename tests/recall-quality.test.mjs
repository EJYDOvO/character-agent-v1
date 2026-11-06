import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,evaluate,scores} from './recall-evaluation.mjs';
import {relevance} from '../packages/character-memory-core/store.mjs';

test('phrase ranking uses the same case/compatibility normalization as FTS',()=>{
 const row={statement:'Release uses KAPPA-42 and retains a rollback snapshot for review.',confidence:1};
 for(const query of ['KAPPA-42','kappa-42','ＫＡＰＰＡ-４２'])assert.equal(relevance(row,query),relevance(row,'KAPPA-42'));
 assert.equal(relevance(row,'ROLLBACK SNAPSHOT'),relevance(row,'rollback snapshot'));
});

test('bilingual recall judgments, provenance, expiry, conflict and forget are repeatable',async()=>{
 const result=await evaluate({rounds:1,noise:0});
 assert.equal(result.metrics.recallAt5,12/14,'disjoint synonyms remain explicit misses');
 assert(result.metrics.recallAt1>=10/14);assert(result.metrics.ndcgAt5>=0.82);
 assert(Object.values(result.safety).every(Boolean));
 assert.equal(result.results.find(r=>r.id==='english-case').recall1,1);
 assert.deepEqual(result.results.find(r=>r.id==='mixed-case').top5,result.results.find(r=>r.id==='compat-width').top5,'compatibility spelling has identical ordering, even when the exact target is not first');
 assert.equal(scores(['b','a'],{a:2,b:1},1).recall,0,'partial topical matches do not inflate Recall@K');
});

test('selective retrieval does not materialize unrelated memories before filtering',async()=>{
 const f=await fixture({noise:500});try{
  let rows=0;const prepare=f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare=(...args)=>{const stmt=prepare(...args);return new Proxy(stmt,{get(target,key){
   if(key==='all')return(...p)=>{const result=target.all(...p);rows+=result.length;return result;};
   if(key==='iterate')return function*(...p){for(const row of target.iterate(...p)){rows++;yield row;}};
   const v=target[key];return typeof v==='function'?v.bind(target):v;
  }});};
  assert(f.store.recall(f.current,'海蓝档案',16000).some(r=>r.id===f.ids.get('long')));
  assert(rows<30,'selective FTS must not load the unrelated 500-row corpus');
 }finally{f.close();}
});
