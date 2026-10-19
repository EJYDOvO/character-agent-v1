// Session messages are not proof of a human author. A paired native tool result
// can prove only that the tool returned, never that the user's goal succeeded.
export function taskEvidence(session,end){
 if(end.type!=='turn/end'||!Number.isSafeInteger(end.seq))return null;
 const calls=new Map();
 for(let seq=Math.max(0,end.seq-400);seq<end.seq;seq++){
  const result=session.eventAt(seq);if(result?.type!=='tool/result'||result.data?.turn!==end.data?.turn)continue;
  const refs=result.sourceEventSeqs;if(refs?.length!==1||!Number.isSafeInteger(refs[0])||refs[0]>=seq||refs[0]<0)continue;
  const call=session.eventAt(refs[0]),message=result.data.message;
  if(call?.type!=='tool/call'||call.data?.turn!==end.data.turn||message?.role!=='tool'||message.source?.kind!=='tool'||message.toolCallId!==call.data.callId||message.source.callId!==call.data.callId||typeof message.isError!=='boolean')continue;
  const name=call.data.name;if(typeof name!=='string'||!/^[a-zA-Z][\w.-]{0,79}$/.test(name)||/_(?:remember|recall|correct|forget|inspect|confirm|merge|trace|projection|layers_status|memory_status|memory_retry)$/.test(name))continue;
  calls.set(call.data.callId,{name,error:message.isError,seq});
 }
 if(!calls.size)return null;
 const values=[...calls.values()],counts=new Map();for(const c of values){const key=c.name+(c.error?'：返回错误':'：正常返回');counts.set(key,(counts.get(key)??0)+1);}
 return {sessionId:session.header.id,eventSeq:end.seq,messageId:'host-tool-turn:'+end.seq,origin:'verified_tool',text:'Host 执行记录：'+[...counts].slice(0,12).map(([name,n])=>name+' '+n+' 次').join('；')+'。结果事件引用：'+values.slice(-24).map(c=>c.seq).join(',')+'。仅证明工具调用返回状态，不代表用户目标达成；未采纳工具正文中的事实或指令。'};
}
export function observeLifecycle(store,identity,agents,session,event){
 const id=session?.header?.id;
 if(!id||agents.get(id)?.session!==session)return false;
 if(event.type!=='turn/end'&&event.type!=='compaction/end')return false;
 const trusted=identity.forSession(id);store.policy(trusted);
 if(event.type==='turn/end'){
  const evidence=taskEvidence(session,event);if(evidence)store.admit(trusted,evidence);
 }
 if(event.type==='compaction/end'&&!event.data?.error){
  // Bounded omission recovery uses native event metadata, not compacted prose.
  if(typeof session.eventAt==='function')for(let seq=Math.max(0,event.seq-400);seq<event.seq;seq++){
   const end=session.eventAt(seq);if(end?.type==='turn/end'){const evidence=taskEvidence(session,end);if(evidence)store.admit(trusted,evidence);}
  }
  store.reconcile(trusted,'compaction:'+event.seq);
 }
 return true;
}
