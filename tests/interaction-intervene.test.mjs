import test from 'node:test';
import assert from 'node:assert/strict';
import {Interaction} from '../packages/interaction-policy/policy.mjs';
import {apply,judgePrompt} from '../packages/interaction-policy/index.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('completed tools return to text phase; parallel tools and approval remain protected',async()=>{
 for(const decision of ['priority','revise']){
  const f=fixture(async()=>decision);f.start();f.event('tool/call',{callId:'a'});f.event('tool/call',{callId:'b'});
  f.event('tool/result',{message:{source:{callId:'a'}}});assert.equal(f.p.phase(),'tool');
  f.event('tool/result',{message:{source:{callId:'b'}}});assert.equal(f.p.phase(),'text');
  f.p.intervene(f.msg('q2','先处理新要求'));await f.advance(0);assert.deepEqual(f.actions.map(a=>a[0]),['cancel','followup']);await f.p.dispose();
 }
 const f=fixture(null);f.start();f.p.toolSeen=true;f.event('tool/result',{message:{source:{callId:'unknown'}}});assert.equal(f.p.phase(),'tool');await f.p.dispose();
});

test('explicit correction absorbs pending judged inputs exactly once in arrival order',async()=>{
 const pending=deferred(),f=fixture(()=>pending.promise);f.start();f.p.intervene(f.msg('q2','补充一下'));
 f.p.revise(f.msg('q3','更正：先做新任务'));pending.resolve('append');await f.advance(0);
 assert.deepEqual(f.actions.map(x=>x[0]),['cancel','followup','followup']);assert.deepEqual(f.actions.slice(1),[['followup','q2'],['followup','q3']]);await f.p.dispose();
});

test('idle transition while judging cannot reverse input order or duplicate the old input',async()=>{
 const pending=deferred(),f=fixture(()=>pending.promise);f.start();f.p.intervene(f.msg('q2','先到'));
 f.agent.status='idle';f.p.intervene(f.msg('q3','后到'));pending.resolve('priority');await f.advance(0);
 assert.deepEqual(f.actions,[['followup','q2'],['followup','q3']]);await f.p.dispose();
});
function fixture(judge){
 let time=0,id=0;const timers=new Map(),sent=[],bubbles=[],actions=[],traces=[],judged=[];
 const clock={now:()=>time,set(fn,ms){timers.set(++id,{fn,at:time+ms});return id;},clear:i=>timers.delete(i)};
 const agent={status:'running',cancel:(...a)=>actions.push(['cancel',...a]),followup:m=>actions.push(['followup',m.id]),steer:m=>actions.push(['steer',m.id])};
 const j=judge===null?undefined:(input=>{judged.push(input);return judge(input);});
 const p=new Interaction(agent,{hangOnMs:60000,throttleMs:10},clock,undefined,j);
 const transport={key:agent,trace:(e,f)=>traces.push([e,f]),async sendText(text,meta){sent.push([text,meta]);if(meta?.kind==='assistant')bubbles.push({text,meta});}};
 p.bind(transport);
 let rev=0,attempt=0;const event=(type,data={})=>p.event({type,data});
 const start=(text='讲讲 Rust 所有权')=>{event('turn/start');event('user/message',{message:{id:'q1',source:{kind:'user'},content:[{type:'text',text}]}});p.frame({type:'start',attemptId:++attempt,revision:++rev});};
 const chunk=text=>p.frame({type:'chunk',attemptId:attempt,revision:++rev,chunk:{type:'text-delta',text}});
 const message=text=>{event('assistant/message',{message:{content:[{type:'text',text}]}});p.frame({type:'end',attemptId:attempt,revision:++rev,outcome:{eventType:'assistant/message'}});};
 const advance=async ms=>{time+=ms;for(const [k,t]of [...timers])if(t.at<=time){timers.delete(k);t.fn();}for(let i=0;i<5;i++)await Promise.resolve();};
 const msg=(mid,text)=>({id:mid,source:{kind:'user'},content:[{type:'text',text}]});
 const shown=()=>sent.map(s=>s[0]).join('');
 const decision=()=>traces.filter(([e])=>e==='intervene').map(([,{decision,phase,why}])=>JSON.parse(JSON.stringify({decision,phase,why})));
 return {p,agent,event,start,chunk,message,advance,msg,sent,bubbles,actions,traces,judged,shown,decision};
}

test('without a judge, input during a run is queued and never cancels the current reply',async()=>{
 const f=fixture(null);f.start();f.chunk('旧回答第一句。');
 assert.equal(f.p.intervene(f.msg('q2','顺便问下晚饭吃什么')),'queued');
 f.message('旧回答第一句。旧回答第二句。');await f.p.idle();
 assert.deepEqual(f.actions,[['followup','q2']]);assert.equal(f.shown(),'旧回答第一句。旧回答第二句。');
 assert.deepEqual(f.decision(),[{decision:'append',phase:'text',why:'none'}]);
});

test('a judged correction during text generation withholds stale output, cancels and follows up',async()=>{
 const verdict=deferred();const f=fixture(()=>verdict.promise);f.start();f.chunk('所有权的第一句。');await f.advance(11);await f.p.idle();
 assert.equal(f.p.intervene(f.msg('q2','不对，我是想问借用检查器原理')),'judging');
 f.chunk('过期的第二句。');await f.advance(11);
 assert.equal(f.shown(),'','nothing is sent while the judge runs');
 assert.equal(f.judged[0].current,'讲讲 Rust 所有权');assert.equal(f.judged[0].incoming,'不对，我是想问借用检查器原理');assert.equal(f.judged[0].phase,'text');
 verdict.resolve('revise');await f.advance(0);await f.p.idle();
 assert.deepEqual(f.actions,[['cancel',{kind:'user'},{keepInbox:true}],['followup','q2']]);
 f.message('所有权的第一句。过期的第二句。');await f.p.idle();
 assert.equal(f.shown(),'','the uncommitted stale reply is never sent');
});

test('a correction while a tool runs steers without cancelling and withdraws only unsent output',async()=>{
 const f=fixture(async()=>'revise');f.start();f.event('tool/call',{callId:'t1'});
 f.p.intervene(f.msg('q2','换成只读检查'));await f.advance(0);await f.p.idle();
 assert.deepEqual(f.actions,[['steer','q2']]);assert.equal(f.decision()[0].phase,'tool');
});

test('a priority request cancels a text reply but never a tool; old tool-phase output is kept',async()=>{
 const f=fixture(async()=>'priority');f.start();f.chunk('HTTP/3 的第一句。');
 f.p.intervene(f.msg('q2','对了，先说说晚饭吃点什么好'));await f.advance(0);await f.p.idle();
 assert.deepEqual(f.actions.map(a=>a[0]),['cancel','followup']);
 const g=fixture(async()=>'priority');g.start();g.event('tool/call',{callId:'t1'});g.chunk('工具前的说明。');
 g.p.intervene(g.msg('q2','先帮我看下天气'));await g.advance(0);g.message('工具前的说明。');await g.p.idle();
 assert.deepEqual(g.actions,[['steer','q2']]);assert.equal(g.shown(),'工具前的说明。');
});

test('a supplement steers at the next boundary and keeps the current reply intact',async()=>{
 const f=fixture(async()=>'supplement');f.start();f.chunk('第一部分。');
 f.p.intervene(f.msg('q2','记得再加一个对比表'));await f.advance(0);f.message('第一部分。第二部分。');await f.p.idle();
 assert.deepEqual(f.actions,[['steer','q2']]);assert.equal(f.shown(),'第一部分。第二部分。');
});

test('an independent question is queued and held output resumes in order after the judge',async()=>{
 const verdict=deferred();const f=fixture(()=>verdict.promise);f.start();f.chunk('原回答一。');await f.advance(11);await f.p.idle();
 f.p.intervene(f.msg('q2','另外，周末天气怎么样'));f.message('原回答一。原回答二。');await f.advance(0);
 assert.equal(f.shown(),'','held while the judge runs');verdict.resolve('append');await f.advance(0);await f.p.idle();
 assert.deepEqual(f.actions,[['followup','q2']]);assert.equal(f.shown(),'原回答一。原回答二。');
});

test('timeout, judge errors and unknown labels fall back to a queued follow-up',async()=>{
 let signal;const f=fixture(input=>{signal=input.signal;return new Promise(()=>{});});f.start();f.chunk('正文。');
 f.p.intervene(f.msg('q2','嗯？'));await f.advance(2499);assert.deepEqual(f.actions,[]);
 await f.advance(1);assert(signal.aborted);assert.deepEqual(f.actions,[['followup','q2']]);assert.equal(f.decision()[0].why,'timeout');
 f.message('正文。');await f.p.idle();assert.equal(f.shown(),'正文。');
 for(const [judge,why] of [[async()=>{throw Error('down');},'error'],[async()=>'cancel everything','invalid'],[()=>{throw Error('sync');},'error']]){
  const g=fixture(judge);g.start();g.p.intervene(g.msg('q2','x'));await g.advance(0);await g.p.idle();
  assert.deepEqual(g.actions,[['followup','q2']]);assert.equal(g.decision()[0].why,why);
 }
});

test('inputs arriving while judging are judged together and share one decision',async()=>{
 const first=deferred(),second=deferred();let n=0;const f=fixture(()=>++n===1?first.promise:second.promise);f.start();
 f.p.intervene(f.msg('q2','不对'));await f.advance(1000);f.p.intervene(f.msg('q3','我是想问借用检查器'));
 assert(f.judged[0].signal.aborted);assert.equal(f.judged[1].incoming,'不对\n我是想问借用检查器');
 first.resolve('append');await f.advance(0);assert.deepEqual(f.actions,[]);
 second.resolve('revise');await f.advance(0);await f.p.idle();
 assert.deepEqual(f.actions,[['cancel',{kind:'user'},{keepInbox:true}],['followup','q2'],['followup','q3']]);
 // The window stays bounded by the first input.
 const g=fixture(()=>new Promise(()=>{}));g.start();g.p.intervene(g.msg('a','1'));await g.advance(2000);g.p.intervene(g.msg('b','2'));await g.advance(500);
 assert.deepEqual(g.actions,[['followup','a'],['followup','b']]);
});

test('the run ending while judging queues the inputs; /stop discards them',async()=>{
 const verdict=deferred();const f=fixture(()=>verdict.promise);f.start();f.p.intervene(f.msg('q2','不对'));
 f.agent.status='idle';verdict.resolve('revise');await f.advance(0);await f.p.idle();assert.deepEqual(f.actions,[['followup','q2']]);
 const g=fixture(()=>new Promise(()=>{}));g.start();g.chunk('已显示。');await g.advance(11);await g.p.idle();g.p.intervene(g.msg('q2','不对'));
 g.p.stopOutput();await g.advance(3000);await g.p.idle();assert.deepEqual(g.actions,[]);assert.deepEqual(g.decision().at(-1),{decision:'dropped'});
});

test('pending approval or question is never cancelled; an idle Agent simply queues',async()=>{
 const f=fixture(async()=>'priority');f.start();f.p.transport.waitingForUser=()=>true;
 f.p.intervene(f.msg('q2','先停一下'));await f.advance(0);await f.p.idle();assert.deepEqual(f.actions,[['steer','q2']]);assert.equal(f.decision()[0].phase,'waiting-user');
 const g=fixture(async()=>'revise');g.agent.status='idle';assert.equal(g.p.intervene(g.msg('q2','x')),'queued');assert.deepEqual(g.actions,[['followup','q2']]);assert.equal(g.judged.length,0);
 const h=fixture(async()=>'append');h.start();assert.equal(h.p.revise(h.msg('q2','更正：保留文件')),'restarted');assert.equal(h.judged.length,0);
});

test('plugin judge uses the native route without Session attribution and parses one label',async()=>{
 const listeners=new Map(),calls=[];let service,reply='Priority';
 const ctx={provide:(_n,v)=>service=v,on:(n,f)=>listeners.set(n,f),effect(){},logger:{warn(){}},get:()=>undefined,
  systemPrompt:{context(){},layers:{merge:()=>new Map()}},
  llm:{stream(options){calls.push(options);return (async function*(){if(reply==='tool'){yield {type:'tool-call-delta',index:0,id:'x',name:'x',argumentsDelta:'{}'};return;}yield {type:'text-delta',index:0,text:reply};yield {type:'finish',reason:{kind:'stop'}};})();}}};
 apply(ctx,{});const agent={session:{requestHeader:()=>({config:{provider:'main',model:'main-model'}})},status:'running'};listeners.get('agent/created')({agent});
 const policy=service.get(agent),judge=input=>policy.judge({agent,current:'讲讲 HTTP/3',incoming:'先说说晚饭',phase:'text',signal:new AbortController().signal,...input});
 assert.equal(await judge(),'priority');
 const opts=calls[0];assert.equal(opts.provider,'main');assert.equal(opts.model,'main-model');assert.equal(opts.sessionId,undefined);assert.equal(opts.purpose,undefined);assert.equal(opts.tools,undefined);
 assert.equal(opts.system,judgePrompt);assert.match(opts.messages[0].content[0].text,/当前请求：讲讲 HTTP\/3[\s\S]*正在生成回复[\s\S]*新消息：先说说晚饭/);
 reply='我觉得大概是 supplement 吧';assert.equal(await judge(),'supplement');
 reply='说不清';assert.equal(await judge(),'append');
 reply='tool';await assert.rejects(judge(),/tool/);
});

test('judged interjections trace how long the judgement took; explicit ones carry no timing',async()=>{
 const pending=deferred(),f=fixture(()=>pending.promise);f.start();f.chunk('旧回答。');
 f.p.intervene(f.msg('q2','先说说晚饭'));await f.advance(700);pending.resolve('priority');await f.advance(0);
 const judged=f.traces.find(([e])=>e==='intervene')[1];assert.equal(judged.why,'judge');assert.equal(judged.elapsedMs,700);await f.p.dispose();
 const g=fixture(null);g.start();g.p.revise(g.msg('q3','不对，改成三句话'));const explicit=g.traces.find(([e])=>e==='intervene')[1];
 assert.equal(explicit.why,'explicit');assert.equal('elapsedMs' in explicit,false);await g.p.dispose();
 const h=fixture(()=>new Promise(()=>{}));h.start();h.p.intervene(h.msg('q4','随便问问'));await h.advance(2500);
 const timeout=h.traces.find(([e])=>e==='intervene')[1];assert.equal(timeout.why,'timeout');assert.equal(timeout.elapsedMs,2500);await h.p.dispose();
});
