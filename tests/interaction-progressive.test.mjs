import test from 'node:test';
import assert from 'node:assert/strict';
import {Interaction,options,progressiveCut,semanticParts} from '../packages/interaction-policy/policy.mjs';

function fixture(config={}){
 let time=0,id=0;const timers=new Map(),sent=[],bubbles=[],traces=[];
 const clock={now:()=>time,set(fn,ms){timers.set(++id,{fn,at:time+ms});return id;},clear:i=>timers.delete(i)};
 const agent={status:'running',cancel(){},followup(){},steer(){}};
 const p=new Interaction(agent,{hangOnMs:8000,throttleMs:10,...config},clock);
 const transport={key:agent,trace:(e,f)=>traces.push([e,f]),async sendText(text,meta){sent.push([text,meta]);},
  openStream(meta){const b={text:'',closed:false,meta};bubbles.push(b);return {async update(t){assert(!b.closed);b.text=t;},async complete(){b.closed=true;},cancel(){b.cancelled=true;}};}};
 p.bind(transport);
 let rev=0,attempt=0;const event=(type,data={})=>p.event({type,data});
 const start=()=>{event('turn/start');p.frame({type:'start',attemptId:++attempt,revision:++rev});};
 const retry=()=>p.frame({type:'start',attemptId:++attempt,revision:++rev});
 const chunk=text=>p.frame({type:'chunk',attemptId:attempt,revision:++rev,chunk:{type:'text-delta',text}});
 const message=text=>{event('assistant/message',{message:{content:[{type:'text',text}]}});p.frame({type:'end',attemptId:attempt,revision:++rev,outcome:{eventType:'assistant/message'}});};
 const advance=async ms=>{time+=ms;for(const [k,t]of [...timers])if(t.at<=time){timers.delete(k);t.fn();}await p.idle();};
 const stream=async(text,size=20)=>{for(let i=0;i<text.length;i+=size){chunk(text.slice(i,i+size));await advance(10);}};
 return {p,event,start,retry,chunk,message,advance,stream,sent,bubbles,traces};
}
const config=options({});
const body=(label,n=90)=>`${label}的说明正文。`.repeat(Math.ceil(n/8)).slice(0,n);
const sections=['开头先概括一下结论。',...[1,2,3,4].map(n=>`## ${n}. 第${n}部分\n${body('第'+n+'部分',260)}`)].join('\n\n');

test('a long reply commits finished bubbles while streaming, identical to the settlement split',async()=>{
 const f=fixture();f.start();await f.stream(sections);
 assert(f.bubbles.some(b=>b.closed),'at least one bubble is committed before settlement');
 const early=f.bubbles.filter(b=>b.closed).map(b=>b.text);
 f.message(sections);await f.p.idle();
 const result=f.bubbles.map(b=>b.text);
 assert.equal(result.join(''),sections);assert(result.length<=3);assert(f.bubbles.every(b=>b.closed));
 assert.deepEqual(result.slice(0,early.length),early,'committed bubbles are never rewritten');
 assert.deepEqual(result,semanticParts(sections,config,3),'streaming and one-shot settlement agree');
 for(const size of [1,7,sections.length]){const g=fixture();g.start();await g.stream(sections,size);g.message(sections);await g.p.idle();assert.deepEqual(g.bubbles.map(b=>b.text),result);}
});

test('short chat and replies inside the soft window are not committed early',async()=>{
 const f=fixture();f.start();const text=body('闲聊',200);await f.stream(text);assert(!f.bubbles.some(b=>b.closed));
 assert.equal(progressiveCut('嗯，今天还不错。'.repeat(20),config),0);
});

test('a bubble never ends on a lead-in or right after a heading and its short intro',()=>{
 const lead=`${body('背景',240)}\n\n具体步骤如下：\n\n${body('步骤',300)}\n\n${body('补充',200)}`;
 for(const part of semanticParts(lead,config,3).slice(0,-1))assert(!/(?:[：:]|如下)\s*$/u.test(part),JSON.stringify(part.slice(-12)));
 // The HTTP/3 shape seen on the phone: heading + one-line intro, then the list it introduces.
 const http3=`${body('开头',120)}\n\n1. 解决队头阻塞\n这是 HTTP/2 最大的痛点。\n\n- ${body('TCP',150)}\n- ${body('HTTP2',150)}\n\n2. 极速握手\n${body('握手',260)}`;
 const parts=semanticParts(http3,config,3);assert.equal(parts.join(''),http3);
 for(const part of parts.slice(0,-1))assert(!/最大的痛点。\s*$/u.test(part)&&!/解决队头阻塞\s*$/u.test(part),JSON.stringify(part.slice(-16)));
 assert(parts.slice(1).some(p=>/^2\. 极速握手/u.test(p)),'a new bubble may start at the next heading');
});

test('code blocks, tables and continuing lists are never split by a streaming commit',async()=>{
 const code=`${body('说明',350)}\n\n\`\`\`js\n${'console.log("不要拆开。");\n'.repeat(20)}\`\`\`\n\n${body('结尾',120)}`;
 const f=fixture();f.start();await f.stream(code);f.message(code);await f.p.idle();
 const result=f.bubbles.map(b=>b.text);assert.equal(result.join(''),code);
 for(const part of result)assert.equal((part.match(/```/g)??[]).length%2,0,'fence intact');
 const list=`${body('引言',360)}\n\n- ${body('一',60)}\n\n- ${body('二',60)}\n\n- ${body('三',60)}\n\n${body('结尾',200)}`;
 const at=progressiveCut(list,config);if(at){const prev=list.slice(0,at).trimEnd().split('\n').at(-1);assert(!(/^- /.test(prev)&&/^\s*- /.test(list.slice(at))));}
});

test('the open tail keeps one bubble of the budget; a hang-on does not consume it',async()=>{
 const f=fixture({maxBubbles:3});f.start();await f.advance(8000);await f.p.idle();assert.equal(f.p.bubbles,0);
 const long=[...[1,2,3,4,5].map(n=>`## ${n}. 部分\n${body('部分'+n,300)}`)].join('\n\n');
 await f.stream(long);assert(f.bubbles.filter(b=>b.closed).length<=2,'two committed bubbles leave one for the tail');
 f.message(long);await f.p.idle();assert.equal(f.bubbles.length,3);assert.equal(f.bubbles.map(b=>b.text).join(''),long);
});
test('the last bubble of the budget previews its whole tail while streaming',async()=>{
 const f=fixture({maxBubbles:1});f.start();const text='第一句。'.repeat(30)+'第二部分继续写。'.repeat(30);
 await f.stream(text);assert.equal(f.bubbles.length,1);assert.equal(f.bubbles[0].text,text,'nothing can be split later, so nothing is held back');
 f.message(text);await f.p.idle();assert.equal(f.bubbles.map(b=>b.text).join(''),text);
});

test('a retried attempt does not resend bubbles it already committed',async()=>{
 const f=fixture();f.start();await f.stream(sections);const committed=f.bubbles.filter(b=>b.closed).map(b=>b.text);assert(committed.length);
 f.retry();await f.stream(sections);f.message(sections);await f.p.idle();
 const all=f.bubbles.filter(b=>b.closed&&!b.cancelled).map(b=>b.text).join('');
 assert.equal(all,sections,'committed prefix is skipped, nothing is repeated');
 const g=fixture();g.start();await g.stream(sections);g.retry();const other='完全不同的新回答。'.repeat(10);await g.stream(other);g.message(other);await g.p.idle();
 assert(g.traces.some(([e])=>e==='retry-diverged'));
});

test('a settlement that rewrites committed text never resends it',async()=>{
 const f=fixture();f.start();await f.stream(sections);const committed=f.bubbles.filter(b=>b.closed).length;assert(committed);
 f.message('改写后的完整回答。'+sections);await f.p.idle();
 assert(f.traces.some(([e])=>e==='settlement-diverged'));assert(f.p.errors.includes('stream-settlement-mismatch'));
 assert(!f.bubbles.some(b=>b.text.startsWith('改写后的完整回答')));
});

test('cancellation after a commit drops the queued remainder',async()=>{
 const f=fixture();f.start();await f.stream(sections);const before=f.bubbles.filter(b=>b.closed).length;assert(before);
 f.p.stopOutput();f.message(sections);await f.p.idle();
 assert.equal(f.bubbles.filter(b=>b.closed&&!b.cancelled).length,before);
});
