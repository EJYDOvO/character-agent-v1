import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
import {verifyCompaction,verifyExtraction,verifyRestart} from './probe-verification.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let seq=0;
const event=(c,text,origin='direct_user')=>({sessionId:c.sessionId,eventSeq:++seq,messageId:'audit-'+seq,text,origin});
function fixture(t,mode='character'){
  const dir=fs.mkdtempSync(path.join(tmpdir(),'memory-audit-fix-')),file=path.join(dir,'memory.sqlite'),issued=new WeakMap();
  const authorize=(c,a)=>{if(!issued.has(c)||!['read','write'].includes(a))throw Error('Unauthorized');return issued.get(c);};
  const bind=(patch={})=>{const c={sessionId:patch.sessionId??'s1'};issued.set(c,{principalId:'owner',namespaceId:'namespace',projectId:'project',agentId:'agent',memoryMode:mode,...patch});return c;};
  const f={dir,file,issued,authorize,bind,c:bind(),db:new LayeredMemory(file,authorize)};t.after(()=>f.db.close());return f;
}
const add=(f,text,patch={})=>f.db.remember(f.c,{kind:'semantic',statement:text,...patch},event(f.c,text));
function seed(f){f.db.admit(f.c,event(f.c,'周一处理故障先记录错误栈。'));f.db.admit(f.c,event(f.c,'周二处理另一项故障也记录错误栈。','verified_tool'));}
function personal(f,purpose,statement,claimKey=statement){
  const input=f.db.consolidationInput(f.c),result=f.db.applyConsolidation(f.c,input,{memories:[{purpose,kind:'procedural',statement,claimKey,evidence:input.events.slice(0,2).map(e=>({id:e.id,quote:e.text}))}]});
  assert.equal(result.saved,1);return f.db.db.prepare('SELECT * FROM memories WHERE statement=?').get(statement);
}

test('same Agent mode changes enforce policy on every read, with legacy-safe reopen',t=>{
  const f=fixture(t);seed(f);const relationship=personal(f,'relationship','用户与本 Agent 是亲密伴侣。'),self=personal(f,'self','本 Agent 有故障排查的工具执行记录。');
  f.issued.get(f.c).memoryMode='assistant';
  for(const r of [relationship,self]){assert.throws(()=>f.db.get(f.c,r.id),/unavailable/);assert.throws(()=>f.db.inspect(f.c,r.id),/unavailable/);assert.throws(()=>f.db.trace(f.c,r.id),/unavailable/);}
  assert.equal(f.db.recall(f.c,'',16000).length,0);assert.equal(f.db.projection(f.c).refs.length,0);assert(!f.db.context(f.c).includes('亲密伴侣'));
  f.issued.get(f.c).memoryMode='character';assert(f.db.get(f.c,relationship.id));
  const source=JSON.parse(relationship.source);delete source.memoryPolicy;f.db.db.prepare('UPDATE memories SET source=? WHERE id=?').run(JSON.stringify(source),relationship.id);
  f.db.close();f.db=new LayeredMemory(f.file,f.authorize);const assistant=f.bind({memoryMode:'assistant',sessionId:'restored'});assert.throws(()=>f.db.get(assistant,relationship.id));
  assert(f.db.get(f.c,relationship.id));assert.throws(()=>f.db.get(f.bind({agentId:'other'}),relationship.id));
  f.issued.get(f.c).memoryMode='off';assert.equal(f.db.recall(f.c,'',16000).length,0);assert.throws(()=>f.db.get(f.c,self.id));
});

test('Assistant provenance survives correction, confirmation and Character round trip',t=>{
  const f=fixture(t,'assistant');seed(f);let row=personal(f,'user','用户处理故障会记录错误栈。');
  row=f.db.correct(f.c,row.id,'用户处理故障先保存现场。',row.revision,event(f.c,'用户处理故障先保存现场。'));
  row=f.db.confirm(f.c,row.id,row.revision,event(f.c,'确认这条工作习惯。'));
  assert.equal(JSON.parse(row.source).memoryPolicy,'assistant:v1');
  f.issued.get(f.c).memoryMode='character';assert(f.db.get(f.c,row.id));f.issued.get(f.c).memoryMode='assistant';assert(f.db.get(f.c,row.id));
  assert(f.db.projection(f.c).refs.some(r=>r.id===row.id));
});

test('Assistant cannot relabel an identical Character personal record through consolidation',t=>{
  const f=fixture(t);seed(f);const row=personal(f,'user','用户处理故障先记录错误栈。');f.issued.get(f.c).memoryMode='assistant';
  const input=f.db.consolidationInput(f.c);assert.equal(f.db.applyConsolidation(f.c,input,{memories:[{purpose:'user',kind:'procedural',statement:row.statement,claimKey:row.claim_key,evidence:input.events.map(e=>({id:e.id,quote:e.text}))}]}).rejected,1);
  assert.equal(f.db.db.prepare('SELECT source FROM memories WHERE id=?').get(row.id).source,row.source);
});

test('Character correction cannot smuggle new content back under Assistant provenance',t=>{
  const f=fixture(t,'assistant');seed(f);const row=personal(f,'relationship','双方约定每周一起复盘任务。');
  assert.throws(()=>f.db.correct(f.c,row.id,'双方已成为亲密伴侣。',row.revision,event(f.c,'双方已成为亲密伴侣。')),/Assistant policy/);
  f.issued.get(f.c).memoryMode='character';const changed=f.db.correct(f.c,row.id,'双方已成为亲密伴侣。',row.revision,event(f.c,'双方已成为亲密伴侣。'));
  assert.equal(JSON.parse(changed.source).memoryPolicy,'character:v1');f.issued.get(f.c).memoryMode='assistant';assert.throws(()=>f.db.get(f.c,row.id),/unavailable/);
});

test('global recall ranks exact personal matches before general candidates at both budgets',t=>{
  const f=fixture(t);seed(f);const row=personal(f,'user','首选故障方案');for(let i=0;i<25;i++)add(f,'方案目录第 '+i+' 项常规步骤');
  for(const budget of [2400,16000])assert.equal(f.db.recall(f.c,'首选故障方案',budget)[0].id,row.id);
  for(const purpose of ['relationship','self']){const r=personal(f,purpose,purpose+' 首选故障方案');assert.equal(f.db.recall(f.c,r.statement,2400)[0].id,r.id);}
});

test('retired L1 candidates cannot starve a valid older L2',t=>{
  const f=fixture(t,'off'),valid=add(f,'有效工作习惯，处理问题先记录。');f.db.db.prepare("UPDATE memories SET updated_at='2000-01-01' WHERE id=?").run(valid.id);
  const e=event(f.c,'同一条长消息记录多条不同的工作约定。'),rows=[];for(let i=0;i<25;i++)rows.push(f.db.remember(f.c,{kind:'semantic',statement:'约定 '+i},e));
  f.db.forget(f.c,rows[0].id,rows[0].revision);assert.deepEqual(f.db.recall(f.c,'',16000).map(r=>r.id),[valid.id]);
});

test('L3 filters before selection and stable ties retain older established facts',t=>{
  const f=fixture(t,'off'),old=add(f,'长期约定：重要变更必须预留回滚。');f.db.db.prepare("UPDATE memories SET created_at='2000-01-01',updated_at='2000-01-01' WHERE id=?").run(old.id);
  for(let i=0;i<105;i++){const r=add(f,'临时条目 '+i);f.db.db.prepare("UPDATE memories SET conflict_with='fixture-conflict' WHERE id=?").run(r.id);}
  assert.deepEqual(f.db.projection(f.c).refs.map(r=>r.id),[old.id]);
  f.db.db.prepare('UPDATE memories SET conflict_with=NULL').run();assert.equal(f.db.projection(f.c).refs[0].id,old.id);
});

test('projection deduplicates across purposes and an unchanged read performs no writes',t=>{
  const f=fixture(t);seed(f);const text='日常工作报告使用简体中文。';personal(f,'user',text);add(f,text);
  const p=f.db.projection(f.c),changes=f.db.db.prepare('SELECT total_changes() n').get().n;
  assert.equal(p.body.split(text).length-1,1);assert.equal(f.db.projection(f.c).fingerprint,p.fingerprint);f.db.layersStatus(f.c);
  assert.equal(f.db.db.prepare('SELECT total_changes() n').get().n,changes);assert.equal(f.db.recall(f.c,'日常工作报告',16000).length,1);
});

test('forget also hides an already-existing duplicate in a different purpose',t=>{
  const f=fixture(t);seed(f);const text='日常报告默认使用简体中文。';const personalRow=personal(f,'user',text),general=add(f,text);
  f.db.forget(f.c,general.id,general.revision);assert.equal(f.db.recall(f.c,'简体中文',16000).length,0);assert.equal(f.db.projection(f.c).refs.length,0);assert.equal(f.db.trace(f.c,personalRow.id).valid,false);
  assert.throws(()=>f.db.confirm(f.c,personalRow.id,personalRow.revision,event(f.c,'确认日常报告习惯。')),/Invalidated/);
});

test('consolidation retains an explicit expiry and rejects invalid dates',t=>{
  const f=fixture(t);seed(f);const input=f.db.consolidationInput(f.c),candidate={purpose:'user',kind:'semantic',statement:'本月临时在北楼工作。',expiresAt:'2099-01-01',evidence:input.events.map(e=>({id:e.id,quote:e.text}))};
  assert.equal(f.db.applyConsolidation(f.c,input,{memories:[candidate]}).saved,1);assert.equal(f.db.recall(f.c,'北楼',16000)[0].expires_at,'2099-01-01T00:00:00.000Z');
  assert.equal(f.db.applyConsolidation(f.c,f.db.consolidationInput(f.c),{memories:[{...candidate,statement:'另一条临时信息',expiresAt:'invalid-date'}]}).rejected,1);
});

test('cross-purpose conflicts are visible, excluded from L3, and explicitly resolvable',t=>{
  const f=fixture(t);seed(f);const a=personal(f,'user','用户工作日不饮用咖啡。','饮品'),b=add(f,'用户工作日饮用咖啡。',{claimKey:'饮品'});
  assert.equal(f.db.get(f.c,a.id).conflict_with,b.id);assert.equal(f.db.inspect(f.c,b.id).memory.conflict_with,a.id);assert.equal(f.db.projection(f.c).refs.length,0);
  const confirmed=f.db.confirm(f.c,b.id,f.db.get(f.c,b.id).revision,event(f.c,'确认工作日饮用咖啡。'));
  assert(!confirmed.source.includes(a.id));assert.deepEqual(f.db.projection(f.c).refs.map(r=>r.id),[b.id]);
  const other=f.bind({agentId:'other'});assert.equal(f.db.get(other,b.id).conflict_with,null);assert(!JSON.stringify(f.db.recall(other,'咖啡',16000)).includes(a.id));
  f.db.correct(f.c,a.id,'用户工作日仅饮用茶。',f.db.get(f.c,a.id).revision,event(f.c,'工作日仅饮用茶。'));
  assert(f.db.get(f.c,b.id).conflict_with);assert.equal(f.db.projection(f.c).refs.length,0);
});

test('forget and expiry invalidate cached projections without relaxing source barriers',t=>{
  const f=fixture(t,'off'),r=add(f,'每次更新之前先检查回滚记录。');assert(f.db.projection(f.c).refs.length);
  f.db.db.prepare("UPDATE memories SET expires_at='2000-01-01' WHERE id=?").run(r.id);assert.equal(f.db.projection(f.c).refs.length,0);assert.throws(()=>add(f,r.statement),/resurrect/);
  const x=add(f,'日常复盘记录保存在工作目录。');f.db.projection(f.c);f.db.forget(f.c,x.id,x.revision);assert.equal(f.db.projection(f.c).refs.length,0);
});

test('context removes L3 duplicates before L2 budgeting and uses rendered row cost',t=>{
  const f=fixture(t,'off');f.issued.get(f.c).l3Tokens=1500;
  for(let i=0;i<10;i++)add(f,'故障排查记录 '+i);
  const statement='故障排查需要进一步核对特殊模块的初始化顺序。';f.db.remember(f.c,{kind:'procedural',statement},{sessionId:f.c.sessionId,eventSeq:++seq,origin:'inference'});
  f.db.noteInput(f.c,event(f.c,'故障排查'));assert(f.db.context(f.c).includes(statement));assert(f.db.context(f.c).includes('L2 当前话题'));
});

test('short trusted input changes topic without durable L1; rejected input clears topic',async t=>{
  const f=fixture(t,'off');f.db.close();let listener,cleanup;
  let src=fs.readFileSync(root+'/packages/character-memory-core/index.mjs','utf8').replace("import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';","const BlockAssembler=class{};const createUserMessage=x=>x;");
  src=src.replace(/from '(\.\/[^']+)'/g,(_,s)=>'from '+JSON.stringify(pathToFileURL(path.join(root,'packages/character-memory-core',s)).href));
  const identity={contractVersion:1,authorize:f.authorize,forSession:()=>f.c,current:()=>f.c,onEvidence:fn=>{listener=fn;return()=>{};}};
  const ctx={get:()=>identity,provide:(n,s)=>{f.db=s;},on:()=>{},logger:{warn:()=>{}},effect:fn=>{cleanup=fn();},agents:{get:()=>undefined}};
  const {apply}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));apply(ctx,{database:f.file,idleMs:86400000});
  // The fixture owns close; cancel the plugin timer and close once in this test.
  const realClose=f.db.close.bind(f.db);f.db.close=()=>{};t.after(()=>{cleanup();realClose();});
  for(const statement of ['咖啡研磨需要按器具调整。','茶叶冲泡需要控制水温。'])f.db.remember(f.c,{kind:'procedural',statement},{sessionId:f.c.sessionId,eventSeq:++seq,origin:'inference'});
  listener(f.c,event(f.c,'今天我们讨论咖啡研磨和器具。'));assert(f.db.context(f.c).includes('咖啡研磨需要'));
  listener(f.c,event(f.c,'茶叶'));assert(f.db.context(f.c).includes('茶叶冲泡'));assert(!f.db.context(f.c).includes('咖啡研磨需要'));
  assert.equal(f.db.db.prepare('SELECT count(*) n FROM experiences').get().n,1);
  listener(f.c,event(f.c,'password: do-not-store'));assert(!f.db.context(f.c).includes('L2 当前话题'));
});

test('topic expires, simple follow-up keeps bounded context, and forged handles fail',t=>{
  const f=fixture(t,'off');const text='回滚流程包含核对最近发布记录。';f.db.remember(f.c,{kind:'procedural',statement:text},{sessionId:f.c.sessionId,eventSeq:1,origin:'inference'});
  f.db.noteInput(f.c,event(f.c,'回滚流程'));f.db.noteInput(f.c,event(f.c,'详细说'));assert(f.db.context(f.c).includes(text));
  assert.throws(()=>f.db.noteInput({...f.c},event(f.c,'其他话题')),/Unauthorized/);
  const future=Date.now()+1800001;t.mock.method(Date,'now',()=>future);assert(!f.db.context(f.c).includes('L2 当前话题'));
});

test('required compaction failure and assertion failure cannot produce a passing report',async()=>{
  const blocked={ok:true};await assert.rejects(()=>verifyCompaction(blocked,async()=>{throw Error('Host unavailable');},()=>{}));assert.equal(blocked.ok,false);assert.equal(blocked.compaction.status,'BLOCKED');
  const failed={ok:true};await assert.rejects(()=>verifyCompaction(failed,async()=>({result:{kind:'success',sourceEventSeq:4}}),()=>assert.fail('Checkpoint missing')));assert.equal(failed.ok,false);assert.equal(failed.compaction.status,'FAIL');
  const passed={ok:false};await verifyCompaction(passed,async()=>({result:{kind:'success',sourceEventSeq:4}}),()=>{});assert.equal(passed.compaction.status,'verified');
});

test('restart verifier checks revision, content and source, never invents a missing baseline',t=>{
  const f=fixture(t,'off'),row=add(f,'重启验证：持久事实'),file=path.join(f.dir,'checkpoint.json');
  assert.throws(()=>verifyRestart(file,row,true),/baseline missing/);assert.equal(verifyRestart(file,row),false);assert.equal(verifyRestart(file,row,true),true);
  for(const patch of [{revision:row.revision+1},{fingerprint:'changed'},{source:'{}'},{status:'forgotten'}])assert.throws(()=>verifyRestart(file,{...row,...patch},true));
});

test('extraction verifier rejects zero saves and stale sources, accepts a current source',t=>{
  const f=fixture(t,'off');add(f,'历史错误栈记录。');const evidence=event(f.c,'本次错误栈记录。'),jobId=f.db.enqueue(f.c,evidence),args={jobId,sessionId:f.c.sessionId,messageId:evidence.messageId,query:'错误栈'};
  const finish=saved=>f.db.db.prepare("UPDATE extraction_jobs SET status='done',error=? WHERE id=?").run(JSON.stringify({saved}),jobId);
  finish(0);assert.throws(()=>verifyExtraction(f.db,f.c,args),/saved no memory/);finish(1);assert.throws(()=>verifyExtraction(f.db,f.c,args),/source association/);
  f.db.remember(f.c,{kind:'semantic',statement:evidence.text},evidence);assert(verifyExtraction(f.db,f.c,args).some(r=>r.statement===evidence.text));
});

test('unchanged source schema reopens with original revisions and mode policy intact',t=>{
  const f=fixture(t,'assistant');seed(f);const row=personal(f,'user','工作习惯：先保存错误栈。');f.db.projection(f.c);
  f.db.close();f.db=new LayeredMemory(f.file,f.authorize);assert.equal(f.db.get(f.c,row.id).revision,row.revision);assert.equal(f.db.db.prepare('SELECT MAX(version) n FROM schema_version').get().n,3);
  assert(f.db.projection(f.c).refs.some(r=>r.id===row.id));
});

async function loadProbe(name){
  let src=fs.readFileSync(path.join(root,'tests',name),'utf8');
  src=src.replace("import sourceDigest from '../scripts/source-digest.cjs';","const sourceDigest=()=> 'synthetic-probe-regression';");
  src=src.replace(/const \{createUserMessage\}=await import\([^\n]+;/,'const createUserMessage=x=>x;');
  src=src.replace(/from '(\.\/[^']+)'/g,(_,s)=>'from '+JSON.stringify(pathToFileURL(path.join(root,'tests',s)).href));
  return import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
}
async function readProbe(file){const deadline=Date.now()+10000;while(!fs.existsSync(file)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));return JSON.parse(fs.readFileSync(file,'utf8'));}

test('actual layered probe body cannot report ok after a mocked compaction failure',async t=>{
  const f=fixture(t),result=path.join(f.dir,'probe.json'),bindings=new Map();
  const old=f.db.remember(f.c,{kind:'semantic',statement:'隔离重启验证：记录复盘结果。'},{sessionId:f.c.sessionId,eventSeq:5,origin:'inference'});verifyRestart(result+'.checkpoint-v2',old);
  const ctx={get:()=>undefined,effect:fn=>t.after(fn()),dshMemory:f.db,memoryIdentity:{forSession:id=>bindings.get(id)},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},commands:{execute:async()=>{throw Error('Synthetic host unavailable');}},agents:{create:async opts=>{const c=f.bind({sessionId:opts.sessionId});bindings.set(c.sessionId,c);return {agent:{id:c.sessionId,session:{append:()=>{}},ctx:{systemPrompt:{assemble:()=>f.db.context(c)}}},dispose:async()=>{}};}}};
  ctx.tools={get:name=>({execute:async(args,{agent})=>{const c=bindings.get(agent.id),s={sessionId:c.sessionId,eventSeq:5,origin:'inference'},n=name.slice(7);let out;
    if(n==='layers_status')out=f.db.layersStatus(c);else if(n==='remember')out=f.db.remember(c,args,s);else if(n==='projection')out=f.db.projection(c);else if(n==='trace')out=f.db.trace(c,args.id);else throw Error('Unexpected post-failure action');return JSON.stringify(out);
  }})};
  const {apply}=await loadProbe('layered-host.mjs');apply(ctx,{result,cwd:f.dir,mode:'character',restartOnly:true,runId:'isolated-current-run'});
  const report=await readProbe(result);assert.equal(report.compaction?.status,'BLOCKED');assert.equal(report.status,'BLOCKED');assert.equal(report.ok,false);
});

test('actual legacy LLM probe body rejects a done-zero job even when old results exist',async t=>{
  const f=fixture(t,'off'),result=path.join(f.dir,'llm-probe.json');let current;
  f.db.remember(f.c,{kind:'procedural',statement:'历史运行需要保留错误栈。'},{sessionId:f.c.sessionId,eventSeq:1,origin:'inference',extractor:'host-llm-v1',originalSessionId:'old-run'});
  const identity={forSession:()=>current,attach:runtime=>{runtime.bot.use(async m=>{const id=f.db.enqueue(current,{sessionId:current.sessionId,eventSeq:2,messageId:m.message.messageId,text:m.message.content,origin:'direct_user'});f.db.db.prepare("UPDATE extraction_jobs SET status='done',error=? WHERE id=?").run(JSON.stringify({saved:0}),id);});return()=>{};}};
  const ctx={effect:fn=>t.after(fn()),get:n=>n==='characterIdentity'?identity:f.db,agents:{create:async opts=>{current=f.bind({sessionId:opts.sessionId});return {agent:{session:{header:{id:opts.sessionId}}},dispose:async()=>{}};}}};
  const {apply}=await loadProbe('llm-host-probe.mjs');apply(ctx,{result,cwd:f.dir});const report=await readProbe(result);assert.equal(report.ok,false);assert.match(report.error,/saved no memory/);
});
