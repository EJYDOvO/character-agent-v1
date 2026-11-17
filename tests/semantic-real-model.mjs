// Opt-in end-to-end verification with the real model (not part of `npm test`: needs provisioned files).
// Real LayeredMemory + real plugin + real embedding worker process, synthetic data only.
//   node tests/semantic-real-model.mjs --runtime-dir <abs> --model-dir <abs> --dataset <dir> [--noise 300] [--out file]
// The dataset defaults to tests/fixtures/semantic-eval: the frozen corpus and dev/held-out judgments of
// the D-phase research (PR #26), copied unchanged (see MANIFEST.json there). It also runs unchanged on the Host runtime:
//   ELECTRON_RUN_AS_NODE=1 "<Host>/DeepSeek Harness.exe" tests/semantic-real-model.mjs ...
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
import {attach} from '../packages/memory-semantic/index.mjs';

const args=process.argv.slice(2),value=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const runtimeDir=value('runtime-dir'),modelDir=value('model-dir'),dataset=value('dataset',fileURLToPath(new URL('./fixtures/semantic-eval/',import.meta.url))),noise=Number(value('noise',300)),out=value('out');
assert(runtimeDir&&modelDir,'usage: --runtime-dir <abs> --model-dir <abs> [--dataset <dir>] [--noise N] [--out file]');
const load=name=>import(pathToFileURL(path.resolve(dataset,name)).href);
const {scopes,memories,distractors}=await load('corpus.mjs'),{queries}=await load('queries.mjs'),{stressQueries}=await load('stress-ids.mjs');
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s.length?+s[Math.min(s.length-1,Math.floor(s.length*p))].toFixed(2):null;};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'semantic-real-')),issued=new WeakMap(),handles=new Map();
const store=new LayeredMemory(path.join(dir,'memory.sqlite'),h=>{assert(issued.has(h),'Unauthorized');return issued.get(h);});
const bind=(scope,session='session-current')=>{const k=scope+'|'+session;if(!handles.has(k)){const h=Object.freeze({sessionId:session});issued.set(h,{...scopes[scope],agentId:'agent-'+scope,memoryMode:'off'});handles.set(k,h);}return handles.get(k);};
const ids=new Map(),labels=new Map(),meta=new Map();let seq=0;
for(const [label,scope,kind,statement,options={}]of [...memories,...distractors(noise)]){
 const session=options.session??'session-2026-a',h=bind(scope,session),origin=options.origin??'direct_user',initial=options.was??statement;
 const row=store.remember(h,{kind,statement:initial,...(options.expiresAt?{expiresAt:options.expiresAt}:{}),...(options.claimKey?{claimKey:options.claimKey}:{})},{sessionId:session,eventSeq:++seq,messageId:'fx-'+seq,origin,...(origin==='direct_user'?{text:initial}:{})});
 ids.set(label,row.id);labels.set(row.id,label);meta.set(label,{scope,statement,was:options.was,forgotten:!!options.forget,expired:!!options.expiresAt&&Date.parse(options.expiresAt)<=Date.now()});
}
for(const [label,m]of meta){const h=bind(m.scope),id=ids.get(label);
 if(m.was){const row=store.get(h,id);store.correct(h,id,m.statement,row.revision,{sessionId:h.sessionId,eventSeq:++seq,messageId:'fx-'+seq,origin:'direct_user',text:m.statement});}
 if(m.forgotten){const row=store.get(h,id);store.forget(h,id,row.revision);}}
for(const scope of Object.keys(scopes))store.semanticCandidates(bind(scope)); // make every scope an active context

const report={at:new Date().toISOString(),runtime:process.version,electron:process.versions.electron??null,platform:`${os.platform()} ${os.arch()}`,cpu:os.cpus()[0].model.trim(),noise,synthetic:true,productionRead:false};
const runtime=attach(store,{mode:'active',indexFile:path.join(dir,'vectors.sqlite'),indexIntervalMs:3600000,indexBatch:64,provider:{kind:'subprocess',runtimeDir,modelDir,threads:Number(value('threads',2)),idleUnloadMs:0}});
report.modelVersion=runtime.modelVersion;report.minScore=runtime.model.minScore;
try{
 // ---- index build through the real indexer
 let started=performance.now(),embedded=0;for(;;){const r=await runtime.cycle({force:true});if(r.error)throw Error(r.error);if(!r.embedded)break;embedded+=r.embedded;}
 report.index={records:embedded,buildMs:Math.round(performance.now()-started),msPerRecord:+((performance.now()-started)/embedded).toFixed(1),workerLoadMs:runtime.provider.loadMs,bytes:fs.statSync(path.join(dir,'vectors.sqlite')).size+(fs.existsSync(path.join(dir,'vectors.sqlite-wal'))?fs.statSync(path.join(dir,'vectors.sqlite-wal')).size:0)};

 // ---- quality: unmodified lexical recall vs the integrated semantic path, same budget as context()
 const render=r=>({id:r.id,revision:r.revision,purpose:r.purpose,statement:r.statement,status:r.status,conflictWith:r.conflict_with});
 const evaluate=async(set,semantic)=>{
  const rows=[],latency=[];let violations=0;
  for(const q of set){
   const ctx=bind(q.scope),t=performance.now(),got=semantic?await store.recallAsync(ctx,q.query,5000,{render}):store.recall(ctx,q.query,5000,{render});latency.push(performance.now()-t);
   const found=got.map(r=>labels.get(r.id)),targets=Object.entries(q.judgments).filter(([,g])=>g===2).map(([l])=>l);
   for(const l of found){const m=meta.get(l);if(!m||m.scope!==q.scope||m.forgotten||m.expired)violations++;}
   for(const r of got){const m=meta.get(labels.get(r.id));if(m&&r.statement!==m.statement)violations++;} // only the current revision text may be returned
   rows.push({id:q.id,category:q.category,answerable:targets.length>0,r1:targets.length?targets.filter(l=>found.slice(0,1).includes(l)).length/targets.length:null,r5:targets.length?targets.filter(l=>found.slice(0,5).includes(l)).length/targets.length:null,returned:got.length});
  }
  const ans=rows.filter(r=>r.answerable),none=rows.filter(r=>!r.answerable),cats={};
  for(const r of ans)(cats[r.category]??=[]).push(r.r5);
  return {queries:rows.length,answerable:ans.length,recallAt1:+mean(ans.map(r=>r.r1)).toFixed(3),recallAt5:+mean(ans.map(r=>r.r5)).toFixed(3),rowsWhenAnswerable:+mean(ans.map(r=>r.returned)).toFixed(1),rowsWhenNothingRelevant:none.length?+mean(none.map(r=>r.returned)).toFixed(1):null,violations,p50Ms:pct(latency,.5),p95Ms:pct(latency,.95),recallAt5ByCategory:Object.fromEntries(Object.entries(cats).map(([c,v])=>[c,+mean(v).toFixed(2)]))};
 };
 report.quality={};
 for(const split of ['dev','heldout']){const set=queries.filter(q=>q.split===split),stress=stressQueries().filter(q=>q.split==='stress-'+split);
  report.quality[split]={lexical:await evaluate(set,false),semantic:await evaluate(set,true),identifierStress:{lexical:await evaluate(stress,false),semantic:await evaluate(stress,true)}};}

 // ---- per-turn path: trusted ingress starts the embedding, the synchronous context() consumes it
 const turn=bind('S0','session-turn'),timings=[];let ready=0,n=0;
 for(const q of queries.filter(q=>q.scope==='S0'&&q.split==='heldout'&&q.style==='msg').slice(0,40)){
  const t=performance.now();store.noteInput(turn,{sessionId:'session-turn',eventSeq:++n,messageId:'turn-'+n,origin:'direct_user',text:q.query});
  const before=store.layersStatus(turn).semantic.counters.ranked;await runtime.ranker.prepare(q.query);const waited=performance.now()-t,c=performance.now();store.context(turn);
  timings.push({prepare:waited,context:performance.now()-c});if(store.layersStatus(turn).semantic.counters.ranked>before)ready++;
 }
 report.perTurn={messages:timings.length,semanticContextUsed:ready,ingressToVectorP50Ms:pct(timings.map(x=>x.prepare),.5),ingressToVectorP95Ms:pct(timings.map(x=>x.prepare),.95),contextP50Ms:pct(timings.map(x=>x.context),.5),contextP95Ms:pct(timings.map(x=>x.context),.95)};
 const lexicalContext=[];store.setSemanticRanker(null);for(const q of queries.filter(q=>q.scope==='S0'&&q.split==='heldout'&&q.style==='msg').slice(0,40)){store.noteInput(turn,{sessionId:'session-turn',eventSeq:++n,messageId:'turn-'+n,origin:'direct_user',text:q.query});const c=performance.now();store.context(turn);lexicalContext.push(performance.now()-c);}
 store.setSemanticRanker(runtime.ranker);report.perTurn.lexicalContextP50Ms=pct(lexicalContext,.5);report.perTurn.lexicalContextP95Ms=pct(lexicalContext,.95);

 // ---- lifecycle on the live index
 const s0=bind('S0'),ev=text=>({sessionId:s0.sessionId,eventSeq:++seq,messageId:'lv-'+seq,origin:'direct_user',text}),checks={};
 const fresh=store.remember(s0,{kind:'semantic',statement:'用户新买了一台手冲咖啡壶，放在办公室。'},ev('用户新买了一台手冲咖啡壶，放在办公室。'));
 checks.newRecordBeforeIndexing=(await store.recallAsync(s0,'手冲咖啡壶',5000))[0]?.id===fresh.id;
 const indexed=await runtime.cycle({force:true});checks.freshRecordIndexed=indexed.embedded===1;checks.newRecordSemanticAfterIndexing=(await store.recallAsync(s0,'pour-over coffee kettle at the office',5000)).slice(0,3).some(r=>r.id===fresh.id);
 const corrected=store.correct(s0,fresh.id,'用户把手冲咖啡壶换成了一台胶囊咖啡机。',fresh.revision,ev('用户把手冲咖啡壶换成了一台胶囊咖啡机。'));
 checks.correctionReturnsOnlyNewText=(await store.recallAsync(s0,'手冲咖啡壶',5000)).every(r=>r.id!==fresh.id||r.statement===corrected.statement);
 store.forget(s0,fresh.id,store.get(s0,fresh.id).revision);
 checks.forgottenGoneImmediately=!(await store.recallAsync(s0,'胶囊咖啡机',5000)).some(r=>r.id===fresh.id)&&!runtime.index.entries().some(e=>e.id===fresh.id);
 const foreign=meta.get('b-vinyl').statement;checks.foreignScopeTextNotReturned=!(await store.recallAsync(s0,foreign.slice(0,60),5000)).some(r=>r.statement===foreign);
 report.lifecycle=checks;

 // ---- a query must not wait behind an indexing batch (the worker serves queries first)
 for(let i=0;i<32;i++)store.remember(s0,{kind:'episodic',statement:'索引压力记录 '+i+'：'+'夜班主管在交接班时登记了托盘上的样品并核对了批次。'.repeat(6)},{sessionId:s0.sessionId,eventSeq:++seq,origin:'inference'});
 let batchDoneAt=0;const batchStart=performance.now(),indexing=runtime.cycle({force:true}).then(r=>{batchDoneAt=performance.now();return r;}),during=[];await new Promise(r=>setTimeout(r,30));
 for(let i=0;i<12;i++){const t=performance.now();await runtime.provider.embed(['索引期间的查询 '+i],'query');during.push({ms:performance.now()-t,beforeBatchEnd:batchDoneAt===0});}
 const batch=await indexing;for(;;){const r=await runtime.cycle({force:true});if(!r.embedded)break;}
 // Property: queries are answered while the batch is still running (each waits for at most the one
 // record being encoded), not after it.
 report.queryDuringIndexing={batchEmbedded:batch.embedded,batchMs:Math.round(batchDoneAt-batchStart),queries:during.length,answeredBeforeBatchEnd:during.filter(d=>d.beforeBatchEnd).length,p50Ms:pct(during.map(d=>d.ms),.5),p95Ms:pct(during.map(d=>d.ms),.95)};

 // ---- worker failures. Each case is checked strictly: identical to the lexical result, and visible
 // as a counted fallback (no "passed because something was ranked earlier").
 const counters=()=>({...store.layersStatus(s0).semantic.counters}),lexicalIds=q=>JSON.stringify(store.recall(s0,q,5000).map(r=>r.id)),failover={};
 const wait=async(test,ms=20000)=>{const until=Date.now()+ms;while(Date.now()<until){if(test())return true;await new Promise(r=>setTimeout(r,50));}return false;};
 const fallback=async(label,query)=>{const before=counters(),got=await store.recallAsync(s0,query,5000),after=counters();
  failover[label]={equalsLexical:JSON.stringify(got.map(r=>r.id))===lexicalIds(query),rankedDelta:after.ranked-before.ranked,notReadyDelta:after.notReady-before.notReady};
  return failover[label].equalsLexical&&failover[label].rankedDelta===0&&failover[label].notReadyDelta===1;};
 const recover=async label=>{let ok=false;for(let i=0;i<80&&!ok;i++){await new Promise(r=>setTimeout(r,250));const q='周末去远足 '+label.length+' '+i;ok=await runtime.ranker.prepare(q)&&(await store.recallAsync(s0,q,5000)).some(r=>labels.get(r.id)==='hobby-hike');}failover[label].recovered=ok;return ok;};
 // (a) worker stopped between requests
 runtime.provider.stop();await wait(()=>runtime.provider.state()==='stopped');
 const stopped=await fallback('stopped','他平时怎么锻炼身体 failover-a')&&await recover('stopped');
 // (b) worker killed by the OS while it is embedding an indexing batch
 for(let i=0;i<16;i++)store.remember(s0,{kind:'episodic',statement:'崩溃测试记录 '+i+'：物业在年检之前更换了走廊的应急灯。'},{sessionId:s0.sessionId,eventSeq:++seq,origin:'inference'});
 const pid=runtime.provider.pid,inflight=runtime.cycle({force:true});await new Promise(r=>setTimeout(r,40));process.kill(pid);const crashedCycle=await inflight;
 await wait(()=>runtime.provider.state()==='stopped');
 failover.killedMidBatch={indexerReportedError:typeof crashedCycle.error==='string'};
 const killed=await fallback('killed','他平时怎么锻炼身体 failover-b')&&failover.killedMidBatch.indexerReportedError&&await recover('killed');
 for(;;){const r=await runtime.cycle({force:true});if(r.error)throw Error(r.error);if(!r.embedded)break;}
 failover.indexCompleteAfterCrash=store.semanticCandidates(s0).every(r=>runtime.index.current(r));
 report.failover={...failover,ok:stopped&&killed&&failover.indexCompleteAfterCrash};
 report.status=store.layersStatus(s0).semantic;
 report.hostRssMB=Math.round(process.memoryUsage().rss/1e6);
}finally{runtime.close();try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});}
const ok=Object.values(report.lifecycle).every(Boolean)&&Object.values(report.quality).every(s=>s.semantic.violations===0&&s.identifierStress.semantic.violations===0)&&report.failover.ok===true&&report.queryDuringIndexing.answeredBeforeBatchEnd===report.queryDuringIndexing.queries;
report.ok=ok;if(out)fs.writeFileSync(out,JSON.stringify(report,null,1)+'\n');
console.log(JSON.stringify(report,null,1));process.exit(ok?0:1);
