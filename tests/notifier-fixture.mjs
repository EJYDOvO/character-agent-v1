// Stand-in for the Gateway's Agent I/O notifier (dsh-agent-io conversation.openNotifications)
// for Host probes that do not load Agent I/O: the Outbox's own authorization runs before the
// part, as in the I/O; deliver(target, text) records it; the result is an Agent I/O SendResult.
export function notifierFixture(deliver){
 return Object.freeze({async send(request){
  const target={type:request.conversation?.type,id:request.conversation?.id};
  if(request.signal?.aborted)return {id:request.id,status:'not-sent',reason:'cancelled',stage:'before-platform',parts:[]};
  if(request.authorize?.(target)!==true)return {id:request.id,status:'not-sent',reason:'unauthorized',stage:'before-platform',parts:[]};
  await deliver({scope:target.type==='group'?'group':'c2c',targetId:target.id},request.text);
  return {id:request.id,status:'sent',parts:[{index:0,status:'sent'}]};
 }});
}
