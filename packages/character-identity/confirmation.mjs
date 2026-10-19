// QQ-specific confirmation remains in the Character identity integration.
export function confirmationEvidence(input, memory, quote, now=Date.now()) {
  if (!input || input.origin!=='direct_user' || now-input.receivedAt>600000 || now<input.receivedAt) throw Error('Recent Owner evidence required');
  if (typeof quote!=='string' || input.text.trim()!==quote.trim()) throw Error('Complete Owner message required; excerpts cannot confirm');
  const statement=quote.trim().replace(/^(?:请)?确认(?:记忆)?[：:\s]*/u,'').replace(/[。！!]$/u,'').trim();
  if (!/^(?:请)?确认/u.test(quote.trim()) || ![memory.id,memory.statement].includes(statement)) throw Error('Explicit confirmation of exact memory required');
  return {sessionId:input.sessionId,eventSeq:input.eventSeq,messageId:input.messageId,origin:'direct_user',quote:input.text,confirmedAt:new Date(now).toISOString()};
}
