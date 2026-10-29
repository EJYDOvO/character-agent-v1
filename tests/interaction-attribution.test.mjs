import test from 'node:test';
import assert from 'node:assert/strict';
import {Interaction} from '../packages/interaction-policy/policy.mjs';

// QQ-shaped fixture: native events in DSH order (turn/start before user/message),
// trusted ingress registration and a transport that can hold its queue open.
function fixture({requireIngress=true,hold=false,failStream=false}={}){
 let time=0,id=0,open;const timers=new Map(),sent=[],bubbles=[],traces=[];
 const clock={now:()=>time,set(fn,ms){timers.set(++id,{fn,at:time+ms});return id;},clear:i=>timers.delete(i)};
 const agent={status:'running',cancel(){},followup(){},steer(){}};
 const gate=hold?new Promise(r=>{open=r;}):Promise.resolve();
 const p=new Interaction(agent,{hangOnMs:8000,throttleMs:10},clock);
 const transport={key:agent,requireIngress,deliveryReceipts:true,trace:(e,f)=>traces.push([e,f]),
  async sendText(text,meta){await gate;sent.push([text,meta]);meta?.onDelivered?.();},
  openStream(meta){const b={text:'',meta,closed:false};bubbles.push(b);return {async update(t){await gate;if(failStream)throw Object.assign(Error('timeout'),{delivery:'unknown'});b.text=t;meta.onDelivered?.();},async complete(){b.closed=true;},cancel(){b.cancelled=true;}};}};
 p.bind(transport);
 let seq=0,rev=0,attempt=0,turn=0;
 const event=(type,data={})=>p.event({type,seq:++seq,data:{turn,...data}});
 const user=(input,source={kind:'user'})=>{const message={id:input,source};if(source.kind==='user')p.admitInput(message);event('user/message',{message});};
 // DSH appends claimed input before the model attempt of its step starts.
 const begin=input=>{turn++;event('turn/start');if(input)user(input);p.frame({type:'start',turn,attemptId:++attempt,revision:++rev});};
 const step=()=>p.frame({type:'start',turn,attemptId:++attempt,revision:++rev});
 const reply=text=>{event('assistant/message',{message:{content:[{type:'text',text}]}});p.frame({type:'end',turn,attemptId:attempt,revision:++rev,outcome:{eventType:'assistant/message'}});};
 const end=()=>event('turn/end',{reason:{kind:'completed'}});
 const advance=async ms=>{time+=ms;for(const [k,t]of [...timers])if(t.at<=time){timers.delete(k);t.fn();}await p.idle();};
 const out=()=>[...bubbles.map(b=>[b.text,b.meta]),...sent];
 return {p,agent,event,user,begin,step,reply,end,advance,sent,bubbles,traces,out,release:()=>open?.()};
}
const para=s=>(s+'。').repeat(80);
const long=s=>[para(s+'一'),para(s+'二'),para(s+'三')].join('\n\n');
const settled=child=>({kind:'subagent-settled',form:'notice',senderSessionId:child});

test('a Worker started by an admitted input delivers its settlement to that input, even after the ingress window',async()=>{
 const f=fixture();f.begin('q-research');f.event('subagent/catalog',{childId:'child-1'});f.reply('我让 Worker 去查，查完告诉你。');f.end();await f.p.idle();
 const before=f.out().length;await f.advance(10*60*1000);
 assert.equal(f.p.admitsSource({source:settled('child-1')}),true);
 f.begin();f.user('notice-1',settled('child-1'));f.reply('最终研究结果。');f.end();await f.p.idle();
 assert.equal(f.p.background,false);
 const delivered=f.out().slice(before);assert.deepEqual(delivered.map(([t])=>t),['最终研究结果。']);
 assert.equal(delivered[0][1].input,'q-research');assert.equal(delivered[0][1].kind,'assistant');
});

test('unknown, forged and background children, Schedule and Web stay suppressed',async()=>{
 const f=fixture();f.begin('q1');f.event('subagent/catalog',{childId:'child-1'});f.reply('好。');f.end();await f.p.idle();
 // A child catalogued while the turn is background never becomes a trusted continuation.
 f.begin();f.user('sched',{kind:'schedule'});f.event('subagent/catalog',{childId:'child-bg'});f.reply('后台。');f.end();await f.p.idle();
 const before=f.out().length;
 for(const source of [settled('forged'),settled('child-bg'),{kind:'subagent-settled'},{kind:'schedule'},{kind:'web'}]){
  assert.equal(f.p.admitsSource({source}),false);
  f.begin();f.user('x',source);f.reply('不应发送。');f.end();await f.p.idle();assert.equal(f.p.background,true);
 }
 assert.equal(f.out().length,before);
 for(const requireIngress of [false]){const g=fixture({requireIngress});g.begin();g.user('n',settled('nobody'));g.reply('不应发送。');g.end();await g.p.idle();assert.equal(g.out().length,0);}
});

test('a settlement steered into a running turn opens its own reply with a fresh budget and numbering',async()=>{
 const f=fixture();f.begin('q-research');f.event('subagent/catalog',{childId:'child-1'});f.reply('稍后给你结果。');f.end();await f.p.idle();
 f.begin('q-chat');f.reply(long('聊天'));await f.p.idle();
 const chat=f.out().filter(([,m])=>m.input==='q-chat');assert.equal(chat.length,3);
 f.user('notice',settled('child-1'));f.step();f.reply(long('结果'));f.end();await f.p.idle();
 const result=f.out().filter(([,m])=>m.input==='q-research'&&m.reply!==1);
 assert.equal(result.length,3,'the second reply in the same turn is not squeezed into one bubble');
 assert.deepEqual(result.map(([,m])=>m.bubble),[1,2,3]);
 assert.notEqual(result[0][1].reply,chat[0][1].reply);assert.equal(result.map(([t])=>t).join(''),long('结果'));
});

test('a late tail keeps its own input, reply and bubble numbers after the next turn begins',async()=>{
 const f=fixture({hold:true});f.begin('q-old');f.reply(long('旧'));f.end();
 f.begin('q-new');f.release();await f.p.idle();f.reply('新回答。');f.end();await f.p.idle();
 const labels=f.out().map(([,m])=>`${m.input}:${m.reply}:${m.bubble}`);
 assert.deepEqual(labels.filter(l=>l.startsWith('q-old')),['q-old:1:1','q-old:1:2','q-old:1:3']);
 assert.deepEqual(labels.filter(l=>l.startsWith('q-new')),['q-new:2:1']);
 assert.equal(new Set(labels).size,labels.length);
});

test('an admitted input steered mid-turn starts a new reply; the first input of a turn does not',async()=>{
 const f=fixture();f.begin('q1');assert.equal(f.p.reply,1);f.reply('第一个回答。');
 f.user('q2');f.step();assert.equal(f.p.reply,2);f.reply('第二个回答。');f.end();await f.p.idle();
 assert.deepEqual(f.out().map(([t,m])=>[t,m.input,m.reply,m.bubble]),[['第一个回答。','q1',1,1],['第二个回答。','q2',2,1]]);
});

test('unknown stream delivery is withheld without blind retry and is traced',async()=>{
 const f=fixture({failStream:true});f.begin('q1');f.reply('一段正文。');f.end();await f.p.idle();
 assert.equal(f.sent.length,0,'no static resend after an unknown stream outcome');
 const row=f.traces.find(([e])=>e==='stream-withheld');assert(row);assert.equal(row[1].reply,1);assert.equal(row[1].bubble,1);
 assert(f.p.errors.includes('stream-delivery-unknown'));
});

test('a step whose attempt opened before its steered input is attributed to that input',async()=>{
 const f=fixture();f.begin('q1');f.reply('第一个回答。');f.step();f.user('q2');f.reply('第二个回答。');f.end();await f.p.idle();
 assert.deepEqual(f.out().map(([,m])=>[m.input,m.reply]),[['q1',1],['q2',2]]);
});

test('hang-on status carries its input and whether it was drafted',async()=>{
 const f=fixture();f.begin('q1');await f.advance(8000);
 const status=f.sent.find(([,m])=>m.kind==='status');assert(status);assert.equal(status[1].input,'q1');assert.equal(status[1].dynamic,false);
 await f.p.dispose();
});
