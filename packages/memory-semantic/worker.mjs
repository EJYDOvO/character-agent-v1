// Embedding worker: a separate OS process, started by provider.mjs with the Host's own executable
// (ELECTRON_RUN_AS_NODE=1). It is the only place that loads onnxruntime and model weights, so their
// memory, CPU and any native crash stay outside the Host. It reads model files from a provisioned
// local directory only: no network access, no downloads, no Memory database.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';

const options=JSON.parse(process.env.DSH_SEMANTIC_WORKER??'{}');
const usage=()=>{const cpu=process.cpuUsage();return {rssMB:Math.round(process.memoryUsage().rss/1048576),cpuMs:Math.round((cpu.user+cpu.system)/1000)};};
const fail=message=>{try{process.send?.({type:'fatal',error:String(message).slice(0,300)});}catch{}process.exit(1);};
process.on('disconnect',()=>process.exit(0));
process.on('uncaughtException',error=>fail(error?.message??error));
process.on('unhandledRejection',error=>fail(error?.message??error));

let extractor;
async function load(){
 const {runtimeDir,modelDir,model,threads,verifyHash,manifestName}=options;
 const directory=path.join(modelDir,...model.repo.split('/')),manifest=JSON.parse(fs.readFileSync(path.join(directory,manifestName),'utf8'));
 if(manifest.repo!==model.repo||manifest.revision!==model.revision||manifest.dtype!==model.dtype)throw Error('Provisioned model does not match the configured repo/revision/dtype');
 for(const [name,expected]of Object.entries(manifest.files)){
  const file=path.join(directory,name);if(fs.statSync(file).size!==expected.size)throw Error('Model file size mismatch: '+name);
  if(verifyHash){const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);if(hash.digest('hex')!==expected.sha256)throw Error('Model file hash mismatch: '+name);}
 }
 const entry=createRequire(path.join(runtimeDir,'package.json')).resolve('@huggingface/transformers');
 const tf=await import(pathToFileURL(entry).href);
 tf.env.allowRemoteModels=false;tf.env.allowLocalModels=true;tf.env.localModelPath=modelDir;tf.env.useFSCache=false;tf.env.useBrowserCache=false;
 extractor=await tf.pipeline('feature-extraction',model.repo,{dtype:model.dtype,local_files_only:true,...(threads>0?{session_options:{intraOpNumThreads:threads,interOpNumThreads:1}}:{})});
}
// Two queues. A query embedding (someone is waiting for a turn) always runs before the next document
// of an indexing batch. Documents are encoded one at a time: a query then waits for at most one
// document, and a vector never depends on which other texts happened to share its padded batch
// (measured on CPU, batching did not make indexing faster).
const SLICE=1,queries=[],documents=[];let running=false;
async function run(texts,kind){
 const prefix=kind==='query'?options.model.queryPrefix:options.model.documentPrefix;
 const tensor=await extractor(texts.map(t=>prefix+t),{pooling:options.model.pooling,normalize:true});
 return tensor.tolist().map(row=>Float32Array.from(row));
}
async function pump(){
 if(running)return;running=true;
 try{
  for(;;){
   const job=queries.shift()??documents[0];if(!job)break;
   try{
    if(job.kind==='query'){job.vectors.push(...await run(job.texts,'query'));job.done=job.texts.length;}
    else{job.vectors.push(...await run(job.texts.slice(job.done,job.done+SLICE),'document'));job.done=Math.min(job.texts.length,job.done+SLICE);}
    if(job.done>=job.texts.length){if(job.kind!=='query')documents.shift();process.send({type:'result',id:job.id,vectors:job.vectors,...usage()});}
   }catch(error){if(job.kind!=='query')documents.shift();process.send({type:'result',id:job.id,error:String(error?.message??error).slice(0,300),...usage()});}
  }
 }finally{running=false;}
}
process.on('message',message=>{
 if(message?.type!=='embed')return;
 if(!Array.isArray(message.texts)||!message.texts.length||message.texts.length>64||message.texts.some(t=>typeof t!=='string'||t.length>8000)||!['query','document'].includes(message.kind)){process.send({type:'result',id:message.id,error:'Invalid request'});return;}
 (message.kind==='query'?queries:documents).push({id:message.id,kind:message.kind,texts:message.texts,vectors:[],done:0});void pump();
});
const started=performance.now();
load().then(()=>process.send({type:'ready',loadMs:Math.round(performance.now()-started),...usage()})).catch(error=>fail(error?.message??error));
