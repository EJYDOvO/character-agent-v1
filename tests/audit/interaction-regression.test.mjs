// Release gates for test.10 audit. These assert desired behavior, not the bugs.
// Expected to fail on the audited baseline. No network, credentials or Host data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Interaction,boundary} from '../../packages/interaction-policy/policy.mjs';
import {apply} from '../../packages/interaction-policy/index.mjs';
const micro=()=>new Promise(r=>setImmediate(r));
function fixture(t,config={}){
 const timers=new Map(),sent=[],actions=[];let n=0;
 const clock={now:()=>0,set(fn){timers.set(++n,fn);return n;},clear:id=>timers.delete(id)};
 const agent={session:{},status:'running',cancel:()=>actions.push('cancel'),followup:()=>actions.push('followup'),steer:()=>actions.push('steer')};
 const p=new Interaction(agent,config,clock),key={};p.bind({key,sendText:async text=>sent.push(text)});
 t.after(()=>p.dispose());
 const event=(type,data={})=>p.event({type,data});
 const start=()=>{event('turn/start',{turn:1});p.frame({type:'start',attemptId:'one',revision:1,turn:1,step:1});};
 const chunk=text=>p.frame({type:'chunk',attemptId:'one',revision:2,chunk:{type:'text-delta',text}});
 const settle=text=>event('assistant/message',{turn:1,message:{content:[{type:'text',text}]}});
 return {p,agent,key,sent,actions,event,start,chunk,settle,timers};
}
test('A01 abandoned attempt must not publish an unsent draft',async t=>{
 const f=fixture(t);f.start();f.chunk('尚未提交的错误草稿');f.p.frame({type:'end',attemptId:'one',revision:3,outcome:{kind:'abandoned'}});await f.p.idle();assert.deepEqual(f.sent,[]);
});
test('A02 committed assistant/attempt then successful retry must not finalize the failed draft',async t=>{
 const f=fixture(t);f.start();f.chunk('错误尝试');f.p.frame({type:'end',attemptId:'one',revision:3,outcome:{kind:'committed',eventType:'assistant/attempt',seq:7}});
 f.p.frame({type:'start',attemptId:'two',revision:4,turn:1,step:1});f.p.frame({type:'chunk',attemptId:'two',revision:5,chunk:{type:'text-delta',text:'正确结果'}});f.settle('正确结果');await f.p.idle();assert.deepEqual(f.sent,['正确结果']);
});
test('A03 canonical settlement replaces a divergent draft before any delivery',async t=>{
 const f=fixture(t);f.start();f.chunk('错误答案');f.settle('正确答案');await f.p.idle();assert.deepEqual(f.sent,['正确答案']);
});
test('A04 first short sentence must not hide a later complete boundary',()=>{
 assert(boundary('好。这是完整的一句话。后面还有一句。')>2);
});
test('A05 semantic bubbles are independent of chunk partition across chatMaxChars',async t=>{
 const text='第一句已经足够长。第二句也有足够的字。第三句继续补全长度。',results=[];
 for(const size of [text.length,1]){const f=fixture(t,{chatMaxChars:20});f.start();for(let i=0;i<text.length;i+=size)f.p.text(text.slice(i,i+size));f.settle(text);await f.p.idle();results.push(f.sent);}
 assert.deepEqual(results[0],results[1]);
});
test('A06 quoted sentence stays within one balanced Chinese quotation',async t=>{
 const f=fixture(t);f.start();const text='他说「今天先处理这件事。明天再处理别的。」我答应了。';f.p.text(text);f.settle(text);await f.p.idle();
 for(const s of f.sent)assert.equal((s.match(/「/g)||[]).length,(s.match(/」/g)||[]).length);
});
test('A07 Markdown appearance in a later chunk must not change bubble partition',async t=>{
 const text='第一句完成了。后面是代码：\n```js\nprint(1)\n```',all=[];
 for(const parts of [[text],['第一句完成了。后面是',text.slice('第一句完成了。后面是'.length)]]){const f=fixture(t);f.start();parts.forEach(s=>f.p.text(s));f.settle(text);await f.p.idle();all.push(f.sent);}assert.deepEqual(...all);
});
test('A08 safe steer suppresses obsolete unsent bubbles without canceling a tool',async t=>{
 const f=fixture(t);f.start();f.event('tool/call',{callId:'synthetic-write'});f.p.text('按照旧要求删除结果');f.settle('按照旧要求删除结果');assert.equal(f.p.revise({content:[]}), 'steered');await f.p.idle();assert.deepEqual(f.actions,['steer']);assert.deepEqual(f.sent,[]);
});
test('A09 canceled output cannot re-enter via external tool-result presentation',async t=>{
 const f=fixture(t);f.start();f.p.stopOutput();await f.p.external('已取消轮次的迟到工具结果');assert.deepEqual(f.sent,[]);
});
test('A10 a previous turn end cannot cancel a newly started turn',async t=>{
 const f=fixture(t);f.start();f.p.stopOutput();f.event('turn/start',{turn:2});f.event('turn/end',{turn:1,reason:{kind:'aborted'}});assert.equal(f.p.active,true);
});
test('A11 background/Schedule turn without interactive origin must not use retained QQ transport for hang-on',async t=>{
 const f=fixture(t);f.event('user/message',{source:{kind:'schedule'}});f.event('turn/start',{turn:2});f.p.hangOn();await f.p.idle();assert.deepEqual(f.sent,[]);
});
test('A12 SDK pending text must not be published on stop as a new DONE frame',async t=>{
 // Simulates SDK throttling: update may return before text has left its buffer.
 const f=fixture(t);let pending='';f.p.bind({key:f.key,sendText:async()=>{},openStream:()=>({async update(s){pending=s;},async complete(){f.sent.push(pending);},cancel(){pending='';}})});
 f.start();f.p.text('SDK尚未发送的尾巴');f.p.update(f.p.message);await f.p.idle();f.p.stopOutput();await f.p.idle();assert.deepEqual(f.sent,[]);
});
test('A13 transport drain is bounded even if a platform send never settles',async t=>{
 const f=fixture(t);let release;f.p.bind({key:f.key,sendText:()=>new Promise(r=>release=r)});f.start();f.settle('慢网络');await micro();
 const disposed=f.p.dispose();const outcome=await Promise.race([disposed.then(()=> 'closed'),new Promise(r=>setTimeout(()=>r('blocked'),60))]);release();await disposed;assert.equal(outcome,'closed');
});
test('A14 transient stream failure must not silently lose the final suffix',async t=>{
 const f=fixture(t);let current='',calls=0;f.p.bind({key:f.key,sendText:async s=>f.sent.push(s),openStream:()=>({async update(s){if(++calls===1)throw Object.assign(Error('definitively rejected before write'),{delivery:'rejected'});current=s;},async complete(){f.sent.push(current);}})});
 f.start();f.p.text('前缀');f.p.update(f.p.message);await f.p.idle();f.p.text('和最终尾巴');f.settle('前缀和最终尾巴');await f.p.idle();assert.equal(f.sent.join(''),'前缀和最终尾巴');
});
test('A15 rehydrated active Agent must not silently swallow durable settlement on plugin reload',async t=>{
 const handlers=new Map(),agent={session:{},status:'running'};let service,cleanup;
 apply({provide:(_,v)=>service=v,on:(n,h)=>handlers.set(n,h),systemPrompt:{context(){}},effect:f=>cleanup=f()});t.after(()=>cleanup());
 handlers.get('agent/assistant-stream')({agent,frame:{type:'start',attemptId:'resumed',revision:100,turn:4,step:0}});
 const p=service.get(agent),sent=[];p.bind({key:{},sendText:async s=>sent.push(s)});
 handlers.get('session/event')(agent.session,{type:'assistant/message',data:{turn:4,message:{content:[{type:'text',text:'重载后完整结果'}]}}});await p.idle();assert.deepEqual(sent,['重载后完整结果']);
});
test('A16 out-of-order native chunks must not silently drop text before a matching final',async t=>{
 const f=fixture(t);f.start();f.p.frame({type:'chunk',attemptId:'one',revision:3,chunk:{type:'text-delta',text:'乙'}});f.p.frame({type:'chunk',attemptId:'one',revision:2,chunk:{type:'text-delta',text:'甲'}});f.settle('甲乙');await f.p.idle();assert.deepEqual(f.sent,['甲乙']);
});
test('A17 slow sends retain FIFO and stop suppresses work that has not started',async t=>{
 const f=fixture(t);let release,entered=false;f.p.bind({key:f.key,sendText:async text=>{entered=true;await new Promise(r=>release=r);f.sent.push(text);}});
 f.start();f.settle('第一段完整文本。第二段完整文本。');await micro();assert(entered);f.p.stopOutput();release();await f.p.idle();assert.deepEqual(f.sent,['第一段完整文本。']);
});
test('A18 formatting control: code, links, lists and tables remain intact when complete',async t=>{
 for(const text of ['```js\nhello("内容。后文")\n```','[参考](https://example.invalid)。后文','- 第一项。后文','| 列一 | 列二 |\n|---|---|\n|内容。|后文|']){
  const f=fixture(t);f.start();f.settle(text);await f.p.idle();assert.deepEqual(f.sent,[text]);
 }
});
test('A19 slow platform coalesces superseded cumulative updates instead of replaying backlog',async t=>{
 const f=fixture(t);let release,updates=0;const gate=new Promise(r=>release=r);
 f.p.bind({key:f.key,sendText:async()=>{},openStream:()=>({async update(){if(++updates===1)await gate;},async complete(){}})});
 f.start();f.p.text('头');f.p.update(f.p.message);await micro();
 for(let i=0;i<100;i++){f.p.text('字');f.p.update(f.p.message);}f.settle('头'+'字'.repeat(100));release();await f.p.idle();assert(updates<=3,`replayed ${updates} cumulative updates`);
});

test('A20 ambiguous delivery is not blindly retried or completed',async t=>{
 const f=fixture(t);let updates=0,completed=0;f.p.bind({key:f.key,sendText:async s=>f.sent.push(s),openStream:()=>({async update(){updates++;throw Error('response lost after possible delivery');},async complete(){completed++;},cancel(){}})});
 f.start();f.p.text('前缀');f.p.update(f.p.message);await f.p.idle();f.settle('前缀和尾巴');await f.p.idle();assert.equal(updates,1);assert.equal(completed,0);assert.deepEqual(f.sent,[]);assert(f.p.errors.includes('stream-delivery-unknown'));
});

test('A21 steer ignores a late settlement from the superseded attempt until the next attempt starts',async t=>{
 const f=fixture(t);f.start();f.event('tool/call',{callId:'write'});f.p.revise({content:[]});f.settle('旧尝试迟到结果');await f.p.idle();assert.deepEqual(f.sent,[]);
 f.p.frame({type:'start',attemptId:'new',revision:10,turn:1});f.settle('新的结果');await f.p.idle();assert.deepEqual(f.sent,['新的结果']);assert.deepEqual(f.actions,['steer']);
});
