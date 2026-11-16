// Pinned model registry. `revision` pins the exact Hugging Face commit used in the recorded runs.
// Query/document formatting follows each upstream model card (see TECH_AUDIT.md §2.4).
const QWEN_TASK='Given a user message or a search query, retrieve the long-term memory records that are relevant to it';
export const MODELS={
 'qwen3-0.6b':{repo:'onnx-community/Qwen3-Embedding-0.6B-ONNX',revision:'c25a394dd583836952667c12f008335071b3f43d',upstream:'Qwen/Qwen3-Embedding-0.6B',dim:1024,pooling:'last_token',
  query:q=>`Instruct: ${QWEN_TASK}\nQuery:${q}`,doc:d=>d},
 'bge-m3':{repo:'Xenova/bge-m3',revision:'4de13258303883538bd53b696b452bf8099f0858',upstream:'BAAI/bge-m3',dim:1024,pooling:'cls',query:q=>q,doc:d=>d},
 'me5-small':{repo:'Xenova/multilingual-e5-small',revision:'761b726dd34fb83930e26aab4e9ac3899aa1fa78',upstream:'intfloat/multilingual-e5-small',dim:384,pooling:'mean',
  query:q=>'query: '+q,doc:d=>'passage: '+d},
 'embeddinggemma':{repo:'onnx-community/embeddinggemma-300m-ONNX',revision:'5090578d9565bb06545b4552f76e6bc2c93e4a66',upstream:'google/embeddinggemma-300m',dim:768,pooling:'sentence_embedding',
  query:q=>'task: search result | query: '+q,doc:d=>'title: none | text: '+d},
};
export const RERANKERS={
 'bge-reranker-v2-m3':{repo:'onnx-community/bge-reranker-v2-m3-ONNX',revision:'6f5ff65298512715a1e669753bc754d2bc8f367b',upstream:'BAAI/bge-reranker-v2-m3'},
};
export const modelVersion=(name,dtype)=>{const m=MODELS[name]??RERANKERS[name];if(!m)throw Error('Unknown model '+name);return `${m.repo}@${m.revision.slice(0,12)}:${dtype}`;};
