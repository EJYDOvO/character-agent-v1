// Computes real embeddings for every corpus statement and query with one model and records the cost.
//   node src/embed-cache.mjs <model>:<dtype> [--noise N]
// One model per process so that peak RSS and CPU time are attributable.
import fs from 'node:fs';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {createEmbedder} from './embed/transformers-provider.mjs';
import {EmbeddingCache} from './lib/embed-cache.mjs';
import {memories,distractors} from '../dataset/corpus.mjs';
import {queries as mainQueries} from '../dataset/queries.mjs';
import {stressQueries} from '../dataset/stress-ids.mjs';
const queries=[...mainQueries,...stressQueries()];

const [arg,...rest]=process.argv.slice(2);if(!arg)throw Error('usage: embed-cache.mjs <model>:<dtype> [--noise N]');
const [name,dtype='fp32']=arg.split(':'),noise=Number(rest[rest.indexOf('--noise')+1]||300)||300;
const docs=[];for(const [,,,statement,options={}]of [...memories,...distractors(noise)]){docs.push(statement);if(options.was)docs.push(options.was);}
const cache=new EmbeddingCache(name,dtype);
const todoDocs=[...new Set(docs)].filter(t=>!cache.has('doc',t)),todoQueries=[...new Set(queries.map(q=>q.query))].filter(t=>!cache.has('query',t));
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor(s.length*p))]:null;};
const cost={model:name,dtype,modelVersion:cache.modelVersion,node:process.version,cpu:os.cpus()[0].model.trim(),threads:os.cpus().length,executionProvider:'cpu (onnxruntime-node)'};
if(todoDocs.length||todoQueries.length){
 const cpu0=process.cpuUsage(),t0=performance.now();
 const embedder=await createEmbedder(name,{dtype,batchSize:8});cost.loadMs=Math.round(embedder.loadMs);
 // Documents: batched, as an indexer would run them. Sorted by length to keep padding small.
 const ordered=[...todoDocs].sort((a,b)=>a.length-b.length);let t=performance.now();
 for(let i=0;i<ordered.length;i+=8){const part=ordered.slice(i,i+8),vecs=await embedder.embed(part,'doc');part.forEach((text,j)=>cache.set('doc',text,vecs[j]));if(i%160===0)cache.save();}
 if(ordered.length)cost.docs={count:ordered.length,totalMs:Math.round(performance.now()-t),msPerDoc:+((performance.now()-t)/ordered.length).toFixed(2),chars:ordered.reduce((n,x)=>n+x.length,0)};
 // Short single documents one by one: the cost of re-embedding one record after remember/correct.
 const shortDocs=ordered.filter(x=>x.length<=80).slice(0,40),single=[];
 for(const text of shortDocs){const s=performance.now();await embedder.embed([text],'doc');single.push(performance.now()-s);}
 if(single.length)cost.singleDocUpdate={count:single.length,p50Ms:+pct(single,.5).toFixed(2),p95Ms:+pct(single,.95).toFixed(2)};
 // Queries: one at a time, as on the per-turn path.
 const times=[];for(const text of todoQueries){const s=performance.now();const [v]=await embedder.embed([text],'query');times.push(performance.now()-s);cache.set('query',text,v);}
 if(times.length)cost.queries={count:times.length,p50Ms:+pct(times,.5).toFixed(2),p95Ms:+pct(times,.95).toFixed(2),meanMs:+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(2)};
 cache.save();
 const cpu=process.cpuUsage(cpu0);cost.wallMs=Math.round(performance.now()-t0);cost.cpuMs=Math.round((cpu.user+cpu.system)/1000);cost.peakRssMB=Math.round(process.resourceUsage().maxRSS/1024);
 if(cost.docs&&cost.queries){const file=fileURLToPath(new URL(`../results/embedding-cost.${name}.${dtype}.json`,import.meta.url));fs.writeFileSync(file,JSON.stringify(cost,null,1)+'\n');}
}
console.log(JSON.stringify({...cost,cachedDocs:docs.length-todoDocs.length,cachedQueries:queries.length-todoQueries.length}));
