import test from 'node:test';import assert from 'node:assert/strict';
import {rolePresets} from '../packages/character-definition/role-presets.mjs';
test('formal role Presets use explicit public Persona; contact/guest do not derive Creator plugins',()=>{
 const owner={id:'preset-qq-character',name:'@deepseek-ai/dsh-agent-preset',config:{id:'qq-character',plugins:[{id:'persona',name:'persona',config:{prefix:'private-owner-definition'}},{id:'creator-tool',name:'fixture-tool'}]}};
 const before=structuredClone(owner),rows=rolePresets({owner,publicPersona:'Reviewed public Persona'});
 assert.deepEqual(owner,before);assert.deepEqual(rows.map(r=>r.config.id),['character','character-contact','character-guest']);assert(rows[0].config.plugins.some(r=>r.id==='creator-tool'));
 for(const row of rows.slice(1)){assert.deepEqual(row.config.plugins.map(p=>p.id),['persona','minimal-tool-scope']);assert.equal(row.config.plugins[0].config.prefix,'Reviewed public Persona');assert.deepEqual(row.config.plugins[1].config.allow,[]);}
 assert.equal(rolePresets({owner,publicPersona:'public',legacyOwner:true}).at(-1).config.id,'qq-character');assert.throws(()=>rolePresets({owner}));
});
test('native Creator expression objects survive role cloning',()=>{class Expression{constructor(source){this.source=source;}}const owner={config:{plugins:[{id:'persona',config:{prefix:'private'}},{id:'native-path',config:{path:new Expression('process.cwd()')}}]}};const result=rolePresets({owner,publicPersona:'public'});assert(result[0].config.plugins[1].config.path instanceof Expression);assert.notEqual(result[0].config.plugins[1].config.path,owner.config.plugins[1].config.path);});
