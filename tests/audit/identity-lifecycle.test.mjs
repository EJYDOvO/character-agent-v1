import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {apply} from '../../packages/character-identity/index.mjs';
test('I01 detach and reattach to a retained Gateway does not leave a middleware rejecting every input',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'identity-audit-')),bindingFile=path.join(dir,'binding.json');fs.writeFileSync(bindingFile,JSON.stringify({appId:'fixture-app',ownerId:'fixture-owner'}));
 let service,dispose;apply({provide:(name,s)=>{if(name==='characterIdentity')service=s;},effect:f=>dispose=f()},{bindingFile,stateFile:path.join(dir,'state.sqlite')});t.after(()=>dispose());
 const middlewares=[],record={sessionId:'fixture-session',scope:'c2c',peerId:'fixture-owner',senderId:'fixture-owner',agentPreset:'qq-character',agent:{session:{seq:1}}};
 const manager={sessions:new Map(),getOrCreate:async()=>record},config={appId:'fixture-app',preset:'qq-character',access:{c2cMode:'allowlist',c2cAllow:['fixture-owner'],groupMode:'disabled'}};
 const bot={use:fn=>middlewares.push(fn)},runtime={manager,bot,config,sender:{sendMarkdown:async()=>{}}};
 service.attach(runtime)();service.attach({...runtime});
 let called=false,i=0;const next=()=>i<middlewares.length?middlewares[i++]({message:{kind:'c2c',senderId:'fixture-owner',messageId:'fixture-message',content:'合成测试消息'}},next):(called=true);
 await assert.doesNotReject(async()=>next());assert.equal(called,true);
});
