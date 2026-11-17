// The object handed to LayeredMemory.setSemanticRanker(). Core calls rank() synchronously with the
// identities of the rows that are valid for one trusted handle; this class answers with an order
// (or null = "not available, use FTS5"). It never sees statements at query time and never returns
// anything but ids Core gave it.
const unit=v=>{let n=0;for(let i=0;i<v.length;i++){if(!Number.isFinite(v[i]))return null;n+=v[i]*v[i];}n=Math.sqrt(n);if(!(n>0))return null;const out=new Float32Array(v.length);for(let i=0;i<v.length;i++)out[i]=v[i]/n;return out;};
const withTimeout=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(label+' timeout'),{code:'TIMEOUT'})),ms);})]).finally(()=>clearTimeout(timer));};
const brief=error=>String(error?.message??error).replace(/[A-Za-z]:[\\/][^\s'"]+|\/[^\s'"]{12,}/g,'<path>').slice(0,160);

export class SemanticRanker{
 #cache=new Map();#inflight=new Map();#failures=0;#retryAt=0;
 constructor({mode,index,provider,model,modelVersion,topK=50,minCoverage=0.9,prepareTimeoutMs=250,queryCacheSize=64,breakerFailures=3,breakerCooldownMs=30000}){
  if(!['active','shadow'].includes(mode))throw Error('Semantic mode must be active or shadow');
  Object.assign(this,{mode,index,provider,model,modelVersion,topK,minCoverage,prepareTimeoutMs,queryCacheSize,breakerFailures,breakerCooldownMs});
  const saved=index.meta('shadow');
  this.counters={prepared:0,prepareTimeouts:0,prepareErrors:0,breakerSkips:0,ranked:0,notReady:0,lowCoverage:0,empty:0,errors:0,invalidated:0,invalidateErrors:0};
  this.shadow=saved?.modelVersion===modelVersion?saved.stats:{compared:0,semanticUnavailable:0,sameTop1:0,overlapAt5:0,lexicalRows:0,semanticRows:0,semanticEmpty:0};
 }
 // Embeds the query ahead of the synchronous rank(). Never rejects; resolves true when a vector is
 // available. A request that outlives the timeout still fills the cache for the next context refresh.
 prepare(query){
  this.lastQueryAt=Date.now();
  if(this.#cache.has(query))return Promise.resolve(true);
  if(Date.now()<this.#retryAt){this.counters.breakerSkips++;return Promise.resolve(false);}
  let job=this.#inflight.get(query);
  if(!job){
   job=Promise.resolve().then(()=>this.provider.embed([query],'query')).then(([raw])=>{
    const vector=raw instanceof Float32Array&&raw.length===this.model.dim?unit(raw):null;if(!vector)throw Error('Invalid query embedding');
    if(this.#cache.size>=this.queryCacheSize)this.#cache.delete(this.#cache.keys().next().value);
    this.#cache.set(query,vector);this.#failures=0;this.counters.prepared++;return true;
   }).catch(error=>{
    this.counters.prepareErrors++;this.lastError=brief(error);
    if(++this.#failures>=this.breakerFailures){this.#retryAt=Date.now()+this.breakerCooldownMs;this.#failures=0;}
    return false;
   }).finally(()=>this.#inflight.delete(query));
   this.#inflight.set(query,job);
  }
  return withTimeout(job,this.prepareTimeoutMs,'query embedding').catch(()=>{this.counters.prepareTimeouts++;return false;});
 }
 rank({query,keys}){
  const vector=this.#cache.get(query);if(!vector){this.counters.notReady++;return null;}
  const result=this.index.search(vector,keys,{minScore:this.model.minScore,topK:this.topK});
  // While the index is being built (first enable, model change) similarity over a fraction of the
  // store would silently hide the rest: stay on FTS5 until enough of this handle's rows are embedded.
  if(keys.length&&result.scanned/keys.length<this.minCoverage){this.counters.lowCoverage++;return null;}
  this.counters.ranked++;if(!result.ids.length)this.counters.empty++;
  return {ids:result.ids,pending:result.pending};
 }
 // Called by Core inside correct / forget / expire. A failing sidecar write must not fail the Core
 // operation and must not go unnoticed: the entry is already gone from memory (it cannot rank), the
 // failure is counted, and the orphan sweep retries the file delete.
 invalidate(id){
  this.counters.invalidated++;
  try{this.index.remove(id);}catch(error){this.counters.invalidateErrors++;this.lastError=brief(error);this.sweepDue=true;}
 }
 failed(error){this.counters.errors++;this.lastError=brief(error);}
 // Shadow comparison: id lists only. Nothing about the query or the statements is kept.
 observe({lexical,semantic}){
  const s=this.shadow;s.compared++;s.lexicalRows+=lexical.length;
  if(!semantic){s.semanticUnavailable++;return;}
  s.semanticRows+=semantic.length;if(!semantic.length)s.semanticEmpty++;
  if(lexical[0]&&lexical[0]===semantic[0])s.sameTop1++;
  const a=new Set(lexical.slice(0,5)),b=new Set(semantic.slice(0,5)),union=new Set([...a,...b]);
  s.overlapAt5+=union.size?[...a].filter(x=>b.has(x)).length/union.size:1;
 }
 persist(){try{this.index.meta('shadow',{modelVersion:this.modelVersion,stats:this.shadow});}catch{}}
 status(){
  const s=this.shadow,answered=s.compared-s.semanticUnavailable;
  return {mode:this.mode,modelVersion:this.modelVersion,minScore:this.model.minScore,vectors:this.index.size,provider:this.provider.state?.()??'unknown',counters:{...this.counters},lastError:this.lastError??null,
   shadow:this.mode==='shadow'?{...s,meanOverlapAt5:answered?+(s.overlapAt5/answered).toFixed(3):null,meanLexicalRows:s.compared?+(s.lexicalRows/s.compared).toFixed(1):null,meanSemanticRows:answered?+(s.semanticRows/answered).toFixed(1):null}:undefined};
 }
}
