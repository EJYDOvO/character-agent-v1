// Embedding worker: a separate OS process, started by provider.mjs with the Host's own executable
// (ELECTRON_RUN_AS_NODE=1). It is the only place that loads onnxruntime and model weights, so their
// memory, CPU and any native crash stay outside the Host. It reads model files from a provisioned
// local directory only: no network access, no downloads, no Memory database.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';

const options=JSON.parse(process.env.DSH_SEMANTIC_WORKER??'{}');
const fail=message=>{process.send?.({type:'fatal',error:String(message).slice(0,300)});process.exit(1);};
process.on('disconnect',()=>process.exit(0));
process.on('uncaughtException',error=>fail(error?.message??error));

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
async function embed(texts,kind){
 const prefix=kind==='query'?options.model.queryPrefix:options.model.documentPrefix,out=[];
 for(let i=0;i<texts.length;i+=8){
  const tensor=await extractor(texts.slice(i,i+8).map(t=>prefix+t),{pooling:options.model.pooling,normalize:true});
  for(const row of tensor.tolist())out.push(Float32Array.from(row));
 }
 return out;
}
let queue=Promise.resolve();
process.on('message',message=>{
 if(message?.type!=='embed')return;
 queue=queue.then(async()=>{
  try{
   if(!Array.isArray(message.texts)||message.texts.length>64||message.texts.some(t=>typeof t!=='string'||t.length>8000)||!['query','document'].includes(message.kind))throw Error('Invalid request');
   process.send({type:'result',id:message.id,vectors:await embed(message.texts,message.kind)});
  }catch(error){process.send({type:'result',id:message.id,error:String(error?.message??error).slice(0,300)});}
 });
});
const started=performance.now();
load().then(()=>process.send({type:'ready',loadMs:Math.round(performance.now()-started)})).catch(error=>fail(error?.message??error));
