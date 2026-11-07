// Execution-time budget contract for one Worker evaluation trial.
// No model driver exists yet. A future driver creates ONE ledger per trial and
// passes the same object to Root and every Worker, so all of them draw on one
// total budget (README: "Root plus all children, not per Worker"). It calls the
// checkpoints below BEFORE each model call, tool dispatch and spawn; the ledger
// refuses or terminates instead of letting a trace go over budget afterwards.
// The scorer re-checks the closed ledger; it is evidence, not authorization:
// native Spawn depth, allowlists and approvals stay the Host's job.
import assert from 'node:assert/strict';

// Abort is cooperative: after the wall deadline fires, in-flight calls need a
// bounded time to observe the signal. Only a ledger-recorded wall termination
// may exceed wallMs, and only by this much; any other overrun stays refused.
export const WALL_ABORT_GRACE_MS=2000;
export const MAX_SPAWN_DEPTH=1;

export class BudgetExceeded extends Error{
 constructor(resource,detail={}){super('Budget exhausted: '+resource);this.name='BudgetExceeded';this.resource=resource;this.detail=detail;}
}
const count=(v,name)=>{assert(Number.isSafeInteger(v)&&v>=0,'Budget '+name+' must be a non-negative integer');return v;};

export function createBudget(budget,{now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,maxDepth=MAX_SPAWN_DEPTH}={}){
 const limit={totalTokens:count(budget?.totalTokens,'totalTokens'),toolCalls:count(budget?.toolCalls,'toolCalls'),workers:count(budget?.workers,'workers'),wallMs:count(budget?.wallMs,'wallMs')};
 const started=now(),controller=new AbortController(),events=[],violations=[];
 let tokens=0,reserved=0,tools=0,workers=0,terminated=null,closed=false;
 const elapsed=()=>now()-started;
 const log=(type,fields={})=>{events.push({type,at:elapsed(),...fields});};
 function terminate(resource,detail={}){
  if(terminated)return;
  terminated={resource,at:elapsed()};log('terminate',{resource,...detail});
  controller.abort(resource==='cancelled'?Object.assign(Error('Trial cancelled'),{name:'AbortError',detail}):new BudgetExceeded(resource,detail));
 }
 const timer=setTimer(()=>terminate('wallMs'),limit.wallMs);
 function live(){
  assert(!closed,'Budget ledger already closed');
  if(!terminated&&elapsed()>=limit.wallMs)terminate('wallMs');
  if(terminated)throw controller.signal.reason;
 }
 return Object.freeze({
  signal:controller.signal,limit:Object.freeze(limit),
  /** Before a model call: the grant caps that call's input+output tokens. */
  reserveTokens(requested,agent='root'){
   live();assert(Number.isSafeInteger(requested)&&requested>0,'Token reservation must be a positive integer');
   const remaining=limit.totalTokens-tokens-reserved;
   if(remaining<=0){terminate('totalTokens',{agent,requested});throw controller.signal.reason;}
   const granted=Math.min(requested,remaining);reserved+=granted;log('reserve',{agent,granted});
   let settled=false;
   return Object.freeze({granted,settle(actual){
    assert(!settled,'Reservation already settled');settled=true;assert(Number.isSafeInteger(actual)&&actual>=0,'Provider usage must be a non-negative integer');
    reserved-=granted;tokens+=actual;log('usage',{agent,granted,actual});
    // The provider spent more than it was allowed: the trace is invalid evidence.
    if(actual>granted){violations.push({resource:'totalTokens',agent,granted,actual});terminate('totalTokens',{agent,violation:true});}
   }});
  },
  /** Before dispatching any tool call of Root or a Worker. */
  beforeTool(id,agent='root'){
   live();
   if(tools>=limit.toolCalls){log('refuse',{resource:'toolCalls',agent,id});throw new BudgetExceeded('toolCalls',{agent,id});}
   tools++;log('tool',{agent,id});
  },
  /** Before a native Spawn. A refusal leaves the trial running (the Root may answer itself). */
  beforeSpawn({preset,depth}){
   live();
   if(!Number.isSafeInteger(depth)||depth<1||depth>maxDepth){log('refuse',{resource:'depth',preset,depth});throw new BudgetExceeded('depth',{preset,depth});}
   if(workers>=limit.workers){log('refuse',{resource:'workers',preset});throw new BudgetExceeded('workers',{preset});}
   workers++;log('spawn',{preset,depth});
  },
  /** Operator or harness cancellation: every holder of the signal stops. */
  cancel(reason='operator'){if(!closed)terminate('cancelled',{reason});},
  /** Release the timer and freeze the ledger for the trace. */
  close(){
   if(!closed){closed=true;clearTimer(timer);if(reserved)violations.push({resource:'totalTokens',unsettledReservation:reserved});}
   return {limit:{...limit},totals:{tokens,toolCalls:tools,workers},elapsedMs:elapsed(),terminated:terminated&&{...terminated},violations:violations.map(v=>({...v})),events:events.map(e=>({...e}))};
  }
 });
}
