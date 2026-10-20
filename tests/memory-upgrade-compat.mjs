// Opt-in integration with an exported, exact previous source revision.
import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {join} from 'node:path';import {createRequire} from 'node:module';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
const input=JSON.parse(fs.readFileSync('test-data/upgrade-gate-path.json')),file=join(input.oldCore,'compatibility.sqlite');assert(!fs.existsSync(file),'Use a fresh exported old runtime');
const {LayeredMemory:Old}=await import(pathToFileURL(join(input.oldCore,'layered.mjs')).href);
const c={sessionId:'upgrade-fixture'},authorize=h=>{assert.equal(h,c);return {principalId:'fixture',namespaceId:'fixture',projectId:'fixture',agentId:'fixture',memoryMode:'off'};};
const evidence=n=>({sessionId:c.sessionId,eventSeq:n,messageId:'fixture-'+n,origin:'direct_user',quote:'合成升级证据 '+n});
let m=new Old(file,authorize);const old=m.remember(c,{kind:'semantic',statement:'升级前有效记录。'},evidence(1));m.close();
m=new LayeredMemory(file,authorize);assert.equal(m.get(c,old.id).statement,old.statement);const added=m.remember(c,{kind:'semantic',statement:'升级后新建记录。'},evidence(2));m.forget(c,old.id,old.revision);m.close();
const validation=await createRequire(import.meta.url)('../scripts/rollback-memory.cjs')({database:file,previousCore:input.oldCore,output:join(input.oldCore,'rollback-check.sqlite')});
m=new Old(file,authorize);assert.equal(m.get(c,added.id).statement,added.statement);assert.equal(m.get(c,old.id).statement,'');assert(!m.recall(c,'升级前').some(r=>r.id===old.id));m.close();
const report={ok:true,previousSha:input.sha,schema:validation.schema,checks:['Exact test.11 code creates synthetic data','Current candidate retains records and adds new records','Old runtime reads new records after rollback; forgotten original stays hidden'],limitations:['Memory runtime compatibility only; not a full Profile/dependency lockfile installation']};fs.writeFileSync('test-data/memory-upgrade-compat.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
