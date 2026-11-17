// Phase 4: architecture and consistency verification for a derived dense/alias index next to the
// unmodified Memory Core. Real embedding model (multilingual-e5-small, q8), synthetic store.
//   node --test src/consistency.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {buildFixture} from './fixture.mjs';
import {visibleSet} from './lib/gate.mjs';
import {productionRecall} from './lib/fts.mjs';
import {VectorIndex,contentHash} from './lib/vector-index.mjs';
import {AliasIndex} from './lib/alias-index.mjs';
import {HybridRetriever} from './lib/hybrid.mjs';
import {createEmbedder} from './embed/transformers-provider.mjs';
import {recallTerms} from '../../../packages/character-memory-core/store.mjs';

const embedder=await createEmbedder('me5-small',{dtype:'q8'});
const SCOPES=['S0','S1','S2','S3'];
async function world(){
 const fx=await buildFixture({noise:0}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'retrieval-d-consistency-')),file=path.join(dir,'vectors.sqlite');
 const index=new VectorIndex(file),hybrid=new HybridRetriever({store:fx.store,index,embedder});
 const label=row=>fx.labels.get(row.id??row);
 const evidence=(ctx,text)=>({sessionId:ctx.sessionId,eventSeq:fx.nextSeq(),messageId:'t-'+fx.nextSeq(),origin:'direct_user',text});
 return {fx,dir,file,index,hybrid,label,evidence,syncAll:async()=>{for(const s of SCOPES)await hybrid.sync(fx.ctx(s));},
  close(){try{this.index.close();}catch{}fx.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('cross-principal, cross-Character and cross-project isolation holds when every scope is in one vector file',async()=>{
 const w=await world();try{
  await w.syncAll();
  const s0=w.fx.ctx('S0'),rows=visibleSet(w.fx.store,s0);
  // Queries copied verbatim from records of the other three scopes: their vectors are perfect matches.
  for(const text of ['预发环境的网关端口是 9911。','用户收藏黑胶唱片，最珍贵的一张是 1959 年版的 Kind of Blue。','用户让 Tessa 记住的测试端口是 6606。','Nimbus 本地开发服务器端口是 4321。']){
   const result=await w.hybrid.retrieve(s0,text);
   assert.equal(result.degraded,null);
   assert.equal(result.dense.scanned,rows.size,'the scan covers exactly the valid set of the trusted handle');
   for(const row of result.rows)assert.equal(w.fx.meta.get(w.label(row)).scope,'S0','foreign-scope record returned');
   assert(!result.rows.some(r=>r.statement===text));
  }
  assert.equal(w.label((await w.hybrid.retrieve(w.fx.ctx('S1'),'预发环境的网关端口')).rows[0]),'b-port','the owning scope still retrieves its own record');
  assert.equal(w.label((await w.hybrid.retrieve(w.fx.ctx('S2'),'测试端口')).rows[0]),'t-port');
 }finally{w.close();}
});

test('a handle the Host does not authorise gets nothing, whatever the vector file contains',async()=>{
 const w=await world();try{
  await w.syncAll();
  await assert.rejects(()=>w.hybrid.retrieve({sessionId:'forged'},'预发环境的网关端口'),/Unauthorized/);
 }finally{w.close();}
});

test('forgotten records are not resurrected by a vector that the indexer has not removed yet',async()=>{
 const w=await world();try{
  const ctx=w.fx.ctx('S0'),text='用户最近开始学习潜水，已经报了周末的课程。';
  const row=w.fx.store.remember(ctx,{kind:'semantic',statement:text},w.evidence(ctx,text));
  await w.hybrid.sync(ctx);
  assert.equal((await w.hybrid.retrieve(ctx,'潜水课程')).rows[0].id,row.id,'retrievable before forget');
  w.fx.store.forget(ctx,row.id,w.fx.store.get(ctx,row.id).revision);
  assert(w.index.has(row.id,embedder.modelVersion),'the stale vector is deliberately still present (indexer lag / crash before purge)');
  for(const query of [text,'潜水课程','learning to scuba dive']){
   const result=await w.hybrid.retrieve(ctx,query);
   assert(!result.ids.includes(row.id),'forgotten id returned');assert(!result.rows.some(r=>r.statement.includes('潜水')),'forgotten text returned');
  }
  // The derived index must not be usable to rebuild the fact: the Core barrier still rejects the text.
  assert.throws(()=>w.fx.store.remember(ctx,{kind:'semantic',statement:text},w.evidence(ctx,text)),/resurrect|Retired|Forgotten/i);
  w.index.remove(row.id);assert(!w.index.has(row.id,embedder.modelVersion),'purge deletes the vector');
 }finally{w.close();}
});

test('a corrected record is never ranked by the vector of its previous revision',async()=>{
 const w=await world();try{
  const ctx=w.fx.ctx('S0'),before='用户的备用机是一台旧款的黑莓手机。',after='用户的备用设备是一台电子墨水屏阅读器。';
  const row=w.fx.store.remember(ctx,{kind:'semantic',statement:before},w.evidence(ctx,before));
  await w.hybrid.sync(ctx);
  w.fx.store.correct(ctx,row.id,after,w.fx.store.get(ctx,row.id).revision,w.evidence(ctx,after));
  // Vector still describes revision 1. A query for the old content must not surface the record through it.
  const stale=await w.hybrid.retrieve(ctx,'黑莓手机');
  assert.equal(stale.dense.stale,1,'the stale binding is detected');
  const hit=stale.rows.find(r=>r.id===row.id);
  if(hit){assert.equal(hit.statement,after,'only the current text can ever be returned');assert.equal(hit.revision,2);}
  assert(!stale.rows.some(r=>r.statement.includes('黑莓')),'old revision text returned');
  // The current text is still found immediately through the transactional FTS index, and the missing
  // vector does not demote it: pending rows keep their FTS rank in the fusion (see hybrid.mjs).
  const fresh=await w.hybrid.retrieve(ctx,'电子墨水屏阅读器');
  assert.equal(fresh.rows[0].id,row.id);assert.equal(fresh.rows[0].statement,after);
  // Without that compensation plain RRF would rank it below records present in both lists.
  const plain=new HybridRetriever({store:w.fx.store,index:{search:(...a)=>({...w.index.search(...a),pending:[]}),pending:()=>[]},embedder});
  w.observed={plainRrfRankOfFreshRecord:(await plain.retrieve(ctx,'电子墨水屏阅读器')).ids.indexOf(row.id)+1};
  console.log('index-lag observation',JSON.stringify(w.observed));
  // After the indexer catches up the binding matches again.
  assert.equal((await w.hybrid.sync(ctx)).embedded,1);
  assert.equal((await w.hybrid.retrieve(ctx,'e-ink reader')).dense.stale,0);
 }finally{w.close();}
});

test('expired records stay hidden even with a matching vector; future-dated ones stay retrievable',async()=>{
 const w=await world();try{
  const ctx=w.fx.ctx('S0'),expiredText='本周公司地库维修，临时停车改到 B3 层。';
  const [vector]=await embedder.embed([expiredText],'doc'),id=w.fx.ids.get('exp-parking');
  // Hostile/stale index: an entry for the expired record with a plausible binding.
  w.index.upsert({memoryId:id,revision:1,contentHash:contentHash(expiredText),modelVersion:embedder.modelVersion,vector});
  await w.hybrid.sync(ctx);
  const result=await w.hybrid.retrieve(ctx,expiredText);
  assert(!result.ids.includes(id));assert(!result.rows.some(r=>r.statement.includes('地库')));
  assert.equal(w.label((await w.hybrid.retrieve(ctx,'工位现在在几楼')).rows[0]),'temp-desk');
 }finally{w.close();}
});

test('embedding failure, timeout, garbage output and model change all degrade to the exact FTS5 result',async()=>{
 const w=await world();try{
  await w.syncAll();const ctx=w.fx.ctx('S0'),queries=['预发环境端口','他平时怎么锻炼身体','rollback snapshot','ATL-2317'];
  const failing=[
   {name:'throws',embedder:{modelVersion:embedder.modelVersion,embed:async()=>{throw Error('model unavailable');}}},
   {name:'hangs',embedder:{modelVersion:embedder.modelVersion,embed:()=>new Promise(()=>{})},timeout:50},
   {name:'NaN vector',embedder:{modelVersion:embedder.modelVersion,embed:async()=>[new Float32Array(384).fill(NaN)]}},
   {name:'wrong dimension',embedder:{modelVersion:embedder.modelVersion,embed:async()=>[new Float32Array(7).fill(0.1)]}},
   {name:'different model version',embedder:{modelVersion:'another-model@0:fp32',embed:(...a)=>embedder.embed(...a)}},
  ];
  for(const f of failing){
   const hybrid=new HybridRetriever({store:w.fx.store,index:w.index,embedder:f.embedder,embedTimeoutMs:f.timeout??2000});
   for(const q of queries){
    const result=await hybrid.retrieve(ctx,q);
    assert.deepEqual(result.ids,productionRecall(w.fx.store,ctx,q),`${f.name}: must equal LayeredMemory.recall`);
    if(['throws','hangs','NaN vector'].includes(f.name))assert(result.degraded,f.name+' is reported as degraded');
   }
  }
 }finally{w.close();}
});

test('new and not-yet-embedded records are served by FTS5 immediately; the indexer can be interrupted and resumed',async()=>{
 const w=await world();try{
  const ctx=w.fx.ctx('S0'),total=visibleSet(w.fx.store,ctx).size;
  // "Crash" after 25 rows: reopen the sidecar file as a new process would.
  assert.equal((await w.hybrid.sync(ctx,{limit:25})).embedded,25);
  w.index.close();
  const reopened=new VectorIndex(w.file),hybrid=new HybridRetriever({store:w.fx.store,index:reopened,embedder});w.index=reopened;
  assert.equal(reopened.count(embedder.modelVersion),25,'completed upserts survive, nothing is half-written');
  assert.equal(reopened.pending(visibleSet(w.fx.store,ctx),embedder.modelVersion).length,total-25);
  const partial=await hybrid.retrieve(ctx,'ATL-2317');
  assert(partial.rows.slice(0,3).map(w.label).includes('ticket-2317'),'exact-id record is served while most vectors are missing');assert.equal(partial.dense.missing,total-25);
  // A record written now is retrievable before any embedding exists.
  const text='用户新买了一台手冲咖啡壶，放在办公室。',row=w.fx.store.remember(ctx,{kind:'semantic',statement:text},w.evidence(ctx,text));
  assert.equal((await hybrid.retrieve(ctx,'手冲咖啡壶')).rows[0].id,row.id);
  assert.equal((await hybrid.sync(ctx)).embedded,total-25+1);
  assert.equal(reopened.pending(visibleSet(w.fx.store,ctx),embedder.modelVersion).length,0);
 }finally{w.close();}
});

test('conflicting claims stay visible and flagged; similarity does not pick a winner',async()=>{
 const w=await world();try{
  await w.syncAll();const result=await w.hybrid.retrieve(w.fx.ctx('S0'),'健身房年卡在哪');
  const pair=result.rows.filter(r=>['conflict-gym-a','conflict-gym-b'].includes(w.label(r)));
  assert.equal(pair.length,2);assert(pair.every(r=>r.conflict_with),'both sides carry the conflict marker from the Core');
 }finally{w.close();}
});

test('alias (index-time expansion) entries obey the same binding: stale or orphaned aliases never match',async()=>{
 const w=await world();try{
  const ctx=w.fx.ctx('S0'),alias=new AliasIndex(),version='expander@test',before='用户的备用机是一台旧款的黑莓手机。',after='用户的备用设备是一台电子墨水屏阅读器。';
  const row=w.fx.store.remember(ctx,{kind:'semantic',statement:before},w.evidence(ctx,before));
  alias.upsert({memoryId:row.id,revision:row.revision,contentHash:row.fingerprint,modelVersion:version,statement:before,aliases:['BlackBerry','backup phone','备用电话']});
  let rows=visibleSet(w.fx.store,ctx);
  assert.equal(alias.rank(recallTerms('BlackBerry backup phone'),rows,'BlackBerry backup phone',version).ranked[0]?.id,row.id,'alias makes the cross-lingual query match');
  w.fx.store.correct(ctx,row.id,after,row.revision,w.evidence(ctx,after));rows=visibleSet(w.fx.store,ctx);
  const stale=alias.rank(recallTerms('BlackBerry backup phone'),rows,'BlackBerry backup phone',version);
  assert.equal(stale.ranked.length,0,'aliases of the previous revision must not match');assert.equal(stale.stale,1);
  w.fx.store.forget(ctx,row.id,w.fx.store.get(ctx,row.id).revision);rows=visibleSet(w.fx.store,ctx);
  assert.equal(alias.rank(recallTerms('备用电话'),rows,'备用电话',version).ranked.length,0,'aliases of a forgotten record are unreachable');
  alias.remove(row.id);assert.equal(alias.count(),0);alias.close();
 }finally{w.close();}
});
