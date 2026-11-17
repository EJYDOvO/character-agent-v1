import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerReminder, REMINDER_CONTEXT} from '../packages/character-memory-tools/reminder.mjs';
import {rolePresets} from '../packages/character-definition/role-presets.mjs';

function fakeContext() {
  const contexts = [];
  return {contexts, ctx: {effect: register => register(), systemPrompt: {context: entry => contexts.push(entry)}}};
}

test('registers an order 95 runtime context without interpolation', () => {
  const {ctx, contexts} = fakeContext();
  assert.equal(registerReminder(ctx, '用「嗯，」开头'), true);
  assert.equal(contexts.length, 1);
  assert.deepEqual({name: contexts[0].name, order: contexts[0].order, interpolate: contexts[0].interpolate},
    {name: 'character:reminder', order: 95, interpolate: false});
  assert.equal(REMINDER_CONTEXT, 'character:reminder');
  assert.equal(contexts[0].text({agent: {}}), '用「嗯，」开头');
});

test('a missing or blank reminder registers nothing', () => {
  for (const reminder of [undefined, null, '', '   \n']) {
    const {ctx, contexts} = fakeContext();
    assert.equal(registerReminder(ctx, reminder), false);
    assert.equal(contexts.length, 0);
  }
});

test('a malformed reminder fails fast', () => {
  const {ctx} = fakeContext();
  assert.throws(() => registerReminder(ctx, 3), /reminder/);
  assert.throws(() => registerReminder(ctx, 'x'.repeat(4001)), /reminder/);
});

test('the Character plugin registers config.reminder', () => {
  const source = fs.readFileSync(new URL('../packages/character-memory-tools/character.mjs', import.meta.url), 'utf8');
  assert.match(source, /registerReminder\(ctx,config\.reminder\)/);
});

test('contact and guest presets carry no reminder', () => {
  const owner = {id: 'preset-qq-character', name: '@deepseek-ai/dsh-agent-preset', config: {id: 'qq-character', name: 'Character', plugins: [
    {id: 'persona', name: 'persona', config: {prefix: 'owner'}},
    {id: 'character-memory-tools', name: 'dsh-character-memory-tools/character.mjs', config: {characterPresetId: 'qq-character', reminder: '只给 Owner'}},
  ]}};
  const [root, contact, guest] = rolePresets({owner, publicPersona: 'public'});
  assert.equal(root.config.plugins.find(p => p.id === 'character-memory-tools').config.reminder, '只给 Owner');
  for (const preset of [contact, guest]) {
    assert(!JSON.stringify(preset).includes('只给 Owner'), preset.config.id);
  }
});
