import test from 'node:test';import assert from 'node:assert/strict';
import {auditBindings} from '../packages/character-identity/bindings.mjs';
import {protectSession} from '../packages/character-identity/boundary.mjs';
const h=(id,parentSession,agentPreset='qq-character')=>({id,parentSession,agentPreset});
test('read-only audit recovers pre-upgrade model-fork ancestors, never same-preset strangers or descendants',async()=>{
 const headers=new Map([['main',h('main','model-old')],['model-old',h('model-old','original')],['original',h('original')],['stranger',h('stranger')],['child',h('child','main')]]);
 const schedules=['original','stranger','child'].map(sessionId=>({id:'task-'+sessionId,sessionId,status:'active',prompt:'Never report private text'})),before=structuredClone(schedules);
 const result=await auditBindings({schedules,bindings:['main'],roots:['main'],readHeader:async id=>headers.get(id),presetId:'qq-character'});
 assert.deepEqual(result.missing.sort(),['model-old','original']);assert.equal(result.rows[0].binding,'verified_missing');assert(result.rows.slice(1).every(r=>r.binding==='unproven'));assert(!JSON.stringify(result).includes('private text'));assert.deepEqual(schedules,before);assert.deepEqual([...headers.keys()],['main','model-old','original','stranger','child']);
});
test('audit refuses broken headers, foreign presets, delegated roots, cycles and unreadable lineage',async()=>{
 for(const bad of [undefined,h('wrong'),h('parent',undefined,'cordis'),{...h('parent'),delegationDepth:1}]){
  const result=await auditBindings({schedules:[{id:'x',sessionId:'parent'}],bindings:['main'],roots:[],readHeader:async id=>id==='main'?h('main','parent'):bad,presetId:'qq-character'});
  assert(!result.verified.includes('parent'));assert.equal(result.rows[0].binding,'unproven');assert(result.issues.length);
 }
 const result=await auditBindings({schedules:[],bindings:['main','unreadable'],roots:[],readHeader:async id=>{if(id==='unreadable')throw Error('IO private details');return h(id,id);},presetId:'qq-character'});
 assert.deepEqual(result.issues.map(r=>r.code).sort(),['header_unreadable','lineage_cycle_or_limit']);assert(!JSON.stringify(result).includes('private details'));
});
test('retained Agent fences use the replaced Host provider without stacking; unproven live receipts never enter the inbox',async()=>{
 let provider,inserted=0;const guards=[],gates=new Map(),agent={followup(){inserted++;},ctx:{get:n=>n==='tools'?{guard:f=>guards.push(f)}:provider,on:(n,f)=>gates.set(n,f)}};
 protectSession(agent);provider={isCurrentAgent:()=>true,canDeliverReminder:()=>true};assert.equal(guards[0]({agent}),undefined);
 provider=undefined;assert(guards[0]({agent}));assert.throws(()=>agent.followup({source:{kind:'schedule'}}));assert.equal(inserted,0);
 provider={isCurrentAgent:()=>false,canDeliverReminder:()=>false};protectSession(agent);assert.equal(guards.length,1);assert.throws(()=>agent.followup({source:{kind:'schedule'}}));assert.equal(inserted,0);
 assert.deepEqual(await gates.get('agent/pre-step')({agent},()=>assert.fail()),{kind:'reject'});
 provider={isCurrentAgent:()=>false,canDeliverReminder:()=>true};agent.followup({source:{kind:'schedule'}});assert.equal(inserted,1);assert(guards[0]({agent}),'Reminder ownership must never grant tool authority');
});
