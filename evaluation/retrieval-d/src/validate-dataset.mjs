// Structural validation of corpus + judgments, and hash freeze of the splits.
// `node src/validate-dataset.mjs --freeze` writes dataset/FREEZE.json; without the flag it verifies it.
import fs from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {memories,scopes,distractors,corpusVersion} from '../dataset/corpus.mjs';
import {queries,queriesVersion} from '../dataset/queries.mjs';
import {validateStatement} from '../../../packages/character-memory-core/store.mjs';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const byLabel=new Map();
for(const [label,scope,kind,statement,options={}]of [...memories,...distractors(300)]){
 assert(!byLabel.has(label),'duplicate label '+label);assert(scopes[scope],'scope '+scope);assert(['semantic','episodic','procedural'].includes(kind));
 validateStatement(statement);if(options.was)validateStatement(options.was);
 byLabel.set(label,{scope,statement,options});
}
const statements=new Set();for(const [l,v]of byLabel){const k=v.scope+'|'+v.statement.normalize('NFKC').trim();assert(!statements.has(k),'duplicate statement '+l);statements.add(k);}
const ids=new Set(),counts={};
for(const q of queries){
 assert(!ids.has(q.id),'duplicate query '+q.id);ids.add(q.id);assert(q.query.length<=200,'query too long '+q.id);assert(scopes[q.scope]);
 for(const [label,grade]of Object.entries(q.judgments)){const m=byLabel.get(label);assert(m,q.id+': unknown label '+label);assert([1,2].includes(grade));
  assert.equal(m.scope,q.scope,q.id+': judged record '+label+' is outside the query scope');
  assert(!m.options.forget,q.id+': forgotten record judged relevant');assert(!(m.options.expiresAt&&Date.parse(m.options.expiresAt)<=Date.now()),q.id+': expired record judged relevant');}
 for(const label of q.negatives)assert(byLabel.get(label)?.scope===q.scope,q.id+': negative '+label);
 const key=q.split+'/'+q.category;counts[key]=(counts[key]??0)+1;
}
const part=split=>queries.filter(q=>q.split===split);
const freeze={corpusVersion,queriesVersion,records:memories.length,recordsByScope:Object.fromEntries(Object.keys(scopes).map(s=>[s,memories.filter(m=>m[1]===s).length])),
 lifecycle:{corrected:memories.filter(m=>m[4]?.was).length,forgotten:memories.filter(m=>m[4]?.forget).length,expired:memories.filter(m=>m[4]?.expiresAt&&Date.parse(m[4].expiresAt)<=Date.now()).length,conflictKeys:new Set(memories.map(m=>m[4]?.claimKey).filter(Boolean)).size},
 queries:{dev:part('dev').length,heldout:part('heldout').length},categories:counts,
 sha256:{corpus:sha(memories),distractors300:sha(distractors(300)),dev:sha(part('dev')),heldout:sha(part('heldout'))}};
const file=fileURLToPath(new URL('../dataset/FREEZE.json',import.meta.url));
if(process.argv.includes('--freeze')){fs.writeFileSync(file,JSON.stringify({frozenAt:new Date().toISOString(),...freeze},null,1)+'\n');console.log('frozen');}
else{const {frozenAt,...saved}=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(saved,JSON.parse(JSON.stringify(freeze)),'dataset differs from FREEZE.json');console.log('matches FREEZE.json frozen at',frozenAt);}
console.log(JSON.stringify({records:freeze.records,byScope:freeze.recordsByScope,lifecycle:freeze.lifecycle,queries:freeze.queries},null,0));
