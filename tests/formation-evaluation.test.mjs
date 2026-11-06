import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {corpus,digest,score} from '../evaluation/memory-v1/score.mjs';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
import {processJob} from '../packages/character-memory-core/extraction.mjs';
import {prepare} from '../evaluation/memory-v1/prepare.mjs';
const run=split=>({datasetDigest:digest,targetHost:'0.2.2-rc.1',kind:'deterministic-fixture',split,results:corpus.cases.filter(c=>c.split===split).map(c=>({id:c.id,predictions:c.rubric.facts.map(f=>({factId:f.id,meaningPreserved:true,unsupported:false,sources:[{eventId:c.events[0].id,quote:c.events[0].text}]})),review:{independent:true,conflictDetected:c.rubric.conflictExpected}}))});
test('frozen bilingual development/held formation corpus and scorer arithmetic',()=>{
 assert.equal(digest,'77be8953c01d6bb2c8572392085d6d8622484837c8d1c08b6711fe0b7f070b03');
 for(const split of ['dev','held']){const r=run(split),m=score(r);assert.equal(m.precision,1);assert.equal(m.recall,1);assert.equal(m.sourceCorrectness,1);assert.equal(m.tokens,null);assert.equal(m.realModelQualityValidated,false);
 const p=r.results.find(r=>r.predictions.length).predictions;p.push({...p[0],unsupported:true,sources:[{eventId:'forged',quote:'nonexistent'}]});const bad=score(r);assert(bad.precision<1&&bad.sourceCorrectness<1&&bad.unsupportedInferenceRate>0&&bad.duplicateRate>0);}
});
test('missing cases, changed corpus and self-reviewed predictions cannot silently score',()=>{
 const r=run('dev');r.results.pop();assert.throws(()=>score(r));
 const other=run('held');other.datasetDigest='changed';assert.throws(()=>score(other));
 const self=run('dev');self.results[0].review.independent=false;assert.throws(()=>score(self));
 const positives=run('held');for(const r of positives.results)r.review.conflictDetected=true;assert(score(positives).conflictAccuracy<1&&score(positives).conflictPrecision<1,'always predicting conflict must not look perfect');
});
test('model inputs exclude semantic answer rubrics and use current runtime prompts',()=>{for(const split of ['dev','held']){const p=prepare(split);assert.equal(p.cases.length,8);assert(!JSON.stringify(p.cases).includes('rubric'));assert(p.prompts.extraction.includes('quote'));assert.equal(p.networkCalls,0);}});
for(const split of ['dev','held'])test('actual Memory core provenance/CAS/forget replay on '+split+' (not a semantic-model test)',()=>{
 return (async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'formation-contract-'));try{for(const c of corpus.cases.filter(c=>c.split===split)){
  const handles=new Map(c.events.map(e=>[e.session,Object.freeze({sessionId:e.session})]));const allowed=new Set(handles.values());
  const file=path.join(dir,c.id+'.sqlite'),authorize=h=>{assert(allowed.has(h),'Unauthorized');return {principalId:'synthetic',namespaceId:'memory',projectId:c.id,agentId:'agent',memoryMode:c.mode};};
  let store=new LayeredMemory(file,authorize);
  try{for(const [n,e]of c.events.entries()){
   const h=handles.get(e.session),source={sessionId:e.session,eventSeq:n+1,messageId:e.id,origin:e.origin,text:e.text};store.enqueue(h,source);
   const job=store.db.prepare('SELECT * FROM extraction_jobs WHERE session=?').get(e.session);
   await processJob(store,{forSession:id=>handles.get(id)},job,async()=>JSON.stringify({memories:[{kind:'semantic',statement:e.text,quote:e.text}]}));
  }
  const current=[...handles.values()].at(-1),rows=store.recall(current,'',16000);assert(rows.length);
  for(const row of rows){assert.equal(row.status,'uncertain');assert.equal(JSON.parse(row.source).origin,'inference');assert.equal(store.trace(current,row.id).evidence.length,1);}
  assert.equal(store.projection(current).refs.length,0);assert.throws(()=>store.recall({...current}));
  const input=store.consolidationInput(current),purpose=c.distribution==='self'?'self':c.distribution==='relationship'?'relationship':'general';
  const consolidated=store.applyConsolidation(current,input,{memories:[{purpose,kind:'semantic',statement:'Synthetic consolidation fixture: '+c.events.map(e=>e.text).join(' '),evidence:input.events.map(e=>({id:e.id,quote:e.text}))}]});
  assert.equal(consolidated.saved,purpose==='self'?0:1,'User prose cannot supply a verified self task result');
  const old=rows[0];assert.throws(()=>store.correct(current,old.id,'new synthetic fact',0,{sessionId:current.sessionId,eventSeq:90,origin:'inference'}));
  store.forget(current,old.id,old.revision);assert(!store.recall(current,'',16000).some(r=>r.id===old.id));
  assert.equal(store.trace(current,old.id).valid,false);
  store.close();store=new LayeredMemory(file,authorize);assert(!store.recall(current,'',16000).some(r=>r.id===old.id),'Reopen must not resurrect forgotten records');
  }finally{store.close();}
 }}finally{fs.rmSync(dir,{recursive:true,force:true});}})();
});
