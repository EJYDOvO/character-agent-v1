import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
import {controller} from '../packages/memory-inspector/controller.mjs';
import {handler} from '../packages/memory-inspector/http.mjs';
function fixture(){
 const issued=new WeakMap(),c={sessionId:'test-session'},scope={principalId:'test-owner',namespaceId:'test-memory',projectId:'test-project',agentId:'a',memoryMode:'character'};issued.set(c,scope);
 const authorize=(h)=>{if(!issued.has(h))throw Error('Unauthorized');return issued.get(h);};
 const file=join(mkdtempSync(join(tmpdir(),'inspector-')),'memory.sqlite'),memory=new LayeredMemory(file,authorize);
 const identity={current:()=>c},api=controller(memory,identity,{writable:true});
 const add=(text='有来源的长期工作偏好',n=1)=>memory.remember(c,{kind:'semantic',statement:text},{sessionId:c.sessionId,eventSeq:n,messageId:'event-'+n,origin:'direct_user',quote:text});
 const call=(operation,extra={})=>api({operation,context:c.sessionId,...extra});
 return {memory,c,scope,issued,identity,api,add,call,file,authorize};
}

test('Read-only contexts require live Host authority, never persisted memory or old Session alone',()=>{
 const f=fixture();try{const row=f.add(),read=controller(f.memory,f.identity);
 assert.equal(read({operation:'contexts'}).state,'ready');assert.equal(read({operation:'browse',context:f.c.sessionId}).total,1);
 assert.throws(()=>read({operation:'forget',context:f.c.sessionId,id:row.id,revision:1}),/read only/);
 f.issued.delete(f.c);const empty=read({operation:'contexts'});assert.equal(empty.state,'no_active_context');assert.deepEqual(empty.contexts,[]);assert.equal(empty.writable,false);
 assert.throws(()=>read({operation:'browse',context:f.c.sessionId}),/Unauthorized/);
 }finally{f.memory.close();}
});
test('Inspector L1/L2/L3, filters, links and pagination use authorized contexts',()=>{
 const f=fixture();try{const row=f.add();for(let n=2;n<8;n++)f.add('另一条测试经历 '+n,n);
 assert.equal(f.call('browse',{filter:{layer:'l2',query:'长期'}}).total,1);
 assert.equal(f.call('browse',{filter:{layer:'l2',offset:2,limit:2}}).items.length,2);
 assert(f.call('browse',{filter:{layer:'l1'}}).items.some(e=>e.memories.includes(row.id)));
 assert(f.call('browse',{filter:{layer:'l3'}}).items[0].refs.some(r=>r.id===row.id));
 assert.equal(f.call('stats').l2,7);assert.equal(f.call('detail',{id:row.id}).revisions.length,1);
 assert.throws(()=>f.api({operation:'browse',context:'other'}),/Unauthorized/);
 assert.throws(()=>f.api({operation:'browse',context:f.c.sessionId,principalId:'test-owner'}),/Unknown/);
 assert.throws(()=>f.memory.browse({...f.c}),/Unauthorized/);
 const foreign={sessionId:'foreign'};f.issued.set(foreign,{...f.scope,projectId:'foreign'});assert.equal(f.memory.browse(foreign).total,0);assert.throws(()=>f.memory.revisionHistory(foreign,row.id));
 f.issued.delete(f.c);assert.equal(f.api({operation:'contexts'}).contexts.length,1); // only the independently authorized foreign context
 assert.throws(()=>f.call('detail',{id:row.id}),/Unauthorized/);
 }finally{f.memory.close();}
});
test('Inspector CAS, safe metadata restoration, correction and forget prevent history resurrection',()=>{
 const f=fixture();try{const r=f.add();const confirmed=f.call('confirm',{id:r.id,revision:1});
 assert.throws(()=>f.call('correct',{id:r.id,revision:1,statement:'过时编辑'}),/conflict/);
 const restored=f.call('restore',{id:r.id,revision:confirmed.revision,targetRevision:1});assert.equal(restored.revision,3);
 const fixed=f.call('correct',{id:r.id,revision:3,statement:'纠正后的长期偏好'});assert.equal(fixed.revision,4);
 assert(f.call('detail',{id:r.id}).revisions.filter(x=>x.revision<4).every(x=>x.redacted&&!x.statement&&x.source==='{}'));
 assert.throws(()=>f.call('restore',{id:r.id,revision:4,targetRevision:1}),/Retired/);
 f.call('forget',{id:r.id,revision:4});const detail=f.call('detail',{id:r.id});assert(detail.revisions.every(x=>!x.statement&&x.source==='{}'));assert(!detail.memory.statement);assert(detail.evidence.every(e=>!e.body));
 const empty=f.call('browse',{filter:{layer:'l3'}});assert.equal(empty.total,0);assert.deepEqual(empty.items,[]);assert.deepEqual(empty.refs,[]);
 assert.throws(()=>f.add(),/Retired|resurrect/);assert.throws(()=>f.call('confirm',{id:r.id,revision:5}),/Invalidated/);
 assert.throws(()=>controller(f.memory,f.identity)({operation:'forget',context:f.c.sessionId,id:r.id,revision:5}),/read only/);
 }finally{f.memory.close();}
});
test('Inspector rejects Character personal records in Assistant mode and reports failed jobs',async()=>{
 const f=fixture();try{
 f.memory.enqueue(f.c,{sessionId:f.c.sessionId,eventSeq:1,messageId:'a',origin:'direct_user',text:'周一一起排查了一个界面问题。'});
 f.memory.enqueue(f.c,{sessionId:f.c.sessionId,eventSeq:2,messageId:'b',origin:'direct_user',text:'周五再次一起排查了界面问题。'});
 const input=f.memory.consolidationInput(f.c);f.memory.applyConsolidation(f.c,input,{memories:[{purpose:'relationship',kind:'episodic',statement:'双方有一起排查界面问题的经历。',evidence:input.events.map(e=>({id:e.id,quote:e.text}))}]});
 assert.equal(f.memory.browse(f.c).total,1);f.scope.memoryMode='assistant';assert.equal(f.memory.browse(f.c).total,0);
 await assert.rejects(()=>f.memory.consolidate(f.c,()=>{throw Error('fixture failure');},{force:true}));
 assert(f.call('browse',{filter:{layer:'jobs',status:'failed'}}).items.some(r=>r.error==='consolidation_rejected'));
 }finally{f.memory.close();}
});
test('Inspector revisions and forget barriers survive SQLite reopen without schema migration',()=>{
 const f=fixture();const row=f.add();f.call('forget',{id:row.id,revision:1});f.memory.close();
 const reopened=new LayeredMemory(f.file,f.authorize);try{
  assert.equal(reopened.inspectorStats(f.c).schema,3);assert.equal(reopened.get(f.c,row.id).revision,2);
  assert(reopened.revisionHistory(f.c,row.id).every(r=>r.redacted&&!r.statement&&r.source==='{}'));
  assert.throws(()=>reopened.restoreRevision(f.c,row.id,1,2,{sessionId:f.c.sessionId,eventSeq:5,messageId:'restore',origin:'direct_user'}),/Retired/);
  assert.equal(reopened.projection(f.c).refs.length,0);
 }finally{reopened.close();}
});
test('Origin Agent filter narrows shared L1 and general L2 without widening personal ACL',()=>{
 const f=fixture();try{
  const own=f.add(),other={sessionId:'second-agent-session'};f.issued.set(other,{...f.scope,agentId:'b'});
  const r=f.memory.remember(other,{kind:'semantic',statement:'第二个 Agent 提交的共享事实'},{sessionId:other.sessionId,eventSeq:1,messageId:'other-event',origin:'direct_user'});
  assert.deepEqual(f.memory.browse(f.c,{agent:'a'}).items.map(x=>x.id),[own.id]);
  assert.deepEqual(f.memory.browse(f.c,{agent:'b'}).items.map(x=>x.id),[r.id]);
  assert.equal(f.memory.browse(f.c,{layer:'l1',agent:'b'}).total,1);
  assert.equal(f.memory.browse(f.c,{agent:'unrelated'}).total,0);
  assert.equal(f.memory.browse(f.c,{layer:'l3',agent:'b'}).total,0);
 }finally{f.memory.close();}
});
test('HTTP boundary enforces local Host auth, CSRF, owner, body limit and disposal',async()=>{
 let origin,closed=false,role='owner',calls=0;const server=createServer(handler({origin:()=>origin,isClosed:()=>closed,connection:{admit:r=>r.headers.cookie==='fixture'?{peer:{principal:{kind:role}}}:{rejection:401}},assets:new Map(),dispatch:()=>{calls++;return {ok:true};}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const request=(headers={},body='{}')=>fetch(origin+'/memory-inspector/api',{method:'POST',headers:{'content-type':'application/json',origin,...headers},body});
 try{assert.equal((await request()).status,401);assert.equal((await request({cookie:'fixture',origin:'https://foreign.invalid'})).status,403);
 role='guest';assert.equal((await request({cookie:'fixture'})).status,403);role='owner';assert.equal((await request({cookie:'fixture'},'x'.repeat(17000))).status,413);
 assert.equal((await request({cookie:'fixture'})).status,200);assert.equal(calls,1);closed=true;assert.equal((await request({cookie:'fixture'})).status,503);
 }finally{await new Promise(r=>server.close(r));}
});

test('Native RPC envelope preserves correlation, CAS errors and Desktop relay auth fences',async()=>{
 let origin,calls=0;const server=createServer(handler({origin:()=>origin,connection:{admit:r=>r.headers.cookie==='fixture'?{peer:{principal:{kind:'owner'}}}:{rejection:401}},assets:new Map(),dispatch:body=>{calls++;if(body.operation==='stale')throw Error('Revision conflict');return {contexts:[]};}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const call=(payload,headers={},envelope={})=>fetch(origin+'/memory-inspector/api',{method:'POST',headers:{cookie:'fixture','content-type':'application/json',...headers},body:JSON.stringify({type:'client-request',rpcId:'fixture-rpc',method:'api',payload,...envelope})});
 try{
  const web=await (await call({operation:'contexts'},{origin})).json();assert.equal(web.rpcId,'fixture-rpc');assert.equal(web.result.ok,true);
  assert.equal((await (await call({operation:'contexts'})).json()).result.ok,true); // owned Desktop relay has no Origin
  assert.equal((await call({}, {cookie:''})).status,401);
  assert.equal((await call({}, {origin:'null'})).status,403);
  assert.equal((await call({}, {'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await call({}, {origin:'https://foreign.invalid'})).status,403);
  assert.equal((await call({}, {},{method:'wrong'})).status,400);
  const stale=await (await call({operation:'stale'})).json();assert.equal(stale.rpcId,'fixture-rpc');assert.equal(stale.result.error.code,'memory/409');assert.equal(calls,3);
 }finally{await new Promise(r=>server.close(r));}
});
