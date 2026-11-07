// Delivery visibility over the existing Outbox: abnormal states are reported to
// the Owner by id/kind/status/time only, never retried or rewritten by a read.
import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createOutbox,STALE_PENDING_MS} from '../packages/character-identity/outbox.mjs';

const DDL=`CREATE TABLE outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,conversation TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE identity_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`;
let seq=0;
function harness(db=new DatabaseSync(':memory:'),clock={t:Date.parse('2030-01-01T00:00:00.000Z')}){
 if(!db.prepare("SELECT name FROM sqlite_master WHERE name='outbox'").get())db.exec(DDL);
 const box=createOutbox({db,key:'visibility-'+(++seq),now:()=>clock.t});
 return {db,box,clock};
}
const options=(send,extra={})=>({notifier:{calls:0,async send(r){this.calls++;return send(r);}},conversation:'c1',target:{type:'direct',id:'owner'},eligible:()=>true,authorize:()=>true,...extra});
const SECRET='私密任务结果：不应出现在投递视图中';

test('unknown, partial and platform-refused not-sent are settled once and surfaced as attention',async()=>{
 const {box}=harness();await box.ready;
 const results={a:{status:'unknown'},b:{status:'partial',parts:[{index:0,status:'sent'},{index:1,status:'not-sent'}]},c:{status:'not-sent',stage:'platform',reason:'refused'},d:{status:'sent'}};
 for(const id of Object.keys(results))box.enqueue({eventId:'long-task:'+id,kind:'task_completed',text:SECRET,conversation:'c1'});
 const order=Object.keys(results);// rows are handed over in enqueue order
 const o=options(()=>results[order.shift()]??{status:'sent'});
 await box.pump(o);
 assert.equal(o.notifier.calls,4);
 assert.deepEqual(['a','b','c','d'].map(id=>box.record('long-task:'+id,'c1').attention),['unknown','partial','not-sent',null]);
 const attention=box.attention('c1');
 assert.deepEqual(attention.map(r=>r.id).sort(),['long-task:a','long-task:b','long-task:c']);
 assert(!JSON.stringify(attention).includes(SECRET)&&!JSON.stringify(box.record('long-task:a','c1')).includes(SECRET),'views expose no notification text');
 // Reading and pumping again never resends an uncertain or refused row.
 await box.pump(o);assert.equal(o.notifier.calls,4);
 assert.equal(box.record('long-task:a','c1').status,'unknown');
 await box.close();
});

test('restart turns an interrupted sending row into unknown attention and does not resend it',async()=>{
 const db=new DatabaseSync(':memory:');let {box}=harness(db);await box.ready;
 box.enqueue({eventId:'long-task:x',kind:'task_completed',text:'x',conversation:'c1'});
 db.prepare("UPDATE outbox SET status='sending' WHERE id='long-task:x'").run();await box.close();
 ({box}=harness(db));await box.ready;
 const o=options(()=>({status:'sent'}));await box.pump(o);
 assert.equal(o.notifier.calls,0,'an interrupted hand-over may have reached the platform');
 assert.deepEqual(box.attention('c1').map(r=>[r.id,r.attention]),[['long-task:x','unknown']]);
 await box.close();
});

test('pending past the threshold is stale; authorization holds are labelled; fresh pending is not attention',async()=>{
 const {box,clock}=harness();await box.ready;
 box.enqueue({eventId:'scheduled:1',kind:'scheduled_reminder',text:'r',conversation:'c1'});
 box.enqueue({eventId:'long-task:fresh',kind:'task_completed',text:'f',conversation:'c1'});
 const o=options(()=>({status:'not-sent',stage:'before-platform',reason:'unauthorized'}),{eligible:row=>row.kind!=='scheduled_reminder'});
 await box.pump(o);
 assert.deepEqual(box.attention('c1'),[],'recently enqueued rows are not yet abnormal');
 assert.equal(box.record('scheduled:1','c1').status,'pending');
 clock.t+=STALE_PENDING_MS+1;
 const rows=Object.fromEntries(box.attention('c1').map(r=>[r.id,r]));
 assert.equal(rows['scheduled:1'].attention,'stale-pending');assert.equal(rows['scheduled:1'].held,'authorization');
 assert.equal(rows['long-task:fresh'].attention,'stale-pending');
 await box.close();
});

test('views are confined to the requested Conversation',async()=>{
 const {box}=harness();await box.ready;
 box.enqueue({eventId:'long-task:other',kind:'task_failed',text:'o',conversation:'c2'});
 await box.pump({...options(()=>({status:'unknown'})),conversation:'c2'});
 assert.equal(box.record('long-task:other','c1'),null);assert.deepEqual(box.attention('c1'),[]);
 assert.equal(box.attention('c2').length,1);
 await box.close();
});
