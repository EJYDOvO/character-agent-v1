// Real local embedding provider (transformers.js + onnxruntime-node, CPU). No mock path exists.
import os from 'node:os';import path from 'node:path';
import {MODELS,RERANKERS,modelVersion} from './models.mjs';
export const cacheDir=process.env.RETRIEVAL_D_MODEL_CACHE??path.join(os.homedir(),'.cache','dsh-retrieval-d','models');
let tf;
async function lib(){if(!tf){tf=await import('@huggingface/transformers');tf.env.cacheDir=cacheDir;tf.env.allowLocalModels=false;if(process.env.RETRIEVAL_D_OFFLINE==='1')tf.env.allowRemoteModels=false;}return tf;}
export async function createEmbedder(name,{dtype='fp32',batchSize=8}={}){
 const spec=MODELS[name];if(!spec)throw Error('Unknown embedding model '+name);
 const {pipeline,AutoModel,AutoTokenizer}=await lib(),started=performance.now();
 let run;
 if(spec.pooling==='sentence_embedding'){
  const tokenizer=await AutoTokenizer.from_pretrained(spec.repo,{revision:spec.revision}),model=await AutoModel.from_pretrained(spec.repo,{revision:spec.revision,dtype});
  run=async texts=>{const inputs=await tokenizer(texts,{padding:true,truncation:true});const {sentence_embedding}=await model(inputs);return sentence_embedding.tolist();};
 }else{
  const extractor=await pipeline('feature-extraction',spec.repo,{revision:spec.revision,dtype});
  run=async texts=>(await extractor(texts,{pooling:spec.pooling,normalize:true})).tolist();
 }
 const loadMs=performance.now()-started;
 async function embed(texts,kind){
  if(kind!=='query'&&kind!=='doc')throw Error('kind must be query|doc');
  const out=[];for(let i=0;i<texts.length;i+=batchSize){const rows=await run(texts.slice(i,i+batchSize).map(spec[kind]));for(const r of rows){const v=Float32Array.from(r);let n=0;for(const x of v)n+=x*x;n=Math.sqrt(n)||1;for(let j=0;j<v.length;j++)v[j]/=n;out.push(v);}}
  return out;
 }
 return {name,dtype,dim:spec.dim,modelVersion:modelVersion(name,dtype),loadMs,embed};
}
export async function createReranker(name,{dtype='q8'}={}){
 const spec=RERANKERS[name];if(!spec)throw Error('Unknown reranker '+name);
 const {AutoTokenizer,AutoModelForSequenceClassification}=await lib(),started=performance.now();
 const tokenizer=await AutoTokenizer.from_pretrained(spec.repo,{revision:spec.revision}),model=await AutoModelForSequenceClassification.from_pretrained(spec.repo,{revision:spec.revision,dtype});
 const loadMs=performance.now()-started;
 async function score(query,docs,batchSize=8){
  const out=[];for(let i=0;i<docs.length;i+=batchSize){const part=docs.slice(i,i+batchSize);const inputs=tokenizer(new Array(part.length).fill(query),{text_pair:part,padding:true,truncation:true,max_length:512});const {logits}=await model(inputs);out.push(...logits.tolist().map(r=>r[0]));}
  return out;
 }
 return {name,dtype,modelVersion:modelVersion(name,dtype),loadMs,score};
}
