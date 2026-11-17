#!/usr/bin/env node
// Operator tool, run by hand before enabling semantic recall. The plugin itself never downloads or
// installs anything. It prepares two directories outside the plugin package:
//   --runtime-dir  pinned @huggingface/transformers (+ onnxruntime-node) installed with npm
//   --model-dir    the pinned model files, each verified against the sha256 in models.mjs
// Usage:
//   node provision.mjs --runtime-dir <abs> --model-dir <abs> [--model bge-m3-q8] [--from <local copy>] [--skip-runtime]
// --from copies already downloaded files (same relative names) instead of fetching them; hashes are
// checked either way.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';
import {MODELS,RUNTIME,MANIFEST} from './models.mjs';

const args=process.argv.slice(2),value=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const runtimeDir=value('runtime-dir'),modelDir=value('model-dir'),id=value('model')??'bge-m3-q8',from=value('from'),model=MODELS[id];
if(!runtimeDir||!modelDir||!path.isAbsolute(runtimeDir)||!path.isAbsolute(modelDir)||!model){console.error('usage: node provision.mjs --runtime-dir <abs> --model-dir <abs> [--model '+Object.keys(MODELS).join('|')+'] [--from <dir>] [--skip-runtime]');process.exit(2);}
const sha256=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};

if(!args.includes('--skip-runtime')){
 fs.mkdirSync(runtimeDir,{recursive:true});
 fs.writeFileSync(path.join(runtimeDir,'package.json'),JSON.stringify({name:'dsh-memory-semantic-runtime',private:true,type:'module',dependencies:{[RUNTIME.package]:RUNTIME.version}},null,2)+'\n');
 console.log(`Installing ${RUNTIME.package}@${RUNTIME.version} into ${runtimeDir}`);
 execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--omit=dev','--no-audit','--no-fund'],{cwd:runtimeDir,stdio:'inherit',shell:process.platform==='win32'});
}
const target=path.join(modelDir,...model.repo.split('/'));
for(const [name,expected]of Object.entries(model.files)){
 const file=path.join(target,name);fs.mkdirSync(path.dirname(file),{recursive:true});
 if(!(fs.existsSync(file)&&fs.statSync(file).size===expected.size&&await sha256(file)===expected.sha256)){
  if(from){fs.copyFileSync(path.join(from,name),file);}
  else{
   const url=`https://huggingface.co/${model.repo}/resolve/${model.revision}/${name}`;console.log('Downloading '+url+' ('+expected.size+' bytes)');
   const response=await fetch(url);if(!response.ok||!response.body)throw Error('Download failed: HTTP '+response.status);
   await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(file+'.partial'));fs.renameSync(file+'.partial',file);
  }
  const actual=await sha256(file);
  if(actual!==expected.sha256){fs.rmSync(file,{force:true});throw Error(`Hash mismatch for ${name}: got ${actual}`);}
 }
 console.log('verified '+name);
}
fs.writeFileSync(path.join(target,MANIFEST),JSON.stringify({id,repo:model.repo,revision:model.revision,dtype:model.dtype,upstream:model.upstream,license:model.license,files:model.files},null,1)+'\n');
console.log(JSON.stringify({provisioned:id,runtimeDir,modelDir}));
