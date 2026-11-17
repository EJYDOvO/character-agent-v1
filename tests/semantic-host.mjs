// Native Host probe for optional semantic recall (D1). Runs inside the real Host process started by
// scripts/run-semantic.ps1: real cordis loader, real Agent turns, real system-prompt assembly, real
// Memory Core and tools, real embedding worker. The chat model is a deterministic adapter and the
// memories are synthetic; nothing here reads production data or reaches QQ.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import * as semanticPlugin from '../packages/memory-semantic/index.mjs';
export const name='semantic-recall-host-probe';
export const inject=['agents','agentPresets','tools','llm','memoryIdentity','dshMemory','localMemoryIngress'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s.length?+s[Math.min(s.length-1,Math.floor(s.length*p))].toFixed(1):null;};

// [statement, a query in the other language with no shared word, a substring that identifies the statement]
const FACTS=[
 ['用户周末通常去郊外徒步，偏好十公里左右的山路。','Where does he like to go hiking on weekends?','十公里左右的山路'],
 ['The user commutes to the office by bicycle on weekdays.','他平时怎么去公司上班','by bicycle on weekdays'],
 ['用户对花生过敏，点餐时要避开含花生的菜。','What food is he allergic to?','避开含花生的菜'],
 ['The default timeout for upstream API calls is 8 seconds with two retries.','上游接口超时时间是多少','8 seconds with two retries'],
 ['用户早上习惯喝一杯不加糖的冰美式。','What does he drink in the morning?','不加糖的冰美式'],
 ['Daily standup is at 9:45 am and should not exceed fifteen minutes.','每天的站会几点开','9:45 am'],
 ['用户每周日上午给父母打视频电话。','How often does he call his parents?','给父母打视频电话'],
 ['The user is learning Rust in the evenings.','他在学什么编程语言','learning Rust'],
 ['用户养了一只叫年糕的橘猫，今年四岁。','What is the name of his cat?','叫年糕的橘猫'],
 ['Database backups run nightly at 02:00 UTC and are kept for 35 days.','数据库备份保留多久','kept for 35 days'],
 ['用户不喝酒，聚餐时会点苏打水。','Does he drink alcohol?','聚餐时会点苏打水'],
 ['The user prefers small pull requests under 300 changed lines.','他喜欢多大的代码合并请求','under 300 changed lines'],
 ['用户坐飞机喜欢靠过道的座位。','Which seat does he prefer on a plane?','靠过道的座位'],
 ['The user takes a twenty-minute nap after lunch.','他中午会午睡吗','twenty-minute nap'],
 ['用户的老家在湖南长沙，春节通常回去过年。','Where is his hometown?','湖南长沙'],
 ['Expense reports are due by the fifth of each month.','报销单每月几号截止','fifth of each month'],
 ['用户恐高，不参加蹦极之类的活动。','Is he afraid of heights?','不参加蹦极'],
 ['The user wears noise-cancelling headphones in the open office.','他在办公室戴什么耳机','noise-cancelling headphones'],
 ['用户每周二和周四在家办公。','Which days does he work from home?','每周二和周四在家办公'],
 ['The production cluster runs in the ap-southeast-1 region.','生产集群部署在哪个区域','ap-southeast-1'],
];
const FILLER=Array.from({length:40},(_,i)=>i%2?`Facilities log ${i}: the dock door sensor was inspected before the annual audit.`:`设施记录 ${i}：盘点日当天质检员清点了三号货架的纸箱。`);

export function apply(ctx,config){
 const captures=[];
 class Fixture extends LlmAdapter{async *stream(request){
  captures.push({at:performance.now(),prompt:JSON.stringify([request.system,request.messages])});
  yield {type:'text-delta',index:0,text:'Acknowledged.'};yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['semantic-fixture'],new Fixture());
 ctx.effect(()=>{const t=setTimeout(()=>void run(),1200);return()=>clearTimeout(t);});
 async function run(){
  const handles=[],report={ok:false,runId:config.runId,host:config.version,runtime:process.version,electron:process.versions.electron,provenance:config.provenance,model:'deterministic chat fixture; real embedding worker',synthetic:true,productionRead:false,qqNetwork:false,checks:[],metrics:{}};
  let fiber;const cpu0=process.cpuUsage(),began=performance.now();
  try{
   const create=async preset=>{const h=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'semantic-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:preset},setup:async c=>{await ctx.agentPresets.mount(c,preset);}});handles.push(h);return h.agent;};
   const agent=await create('semantic-agent'),store=ctx.dshMemory,trusted=ctx.memoryIdentity.forSession(agent.id);
   const status=()=>store.layersStatus(trusted).semantic,exec={agent,signal:new AbortController().signal};
   const tool=async(n,args={})=>JSON.parse(await ctx.tools.get('memory_'+n,agent).execute(args,exec));
   let seq=0;const ids=[];
   // Model-proposed (inference) records are L2 topic candidates, not L3 core memory.
   for(const text of [...FACTS.map(f=>f[0]),...FILLER,'工单 ATL-2317 是看板首页加载慢的问题。','工单 ATL-2318 是导出文件乱码的问题。'])ids.push(store.remember(trusted,{kind:'semantic',statement:text},{sessionId:agent.id,eventSeq:++seq,origin:'inference'}).id);
   const total=ids.length;
   // One real turn: trusted ingress, then the user message; returns what the first model request of the turn saw.
   let n=0;
   const turn=async(text,{gapMs=0}={})=>{
    await agent.whenIdle();const mark=captures.length,before=status().counters??{},t0=performance.now();
    ctx.localMemoryIngress.admit(agent,{messageId:'probe-'+(++n),eventSeq:agent.session.seq,text});
    if(gapMs)await sleep(gapMs);
    const t1=performance.now();agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}));await agent.whenIdle();
    const first=captures[mark];assert(first,'The turn made no model request');const after=status().counters??{};
    const at=first.prompt.lastIndexOf('Current runtime context.');assert(at>=0,'no runtime context snapshot in the model request');
    return {context:first.prompt.slice(at),ingressToFirstRequestMs:first.at-t0,turnMs:performance.now()-t1,ranked:(after.ranked??0)-(before.ranked??0),notReady:(after.notReady??0)-(before.notReady??0)};
   };
   const waitIndexed=async(count,seconds=180)=>{const until=Date.now()+seconds*1000;while(Date.now()<until){if(status().vectors>=count)return true;await sleep(250);}return false;};
   const load=async mode=>{fiber=await ctx.plugin(semanticPlugin,{...config.semantic,mode});await sleep(50);assert.equal(status().mode,mode,'plugin did not attach in '+mode);};
   const unload=async()=>{const pid=status().worker?.pid;await fiber.dispose();fiber=null;assert.deepEqual(status(),{mode:'off'});return pid;};
   const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};

   // ---- 1. declared through the Host loader with mode off: nothing attached, original behaviour
   report.phase='off';
   assert.deepEqual(status(),{mode:'off'});assert(!fs.existsSync(config.semantic.indexFile),'mode off must not create an index file');
   assert(!(await tool('recall',{query:FACTS[0][1]})).some(r=>r.statement.includes(FACTS[0][2])),'FTS5 cannot reach the cross-lingual target');
   const offTurns=[];for(const [, query,marker]of FACTS.slice(0,10)){const t=await turn(query);assert(!t.context.includes(marker),'FTS5 cannot match a cross-lingual query: '+query);offTurns.push(t.turnMs);}
   const offReference=new Map();for(const [,query]of FACTS)offReference.set(query,JSON.stringify(store.recall(trusted,query,5000).map(r=>r.id)));
   report.checks.push('Loader-declared plugin with mode off: no ranker, no index file, no worker; recall tool and 10 real turns use FTS5');

   // ---- 2. shadow: index is built in the background, every caller still gets the FTS5 result
   report.phase='shadow';
   const indexStart=performance.now();await load('shadow');assert(await waitIndexed(total),'index was not built: '+JSON.stringify(status()));
   report.metrics.indexBuild={records:total,seconds:+((performance.now()-indexStart)/1000).toFixed(1),workerLoadMs:status().worker.loadMs};
   for(const [,query,marker]of FACTS.slice(0,10)){const t=await turn(query+' ');assert(!t.context.includes(marker),'shadow must not change the context');}
   for(const [,query]of FACTS)assert.equal(JSON.stringify((await tool('recall',{query})).map(r=>r.id)),JSON.stringify(store.recall(trusted,query).map(r=>r.id)),'shadow recall tool differs from FTS5');
   const shadow=status().shadow;assert(shadow.compared>=FACTS.length);assert.equal(shadow.semanticUnavailable<shadow.compared,true);
   report.metrics.shadow={compared:shadow.compared,semanticUnavailable:shadow.semanticUnavailable,meanOverlapAt5:shadow.meanOverlapAt5,meanLexicalRows:shadow.meanLexicalRows,meanSemanticRows:shadow.meanSemanticRows};
   report.checks.push('Shadow via ctx.plugin: real worker built '+total+' vectors; contexts and recall tool identical to FTS5; id-only comparison statistics recorded');

   // ---- 3. unload: ranker detached, worker process gone, index kept; reload reuses it without re-embedding
   report.phase='reload';
   const shadowPid=await unload();assert(shadowPid);for(let i=0;i<40&&alive(shadowPid);i++)await sleep(100);assert(!alive(shadowPid),'worker survived plugin disposal');
   assert(!(await tool('recall',{query:FACTS[0][1]})).some(r=>r.statement.includes(FACTS[0][2])),'after unload recall is lexical again');
   await load('active');assert.equal(status().vectors,total);assert.equal(status().indexer.indexed,0,'reload must reuse the persisted index');
   report.checks.push('Dispose stops the worker and restores FTS5; switching shadow -> active reuses '+total+' persisted vectors');

   // ---- 4. the real question: is the query vector ready when the first context of a turn is assembled?
   report.phase='first-context';
   await store.recallAsync(trusted,'warm the embedding worker',5000);
   const immediate=[];for(const [,query,marker]of FACTS){const t=await turn(query);immediate.push({...t,semantic:t.context.includes(marker)});}
   const hit=immediate.filter(t=>t.semantic).length;
   report.metrics.firstContext={turns:immediate.length,semanticInFirstContext:hit,ratio:+(hit/immediate.length).toFixed(2),fellBackNotReady:immediate.filter(t=>!t.semantic&&t.notReady>0).length,ingressToFirstRequestP50Ms:pct(immediate.map(t=>t.ingressToFirstRequestMs),.5),ingressToFirstRequestP95Ms:pct(immediate.map(t=>t.ingressToFirstRequestMs),.95),turnP50Ms:pct(immediate.map(t=>t.turnMs),.5),turnP95Ms:pct(immediate.map(t=>t.turnMs),.95),offTurnP50Ms:pct(offTurns,.5),offTurnP95Ms:pct(offTurns,.95)};
   // Every miss must be an honest fallback (notReady counted), never a wrong or empty-by-error context.
   for(const t of immediate)if(!t.semantic)assert(t.notReady>0,'a first context without the semantic match must be a counted notReady fallback');
   // With the delay a real ingress adds before the turn starts, the vector is ready.
   const delayed=[];for(const [,query,marker]of FACTS.slice(0,10)){const t=await turn(query+'  ',{gapMs:120});delayed.push(t.context.includes(marker));}
   report.metrics.firstContext.semanticWith120msGap=delayed.filter(Boolean).length+'/'+delayed.length;
   assert.equal(delayed.filter(Boolean).length,delayed.length,'with 120 ms between ingress and turn every first context must be semantic');
   report.checks.push(`Real turns, ingress immediately followed by the user message: ${hit}/${immediate.length} first contexts already semantic, the rest counted notReady fallbacks; 10/10 with a 120 ms gap`);

   // ---- 5. tools on the real Host: recall, identifier pin, correction, forget
   report.phase='tools';
   const viaTool=await tool('recall',{query:FACTS[2][1]});assert(viaTool[0].statement.includes(FACTS[2][2]));
   assert((await tool('recall',{query:'ATL-2318 怎么样了'}))[0].statement.includes('ATL-2318'));
   assert.deepEqual(await tool('recall',{query:'量子计算的最新进展'}),[],'unrelated query returns nothing');
   const target=viaTool[0],changed=await tool('correct',{id:target.id,revision:target.revision,statement:'用户对芒果过敏，点餐时要避开含芒果的甜品。'});
   const afterCorrect=await turn('What food is he allergic to?   ',{gapMs:120});assert(afterCorrect.context.includes('含芒果的甜品')||!afterCorrect.context.includes(FACTS[2][2]));assert(!afterCorrect.context.includes(FACTS[2][2]),'old revision text reached the context');
   for(let i=0;i<40&&status().vectors<total;i++)await sleep(250);
   assert((await tool('recall',{query:'mango allergy'})).some(r=>r.id===target.id&&r.statement.includes('芒果')),'corrected text is found semantically after re-indexing');
   await tool('forget',{id:target.id,revision:changed.revision});
   assert.equal(status().vectors,total-1,'forget removed the vector in the same call');
   const afterForget=await turn('mango allergy and dessert',{gapMs:120});assert(!afterForget.context.includes('芒果'),'forgotten record reached the context');
   assert(!(await tool('recall',{query:'mango allergy'})).some(r=>r.id===target.id));
   report.checks.push('Native memory tools: semantic recall, exact identifier first, unrelated query empty; correct -> only new text; forget -> vector deleted, never returned');

   // ---- 6. authorisation is still decided by the Host identity, not by vectors
   report.phase='identity';
   const stranger=await create('cordis');assert.throws(()=>ctx.memoryIdentity.forSession(stranger.id));
   await assert.rejects(()=>store.recallAsync({...trusted},FACTS[0][1],5000));assert.throws(()=>store.semanticCandidates({sessionId:stranger.id}));
   report.checks.push('Unauthorised preset and forged handle are refused before any ranking');

   // ---- 7. worker crash in the middle of a session
   report.phase='worker-crash';
   const pid=status().worker.pid;assert(pid&&alive(pid));process.kill(pid);for(let i=0;i<40&&alive(pid);i++)await sleep(50);
   const crashQuery=FACTS[4][1]+' ?',crash=await turn(crashQuery);
   assert(!crash.context.includes(FACTS[4][2])&&crash.notReady>0&&crash.ranked===0,'the turn after a worker crash must be a counted FTS5 fallback');
   let recovered=false;for(let i=0;i<60&&!recovered;i++){await sleep(250);recovered=(await turn(FACTS[4][1]+' ??'+i,{gapMs:150})).context.includes(FACTS[4][2]);}
   assert(recovered,'semantic recall did not recover after the worker was killed');assert(status().worker.pid&&status().worker.pid!==pid);
   report.checks.push('Killed worker: next turn completes on FTS5 (notReady counted), a new worker starts and semantic recall resumes');

   // ---- 8. damaged index file
   report.phase='corrupt-index';
   await unload();for(const suffix of ['-wal','-shm'])fs.rmSync(config.semantic.indexFile+suffix,{force:true});fs.writeFileSync(config.semantic.indexFile,Buffer.alloc(16384,0x5a));
   await load('active');assert.equal(status().indexer.recreated,true);
   // Turns while the index is being rebuilt: FTS5 (coverage rule) and unaffected latency.
   const during=[];for(let i=0;i<10;i++){const t=await turn(FACTS[10+i][1]+' ...');during.push(t.turnMs);}
   assert(await waitIndexed(total-1),'index was not rebuilt after corruption');
   assert((await turn(FACTS[12][1]+' !',{gapMs:150})).context.includes(FACTS[12][2]));
   report.metrics.turnsWhileIndexing={p50Ms:pct(during,.5),p95Ms:pct(during,.95)};
   report.checks.push('Corrupt sidecar: recreated empty, turns keep working on FTS5 during the rebuild, semantic recall returns afterwards');

   // ---- 9. resources
   const s=status(),cpu=process.cpuUsage(cpu0);
   report.metrics.resources={hostRssMB:Math.round(process.memoryUsage().rss/1048576),hostCpuMs:Math.round((cpu.user+cpu.system)/1000),wallSeconds:+((performance.now()-began)/1000).toFixed(1),workerRssMB:s.worker.rssMB,workerCpuMs:s.worker.cpuMs,workerStarts:s.worker.starts,counters:s.counters,indexer:s.indexer};
   await unload();report.checks.push('Final unload leaves the Host on FTS5');
   report.ok=true;report.status='PASS';
  }catch(error){report.ok=false;report.status='FAIL';report.error=String(error?.stack??error);}
  finally{try{await fiber?.dispose();}catch{}for(const h of handles)await h.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
