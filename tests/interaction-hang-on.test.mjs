import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Interaction,hangOnLine,options} from '../packages/interaction-policy/policy.mjs';
import {apply,hangOnModel,hangOnPrompt} from '../packages/interaction-policy/index.mjs';

// Same synthetic clock/transport shape as interaction.test.mjs, plus a drafter.
function fixture(config={},drafter){
 let time=0,id=0;const timers=new Map(),sent=[],bubbles=[],drafts=[];
 const clock={now:()=>time,set(fn,ms){timers.set(++id,{fn,at:time+ms});return id;},clear:id=>timers.delete(id)};
 const agent={status:'running',cancel(){},followup(){},steer(){}};
 const draft=drafter===null?undefined:(input=>{const d={...input,at:time};drafts.push(d);return (drafter??(()=>'嗯，我还在弄，稍等我一下。'))(input,d);});
 const p=new Interaction(agent,{hangOnMs:8000,throttleMs:10,...config},clock,draft);
 const transport={key:agent,deliveryReceipts:true,async sendText(text,meta){sent.push(['text',text,meta]);meta?.onDelivered?.();},openStream(meta){const b={text:'',closed:false,meta};bubbles.push(b);return {async update(t){b.text=t;sent.push(['update',t,meta]);},async complete(){b.closed=true;},cancel(){b.closed=true;}};}};
 p.bind(transport);
 const event=(type,data={})=>p.event({type,data});
 let rev=0,attempt=0;const start=()=>{event('turn/start');p.frame({type:'start',attemptId:++attempt,revision:++rev});};
 const chunk=text=>p.frame({type:'chunk',attemptId:attempt,revision:++rev,chunk:{type:'text-delta',text}});
 const message=text=>{event('assistant/message',{message:{content:[{type:'text',text}]}});p.frame({type:'end',attemptId:attempt,revision:++rev,outcome:{eventType:'assistant/message'}});};
 // wait:false drains microtasks only, for tests that hold the send queue open.
 const advance=async(ms,wait=true)=>{const end=time+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].fn();await settle(wait);}time=end;if(wait)await p.idle();};
 const settle=async(wait=true)=>{for(let i=0;i<5;i++)await Promise.resolve();if(wait)await p.idle();};
 const status=()=>sent.filter(s=>s[2]?.kind==='status');
 return {p,agent,transport,event,start,chunk,message,advance,settle,sent,bubbles,drafts,status,get time(){return time;}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('draft starts at about 5.5s and a finished candidate is sent once at 8s',async()=>{
 const f=fixture();f.start();await f.advance(5499);assert.equal(f.drafts.length,0);
 await f.advance(1);assert.equal(f.drafts.length,1);assert.equal(f.drafts[0].state,'agent');assert(f.drafts[0].signal instanceof AbortSignal);
 await f.advance(2499);assert.equal(f.status().length,0);
 await f.advance(1);assert.deepEqual(f.status().map(s=>s[1]),['嗯，我还在弄，稍等我一下。']);assert.equal(f.status()[0][2].transient,true);
 await f.advance(60000);assert.equal(f.status().length,1);assert.equal(f.drafts.length,1);await f.p.dispose();
});

test('unfinished draft at 8s falls back to the fixed text; its late result is discarded',async()=>{
 const pending=deferred();const f=fixture({},()=>pending.promise);f.start();
 await f.advance(8000);assert.deepEqual(f.status().map(s=>s[1]),['还在处理中，稍等一下。']);assert(f.drafts[0].signal.aborted);
 pending.resolve('迟到的候选');await f.settle();await f.advance(20000);assert.equal(f.status().length,1);assert.equal(f.p.candidate,null);await f.p.dispose();
});

test('natural receipt before 8s aborts the draft and drops any candidate',async()=>{
 const pending=deferred();const f=fixture({},()=>pending.promise);f.start();await f.advance(6000);
 f.chunk('我看了一下。');await f.advance(20);f.bubbles[0].meta.onDelivered();assert(f.drafts[0].signal.aborted);
 pending.resolve('还在想');await f.settle();await f.advance(5000);assert.equal(f.status().length,0);await f.p.dispose();
 const g=fixture();g.start();g.chunk('很快就回复了。');await g.advance(20);g.bubbles[0].meta.onDelivered();await g.advance(10000);assert.equal(g.drafts.length,0);assert.equal(g.status().length,0);await g.p.dispose();
});

test('status receipts never count as natural delivery',async()=>{
 const f=fixture();f.start();await f.advance(8000);assert.equal(f.status().length,1);assert.equal(f.p.delivered,false);
 f.chunk('正文。');await f.advance(20);assert.equal(f.p.delivered,false);f.bubbles[0].meta.onDelivered();assert.equal(f.p.delivered,true);
 assert.equal(f.status()[0][2].kind,'status');assert.equal(f.bubbles[0].meta.kind,'assistant');await f.p.dispose();
});

test('cancel, stop, aborted turns and idle agents abort the draft and send nothing',async()=>{
 for(const mode of ['stop','aborted','idle','revise']){
  const pending=deferred();const f=fixture({},()=>pending.promise);f.start();await f.advance(6000);
  if(mode==='stop')f.p.stopOutput();else if(mode==='aborted')f.event('turn/end',{reason:{kind:'aborted'}});else if(mode==='idle'){f.agent.status='idle';f.p.active=false;f.p.invalidate();}else f.p.revise({native:true});
  assert(f.drafts[0].signal.aborted,mode);pending.resolve('不应出现');await f.settle();await f.advance(10000);assert.equal(f.status().length,0,mode);await f.p.dispose();
 }
});

test('pending approval or question suppresses draft and hang-on',async()=>{
 const f=fixture();let waiting=true;f.transport.waitingForUser=()=>waiting;f.start();await f.advance(10000);assert.equal(f.drafts.length,0);assert.equal(f.status().length,0);await f.p.dispose();
 const g=fixture({},()=>new Promise(()=>{}));let ask=false;g.transport.waitingForUser=()=>ask;g.start();await g.advance(6000);ask=true;await g.advance(2000);assert(g.drafts[0].signal.aborted);assert.equal(g.status().length,0);await g.p.dispose();
});

test('a draft from an earlier turn never leaks into the next turn',async()=>{
 const first=deferred(),second=deferred();let n=0;const f=fixture({},()=>++n===1?first.promise:second.promise);
 f.start();await f.advance(6000);f.message('第一轮结束。');f.event('turn/end',{reason:{kind:'completed'}});await f.settle();
 f.start();first.resolve('上一轮的候选');await f.settle();await f.advance(5500);second.resolve('这一轮稍等我一下');await f.settle();
 await f.advance(2500);assert.deepEqual(f.status().map(s=>s[1]),['这一轮稍等我一下']);assert.equal(f.drafts.length,2);
 assert.equal(f.status()[0][2].reply,2);await f.p.dispose();
});

test('unsafe, empty or failing drafts fall back to the fixed text',async()=>{
 for(const drafter of [()=>'还要大概3分钟',()=>'**稍等**',()=>'',()=>'稍'.repeat(61),()=>{throw Error('sync');},async()=>{throw Error('async');},()=>'见 https://example.invalid']){
  const f=fixture({},drafter);f.start();await f.advance(8000);assert.deepEqual(f.status().map(s=>s[1]),['还在处理中，稍等一下。']);await f.p.dispose();
 }
 assert.equal(hangOnLine('「嗯，稍等我一下。」\n'),'嗯，稍等我一下。');
});

test('drafting runs concurrently and never blocks the main stream',async()=>{
 const pending=deferred();const f=fixture({},()=>pending.promise);f.start();await f.advance(5600);
 f.chunk('正文先开始流式输出。');await f.advance(20);assert.deepEqual(f.bubbles.map(b=>b.text),['正文先开始流式输出。']);
 f.p.draft();assert.equal(f.drafts.length,1);await f.advance(2400);assert.equal(f.status().length,1);pending.resolve('无用');await f.p.dispose();
});

test('hang-on reserves its bubble before settlement so maxBubbles holds',async()=>{
 const f=fixture({maxBubbles:3});delete f.transport.openStream;const gate=deferred();let first=true;
 f.transport.sendText=async(text,meta)=>{f.sent.push(['text',text,meta]);if(first){first=false;await gate.promise;}meta?.onDelivered?.();};
 f.start();f.message('我先检查一下。');await f.settle(false);await f.advance(8000,false);
 const text='第一份完整结果。'.repeat(40)+'\n\n'+'第二份完整结果。'.repeat(40)+'\n\n'+'第三份完整结果。'.repeat(40);
 f.message(text);gate.resolve();await f.p.idle();
 assert(f.sent.length<=3,`sent ${f.sent.length}`);assert.equal(f.sent.filter(s=>s[2]?.kind!=='status').map(s=>s[1]).join(''),'我先检查一下。'+text);await f.p.dispose();
 // Settled text already claimed the whole budget and awaits receipts: no draft, no status.
 const g=fixture({maxBubbles:2});g.start();g.message('嗯，我先看一下。马上就好。');await g.settle();assert.equal(g.p.bubbles,2);await g.advance(8000);assert.equal(g.status().length,0);assert.equal(g.drafts.length,0);await g.p.dispose();
});

test('send order: status queued at 8s precedes later text and follows earlier queued text',async()=>{
 const f=fixture();delete f.transport.openStream;f.transport.sendText=async(text,meta)=>{f.sent.push(['text',text,meta]);};
 f.start();await f.advance(8000);f.message('后来的正文。');await f.p.idle();assert.deepEqual(f.sent.map(s=>s[2].kind),['status','assistant']);await f.p.dispose();
 // Earlier streamed text still awaiting its receipt is followed, never overtaken.
 const g=fixture();g.start();g.chunk('早到但未确认的正文。');await g.advance(20);await g.advance(8000);assert.deepEqual(g.sent.map(s=>[s[0],s[2].kind]),[['update','assistant'],['text','status']]);await g.p.dispose();
 // A static send that completes before the status runs is its own receipt: status dropped.
 const h=fixture();const gate=deferred();delete h.transport.openStream;h.transport.sendText=async(text,meta)=>{h.sent.push(['text',text,meta]);if(meta.kind==='assistant')await gate.promise;meta.onDelivered?.();};
 h.start();h.message('先发出的正文。');await h.settle(false);await h.advance(8000,false);gate.resolve();await h.p.idle();assert.deepEqual(h.sent.map(s=>s[2].kind),['assistant']);assert.equal(h.p.bubbles,1);await h.p.dispose();
});

test('without a drafter the fixed hang-on behaviour is unchanged',async()=>{
 const f=fixture({},null);f.start();await f.advance(8000);assert.deepEqual(f.status().map(s=>s[1]),['还在处理中，稍等一下。']);await f.p.dispose();
 assert.equal(options().hangOnDraftMs,5500);assert.equal(options({hangOnMs:30}).hangOnDraftMs,21);
 for(const bad of [{hangOnDraftMs:8000},{hangOnDraftMs:-1},{hangOnModelFile:'relative/hangon-model.json'},{hangOnModelFile:3}])assert.throws(()=>options(bad));
 assert.equal(options({hangOnModelFile:'C:/data/hangon-model.json'}).hangOnModelFile,'C:/data/hangon-model.json');
});

// Plugin wiring: model routing, Persona-only prompt, no Session attribution.
function plugin(config={},{chunks,header={provider:'main',model:'main-model'},persona='你是小A，说话温和。',selection}={}){
 const listeners=new Map(),calls=[],warnings=[];let service;
 const sections=new Map([['deployment:persona-prefix',{text:persona}],['deployment:persona-suffix',{text:()=>'（后缀）'}],['other',{text:'不应包含'}]]);
 const ctx={provide:(_n,v)=>service=v,on:(n,f)=>listeners.set(n,f),effect(){},logger:{warn:m=>warnings.push(m)},get:n=>n==='agentDefaultModel'?{currentSelection:()=>selection}:undefined,
  systemPrompt:{context(){},layers:{merge:(scope,pick)=>{calls.push(['merge',scope]);return sections;}}},
  llm:{stream(options){calls.push(['stream',options]);return (async function*(){for(const c of chunks??[{type:'text-delta',index:0,text:'嗯，'},{type:'text-delta',index:0,text:'稍等我一下。'},{type:'finish',reason:{kind:'stop'}}])yield c;})();}}};
 apply(ctx,config);
 const agent={session:{requestHeader:()=>header&&{config:{...header,maxTokens:9000}}},status:'running'};
 listeners.get('agent/created')({agent});
 const policy=service.get(agent);
 return {policy,agent,calls,warnings,draft:(state='agent')=>policy.drafter({agent,state,signal:new AbortController().signal})};
}

test('dynamic draft inherits the current Agent route and never attributes a Session',async()=>{
 const f=plugin();assert.equal(await f.draft('tool'),'嗯，稍等我一下。');
 const [,opts]=f.calls.find(c=>c[0]==='stream');
 assert.equal(opts.provider,'main');assert.equal(opts.model,'main-model');assert.equal(opts.sessionId,undefined);assert.equal(opts.purpose,undefined);assert.equal(opts.tools,undefined);
 assert(opts.system.startsWith('你是小A，说话温和。\n\n（后缀）'));assert(!opts.system.includes('不应包含'));assert.equal(opts.messages.length,1);assert.match(opts.messages[0].content[0].text,/执行工具/);
 assert(f.calls.some(c=>c[0]==='merge'&&c[1]===f.agent));
 const g=plugin({},{header:null,selection:{provider:'default',model:'default-model'}});await g.draft();assert.equal(g.calls.find(c=>c[0]==='stream')[1].provider,'default');
 const h=plugin({},{header:null});await assert.rejects(h.draft(),/route unavailable/);
});

test('hangon-model.json overrides only provider and model; missing or invalid inherits',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hangon-'));const file=join(dir,'hangon-model.json');
 try{
  let f=plugin({hangOnModelFile:file});await f.draft();assert.equal(f.calls.find(c=>c[0]==='stream')[1].model,'main-model');assert.equal(f.warnings.length,0);
  writeFileSync(file,'\uFEFF'+JSON.stringify({provider:'fast',model:'fast-small'}));
  f=plugin({hangOnModelFile:file});await f.draft();const opts=f.calls.find(c=>c[0]==='stream')[1];assert.equal(opts.provider,'fast');assert.equal(opts.model,'fast-small');
  for(const bad of [{provider:'fast'},{provider:'fast',model:'m',temperature:1},{provider:'',model:'m'},[]]){
   writeFileSync(file,JSON.stringify(bad));const g=plugin({hangOnModelFile:file});await g.draft();assert.equal(g.calls.find(c=>c[0]==='stream')[1].provider,'main');assert.equal(g.warnings.length,1);
  }
  writeFileSync(file,'{broken');const g=plugin({hangOnModelFile:file});await g.draft();assert.equal(g.calls.find(c=>c[0]==='stream')[1].provider,'main');
  assert.equal(hangOnModel(undefined),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('incomplete, tool-calling or aborted model streams are rejected',async()=>{
 await assert.rejects(plugin({},{chunks:[{type:'text-delta',index:0,text:'稍'},{type:'finish',reason:{kind:'max-tokens'}}]}).draft(),/incomplete/);
 await assert.rejects(plugin({},{chunks:[{type:'tool-call-delta',index:0,id:'x',argumentsDelta:''}]}).draft(),/tool/);
 await assert.rejects(plugin({},{chunks:[{type:'finish',reason:{kind:'aborted'}}]}).draft(),/incomplete/);
 assert(hangOnPrompt('').startsWith('【等待提示】'));assert(hangOnPrompt('P').includes('不要描述进度'));
});
