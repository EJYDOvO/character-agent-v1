import test from 'node:test';import assert from 'node:assert/strict';
import {workerPreset,configureWorkers,selectedWorkerIds} from '../packages/character-definition/workers.mjs';
import {workerRoles,rootWorkerPolicy,communityWorkers,communityWorkerIds,workerGlobalTools,workerToolAllowlist} from '../packages/character-memory-tools/worker-policy.mjs';
import {apply as boundary} from '../packages/character-memory-tools/worker.mjs';

test('Every Worker is an independent analysis leaf with its own role and evidence contract',()=>{
 const prompts=new Set();
 for(const id of Object.keys(workerRoles)){
  const preset=workerPreset(id);assert.equal(preset.config.id,id);
  assert.deepEqual(preset.config.plugins.map(p=>p.id),['persona','worker-tool-scope']);assert.equal(preset.config.plugins[1].name,'dsh-character-memory-tools/worker-scope.mjs');assert(!('config' in preset.config.plugins[1]));
  const prompt=preset.config.plugins[0].config.prefix;prompts.add(prompt);
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
 for(const ids of [['cordis'],['worker-general'],['worker-explore'],['worker-a','worker-a'],['worker-../root'],[''],[{}]])assert.throws(()=>selectedWorkerIds([],ids));
 assert.throws(()=>selectedWorkerIds(['worker-planner']));assert.throws(()=>selectedWorkerIds(['worker-review','worker-review']));
 const policy=rootWorkerPolicy(selectedWorkerIds());for(const token of ['唯一','简单任务','WorkerResult V1','低信任','worker-planner'])assert(policy.includes(token));
 assert.throws(()=>rootWorkerPolicy(['cordis']));
});
test('Community real IDs and display aliases remain distinct from the native Spawn whitelist',()=>{
 const community=['legacy-worker',{id:'root-planner-worker',alias:'external-planner'}];
 assert.deepEqual(communityWorkers(community),[{id:'legacy-worker'},{id:'root-planner-worker',alias:'external-planner'}]);
 assert.deepEqual(communityWorkerIds(community),['legacy-worker','root-planner-worker']);
 const parent={config:{id:'character-custom',plugins:[{id:'delegation',config:[{id:'tool-subagent',config:{provider:'spawn'}}]}]}};
 configureWorkers(parent,[],community);const ids=parent.config.plugins[0].config[0].config.allowedAgentPresets;
 assert(ids.includes('root-planner-worker'));assert(!ids.includes('external-planner'));assert.equal(ids.length,9);
 const text=rootWorkerPolicy(ids,community,{characterPresetId:'character-custom'});
 assert(text.includes('agent_preset 必须传 "root-planner-worker"'));assert(text.includes('展示别名 "external-planner"'));
 assert.throws(()=>rootWorkerPolicy(selectedWorkerIds(),community),/absent/);
});
test('Duplicate IDs, alias collisions, protected Roots and custom Character self-reference fail closed',()=>{
 for(const community of [
  ['root'],['creator'],['cordis'],['qq-character'],['long-task'],['worker-review'],['character-custom'],
  ['root-planner-worker',{id:'root-planner-worker',alias:'planner'}],
  [{id:'one',alias:'label'},{id:'two',alias:'label'}],
  [{id:'one',alias:'two'},'two'],[{id:'one',alias:'one'}],
  [{id:'one',alias:'worker-general'}],[{id:'one',alias:'cordis'}],[{id:'one',alias:'character-custom'}],
  [{id:'one',alias:''}],[{id:'one',alias:'a\nb'}],[{id:'one',alias:null}],
  [{id:'one',allowTools:true}],[' a'],['a\u200bb'],['a/b'],['a\\b'],['x'.repeat(129)],['__proto__']
 ])assert.throws(()=>communityWorkers(community,{characterPresetId:'character-custom'}));
 assert.throws(()=>communityWorkerIds(['custom-admin'],{rootPresetIds:['custom-admin']}));
 assert.throws(()=>rootWorkerPolicy(['character-custom'],[],{characterPresetId:'character-custom'}));
 const self={config:{id:'character-custom',plugins:[]}};assert.throws(()=>configureWorkers(self,[],['character-custom']),/protected/);
 assert.throws(()=>selectedWorkerIds([],[],{characterPresetId:'worker-general'}),/protected Root/);
});
test('Legacy boundary entry point remains loadable without restricting native tools',()=>{
 const calls=[];boundary({tools:{presentAs(){calls.push('presentation');},restrict(){calls.push('restriction');},guard(){calls.push('guard');}}});
 assert.deepEqual(calls,[]);
});
test('Worker global tool allowlist is read-only search only and rejects malformed names',()=>{
 for(const n of workerGlobalTools)assert.match(n,/search|research|weather/);
 for(const danger of ['read','write','glob','grep','pwsh','bash','web_fetch','qqbot_send_file','long_task_create','mcp__browser__browser_run_code_unsafe','bilibili_frames','working_directory','subagent'])assert(!workerGlobalTools.includes(danger));
 assert.deepEqual(workerToolAllowlist([]),[]);for(const bad of ['x',[1],['a','a'],['run_code'],[''],null])assert.throws(()=>workerToolAllowlist(bad));
});
