import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {corpus,digest,compare} from '../evaluation/worker-v1/score.mjs';
import {prepare} from '../evaluation/worker-v1/prepare.mjs';
const run=split=>({datasetDigest:digest,targetHost:'0.2.2-rc.1',kind:'deterministic-fixture',split,model:'same-synthetic-model',settingsDigest:'1111111111111111111111111111111111111111111111111111111111111111',results:corpus.cases.filter(c=>c.split===split).flatMap(c=>['direct','policy','control'].map(mode=>({id:c.id,mode,model:'same-synthetic-model',settingsDigest:'1111111111111111111111111111111111111111111111111111111111111111',inputDigest:createHash('sha256').update(JSON.stringify(c.input)).digest('hex'),budget:c.budget,permissions:c.permissions,workers:mode==='control'?c.rubric.referencePlan:[],tools:[],verifications:mode==='control'?c.rubric.referencePlan.map((_,workerIndex)=>({workerIndex,evidenceRefs:['fixture:1']})):[],elapsedMs:10,status:c.rubric.successStatus,review:{independent:true,correct:true,failureReported:true}})))});
test('frozen bilingual split and paired three-condition accounting (not model quality)',()=>{
 assert.equal(digest,'229d889db7b717785126197cb21220827445451d775ce8e3c063d6b969a0a681');
 for(const split of ['dev','held']){const r=compare(run(split));assert.equal(r.realModelQualityValidated,false);for(const m of Object.values(r.summary)){assert.equal(m.successRate,1);assert.equal(m.tokens,null);assert.equal(m.peakRssBytes,null);}assert.equal(r.summary.control.rootVerificationCoverage,1);}
});
test('paired comparisons refuse budget, model, permission, input drift and incomplete traces',()=>{
 for(const field of ['model','settingsDigest','inputDigest','permissions','budget']){const r=run('held');r.results[0][field]=field==='permissions'?[]:field==='budget'?{}:'different';assert.throws(()=>compare(r),field);}
 const missing=run('dev');missing.results.pop();assert.throws(()=>compare(missing));
 const over=run('held');over.results[0].usage={provenance:'provider',totalTokens:999999};assert.throws(()=>compare(over));
});
test('unsupported success, absent root verification and ineffective tools remain visible',()=>{
 const r=run('held');const item=r.results.find(x=>x.mode==='control'&&x.workers.length);item.review.correct=false;item.verifications=[];item.tools=[{id:'tool:1',status:'error',reviewedEffective:false}];
 const m=compare(r).summary.control;assert(m.successRate<1&&m.rootVerificationCoverage<1);assert.equal(m.effectiveToolRate,0);
});
test('only control inputs receive the reference plan; all modes share inputs and budgets',()=>{
 for(const split of ['dev','held']){const a=prepare(split,'direct'),b=prepare(split,'policy'),c=prepare(split,'control');assert.equal(a.policyDigest,b.policyDigest);assert.equal(b.policyDigest,c.policyDigest);for(let i=0;i<a.cases.length;i++){assert(!('referencePlan'in a.cases[i]));assert(!('referencePlan'in b.cases[i]));assert(!('rubric'in c.cases[i]));assert.deepEqual(a.cases[i].input,b.cases[i].input);assert.deepEqual(a.cases[i].budget,c.cases[i].budget);}}
});
