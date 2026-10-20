import test from 'node:test';import assert from 'node:assert/strict';
import {workerPreset,configureWorkers} from '../packages/character-definition/workers.mjs';
test('Worker composition has no execution or memory tools and only native Spawn is changed',()=>{
 for(const id of ['worker-general','worker-review'])assert.deepEqual(workerPreset(id).config.plugins.map(p=>p.id),['worker-boundary','persona']);
 const parent={config:{plugins:[{id:'delegation',config:[{id:'tool-subagent',config:{provider:'spawn',modelSelectionSettings:true}},{id:'tool-subagent-fork',config:{provider:'fork'}}]},{id:'tool-fs'}]}};
 configureWorkers(parent);assert.deepEqual(parent.config.plugins[0].config[0].config.allowedAgentPresets,['worker-general']);assert.equal(parent.config.plugins[0].config[1].config.provider,'fork');assert.equal(parent.config.plugins[1].id,'tool-fs');assert.throws(()=>configureWorkers({config:{plugins:[]}}),/changed/);
});
