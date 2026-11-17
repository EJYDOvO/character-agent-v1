// Text-keyed cache of *real* model embeddings (see src/embed/transformers-provider.mjs).
// The cache only avoids recomputation between runs; it is never populated by anything but the model.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {modelVersion} from '../embed/models.mjs';

export const cacheRoot=process.env.RETRIEVAL_D_CACHE??fileURLToPath(new URL('../../.cache/',import.meta.url));
const key=(kind,text)=>createHash('sha256').update(kind+'\n'+text).digest('hex');
const fileOf=(name,dtype)=>path.join(cacheRoot,'embeddings',`${name}.${dtype}.json`);

export class EmbeddingCache{
 constructor(name,dtype){
  this.name=name;this.dtype=dtype;this.modelVersion=modelVersion(name,dtype);this.file=fileOf(name,dtype);this.map=new Map();this.dirty=false;
  if(fs.existsSync(this.file)){
   const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
   if(saved.modelVersion===this.modelVersion)for(const [k,b64]of Object.entries(saved.vectors)){const buf=Buffer.from(b64,'base64');this.map.set(k,new Float32Array(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)));}
  }
 }
 has(kind,text){return this.map.has(key(kind,text));}
 get(kind,text){const v=this.map.get(key(kind,text));if(!v)throw Error(`No cached ${this.modelVersion} embedding for ${kind}: ${text.slice(0,40)} — run "npm run embed" first`);return v;}
 set(kind,text,vector){this.map.set(key(kind,text),vector);this.dirty=true;}
 save(){
  if(!this.dirty)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});
  const vectors={};for(const [k,v]of this.map)vectors[k]=Buffer.from(v.buffer,v.byteOffset,v.byteLength).toString('base64');
  fs.writeFileSync(this.file,JSON.stringify({modelVersion:this.modelVersion,vectors}));this.dirty=false;
 }
}
