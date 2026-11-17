// Generates the cached model expansions. Deterministic settings (temperature 0, fixed seed); the raw
// model output is stored so that every experiment run is reproducible without the model.
//   node src/expand/generate.mjs query [model]     -> dataset/expansions/query.<model>.json
//   node src/expand/generate.mjs doc   [model]     -> dataset/expansions/doc.<model>.json
// The prompts never contain judgments, labels or any other query/record than the one being expanded.
import fs from 'node:fs';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {chatJson,modelInfo,OPTIONS} from './ollama.mjs';
import {memories,distractors} from '../../dataset/corpus.mjs';
import {queries} from '../../dataset/queries.mjs';

export const PROMPTS={
 query:`You prepare keyword search terms for a bilingual (Chinese and English) personal memory store.
The store holds short facts about one user and is searched by exact word overlap, so a fact written with different words or in the other language is missed.
Given one user message, output JSON {"terms": [...]} with at most 12 short search terms:
- synonyms and alternative everyday wordings of the key concepts in the message;
- the translation of each key concept into the other language (Chinese <-> English).
Rules: terms only, 1-4 words each, no sentences. Do not answer the message. Do not invent names, numbers, dates or facts. Do not repeat words that are already in the message.`,
 doc:`You write search aliases for one long-term memory record of a bilingual (Chinese and English) personal assistant.
The record will later be looked up by exact word overlap with a user's question, which may use different words or the other language.
Given the record, output JSON {"aliases": [...]} with at most 12 short aliases:
- synonyms and colloquial alternatives for the key concepts of the record;
- the translation of each key concept into the other language (Chinese <-> English);
- the kind of question the record answers, as 1-4 word topic phrases.
Rules: aliases only, 1-4 words each, no sentences. Do not add facts, names, numbers or dates that are not in the record. Do not repeat words that are already in the record.`,
};
const SCHEMA={query:{type:'object',properties:{terms:{type:'array',items:{type:'string'},maxItems:12}},required:['terms']},doc:{type:'object',properties:{aliases:{type:'array',items:{type:'string'},maxItems:12}},required:['aliases']}};
const sha=x=>createHash('sha256').update(x).digest('hex');
export const fileFor=(kind,model)=>fileURLToPath(new URL(`../../dataset/expansions/${kind}.${model.replaceAll(/[:/]/g,'-')}.json`,import.meta.url));
export function loadExpansions(kind,model='qwen2.5:7b'){const file=fileFor(kind,model);if(!fs.existsSync(file))throw Error('Missing '+file+' — run src/expand/generate.mjs '+kind);return JSON.parse(fs.readFileSync(file,'utf8'));}
const clean=list=>[...new Set((Array.isArray(list)?list:[]).filter(x=>typeof x==='string').map(x=>x.trim()).filter(x=>x&&x.length<=40))].slice(0,12);

if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const [kind,model='qwen2.5:7b']=process.argv.slice(2);if(!PROMPTS[kind])throw Error('usage: generate.mjs query|doc [model]');
 const file=fileFor(kind,model),info=await modelInfo(model);
 let saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 if(!saved||saved.model?.digest!==info.digest||saved.promptSha256!==sha(PROMPTS[kind]))saved={kind,model:info,options:OPTIONS,prompt:PROMPTS[kind],promptSha256:sha(PROMPTS[kind]),items:{}};
 // Records are keyed by the hash of their text: an expansion belongs to one exact content version.
 const inputs=kind==='query'?queries.map(q=>q.query):[...memories,...distractors(300)].filter(m=>!m[4]?.forget).flatMap(m=>m[4]?.was?[m[3],m[4].was]:[m[3]]);
 let done=0;const field=kind==='query'?'terms':'aliases';
 for(const text of [...new Set(inputs)]){
  const key=sha(text);if(saved.items[key])continue;
  const {value,stats}=await chatJson(model,PROMPTS[kind],text.slice(0,2000),SCHEMA[kind]);
  saved.items[key]={text:text.length>120?text.slice(0,120)+'…':text,[field]:clean(value[field]),stats};
  if(++done%20===0){fs.writeFileSync(file,JSON.stringify(saved,null,1)+'\n');console.log(kind,done,'new');}
 }
 const all=Object.values(saved.items).map(i=>i.stats),avg=k=>Math.round(all.reduce((n,s)=>n+(s[k]??0),0)/Math.max(1,all.length));
 saved.cost={items:all.length,meanWallMs:avg('wallMs'),meanPromptTokens:avg('promptTokens'),meanOutputTokens:avg('outputTokens'),note:'local GPU inference; latency is not representative of a hosted model'};
 fs.writeFileSync(file,JSON.stringify(saved,null,1)+'\n');console.log(kind,'done',JSON.stringify(saved.cost));
}
