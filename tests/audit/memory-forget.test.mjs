import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LayeredMemory} from '../../packages/character-memory-core/layered.mjs';
test('M01 forgotten text is absent from every public inspect/trace response, including source.quote',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'interaction-memory-audit-')),c={sessionId:'synthetic'},scope={principalId:'fixture-owner',namespaceId:'fixture',projectId:'fixture',agentId:'fixture',memoryMode:'off'};
 const db=new LayeredMemory(path.join(dir,'memory.sqlite'),(handle)=>{assert.equal(handle,c);return scope;});t.after(()=>db.close());
 const quote='虚构测试资料：我喜欢海边的蓝色灯塔。';const r=db.remember(c,{kind:'semantic',statement:quote},{sessionId:c.sessionId,eventSeq:1,messageId:'synthetic-1',origin:'direct_user',quote});
 db.forget(c,r.id,r.revision);assert.equal(db.recall(c,'灯塔').length,0);assert.equal(db.projection(c).body,'');
 for(const result of [db.get(c,r.id),db.inspect(c,r.id),db.trace(c,r.id)])assert(!JSON.stringify(result).includes(quote),'public read still exposes forgotten source text');
});
