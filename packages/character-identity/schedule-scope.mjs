import {scheduleTargetSession} from './bindings.mjs';
// DSH 0.2.2 native Schedule tools are Host-wide and accept `new_once`/`new`
// targets. A Character Owner root keeps the earlier per-Owner contract at the
// tool-execution boundary (not only in prompts):
//  - schedule_create must target this_session;
//  - schedule_view/schedule_edit act only on a task whose fixed target is the
//    calling Session or an earlier Owner Session with a persisted reminder
//    binding (the same evidence that admits its reminder delivery), and an edit
//    can only retarget to this_session;
//  - ownership is decided from a fresh native view immediately before the
//    native body runs, never from a cached catalog, and an update/delete is
//    pinned to the verified revision with the native expectedUpdatedAt CAS.
// Independent background work goes through long_task_create instead.
// schedule_list stays the native Host-wide read (same Owner principal); it
// grants no mutation, and every mutation is checked here.
export const SCHEDULE_TOOLS=Object.freeze(['schedule_create','schedule_list','schedule_view','schedule_edit']);
const tools=new Set(SCHEDULE_TOOLS);
export const CREATE_TARGET_DENIED='Character reminders must use target this_session; use long_task_create for independent background work';
export const RETARGET_DENIED='Character reminders can only move to this Session';
export const UNVERIFIED_TASK='Schedule task is not verified as an Owner reminder';
export const UNAVAILABLE='Schedule ownership cannot be verified now; retry';
export const STALE_REVISION='Schedule task changed since that revision; view it again';
export function isScheduleTool(name){return tools.has(name);}
const argsOf=exec=>exec?.arguments&&typeof exec.arguments==='object'?exec.arguments:{};
// Synchronous admission (native guard, before dispatch): argument rules only.
// Ownership is not decided here, so a stale observation can neither grant nor
// spuriously refuse access; verifyScheduleCall decides at execution.
export function scheduleToolDenial(exec){
 if(!isScheduleTool(exec?.name))return undefined;
 const args=argsOf(exec);
 if(exec.name==='schedule_list')return undefined;
 if(exec.name==='schedule_create')return args.target==='this_session'?undefined:CREATE_TARGET_DENIED;
 if(args.target!==undefined&&args.target!=='this_session')return RETARGET_DENIED;
 if(typeof args.id!=='string'||!args.id)return UNVERIFIED_TASK;
 return undefined;
}
// Execution-time decision (tools/execute, immediately before the native body).
// sessionId: caller Session; trusted(id): whether id is an Owner Session with a
// persisted reminder binding; view(id): fresh native Schedule view.
// Returns {denied} or {arguments?} (arguments: the revision-pinned call).
export async function verifyScheduleCall(exec,{sessionId,trusted,view}){
 const pre=scheduleToolDenial(exec);if(pre)return {denied:pre};
 if(exec.name!=='schedule_view'&&exec.name!=='schedule_edit')return {};
 if(!sessionId)return {denied:UNVERIFIED_TASK};
 const args=argsOf(exec);let task;
 try{task=await view(args.id);}catch{return {denied:UNAVAILABLE};}
 if(!task||typeof task!=='object'||!('kind' in task))return {denied:UNVERIFIED_TASK};
 const owner=scheduleTargetSession(task);
 let ok=false;try{ok=!!owner&&(owner===sessionId||trusted(owner)===true);}catch{return {denied:UNAVAILABLE};}
 if(!ok)return {denied:UNVERIFIED_TASK};
 if(exec.name==='schedule_view')return {};
 const revision=task.updatedAt;
 // A caller revision other than the verified one would be checked against a
 // state this boundary did not authorize.
 if(args.expectedUpdatedAt!==undefined)return args.expectedUpdatedAt===revision?{}:{denied:STALE_REVISION};
 // Pin the native CAS to the verified revision. A row last written by DSH 0.2.1
 // has no revision; the tool schema cannot carry the null CAS, so that single
 // first edit stays unpinned (see docs/INTEGRATION.md residual risks).
 return typeof revision==='string'?{arguments:Object.freeze({...args,expectedUpdatedAt:revision})}:{unpinned:true};
}
