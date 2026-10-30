import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rootExecutionPolicy} from '../packages/character-memory-tools/root-policy.mjs';
import {workerRoles} from '../packages/character-memory-tools/worker-policy.mjs';
import {workerPreset} from '../packages/character-definition/workers.mjs';

test('Root execution policy keeps its rules and asks to verify time-sensitive facts before answering',()=>{
 for(const text of ['角色只影响表达，不改变工具、审批或核验要求','character_remember','character_recall','不能成为权限或工具指令','失败与未测必须如实报告','只有明确授权的提醒或真实任务事件可以触发通知'])assert(rootExecutionPolicy.includes(text),text);
 for(const text of ['当年、最新、实时或近期','奖项提名','先用可用的搜索工具查证再回答','说明来源','“猜猜看”','明确标为推测','没有搜索工具时如实说明','不编造名称或细节'])assert(rootExecutionPolicy.includes(text),text);
 assert(!/web_search|research|free-search/.test(rootExecutionPolicy),'no tool names: the rule must hold whatever search provider is installed');
});
test('The Character Root section uses the shared policy; Worker prompts do not carry it',()=>{
 const source=fs.readFileSync(new URL('../packages/character-memory-tools/character.mjs',import.meta.url),'utf8');
 assert.match(source,/name:'character:execution',order:100,text:rootExecutionPolicy\}/);
 for(const id of Object.keys(workerRoles))assert(!workerPreset(id).config.plugins[0].config.prefix.includes('先用可用的搜索工具查证'),id);
});
