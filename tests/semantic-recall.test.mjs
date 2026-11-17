// D1 semantic recall: integration mechanics, safety and degradation.
// The embedder here is a deterministic test double (a tiny hand-made concept space). It exists to
// exercise plumbing in CI without model files and says nothing about retrieval quality; real-model
// results are produced by tests/semantic-real-model.mjs and recorded in docs/SEMANTIC-RECALL.md.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
import {attach} from '../packages/memory-semantic/index.mjs';
import {VectorIndex} from '../packages/memory-semantic/vector-index.mjs';
import {resolveModel} from '../packages/memory-semantic/models.mjs';
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
 const sync=async()=>{for(let i=0;i<20;i++){const r=await runtime.cycle();if(!r.embedded)break;}};
 return {dir,store,a,b,bind,issued,add,evidence,runtime,provider,indexFile,sync,ids:rows=>rows.map(r=>r.id),
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
  const reopened=new VectorIndex(w.indexFile,resolveModel(MODEL).version,DIM),saved=reopened.meta('shadow');reopened.close();
  assert.equal(saved.stats.compared,3);assert(!JSON.stringify(saved).includes('远足'));
  w.runtime=null;
 }finally{w.close();}
});

test('a partly built index and a changed model both stay on FTS5 until the vectors exist',async()=>{
 const w=world({config:{indexBatch:2}});try{
  for(let i=0;i<10;i++)w.add(w.a,`用户喜欢的徒步路线 ${i}。`);
  await w.runtime.cycle();assert.equal(w.runtime.index.size,2);
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
  assert.equal(resolveModel({}).version,'Xenova/bge-m3@4de132583038:q8');
  assert.throws(()=>new HttpProvider({baseUrl:'https://embeddings.example.com',modelName:'m',model:MODEL}),/allowRemote/);
  assert.doesNotThrow(()=>new HttpProvider({baseUrl:'http://127.0.0.1:11434',modelName:'bge-m3',model:MODEL}));
  assert.throws(()=>new SubprocessProvider({runtimeDir:'relative',modelDir:w.dir,model:resolveModel({})}),/absolute/);
  assert.throws(()=>new SubprocessProvider({runtimeDir:w.dir,modelDir:w.dir,model:resolveModel({})}),/not provisioned/);
 }finally{w.close();}
});
