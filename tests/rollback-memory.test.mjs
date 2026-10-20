import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {join,dirname} from 'node:path';import {writeFileSync,mkdirSync,readFileSync,mkdtempSync,cpSync,copyFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {fixture} from './audit/inspector-fixture.mjs';
import {LayeredMemory} from '../packages/character-memory-core/layered.mjs';
const verify=createRequire(import.meta.url)('../scripts/rollback-memory.cjs');
test('T14 same-schema rollback preserves new memories and validates only a copy',async()=>{
 const f=fixture('off');try{const row=f.memory.remember(f.c,{kind:'semantic',statement:'升级后新增的记录。'},f.source(1));const before=f.memory.get(f.c,row.id);
 const result=await verify({database:f.file,previousCore:fileURLToPath(new URL('../packages/character-memory-core/',import.meta.url)),output:join(dirname(f.file),'probe.sqlite')});
 assert.equal(result.memoryAction,'preserve-current');assert.equal(result.schema,3);assert.deepEqual(f.memory.get(f.c,row.id),before);
 }finally{f.memory.close();}
});
test('T14 incompatible old runtime fails before touching live data',async()=>{
 const f=fixture('off');try{f.memory.remember(f.c,{kind:'semantic',statement:'保留记录。'},f.source(1));const dir=join(dirname(f.file),'old');mkdirSync(dir);writeFileSync(join(dir,'layered.mjs'),"export class LayeredMemory {constructor(){throw Error('Unsupported future memory schema');}}\n");
 const before=readFileSync(f.file);await assert.rejects(()=>verify({database:f.file,previousCore:dir,output:join(dirname(f.file),'rejected.sqlite')}),/Unsupported/);assert.deepEqual(readFileSync(f.file),before);assert.equal(f.memory.browse(f.c).total,1);
 }finally{f.memory.close();}
});

test('T14 actual rollback CLI switches synthetic Profiles without replacing newer memory with its checkpoint',()=>{
 const f=fixture('off');const old=f.memory.remember(f.c,{kind:'semantic',statement:'回滚前已存在。'},f.source(1));f.memory.close();
 const root=mkdtempSync(join(tmpdir(),'rollback-cli-')),state=join(root,'data/maintenance/character-deploy'),previous=join(root,'data/maintenance/previous-profile'),checkpoint=join(root,'data/maintenance/character-checkpoints/fixture'),live=join(root,'data/profiles/desktop'),memory=join(root,'data/character/memory.sqlite');
 for(const dir of [state,previous,checkpoint,live,dirname(memory),join(root,'data/qqbot'),join(root,'maintenance'),join(checkpoint,'data/character')])mkdirSync(dir,{recursive:true});
 copyFileSync(f.file,memory);copyFileSync(f.file,join(checkpoint,'data/character/memory.sqlite'));
 const m=new LayeredMemory(memory,f.authorize),added=m.remember(f.c,{kind:'semantic',statement:'升级后的新增事实必须留在当前库。'},f.source(2));m.forget(f.c,old.id,1);m.close();
 writeFileSync(join(live,'package.json'),'{}');writeFileSync(join(previous,'package.json'),'{"name":"previous-profile"}');cpSync(fileURLToPath(new URL('../packages/character-memory-core/',import.meta.url)),join(previous,'node_modules/dsh-character-memory-core'),{recursive:true});
 for(const name of ['policy','prefs','binding'])writeFileSync(join(state,name+'-before.json'),JSON.stringify({restored:name}));
 writeFileSync(join(checkpoint,'manifest.json'),JSON.stringify({files:[{path:'data/character/memory.sqlite',sha256:createHash('sha256').update(readFileSync(join(checkpoint,'data/character/memory.sqlite'))).digest('hex').toUpperCase()}]}));
 writeFileSync(join(state,'candidate.json'),JSON.stringify({previousProfile:previous,checkpoint}));
 execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/rollback.cjs',import.meta.url))],{env:{...process.env,DSH_INSTALL_ROOT:root},stdio:'pipe'});
 const restored=new LayeredMemory(memory,f.authorize);try{assert.equal(restored.get(f.c,added.id).statement,added.statement);assert.equal(restored.get(f.c,old.id).statement,'');assert.equal(JSON.parse(readFileSync(join(live,'package.json'))).name,'previous-profile');assert.equal(JSON.parse(readFileSync(join(state,'candidate.json'))).memoryRollback.memoryAction,'preserve-current');}finally{restored.close();}
});
