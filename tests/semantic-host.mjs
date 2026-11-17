// Native Host probe for semantic recall (D1) in the Character combination. Runs inside the real Host
// started by scripts/run-semantic.ps1, once per phase: real cordis loader, Character preset (Persona from
// a Character Card), Character Identity, Memory Core and Memory Tools, real Agent turns and system-prompt
// assembly, real embedding worker. Messages enter through the Character's trusted ingress
// (characterIdentity capture of the QQ session manager), exactly where a QQ message would. The chat
// model is a deterministic adapter, the QQ transport a fixture and the memories synthetic.
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import {managerFixture} from './qq-manager-fixture.mjs';
import {notifierFixture} from './notifier-fixture.mjs';
export const name='semantic-recall-host-probe';
export const inject=['agents','agentPresets','tools','llm','memoryIdentity','dshMemory','characterIdentity'];
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
const IDS=['工单 ATL-2317 是看板首页加载慢的问题。','工单 ATL-2318 是导出文件乱码的问题。'];
const TOTAL=FACTS.length+FILLER.length+IDS.length;

export function apply(ctx,config){
 const captures=[];
 class Fixture extends LlmAdapter{async *stream(request){
  captures.push({at:performance.now(),prompt:JSON.stringify([request.system,request.messages])});
  yield {type:'text-delta',index:0,text:'好的。'};yield {type:'finish',reason:{kind:'stop'}};
 }}
 ctx.llm.registerAdapter(['semantic-fixture'],new Fixture());
 ctx.effect(()=>{const t=setTimeout(()=>void run(),1500);return()=>clearTimeout(t);});
 async function run(){
  const handles=[],report={ok:false,phase:config.phase,runId:config.runId,host:config.version,runtime:process.version,electron:process.versions.electron,provenance:config.provenance,declaredMode:config.declared.mode,model:'deterministic chat fixture; real embedding worker',ingress:'Character Identity capture (QQ session manager fixture)',synthetic:true,productionRead:false,qqNetwork:false,checks:[],metrics:{}};
  let release;const cpu0=process.cpuUsage(),began=performance.now();
  try{
   const store=ctx.dshMemory,identity=ctx.characterIdentity,manager=managerFixture();
   release=identity.attach({manager,config:{appId:'mock-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['mock-owner'],groupMode:'disabled'}},sender:{sendMarkdown:async()=>{throw Error('no direct Gateway send');}},notifications:notifierFixture(async()=>{})});
   const create=async preset=>{const h=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'semantic-fixture',model:'fixture'},meta:{cwd:config.cwd,agentPreset:preset},setup:async c=>{await ctx.agentPresets.mount(c,preset);}});handles.push(h);return h.agent;};
   const agent=await create('qq-character');
   manager.commit({sessionId:agent.id,agent,agentPreset:'qq-character',scope:'c2c',peerId:'mock-owner',senderId:'mock-owner'});await manager.getOrCreate('c2c','mock-owner','mock-owner',{scope:'c2c',targetId:'mock-owner'});
   const trusted=ctx.memoryIdentity.forSession(agent.id),status=()=>store.layersStatus(trusted).semantic,exec={agent,signal:new AbortController().signal};
   const tool=async(n,args={})=>JSON.parse(await ctx.tools.get('character_'+n,agent).execute(args,exec));
   const lexical=query=>JSON.stringify(store.recall(trusted,query).map(r=>r.id));
   let n=0;
   // One real turn through the Character ingress. Returns what this turn's memory context provider
   // produced in the first model request of the turn.
   const turn=async(text,{gapMs=0}={})=>{
    await agent.whenIdle();const mark=captures.length,before={...(status().counters??{})},t0=performance.now();
    manager.admitInput(manager.record,{platform:'qq-official',adapter:'qq-official-gateway',accountId:'mock-app',conversation:{type:'direct',id:'mock-owner'},sender:{id:'mock-owner'},message:{id:'probe-'+config.phase+'-'+(++n),text}});
    if(gapMs)await sleep(gapMs);
    const t1=performance.now();agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}));await agent.whenIdle();
    const first=captures[mark];assert(first,'The turn made no model request');
    const at=first.prompt.lastIndexOf('Current runtime context.');assert(at>=0,'no runtime context snapshot in the model request');
    const after=status().counters??{},delta=k=>(after[k]??0)-(before[k]??0);
    return {context:first.prompt.slice(at),ingressToFirstRequestMs:first.at-t0,turnMs:performance.now()-t1,ranked:delta('ranked'),notReady:delta('notReady'),contextWaits:delta('contextWaits'),contextRecovered:delta('contextRecovered')};
   };
   const waitIndexed=async(count,seconds=180)=>{const until=Date.now()+seconds*1000;while(Date.now()<until){if((status().vectors??0)>=count)return true;await sleep(250);}return false;};
   const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
   // Memory persists across the phases' Host processes; seed it once.
   if(!store.recall(trusted,'ATL-2317').length){let seq=0;for(const text of [...FACTS.map(f=>f[0]),...FILLER,...IDS])store.remember(trusted,{kind:'semantic',statement:text},{sessionId:agent.id,eventSeq:++seq,origin:'inference'});}
   report.checks.push(`Character preset with card Persona, Character Identity and Memory loaded; ${TOTAL} synthetic memories present`);

   if(config.phase==='active'){
    assert.equal(status().mode,'active','the generated Core row runs active');
    const t=performance.now();assert(await waitIndexed(TOTAL),'index not built: '+JSON.stringify(status()));
    report.metrics.indexBuild={records:TOTAL,seconds:+((performance.now()-t)/1000).toFixed(1),workerLoadMs:status().worker?.loadMs};
    report.checks.push('Declared default row is active; the real worker indexed every valid record');

    // Cold worker: the first message after the worker stopped (idle unload or crash).
    let pid=status().worker.pid;process.kill(pid);for(let i=0;i<40&&alive(pid);i++)await sleep(50);
    const cold=await turn(FACTS[0][1]);
    report.metrics.coldWorker={semanticInFirstContext:cold.context.includes(FACTS[0][2]),notReady:cold.notReady,contextWaits:cold.contextWaits,ingressToFirstRequestMs:+cold.ingressToFirstRequestMs.toFixed(1)};
    for(let i=0;i<80&&status().worker?.state!=='ready';i++)await sleep(100);
    // Warm worker, the user message immediately after ingress (no gap): the case that was 12/20 before.
    const warm=[];for(const [,query,marker]of FACTS){const r=await turn(query);warm.push({...r,semantic:r.context.includes(marker)});}
    const hit=warm.filter(r=>r.semantic).length;
    report.metrics.firstContext={turns:warm.length,semanticInFirstContext:hit,ratio:+(hit/warm.length).toFixed(2),fellBackToFts5:warm.length-hit,
     vectorNotReadyAtSyncResolve:warm.filter(r=>r.contextWaits>0).length,recoveredByBoundedWait:warm.filter(r=>r.contextRecovered>0).length,notReadyCounted:warm.reduce((a,r)=>a+r.notReady,0),
     ingressToFirstRequestP50Ms:pct(warm.map(r=>r.ingressToFirstRequestMs),.5),ingressToFirstRequestP95Ms:pct(warm.map(r=>r.ingressToFirstRequestMs),.95),turnP50Ms:pct(warm.map(r=>r.turnMs),.5),turnP95Ms:pct(warm.map(r=>r.turnMs),.95)};
    for(const r of warm)if(!r.semantic)assert(r.notReady>0,'every miss must be a counted fallback');
    report.checks.push(`Character ingress followed immediately by the message: ${hit}/${warm.length} first contexts semantic`);

    // Diagnostics: where in the turn the context is resolved, and what the bounded wait contributes.
    const events=[],t0Ref={t:0},origContext=store.context.bind(store),origAwait=store.awaitSemanticContext.bind(store);
    store.context=c=>{const before=status().counters.ranked,text=origContext(c);events.push({at:+(performance.now()-t0Ref.t).toFixed(1),what:'context()',semantic:status().counters.ranked>before});return text;};
    store.awaitSemanticContext=async c=>{const s=performance.now(),r=await origAwait(c);events.push({at:+(s-t0Ref.t).toFixed(1),what:'assemble-hook',waitedMs:+(performance.now()-s).toFixed(1),recompute:r});return r;};
    const timeline=[];
    for(const [,query]of FACTS.slice(0,3)){events.length=0;t0Ref.t=performance.now();const mark=captures.length;const r=await turn(query+' .');timeline.push({firstRequestAt:+(captures[mark].at-t0Ref.t).toFixed(1),events:[...events]});}
    store.context=origContext;
    // Ablation in the same Host: the hook never waits (the behaviour before this change).
    store.awaitSemanticContext=async()=>false;
    const ablated=[];for(const [,query,marker]of FACTS){const r=await turn(query+' ..');ablated.push(r.context.includes(marker));}
    store.awaitSemanticContext=origAwait;
    report.metrics.timeline=timeline;
    report.metrics.withoutBoundedWait={turns:ablated.length,semanticInFirstContext:ablated.filter(Boolean).length};

    // Tools on the real Host.
    const viaTool=await tool('recall',{query:FACTS[2][1]});assert(viaTool[0].statement.includes(FACTS[2][2]),'semantic recall tool');
    assert((await tool('recall',{query:'ATL-2318 怎么样了'}))[0].statement.includes('ATL-2318'),'identifier first');
    assert.deepEqual(await tool('recall',{query:'量子计算的最新进展'}),[],'unrelated query returns nothing');
    const target=viaTool[0],changed=await tool('correct',{id:target.id,revision:target.revision,statement:'用户对芒果过敏，点餐时要避开含芒果的甜品。'});
    const afterCorrect=await turn('What food is he allergic to?  ',{gapMs:50});assert(!afterCorrect.context.includes(FACTS[2][2]),'old revision text reached the context');
    for(let i=0;i<40&&status().vectors<TOTAL;i++)await sleep(250);
    assert((await tool('recall',{query:'mango allergy'})).some(r=>r.id===target.id&&r.statement.includes('芒果')),'corrected text found semantically after re-indexing');
    await tool('forget',{id:target.id,revision:changed.revision});
    assert.equal(status().vectors,TOTAL-1,'forget removed the vector in the same call');
    assert(!(await turn('mango allergy and dessert')).context.includes('芒果'),'forgotten record reached the context');
    report.checks.push('Character tools: semantic recall, identifier first, unrelated empty; correct returns only new text; forget deletes the vector');

    // Identity decides access, not vectors.
    const stranger=await create('cordis');assert.throws(()=>ctx.memoryIdentity.forSession(stranger.id));
    await assert.rejects(()=>store.recallAsync({...trusted},FACTS[0][1],5000));
    report.checks.push('Unbound preset and forged handle refused before any ranking');

    // Worker killed mid-session: that turn falls back, the next ones recover.
    pid=status().worker.pid;process.kill(pid);for(let i=0;i<40&&alive(pid);i++)await sleep(50);
    const crash=await turn(FACTS[4][1]+' ?');assert(!crash.context.includes(FACTS[4][2])&&crash.notReady>0&&crash.ranked===0,'turn after a crash must be a counted FTS5 fallback');
    let recovered=false;for(let i=0;i<40&&!recovered;i++){await sleep(250);recovered=(await turn(FACTS[4][1]+' ?'+i)).context.includes(FACTS[4][2]);}
    assert(recovered,'semantic recall did not recover after the worker was killed');
    report.checks.push('Killed worker: counted FTS5 fallback, new worker, recovery');
   }

   if(config.phase==='shadow'){
    assert.equal(status().mode,'shadow');assert.equal(status().indexer.recreated,true,'the corrupted sidecar was detected and recreated');
    assert(await waitIndexed(TOTAL-1),'index not rebuilt after corruption');
    const turns=[];for(const [,query,marker]of FACTS.slice(0,10)){const r=await turn(query);assert(!r.context.includes(marker),'shadow must not change the context');turns.push(r.turnMs);}
    for(const [,query]of FACTS)assert.equal(JSON.stringify((await tool('recall',{query})).map(r=>r.id)),lexical(query),'shadow recall equals FTS5');
    const s=status().shadow;assert(s.compared>=FACTS.length);
    report.metrics.shadow={compared:s.compared,semanticUnavailable:s.semanticUnavailable,meanOverlapAt5:s.meanOverlapAt5,meanLexicalRows:s.meanLexicalRows,meanSemanticRows:s.meanSemanticRows,turnP50Ms:pct(turns,.5),turnP95Ms:pct(turns,.95)};
    report.checks.push('Restart in shadow with a corrupted sidecar: recreated and rebuilt; contexts and recall identical to FTS5');
   }

   if(config.phase==='off'){
    assert.deepEqual(status(),{mode:'off'});
    const turns=[];for(const [,query,marker]of FACTS.slice(0,10)){const r=await turn(query);assert(!r.context.includes(marker));turns.push(r.turnMs);}
    for(const [,query]of FACTS)assert.equal(JSON.stringify((await tool('recall',{query})).map(r=>r.id)),lexical(query));
    report.metrics.off={turnP50Ms:pct(turns,.5),turnP95Ms:pct(turns,.95),indexFileKept:fs.existsSync(config.indexFile)};
    report.checks.push('Restart with mode off: no ranker, no worker; original FTS5 behaviour; derived index left untouched');
   }

   if(config.phase==='unavailable'){
    const s=status();assert.equal(s.mode,'unavailable');assert.equal(s.requested,'active');assert.match(s.reason,/not provisioned/);
    const turns=[];for(const [,query]of FACTS.slice(0,5))turns.push((await turn(query)).turnMs);
    for(const [,query]of FACTS)assert.equal(JSON.stringify((await tool('recall',{query})).map(r=>r.id)),lexical(query));
    report.metrics.unavailable={reason:s.reason,turnP50Ms:pct(turns,.5)};
    report.checks.push('Default row on a machine without the model: Host and Memory start, FTS5 results, status reports unavailable with the reason');
   }

   const cpu=process.cpuUsage(cpu0),s=status();
   report.metrics.resources={hostRssMB:Math.round(process.memoryUsage().rss/1048576),hostCpuMs:Math.round((cpu.user+cpu.system)/1000),wallSeconds:+((performance.now()-began)/1000).toFixed(1),worker:s.worker,counters:s.counters,indexer:s.indexer};
   report.ok=true;report.status='PASS';
  }catch(error){report.ok=false;report.status='FAIL';report.error=String(error?.stack??error);}
  finally{try{release?.();}catch{}for(const h of handles)await h.dispose().catch(()=>{});fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
 }
}
