// Cache of *real* cross-encoder scores keyed by (query, document). The model is loaded lazily and only
// when a pair is missing; there is no synthetic scoring path.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {cacheRoot} from './embed-cache.mjs';
import {modelVersion} from '../embed/models.mjs';
import {createReranker} from '../embed/transformers-provider.mjs';

export class RerankCache{
 #model;
 constructor(name,dtype){
  this.name=name;this.dtype=dtype;this.modelVersion=modelVersion(name,dtype);this.file=path.join(cacheRoot,'rerank',`${name}.${dtype}.json`);this.map=new Map();this.dirty=false;this.timings=[];
  if(fs.existsSync(this.file)){const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(saved.modelVersion===this.modelVersion)this.map=new Map(Object.entries(saved.scores));}
 }
 async scores(query,docs){
  const keys=docs.map(d=>createHash('sha256').update(query+'\n'+d).digest('hex')),missing=docs.filter((_,i)=>!this.map.has(keys[i]));
  if(missing.length){
   this.#model??=await createReranker(this.name,{dtype:this.dtype});
   const started=performance.now(),scored=await this.#model.score(query,missing);this.timings.push({pairs:missing.length,ms:performance.now()-started});
   let j=0;docs.forEach((d,i)=>{if(!this.map.has(keys[i]))this.map.set(keys[i],scored[j++]);});this.dirty=true;
  }
  return keys.map(k=>this.map.get(k));
 }
 save(){if(!this.dirty)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file,JSON.stringify({modelVersion:this.modelVersion,scores:Object.fromEntries(this.map)}));this.dirty=false;}
}
