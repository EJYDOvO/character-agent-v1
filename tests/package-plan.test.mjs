import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createRequire} from 'node:module';
const {folders,inventory,verifiedPlan}=createRequire(import.meta.url)('../scripts/package-plan.cjs');
const enableInspector=createRequire(import.meta.url)('../scripts/inspector-declaration.cjs');
test('T14 packaging includes independently versioned Inspector/Interaction and rejects stale or changed artifacts',()=>{
 const root=mkdtempSync(join(tmpdir(),'package-plan-'));mkdirSync(join(root,'artifacts/packages'),{recursive:true});
 folders.forEach((folder,i)=>{const name='fixture-'+i,version='0.1.0-test.'+(i+1);mkdirSync(join(root,folder),{recursive:true});writeFileSync(join(root,folder,'package.json'),JSON.stringify({name,version}));writeFileSync(join(root,'artifacts/packages',name+'-'+version+'.tgz'),'synthetic package '+i);});
 const entries=inventory(root);writeFileSync(join(root,'artifacts/package-source.json'),JSON.stringify({sourceDigest:'current-source',artifacts:entries}));
 assert.equal(verifiedPlan(root,'current-source').length,8);assert(entries.some(e=>e.folder==='packages/memory-inspector'));assert(entries.some(e=>e.folder==='packages/interaction-policy'));
 assert.throws(()=>verifiedPlan(root,'new-source'),/different source/);writeFileSync(join(root,'artifacts/packages',entries[0].filename),'changed');assert.throws(()=>verifiedPlan(root,'current-source'),/mismatch/);
});
test('T14 Inspector uses native insert once or overrides its existing Bundle declaration, initially read-only',()=>{
 const fresh=[];enableInspector(fresh);assert.equal(fresh[0].insert[0].name,'dsh-memory-inspector');assert.equal(fresh[0].insert[0].config.writable,false);enableInspector(fresh);assert.equal(fresh.length,1);
 const profile=[],bundle=[{insert:[{id:'memory-inspector',name:'dsh-memory-inspector',config:{writable:true}}]}];enableInspector(profile,bundle);assert.equal(profile[0].id,'memory-inspector');assert.equal(profile[0].name,undefined);assert.equal(profile[0].config.writable,false);
 assert.throws(()=>enableInspector(fresh,bundle),/Duplicate/);
});
