// Execution activity of one admitted run, folded from the native Session events
// of its own turn (DSH 0.2.2: step/start {turn,step}; tool/call {turn,step,
// callId,name,arguments}; tool/result {turn,step,message:{role:'tool',
// toolCallId,source:{kind:'tool',callId},content,isError},error?}). Pure: no I/O, timers or sends. Only counts, safe tool
// names and times are kept; never arguments or result content.
// turn/start is appended before the pre-step admission, so a run starts at its
// admitted occurrence, not at turn/start.
export const FIRST_REPORT_MS=90_000,REPORT_INTERVAL_MS=5*60_000;
const MAX_OPEN=20,MAX_RECENT=3;
const text=m=>m?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')??'';
/** A result the tool itself reported as failed (native flag, error info, or a JSON error payload). */
export function toolFailed(data){
 const m=data?.message??data;let payload;try{payload=JSON.parse(text(m));}catch{}
 return !!(m?.isError||m?.error||m?.source?.isError||payload?.error||payload?.ok===false);
}
const safeName=n=>typeof n==='string'&&/^[A-Za-z0-9_.:-]{1,64}$/u.test(n)?n:null;
const counts=a=>({steps:a.steps,calls:a.calls,results:a.results,errors:a.errors});
export const emptyActivity=()=>({seq:null,at:null,step:0,steps:0,calls:0,results:0,errors:0,open:[],recent:[]});
/**
 * Fold one native event into run.activity. Events of another turn, from before
 * the admission, without a log position, or already folded (replay) change
 * nothing. Returns false (ignored), 'error' (a failed tool result) or true.
 */
export function foldActivity(run,event,at){
 const d=event?.data;
 if(!Number.isSafeInteger(event?.seq)||event.seq<(run.startSeq??0)||d?.turn!==run.turn)return false;
 const a=run.activity??=emptyActivity();
 if(a.seq!==null&&event.seq<=a.seq)return false;
 let change=true;
 if(event.type==='step/start'){a.steps++;if(Number.isSafeInteger(d.step))a.step=d.step;}
 else if(event.type==='tool/call'){
  if(typeof d.callId!=='string')return false;
  const name=safeName(d.name);a.calls++;
  a.open=[...a.open.filter(c=>c.callId!==d.callId),{callId:d.callId,name,at}].slice(-MAX_OPEN);
  if(!a.recent.includes(name))a.recent=[...a.recent,name].slice(-MAX_RECENT-1);
 }else if(event.type==='tool/result'){
  const m=d.message??d,id=m?.toolCallId??m?.source?.callId;a.results++;
  a.open=a.open.filter(c=>c.callId!==id);
  if(toolFailed(d)){a.errors++;change='error';}
 }else return false;
 a.seq=event.seq;a.at=at;return change;
}
/** Activity not yet covered by a report (the admission itself is the first). */
export const unreported=run=>!run.report||(run.activity?.seq!=null&&(run.report.seq==null||run.activity.seq>run.report.seq));
/** A tool failure not yet alerted: once per run it may skip the interval, not the first-report window. */
export const alertDue=run=>!run.report?.alerted&&(run.activity?.errors??0)>(run.report?.base?.errors??0);
export function reportDue(run,{firstMs=FIRST_REPORT_MS,intervalMs=REPORT_INTERVAL_MS}={}){
 const first=Date.parse(run.startedAt)+firstMs;
 return run.report&&!alertDue(run)?Math.max(first,Date.parse(run.report.at)+intervalMs):first;
}
const minutes=ms=>ms<60_000?'不到 1 分钟':`约 ${Math.round(ms/60000)} 分钟`;
const tool=name=>name?`工具 ${name}`:'一个工具';
/**
 * The Host clock's observation time as a full local date-time with its UTC
 * offset, e.g. "2030-01-01 08:01:30（UTC+08:00）". A report may sit in the
 * Outbox (Gateway away) and arrive later; the text names when it was observed.
 * timeZone: the Host's zone unless given (tests).
 */
export function observedAt(ms,timeZone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}).formatToParts(ms).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}（${parts.timeZoneName.replace(/^GMT/u,'UTC')}）`;
}
/**
 * Deterministic Chinese summary of the facts observed up to `now`: no progress,
 * estimate or result content, and no claim about the state at delivery time.
 */
export function activityText(title,run,now,{timeZone}={}){
 const a=run.activity??emptyActivity(),base=run.report?.base??{steps:0,calls:0,results:0,errors:0},alert=alertDue(run);
 const calls=a.calls-base.calls,results=a.results-base.results,errors=a.errors-base.errors,at=observedAt(now,timeZone);
 const lines=[`[长期任务] ${title}`];
 lines.push(alert?`截至 ${at}，检测到工具执行异常；尚未观察到本轮结束事件，最终结果尚未确定。`:`截至 ${at}，尚未观察到本轮结束事件（本轮已运行${minutes(now-Date.parse(run.startedAt))}）。`);
 const parts=[];
 if(a.step>0)parts.push(`处于第 ${a.step} 个执行步骤`);
 if(calls>0){const names=a.recent.slice(-MAX_RECENT).map(tool),more=a.recent.length>MAX_RECENT?'等':'';parts.push(`发起 ${calls} 次工具调用（${names.join('、')}${more}）`);}
 if(results>0)parts.push(`收到 ${results} 次工具返回${errors>0?`，其中 ${errors} 次报告错误`:''}`);
 lines.push(parts.length?(run.report?'自上次汇报以来：':'最近活动：')+parts.join('；')+'。':'已开始执行，尚未观察到工具活动。');
 // Outstanding calls from the aggregate counters; `open` is bounded (MAX_OPEN)
 // and names a call only while every outstanding call is still tracked.
 const pending=Math.max(0,a.calls-a.results),[open]=a.open;
 if(pending>a.open.length)lines.push(`有 ${pending} 个工具调用尚未返回。`);
 else if(open)lines.push(`正在等待${open.name?`工具 ${open.name} `:'一个工具'}返回${pending>1?`（共 ${pending} 个调用未返回）`:''}，已等待${minutes(now-Date.parse(open.at))}。`);
 if(alert)lines.push('工具出错不等于任务失败，Agent 可能继续处理。');
 lines.push('（只反映上述时刻观察到的执行事件；送达时任务可能已经结束。不代表目标进度或完成情况。）');
 return lines.join('\n');
}
/** The report marker stored on the run: what it covered, when, and the counters it was based on. */
export function reportMarker(run,at,eventId){
 const a=run.activity??emptyActivity();
 return {seq:a.seq,at,eventId,count:(run.report?.count??0)+1,alerted:!!run.report?.alerted||alertDue(run),base:counts(a)};
}
