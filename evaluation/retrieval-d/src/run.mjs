// Controlled retrieval experiment.
//   node src/run.mjs --split dev --tune        tune on the development split, write results/tuning.json + results/dev.json
//   node src/run.mjs --split heldout           evaluate with the frozen tuning, write results/heldout.json
// Every arm sees the same store, the same trusted handles, the same validity gate, the same candidate
// budget (top-50 per retriever) and the same output budget (<=20 rows, <=5000 rendered chars).
import fs from 'node:fs';import os from 'node:os';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {setup,sha} from './lib/env.mjs';
import {applyBudget,OUTPUT} from './lib/gate.mjs';
import {productionRecall,ftsRank,recallTerms} from './lib/fts.mjs';
import {reorderedTerms,segmentedTokens,lexiconExpansion,expansionTerms,loadLexicon} from './lib/terms.mjs';
import {rrf,convex} from './lib/fusion.mjs';
import {scoreQuery,aggregate,pairedBootstrap,auc,mean} from './lib/metrics.mjs';
import {RerankCache} from './lib/rerank-cache.mjs';
import {queries} from '../dataset/queries.mjs';
import {stressQueries} from '../dataset/stress-ids.mjs';

const argv=process.argv.slice(2),flag=name=>argv.includes('--'+name),opt=(name,fallback)=>{const i=argv.indexOf('--'+name);return i<0?fallback:argv[i+1];};
const split=opt('split','dev'),tune=flag('tune'),noise=Number(opt('noise',300)),CANDIDATES=50,RERANK_DEPTH=20,RERANK_MODELS=['qwen3-0.6b','embeddinggemma'];
assert(['dev','heldout'].includes(split));assert(!(tune&&split!=='dev'),'Tuning is only allowed on the development split');
const resultsDir=fileURLToPath(new URL('../results/',import.meta.url)),tuningFile=resultsDir+'tuning.json';
const E=await setup({noise});
const rerank=new RerankCache('bge-reranker-v2-m3','q8');
const set=queries.filter(q=>q.split===split),stress=stressQueries().filter(q=>q.split==='stress-'+split);
const top=(list,n=CANDIDATES)=>list.slice(0,n);

// ---------- retrievers (each returns a ranked list of {id, score} restricted to the valid set)
const memo=new Map(),once=(key,fn)=>{if(!memo.has(key))memo.set(key,fn());return memo.get(key);};
const R={
 fts:q=>once('fts|'+q.id,()=>ftsRank(E.db,E.visible[q.scope],recallTerms(q.query),q.query)),
 ftsReorder:q=>once('ftsR|'+q.id,()=>ftsRank(E.db,E.visible[q.scope],reorderedTerms(q.query),q.query)),
 // Strong lexical matches only: whole Latin/number tokens and CJK bigrams, no single-character matches.
 ftsBigram:q=>once('ftsB|'+q.id,()=>ftsRank(E.db,E.visible[q.scope],reorderedTerms(q.query,{unigrams:false}),q.query)),
 ftsSeg:q=>once('ftsS|'+q.id,()=>ftsRank(E.derived,E.visible[q.scope],segmentedTokens(q.query,{cap:64}),q.query,{table:'fts_seg'})),
 ftsDocExp:q=>once('ftsD|'+q.id,()=>ftsRank(E.derived,E.visible[q.scope],recallTerms(q.query),q.query,{table:'fts_docexp'})),
 phrases:(q,kind)=>kind==='lexicon'?lexiconExpansion(q.query).phrases:(E.queryExpansion?.items[sha(q.query)]?.terms??[]),
 // Query expansion on the unmodified production index. mode 'or': one MATCH with the extra terms;
 // mode 'rrf': rank-fuse the original list with the list obtained from the expansion terms alone.
 ftsQE:(q,kind,mode)=>once(`qe|${kind}|${mode}|${q.id}`,()=>{
  const base=recallTerms(q.query),extra=expansionTerms(base,R.phrases(q,kind));if(!extra.length)return R.fts(q);
  if(mode==='or')return ftsRank(E.db,E.visible[q.scope],[...base,...extra],q.query);
  return rrf([top(R.fts(q)),top(ftsRank(E.db,E.visible[q.scope],extra,q.query))],{k:60});
 }),
 dense:(q,model)=>once(`dense|${model}|${q.id}`,()=>{const m=E.embedders[model];return E.index.search(m.cache.get('query',q.query),E.visible[q.scope],m.modelVersion,{topN:CANDIDATES}).ranked;}),
};
const fuse=(a,b,p)=>rrf([top(a),top(b)],{k:p.k,weights:[1,p.w]});
// Similarity floor for context noise control: a dense candidate is kept only if its cosine reaches tau.
// In the hybrid form a strong lexical match (bigram / whole token) is kept regardless of its cosine.
const floorDense=(q,m,tau)=>R.dense(q,m).filter(x=>x.score>=tau);
function floorHybrid(q,m,p,tau){const lexical=new Set(top(R.ftsBigram(q)).map(x=>x.id)),ok=new Set(floorDense(q,m,tau).map(x=>x.id));return fuse(R.ftsBigram(q),R.dense(q,m),p).filter(x=>lexical.has(x.id)||ok.has(x.id));}
// Identifier pinning (parameter-free): records that contain an identifier-like query token (a Latin/number
// token of >=3 chars with a digit, e.g. "atl-2317" -> "2317", "w1137", "8443") are placed first in FTS
// order; everything else follows in the order of the given ranking.
const idTerms=q=>reorderedTerms(q.query,{unigrams:false,cap:Infinity}).filter(t=>t.length>=3&&/[0-9]/.test(t)&&/^[a-z0-9_]+$/.test(t));
function pinned(q,ranking){const terms=idTerms(q);if(!terms.length)return ranking;const head=ftsRank(E.db,E.visible[q.scope],terms,q.query).slice(0,5),seen=new Set(head.map(x=>x.id));return [...head,...ranking.filter(x=>!seen.has(x.id))];}
async function reranked(q,list){
 const head=top(list,RERANK_DEPTH),docs=head.map(x=>E.visible[q.scope].get(x.id).statement),scores=await rerank.scores(q.query,docs);
 const scored=head.map((x,i)=>({id:x.id,score:scores[i]})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 return [...scored,...list.slice(RERANK_DEPTH)];
}

// ---------- arms
const denseModels=Object.keys(E.embedders),fpModels=denseModels.filter(m=>!m.endsWith('-q8')),hasLexicon=!!loadLexicon(),hasQE=!!E.queryExpansion,hasDoc=!!E.docExpansion;
function arms(P){
 const A={};
 A['A  fts5 (production recall)']={production:true,run:q=>({lists:[R.fts(q)]})};
 A['A+ fts5 reorder-cap']={run:q=>({ranked:R.ftsReorder(q)})};
 A['A+ fts5 bigram-only']={run:q=>({ranked:R.ftsBigram(q)})};
 A['A+ fts5 word-seg+stem']={run:q=>({ranked:R.ftsSeg(q)})};
 if(hasLexicon)A['B1 fts5 + lexicon QE']={run:q=>({ranked:R.ftsQE(q,'lexicon',P.qe.lexicon)})};
 if(hasQE)A['B2 fts5 + LLM QE']={run:q=>({ranked:R.ftsQE(q,'llm',P.qe.llm)})};
 if(hasDoc)A['F1 fts5 + index-time doc expansion']={run:q=>({ranked:R.ftsDocExp(q)})};
 for(const m of denseModels)A[`C  dense ${m}`]={run:q=>({ranked:R.dense(q,m)})};
 for(const m of denseModels)A[`D  fts5 + dense ${m} (RRF)`]={run:q=>({ranked:fuse(R.fts(q),R.dense(q,m),P.d[m]),lists:[R.fts(q),R.dense(q,m)]})};
 for(const m of denseModels)A[`G2 bigram-fts5 + dense ${m} (RRF)`]={run:q=>({ranked:fuse(R.ftsBigram(q),R.dense(q,m),P.g2[m]),lists:[R.ftsBigram(q),R.dense(q,m)]})};
 for(const m of fpModels){
  if(hasLexicon)A[`E1 fts5 + lexicon QE + dense ${m} (RRF)`]={run:q=>({ranked:fuse(R.ftsQE(q,'lexicon',P.qe.lexicon),R.dense(q,m),P.d[m]),lists:[R.ftsQE(q,'lexicon',P.qe.lexicon),R.dense(q,m)]})};
  if(hasQE)A[`E2 fts5 + LLM QE + dense ${m} (RRF)`]={run:q=>({ranked:fuse(R.ftsQE(q,'llm',P.qe.llm),R.dense(q,m),P.d[m]),lists:[R.ftsQE(q,'llm',P.qe.llm),R.dense(q,m)]})};
  if(hasDoc)A[`F2 doc expansion + dense ${m} (RRF)`]={run:q=>({ranked:fuse(R.ftsDocExp(q),R.dense(q,m),P.f2[m]),lists:[R.ftsDocExp(q),R.dense(q,m)]})};
  A[`X  fts5 + dense ${m} (convex control)`]={run:q=>({ranked:convex(top(R.fts(q)),top(R.dense(q,m)),P.cc[m])})};
 }
 for(const m of denseModels){
  A[`Ct dense ${m} + similarity floor`]={run:q=>({ranked:floorDense(q,m,P.tau[m]),lists:[R.dense(q,m)]})};
  A[`Ht bigram-fts5 + dense ${m} (RRF) + similarity floor`]={run:q=>({ranked:floorHybrid(q,m,P.g2[m],P.tau[m]),lists:[R.ftsBigram(q),R.dense(q,m)]})};
 }
 for(const m of denseModels){
  A[`I  id-pinned + dense ${m}`]={run:q=>({ranked:pinned(q,R.dense(q,m)),lists:[R.ftsBigram(q),R.dense(q,m)]})};
  A[`It id-pinned + dense ${m} + similarity floor`]={run:q=>({ranked:pinned(q,floorDense(q,m,P.tau[m])),lists:[R.ftsBigram(q),R.dense(q,m)]})};
 }
 for(const m of RERANK_MODELS.filter(m=>E.embedders[m])){
  A[`F3 fts5 + dense ${m} (RRF) + cross-encoder`]={run:async q=>({ranked:await reranked(q,fuse(R.fts(q),R.dense(q,m),P.d[m])),lists:[R.fts(q),R.dense(q,m)]})};
  A[`F3c dense ${m} + cross-encoder`]={run:async q=>({ranked:await reranked(q,R.dense(q,m)),lists:[R.dense(q,m)]})};
 }
 A['F3b fts5 + cross-encoder']={run:async q=>({ranked:await reranked(q,R.fts(q)),lists:[R.fts(q)]})};
 return A;
}

// ---------- evaluation
const labelOf=id=>E.label(id);
function violations(q,ids){
 const out=[];
 for(const id of ids){const m=E.fx.meta.get(labelOf(id));if(!m){out.push('unknown:'+id);continue;}
  if(m.scope!==q.scope)out.push('foreign-scope:'+m.label);if(m.forgotten)out.push('forgotten:'+m.label);if(m.expired)out.push('expired:'+m.label);}
 return out;
}
const equivalence={checked:0,identical:0};
async function evaluate(arm,subset){
 const perQuery=[];
 for(const q of subset){
  const visible=E.visible[q.scope],r=await arm.run(q),lists=r.lists??[r.ranked];
  let final;
  if(arm.production){
   final=productionRecall(E.fx.store,E.ctx[q.scope],q.query);
   const mirror=applyBudget(R.fts(q).map(x=>x.id),visible);equivalence.checked++;if(JSON.stringify(mirror)===JSON.stringify(final))equivalence.identical++;
  }else final=applyBudget(r.ranked.map(x=>x.id),visible);
  const candidates=new Set(lists.flatMap(l=>top(l).map(x=>x.id))),targets=Object.entries(q.judgments).filter(([,g])=>g===2).map(([l])=>l);
  const labels=final.map(labelOf),m=scoreQuery(labels,q.judgments,q.negatives);
  m.candidateRecall=targets.length?targets.filter(l=>candidates.has(E.fx.ids.get(l))).length/targets.length:null;
  perQuery.push({id:q.id,category:q.category,style:q.style,language:q.language,scope:q.scope,...m,results:labels,violations:violations(q,final)});
 }
 const group=key=>Object.fromEntries([...new Set(perQuery.map(r=>r[key]))].map(v=>[v,aggregate(perQuery.filter(r=>r[key]===v))]));
 return {overall:aggregate(perQuery),byCategory:group('category'),byStyle:group('style'),byLanguage:group('language'),violations:perQuery.reduce((n,r)=>n+r.violations.length,0),perQuery};
}
const objective=result=>[result.overall.ndcg10,result.overall.recall5];
const better=(a,b)=>a[0]>b[0]+1e-9||(Math.abs(a[0]-b[0])<=1e-9&&a[1]>b[1]+1e-9);

// ---------- tuning (development split only; the identifier stress set never enters the objective)
let P;
if(tune){
 P={qe:{lexicon:'or',llm:'or'},d:{},g2:{},f2:{},cc:{},tau:{}};const log=[];
 const pick=async(label,grid,build)=>{let best=null;for(const value of grid){const result=await evaluate({run:build(value)},set),score=objective(result);log.push({label,value,ndcg10:score[0],recall5:score[1]});if(!best||better(score,best.score))best={value,score};}return best.value;};
 for(const kind of ['lexicon','llm'])if(kind==='lexicon'?hasLexicon:hasQE)P.qe[kind]=await pick('qe-'+kind,['or','rrf'],mode=>q=>({ranked:R.ftsQE(q,kind,mode)}));
 const grid=[];for(const k of [10,30,60])for(const w of [0.5,1,2,4,8])grid.push({k,w});
 for(const m of denseModels){
  P.d[m]=await pick('d-'+m,grid,p=>q=>({ranked:fuse(R.fts(q),R.dense(q,m),p)}));
  P.g2[m]=await pick('g2-'+m,grid,p=>q=>({ranked:fuse(R.ftsBigram(q),R.dense(q,m),p)}));
  // Similarity floor: the highest tau that keeps development Recall@10 within 0.02 of the unfloored list.
  const scores=set.flatMap(q=>R.dense(q,m).slice(0,OUTPUT.rows).map(x=>x.score)).sort((a,b)=>a-b),reference=(await evaluate({run:q=>({ranked:R.dense(q,m)})},set)).overall.recall10;
  let chosen=-1;
  for(let i=0;i<=40;i++){const tau=scores[Math.min(scores.length-1,Math.floor(scores.length*i/41))],result=(await evaluate({run:q=>({ranked:floorDense(q,m,tau)})},set)).overall;
   log.push({label:'tau-'+m,value:+tau.toFixed(4),recall10:result.recall10,falseReturned:result.falseReturned,ndcg10:result.ndcg10});
   if(result.recall10>=reference-0.02)chosen=tau;}
  P.tau[m]=+chosen.toFixed(4);
 }
 for(const m of fpModels){
  if(hasDoc)P.f2[m]=await pick('f2-'+m,grid,p=>q=>({ranked:fuse(R.ftsDocExp(q),R.dense(q,m),p)}));
  P.cc[m]=await pick('cc-'+m,[0.1,0.3,0.5,0.7],alpha=>q=>({ranked:convex(top(R.fts(q)),top(R.dense(q,m)),alpha)}));
 }
 fs.writeFileSync(tuningFile,JSON.stringify({tunedOn:'dev',objective:'mean nDCG@10 over answerable development queries, ties by Recall@5, first grid value wins remaining ties; tau = highest similarity floor keeping development Recall@10 within 0.02',candidateBudget:CANDIDATES,params:P,grid:log},null,1)+'\n');
}else{
 assert(fs.existsSync(tuningFile),'results/tuning.json missing: run with --split dev --tune first');P=JSON.parse(fs.readFileSync(tuningFile,'utf8')).params;
}

// ---------- run all arms
const all=arms(P),out={},stressOut={};
for(const [name,arm]of Object.entries(all)){const started=performance.now();out[name]=await evaluate(arm,set);out[name].evalMs=Math.round(performance.now()-started);const s=await evaluate(arm,stress);stressOut[name]={overall:s.overall,violations:s.violations,perQuery:s.perQuery};}
rerank.save();
assert.equal(equivalence.identical,equivalence.checked,'FTS mirror diverged from LayeredMemory.recall');

// paired bootstrap of each arm against the baseline
const baseName=Object.keys(out)[0],base=out[baseName].perQuery;
for(const [name,result]of Object.entries(out)){if(name===baseName)continue;result.vsBaseline={};for(const metric of ['recall5','ndcg10','mrr'])result.vsBaseline[metric]=pairedBootstrap(result.perQuery.map(r=>r[metric]),base.map(r=>r[metric]));}

// abstention: can the top-1 score separate answerable from unanswerable queries?
const abstention={};
const scoreAuc=fn=>{const pos=[],neg=[];for(const q of set){const s=fn(q);if(s===null||s===undefined)continue;(Object.values(q.judgments).includes(2)?pos:neg).push(s);}return {auc:auc(pos,neg),answerable:pos.length,unanswerable:neg.length,meanAnswerable:mean(pos.filter(Number.isFinite)),meanUnanswerable:mean(neg.filter(Number.isFinite))};};
abstention['fts5 top-1 relevance']=scoreAuc(q=>R.fts(q)[0]?.score??-Infinity);
abstention['fts5 top-1 bm25']=scoreAuc(q=>R.fts(q).reduce((m,x)=>Math.max(m,x.bm25),-Infinity));
for(const m of denseModels)abstention[`dense ${m} top-1 cosine`]=scoreAuc(q=>R.dense(q,m)[0]?.score??-Infinity);

const git=(...a)=>{try{return execFileSync('git',a,{cwd:resultsDir,encoding:'utf8'}).trim();}catch{return null;}};
const freeze=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../dataset/FREEZE.json',import.meta.url)),'utf8'));
const meta={split,generatedAt:new Date().toISOString(),codeSha:git('rev-parse','HEAD'),codeDirty:!!git('status','--porcelain','--','../src','../dataset'),node:process.version,sqlite:E.db.prepare('SELECT sqlite_version() v').get().v,platform:`${os.platform()} ${os.release()} ${os.arch()}`,cpu:os.cpus()[0].model.trim(),
 dataset:{sha256:freeze.sha256,frozenAt:freeze.frozenAt,noise,queries:set.length,stressQueries:stress.length,validRecords:Object.fromEntries(Object.entries(E.visible).map(([k,v])=>[k,v.size]))},
 budgets:{candidatesPerRetriever:CANDIDATES,output:OUTPUT,rerankDepth:RERANK_DEPTH},params:P,
 models:{dense:Object.fromEntries(Object.entries(E.embedders).map(([k,v])=>[k,v.modelVersion])),reranker:rerank.modelVersion,expansionLLM:E.queryExpansion?.model??null,lexicon:loadLexicon()?{groups:loadLexicon().groups.length,sha256:sha(JSON.stringify(loadLexicon().groups))}:null},
 baselineEquivalence:equivalence,synthetic:true,productionRead:false};
fs.writeFileSync(`${resultsDir}${split}.json`,JSON.stringify({meta,abstention,arms:out,stress:stressOut},null,1)+'\n');

const f=x=>x===null||x===undefined?'  -  ':x.toFixed(3);
console.log(`split=${split} queries=${set.length} stress=${stress.length} baseline-equivalence=${equivalence.identical}/${equivalence.checked}`);
console.log('arm'.padEnd(60),'R@1   R@5   R@10  Rfin  MRR   nDCG10 cand  inv   |fals ret | idR@1 idR@5 | viol');
for(const [name,r]of Object.entries(out)){const o=r.overall,s=stressOut[name].overall;console.log(name.padEnd(60),[o.recall1,o.recall5,o.recall10,o.recallFinal,o.mrr,o.ndcg10,o.candidateRecall,o.inversion].map(f).join(' '),'|',(o.falseReturned??0).toFixed(1).padStart(4),String((mean(r.perQuery.map(x=>x.returned))??0).toFixed(1)).padStart(4),'|',f(s.recall1),f(s.recall5),'|',String(r.violations+stressOut[name].violations).padStart(3));}
E.close();
