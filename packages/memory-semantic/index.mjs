// Optional semantic recall for the layered Memory Core (D1). Not declared by any bundle: it runs only
// when a Profile row adds it, and with mode 'off' (the default) it attaches nothing at all.
//
//   mode: off     nothing is loaded; recall is byte-for-byte the FTS5 path
//         shadow  vectors are built and compared, but every caller still receives the FTS5 result
//         active  dense ranking + exact identifier pin + similarity floor; FTS5 on any failure
//
// The Memory Core stays the only authority: it decides which rows are valid for a trusted handle,
// re-reads every returned row, and owns identity, ACL, provenance, conflicts, revisions, expiry and
// forgetting. This plugin owns a model, a derived sidecar index and an indexer. Nothing else.
import path from 'node:path';
import {resolveModel,modelVersion} from './models.mjs';
import {VectorIndex} from './vector-index.mjs';
import {SemanticRanker} from './ranker.mjs';
import {createProvider} from './provider.mjs';

export const name='memory-semantic';
export const inject=['dshMemory'];

const number=(value,fallback,min,max)=>{const n=value??fallback;if(!Number.isFinite(n)||n<min||n>max)throw Error('Invalid semantic recall setting');return n;};
const unitVector=(v,dim)=>{if(!(v instanceof Float32Array)||v.length!==dim)return null;let n=0;for(const x of v){if(!Number.isFinite(x))return null;n+=x*x;}n=Math.sqrt(n);if(!(n>0))return null;return v.map(x=>x/n);};
const brief=error=>String(error?.message??error).replace(/[A-Za-z]:[\\/][^\s'"]+|\/[^\s'"]{12,}/g,'<path>').slice(0,160);

// Usable without cordis (tests, evaluation): returns the attached runtime, or null for mode off.
// `busy()` (optional) reports that the Host is doing foreground work; indexing then waits.
export function attach(store,config={},{provider:injected,logger,busy}={}){
 const mode=config.mode??'off';
 if(!['off','shadow','active'].includes(mode))throw Error('Invalid semantic recall mode');
 if(mode==='off')return null;
 for(const method of ['setSemanticRanker','semanticCandidates','semanticOrphans','activeContexts'])if(typeof store?.[method]!=='function')throw Error('Memory Core without semantic recall support: '+method);
 if(typeof config.indexFile!=='string'||!path.isAbsolute(config.indexFile))throw Error('An explicit absolute indexFile is required');
 const model=resolveModel(config.model),provider=injected??createProvider(config.provider,model);
 const version=modelVersion(model,provider.identity?.()??{kind:'custom'});
 let index;try{index=new VectorIndex(config.indexFile,version,model.dim);}catch(error){if(!injected)try{provider.close?.();}catch{}throw error;}
 if(index.recreated)logger?.warn?.('Semantic index was unreadable and has been recreated empty; it will be rebuilt');
 const ranker=new SemanticRanker({mode,index,provider,model,modelVersion:version,topK:number(config.topK,50,1,64),minCoverage:number(config.minCoverage,0.9,0,1),prepareTimeoutMs:number(config.prepareTimeoutMs,250,10,5000)});
 const batch=number(config.indexBatch,8,1,64),interval=number(config.indexIntervalMs,5000,200,3600000),sweepEvery=number(config.sweepIntervalMs,600000,1000,86400000),maxDeferMs=number(config.maxIndexDeferMs,120000,0,3600000),quietMs=number(config.quietAfterQueryMs,2000,0,60000);
 const state={busy:false,closed:false,lastSweep:0,lastRun:Date.now(),indexed:0,removed:0,cycles:0,deferred:0,lastIndexError:null,recreated:index.recreated};
 // One indexer step. Every row is an independent atomic upsert, so stopping anywhere is safe; the
 // statement comes from Core for a handle Core itself considers live, and is re-checked before the
 // write so a correction or forget that happened during the model call is never overwritten.
 async function cycle({force=false}={}){
  if(state.busy||state.closed)return {skipped:true};
  // Foreground work first: while an Agent of this store is running, wait (bounded, so a Host that is
  // never idle still gets its index eventually).
  // The model encodes one text at a time and cannot be interrupted, so a query that arrives while a long
  // record is being indexed waits for it. Messages come in bursts: stay out of the way for a moment
  // after every query as well.
  if(!force&&maxDeferMs>0&&Date.now()-state.lastRun<maxDeferMs){let active=Date.now()-(ranker.lastQueryAt??0)<quietMs;if(!active)try{active=busy?.()===true;}catch{}if(active){state.deferred++;return {deferred:true};}}
  state.busy=true;
  try{
   state.cycles++;state.lastRun=Date.now();let embedded=0;
   if(ranker.sweepDue||Date.now()-state.lastSweep>=sweepEvery){state.lastSweep=Date.now();ranker.sweepDue=false;for(const id of store.semanticOrphans(index.entries())){index.remove(id);state.removed++;}}
   for(const ctx of store.activeContexts()){
    if(state.closed||embedded>=batch)break;
    let rows;try{rows=store.semanticCandidates(ctx);}catch{continue;}
    const todo=rows.filter(r=>!index.current(r)).slice(0,batch-embedded);if(!todo.length)continue;
    const vectors=await provider.embed(todo.map(r=>r.statement),'document');
    if(state.closed)break;
    let live;try{live=new Map(store.semanticCandidates(ctx).map(r=>[r.id,r]));}catch{continue;}
    todo.forEach((row,i)=>{const now=live.get(row.id),vector=unitVector(vectors[i],model.dim);if(now&&now.fingerprint===row.fingerprint&&vector){index.upsert(row.id,now.revision,now.fingerprint,vector);embedded++;}});
   }
   index.flushRebinds();index.scrub();state.indexed+=embedded;state.lastIndexError=null;if(mode==='shadow')ranker.persist();
   return {embedded};
  }catch(error){state.lastIndexError=brief(error);return {error:state.lastIndexError};}
  finally{state.busy=false;}
 }
 const status=ranker.status.bind(ranker);
 ranker.status=()=>({...status(),indexer:{indexed:state.indexed,removed:state.removed,cycles:state.cycles,deferred:state.deferred,recreated:state.recreated,lastError:state.lastIndexError},worker:provider.usage?.()});
 store.setSemanticRanker(ranker);
 const timer=setInterval(()=>void cycle(),interval);timer.unref?.();
 logger?.info?.('Semantic recall '+mode+' with '+version);
 return {mode,model,modelVersion:version,ranker,index,provider,cycle,
  close(){if(state.closed)return;state.closed=true;clearInterval(timer);try{store.setSemanticRanker(null);}catch{}ranker.persist();try{provider.close?.();}catch{}try{index.close();}catch{}}};
}

export function apply(ctx,config={}){
 // A broken model, runtime or index must never stop the Host or Memory: report and stay on FTS5.
 let runtime=null;
 try{
  const store=ctx.get('dshMemory'),agents=ctx.get('agents');
  const busy=()=>{for(const handle of store.activeContexts())if(agents?.get?.(handle.sessionId)?.status==='running')return true;return false;};
  runtime=attach(store,config,{logger:ctx.logger,busy});
 }catch(error){ctx.logger?.warn?.('Semantic recall disabled: '+brief(error));}
 ctx.effect(()=>()=>{runtime?.close();});
}
