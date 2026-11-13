import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import {loadCard, CardError, estimatePromptTokens, WARN_TOKENS, MAX_TOKENS, MAX_REMINDER_CHARS} from '../packages/character-definition/card.mjs';

const parseYaml = text => yaml.load(text);
const dir = () => mkdtempSync(join(tmpdir(), 'card-load-'));

function cardFile(data, folder = dir()) {
  const file = join(folder, 'card.json');
  writeFileSync(file, JSON.stringify({spec: 'chara_card_v3', spec_version: '3.0', data: {name: '甲', description: '甲是测试角色', ...data}}));
  return file;
}

function textFile(content, name = 'rules.md') {
  const file = join(dir(), name);
  writeFileSync(file, content);
  return file;
}

test('limits are the spec values', () => {
  assert.equal(WARN_TOKENS, 3000);
  assert.equal(MAX_TOKENS, 8000);
  assert.equal(MAX_REMINDER_CHARS, 4000);
});

test('template card builds clean', () => {
  const build = loadCard({
    cardPath: 'characters/template/card.yaml',
    systemRulesPath: 'characters/template/rules.md',
    reminderPath: 'characters/template/reminder.md',
    parseYaml,
  });
  assert.equal(build.spec, 'v3');
  assert.equal(build.name, '示例角色');
  assert.deepEqual(build.warnings, []);
  assert(!/\{\{|\}\}/.test(build.prefix + build.suffix + build.reminder));
  assert(build.prefix.startsWith('【说话规则】'));
  assert(build.suffix.startsWith('## 对话示例'));
  assert(build.tokens.total < WARN_TOKENS);
});

test('rules files are cleaned and every part is counted', () => {
  const build = loadCard({
    cardPath: cardFile({}),
    systemRulesPath: textFile('﻿  甲\r\n乙  \r\n'),
    reminderPath: textFile('﻿提醒\r\n', 'reminder.md'),
    userName: '你',
    parseYaml,
  });
  assert(build.prefix.startsWith('甲\n乙\n\n以下为静态角色资料'));
  assert.equal(build.reminder, '提醒');
  assert.equal(build.tokens.fields.reminder, 2);
  const sum = Object.values(build.tokens.fields).reduce((a, b) => a + b, 0);
  assert.equal(build.tokens.total, sum);
  assert.equal(build.tokens.fields.rules, estimatePromptTokens('甲\n乙'));
  assert(build.tokens.fields.overhead > 0, 'preamble and headings are counted');
});

test('optional rules default to empty and userName to 用户', () => {
  const build = loadCard({cardPath: cardFile({scenario: '{{user}}来了'}), parseYaml});
  assert.equal(build.reminder, '');
  assert(build.prefix.startsWith('以下为静态角色资料'));
  assert(build.prefix.endsWith('用户来了'));
});

test('warnings for ignored rules fields, lorebook, downgraded macros and size', () => {
  const longPrompt = 'Write 2-4 paragraphs, use *asterisks* for actions, never speak for the user, stay in character.';
  const build = loadCard({
    cardPath: cardFile({
      system_prompt: longPrompt,
      post_history_instructions: '保持第三人称',
      character_book: {entries: [{}, {}, {}]},
      personality: '{{random::a}}',
      first_mes: '你好',
      creator_notes: '备注',
    }),
    parseYaml,
  });
  assert.deepEqual(build.warnings, [
    `已忽略 system_prompt：「${[...longPrompt].slice(0, 60).join('')}」`,
    '已忽略 post_history_instructions：「保持第三人称」',
    '设定集 3 条，第二期才生效，目前不起作用',
    '以下宏已降级为单花括号：{{random::a}}',
  ]);

  const large = loadCard({cardPath: cardFile({description: '字'.repeat(5100)}), parseYaml});
  assert.equal(large.warnings.length, 1);
  assert.match(large.warnings[0], /^人设约 \d+ token，超过 3000，模型可能忽略部分规则$/);
});

test('over the hard limit fails and names the largest fields', () => {
  assert.throws(
    () => loadCard({cardPath: cardFile({description: '字'.repeat(12000), personality: '性'.repeat(1500)}), parseYaml}),
    error => {
      assert(error instanceof CardError);
      assert.match(error.message, /渲染后的人设约 \d+ token，上限 8000。占比最大的字段：description \d+、personality \d+/);
      return true;
    });
});

test('rules files must not contain macros and must exist', () => {
  const withMacro = textFile('你是{{char}}');
  assert.throws(() => loadCard({cardPath: cardFile({}), systemRulesPath: withMacro, parseYaml}),
    error => error instanceof CardError && /规则文件/.test(error.message) && error.message.includes(withMacro));
  const closing = textFile('x }} y', 'reminder.md');
  assert.throws(() => loadCard({cardPath: cardFile({}), reminderPath: closing, parseYaml}), /规则文件/);
  const missing = join(dir(), 'none.md');
  assert.throws(() => loadCard({cardPath: cardFile({}), systemRulesPath: missing, parseYaml}),
    error => error instanceof CardError && error.message.includes(missing));
});

test('reminder longer than the runtime limit fails at build time', () => {
  const reminder = textFile('a'.repeat(4001), 'reminder.md');
  assert.throws(() => loadCard({cardPath: cardFile({}), reminderPath: reminder, parseYaml}), /末尾提醒超过 4000 字/);
});
