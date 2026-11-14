import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCard} from '../packages/character-definition/card-normalize.mjs';
import {CardError} from '../packages/character-definition/card-error.mjs';

const v3 = data => ({spec: 'chara_card_v3', spec_version: '3.0', data});

test('detects v3, v2 and v1 cards', () => {
  assert.equal(normalizeCard(v3({name: 'A', description: 'd'}), 'f').spec, 'v3');
  assert.equal(normalizeCard({spec: 'chara_card_v3', spec_version: '3.1', data: {name: 'A', description: 'd'}}, 'f').spec, 'v3');
  assert.equal(normalizeCard({spec: 'chara_card_v2', spec_version: '2.0', data: {name: 'A', personality: 'p'}}, 'f').spec, 'v2');
  const v1 = normalizeCard({name: 'A', scenario: 's', mes_example: 'm'}, 'f');
  assert.equal(v1.spec, 'v1');
  assert.equal(v1.data.scenario, 's');
  assert.equal(v1.data.mes_example, 'm');
});

test('keeps exactly the prompt-relevant fields', () => {
  const {data} = normalizeCard(v3({
    name: ' A ', nickname: 'a', description: 'd', personality: 'p', scenario: 's', mes_example: 'm',
    system_prompt: 'sp', post_history_instructions: 'phi', first_mes: 'hi', creator_notes: 'n', tags: ['x'],
  }), 'f');
  assert.deepEqual(data, {
    name: 'A', nickname: 'a', description: 'd', personality: 'p', scenario: 's', mes_example: 'm',
    system_prompt: 'sp', post_history_instructions: 'phi', bookEntryCount: 0, bookMalformed: false,
  });
});

test('missing or null fields become empty strings', () => {
  const {data} = normalizeCard({spec: 'chara_card_v2', data: {name: 'A', description: 'd', personality: null}}, 'f');
  assert.equal(data.personality, '');
  assert.equal(data.mes_example, '');
  assert.equal(data.nickname, '');
  assert.equal(data.bookEntryCount, 0);
});

test('counts lorebook entries', () => {
  const card = v3({name: 'A', description: 'd', character_book: {entries: [{}, {}]}});
  assert.equal(normalizeCard(card, 'f').data.bookEntryCount, 2);
});

test('rejects bad input, naming the field and file', () => {
  const rejects = (raw, pattern) => assert.throws(() => normalizeCard(raw, 'cards/x.json'), error => {
    assert(error instanceof CardError);
    assert.match(error.message, pattern);
    assert(error.message.includes('cards/x.json'));
    return true;
  });
  rejects({spec: 'chara_card_v4', data: {}}, /不支持的规格/);
  rejects({spec: 'chara_card_v3', spec_version: '2.0', data: {name: 'A', description: 'd'}}, /spec_version/);
  rejects({spec: 'chara_card_v3', spec_version: '3.0'}, /data/);
  rejects(v3({description: 'd'}), /name/);
  rejects(v3({name: '  ', description: 'd'}), /name/);
  rejects(v3({name: 'A', description: 5}), /字段 description 必须是文本（实际为数字）/);
  rejects(v3({name: 123, description: 'd'}), /字段 name 必须是文本（实际为数字）/);
  rejects({name: true, description: 'd'}, /字段 name 必须是文本（实际为布尔值）/);
  rejects(v3({name: 'A', description: 'd', mes_example: {}}), /字段 mes_example 必须是文本（实际为对象）/);
  rejects(v3({name: 'A', description: 'd', personality: ['p']}), /字段 personality 必须是文本（实际为列表）/);
  rejects(v3({name: 'A'}), /description、personality、scenario 不能全为空/);
  rejects(v3({name: 'A', description: '  ', personality: '\n'}), /不能全为空/);
  rejects([], /角色卡/);
  rejects('text', /角色卡/);
});

test('fields the deployment ignores never fail the card', () => {
  const {data} = normalizeCard(v3({
    name: 'A', description: 'd', system_prompt: ['x'], post_history_instructions: 5, character_book: {entries: 'x'},
  }), 'f');
  assert.equal(data.system_prompt, '["x"]');
  assert.equal(data.post_history_instructions, '5');
  assert.equal(data.bookEntryCount, 0);
  assert.equal(data.bookMalformed, true);
  assert.equal(normalizeCard(v3({name: 'A', description: 'd', character_book: 'book'}), 'f').data.bookMalformed, true);
  assert.equal(normalizeCard(v3({name: 'A', description: 'd', character_book: {entries: [{}]}}), 'f').data.bookMalformed, false);
});
