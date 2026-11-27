// D1 semantic recall: integration mechanics, safety and degradation.
// The embedder here is a deterministic test double (a tiny hand-made concept space). It exists to
// exercise plumbing in CI without model files and says nothing about retrieval quality; real-model
// results are produced by tests/semantic-real-model.mjs and recorded in docs/SEMANTIC-RECALL.md.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
import {attach} from '../packages/memory-semantic/index.mjs';
import {VectorIndex} from '../packages/memory-semantic/vector-index.mjs';
import {resolveModel,modelVersion,RUNTIME} from '../packages/memory-semantic/models.mjs';
import {identifierTerms} from '../packages/character-memory-core/store.mjs';
import {fileURLToPath} from 'node:url';
import {HttpProvider,SubprocessProvider} from '../packages/memory-semantic/provider.mjs';
import {createHash} from 'node:crypto';
const contentHash=text=>createHash('sha256').update(text.normalize('NFKC').trim()).digest('hex');

const CONCEPTS=[['徒步','远足','hiking','hike'],['骑车','自行车','bicycle','cycling'],['端口','port'],['咖啡','coffee','美式'],['编辑器','editor','neovim'],['过敏','allergic','allergy'],['记录编号','log entry'],['妹妹','sister'],['潜水','diving','scuba'],['黑莓','blackberry'],['阅读器','e-reader','墨水屏']];
const DIM=64;
// Concept dimensions carry synonym/translation equivalence; hashed word/bigram dimensions make texts
// without a shared concept dissimilar unless they really share wording.
function conceptVector(text){
 const t=text.toLowerCase(),v=new Float32Array(DIM),lexical=new Float32Array(DIM);
 for(const token of t.match(/[a-z0-9_]+|[㐀-鿿]{2}(?=[㐀-鿿]*)/g)??[]){let h=7;for(const c of token)h=(h*31+c.codePointAt(0))>>>0;lexical[CONCEPTS.length+h%(DIM-CONCEPTS.length)]+=1;}
 let ln=0;for(const x of lexical)ln+=x*x;ln=Math.sqrt(ln)||1;for(let i=0;i<DIM;i++)v[i]=0.6*lexical[i]/ln;
 CONCEPTS.forEach((group,i)=>{if(group.some(w=>t.includes(w)))v[i]=1;});
 let n=0;for(const x of v)n+=x*x;n=Math.sqrt(n);return v.map(x=>x/n);
}
const MODEL={repo:'test/concepts',revision:'0'.repeat(40),dtype:'fp32',dim:DIM,pooling:'none',minScore:0.5};
function fakeProvider(overrides={}){const p={calls:0,texts:[],state:()=>'test',async embed(texts,kind){p.calls++;p.texts.push(...texts);return texts.map(conceptVector);},close(){p.closed=true;},...overrides};return p;}

function world({mode='active',provider=fakeProvider(),config={},model=MODEL}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'semantic-recall-')),issued=new WeakMap();
 const store=new LayeredMemory(path.join(dir,'memory.sqlite'),h=>{assert(issued.has(h),'Unauthorized');return issued.get(h);});
 const bind=(sessionId,scope={})=>{const h={sessionId};issued.set(h,{principalId:'owner-a',namespaceId:'char',projectId:'proj',agentId:'agent',memoryMode:'off',...scope});return h;};
 const a=bind('session-a'),b=bind('session-b',{principalId:'owner-b'});let seq=0;
 const evidence=(ctx,text)=>({sessionId:ctx.sessionId,eventSeq:++seq,messageId:'m'+seq,origin:'direct_user',text});
 const add=(ctx,statement,extra={})=>store.remember(ctx,{kind:'semantic',statement,...extra},evidence(ctx,statement));
 const indexFile=path.join(dir,'vectors.sqlite');
 const runtime=attach(store,{mode,indexFile,model,indexIntervalMs:3600000,...config},{provider});
 
 return {dir,store,a,b,bind,issued,add,evidence,runtime,provider,indexFile,async sync(){for(let i=0;i<40;i++){const r=await this.runtime.cycle({force:true});if(!r.embedded)break;}},ids:rows=>rows.map(r=>r.id),
  close(){this.runtime?.close();try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});}};
}

test('mode off attaches nothing and an unattached Core keeps the exact lexical result',()=>{
 const w=world({mode:'off'});try{
  assert.equal(w.runtime,null);
  w.add(w.a,'用户周末通常去郊外徒步。');w.add(w.a,'预发环境的网关端口是 7805。');
  for(const q of ['徒步','网关端口','远足',''])assert.deepEqual(w.store.recall(w.a,q,5000,{semantic:true}),w.store.recall(w.a,q,5000));
  assert.deepEqual(w.store.layersStatus(w.a).semantic,{mode:'off'});
 }finally{w.close();}
});

test('active mode finds paraphrased and cross-lingual records that FTS5 cannot, on both the tool and the per-turn path',async()=>{
 const w=world();try{
  const hike=w.add(w.a,'用户周末通常去郊外徒步。'),bike=w.add(w.a,'The user commutes to the office by bicycle.');w.add(w.a,'预发环境的网关端口是 7805。');
  await w.sync();
  assert.equal(w.store.recall(w.a,'远足',5000).length,0,'no lexical overlap');
  assert.deepEqual(w.ids(await w.store.recallAsync(w.a,'远足',5000)),[hike.id]);
  assert.deepEqual(w.ids(await w.store.recallAsync(w.a,'骑车上班',5000)),[bike.id]);
  // Per-turn path: trusted ingress starts the query embedding; the synchronous context uses it once ready.
  const turn=w.bind('session-turn');w.store.noteInput(turn,{sessionId:'session-turn',eventSeq:1,messageId:'u1',origin:'direct_user',text:'我想去远足'});
  await w.runtime.ranker.prepare('我想去远足');
  // Confirmed direct-user facts live in the always-loaded L3 projection, which is excluded from the L2
  // topic recall before ranking; the semantic match therefore has to come from a non-core record.
  const extra=w.store.remember(w.a,{kind:'episodic',statement:'上次去山里徒步时下了大雨。'},{sessionId:'session-a',eventSeq:900,origin:'inference'});await w.sync();
  const context=w.store.context(turn);
  assert(context.includes('L2 当前话题参考')&&context.includes(extra.statement),'semantic match is injected as L2 topic reference');
  assert(!context.split('L2 当前话题参考')[1].includes('7805'),'unrelated record is kept out by the similarity floor');
  assert(w.store.layersStatus(w.a).semantic.counters.ranked>0);
 }finally{w.close();}
});

test('exact identifiers are pinned first among near-identical records',async()=>{
 const w=world();try{
  const rows=[];for(let i=0;i<40;i++)rows.push(w.add(w.a,`盘点日当天质检员清点了三号货架的纸箱，记录编号 W${1000+i}。`));
  await w.sync();
  for(const [query,i]of [['W1017',17],['记录编号 W1033 那条是什么情况',33],['what was log entry w1005 about',5]]){
   const got=await w.store.recallAsync(w.a,query,5000);assert.equal(got[0].id,rows[i].id,query);
  }
 }finally{w.close();}
});

test('the similarity floor returns nothing for an unrelated query instead of filling the context',async()=>{
 const w=world();try{
  w.add(w.a,'用户周末通常去郊外徒步。');w.add(w.a,'用户早上习惯喝一杯美式咖啡。');await w.sync();
  assert(w.store.recall(w.a,'用户的血型是什么',5000).length>0,'FTS5 returns records that merely share a character');
  assert.deepEqual(await w.store.recallAsync(w.a,'用户的血型是什么',5000),[]);
 }finally{w.close();}
});

test('index lag: new and corrected records are served before their vectors exist, never through a stale vector',async()=>{
 const w=world();try{
  for(let i=0;i<12;i++)w.add(w.a,`背景记录 ${i}：用户喜欢徒步路线 ${i}。`);await w.sync();
  const fresh=w.add(w.a,'用户新买了一台电子墨水屏阅读器。');
  const before=await w.store.recallAsync(w.a,'电子墨水屏阅读器',5000);assert.equal(before[0].id,fresh.id,'lexically matching un-embedded record ranks first');
  const old=w.add(w.a,'用户的备用机是一台黑莓手机。');await w.sync();
  const corrected=w.store.correct(w.a,old.id,'用户的备用设备是一副潜水电脑表。',old.revision,w.evidence(w.a,'用户的备用设备是一副潜水电脑表。'));
  assert.equal(w.runtime.index.entries().some(e=>e.id===old.id),false,'correction drops the vector immediately');
  const stale=await w.store.recallAsync(w.a,'blackberry',5000);assert(!stale.some(r=>r.statement.includes('黑莓')),'old text is never returned');assert(!stale.some(r=>r.id===old.id),'old vector does not rank the record');
  assert.equal((await w.store.recallAsync(w.a,'潜水电脑表',5000))[0].id,corrected.id);
  await w.sync();assert.equal((await w.store.recallAsync(w.a,'scuba',5000))[0].id,corrected.id,'re-embedded content is found semantically');
  // A revision bump without a content change keeps the vector (re-bound, not re-embedded).
  const calls=w.provider.calls;w.store.restoreRevision(w.a,corrected.id,corrected.revision,w.store.get(w.a,corrected.id).revision,w.evidence(w.a,'restore'));await w.sync();
  assert.equal(w.provider.calls,calls);assert.equal((await w.store.recallAsync(w.a,'scuba',5000))[0].id,corrected.id);
 }finally{w.close();}
});

test('forget and expiry: the vector is deleted and the record cannot come back through similarity',async()=>{
 const w=world();try{
  const secret=w.add(w.a,'用户最近开始学习潜水。'),keep=w.add(w.a,'用户周末通常去郊外徒步。');await w.sync();
  assert.equal((await w.store.recallAsync(w.a,'scuba diving',5000))[0].id,secret.id);
  w.store.forget(w.a,secret.id,secret.revision);
  assert(!w.runtime.index.entries().some(e=>e.id===secret.id),'vector removed in the same call as forget');
  assert.deepEqual(await w.store.recallAsync(w.a,'scuba diving',5000),[]);
  // A vector that survived a crash between the Core commit and the sidecar delete is still inert...
  w.runtime.index.upsert(secret.id,secret.revision,contentHash('用户最近开始学习潜水。'),conceptVector('潜水'));
  assert.deepEqual(await w.store.recallAsync(w.a,'scuba diving',5000),[]);
  // ...and the orphan sweep removes it.
  assert.deepEqual(w.store.semanticOrphans(w.runtime.index.entries()),[secret.id]);
  const expired=w.add(w.a,'本周临时改喝咖啡因更低的咖啡。',{expiresAt:'2000-01-01T00:00:00Z'});
  w.runtime.index.upsert(expired.id,1,contentHash('本周临时改喝咖啡因更低的咖啡。'),conceptVector('咖啡'));
  assert(!(await w.store.recallAsync(w.a,'coffee',5000)).some(r=>r.id===expired.id));
  assert(!w.runtime.index.entries().some(e=>e.id===expired.id),'expiry on the next read removes the vector as well');
  assert.equal((await w.store.recallAsync(w.a,'hiking',5000))[0].id,keep.id);
 }finally{w.close();}
});

test('isolation: another principal, an unauthorised handle and a hostile ranker get nothing extra',async()=>{
 const w=world();try{
  const mine=w.add(w.a,'用户周末通常去郊外徒步。'),theirs=w.add(w.b,'用户每天骑车去远足的山脚。');await w.sync();
  assert.deepEqual(w.ids(await w.store.recallAsync(w.a,'远足',5000)),[mine.id]);
  assert.deepEqual(w.ids(await w.store.recallAsync(w.b,'远足',5000)),[theirs.id]);
  await assert.rejects(()=>w.store.recallAsync({sessionId:'forged'},'远足',5000),/Unauthorized/);
  assert.throws(()=>w.store.semanticCandidates({sessionId:'forged'}),/Unauthorized/);
  // The ranker only ever receives the caller's own valid keys...
  const seen=[];w.store.setSemanticRanker({mode:'active',rank({keys}){seen.push(keys.map(k=>k.id));return {ids:[theirs.id,'no-such-id',mine.id],pending:[theirs.id]};}});
  // ...and ids it invents or takes from another scope are discarded by Core.
  assert.deepEqual(w.ids(w.store.recall(w.a,'远足',5000,{semantic:true})),[mine.id]);
  assert.deepEqual(seen,[[mine.id]]);
  assert.throws(()=>w.store.setSemanticRanker({mode:'active'}),/Invalid semantic ranker/);
  assert.throws(()=>w.store.setSemanticRanker({mode:'boost',rank(){}}),/Invalid semantic ranker/);
 }finally{w.close();}
});

test('every embedding failure degrades to the exact FTS5 result and the Host is never blocked',async()=>{
 const failures={
  throws:{async embed(){throw Error('model unavailable');}},
  hangs:{embed(){return new Promise(()=>{});}},
  'wrong dimension':{async embed(texts){return texts.map(()=>new Float32Array(3).fill(0.5));}},
  'not a vector':{async embed(texts){return texts.map(()=>[1,2,3]);}},
  NaN:{async embed(texts){return texts.map(()=>new Float32Array(DIM).fill(NaN));}},
 };
 for(const [label,override]of Object.entries(failures)){
  const good=fakeProvider(),w=world({provider:good,config:{prepareTimeoutMs:40}});try{
   w.add(w.a,'用户周末通常去郊外徒步。');w.add(w.a,'预发环境的网关端口是 7805。');await w.sync();
   Object.assign(good,override);
   for(const q of ['网关端口','徒步 周末','port number']){
    const started=performance.now(),got=await w.store.recallAsync(w.a,q,5000);
    assert.deepEqual(got,w.store.recall(w.a,q,5000),label+': '+q);assert(performance.now()-started<500,label+' must not stall recall');
   }
   const s=w.store.layersStatus(w.a).semantic.counters;assert(s.notReady>0&&(s.prepareErrors>0||s.prepareTimeouts>0),label+' is visible in status');
  }finally{w.close();}
 }
 // A ranker that throws inside rank() is contained as well.
 const w=world();try{w.add(w.a,'预发环境的网关端口是 7805。');w.store.setSemanticRanker({mode:'active',rank(){throw Error('boom');}});assert.deepEqual(w.store.recall(w.a,'网关端口',5000,{semantic:true}),w.store.recall(w.a,'网关端口',5000));}finally{w.close();}
});

test('repeated provider failures open a circuit breaker instead of retrying on every message',async()=>{
 const provider=fakeProvider({async embed(){provider.calls++;throw Error('down');}}),w=world({provider});try{
  for(let i=0;i<10;i++)await w.runtime.ranker.prepare('query '+i);
  assert.equal(provider.calls,3);assert.equal(w.runtime.ranker.status().counters.breakerSkips,7);
 }finally{w.close();}
});

test('shadow mode returns the lexical result unchanged and records id-only comparison statistics',async()=>{
 const w=world({mode:'shadow'});try{
  w.add(w.a,'用户周末通常去郊外徒步。');w.add(w.a,'预发环境的网关端口是 7805。');await w.sync();
  for(const q of ['远足','网关端口','用户的血型是什么'])assert.deepEqual(await w.store.recallAsync(w.a,q,5000),w.store.recall(w.a,q,5000),q);
  const status=w.store.layersStatus(w.a).semantic;
  assert.equal(status.mode,'shadow');assert.equal(status.shadow.compared,3);assert.equal(status.shadow.semanticUnavailable,0);assert.equal(status.shadow.semanticEmpty,1);
  assert(!JSON.stringify(status).includes('远足')&&!JSON.stringify(status).includes('徒步'),'no query or statement text in status');
  w.runtime.close();
  const version=w.runtime.modelVersion;w.runtime.close();
  const reopened=new VectorIndex(w.indexFile,version,DIM),saved=reopened.meta('shadow');reopened.close();
  assert.equal(saved.stats.compared,3);assert(!JSON.stringify(saved).includes('远足'));
  w.runtime=null;
 }finally{w.close();}
});

test('a partly built index and a changed model both stay on FTS5 until the vectors exist',async()=>{
 const w=world({config:{indexBatch:2}});try{
  for(let i=0;i<10;i++)w.add(w.a,`用户喜欢的徒步路线 ${i}。`);
  await w.runtime.cycle({force:true});assert.equal(w.runtime.index.size,2);
  assert.deepEqual(await w.store.recallAsync(w.a,'徒步',5000),w.store.recall(w.a,'徒步',5000),'20% coverage: lexical result');
  assert(w.store.layersStatus(w.a).semantic.counters.lowCoverage>0);
  await w.sync();assert.equal(w.runtime.index.size,10);
  assert.equal((await w.store.recallAsync(w.a,'远足',16000)).length,10);
  w.runtime.close();
  // Same file, another model version: old vectors are dropped, not compared.
  const next=attach(w.store,{mode:'active',indexFile:w.indexFile,model:{...MODEL,revision:'1'.repeat(40)},indexIntervalMs:3600000},{provider:w.provider});w.runtime=next;
  assert.equal(next.index.size,0);
  assert.deepEqual(await w.store.recallAsync(w.a,'徒步',5000),w.store.recall(w.a,'徒步',5000));
 }finally{w.close();}
});

test('extraction and consolidation look-ups never use the ranker; L3 exclusion and conflicts are unchanged',async()=>{
 const w=world();try{
  const a=w.add(w.a,'用户办的健身房年卡在公司楼下。',{claimKey:'gym'}),b=w.store.remember(w.a,{kind:'semantic',statement:'用户的健身房年卡办在小区旁边。',claimKey:'gym'},{sessionId:'session-a',eventSeq:500,origin:'inference'});
  const hike=w.add(w.a,'用户周末通常去郊外徒步。');await w.sync();
  let ranked=0;const ranker=w.runtime.ranker,rank=ranker.rank.bind(ranker);ranker.rank=args=>{ranked++;return rank(args);};
  w.store.recall(w.a,'健身房年卡',8000);w.store.consolidationInput(w.a);assert.equal(ranked,0);
  assert.deepEqual(await w.store.recallAsync(w.a,'远足',5000,{exclude:[hike.id]}),[]);
  assert.deepEqual(await w.store.recallAsync(w.a,'远足',5000,{excludeFingerprints:[hike.fingerprint]}),[]);
  w.runtime.index.upsert(a.id,w.store.get(w.a,a.id).revision,a.fingerprint,conceptVector('徒步'));w.runtime.index.upsert(b.id,b.revision,b.fingerprint,conceptVector('徒步'));
  const both=(await w.store.recallAsync(w.a,'远足',5000)).filter(r=>[a.id,b.id].includes(r.id));
  assert.equal(both.length,2);assert(both.every(r=>r.conflict_with),'conflict markers come from Core regardless of ranking');
 }finally{w.close();}
});

test('configuration is validated and providers refuse unsafe settings',()=>{
 const w=world({mode:'off'});try{
  assert.throws(()=>attach(w.store,{mode:'active',indexFile:'relative.sqlite',model:MODEL},{provider:fakeProvider()}),/absolute indexFile/);
  assert.throws(()=>attach(w.store,{mode:'on',indexFile:path.join(w.dir,'v.sqlite')}),/Invalid semantic recall mode/);
  assert.throws(()=>attach({},{mode:'active',indexFile:path.join(w.dir,'v.sqlite'),model:MODEL},{provider:fakeProvider()}),/without semantic recall support/);
  assert.throws(()=>resolveModel({model:'nope'}),/Unknown embedding model/);
  assert.throws(()=>resolveModel({repo:'a/b',revision:'main',dtype:'q8',dim:8,pooling:'cls',minScore:0.4}),/pinned/);
  assert.match(modelVersion(resolveModel({}),{kind:'subprocess',runtime:RUNTIME.version}),/^Xenova\/bge-m3@4de132583038:q8#[0-9a-f]{12}$/);
  assert.throws(()=>new HttpProvider({baseUrl:'https://embeddings.example.com',modelName:'m',model:MODEL}),/allowRemote/);
  assert.doesNotThrow(()=>new HttpProvider({baseUrl:'http://127.0.0.1:11434',modelName:'bge-m3',model:MODEL}));
  assert.throws(()=>new SubprocessProvider({runtimeDir:'relative',modelDir:w.dir,model:resolveModel({})}),/absolute/);
  assert.throws(()=>new SubprocessProvider({runtimeDir:w.dir,modelDir:w.dir,model:resolveModel({})}),/not provisioned/);
 }finally{w.close();}
});

// ---------------------------------------------------------------- review regressions (PR #27)

test('orphan sweep follows the root scope of the record: another Character keeps its valid vector',async()=>{
 const w=world();try{
  const text='用户周末通常去郊外徒步。',other=w.bind('session-c',{namespaceId:'char-two'}),project=w.bind('session-d',{projectId:'proj-two'});
  const mine=w.add(w.a,text),theirs=w.add(other,text),elsewhere=w.add(project,text);await w.sync();
  assert.equal(w.runtime.index.size,3);
  w.store.forget(w.a,mine.id,mine.revision);
  // Same principal, identical text, but a different Character namespace / project: their records are
  // still valid and retrievable, so their vectors must not be reported as orphans.
  assert.deepEqual(w.store.semanticOrphans([{id:mine.id,contentHash:theirs.fingerprint},...w.runtime.index.entries()]),[mine.id]);
  await w.runtime.cycle({force:true});assert.equal(w.runtime.index.size,2);
  assert.deepEqual(w.ids(await w.store.recallAsync(other,'远足',5000)),[theirs.id]);
  assert.deepEqual(w.ids(await w.store.recallAsync(project,'hiking',5000)),[elsewhere.id]);
  assert.deepEqual(await w.store.recallAsync(w.a,'远足',5000),[]);
 }finally{w.close();}
});

test('embeddingModelVersion covers pooling, prefixes, dimension, runtime and provider; any change rebuilds the index',async()=>{
 const base=resolveModel({}),producer={kind:'subprocess',runtime:RUNTIME.version},v=modelVersion(base,producer);
 assert.equal(modelVersion(resolveModel({}),{...producer}),v,'stable for identical settings');
 const http={kind:'http',endpoint:'http://127.0.0.1:1/v1/embeddings',modelName:'bge-m3'};
 for(const [label,changed,by]of [['pooling',{...base,pooling:'mean'},producer],['query prefix',{...base,queryPrefix:'query: '},producer],['document prefix',{...base,documentPrefix:'passage: '},producer],['dimension',{...base,dim:512},producer],['quantisation',{...base,dtype:'fp32'},producer],['revision',{...base,revision:'f'.repeat(40)},producer],['runtime version',base,{...producer,runtime:'9.9.9'}],['provider kind',base,http],['served model name',base,{...http,modelName:'other'}]])
  assert.notEqual(modelVersion(changed,by),v,label+' must change the version');
 assert.equal(modelVersion({...base,minScore:0.1},producer),v,'the similarity floor does not change vectors');
 // End to end: same sidecar file, only the query prefix differs -> vectors are dropped, FTS5 until rebuilt.
 const w=world();try{
  w.add(w.a,'用户周末通常去郊外徒步。');await w.sync();assert.equal(w.runtime.index.size,1);const first=w.runtime.modelVersion;w.runtime.close();
  const next=attach(w.store,{mode:'active',indexFile:w.indexFile,model:{...MODEL,queryPrefix:'query: '},indexIntervalMs:3600000},{provider:w.provider});w.runtime=next;
  assert.notEqual(next.modelVersion,first);assert.equal(next.index.size,0);
  assert.deepEqual(await w.store.recallAsync(w.a,'徒步',5000),w.store.recall(w.a,'徒步',5000));
 }finally{w.close();}
});

test('identifier detection: codes are pinned; years, dates, counts and common numbers are not',async()=>{
 const none=['2026 年有什么计划','他 2025 年 10 月去了哪里','12 月 18 日的截止日期','每分钟 120 次请求','Node.js 24.13 的版本','周五下午 3 点之后','他今年 30 岁了吗','100 元以内的礼物','What happened in 1999?','top 10 things','第 3 版','Q4 的计划'];
 for(const q of none)assert.deepEqual(identifierTerms(q),[],q);
 assert.deepEqual(identifierTerms('ATL-2317 是什么问题'),['2317']);assert.deepEqual(identifierTerms('记录编号 W1137'),['w1137']);
 assert.deepEqual(identifierTerms('生产端口 8443 和 7805'),['8443','7805']);assert.deepEqual(identifierTerms('Sony WH-1000XM5'),['1000xm5']);
 assert.deepEqual(identifierTerms('工单 20261218 的状态'),['20261218']);
 const w=world();try{
  // Eight records mention 2026; one of them is the hiking plan the query is about.
  const plan=w.add(w.a,'2026 年用户打算每个月去郊外徒步一次。');for(let i=0;i<7;i++)w.add(w.a,`2026 年第 ${i+1} 季度的预算评审安排在月底。`);
  // Near-identical codes, and a number that many records share.
  const t17=w.add(w.a,'ATL-2317 是看板首页加载慢的问题。'),t18=w.add(w.a,'ATL-2318 是导出乱码的问题。'),t170=w.add(w.a,'ATL-23170 是权限模型改造。');
  for(let i=0;i<6;i++)w.add(w.a,`服务 ${i} 的健康检查端口是 9090，路径各不相同。`);
  await w.sync();
  assert.equal((await w.store.recallAsync(w.a,'2026 年的远足计划',5000))[0].id,plan.id,'a year is not an identifier: similarity decides');
  assert.equal((await w.store.recallAsync(w.a,'ATL-2317',5000))[0].id,t17.id);assert.equal((await w.store.recallAsync(w.a,'ATL-2318 怎么样了',5000))[0].id,t18.id);assert.equal((await w.store.recallAsync(w.a,'ATL-23170',5000))[0].id,t170.id);
  // 9090 looks like a code but six valid records contain it: not selective, so it pins nothing.
  assert.equal((await w.store.recallAsync(w.a,'9090 徒步',5000))[0].id,plan.id);
 }finally{w.close();}
});

test('worker process lifecycle: crash, hang, failed start and recovery are contained and visible',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'semantic-worker-')),worker=fileURLToPath(new URL('./fixtures/semantic-worker-fixture.mjs',import.meta.url));
 const fixtureModel=behaviour=>({repo:'fixture/'+behaviour,revision:'0'.repeat(40),dtype:'fp32',dim:8,pooling:'none',minScore:0.5,queryPrefix:'',documentPrefix:path.join(dir,behaviour+'.marker')});
 const provider=(behaviour,extra={})=>{const modelDir=path.join(dir,'models');fs.mkdirSync(path.join(modelDir,'fixture',behaviour),{recursive:true});fs.writeFileSync(path.join(modelDir,'fixture',behaviour,'dsh-model.json'),'{}');fs.writeFileSync(path.join(dir,'package.json'),'{}');
  return new SubprocessProvider({runtimeDir:dir,modelDir,worker,model:fixtureModel(behaviour),idleUnloadMs:0,...extra});};
 const gone=async pid=>{for(let i=0;i<150;i++){try{process.kill(pid,0);}catch{return true;}await new Promise(r=>setTimeout(r,20));}return false;};
 try{
  const ok=provider('ok');assert.equal((await ok.embed(['a','b'],'query')).length,2);assert.equal(ok.state(),'ready');const pid=ok.pid;assert(pid);ok.close();assert(await gone(pid),'close ends the worker');await assert.rejects(()=>ok.embed(['a'],'query'),/closed/);
  // Crash while a request is in flight: the request is retried once on a new worker; nothing hangs.
  const crash=provider('crash-once');try{assert.equal((await crash.embed(['a'],'query')).length,1);assert.equal(crash.usage().starts,2);assert.equal(crash.usage().exits,1);assert.equal(crash.usage().retriedAfterExit,1);assert.equal(crash.state(),'ready');}finally{crash.close();}
  // A worker that crashes on every request fails after exactly one retry, it is not respawned in a loop.
  const always=provider('crash-on-embed');try{await assert.rejects(()=>always.embed(['a'],'query'),/exited|unavailable/);assert.equal(always.usage().starts,2);}finally{always.close();}
  // No answer: the request times out and the stuck worker is reclaimed instead of being left running.
  const hang=provider('hang',{requestTimeoutMs:150}),first=hang.embed(['a'],'query');await new Promise(r=>setTimeout(r,60));const stuck=hang.pid;assert(stuck);
  const started=performance.now();await assert.rejects(()=>first,/timeout/);assert(performance.now()-started<2000);assert(await gone(stuck),'hung worker is killed');assert.equal(hang.usage().requestTimeouts,1);hang.close();
  // A worker that cannot start is not respawned on every call.
  const fatal=provider('fatal-load',{restartBackoffMs:60000});await assert.rejects(()=>fatal.embed(['a'],'query'),/synthetic load failure|exited/);
  for(let i=0;i<5;i++)await assert.rejects(()=>fatal.embed(['a'],'document'),/backoff/);assert.equal(fatal.usage().starts,1);assert.equal(fatal.usage().startFailures,1);fatal.close();
  // ...and recovers by itself once the cause is gone and the backoff has passed.
  const flaky=provider('fatal-then-ok',{restartBackoffMs:80});await assert.rejects(()=>flaky.embed(['a'],'query'));await assert.rejects(()=>flaky.embed(['a'],'query'),/backoff/);
  await new Promise(r=>setTimeout(r,120));assert.equal((await flaky.embed(['a'],'query')).length,1);assert.equal(flaky.usage().starts,2);flaky.close();
  // Through the whole stack: a hung worker never delays recall beyond the prepare timeout and the result is exactly the FTS5 one.
  const w=world({provider:provider('hang',{requestTimeoutMs:5000}),model:fixtureModel('hang'),config:{prepareTimeoutMs:60}});
  try{w.add(w.a,'预发环境的网关端口是 7805。');const t=performance.now(),got=await w.store.recallAsync(w.a,'网关端口',5000);assert(performance.now()-t<1500);assert.deepEqual(got,w.store.recall(w.a,'网关端口',5000));
   const c=w.store.layersStatus(w.a).semantic.counters;assert.equal(c.ranked,0);assert.equal(c.notReady,1);assert(c.prepareTimeouts>=1);assert.equal(c.prepared,0);}finally{w.close();}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('indexing yields to foreground work, with a bound',async()=>{
 let running=true;const provider=fakeProvider(),w=world({provider});try{
  w.runtime.close();const runtime=attach(w.store,{mode:'active',indexFile:w.indexFile,model:MODEL,indexIntervalMs:3600000,maxIndexDeferMs:150,quietAfterQueryMs:0},{provider,busy:()=>running});w.runtime=runtime;
  w.add(w.a,'用户周末通常去郊外徒步。');
  assert.deepEqual(await runtime.cycle(),{deferred:true});assert.equal(runtime.index.size,0);
  await new Promise(r=>setTimeout(r,180));assert.equal((await runtime.cycle()).embedded,1,'a Host that is never idle still gets indexed after the bound');
  w.add(w.a,'用户早上习惯喝一杯美式咖啡。');assert.deepEqual(await runtime.cycle(),{deferred:true});running=false;assert.equal((await runtime.cycle()).embedded,1);
  assert.equal(w.store.layersStatus(w.a).semantic.indexer.deferred,2);
  // A query that just arrived also holds indexing back for a moment (the model cannot be interrupted).
  runtime.close();const quiet=attach(w.store,{mode:'active',indexFile:w.indexFile,model:MODEL,indexIntervalMs:3600000,quietAfterQueryMs:120},{provider});w.runtime=quiet;
  w.add(w.a,'用户不会游泳。');await quiet.ranker.prepare('刚到的一条消息');assert.deepEqual(await quiet.cycle(),{deferred:true});
  await new Promise(r=>setTimeout(r,150));assert.equal((await quiet.cycle()).embedded,1);
 }finally{w.close();}
});

test('a damaged sidecar is discarded and rebuilt; a failing sidecar write is counted and cannot resurrect anything',async()=>{
 const w=world();try{
  const hike=w.add(w.a,'用户周末通常去郊外徒步。'),dive=w.add(w.a,'用户最近开始学习潜水。');await w.sync();w.runtime.close();
  // A SQLite file whose pages are garbage: the header says SQLite, nothing after it is readable.
  const damaged=Buffer.alloc(8192,0x5a);damaged.write('SQLite format 3\0','latin1');
  for(const suffix of ['','-wal','-shm'])fs.rmSync(w.indexFile+suffix,{force:true});fs.writeFileSync(w.indexFile,damaged);
  const next=attach(w.store,{mode:'active',indexFile:w.indexFile,model:MODEL,indexIntervalMs:3600000},{provider:w.provider});w.runtime=next;
  assert.equal(next.index.recreated,true);assert.equal(next.index.size,0);assert.equal(w.store.layersStatus(w.a).semantic.indexer.recreated,true);
  assert.deepEqual(await w.store.recallAsync(w.a,'徒步',5000),w.store.recall(w.a,'徒步',5000),'FTS5 while the index is empty');
  await w.sync();assert.deepEqual(w.ids(await w.store.recallAsync(w.a,'远足',5000)),[hike.id]);
  // Sidecar write fails during forget: the Core forget still succeeds, the failure is visible, and the
  // record cannot be returned even though its vector is still on disk.
  const remove=next.index.remove.bind(next.index);next.index.remove=()=>{throw Error('disk I/O error');};
  w.store.forget(w.a,dive.id,dive.revision);
  const status=w.store.layersStatus(w.a).semantic;assert.equal(status.counters.invalidateErrors,1);assert.match(status.lastError,/disk I\/O error/);
  assert.deepEqual(await w.store.recallAsync(w.a,'scuba diving',5000),[]);
  next.index.remove=remove;await next.cycle({force:true});assert(!next.index.entries().some(e=>e.id===dive.id),'the sweep retries the delete');
 }finally{w.close();}
});

test('a removed vector leaves no copy in the sidecar file or its write-ahead log',async()=>{
 const w=world();try{
  const secret=w.add(w.a,'用户最近开始学习潜水。');w.add(w.a,'用户周末通常去郊外徒步。');await w.sync();
  const needle=Buffer.from(conceptVector('用户最近开始学习潜水。').buffer),bytes=()=>Buffer.concat(['','-wal'].map(x=>fs.existsSync(w.indexFile+x)?fs.readFileSync(w.indexFile+x):Buffer.alloc(0)));
  assert(bytes().includes(needle),'vector is on disk before forget');
  w.store.forget(w.a,secret.id,secret.revision);await w.runtime.cycle({force:true});
  assert(!bytes().includes(needle),'freed pages are overwritten and the WAL is truncated');
 }finally{w.close();}
});

// ---------------------------------------------------------------- integration audit (on main after PR #25)

test('a sidecar DELETE that fails after the in-memory entry is gone is retried until the row is off disk',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const w=world();try{
  const secret=w.add(w.a,'用户最近开始学习潜水。');w.add(w.a,'用户周末通常去郊外徒步。');await w.sync();
  const onDisk=()=>{const db=new DatabaseSync(w.indexFile);try{return db.prepare('SELECT count(*) n FROM vectors WHERE memory_id=?').get(secret.id).n;}finally{db.close();}};
  assert.equal(onDisk(),1);
  // Another connection holds the write lock: the sidecar DELETE fails (SQLITE_BUSY after busy_timeout).
  const lock=new DatabaseSync(w.indexFile);lock.exec('PRAGMA busy_timeout=0;BEGIN EXCLUSIVE');
  try{w.store.forget(w.a,secret.id,secret.revision);}finally{lock.exec('ROLLBACK');lock.close();}
  const s=w.store.layersStatus(w.a).semantic;assert.equal(s.counters.invalidateErrors,1,'the failure is counted');assert(s.lastError);
  assert.equal(w.store.get(w.a,secret.id).status,'forgotten','Core state is unaffected by the sidecar failure');
  assert.equal(onDisk(),1,'precondition: the row is still on disk');
  assert.deepEqual(await w.store.recallAsync(w.a,'scuba diving',5000),[],'never returned in the meantime');
  await w.runtime.cycle({force:true});
  assert.equal(onDisk(),0,'the retry removes the persisted row even though the in-memory entry was already gone');
 }finally{w.close();}
});

test('a sidecar DELETE that keeps failing is retried on the next cycle, not only at the periodic sweep',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const w=world();try{
  const secret=w.add(w.a,'用户最近开始学习潜水。');await w.sync();
  const onDisk=()=>{const db=new DatabaseSync(w.indexFile);try{return db.prepare('SELECT count(*) n FROM vectors WHERE memory_id=?').get(secret.id).n;}finally{db.close();}};
  const lock=new DatabaseSync(w.indexFile);lock.exec('PRAGMA busy_timeout=0;BEGIN EXCLUSIVE');
  try{w.store.forget(w.a,secret.id,secret.revision);assert.match((await w.runtime.cycle({force:true})).error,/locked/,'the retry fails too');}
  finally{lock.exec('ROLLBACK');lock.close();}
  await w.runtime.cycle({force:true});
  assert.equal(onDisk(),0,'the next cycle retries without waiting for sweepIntervalMs');
 }finally{w.close();}
});

test('a WAL checkpoint blocked by a reader keeps the index dirty and does not wait for the busy timeout',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'semantic-wal-')),file=path.join(dir,'v.sqlite');
 const index=new VectorIndex(file,'v',DIM);try{
  index.upsert('a',1,'h',conceptVector('潜水'));
  const reader=new DatabaseSync(file);reader.exec('BEGIN');reader.prepare('SELECT count(*) FROM vectors').get();
  try{
   index.remove('a');const started=Date.now();
   assert.equal(index.scrub(),false,'a blocked checkpoint is not reported as done');
   assert(Date.now()-started<1000,'the indexer thread is not held for the busy timeout');
  }finally{reader.exec('ROLLBACK');reader.close();}
  assert.equal(index.scrub(),true,'still dirty, so the next scrub retries');
  assert.equal(fs.statSync(file+'-wal').size,0,'the WAL is truncated');
 }finally{index.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('an indexFile that is not a SQLite file is refused and left untouched',()=>{
 const w=world({mode:'off'});try{
  const notes=path.join(w.dir,'notes.txt'),text='用户的笔记\n'.repeat(200);fs.writeFileSync(notes,text);
  assert.throws(()=>attach(w.store,{mode:'active',indexFile:notes,model:MODEL,indexIntervalMs:3600000},{provider:fakeProvider()}),/not a SQLite file/);
  assert.equal(fs.readFileSync(notes,'utf8'),text);
 }finally{w.close();}
});

test('indexFile can never be the Memory Core database or another SQLite database',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const w=world({mode:'off'});try{
  const dbFile=path.join(w.dir,'memory.sqlite'),tables=()=>w.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
  const before=tables(),attempt=file=>attach(w.store,{mode:'active',indexFile:file,model:MODEL,indexIntervalMs:3600000},{provider:fakeProvider()});
  assert.throws(()=>attempt(dbFile),/Memory Core database/);
  assert.throws(()=>attempt(path.join(w.dir,'.','sub','..','memory.sqlite')),/Memory Core database/);
  for(const suffix of ['-wal','-shm','-journal'])assert.throws(()=>attempt(dbFile+suffix),/Memory Core database/);
  // Hard link and directory junction: different path strings, same file.
  const link=path.join(w.dir,'alias.sqlite');fs.linkSync(dbFile,link);assert.throws(()=>attempt(link),/Memory Core database/);
  const junction=path.join(w.dir,'junction');fs.symlinkSync(w.dir,junction,'junction');assert.throws(()=>attempt(path.join(junction,'memory.sqlite')),/Memory Core database/);
  assert.deepEqual(tables(),before,'the Memory Core schema is untouched');
  // Any other existing SQLite file (for example coordination.sqlite) is refused, not adopted or deleted.
  const other=path.join(w.dir,'coordination.sqlite'),db=new DatabaseSync(other);db.exec("CREATE TABLE outbox(id TEXT);INSERT INTO outbox VALUES('keep')");db.close();
  assert.throws(()=>attempt(other),/not a semantic vector index/);
  const again=new DatabaseSync(other);try{assert.deepEqual(again.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['outbox']);assert.equal(again.prepare('SELECT id FROM outbox').get().id,'keep');}finally{again.close();}
 }finally{w.close();}
});

test('the HTTP provider never follows a redirect, so loopback-only cannot be bypassed',async()=>{
 const http=await import('node:http');const hits=[];
 const remote=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{hits.push(body);res.end(JSON.stringify({data:[{index:0,embedding:[1,0,0,0,0,0,0,0]}]}));});});
 await new Promise(r=>remote.listen(0,'127.0.0.1',r));
 const local=http.createServer((req,res)=>{res.writeHead(307,{location:`http://127.0.0.1:${remote.address().port}/v1/embeddings`});res.end();});
 await new Promise(r=>local.listen(0,'127.0.0.1',r));
 try{
  const p=new HttpProvider({baseUrl:`http://127.0.0.1:${local.address().port}`,modelName:'m',model:MODEL,requestTimeoutMs:2000});
  await assert.rejects(()=>p.embed(['用户的私人记忆'],'query'));
  assert.equal(hits.length,0,'the memory text must not reach the redirect target');
 }finally{local.close();remote.close();}
});

test('the per-turn context can wait, with a bound, for a query vector that is still being computed',async()=>{
 let release;const slow=fakeProvider();const w=world({provider:slow,config:{prepareTimeoutMs:400}});try{
  w.store.remember(w.a,{kind:'episodic',statement:'上次去山里徒步时下了大雨。'},{sessionId:'session-a',eventSeq:900,origin:'inference'});await w.sync();
  const embed=slow.embed;slow.embed=(texts,kind)=>kind==='query'?new Promise(r=>{release=()=>r(texts.map(conceptVector));}):embed(texts,kind);
  // The query shares no character with the record, so FTS5 alone cannot find it.
  const turn=w.bind('session-turn');w.store.noteInput(turn,{sessionId:'session-turn',eventSeq:1,messageId:'u1',origin:'direct_user',text:'想要远足'});
  assert(!w.store.context(turn).includes('下了大雨'),'synchronous context before the vector exists: FTS5');
  setTimeout(()=>release(),40);
  assert.equal(await w.store.awaitSemanticContext(turn),true,'waits and reports that the vector became ready');
  assert(w.store.context(turn).includes('下了大雨'),'recomputed context is semantic');
  assert.equal(await w.store.awaitSemanticContext(turn),false,'nothing to wait for once ready');
  // Bounded: a provider that never answers costs at most prepareTimeoutMs.
  slow.embed=()=>new Promise(()=>{});w.store.noteInput(turn,{sessionId:'session-turn',eventSeq:2,messageId:'u2',origin:'direct_user',text:'新的问题：周末去哪里远足'});
  const t=performance.now();assert.equal(await w.store.awaitSemanticContext(turn),false);assert(performance.now()-t<700);
  const c=w.store.layersStatus(turn).semantic.counters;assert.equal(c.contextWaits,2);assert.equal(c.contextRecovered,1);
  // No ranker / no topic: returns immediately.
  assert.equal(await w.store.awaitSemanticContext(w.a),false);
  // A worker that is not loaded is not waited for at all.
  slow.state=()=>'starting';w.store.noteInput(turn,{sessionId:'session-turn',eventSeq:3,messageId:'u3',origin:'direct_user',text:'冷启动时的问题'});
  const t2=performance.now();assert.equal(await w.store.awaitSemanticContext(turn),false);assert(performance.now()-t2<50);assert.equal(w.store.layersStatus(turn).semantic.counters.contextWaitSkipped,1);
 }finally{w.close();}
});

// ---------------------------------------------------------------- default-on contract

test('a normal Character build declares semantic recall in active mode; off and shadow stay explicit choices',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const {semanticSettings,semanticRow}=require('../scripts/semantic-settings.cjs');
 const install=path.resolve(os.tmpdir(),'install-root'),dataDirectory='C:/x/character',s=semanticSettings(undefined,{install,dataDirectory});
 assert.equal(s.mode,'active');assert.equal(s.indexFile,dataDirectory+'/memory-vectors.sqlite');
 const slash=p=>p.split(path.sep).join('/');
 assert.equal(s.runtimeDir,slash(path.join(install,'data','semantic-recall','runtime')));assert.equal(s.modelDir,slash(path.join(install,'data','semantic-recall','models')));
 const row=semanticRow(s);assert.equal(row.name,'dsh-memory-semantic');assert.equal(row.config.mode,'active');assert.equal(row.config.provider.kind,'subprocess');
 for(const mode of ['off','shadow'])assert.equal(semanticRow(semanticSettings({mode},{install,dataDirectory})).config.mode,mode);
 for(const bad of [{mode:'on'},{runtimeDir:'relative'},{threads:-1},{model:'x'},[]])assert.throws(()=>semanticSettings(bad,{install,dataDirectory}));
 // The package is part of every Character installation: required by packaging and selected by deployment.
 const plan=require('../scripts/package-plan.cjs');assert(plan.requiredFolders.includes('packages/memory-semantic'));
 assert(require('../scripts/deployment-plan.cjs').select({profile:[],core:[],extras:[]}).includes('packages/memory-semantic'));
 assert.match(fs.readFileSync(new URL('../scripts/build.cjs',import.meta.url),'utf8'),/semanticRow\(settings\.semanticRecall\)/);
 assert.match(fs.readFileSync(new URL('../scripts/portable.cjs',import.meta.url),'utf8'),/'dsh-memory-semantic'\]\)/);
});

test('without a mode the plugin runs active; a missing model leaves Memory on FTS5 and says why',async()=>{
 const {apply}=await import('../packages/memory-semantic/index.mjs');
 const w=world({mode:'off'});try{
  w.add(w.a,'预发环境的网关端口是 7805。');
  const effects=[],warnings=[],ctx={get:k=>k==='dshMemory'?w.store:undefined,logger:{warn:m=>warnings.push(m),info(){}},effect:f=>effects.push(f())};
  // Exactly what the generated Core row looks like on a machine where nothing was provisioned.
  apply(ctx,{indexFile:path.join(w.dir,'memory-vectors.sqlite'),provider:{kind:'subprocess',runtimeDir:path.join(w.dir,'no-runtime'),modelDir:path.join(w.dir,'no-models')}});
  const s=w.store.layersStatus(w.a).semantic;
  assert.equal(s.mode,'unavailable');assert.equal(s.requested,'active');assert.match(s.reason,/not provisioned/);assert.match(warnings[0],/unavailable, using FTS5/);
  for(const q of ['网关端口','port'])assert.deepEqual(await w.store.recallAsync(w.a,q,5000),w.store.recall(w.a,q,5000),'exact FTS5 result');
  assert.equal(await w.store.awaitSemanticContext(w.a),false);assert.equal(fs.existsSync(path.join(w.dir,'memory-vectors.sqlite')),false);
  for(const dispose of effects)dispose?.();assert.deepEqual(w.store.layersStatus(w.a).semantic,{mode:'off'},'unloading restores the original state');
  // Explicit off attaches nothing and reports nothing.
  apply(ctx,{mode:'off',indexFile:path.join(w.dir,'memory-vectors.sqlite')});assert.deepEqual(w.store.layersStatus(w.a).semantic,{mode:'off'});
  // With a working provider and no mode, the plugin is active.
  const runtime=attach(w.store,{indexFile:path.join(w.dir,'v2.sqlite'),model:MODEL,indexIntervalMs:3600000},{provider:fakeProvider()});try{assert.equal(runtime.mode,'active');}finally{runtime.close();}
 }finally{w.close();}
});

test('merge invalidates both vectors; the surviving record is re-embedded and the merged one never returns',async()=>{
 const w=world();try{
  const a=w.add(w.a,'用户周末通常去郊外徒步。'),b=w.store.remember(w.a,{kind:'semantic',statement:'用户周末通常去郊外徒步！'},{sessionId:'session-a',eventSeq:700,origin:'inference'});await w.sync();
  assert.equal(w.runtime.index.size,2);
  w.store.merge(w.a,a.id,b.id,w.store.get(w.a,a.id).revision,b.revision);
  assert(!w.runtime.index.entries().some(e=>e.id===b.id),'merged record has no vector');
  // Core invalidates both sides of a merge, so until the indexer re-embeds the survivor the result is
  // exactly the FTS5 one (no stale vector is used).
  assert.deepEqual(await w.store.recallAsync(w.a,'hiking',5000),w.store.recall(w.a,'hiking',5000));
  await w.sync();assert(w.runtime.index.entries().some(e=>e.id===a.id));assert(!w.runtime.index.entries().some(e=>e.id===b.id));
  assert.deepEqual(w.ids(await w.store.recallAsync(w.a,'hiking',5000)),[a.id]);
 }finally{w.close();}
});

test('the archived research evaluation set is byte-identical to the frozen PR #26 dataset',async()=>{
 const {createHash}=await import('node:crypto'),dir=new URL('./fixtures/semantic-eval/',import.meta.url);
 const manifest=JSON.parse(fs.readFileSync(new URL('MANIFEST.json',dir),'utf8'));
 for(const [name,sha]of Object.entries(manifest.sha256))assert.equal(createHash('sha256').update(fs.readFileSync(new URL(name,dir))).digest('hex'),sha,name+' changed: never edit the held-out split or its labels');
 const {queries}=await import(new URL('queries.mjs',dir).href),freeze=JSON.parse(fs.readFileSync(new URL('FREEZE.json',dir),'utf8'));
 assert.equal(queries.filter(q=>q.split==='heldout').length,freeze.queries.heldout);assert.equal(queries.filter(q=>q.split==='dev').length,freeze.queries.dev);
});

test('a request that meets a worker which just died restarts it once instead of failing and leaving it down',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'semantic-restart-')),worker=fileURLToPath(new URL('./fixtures/semantic-worker-fixture.mjs',import.meta.url));
 const modelDir=path.join(dir,'models');fs.mkdirSync(path.join(modelDir,'fixture','ok'),{recursive:true});fs.writeFileSync(path.join(modelDir,'fixture','ok','dsh-model.json'),'{}');fs.writeFileSync(path.join(dir,'package.json'),'{}');
 const p=new SubprocessProvider({runtimeDir:dir,modelDir,worker,model:{repo:'fixture/ok',revision:'0'.repeat(40),dtype:'fp32',pooling:'none',queryPrefix:'',documentPrefix:''},idleUnloadMs:0});
 try{
  await p.embed(['warm'],'query');
  for(let i=0;i<3;i++){
   // Killed from outside (OS, crash). The very next request races the child's exit event.
   const pid=p.pid;process.kill(pid);
   assert.equal((await p.embed(['after kill '+i],'query')).length,1,'the request after a crash is answered by a new worker');
   assert.notEqual(p.pid,pid);
  }
  assert.equal(p.usage().starts,4);
 }finally{p.close();fs.rmSync(dir,{recursive:true,force:true});}
});
