import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {apply} from '../../packages/character-identity/index.mjs';
import {managerFixture} from '../qq-manager-fixture.mjs';
import {successSampler} from '../../packages/character-identity/diagnostics.mjs';
test('authorization observation window is bounded, resets and tolerates a clock rollback',()=>{
 let now=0;const sampler=successSampler({now:()=>now,intervalMs:60,capacity:2});
 assert(sampler.take('a'));assert(!sampler.take('a'));assert(sampler.take('b'));assert(sampler.take('c'));assert(sampler.take('a'),'oldest observation evicted');
 now=59;assert(!sampler.take('a'));now=60;assert(sampler.take('a'));now=1;assert(sampler.take('a'),'clock rollback cannot suppress indefinitely');
 sampler.clear();assert(sampler.take('a'));
});
test('successful hot-path authorization is sampled; every rejection remains observable',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'identity-diagnostics-')),bindingFile=path.join(dir,'binding.json');fs.writeFileSync(bindingFile,JSON.stringify({appId:'fixture-app',ownerId:'fixture-owner'}));
 let service,dispose;apply({provide:(name,s)=>{if(name==='characterIdentity')service=s;},effect:f=>dispose=f()},{bindingFile,stateFile:path.join(dir,'state.sqlite')});t.after(async()=>{await dispose();fs.rmSync(dir,{recursive:true,force:true});});
 const record={sessionId:'fixture-session',scope:'c2c',peerId:'fixture-owner',senderId:'fixture-owner',agentPreset:'qq-character',agent:{session:{seq:1}}},manager=managerFixture();manager.commit(record);
 const rows=[],runtime={manager,config:{appId:'fixture-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['fixture-owner'],groupMode:'disabled'}},diagnostics:{emit:(c,e,f)=>rows.push({c,e,...f})}};
 const detach=service.attach(runtime),handle=service.forSession(record.sessionId);
 for(let i=0;i<10000;i++)service.authorize(handle,'read');
 assert.equal(rows.filter(r=>r.e==='authorize'&&r.status==='accepted').length,1);
 for(let i=0;i<100;i++)assert.throws(()=>service.authorize({...handle},'read'));
 assert.equal(rows.filter(r=>r.e==='authorize'&&r.status==='rejected').length,100);
 detach();service.attach({...runtime});service.forSession(record.sessionId);
 assert.equal(rows.filter(r=>r.e==='authorize'&&r.status==='accepted').length,2,'reattachment has a fresh observation window');
});
test('I01 detach/reattach revokes old ingress and capability; the new trusted hook captures exactly once without SDK middleware',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'identity-audit-')),bindingFile=path.join(dir,'binding.json');fs.writeFileSync(bindingFile,JSON.stringify({appId:'fixture-app',ownerId:'fixture-owner'}));
 let service,dispose;apply({provide:(name,s)=>{if(name==='characterIdentity')service=s;},effect:f=>dispose=f()},{bindingFile,stateFile:path.join(dir,'state.sqlite')});t.after(()=>dispose());
 const middlewares=[],record={sessionId:'fixture-session',scope:'c2c',peerId:'fixture-owner',senderId:'fixture-owner',agentPreset:'qq-character',agent:{session:{seq:1}}};
 const manager=managerFixture(),config={appId:'fixture-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['fixture-owner'],groupMode:'disabled'}};manager.commit(record);
 const bot={use:fn=>middlewares.push(fn)},runtime={manager,bot,config,sender:{sendMarkdown:async()=>{}}};
 const evidence=[];service.onIngress((_handle,event)=>evidence.push(event));
 const detach=service.attach(runtime),old=manager.admitInput,trusted=service.forSession(record.sessionId);detach();service.attach({...runtime});
 const input={platform:'qq-official',adapter:'qq-official-gateway',accountId:'fixture-app',conversation:{type:'direct',id:'fixture-owner'},sender:{id:'fixture-owner'},message:{id:'fixture-message',text:'合成测试消息'}};
 assert.throws(()=>old(record,input),/detached/);assert.throws(()=>service.authorize(trusted,'read'));
 manager.admitInput(record,input);assert.equal(evidence.length,1);assert.equal(evidence[0].text,'合成测试消息');assert.equal(evidence[0].origin,'direct_user');assert.equal(middlewares.length,0);
});
