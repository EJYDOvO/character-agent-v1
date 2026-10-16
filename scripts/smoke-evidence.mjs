export function assessSmoke(events,{requestId,marker,baseline}){
 const fresh=events.filter(e=>Number.isSafeInteger(e.seq)&&e.seq>baseline).sort((a,b)=>a.seq-b.seq);
 const request=fresh.find(e=>e.type==='user/message'&&e.data?.source?.rpcId===requestId);
 if(!request)return {completed:false,passed:false,reason:'request_not_observed'};
 const start=fresh.findLast(e=>e.type==='turn/start'&&e.seq<=request.seq)??fresh.find(e=>e.type==='turn/start'&&e.seq>request.seq);
 if(!start)return {completed:false,passed:false,reason:'turn_not_started'};
 const end=fresh.find(e=>e.type==='turn/end'&&e.seq>request.seq&&(start.data?.turn===undefined||e.data?.turn===start.data.turn));
 const window=fresh.filter(e=>e.seq>=request.seq&&(!end||e.seq<=end.seq));
 const internalSources=new Set(['time-context','runtime-context','model-selection']);
 if(window.some(e=>e.type==='user/message'&&e!==request&&!internalSources.has(e.data?.source?.kind)))return {completed:!!end,passed:false,reason:'concurrent_input'};
 const calls=new Map(window.filter(e=>e.type==='tool/call').map(e=>[String(e.data.callId),e.data.name]));
 const results=window.filter(e=>e.type==='tool/result').map(e=>({tool:calls.get(String(e.data.message?.source?.callId??e.data.message?.toolCallId??e.data.callId)),error:!!(e.data.error||e.data.message?.isError),markerPresent:JSON.stringify(e.data).includes(marker),forgotten:JSON.stringify(e.data).includes('forgotten')}));
 const recalls=results.filter(r=>r.tool==='character_recall'),lastRecall=recalls.at(-1);
 const finalMarker=window.some(e=>e.type==='assistant/message'&&JSON.stringify(e.data).includes(marker+'_DONE'));
 const passed=end?.data?.reason?.kind==='completed'&&[...calls.values()].every(n=>['character_remember','character_recall','character_forget'].includes(n))&&results.some(r=>r.tool==='character_remember'&&r.markerPresent)&&recalls.some(r=>r.markerPresent)&&results.some(r=>r.tool==='character_forget'&&r.forgotten)&&recalls.length>=2&&!lastRecall.markerPresent&&!results.some(r=>r.error)&&finalMarker;
 return {completed:!!end,passed,reason:passed?'verified':'incomplete_or_failed_sequence',results,finalMarker};
}
