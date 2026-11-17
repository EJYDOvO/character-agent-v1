// Query/document term builders for the FTS variants (arms A+, B, F1). The baseline arm does not use this
// file: it goes through recallTerms() in the Memory Core.
import fs from 'node:fs';import {fileURLToPath} from 'node:url';
import {normalize,tokens} from './fts.mjs';

const CJK=/[㐀-䶿一-鿿豈-﫿぀-ゟ゠-ヿ]/,LATIN=/[a-z0-9_]/;
function runs(text){
 const chars=Array.from(normalize(text)),out=[];let i=0;
 while(i<chars.length){
  const kind=LATIN.test(chars[i])?'latin':CJK.test(chars[i])?'cjk':null;if(!kind){i++;continue;}
  let j=i+1;while(j<chars.length&&(kind==='latin'?LATIN:CJK).test(chars[j]))j++;
  out.push({kind,chars:chars.slice(i,j)});i=j;
 }
 return out;
}

// A+ (a): same token vocabulary as production, but the 64-term cap keeps the selective terms.
// Production emits, per CJK run, all unigrams and then all bigrams, so a long sentence spends the cap
// on single characters. Here whole Latin words and CJK bigrams come first; unigrams fill what is left.
export function reorderedTerms(query,{unigrams=true,cap=64}={}){
 const primary=[],secondary=[];
 for(const run of runs(query)){
  if(run.kind==='latin'){primary.push(run.chars.join(''));continue;}
  if(run.chars.length===1){primary.push(run.chars[0]);continue;}
  for(let k=0;k+1<run.chars.length;k++)primary.push(run.chars[k]+run.chars[k+1]);
  secondary.push(...run.chars);
 }
 return [...new Set([...primary,...(unigrams?secondary:[])])].slice(0,cap);
}

// A+ (c): dictionary word segmentation from the ICU data that ships with Node (no native extension),
// CJK unigrams as a fallback, and a light English stemmer. Needs its own (shadow) index.
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
export function stem(word){
 let w=word;if(w.length<4||/\d/.test(w))return w;
 if(w.endsWith('ies')&&w.length>4)w=w.slice(0,-3)+'y';
 else if(w.endsWith('sses'))w=w.slice(0,-2);
 else if(w.endsWith('s')&&!/(ss|us|is)$/.test(w))w=w.slice(0,-1);
 const strip=n=>{let s=w.slice(0,-n);if(/([b-df-hj-np-tv-z])\1$/.test(s)&&!/(ll|ss|zz)$/.test(s))s=s.slice(0,-1);return s;};
 if(w.endsWith('ing')&&w.length>5)w=strip(3);else if(w.endsWith('ed')&&w.length>4)w=strip(2);
 if(w.endsWith('e')&&w.length>4)w=w.slice(0,-1);
 return w;
}
export function segmentedTokens(text,{cap=Infinity}={}){
 const words=[],singles=[];
 for(const part of segmenter.segment(normalize(text))){
  if(!part.isWordLike)continue;const s=part.segment;
  if(/^[a-z0-9_]+$/.test(s)){words.push(s,stem(s));continue;}
  const cjk=Array.from(s).filter(c=>CJK.test(c));if(!cjk.length)continue;
  words.push(cjk.join(''));if(cjk.length>1)singles.push(...cjk);
 }
 return [...new Set([...words,...singles])].slice(0,cap);
}

// B1: reproducible lexicon expansion. dataset/lexicon.json holds groups of interchangeable terms;
// when any member of a group occurs in the query, the other members are added as search terms.
let lexiconCache;
export function loadLexicon(){
 if(lexiconCache===undefined){const file=fileURLToPath(new URL('../../dataset/lexicon.json',import.meta.url));lexiconCache=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
 return lexiconCache;
}
const occurs=(haystack,term)=>{const t=normalize(term);if(!t)return false;if(/^[a-z0-9_ .+#-]+$/.test(t))return new RegExp('(^|[^a-z0-9_])'+t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9_])').test(haystack);return haystack.includes(t);};
export function lexiconExpansion(query){
 const lexicon=loadLexicon();if(!lexicon)return {phrases:[],groups:0};
 const text=normalize(query),phrases=[];let groups=0;
 for(const group of lexicon.groups){const hit=group.terms.filter(t=>occurs(text,t));if(!hit.length)continue;groups++;for(const t of group.terms)if(!hit.includes(t))phrases.push(t);}
 return {phrases:[...new Set(phrases)],groups};
}

// Expansion phrases -> FTS terms that are not already in the base term list.
export function expansionTerms(baseTerms,phrases,{cap=64}={}){
 const have=new Set(baseTerms),extra=[];
 for(const phrase of phrases)for(const t of reorderedTerms(phrase,{unigrams:false,cap:Infinity}))if(!have.has(t)){have.add(t);extra.push(t);}
 return extra.slice(0,cap);
}
export {tokens};
