import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../packages/memory-inspector/client.js',import.meta.url),'utf8');
function fixture(react={}){let exported,registration,styles=0;const cleanups=[],calls=[];
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load({id,factory}){assert.equal(id,'dsh-memory-inspector');exported=factory(name=>{assert(['react','@deepseek-ai/dsh-client-ui-primitives'].includes(name));return name==='react'?{createElement:(tag,props,...children)=>({tag,props,children}),...react}:{Button:'Button',Input:'Input',SegmentedTabs:'SegmentedTabs',Tag:'Tag'};});}}},document:{createElement(){return {remove(){styles--;}};},head:{append(){styles++;}}},AbortController,setTimeout,clearTimeout});
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
 const current=render({layer:'l3',context:'ctx',items:[{id:'test',revision:2,statement:'有效核心记忆',refs:[{id:'test',revision:2}]}],total:1});assert(JSON.stringify(current).includes('有效核心记忆'));assert(JSON.stringify(current).includes('追溯来源'));
});

function mounted(){
 const values=[],effects=[],refs=[];let stateIndex,refIndex,effectIndex,tree;const scheduled=[];
 const f=fixture({useState(initial){const i=stateIndex++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},useRef(initial){const i=refIndex++;return refs[i]??=( {current:initial});},useEffect(fn,deps){const i=effectIndex++,old=effects[i];if(!old||deps.some((x,n)=>x!==old.deps[n]))scheduled.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});}});
 f.exported.apply(f.ctx);const pending=[];f.ctx.connection.rpc.call=(_c,_m,payload,signal)=>new Promise((resolve,reject)=>pending.push({payload,signal,resolve:value=>resolve({ok:true,value}),reject}));
 const api=f.registration.meta.inject().api;
 const render=()=>{stateIndex=refIndex=effectIndex=0;tree=f.registration.component({api});scheduled.splice(0).forEach(f=>f());return tree;};
 const walk=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...walk(node.children)];const nodes=()=>walk(tree);
 const find=(tag,text)=>nodes().find(n=>n.tag===tag&&JSON.stringify(n.children).includes(text));
 const unmount=()=>{effects.forEach(e=>e.cleanup?.());f.cleanups.reverse().forEach(fn=>fn?.());};
 return {f,values,pending,render,find,nodes,unmount,get tree(){return tree;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function ready(m){m.render();m.pending.shift().resolve({writable:true,contexts:[{id:'one',agent:'a',scope:['p','n','x'],mode:'off'},{id:'two',agent:'b',scope:['p','n','x'],mode:'off'}]});await tick();m.render();}

test('T07 delayed old context requests cannot overwrite the new page and unmount aborts outstanding requests',async()=>{
 const m=mounted();try{await ready(m);const old=m.pending.splice(0);m.nodes().find(n=>n.props?.['aria-label']==='Agent 与记忆作用域').props.onChange({target:{value:'two'}});m.render();const fresh=m.pending.splice(0);
 fresh.find(r=>r.payload.operation==='browse').resolve({items:[{id:'b',statement:'new context'}],total:1});fresh.find(r=>r.payload.operation==='stats').resolve({l1:[],l2:1,l3:0,jobs:0,storage:{}});await tick();m.render();
 old.find(r=>r.payload.operation==='browse').resolve({items:[{id:'a',statement:'stale context'}],total:1});old.find(r=>r.payload.operation==='stats').resolve({l1:[],l2:999,l3:0,jobs:0,storage:{}});await tick();m.render();assert(JSON.stringify(m.tree).includes('new context'));assert(!JSON.stringify(m.tree).includes('stale context'));
 m.find('Button','查看详情').props.onClick();const detail=m.pending.pop();m.unmount();assert(detail.signal.aborted);detail.reject(Error('aborted'));await tick();
 }finally{m.unmount();}
});

test('T06 layer switching clears incompatible filters and dates use browser timezone',async()=>{
 const m=mounted();try{await ready(m);m.values[4]={query:'保留搜索',kind:'semantic',status:'active',from:'2026-10-20',to:'2026-10-20',agent:''};m.render();m.nodes().find(n=>n.tag==='form').props.onSubmit({preventDefault(){}});m.render();
 const request=m.pending.filter(r=>r.payload.operation==='browse').at(-1).payload.filter;
 assert.equal(Date.parse(request.from),new Date(2026,9,20).getTime());assert.equal(Date.parse(request.to),new Date(2026,9,21).getTime()-1);
 m.nodes().find(n=>n.tag==='SegmentedTabs').props.onChange('jobs');m.render();const next=m.pending.filter(r=>r.payload.operation==='browse').at(-1).payload.filter;assert.equal(next.kind,'');assert.equal(next.status,'');assert.equal(next.query,'保留搜索');
 const types=m.nodes().find(n=>n.props?.['aria-label']==='类型');assert(JSON.stringify(types).includes('extraction'));assert(!JSON.stringify(types).includes('semantic'));
 }finally{for(const r of m.pending)r.resolve(r.payload.operation==='browse'?{items:[],total:0}:{l1:[],storage:{}});m.unmount();await tick();}
});

test('T07 mutations require confirmation and same-tick duplicate submissions send once',async()=>{
 const m=mounted();try{await ready(m);for(const r of m.pending.splice(0))r.resolve(r.payload.operation==='browse'?{items:[{id:'a',statement:'record'}],total:1}:{l1:[],storage:{}});await tick();m.render();m.find('Button','查看详情').props.onClick();m.pending.pop().resolve({memory:{id:'a',statement:'record',revision:1},evidence:[],revisions:[],valid:true});await tick();m.render();
 m.find('Button','遗忘记忆').props.onClick();assert.equal(m.pending.length,0);m.render();const click=m.find('Button','确认执行').props.onClick;const a=click(),b=click();assert.equal(m.pending.length,1);assert.equal(m.pending[0].payload.operation,'forget');m.pending.pop().resolve({});await Promise.all([a,b]);
 }finally{m.unmount();}
});
