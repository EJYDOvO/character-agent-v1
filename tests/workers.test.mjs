import test from 'node:test';import assert from 'node:assert/strict';
import {workerPreset,configureWorkers,selectedWorkerIds} from '../packages/character-definition/workers.mjs';
import {workerRoles,rootWorkerPolicy} from '../packages/character-memory-tools/worker-policy.mjs';
import {apply as boundary} from '../packages/character-memory-tools/worker.mjs';

test('Every Worker is an independent analysis leaf with its own role and evidence contract',()=>{
 const prompts=new Set();
 for(const id of Object.keys(workerRoles)){
  const preset=workerPreset(id);assert.equal(preset.config.id,id);
  assert.deepEqual(preset.config.plugins.map(p=>p.id),['worker-boundary','persona']);
  const prompt=preset.config.plugins[1].config.prefix;prompts.add(prompt);
  for(const text of [id,'WorkerResult V1','evidence','needs_input','不继承父会话历史','最终决策'])assert(prompt.includes(text));
 }
 assert.equal(prompts.size,8);assert.throws(()=>workerPreset('cordis'),/Unknown/);
});
test('Root retains Creator and model selection; only native Spawn gets the trusted roster/depth',()=>{
 const fork={id:'tool-subagent-fork',config:{provider:'fork',marker:true}},fs={id:'tool-fs'};
 const parent={config:{plugins:[{id:'delegation',config:[{id:'tool-subagent',config:{provider:'spawn',modelSelectionSettings:true}},fork]},fs]}};
 configureWorkers(parent,['worker-review'],['worker-community']);
 const config=parent.config.plugins[0].config[0].config;
 assert.deepEqual(config.allowedAgentPresets,selectedWorkerIds(['worker-review'],['worker-community']));
 assert.equal(config.maxDepth,1);assert.equal(config.agentPreset,'worker-general');assert.equal(config.modelSelectionSettings,true);
 assert.equal(parent.config.plugins[0].config[1],fork);assert.equal(parent.config.plugins[1],fs);
 assert(!('toolFilter' in config));assert(!('persona' in config));
 assert.throws(()=>configureWorkers({config:{plugins:[]}}),/changed/);
});
test('Roster is trusted build configuration and rejects unsafe, duplicate or built-in community references',()=>{
 assert.equal(selectedWorkerIds().length,7);assert(!selectedWorkerIds().includes('worker-review'));
 for(const ids of [['cordis'],['worker-general'],['worker-explore'],['worker-a','worker-a'],['worker-../root'],['worker-'],[{}]])assert.throws(()=>selectedWorkerIds([],ids));
 assert.throws(()=>selectedWorkerIds(['worker-planner']));assert.throws(()=>selectedWorkerIds(['worker-review','worker-review']));
 const policy=rootWorkerPolicy(selectedWorkerIds());for(const token of ['唯一','简单任务','WorkerResult V1','低信任','worker-planner'])assert(policy.includes(token));
 assert.throws(()=>rootWorkerPolicy(['cordis']));
});
test('Boundary hides inherited tools, overrides PTC presentation, and denies even explicit late tool grants',()=>{
 const calls=[];let guard;
 boundary({tools:{presentAs(v){calls.push(['presentation',v]);},restrict(v){calls.push(['restriction',v]);},guard(f){guard=f;}}});
 assert.deepEqual(calls,[['presentation','native'],['restriction',{allow:[]}]]);
 for(const name of ['run_code','subagent','character_recall','remember','late_scoped_write'])assert.match(guard({name,arguments:{allow:true}}),/cannot execute/);
});
