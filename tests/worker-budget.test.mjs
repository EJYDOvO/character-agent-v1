// Execution-time budget contract (no model driver): one shared ledger per trial,
// refusal/termination before overspending, and scorer re-checks of the ledger.
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createBudget,BudgetExceeded,WALL_ABORT_GRACE_MS} from '../evaluation/worker-v1/budget.mjs';
import {corpus,digest,compare} from '../evaluation/worker-v1/score.mjs';

function clock(){const c={t:1000,timers:new Map(),next:1};
 c.now=()=>c.t;c.setTimer=(fn,ms)=>{const id=c.next++;c.timers.set(id,{fn,at:c.t+ms});return id;};c.clearTimer=id=>c.timers.delete(id);
 c.advance=ms=>{c.t+=ms;for(const [id,t] of [...c.timers])if(t.at<=c.t){c.timers.delete(id);t.fn();}};return c;}
const ledgerOf=(budget,c=clock())=>createBudget(budget,{now:c.now,setTimer:c.setTimer,clearTimer:c.clearTimer});
const B={totalTokens:1000,toolCalls:2,workers:1,wallMs:30000};

test('Root and Workers draw on one token budget; reservations cap grants and exhaustion aborts everyone',()=>{
 const b=ledgerOf(B),root=b.reserveTokens(700,'root');assert.equal(root.granted,700);
 const worker=b.reserveTokens(700,'worker-general');assert.equal(worker.granted,300,'a Worker gets only the unreserved remainder');
 root.settle(700);worker.settle(300);
 assert.throws(()=>b.reserveTokens(100,'root'),e=>e instanceof BudgetExceeded&&e.resource==='totalTokens');
 assert.equal(b.signal.aborted,true);assert.equal(b.signal.reason.resource,'totalTokens');
 const l=b.close();assert.deepEqual(l.totals,{tokens:1000,toolCalls:0,workers:0});assert.equal(l.terminated.resource,'totalTokens');assert.deepEqual(l.violations,[]);
});

test('provider usage above the grant is a recorded violation, and an unsettled reservation too',()=>{
 const b=ledgerOf(B),r=b.reserveTokens(100);r.settle(140);assert.throws(()=>r.settle(1),/already settled/);
 const l=b.close();assert.equal(l.violations[0].actual,140);assert.equal(l.terminated.resource,'totalTokens');
 const u=ledgerOf(B);u.reserveTokens(10);assert.equal(u.close().violations[0].unsettledReservation,10);
});

test('tool and spawn budgets are enforced before dispatch; refusals do not end the trial',()=>{
 const none=ledgerOf({...B,toolCalls:0});assert.throws(()=>none.beforeTool('fetch'),e=>e.resource==='toolCalls');assert.equal(none.signal.aborted,false,'the Root may still answer without tools');
 const b=ledgerOf(B);b.beforeTool('a');b.beforeTool('b','worker-review');assert.throws(()=>b.beforeTool('c'),/toolCalls/);
 assert.throws(()=>b.beforeSpawn({preset:'worker-review',depth:2}),e=>e.resource==='depth','native depth is one');
 b.beforeSpawn({preset:'worker-review',depth:1});assert.throws(()=>b.beforeSpawn({preset:'worker-general',depth:1}),e=>e.resource==='workers');
 const l=b.close();assert.deepEqual(l.totals,{tokens:0,toolCalls:2,workers:1});assert.equal(l.terminated,null);
 assert.deepEqual(l.events.filter(e=>e.type==='refuse').map(e=>e.resource),['toolCalls','depth','workers']);
});

test('wall deadline and cancellation abort the shared signal; close releases the timer',()=>{
 const c=clock(),b=ledgerOf(B,c);let seen;b.signal.addEventListener('abort',()=>{seen=b.signal.reason;});
 assert.equal(c.timers.size,1);c.advance(B.wallMs);assert.equal(seen.resource,'wallMs');assert.throws(()=>b.beforeTool('late'),/wallMs/);
 assert.equal(b.close().terminated.resource,'wallMs');
 const c2=clock(),x=ledgerOf(B,c2);x.cancel('operator');assert.equal(x.signal.reason.name,'AbortError');assert.throws(()=>x.reserveTokens(1));
 assert.equal(x.close().terminated.resource,'cancelled');assert.equal(c2.timers.size,0,'no timer survives the trial');
 assert.throws(()=>x.beforeTool('after-close'),/closed/);
 assert.throws(()=>createBudget({...B,wallMs:-1}),/non-negative/);
});

// Scorer contract: a perfect fixture run, with one row given a ledger.
const run=split=>({datasetDigest:digest,targetHost:'0.2.2-rc.1',kind:'deterministic-fixture',split,model:'m',settingsDigest:'1'.repeat(64),results:corpus.cases.filter(c=>c.split===split).flatMap(c=>['direct','policy','control'].map(mode=>({id:c.id,mode,model:'m',settingsDigest:'1'.repeat(64),inputDigest:createHash('sha256').update(JSON.stringify(c.input)).digest('hex'),budget:c.budget,permissions:c.permissions,workers:mode==='control'?c.rubric.referencePlan:[],tools:[],verifications:mode==='control'?c.rubric.referencePlan.map((_,workerIndex)=>({workerIndex,evidenceRefs:['fixture:1']})):[],elapsedMs:10,status:c.rubric.successStatus,review:{independent:true,correct:true,failureReported:c.rubric.successStatus!=='ok'}})))});
function wallStopped(row,overMs){const c=clock(),b=ledgerOf(row.budget,c);c.advance(row.budget.wallMs);c.advance(overMs);const l=b.close();return {...row,budgetLedger:l,elapsedMs:l.elapsedMs,status:'budget_exhausted'};}

test('scorer accepts a ledger-proven wall stop within the grace and counts it as a failed task',()=>{
 const r=run('dev'),i=r.results.findIndex(x=>x.mode==='policy'&&x.id==='w01');r.results[i]=wallStopped(r.results[i],WALL_ABORT_GRACE_MS);
 const m=compare(r).summary.policy;assert.equal(m.budgetTerminations,1);assert(m.successRate<1,'a budget stop is not a success');
});

test('scorer still refuses over-budget traces, naming the trace for the audit record',()=>{
 const late=run('dev'),i=late.results.findIndex(x=>x.mode==='policy'&&x.id==='w01');
 late.results[i]=wallStopped(late.results[i],WALL_ABORT_GRACE_MS+1);assert.throws(()=>compare(late),/Refused trace w01\/policy: over wall-clock budget/);
 const bare=run('dev');bare.results[i]={...bare.results[i],elapsedMs:bare.results[i].budget.wallMs+1};assert.throws(()=>compare(bare),/over wall-clock budget/,'no grace without a ledger');
 const lied=run('dev');lied.results[i]={...wallStopped(lied.results[i],0),status:'ok'};assert.throws(()=>compare(lied),/must report budget_exhausted/);
 const v=run('dev'),b=ledgerOf(v.results[i].budget),res=b.reserveTokens(10);res.settle(20);v.results[i]={...v.results[i],budgetLedger:b.close(),status:'budget_exhausted'};assert.throws(()=>compare(v),/budget violation/);
 const drift=run('dev'),d=ledgerOf(drift.results[i].budget);d.beforeTool('t');drift.results[i]={...drift.results[i],budgetLedger:d.close()};assert.throws(()=>compare(drift),/ledger totals differ/);
 const tokens=run('dev');tokens.results[i]={...tokens.results[i],usage:{provenance:'provider',totalTokens:tokens.results[i].budget.totalTokens+1}};assert.throws(()=>compare(tokens),/tokens over budget/);
});
