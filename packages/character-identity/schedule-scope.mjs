import {scheduleTargetSession} from './bindings.mjs';
// DSH 0.2.2 native Schedule tools are Host-wide and accept `new_once`/`new`
// targets. A Character Owner root keeps the earlier per-Session contract at the
// tool-execution boundary (not only in prompts):
//  - schedule_create must target this_session;
//  - schedule_view/schedule_edit act only on a task whose fixed target is the
//    calling Session, and an edit can never retarget it elsewhere.
// Independent background work goes through long_task_create instead.
// schedule_list stays the native Host-wide read (same Owner principal); it
// grants no mutation, and every mutation is checked here.
export const SCHEDULE_TOOLS=Object.freeze(['schedule_create','schedule_list','schedule_view','schedule_edit']);
const tools=new Set(SCHEDULE_TOOLS);
export const CREATE_TARGET_DENIED='Character reminders must use target this_session; use long_task_create for independent background work';
export const RETARGET_DENIED='Character reminders cannot move to another Session';
export const UNVERIFIED_TASK='Schedule task is not verified as delivering to this Session';
export const UNAVAILABLE='Schedule ownership index is unavailable; retry after it refreshes';
export function isScheduleTool(name){return tools.has(name);}
// exec: native guard execution ({name, agent, arguments}); sessionId: caller Session.
// ownerOf(id): fixed target Session of a task from the current index, or undefined.
export function scheduleToolDenial(exec,{sessionId,ownerOf,ready}){
 if(!isScheduleTool(exec?.name))return undefined;
 const args=exec.arguments&&typeof exec.arguments==='object'?exec.arguments:{};
 if(exec.name==='schedule_list')return undefined;
 if(exec.name==='schedule_create')return args.target==='this_session'?undefined:CREATE_TARGET_DENIED;
 if(args.target!==undefined&&args.target!=='this_session')return RETARGET_DENIED;
 if(!ready)return UNAVAILABLE;
 if(typeof args.id!=='string'||!sessionId||ownerOf(args.id)!==sessionId)return UNVERIFIED_TASK;
 return undefined;
}
// Fixed-target index over the native catalog. Refreshes after every
// `schedule/changed`; overlapping refreshes keep only the newest result.
export function scheduleIndex(readCatalog){
 let owners=new Map(),ready=false,generation=0,failed=false;
 async function refresh(){
  const mine=++generation;
  try{
   const rows=await readCatalog();
   if(mine!==generation)return;
   owners=new Map(rows.map(r=>[r.id,scheduleTargetSession(r)]));ready=true;failed=false;
  }catch(error){if(mine===generation){ready=false;failed=true;}throw error;}
 }
 return {refresh,ownerOf:id=>owners.get(id),get ready(){return ready;},get failed(){return failed;}};
}
