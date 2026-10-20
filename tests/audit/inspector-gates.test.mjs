import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './inspector-fixture.mjs';
import {controller} from '../../packages/memory-inspector/controller.mjs';
import {LayeredMemory} from '../../packages/character-memory-core/layered.mjs';
import {handler} from '../../packages/memory-inspector/http.mjs';
import {createServer} from 'node:http';
test('T01 Assistant forget stays readable as redacted metadata through mode switches and reopen',()=>{
 const f=fixture();try{const r=f.personal();assert(r);const confirmed=f.memory.confirm(f.c,r.id,r.revision,f.source(10));f.memory.forget(f.c,r.id,confirmed.revision);
 for(const restart of [false,true]){if(restart)f.reopen();for(const mode of ['off','assistant','character']){f.scope.memoryMode=mode;
 assert.doesNotThrow(()=>f.memory.inspectorStats(f.c));assert.doesNotThrow(()=>f.memory.browse(f.c));
 if(mode==='off'){assert.throws(()=>f.memory.get(f.c,r.id),/unavailable/);continue;}
 const row=f.memory.get(f.c,r.id);assert.equal(row.statement,'');assert.equal(row.source,'{}');const trace=f.memory.trace(f.c,r.id);assert(trace.evidence.every(e=>!e.body));assert(!JSON.stringify(trace).includes(r.statement));
 }}
 }finally{f.memory.close();}
});
test('T04 L3 filters and paging count individual valid references, empty means zero',()=>{
 const f=fixture('off');try{assert.equal(f.memory.browse(f.c,{layer:'l3'}).total,0);
 for(let n=1;n<4;n++)f.memory.remember(f.c,{kind:n===1?'procedural':'semantic',statement:'独立验收知识条目 '+n},f.source(n));
 const all=f.memory.browse(f.c,{layer:'l3',limit:1});assert.equal(all.total,3);assert.equal(all.items.length,1);assert(all.items[0].id);
 assert.equal(f.memory.browse(f.c,{layer:'l3',query:'不存在'}).total,0);assert.equal(f.memory.browse(f.c,{layer:'l3',kind:'procedural',status:'confirmed'}).total,1);
 assert.equal(f.memory.browse(f.c,{layer:'l3',from:'2100-01-01T00:00:00Z'}).total,0);
 }finally{f.memory.close();}
});
test('T05 Jobs search includes safe ID, status, type and error with unified chronology',()=>{
 const f=fixture();try{const id=f.memory.enqueue(f.c,{...f.source(1),text:'这是后台提取的隔离测试经历。'});assert.equal(f.memory.browse(f.c,{layer:'jobs',query:id}).total,1);assert.equal(f.memory.browse(f.c,{layer:'jobs',query:'pending'}).total,1);
 f.memory.db.prepare("UPDATE extraction_jobs SET status='failed',error='extraction_failed' WHERE id=?").run(id);
 assert.equal(f.memory.browse(f.c,{layer:'jobs',query:'extraction_failed',status:'failed'}).total,1);
 }finally{f.memory.close();}
});

test('T02 every Inspector operation rejects forged contexts, revoked capabilities and foreign personal records',()=>{
 const f=fixture(),api=controller(f.memory,{current:()=>f.c},{writable:true});try{
 const r=f.personal(),base={context:f.c.sessionId,id:r.id,revision:r.revision,targetRevision:1,statement:'新的管理事实'};
 const operations=['browse','detail','stats','confirm','correct','forget','restore'];
 for(const operation of ['contexts',...operations])assert.throws(()=>api({...base,operation,principalId:'forged'}),/Unknown/);
 for(const operation of operations)assert.throws(()=>api({...base,operation,context:'forged-session'}),/Unauthorized/);
 for(const [field,value]of [['agentId','other-agent'],['projectId','other-project'],['principalId','other-owner'],['namespaceId','other-character']]){
  const c={sessionId:'foreign-'+field};f.issued.set(c,{...f.scope,[field]:value});f.memory.policy(c);
  assert.equal(f.memory.browse(c).total,0);assert.equal(f.memory.inspectorStats(c).l2,0);
  for(const operation of ['detail','confirm','correct','forget','restore'])assert.throws(()=>api({...base,operation,context:c.sessionId}),/unavailable/);
  f.issued.delete(c);
 }
 assert.equal(api({operation:'contexts'}).contexts.length,1);f.issued.delete(f.c);
 assert.deepEqual(api({operation:'contexts'}).contexts,[]);
 for(const operation of operations)assert.throws(()=>api({...base,operation}),/Unauthorized/);
 }finally{f.memory.close();}
});

test('T02 all API operations require native owner authentication and reject revoked cookies',async()=>{
 let origin,role='owner',valid=true,calls=0;const server=createServer(handler({origin:()=>origin,connection:{admit:r=>valid&&r.headers.cookie==='fixture'?{peer:{principal:{kind:role}}}:{rejection:401}},assets:new Map(),dispatch:()=>{calls++;return {};}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 try{for(const operation of ['contexts','browse','detail','stats','confirm','correct','forget','restore']){
  const request=(cookie)=>fetch(origin+'/memory-inspector/api',{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify({operation})});
  role='owner';valid=true;assert.equal((await request('fixture')).status,200);
  assert.equal((await request('')).status,401);role='guest';assert.equal((await request('fixture')).status,403);
  role='owner';valid=false;assert.equal((await request('fixture')).status,401);
 }assert.equal(calls,8);
 }finally{await new Promise(r=>server.close(r));}
});

test('T03 two database connections enforce CAS and restoration appends only valid same-content revisions',()=>{
 const f=fixture('off'),r=f.memory.remember(f.c,{kind:'semantic',statement:'同内容元数据恢复验收。'},f.source(1));
 const other=new LayeredMemory(f.file,f.authorize);try{
  const before=other.get(f.c,r.id);f.memory.confirm(f.c,r.id,r.revision,f.source(2));
  assert.throws(()=>other.correct(f.c,r.id,'另一个窗口的过时编辑。',before.revision,f.source(3)),/conflict/);
  const restored=other.restoreRevision(f.c,r.id,1,2,f.source(4));assert.equal(restored.revision,3);assert.equal(restored.statement,r.statement);
  assert.equal(other.revisionHistory(f.c,r.id).length,3);
  const corrected=f.memory.correct(f.c,r.id,'基于新证据纠正的内容。',3,f.source(5));
  assert.throws(()=>other.restoreRevision(f.c,r.id,1,corrected.revision,f.source(6)),/Retired/);
  assert(other.revisionHistory(f.c,r.id).filter(x=>x.revision<4).every(x=>x.redacted&&!x.statement&&x.source==='{}'));
  other.forget(f.c,r.id,4);assert.equal(f.memory.projection(f.c).refs.length,0);assert(f.memory.trace(f.c,r.id).evidence.every(e=>!e.body));
 }finally{other.close();f.memory.close();}
});

test('T03 expired and retired evidence cannot leak through detail or restore',()=>{
 const f=fixture('off');try{for(const scenario of ['expired','retired']){
  const r=f.memory.remember(f.c,{kind:'semantic',statement:'治理屏障 '+scenario},f.source(scenario==='expired'?1:2));
  if(scenario==='expired')f.memory.db.prepare("UPDATE memories SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(r.id);
  else f.memory.db.prepare("UPDATE experiences SET status='retired' WHERE id IN (SELECT evidence_id FROM memory_evidence WHERE memory_id=?)").run(r.id);
  const trace=f.memory.trace(f.c,r.id);assert.equal(trace.valid,false);assert.equal(trace.memory.statement,'');assert.equal(trace.memory.source,'{}');assert(trace.evidence.every(e=>!e.body));
  const filtered=f.memory.browse(f.c,{status:scenario==='expired'?'expired':'invalidated'});assert(filtered.items.some(x=>x.id===r.id&&!x.statement));assert(!f.memory.browse(f.c,{status:'active'}).items.some(x=>x.id===r.id));
  assert.throws(()=>f.memory.restoreRevision(f.c,r.id,1,1,f.source(90)),/Retired/);assert.equal(f.memory.browse(f.c,{layer:'l3'}).total,0);
 }}finally{f.memory.close();}
});

test('T04/T06 projection pages preserve references and date filters require an explicit timezone',()=>{
 const f=fixture('off');try{for(let n=1;n<=4;n++)f.memory.remember(f.c,{kind:'semantic',statement:'分页关联 '+n},f.source(n));
 const a=f.memory.browse(f.c,{layer:'l3',limit:2}),b=f.memory.browse(f.c,{layer:'l3',limit:2,offset:2});assert.equal(a.total,4);assert.equal(b.total,4);
 assert.equal(new Set([...a.items,...b.items].map(r=>r.id)).size,4);
 for(const page of [a,b])for(const row of page.items){assert.equal(row.statement,f.memory.get(f.c,row.id).statement);assert(page.refs.some(ref=>ref.id===row.id&&ref.revision===row.revision));}
 assert.throws(()=>f.memory.browse(f.c,{from:'2026-10-20'}),/date|timezone/i);
 assert.throws(()=>f.memory.browse(f.c,{from:'2026-10-21T00:00:00Z',to:'2026-10-20T00:00:00Z'}),/date/i);
 }finally{f.memory.close();}
});

test('T01/T03 forgotten source identifiers and free-text claim keys are redacted on every Inspector read',()=>{
 const f=fixture('off');try{const text='合成隐私事实：我偏好独自整理旧档案。',messageId='private-source-reference-fixture';const row=f.memory.remember(f.c,{kind:'semantic',statement:text,claimKey:text},{...f.source(1,text),messageId});f.memory.forget(f.c,row.id,row.revision);
 for(const result of [f.memory.get(f.c,row.id),f.memory.inspect(f.c,row.id),f.memory.trace(f.c,row.id),f.memory.revisionHistory(f.c,row.id),f.memory.browse(f.c),f.memory.browse(f.c,{layer:'l1'})]){
  const json=JSON.stringify(result);assert(!json.includes(text),'Free-text claim key leaked retired content');assert(!json.includes(messageId),'Retired source reference remained visible');
 }
 }finally{f.memory.close();}
});

test('T03 correction cannot expose the retired body through an unchanged claim key',()=>{
 const f=fixture('off');try{const text='合成旧结论：用户固定在北侧办公室工作。';const row=f.memory.remember(f.c,{kind:'semantic',statement:text,claimKey:text},f.source(1,text));const corrected=f.memory.correct(f.c,row.id,'合成新结论：办公地点不固定。',row.revision,f.source(2,'办公地点不固定。'));
 for(const result of [corrected,f.memory.get(f.c,row.id),f.memory.recall(f.c,''),f.memory.browse(f.c),f.memory.trace(f.c,row.id),f.memory.revisionHistory(f.c,row.id)])assert(!JSON.stringify(result).includes(text),'Retired claim text remained public');
 }finally{f.memory.close();}
});
