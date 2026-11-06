import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export const corpus=JSON.parse(fs.readFileSync(new URL('./cases.json',import.meta.url)));
export const digest=createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const ratio=(a,b)=>b?a/b:null;
// Alignments and semantic judgments are supplied by an independent reviewer,
// not inferred from exact wording or from the model's own confidence field.
export function score(run){
 assert.equal(run.datasetDigest,digest);assert(['dev','held'].includes(run.split));
 assert.equal(run.targetHost,'0.2.2-rc.1');assert(['recorded-model','deterministic-fixture'].includes(run.kind));
 const cases=corpus.cases.filter(c=>c.split===run.split);assert.equal(run.results.length,cases.length);
 assert.equal(new Set(run.results.map(r=>r.id)).size,cases.length);
 let tp=0,fp=0,expected=0,inferred=0,duplicates=0,total=0,sourceOK=0,conflicts=0,conflictTotal=0,tokens=0,usageKnown=true;
 for(const c of cases){
  const r=run.results.find(r=>r.id===c.id);assert(r,'Missing case');assert(Array.isArray(r.predictions));assert.equal(r.review?.independent,true);
  assert.equal(typeof r.review.conflictDetected,'boolean');
  const seen=new Set();expected+=c.rubric.facts.length;
  for(const p of r.predictions){
   assert.equal(typeof p.unsupported,'boolean');assert.equal(typeof p.meaningPreserved,'boolean');assert(Array.isArray(p.sources));
   total++;const aligned=c.rubric.facts.some(f=>f.id===p.factId)&&p.meaningPreserved&&!p.unsupported;
   if(aligned&&!seen.has(p.factId))tp++;else fp++;
   if(seen.has(p.factId)&&p.factId)duplicates++;if(p.factId)seen.add(p.factId);
   inferred+=Number(p.unsupported);
   if(p.sources.length&&p.sources.every(s=>c.events.some(e=>e.id===s.eventId&&typeof s.quote==='string'&&s.quote.trim()&&e.text.includes(s.quote))))sourceOK++;
  }
  if(c.rubric.conflictExpected){conflictTotal++;conflicts+=Number(r.review.conflictDetected);}
  if(r.usage?.provenance==='provider'&&Number.isSafeInteger(r.usage.inputTokens)&&r.usage.inputTokens>=0&&Number.isSafeInteger(r.usage.outputTokens)&&r.usage.outputTokens>=0)tokens+=r.usage.inputTokens+r.usage.outputTokens;else usageKnown=false;
 }
 return {kind:run.kind,realModelQualityValidated:false,split:run.split,cases:cases.length,precision:ratio(tp,tp+fp),recall:ratio(tp,expected),unsupportedInferenceRate:ratio(inferred,total),duplicateRate:ratio(duplicates,total),sourceCorrectness:ratio(sourceOK,total),conflictRecall:ratio(conflicts,conflictTotal),tokens:usageKnown?tokens:null,usageComplete:usageKnown};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){console.log(JSON.stringify(process.argv[2]?score(JSON.parse(fs.readFileSync(process.argv[2]))):{datasetDigest:digest,cases:corpus.cases.length,realModelQualityValidated:false,reason:'No recorded model run; semantic judgments and provider usage required'},null,2));}
