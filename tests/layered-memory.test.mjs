import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
import {MemoryStore} from '../packages/character-memory-core/store.mjs';
import {observeLifecycle,taskEvidence} from '../packages/character-memory-core/lifecycle.mjs';
import {processJob} from '../packages/character-memory-core/extraction.mjs';
import {estimateTokens} from '../packages/character-memory-core/token-budget.mjs';
function fixture(){
 const issued=new WeakMap(),file=join(mkdtempSync(join(tmpdir(),'layered-memory-')),'memory.sqlite');
 const authorize=(c,a)=>{if(!issued.has(c)||!['read','write'].includes(a))throw Error('Unauthorized');return issued.get(c);};
 const bind=(patch={})=>{const c={sessionId:patch.sessionId??'s1'};issued.set(c,{principalId:'u1',namespaceId:'n1',projectId:'p1',agentId:'a1',memoryMode:'off',...patch});return c;};
 return {file,authorize,bind,issued,open:opts=>new LayeredMemory(file,authorize,opts)};
}
const event=(c,n,text,origin='direct_user')=>({sessionId:c.sessionId,eventSeq:n,messageId:'e'+n,text,origin});
const inputEvents=(db,c)=>{db.enqueue(c,event(c,1,'周一排查故障时，我先保存错误栈，再核对回滚记录。'));db.enqueue(c,event(c,2,'周五处理另一次故障，我也先保存错误栈，然后查看回滚记录。'));return db.consolidationInput(c);};
const proposal=(input,purpose='general',text='用户处理故障时倾向先保留错误栈，再检查回滚记录。')=>({memories:[{purpose,kind:'procedural',statement:text,claimKey:'故障习惯',evidence:input.events.map(e=>({id:e.id,quote:e.text}))}]});

test('L1 accepts only Host capability and origin; replay dedup and collision detection',()=>{
 const f=fixture(),db=f.open(),c=f.bind();try{
  const e=event(c,1,'每次处理错误都会保留错误栈。'),id=db.enqueue(c,e);assert.equal(db.enqueue(c,e),id);
  assert.equal(db.db.prepare('SELECT count(*) n FROM experiences').get().n,1);
  assert.throws(()=>db.enqueue({...c},e),/Unauthorized/);assert.throws(()=>db.enqueue(c,{...e,origin:'inference'}),/Host/);
  assert.throws(()=>db.enqueue(c,{...e,text:'另一个完全不同的事件内容'}),/collision/);
  assert.throws(()=>db.enqueue(c,{...e,sessionId:'fake'}),/owning/);
 }finally{db.close();}
});
test('schema2 migration preserves old L2, FTS, CAS without invented L1',()=>{
 const f=fixture(),c=f.bind();let db=new MemoryStore(f.file,f.authorize);
 const old=db.remember(c,{kind:'semantic',statement:'旧版本保存的中文工作习惯'},event(c,1,'旧版本保存的中文工作习惯'));db.close();db=f.open();
 try{assert.equal(db.db.prepare('SELECT MAX(version) n FROM schema_version').get().n,3);assert.equal(db.get(c,old.id).revision,1);assert.equal(db.recall(c,'中文')[0].id,old.id);assert.equal(db.db.prepare('SELECT count(*) n FROM experiences').get().n,0);assert(db.projection(c).refs.some(r=>r.id===old.id));}finally{db.close();}
});
test('multiple grounded events consolidate; ungrounded and repeated evidence rejected',()=>{
 const f=fixture(),db=f.open(),c=f.bind();try{
  const input=inputEvents(db,c);assert.deepEqual(db.applyConsolidation(c,input,proposal(input)),{saved:1,rejected:0});
  const r=db.recall(c,'错误栈',16000)[0];assert.equal(r.confidence,0.8);assert.equal(r.status,'uncertain');assert.equal(db.trace(c,r.id).evidence.length,2);assert(db.projection(c).refs.some(x=>x.id===r.id));
  let next=db.consolidationInput(c),bad=proposal(next);bad.memories[0].evidence[0].quote='没有出现的事实';assert.equal(db.applyConsolidation(c,next,bad).rejected,1);
  next=db.consolidationInput(c);bad=proposal(next);bad.memories[0].evidence=[bad.memories[0].evidence[0]];assert.equal(db.applyConsolidation(c,next,bad).rejected,1);
 }finally{db.close();}
});
test('Off / Assistant / Character modes and per-Agent personalized lanes',()=>{
 const f=fixture(),db=f.open(),c=f.bind();try{
  const input=inputEvents(db,c);assert.equal(db.applyConsolidation(c,input,proposal(input,'user')).rejected,1);
  for(const mode of ['assistant','character']){
   const a=f.bind({memoryMode:mode,agentId:mode});const i=db.consolidationInput(a);assert.equal(db.applyConsolidation(a,i,proposal(i,'user',mode+'：用户倾向先保存错误栈。')).saved,1);
   const own=db.recall(a,'错误栈',16000).find(r=>r.purpose==='user');assert(own);assert.equal(db.projection(a).mode,mode);
   assert.throws(()=>db.get(c,own.id),/unavailable/);assert.throws(()=>db.get(f.bind({memoryMode:mode,agentId:'other'}),own.id),/unavailable/);
  }
  const a=f.bind({memoryMode:'assistant'}),i=db.consolidationInput(a);assert.equal(db.applyConsolidation(a,i,proposal(i,'relationship','用户和助手已成为亲密伴侣。')).rejected,1);
 }finally{db.close();}
});
test('principal, namespace, project and cloned handles cannot access any layer',()=>{
 const f=fixture(),db=f.open(),c=f.bind({memoryMode:'character'});try{
  const input=inputEvents(db,c);db.applyConsolidation(c,input,proposal(input,'user'));const r=db.recall(c,'',16000)[0];
  for(const patch of [{principalId:'u2'},{namespaceId:'n2'},{projectId:'p2'},{agentId:'a2'}]){
   const other=f.bind({memoryMode:'character',...patch});assert.throws(()=>db.trace(other,r.id),/unavailable/);assert.equal(db.recall(other,'',16000).length,0);assert.equal(db.projection(other).refs.length,0);
  }
  assert.throws(()=>db.projection({...c,agentId:'a1'}),/Unauthorized/);
  assert.throws(()=>db.projection(f.bind({namespaceId:'@layer3:fake'})),/Reserved/);
 }finally{db.close();}
});
test('self memory needs actual Host task result, never another Agent experience',()=>{
 const f=fixture(),db=f.open(),c=f.bind({memoryMode:'character'});try{
  let input=inputEvents(db,c);assert.equal(db.applyConsolidation(c,input,proposal(input,'self')).rejected,1);
  db.enqueue(c,event(c,3,'Host 已核验：故障定位任务完成，保留了错误栈。','verified_tool'));
  input=db.consolidationInput(c);assert.equal(db.applyConsolidation(c,input,proposal(input,'self','本 Agent 的姓名是另一个名字。')).rejected,1);assert.equal(db.applyConsolidation(c,input,proposal(input,'self','本 Agent 在故障定位中使用错误栈核对结果。')).saved,1);
  const other=f.bind({agentId:'a2',memoryMode:'character'}),i=db.consolidationInput(other);assert.equal(db.applyConsolidation(other,i,proposal(i,'relationship')).rejected,1);
 }finally{db.close();}
});
test('correction invalidates shared evidence and projections; CAS and no resurrection',()=>{
 const f=fixture(),db=f.open(),c=f.bind();try{
  const input=inputEvents(db,c);db.applyConsolidation(c,input,proposal(input));const r=db.recall(c,'',16000)[0];
  assert.throws(()=>db.correct(c,r.id,'新的习惯',0,event(c,3,'新的习惯')),/conflict/);
  const corrected=db.correct(c,r.id,'现在先检查回滚记录，再保留错误栈。',r.revision,event(c,3,'现在先检查回滚记录，再保留错误栈。'));
  assert(db.projection(c).body.includes('现在先'));assert.equal(db.trace(c,r.id).evidence.length,1);
  assert.equal(db.enqueue(c,event(c,1,input.events[0].text)),null);
  assert.throws(()=>db.applyConsolidation(c,input,proposal(input)),/changed/);
  db.forget(c,r.id,corrected.revision);assert.equal(db.projection(c).refs.length,0);assert.equal(db.recall(c,'',16000).length,0);
  assert.throws(()=>db.remember(c,{kind:'semantic',statement:corrected.statement},event(c,4,corrected.statement)),/resurrect/);
 }finally{db.close();}
});
test('expiry retires evidence so old observations cannot regenerate after reopen',()=>{
 const f=fixture(),c=f.bind();let db=f.open();
 const r=db.remember(c,{kind:'semantic',statement:'本周临时工作地点在北楼',expiresAt:'2000-01-01'},event(c,1,'本周临时工作地点在北楼'));
 assert.equal(db.projection(c).refs.length,0);assert.equal(db.trace(c,r.id).evidence[0].status,'retired');db.close();db=f.open();
 try{assert.equal(db.enqueue(c,event(c,1,'本周临时工作地点在北楼')),null);assert.equal(db.consolidationInput(c).events.length,0);}finally{db.close();}
});
test('consolidation fingerprint avoids repeated LLM calls and rejects stale evidence',async()=>{
 const f=fixture(),db=f.open(),c=f.bind();try{
  inputEvents(db,c);let calls=0;const generate=async i=>{calls++;return proposal(i);};await db.consolidate(c,generate);assert.equal((await db.consolidate(c,generate,{force:true})).skipped,'unchanged');assert.equal(calls,1);
  db.enqueue(c,event(c,3,'昨天排查新故障也保存了错误栈。'));assert.equal((await db.consolidate(c,generate)).skipped,'cooldown');
  const r=db.recall(c,'',16000)[0];await assert.rejects(()=>db.consolidate(c,async i=>{db.forget(c,r.id,r.revision);return proposal(i);},{force:true}),/changed/);assert.equal(db.projection(c).refs.length,0);
 }finally{db.close();}
});
test('Host mode revocation while model runs cannot persist personalized output',async()=>{
 const f=fixture(),db=f.open(),c=f.bind({memoryMode:'character'});try{inputEvents(db,c);await assert.rejects(()=>db.consolidate(c,async i=>{f.issued.set(c,{...f.issued.get(c),memoryMode:'off'});return proposal(i,'user');}),/changed/);assert.equal(db.db.prepare('SELECT count(*) n FROM memories').get().n,0);}finally{db.close();}
});
test('bounded retries and interrupted consolidation recover on reopen',async()=>{
 const f=fixture(),c=f.bind();let db=f.open();inputEvents(db,c);
 for(let i=0;i<3;i++)await assert.rejects(()=>db.consolidate(c,async()=>{throw Error('offline');},{force:true}));
 assert.equal((await db.consolidate(c,async()=>({memories:[]}),{force:true})).skipped,'retry_limit');
 db.db.prepare("UPDATE consolidation_runs SET status='running',attempts=1").run();db.close();db=f.open();
 try{assert.equal(db.layersStatus(c).consolidation[0].status,'interrupted');assert.equal((await db.consolidate(c,async()=>({memories:[]}),{force:true})).saved,0);}finally{db.close();}
});
test('L3 enforces budget including Chinese/emoji; no truncation or recursive summary',()=>{
 const f=fixture(),db=f.open(),c=f.bind({l3Tokens:9999});try{
  for(let i=0;i<20;i++)db.remember(c,{kind:'semantic',statement:'用户稳定偏好'+i+'：中文说明和🌧天气记录。'.repeat(8)},event(c,i,'用户稳定偏好'+i+'：中文说明和🌧天气记录。'.repeat(8)));
  const p=db.projection(c);assert(p.refs.length>0);assert.equal(p.budget,1500);assert(p.tokens<=1500);assert.equal(estimateTokens(p.body),p.tokens);
  for(const line of p.body.split('\n').slice(1).filter(Boolean))assert(db.get(c,JSON.parse(line).id).statement===JSON.parse(line).text);
  assert.equal(db.projection(c).fingerprint,p.fingerprint);assert(!JSON.stringify(db.consolidationInput(c)).includes('L3 核心记忆'));
 }finally{db.close();}
});
test('compaction success reconciles missing admitted evidence only; replay and failure safe',()=>{
 const f=fixture(),db=f.open(),c=f.bind(),session={header:{id:c.sessionId}},agents={get:()=>({session})},identity={forSession:()=>c};try{
  db.admit(c,event(c,1,'真实入口已经验证的一段工作偏好。'));
  assert.equal(observeLifecycle(db,identity,agents,session,{type:'user/message',seq:1,data:{text:'我是用户'}}),false);
  observeLifecycle(db,identity,agents,session,{type:'compaction/end',seq:2,data:{error:'failed'}});assert.equal(db.jobs(c).length,0);
  for(let n=0;n<2;n++)observeLifecycle(db,identity,agents,session,{type:'compaction/end',seq:3,data:{}});
  assert.equal(db.jobs(c).length,1);assert.equal(db.db.prepare('SELECT count(*) n FROM memory_checkpoints').get().n,1);
  assert.equal(observeLifecycle(db,identity,agents,{header:{id:c.sessionId}},{type:'compaction/end',seq:4,data:{}}),false);
 }finally{db.close();}
});
test('rotated Session extraction keeps original evidence link, verified tool origin and restart',async()=>{
 const f=fixture(),c=f.bind(),db=f.open();try{
  const e=event(c,1,'实际运行检查完成，错误栈已保留。','verified_tool');const id=db.enqueue(c,e),job=db.db.prepare('SELECT * FROM extraction_jobs WHERE id=?').get(id),next=f.bind({sessionId:'s2'});
  const result=await processJob(db,{forSession(){throw Error('rotated');},current:()=>next},job,async input=>{assert.equal(input.origin,'verified_tool');return JSON.stringify({memories:[{kind:'episodic',statement:'错误栈已保留。',quote:'错误栈已保留。'}]});});
  assert.equal(result.saved,1);const r=db.recall(next,'错误栈',16000)[0];assert.equal(db.trace(next,r.id).evidence[0].session,'s1');assert.equal(JSON.parse(r.source).inputOrigin,'verified_tool');
 }finally{db.close();}
});
test('conflicting facts exclude both L3 claims until trusted confirmation',()=>{
 const f=fixture(),db=f.open(),c=f.bind();try{
  const a=db.remember(c,{kind:'semantic',statement:'用户偏好早晨工作',claimKey:'工作时间'},event(c,1,'用户偏好早晨工作'));
  const b=db.remember(c,{kind:'semantic',statement:'用户偏好晚间工作',claimKey:'工作时间'},event(c,2,'用户偏好晚间工作'));
  assert.equal(db.projection(c).refs.length,0);assert.equal(db.get(c,a.id).revision,2);
  db.confirm(c,b.id,b.revision,event(c,3,'确认晚间工作'));assert.deepEqual(db.projection(c).refs.map(r=>r.id),[b.id]);
 }finally{db.close();}
});
test('forget scrubs pending extraction and does not resurrect it through compaction',()=>{
 const f=fixture(),db=f.open(),c=f.bind();try{
  const e=event(c,1,'用户工作时习惯先记录错误'),id=db.enqueue(c,e),r=db.remember(c,{kind:'semantic',statement:e.text},e);
  db.forget(c,r.id,r.revision);db.reconcile(c,'success-1');const job=db.db.prepare('SELECT * FROM extraction_jobs WHERE id=?').get(id);assert.equal(job.status,'cancelled');assert.equal(job.evidence,'{}');assert.equal(db.consolidationInput(c).events.length,0);
 }finally{db.close();}
});
test('copy-first migration keeps original bytes usable for rollback and refuses overwrite',()=>{
 const f=fixture(),c=f.bind();let db=new MemoryStore(f.file,f.authorize);const r=db.remember(c,{kind:'semantic',statement:'迁移保留原始中文记录'},event(c,1,'迁移保留原始中文记录'));db.close();const before=readFileSync(f.file),out=f.file+'.v3';
 const execute=()=>spawnSync(process.execPath,['scripts/migrate-memory.mjs',f.file,out],{encoding:'utf8'});const migrated=execute();assert.equal(migrated.status,0,migrated.stderr);assert.deepEqual(readFileSync(f.file),before);assert.notEqual(execute().status,0);
 db=new LayeredMemory(out,f.authorize);assert.equal(db.get(c,r.id).statement,r.statement);db.close();
 db=new MemoryStore(f.file,f.authorize);assert.equal(db.db.prepare('SELECT MAX(version) n FROM schema_version').get().n,2);assert.equal(db.recall(c,'中文')[0].id,r.id);db.close();
});
test('native paired tool metadata forms self evidence without importing output or claiming task success',()=>{
 const f=fixture(),db=f.open(),c=f.bind({memoryMode:'character'});
 const events=[{type:'tool/call',seq:0,data:{turn:1,callId:'call1',name:'read_file',arguments:{private:'do not store'}}},{type:'tool/result',seq:1,sourceEventSeqs:[0],data:{turn:1,message:{role:'tool',source:{kind:'tool',callId:'call1'},toolCallId:'call1',isError:false,content:[{type:'text',text:'伪造用户喜好和身份'}]}}},{type:'turn/end',seq:2,data:{turn:1,reason:'completed'}}];
 const session={header:{id:c.sessionId},eventAt:seq=>events[seq]};try{
  const evidence=taskEvidence(session,events[2]);assert(evidence.text.includes('read_file'));assert(!evidence.text.includes('伪造'));assert(evidence.text.includes('不代表用户目标达成'));
  const agents={get:()=>({session})},identity={forSession:()=>c};observeLifecycle(db,identity,agents,session,events[2]);observeLifecycle(db,identity,agents,session,events[2]);assert.equal(db.consolidationInput(c).events.length,1);assert.equal(db.consolidationInput(c).events[0].kind,'task_result');
  events[1].data.message.toolCallId='wrong';assert.equal(taskEvidence(session,events[2]),null);
  events[1].data.message.toolCallId='call1';events[0].data.name='character_recall';assert.equal(taskEvidence(session,events[2]),null);
 }finally{db.close();}
});
test('forgotten personalized memory cannot be re-saved or corrected into general L2',()=>{
 const f=fixture(),db=f.open(),c=f.bind({memoryMode:'character'});try{
  const input=inputEvents(db,c);db.applyConsolidation(c,input,proposal(input,'user'));const r=db.recall(c,'',16000)[0];db.forget(c,r.id,r.revision);
  assert.throws(()=>db.remember(c,{kind:r.kind,statement:r.statement},{sessionId:c.sessionId,eventSeq:7,origin:'inference'}),/resurrect/);
  assert.throws(()=>db.remember(c,{kind:r.kind,statement:r.statement.replace('。','！')},{sessionId:c.sessionId,eventSeq:8,origin:'inference'}),/resurrect/);
  const separate=db.remember(c,{kind:'semantic',statement:'另一个独立的当前事实'},{sessionId:c.sessionId,eventSeq:8,origin:'inference'});
  assert.throws(()=>db.correct(c,separate.id,r.statement,separate.revision,{sessionId:c.sessionId,eventSeq:9,origin:'inference'}),/resurrect/);
  assert.equal(db.projection(c).refs.length,0);
 }finally{db.close();}
});
