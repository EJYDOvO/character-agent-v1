import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {corpusVersion,records,queries} from './fixtures/recall-corpus.mjs';

export function scores(results,judgments,k){
 const expected=Object.entries(judgments).filter(([,grade])=>grade===2).map(([id])=>id);
 const dcg=list=>list.reduce((sum,grade,i)=>sum+(2**grade-1)/Math.log2(i+2),0);
 const grades=results.slice(0,k).map(id=>judgments[id]??0),ideal=Object.values(judgments).sort((a,b)=>b-a).slice(0,k);
 const first=results.findIndex(id=>expected.includes(id));
 return {recall:expected.filter(id=>results.slice(0,k).includes(id)).length/expected.length,mrr:first<0?0:1/(first+1),ndcg:dcg(grades)/dcg(ideal)};
}
export async function fixture({implementation=fileURLToPath(new URL('../',import.meta.url)),noise=0}={}){
 const {LayeredMemory}=await import(pathToFileURL(path.join(implementation,'packages/character-memory-core/layered.mjs')));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recall-evaluation-')),issued=new WeakMap();
 const scope={principalId:'synthetic-owner',namespaceId:'synthetic-memory',projectId:'synthetic-project',agentId:'synthetic-agent',memoryMode:'off'};
 const bind=(sessionId,patch={})=>{const h={sessionId};issued.set(h,{...scope,...patch});return h;};
 const store=new LayeredMemory(path.join(dir,'memory.sqlite'),h=>{assert(issued.has(h),'Unauthorized');return issued.get(h);});
 const previous=bind('previous-session'),current=bind('current-session');
 const ids=new Map(),labels=new Map();let seq=0;
 for(const [label,statement]of records){
  const candidate={kind:'semantic',statement,...(label==='expired'?{expiresAt:'2000-01-01T00:00:00Z'}:{}),...(label.startsWith('conflict-')?{claimKey:'synthetic-port'}:{})};
  const row=store.remember(previous,candidate,{sessionId:previous.sessionId,eventSeq:++seq,messageId:'fixture-'+seq,origin:'direct_user',text:statement});ids.set(label,row.id);labels.set(row.id,label);
 }
 const forgotten=store.get(current,ids.get('forgotten'));store.forget(current,forgotten.id,forgotten.revision);
 // Deterministic background text is not topical; numeric tokens may overlap.
 store.transaction(()=>{for(let i=0;i<noise;i++){
  const statement='Neutral catalog entry category '+i+' reference item.';
  const id='noise-'+i,hash=createHash('sha256').update(statement).digest('hex');
  store.db.prepare('INSERT INTO memories(id,principal,character,project,kind,statement,fingerprint,status,revision,source,created_at,updated_at,confidence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,scope.principalId,scope.namespaceId,scope.projectId,'semantic',statement,hash,'active',1,JSON.stringify({sessionId:'seed',eventSeq:i,origin:'inference'}),'2020-01-01','2020-01-01',0.5);
  store.index({id,statement,status:'active'});
 }});
 return {store,dir,current,previous,bind,issued,ids,labels,close(){store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

export async function evaluate(options={}){
 const f=await fixture(options);const rounds=options.rounds??10;
 try{
  // Count materialized rows at the SQLite/JS boundary, independent of the query
  // plan. This deterministic work metric complements noisy wall-clock/RSS.
  let rows=0;const original=f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare=(...args)=>{const stmt=original(...args);return new Proxy(stmt,{get(target,key){
   if(key==='all')return(...p)=>{const result=target.all(...p);rows+=result.length;return result;};
   if(key==='iterate')return function*(...p){for(const row of target.iterate(...p)){rows++;yield row;}};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});};
  const results=[];for(const q of queries){const found=f.store.recall(f.current,q.query,16000).map(r=>f.labels.get(r.id)??r.id);results.push({id:q.id,language:q.language,top5:found.slice(0,5),recall1:scores(found,q.relevant,1).recall,...scores(found,q.relevant,5)});}
  const traced=f.store.trace(f.current,f.ids.get('previous-session')).evidence;
  const safety={expiredAbsent:!f.store.recall(f.current,'星港项目',16000).some(r=>r.id===f.ids.get('expired')),forgottenAbsent:!f.store.recall(f.current,'竹林项目',16000).some(r=>r.id===f.ids.get('forgotten')),crossSessionTrace:traced.length===1&&traced.every(e=>e.session==='previous-session'&&e.status==='active'),foreignScopeEmpty:f.store.recall(f.bind('foreign',{projectId:'foreign-project'}),'rollback',16000).length===0,conflictsExcludedFromL3:!f.store.projection(f.current).refs.some(r=>[f.ids.get('conflict-a'),f.ids.get('conflict-b')].includes(r.id))};
  assert(Object.values(safety).every(Boolean),'Safety invariant failed');
  for(let warm=0;warm<2;warm++)for(const q of queries)f.store.recall(f.current,q.query,16000);
  globalThis.gc?.();const before=process.memoryUsage(),cpuBefore=process.cpuUsage();rows=0;const times=[];
  for(let n=0;n<rounds;n++)for(const q of queries){const at=performance.now();f.store.recall(f.current,q.query,16000);times.push(performance.now()-at);}
  const cpu=process.cpuUsage(cpuBefore),after=process.memoryUsage(),materialized=rows;times.sort((a,b)=>a-b);
  const average=field=>results.reduce((n,r)=>n+r[field],0)/results.length;
  return {synthetic:true,productionRead:false,corpusVersion,records:records.length,noise:options.noise??0,queryCount:queries.length,rounds,metrics:{recallAt1:average('recall1'),recallAt5:average('recall'),mrr:average('mrr'),ndcgAt5:average('ndcg'),p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],cpuMs:(cpu.user+cpu.system)/1000,materializedRowsPerQuery:materialized/times.length,heapDeltaBytes:after.heapUsed-before.heapUsed,rssDeltaBytes:after.rss-before.rss,databaseBytes:fs.statSync(path.join(f.dir,'memory.sqlite')).size,walBytes:fs.statSync(path.join(f.dir,'memory.sqlite-wal')).size},safety,results};
 }finally{f.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2);const options={};for(let i=0;i<args.length;i+=2){assert(['--implementation','--noise','--rounds'].includes(args[i]),'Invalid evaluation argument');options[args[i].slice(2)]=args[i]==='--implementation'?path.resolve(args[i+1]):Number(args[i+1]);}
 assert(Number.isInteger(options.noise??0)&&(options.noise??0)>=0&&(options.noise??0)<=100000);assert(Number.isInteger(options.rounds??10)&&(options.rounds??10)>0&&(options.rounds??10)<=100);
 console.log(JSON.stringify(await evaluate(options),null,2));
}
