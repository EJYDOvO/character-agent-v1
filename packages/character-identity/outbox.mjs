// Character Identity's durable notification Outbox (Iteration 07, Notification).
// The single writer of the `outbox` table and of its `outbox-source:` rows in
// identity_state; no other module writes delivery state. Rows keep their ids,
// columns and history; statuses are pending → sending → sent | unknown |
// partial | not-sent, or pending → cancelled. External delivery goes only
// through the Gateway's Agent I/O notifier (stable target, the notification
// authority's own check before every part), never a direct Gateway send.
//   - A row is claimed (pending → sending) durably before it is handed over.
//   - A row left 'sending' by an earlier owner may have reached the platform:
//     on start it becomes 'unknown' and is never resent.
//   - Only a provably unsent attempt (not-sent before the platform, or a rate
//     limit) returns to 'pending'; a platform refusal stays 'not-sent'.
//   - Terminal writes apply only to the row this owner still holds ('sending').
const KINDS=['scheduled_reminder','task_completed','task_failed','task_timeout','maintenance_result','configured_alert'];
// One owner per state file in a process (HMR may overlap an old and a new
// instance): a new owner recovers and pumps only after the previous one closed.
const leases=globalThis[Symbol.for('dsh.character.outbox.v1')]??=new Map();

export function createOutbox({db,key,logger,now=Date.now,retryAfterMs=60_000}){
 const previous=leases.get(key);let release;
 const lease={released:new Promise(r=>{release=r;})};leases.set(key,lease);
 let closed=false,running,again=false;const controller=new AbortController(),attempts=new Map(),held=new Map();
 const warn=message=>{try{logger?.warn?.('Character Outbox: '+message);}catch{}};
 const ready=(previous?.released??Promise.resolve()).then(()=>{
  if(closed)return;
  const recovered=db.prepare("UPDATE outbox SET status='unknown' WHERE status='sending'").run().changes;
  if(recovered)warn(`${recovered} interrupted deliveries recorded as unknown; they are not resent`);
 });
 ready.catch(()=>{});
 const sourceOf=id=>db.prepare('SELECT value FROM identity_state WHERE key=?').get('outbox-source:'+id)?.value;

 /** One explicit, Host-validated event; idempotent by id. source: the Session a reminder came from. */
 function enqueue({eventId,kind,text,conversation,source}){
  if(closed)throw Error('Identity disposed');
  if(!KINDS.includes(kind)||typeof eventId!=='string'||!eventId||eventId.length>256||typeof text!=='string'||!text.trim()||text.length>3000)throw Error('Invalid explicit event');
  const old=db.prepare('SELECT * FROM outbox WHERE id=?').get(eventId);
  if(old){if(old.kind!==kind||old.conversation!==conversation||old.text!==text)throw Error('Notification id conflict');return false;}
  db.exec('BEGIN IMMEDIATE');
  try{
   const inserted=db.prepare("INSERT OR IGNORE INTO outbox VALUES(?,?,?,?, 'pending',?)").run(eventId,kind,conversation,text,new Date(now()).toISOString()).changes===1;
   if(inserted&&typeof source==='string'&&source)db.prepare('INSERT OR IGNORE INTO identity_state VALUES(?,?)').run('outbox-source:'+eventId,source);
   db.exec('COMMIT');return inserted;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 // The status a terminal or retryable result leaves the row in.
 function outcome(result){
  if(result?.status==='sent')return 'sent';
  if(result?.status==='partial')return 'partial';
  if(result?.status==='not-sent'){
   if(result.stage==='before-platform')return 'pending';
   if(result.reason==='rate-limited')return 'pending';
   return 'not-sent';
  }
  return 'unknown';
 }
 async function round({notifier,conversation,target,eligible,authorize}){
  let claimed=0;
  for(const row of db.prepare("SELECT * FROM outbox WHERE status='pending' AND conversation=? ORDER BY at LIMIT 20").all(conversation)){
   if(closed)break;
   if((held.get(row.id)??0)>now())continue;
   const source=sourceOf(row.id);
   if(!eligible(row,source)){held.set(row.id,Infinity);warn(`a ${row.kind} notification cannot be re-verified and stays pending`);continue;}
   // Durable claim before the hand-over; a failed write sends nothing.
   try{if(!db.prepare("UPDATE outbox SET status='sending' WHERE id=? AND status='pending'").run(row.id).changes)continue;}
   catch{warn('claim not recorded; nothing sent');continue;}
   claimed++;
   // A new I/O id per attempt: the I/O remembers ids in memory, and a provably
   // unsent attempt must not be answered with its own earlier result.
   const attempt=(attempts.get(row.id)??0)+1;attempts.set(row.id,attempt);
   let result;
   try{result=await notifier.send({id:`notify:${row.id}:${attempt}`,conversation:target,text:row.text,signal:controller.signal,authorize:t=>!closed&&authorize(row,source,t)});}
   catch{result={status:'unknown'};}
   const next=outcome(result);
   if(next==='pending'){
    // Not authorized now, not admitted, Gateway closing, queue full or rate limited: retried later, not hammered.
    held.set(row.id,['unauthorized','invalid-target','closed','adapter-unavailable'].includes(result.reason)?Infinity:now()+retryAfterMs);
   }
   try{db.prepare('UPDATE outbox SET status=? WHERE id=? AND status=?').run(next,row.id,'sending');}
   catch{warn('delivery result not recorded; the row stays sending and becomes unknown on restart');}
  }
  return claimed;
 }
 /**
  * Deliver pending rows of one Conversation, one at a time (chat sent meanwhile
  * keeps its place in the same I/O queue). Serialized: a call while a pump runs
  * schedules another pass and resolves after it, so an event enqueued before
  * the call has been attempted (or held) when the returned promise settles.
  */
 function pump(options){
  if(closed||!options?.notifier)return Promise.resolve();
  if(running){again=true;return running;}
  running=(async()=>{
   try{await ready;do{again=false;while(!closed&&await round(options)>0);}while(again&&!closed);}
   finally{running=undefined;}
  })();
  return running;
 }
 /** Rows held back by an authorization failure are tried again (a new Gateway attachment). */
 const releaseHeld=()=>{for(const [id,until] of held)if(until===Infinity)held.delete(id);};
 const status=(id,conversation)=>db.prepare('SELECT status FROM outbox WHERE id=?'+(conversation?' AND conversation=?':'')).get(...(conversation?[id,conversation]:[id]))?.status??null;
 const cancel=(id,conversation)=>db.prepare("UPDATE outbox SET status='cancelled' WHERE id=? AND conversation=? AND status='pending'").run(id,conversation).changes===1;
 const inspect=conversation=>db.prepare('SELECT id,kind,status,at FROM outbox WHERE conversation=? ORDER BY at DESC LIMIT 30').all(conversation);
 /** Stop: queued hand-overs are cancelled (provably unsent → pending), an in-flight part completes; then the lease is released. */
 async function close(){
  if(closed)return;
  closed=true;controller.abort();
  const pending=running;
  if(pending)await Promise.race([pending.catch(()=>{}),new Promise(r=>setTimeout(r,10_000).unref?.())]);
  release();if(leases.get(key)===lease)leases.delete(key);
 }
 return Object.freeze({ready,enqueue,pump,releaseHeld,status,cancel,inspect,sourceOf,close,size:()=>({held:held.size,attempts:attempts.size})});
}
