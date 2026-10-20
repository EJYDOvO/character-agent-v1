import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../packages/memory-inspector/client.js',import.meta.url),'utf8');
function fixture(react={}){let exported,registration,styles=0;const cleanups=[],calls=[];
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load({id,factory}){assert.equal(id,'dsh-memory-inspector');exported=factory(name=>{assert(['react','@deepseek-ai/dsh-client-ui-primitives'].includes(name));return name==='react'?{createElement:(tag,props,...children)=>({tag,props,children}),...react}:{};});}}},document:{createElement(){return {remove(){styles--;}};},head:{append(){styles++;}}},AbortController,setTimeout,clearTimeout});
 const ctx={effect(f){cleanups.push(f());},connection:{rpc:{async call(...args){calls.push(args);return {ok:true,value:{contexts:[]}};}}},slots:{inject(name,f){assert.equal(name,'settings.section');cleanups.push(f());},register(meta,component){registration={meta,component};return()=>{registration=undefined;};}}};
 return {exported,ctx,calls,cleanups,get registration(){return registration;},get styles(){return styles;}};
}
test('Native Inspector registers one settings section, reuses Connection RPC, disposes and respects disable',async()=>{
 const f=fixture();f.exported.apply(f.ctx);assert.equal(f.styles,1);assert.equal(f.registration.meta.id,'memory-inspector');assert.equal(f.registration.meta.label(),'记忆管理');
 const api=f.registration.meta.inject().api;await api('browse',{context:'host-issued-session',filter:{layer:'l1'}});assert.equal(f.calls[0][0],'/memory-inspector');assert.equal(f.calls[0][1],'api');assert.equal(f.calls[0][2].context,'host-issued-session');
 f.cleanups.reverse().forEach(fn=>fn?.());assert.equal(f.styles,0);assert.equal(f.registration,undefined);await assert.rejects(()=>api('contexts'),/关闭/);
 const disabled=fixture();disabled.exported.apply(disabled.ctx,{enabled:false});assert.equal(disabled.styles,0);assert.equal(disabled.registration,undefined);
});
test('Native client aborts requests on HMR disposal and returns a safe CAS message',async()=>{
 const f=fixture();f.exported.apply(f.ctx);const api=f.registration.meta.inject().api;
 f.ctx.connection.rpc.call=async()=>({ok:false,error:{code:'memory/409',message:'private error'}});await assert.rejects(()=>api('confirm'),/刷新后重试/);
 let signal;f.ctx.connection.rpc.call=(_c,_e,_p,s)=>new Promise((resolve,reject)=>{signal=s;s.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
 const pending=api('contexts');const rejected=assert.rejects(()=>pending,/aborted/);f.cleanups.reverse().forEach(fn=>fn?.());await rejected;assert(signal.aborted);
});

test('Layer switches never render previous L2 records as L3 during asynchronous loading',()=>{
 const render=(rows)=>{let i=0;const states=[[{id:'ctx',agent:'test',mode:'off',scope:['owner','namespace','project']}],'ctx',false,'l3',{query:''},0,rows,null,null,'',null,false,'','',0,{}];
  const f=fixture({useState:initial=>[states[i++]??initial,()=>{}],useEffect(){},useRef:value=>({current:value})});f.exported.apply(f.ctx);return f.registration.component({api:async()=>{}});
 };
 const stale=render({layer:'l2',context:'ctx',items:[{statement:'old layer content',revision:1}],total:1});assert(!JSON.stringify(stale).includes('old layer content'));
 const current=render({layer:'l3',context:'ctx',items:[{body:JSON.stringify({id:'test',revision:2,text:'有效核心记忆'}),refs:[{id:'test',revision:2}],tokens:20,budget:1200}],total:1});assert(JSON.stringify(current).includes('有效核心记忆'));assert(JSON.stringify(current).includes('追溯来源'));
});
