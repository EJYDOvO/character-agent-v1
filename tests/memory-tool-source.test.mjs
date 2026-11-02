import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
import {processJob} from '../packages/character-memory-core/extraction.mjs';

function fixture(file=':memory:'){
 const handle={sessionId:'synthetic-session'},scope={principalId:'owner',namespaceId:'memory',projectId:'test',agentId:'root',memoryMode:'off'};
 const store=new LayeredMemory(file,c=>{if(c!==handle)throw Error('Unauthorized');return scope;});
 const definitions=new Map(),identity={contractVersion:1,forSession:id=>{assert.equal(id,handle.sessionId);return handle;}};
 const source=fs.readFileSync(new URL('../packages/character-memory-tools/index.mjs',import.meta.url),'utf8').replace(/^import[^\r\n]*\r?\n/u,'').replaceAll('export ','');
 const apply=vm.runInNewContext(source+';apply;',{defineTool:d=>d});
 apply({get:key=>key==='memoryIdentity'?identity:store,tools:{register:d=>definitions.set(d.name,d)},systemPrompt:{context(){}}});
 const call=(name,args,seq=9)=>definitions.get('memory_'+name).execute(args,{agent:{session:{header:{id:handle.sessionId},seq}}}).then(JSON.parse);
 const input={sessionId:handle.sessionId,eventSeq:1,messageId:'synthetic-input',origin:'direct_user',text:'请记住：我的测试项目代号是 QA-PENGUIN-739。这是虚构数据。'};
 return {store,handle,identity,call,input,scope};
}
test('manual Memory tool links trusted L1; forgetting defeats a paraphrased extraction already in flight',async()=>{
 const f=fixture();try{
  f.store.enqueue(f.handle,f.input);
  const memory=await f.call('remember',{kind:'semantic',statement:'测试项目代号是 QA-PENGUIN-739。'});
  assert.equal(memory.status,'uncertain','linking an input does not turn model inference into a confirmed fact');
  const job=f.store.db.prepare('SELECT * FROM extraction_jobs').get();let resolve,started;
  const ready=new Promise(r=>started=r),pending=processJob(f.store,f.identity,job,()=>{started();return new Promise(r=>resolve=r);});
  await ready;await f.call('forget',{id:memory.id,revision:memory.revision});
  resolve(JSON.stringify({memories:[{kind:'semantic',statement:'用户当前的项目测试标识为 QA-PENGUIN-739。',quote:f.input.text}]}));
  assert.equal((await pending).saved,0,'old L1 must not create a new differently worded L2');
  assert.equal(f.store.trace(f.handle,memory.id).evidence[0].status,'retired');
  assert.equal(f.store.recall(f.handle,'QA-PENGUIN',16000).length,0);
 }finally{f.store.close();}
});
test('manual correction uses new trusted input and retires the original evidence',async()=>{
 const f=fixture();try{
  f.store.enqueue(f.handle,f.input);const row=await f.call('remember',{kind:'semantic',statement:'测试项目使用旧代号。'});
  f.store.noteInput(f.handle,{...f.input,eventSeq:10,messageId:'correction',text:'更正：测试项目使用新的虚构代号。'});
  const corrected=await f.call('correct',{id:row.id,statement:'测试项目使用新代号。',revision:row.revision},12);
  const trace=f.store.trace(f.handle,row.id);assert.equal(trace.evidence.length,1);assert.equal(trace.evidence[0].source_key,'synthetic-session:correction');
  assert.equal(JSON.parse(corrected.source).origin,'inference');
  assert.equal(f.store.db.prepare('SELECT status FROM experiences WHERE source_key=?').get('synthetic-session:synthetic-input').status,'retired');
 }finally{f.store.close();}
});
test('latest rejected, future and cross-session evidence cannot silently reuse an earlier source',async()=>{
 const f=fixture();try{
  await assert.rejects(f.call('remember',{kind:'semantic',statement:'没有来源的猜测。'}),/source/i);
  f.store.enqueue(f.handle,f.input);
  f.store.noteInput(f.handle,{...f.input,eventSeq:10,messageId:'sensitive',text:'api_key=sk-secret-test-value-1234567890123456'});
  await assert.rejects(f.call('remember',{kind:'semantic',statement:'无关的可见事实。'},12),/source|evidence/i);
  f.store.noteInput(f.handle,{...f.input,eventSeq:20,messageId:'future',text:'这是另一条正常的用户消息。'});
  await assert.rejects(f.call('remember',{kind:'semantic',statement:'不能使用未来证据。'},12),/source|evidence/i);
  assert.throws(()=>f.store.toolSource({...f.handle},30),/Unauthorized/);
 }finally{f.store.close();}
});
test('short trusted input is admitted on explicit save; old lineage and redaction survive mode switches and restart',async t=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'tool-lineage-')),file=join(dir,'memory.sqlite');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let f=fixture(file),id;try{
  f.store.noteInput(f.handle,{...f.input,text:'喜欢雨天'});const row=await f.call('remember',{kind:'semantic',statement:'用户喜欢阴雨天气。'});id=row.id;
  assert.equal(f.store.trace(f.handle,id).evidence.length,1);
  const confirmed=f.store.confirm(f.handle,id,row.revision,{sessionId:f.handle.sessionId,eventSeq:10,messageId:'trusted-confirmation',origin:'direct_user'});
  await f.call('forget',{id,revision:confirmed.revision});
 }finally{f.store.close();}
 f=fixture(file);try{for(const mode of ['off','assistant','character']){
  f.scope.memoryMode=mode;const detail=f.store.trace(f.handle,id);assert.equal(detail.memory.statement,'');assert.equal(detail.evidence[0].body,'');assert.equal(detail.evidence[0].status,'retired');
  assert.equal(f.store.projection(f.handle).refs.length,0);
 }}finally{f.store.close();}
});
test('legacy unlinked forgotten inference holds old evidence across restart/modes without deleting L1 or calling a model',async t=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'legacy-tool-lineage-')),file=join(dir,'memory.sqlite');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let f=fixture(file);try{
  f.store.enqueue(f.handle,f.input);
  const row=f.store.remember(f.handle,{kind:'semantic',statement:'测试项目使用代号 QA-PENGUIN-739。'},{sessionId:f.handle.sessionId,eventSeq:9,origin:'inference'});
  const job=f.store.db.prepare('SELECT * FROM extraction_jobs').get();f.store.forget(f.handle,row.id,1);
  let calls=0;await assert.rejects(processJob(f.store,f.identity,job,async()=>{calls++;return '{"memories":[]}';}),e=>e.code==='MEMORY_SOURCE_REVIEW');
  assert.equal(calls,0);assert.equal(f.store.consolidationInput(f.handle).events.length,0);
  assert.equal(f.store.db.prepare('SELECT status FROM experiences').get().status,'active','do not invent an association or destroy other evidence');
  const otherSession={...f.input,originalSessionId:'another-session'};assert.doesNotThrow(()=>f.store.assertReusableEvidence(f.handle,otherSession));
  f.scope.projectId='another-project';assert.doesNotThrow(()=>f.store.assertReusableEvidence(f.handle,f.input));f.scope.projectId='test';
  f.store.noteInput(f.handle,{...f.input,eventSeq:10,messageId:'new-input',text:'这是新的独立事实来源。'});
  await f.call('remember',{kind:'semantic',statement:'新的独立事实。'},12);
  assert.throws(()=>f.store.assertReusableEvidence({...f.handle},f.input),/Unauthorized/);
 }finally{f.store.close();}
 f=fixture(file);try{for(const mode of ['off','assistant','character']){
  f.scope.memoryMode=mode;assert.throws(()=>f.store.assertReusableEvidence(f.handle,f.input),e=>e.code==='MEMORY_SOURCE_REVIEW');
  assert(f.store.consolidationInput(f.handle).events.every(e=>e.text!==f.input.text));
 }}finally{f.store.close();}
});
