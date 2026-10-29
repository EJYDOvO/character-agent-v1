import test from 'node:test';import assert from 'node:assert/strict';
import {apply} from '../packages/character-memory-tools/worker-scope.mjs';
import {workerGlobalTools} from '../packages/character-memory-tools/worker-policy.mjs';

// Fake registry: global tools, a Worker Preset tool and a Root-only shadow.
function fixture(globals,config){
 const tools=new Map(globals.map(n=>[n,{name:n}])),restrictions=[],guards=[],listeners=[],effects=[];let changes=0;
 const presetTool={name:'preset_tool'},worker={id:'worker'};
 const visible=agent=>{const out=new Map(tools);if(agent===worker){out.set('preset_tool',presetTool);for(const r of restrictions)for(const n of r.deny)out.delete(n);}return out;};
 const ctx={
  tools:{schemas:()=>[...tools.values()].map(t=>({name:t.name})),get:(n,agent)=>agent?visible(agent).get(n):tools.get(n),
   restrict(filter){assert(filter.deny.every(n=>tools.has(n)),'unknown name');const r={deny:filter.deny};restrictions.push(r);changes++;return()=>{restrictions.splice(restrictions.indexOf(r),1);};},
   guard(g){guards.push(g);}},
  on(event,fn){assert.equal(event,'tools/change');listeners.push(fn);},effect(fn){effects.push(fn());}
 };
 apply(ctx,config);
 return {ctx,tools,restrictions,worker,changes:()=>changes,emit(){for(const l of listeners)l();},
  denied:name=>guards.map(g=>g({name,agent:worker})).find(Boolean),visible:name=>visible(worker).has(name),dispose(){for(const e of effects)e();}};
}

test('Worker scope masks every Host-global tool except the read-only search allowlist',()=>{
 const f=fixture(['advanced_search','weather','long_task_create','qqbot_send_file','mcp__browser__browser_run_code_unsafe','run_code']);
 assert(f.visible('advanced_search')&&f.visible('weather')&&f.visible('preset_tool'));
 for(const n of ['long_task_create','qqbot_send_file','mcp__browser__browser_run_code_unsafe'])assert(!f.visible(n),n);
 assert(!f.restrictions[0].deny.includes('run_code'));
 assert.equal(f.denied('advanced_search'),undefined);assert.equal(f.denied('preset_tool'),undefined);
});
test('A global tool registered later is masked on change and refused by the guard before that',()=>{
 const f=fixture(['advanced_search']);assert.equal(f.restrictions.length,0);
 f.tools.set('late_browser_tool',{name:'late_browser_tool'});
 assert.match(f.denied('late_browser_tool'),/Host-global tool late_browser_tool/);
 f.emit();assert(!f.visible('late_browser_tool'));assert.equal(f.restrictions.length,1);
 const before=f.changes();f.emit();assert.equal(f.changes(),before,'unchanged tool set must not re-restrict');
 f.tools.delete('late_browser_tool');f.emit();assert.equal(f.restrictions.length,0);
});
test('Explicit empty allowlist masks search too; disposal lifts only its own mask',()=>{
 const f=fixture(workerGlobalTools.slice(0,2),{allow:[]});
 for(const n of workerGlobalTools.slice(0,2))assert(!f.visible(n));
 f.dispose();assert.equal(f.restrictions.length,0);
 assert.throws(()=>fixture([],{allow:'advanced_search'}));
});
