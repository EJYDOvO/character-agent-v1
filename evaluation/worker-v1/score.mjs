import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {WALL_ABORT_GRACE_MS} from './budget.mjs';
export const corpus=JSON.parse(fs.readFileSync(new URL('./cases.json',import.meta.url)));
export const digest=createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),rate=(a,b)=>b?a/b:null;
// Offline evidence reader, never a Host permission/approval service.
export function compare(run){
 assert.equal(run.datasetDigest,digest);assert.equal(run.targetHost,'0.2.2-rc.1');assert(['dev','held'].includes(run.split));assert(['recorded-model','deterministic-fixture'].includes(run.kind));
 assert(typeof run.model==='string'&&run.model.length>0);assert(/^[a-f0-9]{64}$/.test(run.settingsDigest));
 const cases=corpus.cases.filter(c=>c.split===run.split);assert.equal(run.results.length,cases.length*3);
 const summary={};
 for(const mode of ['direct','policy','control']){
  let success=0,unnecessary=0,selection=0,calls=0,effective=0,verified=0,workerResults=0,tokens=0,known=true,failuresReported=0,falseFailures=0,terminations=0;const times=[],rss=[];
  for(const c of cases){
   const rows=run.results.filter(r=>r.id===c.id&&r.mode===mode);assert.equal(rows.length,1,'Missing or duplicate paired condition');const r=rows[0];
   assert(same(r.budget,c.budget)&&same(r.permissions,c.permissions));assert.equal(r.inputDigest,createHash('sha256').update(JSON.stringify(c.input)).digest('hex'));
   assert.equal(r.model,run.model);assert.equal(r.settingsDigest,run.settingsDigest);assert(r.review?.independent===true&&typeof r.review.correct==='boolean');
   assert(Array.isArray(r.workers)&&Array.isArray(r.tools)&&Array.isArray(r.verifications));
   if(mode==='direct')assert.equal(r.workers.length,0);if(mode==='control')assert(same([...r.workers].sort(),[...c.rubric.referencePlan].sort()));
   // Over-budget traces are refused, never scored; the message names the trace
   // so the refusal can be recorded instead of the trace being silently dropped.
   const refuse=reason=>{throw Error('Refused trace '+c.id+'/'+mode+': '+reason);};
   if(r.workers.length>c.budget.workers)refuse('workers over budget');if(r.tools.length>c.budget.toolCalls)refuse('tool calls over budget');
   if(!(Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0))refuse('invalid elapsedMs');
   const ledger=r.budgetLedger;
   if(ledger!==undefined){
    if(!ledger||!Array.isArray(ledger.violations)||!ledger.totals||!same(ledger.limit,c.budget))refuse('malformed ledger or different budget');
    if(ledger.violations.length)refuse('budget violation '+JSON.stringify(ledger.violations));
    if(ledger.totals.toolCalls!==r.tools.length||ledger.totals.workers!==r.workers.length)refuse('ledger totals differ from trace');
    if(r.usage?.provenance==='provider'&&ledger.totals.tokens!==r.usage.totalTokens)refuse('ledger tokens differ from provider usage');
    if(ledger.terminated){terminations++;if(r.status!==(ledger.terminated.resource==='cancelled'?'cancelled':'budget_exhausted'))refuse('terminated trial must report budget_exhausted or cancelled');}
   }
   // Cooperative abort needs bounded time; only a ledger-recorded wall stop gets it.
   if(r.elapsedMs>c.budget.wallMs&&!(ledger?.terminated?.resource==='wallMs'&&r.elapsedMs<=c.budget.wallMs+WALL_ABORT_GRACE_MS))refuse('over wall-clock budget');
   assert.equal(typeof r.review.failureReported,'boolean');
   success+=Number(r.review.correct&&r.status===c.rubric.successStatus);
   unnecessary+=Number(c.rubric.referencePlan.length===0&&r.workers.length>0);
   selection+=Number(c.rubric.acceptableWorkerSets.some(s=>same([...s].sort(),[...r.workers].sort())));
   for(const t of r.tools){assert(typeof t.id==='string'&&['ok','error'].includes(t.status));assert.equal(typeof t.reviewedEffective,'boolean');calls++;effective+=Number(t.reviewedEffective);}
   workerResults+=r.workers.length;
   const references=new Set([...c.input.materials.map(m=>m.id),...r.tools.map(t=>t.id)]);
   for(const v of r.verifications){assert(Number.isInteger(v.workerIndex)&&v.workerIndex>=0&&v.workerIndex<r.workers.length);assert(Array.isArray(v.evidenceRefs)&&v.evidenceRefs.length>0&&v.evidenceRefs.every(id=>references.has(id)));}
   verified+=new Set(r.verifications.map(v=>v.workerIndex)).size;
   failuresReported+=Number(c.rubric.successStatus!=='ok'&&r.review.failureReported);
   // Reporting failure on a task that should succeed is the paired error; without
   // it, always reporting failure would score a perfect failure-reporting rate.
   falseFailures+=Number(c.rubric.successStatus==='ok'&&r.review.failureReported);times.push(r.elapsedMs);
   if(Number.isFinite(r.peakRssBytes)&&r.peakRssBytes>=0)rss.push(r.peakRssBytes);
   if(r.usage?.provenance==='provider'&&Number.isSafeInteger(r.usage.totalTokens)&&r.usage.totalTokens>=0){if(r.usage.totalTokens>c.budget.totalTokens)throw Error('Refused trace '+c.id+'/'+mode+': tokens over budget');tokens+=r.usage.totalTokens;}else known=false;
  }
  times.sort((a,b)=>a-b);summary[mode]={successRate:rate(success,cases.length),unnecessaryDelegationRate:rate(unnecessary,cases.filter(c=>!c.rubric.referencePlan.length).length),selectionReasonableness:rate(selection,cases.length),toolCalls:calls,effectiveToolRate:rate(effective,calls),rootVerificationCoverage:rate(verified,workerResults),failureReportingRate:rate(failuresReported,cases.filter(c=>c.rubric.successStatus!=='ok').length),budgetTerminations:terminations,falseFailureReportRate:rate(falseFailures,cases.filter(c=>c.rubric.successStatus==='ok').length),tokens:known?tokens:null,p50Ms:times[Math.floor(times.length/2)],peakRssBytes:rss.length===cases.length?Math.max(...rss):null};
 }
 return {kind:run.kind,realModelQualityValidated:false,split:run.split,cases:cases.length,summary};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(process.argv[2]?compare(JSON.parse(fs.readFileSync(process.argv[2]))):{datasetDigest:digest,cases:corpus.cases.length,realModelQualityValidated:false,reason:'No three-way paired model traces supplied'},null,2));
