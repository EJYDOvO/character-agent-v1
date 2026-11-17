// Latency, scale and storage measurements. Writes results/perf.json.
//   node --expose-gc src/perf.mjs
// Query-embedding and index-build costs come from results/embedding-cost.*.json (one process per model).
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {setup} from './lib/env.mjs';
import {buildFixture} from './fixture.mjs';
import {visibleSet,applyBudget} from './lib/gate.mjs';
import {productionRecall,ftsRank,recallTerms,bm25} from './lib/fts.mjs';
import {rrf} from './lib/fusion.mjs';
import {VectorIndex} from './lib/vector-index.mjs';
import {createReranker} from './embed/transformers-provider.mjs';
import {queries} from '../dataset/queries.mjs';

const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return +s[Math.min(s.length-1,Math.floor(s.length*p))].toFixed(3);};
const stat=a=>({p50Ms:pct(a,.5),p95Ms:pct(a,.95),n:a.length});
const time=(fn,rounds,items)=>{const t=[];for(let r=0;r<rounds;r++)for(const x of items){const s=performance.now();fn(x);t.push(performance.now()-s);}return stat(t);};
const out={generatedAt:new Date().toISOString(),node:process.version,cpu:os.cpus()[0].model.trim(),threads:os.cpus().length,platform:`${os.platform()} ${os.arch()}`};
const s0=queries.filter(q=>q.scope==='S0'),kw=s0.filter(q=>q.style==='kw'),msg=s0.filter(q=>q.style==='msg');

// ---- main configuration (about 490 valid records in scope)
const E=await setup({noise:300,models:[['embeddinggemma','q8'],['bge-m3','q8'],['me5-small','q8']]});
const ctx=E.ctx.S0,rows=E.visible.S0;
for(let i=0;i<2;i++)for(const q of s0)productionRecall(E.fx.store,ctx,q.query);
globalThis.gc?.();const cpu0=process.cpuUsage();
out.main={validRecords:rows.size,
 productionRecall:{keyword:time(q=>productionRecall(E.fx.store,ctx,q.query),5,kw),message:time(q=>productionRecall(E.fx.store,ctx,q.query),5,msg)},
 ftsCandidatesPerQuery:{keyword:+(kw.reduce((n,q)=>n+bm25(E.db,recallTerms(q.query)).size,0)/kw.length).toFixed(1),message:+(msg.reduce((n,q)=>n+bm25(E.db,recallTerms(q.query)).size,0)/msg.length).toFixed(1)},
 validSetEnumerationViaBrowse:time(()=>visibleSet(E.fx.store,ctx),20,[0]),
 ftsRankGivenValidSet:time(q=>ftsRank(E.db,rows,recallTerms(q.query),q.query),5,s0),denseScan:{},fusionAndBudget:null};
for(const [key,m]of Object.entries(E.embedders))out.main.denseScan[key]={dim:m.cache.get('query',s0[0].query).length,...time(q=>E.index.search(m.cache.get('query',q.query),rows,m.modelVersion,{topN:50}),5,s0)};
{const m=E.embedders['embeddinggemma-q8'];out.main.fusionAndBudget=time(q=>applyBudget(rrf([ftsRank(E.db,rows,recallTerms(q.query),q.query).slice(0,50),E.index.search(m.cache.get('query',q.query),rows,m.modelVersion,{topN:50}).ranked],{k:10,weights:[1,8]}).map(x=>x.id),rows),5,s0);}
const cpu=process.cpuUsage(cpu0);out.main.cpuMsForAllOfTheAbove=Math.round((cpu.user+cpu.system)/1000);
out.main.memoryDatabaseBytes=fs.statSync(E.fx.file).size+(fs.existsSync(E.fx.file+'-wal')?fs.statSync(E.fx.file+'-wal').size:0);
// storage of the derived vector index: one model, all scopes
for(const [key,m]of Object.entries(E.embedders)){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retrieval-d-size-')),file=path.join(dir,'v.sqlite'),index=new VectorIndex(file);let n=0;
 for(const set of Object.values(E.visible))for(const row of set.values()){index.upsert({memoryId:row.id,revision:row.revision,contentHash:row.fingerprint,modelVersion:m.modelVersion,vector:m.cache.get('doc',row.statement)});n++;}
 index.close();const bytes=fs.readdirSync(dir).reduce((s,f)=>s+fs.statSync(path.join(dir,f)).size,0);out.main.denseScan[key].indexBytes=bytes;out.main.denseScan[key].vectors=n;out.main.denseScan[key].bytesPerVector=Math.round(bytes/n);fs.rmSync(dir,{recursive:true,force:true});}
// one real vector set to tile for the scale projection below
const sample=[...rows.values()].map(r=>E.embedders['embeddinggemma-q8'].cache.get('doc',r.statement)),sampleQueries=s0.slice(0,40).map(q=>E.embedders['embeddinggemma-q8'].cache.get('query',q.query));
E.close();

// ---- cross-encoder latency (real model, 20 candidates per query)
{const reranker=await createReranker('bge-reranker-v2-m3',{dtype:'q8'}),docs=['用户周末通常去郊外徒步，偏好十公里左右的山路。','The user commutes to the office by bicycle on weekdays.','预发环境的网关端口是 7805。','用户早上习惯喝一杯不加糖的冰美式。'],t=[];
 for(const q of s0.slice(0,8)){const batch=Array.from({length:20},(_,i)=>docs[i%docs.length]+' #'+i),s=performance.now();await reranker.score(q.query,batch);t.push(performance.now()-s);}
 out.crossEncoder={model:reranker.modelVersion,pairsPerQuery:20,loadMs:Math.round(reranker.loadMs),...stat(t),peakRssMB:Math.round(process.resourceUsage().maxRSS/1024)};}

// ---- scale: production FTS path and exact vector scan at larger store sizes
out.scale=[];
for(const noise of [2000,10000]){
 const started=performance.now(),fx=await buildFixture({noise}),c=fx.ctx('S0'),buildMs=Math.round(performance.now()-started);
 for(const q of s0.slice(0,30))productionRecall(fx.store,c,q.query);
 const entry={validRecords:null,fixtureBuildMs:buildMs,productionRecall:{keyword:time(q=>productionRecall(fx.store,c,q.query),2,kw),message:time(q=>productionRecall(fx.store,c,q.query),2,msg)}};
 const valid=visibleSet(fx.store,c);entry.validRecords=valid.size;
 entry.ftsCandidatesPerQuery={keyword:+(kw.reduce((n,q)=>n+bm25(fx.store.db,recallTerms(q.query)).size,0)/kw.length).toFixed(1),message:+(msg.reduce((n,q)=>n+bm25(fx.store.db,recallTerms(q.query)).size,0)/msg.length).toFixed(1)};
 entry.validSetEnumerationViaBrowse=time(()=>visibleSet(fx.store,c),3,[0]);
 // Arithmetic-only projection of the exact scan: real 768-d vectors tiled to the store size. This measures
 // dot-product and sort cost at scale; it makes no retrieval-quality claim.
 const index=new VectorIndex(),ids=[...valid.keys()];let i=0;for(const [id,row]of valid)index.upsert({memoryId:id,revision:row.revision,contentHash:row.fingerprint,modelVersion:'scale-projection',vector:sample[i++%sample.length]});
 entry.exactScan768d={vectors:ids.length,...time(v=>index.search(v,valid,'scale-projection',{topN:50}),3,sampleQueries),note:'tiled real vectors; latency only'};
 index.close();fx.close();out.scale.push(entry);
}
out.peakRssMB=Math.round(process.resourceUsage().maxRSS/1024);
fs.writeFileSync(fileURLToPath(new URL('../results/perf.json',import.meta.url)),JSON.stringify(out,null,1)+'\n');
console.log(JSON.stringify(out,null,1));
