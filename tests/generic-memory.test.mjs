import test from 'node:test';import assert from 'node:assert/strict';
import {MemoryStore} from '../packages/character-memory-core/store.mjs';
import {requireMemoryIdentity} from '../packages/character-memory-core/identity-contract.mjs';
import {confirmationEvidence} from '../packages/character-identity/confirmation.mjs';
import {apply} from '../examples/local-agent/identity.mjs';
function fixture(project='project-a'){
 const services=new Map(),cleanup=[];const agent={session:{header:{id:'session-'+project}},ctx:{}};
 const ctx={agents:{get:id=>id===agent.session.header.id?agent:undefined},agentPresets:{composedPreset:()=> 'ordinary'},provide:(k,v)=>services.set(k,v),effect:f=>cleanup.push(f())};
 apply(ctx,{principalId:'local-user',namespaceId:'ordinary-assistant',projectId:project,allowedPresetId:'ordinary'});
 const provider=services.get('memoryIdentity');const store=new MemoryStore(':memory:',(c,a)=>provider.authorize(c,a));
 return{provider,store,agent,services,handle:provider.forSession(agent.session.header.id),close(){store.close();cleanup.forEach(f=>f());}};
}
test('generic provider grants no Character identity and rejects forged handles',()=>{const f=fixture();try{assert.equal(requireMemoryIdentity(f.provider),f.provider);assert.equal(f.services.has('characterIdentity'),false);const r=f.store.remember(f.handle,{kind:'semantic',statement:'普通项目偏好中文'},{sessionId:f.handle.sessionId,eventSeq:1,origin:'inference'});assert.equal(r.project,'project-a');assert.equal(r.character,'ordinary-assistant');assert.throws(()=>f.store.recall({...f.handle}));}finally{f.close();}});
test('independent provider projects and databases do not share memory or capabilities',()=>{const a=fixture('a'),b=fixture('b');try{a.store.remember(a.handle,{kind:'semantic',statement:'仅属于项目甲'},{sessionId:a.handle.sessionId,eventSeq:1,origin:'inference'});assert.equal(b.store.recall(b.handle).length,0);assert.throws(()=>b.store.recall(a.handle));}finally{a.close();b.close();}});
test('generic trusted ingress accepts real Host agent reference and is revocable',()=>{const f=fixture();let events=0;const off=f.provider.onEvidence((h,e)=>{events++;f.store.enqueue(h,e);});try{f.services.get('localMemoryIngress').admit(f.agent,{messageId:'local-1',text:'我习惯先复现问题',eventSeq:2});assert.equal(events,1);assert.equal(f.store.jobs(f.handle).length,1);assert.throws(()=>f.services.get('localMemoryIngress').admit({...f.agent},{messageId:'forged',text:'假消息',eventSeq:3}));off();}finally{f.close();}assert.throws(()=>f.provider.authorize(f.handle,'read'));});
test('provider contract cannot fall back to Character or accept incomplete implementation',()=>{assert.throws(()=>requireMemoryIdentity({}));assert.throws(()=>requireMemoryIdentity({contractVersion:1,authorize(){}}));});
test('QQ-specific confirmation requires whole affirmative message, not selected substring',()=>{const input={sessionId:'s',eventSeq:1,messageId:'m',origin:'direct_user',receivedAt:Date.now(),text:'不要确认用户喜欢咖啡，这句话是假的。'};const memory={id:'test-id',statement:'用户喜欢咖啡'};assert.throws(()=>confirmationEvidence(input,memory,'确认用户喜欢咖啡'));const positive={...input,text:'确认：用户喜欢咖啡'};assert.equal(confirmationEvidence(positive,memory,positive.text).messageId,'m');assert.throws(()=>confirmationEvidence({...positive,receivedAt:0},memory,positive.text));});
