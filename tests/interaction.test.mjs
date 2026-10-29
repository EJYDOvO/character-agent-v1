import test from 'node:test';
import assert from 'node:assert/strict';
import {Interaction,boundary,options,replyPolicy,semanticParts} from '../packages/interaction-policy/policy.mjs';
import {apply} from '../packages/interaction-policy/index.mjs';
function fixture(config={}){
 let time=0,id=0;const timers=new Map(),sent=[],actions=[],bubbles=[];
 const clock={now:()=>time,set(fn,ms){timers.set(++id,{fn,at:time+ms});return id;},clear:id=>timers.delete(id)};
 const agent={status:'running',cancel:(...a)=>actions.push(['cancel',...a]),followup:m=>actions.push(['followup',m]),steer:m=>actions.push(['steer',m])};
 const p=new Interaction(agent,{hangOnMs:30,throttleMs:10,...config},clock);
 const transport={key:agent,async sendText(text,meta){sent.push(['text',text,meta]);},openStream(meta){const b={text:'',closed:false,meta};bubbles.push(b);sent.push(['open']);return {async update(t){assert(!b.closed);b.text=t;sent.push(['update',t]);},async complete(){assert(!b.closed);b.closed=true;sent.push(['complete']);},cancel(){b.closed=true;sent.push(['cancel']);}};}};
 p.bind(transport);
 const event=(type,data={})=>p.event({type,data});
 let rev=0,attempt=0;const start=()=>{event('turn/start');p.frame({type:'start',attemptId:++attempt,revision:++rev});};
 const chunk=text=>p.frame({type:'chunk',attemptId:attempt,revision:++rev,chunk:{type:'text-delta',text}});
 const message=text=>{event('assistant/message',{message:{content:[{type:'text',text}]}});p.frame({type:'end',attemptId:attempt,revision:++rev,outcome:{eventType:'assistant/message'}});};
 const advance=async ms=>{time+=ms;for(const [key,t]of [...timers])if(t.at<=time){timers.delete(key);t.fn();}await p.idle();};
 return {p,agent,transport,event,start,chunk,message,advance,sent,actions,bubbles,timers};
}
test('short natural chat stays one streaming bubble without truncation or duplicate settlement',async()=>{
 const f=fixture();f.start();f.chunk('嗯，今天还不错。');await f.advance(11);f.chunk('咖啡机终于修好了。');f.message('嗯，今天还不错。咖啡机终于修好了。');f.event('turn/end',{reason:{kind:'completed'}});await f.p.idle();
 assert.deepEqual(f.bubbles.map(b=>b.text),['嗯，今天还不错。咖啡机终于修好了。']);assert(f.bubbles.every(b=>b.closed));assert.equal(f.sent.filter(s=>s[0]==='text').length,0);
 assert.deepEqual(f.sent.filter(s=>['open','complete'].includes(s[0])).map(s=>s[0]),['open','complete']);
});
test('a chat reply splits only at a paragraph break between substantial parts',()=>{
 const config=options({});
 for(const text of ['嗯，明白。有什么正事，快说。','嗯。\n\n这件事我明天再看看吧。','嗯，你好。今天的档案整理得差不多了。咖啡机又坏了。'])assert.deepEqual(semanticParts(text,config,3),[text]);
 const two='嗯，先去吃饭，回来再说这件事。\n\n然后再处理剩下的几个问题。';assert.deepEqual(semanticParts(two,config,3),['嗯，先去吃饭，回来再说这件事。\n\n','然后再处理剩下的几个问题。']);
});
test('all chunk partitionings preserve short Chinese text and closed quote boundary',async()=>{
 const text='嗯，我记得这件事。「明天再说！」现在先喝咖啡。';
 for(let size=1;size<text.length;size++){
  const f=fixture();f.start();for(let i=0;i<text.length;i+=size){f.chunk(text.slice(i,i+size));await f.advance(10);}f.message(text);await f.p.idle();assert.equal(f.bubbles.map(b=>b.text).join(''),text);assert(f.bubbles.length<=3);await f.p.dispose();
 }
});
test('structured Assistant result retains streaming and formatting after tool progress',async()=>{
 const f=fixture();f.start();f.chunk('嗯，我先检查一下。');f.message('嗯，我先检查一下。');f.event('tool/call',{callId:'one'});f.event('tool/result',{message:{source:{callId:'one'}}});
 const text='检查结果如下。\n```js\nconsole.log("完整代码。不要拆开。")\n```\n- 第一项\n- 第二项';
 f.p.text(text);f.p.finish(text);await f.p.idle();assert.deepEqual(f.bubbles.map(b=>b.text),['嗯，我先检查一下。',text]);assert.equal(f.sent.filter(s=>s[0]==='text').length,0);
});
test('hang-on uses actual running state and elapsed clock, once per turn, transient only',async()=>{
 const f=fixture();f.start();await f.advance(29);assert.equal(f.sent.length,0);f.event('tool/call',{callId:'one'});await f.advance(1);await f.advance(500);f.p.hangOn();await f.p.idle();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0][2].transient,true);assert.equal(f.sent[0][2].state,'tool');f.event('turn/end',{reason:{kind:'completed'}});await f.p.dispose();
});
test('delivered response, idle and closed turns suppress redundant hang-on',async()=>{
 for(const mode of ['natural','idle','ended']){const f=fixture();f.start();if(mode==='natural'){f.chunk('嗯，');await f.advance(11);}if(mode==='idle')f.agent.status='idle';if(mode==='ended')f.event('turn/end',{reason:{kind:'completed'}});await f.advance(40);assert(!f.sent.some(s=>s[2]?.kind==='status'));await f.p.dispose();}
 const f=fixture();f.start();f.chunk('我正在检查。');await f.advance(11);f.p.hangOn();await f.p.idle();assert(!f.sent.some(s=>s[2]?.kind==='status'));await f.p.dispose();
});
test('explicit revision cancels text only, preserves inbox and queues native followup',async()=>{
 const f=fixture();f.start();f.chunk('旧回复未发送');assert.equal(f.p.revise({native:true}),'restarted');await f.p.idle();assert.equal(f.sent.length,0);assert.deepEqual(f.actions,[['cancel',{kind:'user'},{keepInbox:true}],['followup',{native:true}]]);await f.p.dispose();
});
test('tool call fragments, active tools and unknown phase use steer, never cancel',async()=>{
 for(const mode of ['fragment','running','unknown']){const f=fixture();f.start();if(mode==='fragment')f.p.toolSeen=true;else if(mode==='unknown')f.p.active=false;else{f.event('tool/call',{callId:'x'});if(mode==='completed')f.event('tool/result',{message:{source:{callId:'x'}}});}assert.equal(f.p.revise({native:true}),'steered');assert.equal(f.actions[0][0],'steer');assert.equal(f.actions.length,1);await f.p.dispose();}
});
test('cancel drops unsent output, closes visible stream and ignores stale frames',async()=>{
 const f=fixture();f.start();f.chunk('已经可见');await f.advance(11);f.chunk('未发送的尾巴');f.event('turn/end',{reason:{kind:'aborted'}});await f.advance(100);f.chunk('迟到片段');await f.p.idle();assert.equal(f.bubbles[0].text,'已经可见');assert(f.bubbles[0].closed);await f.p.dispose();
});
test('duplicate/reordered revisions cannot repeat text; consecutive turns preserve final queue',async()=>{
 const f=fixture();f.start();const frame={type:'chunk',attemptId:1,revision:10,chunk:{type:'text-delta',text:'第一轮。'}};f.p.frame(frame);f.p.frame(frame);f.p.frame({...frame,revision:9});f.message('第一轮。');f.event('turn/end',{reason:{kind:'completed'}});f.event('turn/start');f.p.text('第二轮。');f.p.finish('第二轮。');await f.p.idle();assert.deepEqual(f.bubbles.map(b=>b.text),['第一轮。','第二轮。']);await f.p.dispose();
});
test('stream unavailable falls back once; ambiguous update failure never duplicates statically',async()=>{
 const f=fixture();f.transport.openStream=()=>{throw Error('unsupported');};f.start();f.chunk('保留全文');f.message('保留全文');await f.p.idle();assert.equal(f.sent.filter(s=>s[0]==='text').length,1);await f.p.dispose();
 const g=fixture();g.transport.openStream=()=>({update:async()=>{throw Error('uncertain delivery');},complete:async()=>{}});g.start();g.chunk('不能重复');g.message('不能重复');await g.p.idle();assert.equal(g.sent.length,0);assert(g.p.errors.includes('stream-delivery-unknown'));await g.p.dispose();
});
test('Markdown boundaries conservative; validation and disabled mode',async()=>{
 for(const t of ['```js\n内容。还有。\n```','[链接](https://example.com)。后文','- 列表。下一项','| 表格。内容 |'])assert.equal(boundary(t),0);
 assert.throws(()=>options({maxBubbles:50}));assert(replyPolicy.includes('完整 Assistant'));for(const t of ['简短问候','不据此推断','可以调侃','不要向用户复述内部工具名'])assert(replyPolicy.includes(t),t);
 const f=fixture({enabled:false});assert.equal(f.p.bind(f.transport),false);f.start();f.chunk('禁止发送');await f.advance(500);assert.equal(f.sent.length,0);await f.p.dispose();
});
test('static transport segments naturally, no additional model or storage needed',async()=>{
 const f=fixture();delete f.transport.openStream;f.start();f.chunk('嗯，先去吃饭。然后再处理。');f.message('嗯，先去吃饭。然后再处理。');await f.p.idle();assert.deepEqual(f.sent.map(s=>s[1]),['嗯，先去吃饭。然后再处理。']);await f.p.dispose();
 const g=fixture();delete g.transport.openStream;g.start();const text='嗯，先去吃饭，回来再说这件事。\n\n然后再处理剩下的几个问题。';g.chunk(text);g.message(text);await g.p.idle();assert.equal(g.sent.length,2);assert.equal(g.sent.map(s=>s[1]).join(''),text);await g.p.dispose();
});
test('pending approval/question suppresses hang-on and explicit stop suppresses tool-drain status',async()=>{
 const f=fixture();f.transport.waitingForUser=()=>true;f.start();await f.advance(100);assert.equal(f.sent.length,0);f.transport.waitingForUser=()=>false;f.p.stopOutput();await f.advance(100);assert.equal(f.sent.length,0);await f.p.dispose();
});
test('slow sender cannot reorder bubbles; cancel discards queued segments',async()=>{
 const f=fixture();let unblock;const wait=new Promise(r=>unblock=r),order=[];
 f.transport.openStream=()=>({async update(text){order.push(text);await wait;},async complete(){order.push('closed');},cancel(){order.push('closed');}});
 const text='第一段完整内容，写得足够长。\n\n第二段完整内容，同样足够长。';
 f.start();f.chunk(text);f.message(text);await Promise.resolve();f.p.stopOutput();unblock();await f.p.idle();assert.deepEqual(order,['第一段完整内容，写得足够长。\n\n','closed']);await f.p.dispose();
});
test('canonical final supplies a missing stream suffix and output target remains bound to its message',async()=>{
 const f=fixture();f.start();f.chunk('已有前缀');const other=[];f.p.bind({key:f.agent,sendText:async t=>other.push(t)});f.message('已有前缀，还有尾巴');await f.p.idle();assert.equal(f.bubbles.map(b=>b.text).join(''),'已有前缀，还有尾巴');assert.equal(other.length,0);await f.p.dispose();
});
test('plugin lifecycle does not consume serial Agent creation and revokes disposed handles',async()=>{
 const listeners=new Map(),clean=[],agent={session:{header:{id:'fake'}},status:'idle'};let service;
 apply({provide:(_n,v)=>service=v,systemPrompt:{context(){}},on:(n,f)=>listeners.set(n,f),effect:f=>clean.push(f())});
 assert.equal(listeners.get('agent/created')({agent}),undefined);assert(service.get(agent));assert.throws(()=>service.get({session:agent.session}));
 await listeners.get('agent/disposed')({agent});assert.throws(()=>service.get(agent));for(const fn of clean)await fn();
});

for(const requireIngress of [false,true])test(`native Host context preserves the current input and stream (requireIngress=${requireIngress})`,async()=>{
 const f=fixture();f.transport.requireIngress=requireIngress;f.p.bind(f.transport);
 try{
  f.event('turn/start',{turn:1});const input={id:'qq-input',source:{kind:'user'}};
  if(requireIngress)f.p.admitInput(input);f.event('user/message',input);
  for(const kind of ['agent-instructions','runtime-context','skill-catalog','time-context']){
   f.event('user/message',{message:{id:kind,source:{kind}}});assert.equal(f.p.background,false);
  }
  f.p.text('已经发送的前缀');await f.advance(11);
  f.event('tool/call',{callId:'search'});
  f.event('user/message',{id:'refreshed-time',source:{kind:'time-context'}});
  f.event('tool/result',{message:{source:{callId:'search'}}});
  f.message('已经发送的前缀，还有完整结果');f.event('turn/end',{reason:{kind:'completed'}});await f.p.idle();
  assert.equal(f.bubbles.map(b=>b.text).join(''),'已经发送的前缀，还有完整结果');assert(f.bubbles.every(b=>b.closed));
 }finally{await f.p.dispose();}
});

test('Host context cannot admit background/Web input or revive canceled output',async()=>{
 for(const origin of ['none','web','schedule','user','unknown','cancel']){
  const f=fixture();f.transport.requireIngress=true;f.p.bind(f.transport);
  try{
   f.event('turn/start');
   if(origin==='cancel'){const input={id:'admitted',source:{kind:'user'}};f.p.admitInput(input);f.event('user/message',input);f.p.stopOutput();}
   else if(origin!=='none')f.event('user/message',{id:'not-admitted',source:{kind:origin}});
   for(const kind of ['agent-instructions','runtime-context','skill-catalog','time-context'])f.event('user/message',{source:{kind}});
   f.chunk('不应发送');f.message('不应发送');await f.advance(100);assert.deepEqual(f.sent,[],origin);
  }finally{await f.p.dispose();}
 }
});

test('eight seconds without a transport receipt triggers once even after model text exists',async()=>{
 const f=fixture({hangOnMs:8000});f.transport.deliveryReceipts=true;f.start();f.chunk('模型已经生成但SDK仍在缓冲的内容。');
 await f.advance(7999);assert.equal(f.sent.filter(x=>x[2]?.kind==='status').length,0);
 await f.advance(1);assert.equal(f.sent.filter(x=>x[2]?.kind==='status').length,1);
 await f.advance(20000);assert.equal(f.sent.filter(x=>x[2]?.kind==='status').length,1);await f.p.dispose();
});

test('receipt suppresses queued hang-on; old canceled receipt cannot suppress a new turn',async()=>{
 const f=fixture({hangOnMs:8000});f.transport.deliveryReceipts=true;f.start();f.chunk('自然回应');await f.advance(11);
 const receipt=f.bubbles[0].meta.onDelivered;f.p.hangOn();receipt();await f.p.idle();assert(!f.sent.some(x=>x[2]?.kind==='status'));
 f.p.stopOutput();f.start();receipt();await f.advance(8000);assert.equal(f.sent.filter(x=>x[2]?.kind==='status').length,1);await f.p.dispose();
});

test('slow stream receipt cannot be overtaken by a status queued at the deadline',async()=>{
 const f=fixture({hangOnMs:8000});f.transport.deliveryReceipts=true;let release,meta;
 f.transport.openStream=m=>{meta=m;return {update:()=>new Promise(r=>release=r),complete:async()=>{},cancel(){}};};
 f.start();f.chunk('慢网络内容');f.p.update(f.p.message);await Promise.resolve();await Promise.resolve();
 f.p.hangOn();meta.onDelivered();release();await f.p.idle();assert(!f.sent.some(x=>x[2]?.kind==='status'));await f.p.dispose();
});

test('tool results over 240 characters split at useful boundaries without losing or repeating text',async()=>{
 const text=Array.from({length:12},(_,i)=>`第${i}项结果：`+'这是有依据的完整说明'.repeat(4)+'。').join('\n\n');
 const partitions=[];
 for(const size of [1,7,80,text.length]){
  const f=fixture();f.start();f.event('tool/call',{callId:'read'});f.event('tool/result',{message:{source:{callId:'read'}}});
  for(let i=0;i<text.length;i+=size){f.chunk(text.slice(i,i+size));await f.advance(10);}
  // Long replies may commit bubbles while streaming; committed text is always a final prefix.
  assert(f.bubbles.length<=3);assert(text.startsWith(f.bubbles.filter(b=>b.closed).map(b=>b.text).join('')));assert(f.bubbles.filter(b=>!b.closed).length<=1);
  f.message(text);await f.p.idle();const result=f.bubbles.map(b=>b.text);assert(result.length>1&&result.length<=3);assert.equal(result.join(''),text);assert(f.bubbles.every(b=>b.closed));partitions.push(result);await f.p.dispose();
 }
 for(const parts of partitions)assert.deepEqual(parts,partitions[0]);
});

test('long Markdown blocks, inline links, quotes, tables and lists are atomic',()=>{
 const before='前面的完整说明。'.repeat(22)+'\n\n',after='后面的补充说明。'.repeat(22);
 for(const block of ['```js\n'+ 'console.log("不要拆开。代码！");\n'.repeat(18)+'```', '- 列表第一项。\n  续行说明。\n- 列表第二项。', '| 名称 | 说明 |\n|---|---|\n| 内容 | 不能拆开。 |', '[链接说明。](https://example.invalid/path?q=1)', '「这是引用。里面不能断开！」']){
  const text=before+block+'\n\n'+after,parts=semanticParts(text,options(),3);
  assert.equal(parts.join(''),text);assert(parts.some(p=>p.includes(block)),block);
 }
});

test('hang-on stays outside the content bubble budget; final remainder is never truncated',async()=>{
 const f=fixture();delete f.transport.openStream;f.start();f.p.hangOn();await f.p.idle();assert.equal(f.p.bubbles,0);f.message('先检查一下。');
 const text='第一份完整结果。'.repeat(40)+'\n\n'+'第二份完整结果。'.repeat(40);f.message(text);await f.p.idle();
 const content=f.sent.filter(s=>s[2]?.kind!=='status');assert.equal(f.sent.length-content.length,1);assert.equal(content.length,3);
 assert.equal(content.map(s=>s[1]).join(''),'先检查一下。'+text);await f.p.dispose();
});
