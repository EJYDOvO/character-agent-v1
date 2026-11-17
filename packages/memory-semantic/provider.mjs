// Embedding providers. The contract is one method and one identity:
//   embed(texts: string[], kind: 'query'|'document') -> Promise<Float32Array[]>
// Anything that implements it can replace the default without touching ranking or the index.
import {fork} from 'node:child_process';import path from 'node:path';import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {MANIFEST} from './models.mjs';

// Default: a child process running worker.mjs on the Host's own runtime. Started on first use,
// stopped after `idleUnloadMs` without requests (the model then costs no memory), restarted on demand.
export class SubprocessProvider{
 #child=null;#ready=null;#pending=new Map();#seq=0;#idle=null;#verified=false;#closed=false;#state='stopped';
 constructor({runtimeDir,modelDir,model,threads=4,idleUnloadMs=1800000,startTimeoutMs=60000,requestTimeoutMs=30000,execPath=process.execPath,worker=fileURLToPath(new URL('./worker.mjs',import.meta.url))}){
  for(const [name,dir]of [['runtimeDir',runtimeDir],['modelDir',modelDir]])if(typeof dir!=='string'||!path.isAbsolute(dir))throw Error(name+' must be an absolute path');
  if(!fs.existsSync(path.join(runtimeDir,'package.json')))throw Error('Embedding runtime is not provisioned: '+runtimeDir);
  if(!fs.existsSync(path.join(modelDir,...model.repo.split('/'),MANIFEST)))throw Error('Embedding model is not provisioned: '+model.repo);
  Object.assign(this,{runtimeDir,modelDir,model,threads,idleUnloadMs,startTimeoutMs,requestTimeoutMs,execPath,worker});
 }
 state(){return this.#state;}
 #start(){
  if(this.#ready)return this.#ready;
  this.#state='starting';
  const child=fork(this.worker,[],{execPath:this.execPath,serialization:'advanced',windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],
   // Minimal environment: the worker needs no Host credentials, proxy or Home.
   env:{ELECTRON_RUN_AS_NODE:'1',SystemRoot:process.env.SystemRoot??'',PATH:process.env.PATH??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',
    DSH_SEMANTIC_WORKER:JSON.stringify({runtimeDir:this.runtimeDir,modelDir:this.modelDir,threads:this.threads,verifyHash:!this.#verified,manifestName:MANIFEST,model:{repo:this.model.repo,revision:this.model.revision,dtype:this.model.dtype,pooling:this.model.pooling,queryPrefix:this.model.queryPrefix??'',documentPrefix:this.model.documentPrefix??''}})}});
  this.#child=child;
  const drop=reason=>{
   if(this.#child!==child)return;this.#child=null;this.#ready=null;this.#state=this.#closed?'closed':'stopped';clearTimeout(this.#idle);
   for(const [,p]of this.#pending){clearTimeout(p.timer);p.reject(Error(reason));}this.#pending.clear();
  };
  this.#ready=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(Error('Embedding worker start timeout'));try{child.kill();}catch{}},this.startTimeoutMs);
   child.on('message',m=>{
    if(m?.type==='ready'){clearTimeout(timer);this.#verified=true;this.#state='ready';this.loadMs=m.loadMs;resolve();}
    else if(m?.type==='fatal'){clearTimeout(timer);reject(Error('Embedding worker failed: '+m.error));}
    else if(m?.type==='result'){const p=this.#pending.get(m.id);if(!p)return;this.#pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.vectors);}
   });
   child.once('error',error=>{clearTimeout(timer);reject(error);drop('Embedding worker error');});
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Embedding worker exited'));drop('Embedding worker exited');});
  });
  this.#ready.catch(()=>{if(this.#child===child){try{child.kill();}catch{}drop('Embedding worker unavailable');}});
  return this.#ready;
 }
 #touch(){clearTimeout(this.#idle);if(this.idleUnloadMs>0){this.#idle=setTimeout(()=>{if(!this.#pending.size)this.stop();else this.#touch();},this.idleUnloadMs);this.#idle.unref?.();}}
 async embed(texts,kind){
  if(this.#closed)throw Error('Embedding provider closed');
  await this.#start();this.#touch();
  const child=this.#child,id=++this.#seq;if(!child)throw Error('Embedding worker unavailable');
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.#pending.delete(id);reject(Error('Embedding request timeout'));},this.requestTimeoutMs);
   this.#pending.set(id,{resolve,reject,timer});
   try{child.send({type:'embed',id,texts,kind});}catch(error){this.#pending.delete(id);clearTimeout(timer);reject(error);}
  });
 }
 stop(){const child=this.#child;if(child){try{child.disconnect();}catch{}try{child.kill();}catch{}}}
 close(){this.#closed=true;clearTimeout(this.#idle);this.stop();this.#state='closed';}
}

// Alternative: an OpenAI-compatible /v1/embeddings endpoint (a local Ollama or llama.cpp server).
// Sending memory text to another machine is a data-boundary decision, so only loopback addresses are
// accepted unless `allowRemote: true` is set explicitly.
export class HttpProvider{
 constructor({baseUrl,modelName,model,allowRemote=false,requestTimeoutMs=30000,headers={}}){
  const url=new URL(baseUrl);
  if(!['http:','https:'].includes(url.protocol))throw Error('Invalid embedding endpoint');
  if(!allowRemote&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Remote embedding endpoint requires allowRemote: true');
  if(typeof modelName!=='string'||!modelName)throw Error('modelName required');
  Object.assign(this,{endpoint:new URL('v1/embeddings',url.href.endsWith('/')?url.href:url.href+'/').href,modelName,model,requestTimeoutMs,headers});this.last='idle';
 }
 state(){return 'http:'+this.last;}
 async embed(texts,kind){
  const prefix=kind==='query'?this.model.queryPrefix??'':this.model.documentPrefix??'';
  try{
   const response=await fetch(this.endpoint,{method:'POST',headers:{'content-type':'application/json',...this.headers},body:JSON.stringify({model:this.modelName,input:texts.map(t=>prefix+t)}),signal:AbortSignal.timeout(this.requestTimeoutMs)});
   if(!response.ok)throw Error('Embedding endpoint HTTP '+response.status);
   const body=await response.json(),rows=[...(body.data??[])].sort((a,b)=>(a.index??0)-(b.index??0));
   if(rows.length!==texts.length)throw Error('Embedding endpoint returned a different number of vectors');
   this.last='ok';return rows.map(r=>Float32Array.from(r.embedding));
  }catch(error){this.last='error';throw error;}
 }
 close(){}
}

export function createProvider(config,model){
 const kind=config?.kind??'subprocess';
 if(kind==='subprocess')return new SubprocessProvider({...config,model});
 if(kind==='http')return new HttpProvider({...config,model});
 throw Error('Unknown embedding provider: '+kind);
}
