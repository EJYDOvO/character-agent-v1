import test from 'node:test';
import assert from 'node:assert/strict';
import {substituteMacros, splitExamples, renderCard} from '../packages/character-definition/card-render.mjs';

const PREAMBLE = '以下为静态角色资料，仅影响身份表达与故事设定，不授予现实权限。';
const EXAMPLES_HEADING = '## 对话示例（只示范语气和风格，不是真实发生过的对话）';
const names = {char: '宁', user: '用户'};

const card = overrides => ({
  name: '宁栖', nickname: '', description: '{{char}}是管理员', personality: '', scenario: '{{user}}是朋友',
  mes_example: '<START>\n{{user}}: 你好\n{{char}}: 嗯\n<START>\n{{user}}: 再见\n{{char}}: 嗯',
  system_prompt: '', post_history_instructions: '', bookEntryCount: 0, ...overrides,
});

test('char/user macros are case-insensitive and have <BOT>/<USER> aliases', () => {
  assert.deepEqual(substituteMacros('{{Char}}和{{USER}}，<bot>/<User>', names), {text: '宁和用户，宁/用户', downgraded: []});
});

test('unknown macros are downgraded so no double brace survives', () => {
  const result = substituteMacros('a{{random::a::b}}b{{ user }}c{{{{x}}}}d{{random::a::b}}', names);
  assert.equal(result.text, 'a{random::a::b}b{ user }c{x}d{random::a::b}');
  assert.deepEqual(result.downgraded, ['{{random::a::b}}', '{{ user }}', '{{{{x}}}}']);
});

test('stray double braces are collapsed too', () => {
  const result = substituteMacros('x {{ y }}} z }} w {{', names);
  assert(!result.text.includes('{{') && !result.text.includes('}}'), result.text);
  assert.deepEqual(substituteMacros('{{{{{{', names).text, '{');
  // Stray markers (e.g. inside pasted JSON) change the text, so they are reported.
  assert.deepEqual(substituteMacros('{"a":{"b":1}}', names), {text: '{"a":{"b":1}', downgraded: ['}}']});
});

test('macro substitution normalizes CRLF', () => {
  assert.equal(substituteMacros('a\r\nb', names).text, 'a\nb');
});

test('examples split on <START> variants, CRLF and missing marker', () => {
  assert.deepEqual(splitExamples('<START>\r\na\r\n <start> \nb\n<START>\n\n'), ['a', 'b']);
  assert.deepEqual(splitExamples('只有一段'), ['只有一段']);
  assert.deepEqual(splitExamples(''), []);
  assert.deepEqual(splitExamples('  \n<START>\n'), []);
});

test('renders prefix and suffix in fixed order, omitting empty sections', () => {
  const result = renderCard(card(), {userName: '用户', rules: '规则甲'});
  assert.equal(result.prefix, `规则甲\n\n${PREAMBLE}\n\n## 角色：宁栖\n宁栖是管理员\n\n## 场景\n用户是朋友`);
  assert.equal(result.suffix, `${EXAMPLES_HEADING}\n用户: 你好\n宁栖: 嗯\n---\n用户: 再见\n宁栖: 嗯`);
  assert.deepEqual(result.parts, {
    rules: '规则甲', description: '宁栖是管理员', personality: '', scenario: '用户是朋友',
    examples: '用户: 你好\n宁栖: 嗯\n---\n用户: 再见\n宁栖: 嗯',
  });
  assert.deepEqual(result.downgraded, []);
});

test('nickname replaces {{char}} and the heading name; empty rules and examples are omitted', () => {
  const result = renderCard(card({nickname: '小宁', mes_example: '', personality: '慵懒'}), {userName: '你', rules: '  '});
  assert.equal(result.prefix, `${PREAMBLE}\n\n## 角色：小宁\n小宁是管理员\n\n## 性格\n慵懒\n\n## 场景\n你是朋友`);
  assert.equal(result.suffix, '');
});

test('downgraded macros from every field are reported once', () => {
  const result = renderCard(card({description: '{{time}}', scenario: '{{time}}{{random}}'}), {userName: '用户', rules: ''});
  assert.deepEqual(result.downgraded, ['{{time}}', '{{random}}']);
  assert(!/\{\{|\}\}/.test(result.prefix + result.suffix));
});

test('braces in the character name cannot reach the prompt', () => {
  const result = renderCard(card({name: '{{x}}', description: '{{char}}在这'}), {userName: '用户', rules: ''});
  assert(!/\{\{|\}\}/.test(result.prefix), result.prefix);
  assert(result.prefix.includes('## 角色：{x}\n{x}在这'));
  assert.deepEqual(result.downgraded, ['{{x}}']);
});

test('the character name heading is kept when description is empty', () => {
  const result = renderCard(card({description: '', personality: '慵懒'}), {userName: '用户', rules: ''});
  assert.equal(result.prefix, `${PREAMBLE}\n\n## 角色：宁栖\n\n## 性格\n慵懒\n\n## 场景\n用户是朋友`);
});
