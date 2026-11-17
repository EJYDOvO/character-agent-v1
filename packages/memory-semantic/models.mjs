import {createHash} from 'node:crypto';

// Pinned embedding models. embeddingModelVersion (see modelVersion below) covers everything that
// changes the numbers in a vector: repo, full revision, quantisation, pooling, both prefixes,
// dimension, the inference runtime version and which provider produced it. Changing any of them
// makes every stored vector stale, so the index is rebuilt instead of mixing vector spaces.
// minScore is the similarity floor measured for exactly this model and quantisation
// (PR #26, development split). It must be re-calibrated for any other model.
export const MODELS={
 'bge-m3-q8':{
  repo:'Xenova/bge-m3',revision:'4de13258303883538bd53b696b452bf8099f0858',upstream:'BAAI/bge-m3',license:'MIT',
  dtype:'q8',dim:1024,pooling:'cls',queryPrefix:'',documentPrefix:'',minScore:0.469,
  files:{
   'config.json':{size:770,sha256:'734a79bf12d388c1467a4e3ab625f45de7f6906cffcfb93a1eca1787504bed95'},
   'tokenizer.json':{size:17082821,sha256:'6710678b12670bc442b99edc952c4d996ae309a7020c1fa0096dd245c2faf790'},
   'tokenizer_config.json':{size:1173,sha256:'7e4c1cc848840aeccdd763458c18dd525eb0f795c992e00ebe9c28554e7db2d4'},
   'onnx/model_quantized.onnx':{size:569694530,sha256:'0826f8c1ab9edf1801db86c61919d4d108e8bfc0b809ec823ad366882ff0b77d'},
  },
 },
};
export const RUNTIME={package:'@huggingface/transformers',version:'4.3.2'};
export function modelVersion(model,producer){
 const recipe={revision:model.revision,pooling:model.pooling,queryPrefix:model.queryPrefix??'',documentPrefix:model.documentPrefix??'',dim:model.dim,normalize:true,producer};
 return `${model.repo}@${model.revision.slice(0,12)}:${model.dtype}#${createHash('sha256').update(JSON.stringify(recipe)).digest('hex').slice(0,12)}`;
}
export const MANIFEST='dsh-model.json';

export function resolveModel(config={}){
 const base=MODELS[config.model??'bge-m3-q8'];
 if(!base&&!(config.repo&&config.revision&&config.dtype&&config.dim&&config.pooling&&Number.isFinite(config.minScore)))throw Error('Unknown embedding model: give a known id, or repo, revision, dtype, dim, pooling and minScore');
 const model={...base,...Object.fromEntries(['repo','revision','dtype','dim','pooling','queryPrefix','documentPrefix','minScore'].filter(k=>config[k]!==undefined).map(k=>[k,config[k]]))};
 if(!/^[\w.-]+\/[\w.-]+$/.test(model.repo)||!/^[0-9a-f]{40}$/.test(model.revision))throw Error('Embedding model must be pinned to a repo and a full commit');
 if(!Number.isInteger(model.dim)||model.dim<8||model.dim>4096||!(model.minScore>=-1&&model.minScore<=1))throw Error('Invalid embedding model settings');
 if(typeof model.pooling!=='string'||!model.pooling||typeof (model.queryPrefix??'')!=='string'||typeof (model.documentPrefix??'')!=='string')throw Error('Invalid embedding model settings');
 return model;
}
