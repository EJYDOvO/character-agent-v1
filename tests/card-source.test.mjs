import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const require = createRequire(import.meta.url);
const {cardSettings, cardRevisions} = require('../scripts/card-source.cjs');
const root = resolve(import.meta.dirname, '..');
const ENV = ['DSH_CHARACTER_BUILD_CONFIG', 'DSH_CHARACTER_CARD', 'DSH_CHARACTER_DEFINITION'];

// Runs fn with a temporary build config and the given environment overrides.
function withConfig(config, env, fn) {
  const saved = Object.fromEntries(ENV.map(name => [name, process.env[name]]));
  const file = join(mkdtempSync(join(tmpdir(), 'card-source-')), 'build-config.json');
  writeFileSync(file, '﻿' + JSON.stringify(config));
  for (const name of ENV) delete process.env[name];
  Object.assign(process.env, {DSH_CHARACTER_BUILD_CONFIG: file}, env);
  try {
    return fn();
  } finally {
    for (const name of ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test('defaults to the template card', () => withConfig({}, {}, () => {
  assert.deepEqual(cardSettings(), {
    characterId: 'character-a',
    cardPath: join(root, 'characters', 'template', 'card.yaml'),
    systemRulesPath: null,
    reminderPath: null,
    userName: '用户',
  });
}));

test('config keys resolve against the repository root; env overrides the card', () => {
  const config = {characterId: 'test-a', cardPath: 'private/a/card.json', userName: '小林', rules: {systemFile: 'private/a/rules.md', reminderFile: 'private/a/reminder.md'}};
  withConfig(config, {}, () => {
    assert.deepEqual(cardSettings(), {
      characterId: 'test-a',
      cardPath: join(root, 'private', 'a', 'card.json'),
      systemRulesPath: join(root, 'private', 'a', 'rules.md'),
      reminderPath: join(root, 'private', 'a', 'reminder.md'),
      userName: '小林',
    });
  });
  const override = join(tmpdir(), 'other.png');
  withConfig(config, {DSH_CHARACTER_CARD: override}, () => assert.equal(cardSettings().cardPath, override));
});

test('the old definition keys are rejected with a pointer to cardPath', () => {
  withConfig({definitionPath: 'x.yaml'}, {}, () => assert.throws(() => cardSettings(), /cardPath/));
  withConfig({}, {DSH_CHARACTER_DEFINITION: 'x.yaml'}, () => assert.throws(() => cardSettings(), /DSH_CHARACTER_CARD/));
});

test('invalid values are rejected', () => {
  for (const config of [
    {characterId: 'Bad Id'},
    {userName: ''},
    {userName: '  '},
    {userName: 'x'.repeat(33)},
    {userName: '{{user}}'},
    {userName: 'a\nb'},
    {cardPath: 3},
    {rules: 'rules.md'},
    {rules: {systemFile: 5}},
  ]) {
    withConfig(config, {}, () => assert.throws(() => cardSettings(), Error, JSON.stringify(config)));
  }
});

test('cardRevisions changes when the card or either rules file changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-rev-'));
  const settings = {cardPath: join(dir, 'card.json'), systemRulesPath: join(dir, 'rules.md'), reminderPath: join(dir, 'reminder.md')};
  writeFileSync(settings.cardPath, '{}');
  writeFileSync(settings.systemRulesPath, 'a');
  writeFileSync(settings.reminderPath, 'b');
  const first = cardRevisions(settings);
  assert.match(first.revision, /^[0-9a-f]{64}$/);

  writeFileSync(settings.cardPath, '{ }');
  const second = cardRevisions(settings);
  assert.notEqual(second.revision, first.revision);
  assert.equal(second.rulesRevision, first.rulesRevision);

  writeFileSync(settings.systemRulesPath, 'a2');
  const third = cardRevisions(settings);
  assert.notEqual(third.rulesRevision, second.rulesRevision);

  writeFileSync(settings.reminderPath, 'b2');
  assert.notEqual(cardRevisions(settings).rulesRevision, third.rulesRevision);

  // Moving text between the two files is a change, not a no-op.
  writeFileSync(settings.systemRulesPath, 'ab');
  writeFileSync(settings.reminderPath, '');
  const moved = cardRevisions(settings);
  writeFileSync(settings.systemRulesPath, 'a');
  writeFileSync(settings.reminderPath, 'b');
  assert.notEqual(moved.rulesRevision, cardRevisions(settings).rulesRevision);
  assert.equal(cardRevisions({...settings, systemRulesPath: null, reminderPath: null}).rulesRevision.length, 64);
});

test('portable config maps card settings relative to the config file', () => {
  const {cardBuildConfig} = require('../scripts/portable.cjs');
  const dir = join(tmpdir(), 'portable-config');
  assert.deepEqual(cardBuildConfig({card: 'my/card.png', rules: {system: 'my/rules.md', reminder: 'my/reminder.md'}, userName: '小林', characterId: 'test-a'}, dir), {
    cardPath: join(dir, 'my', 'card.png'),
    rules: {systemFile: join(dir, 'my', 'rules.md'), reminderFile: join(dir, 'my', 'reminder.md')},
    userName: '小林',
    characterId: 'test-a',
  });
  assert.deepEqual(cardBuildConfig({}, dir), {cardPath: join(root, 'characters', 'template', 'card.yaml'), rules: {}});
  assert.throws(() => cardBuildConfig({definition: 'persona.yaml'}, dir), /"card"/);
});

test('misnamed card keys fail instead of silently dropping the card or rules', () => {
  withConfig({card: 'x.yaml'}, {}, () => assert.throws(() => cardSettings(), /cardPath/));
  withConfig({rules: {system: 'r.md'}}, {}, () => assert.throws(() => cardSettings(), /systemFile/));
  withConfig({rules: {systemFile: 'r.md', reminder: 'm.md'}}, {}, () => assert.throws(() => cardSettings(), /reminderFile/));
  const {cardBuildConfig} = require('../scripts/portable.cjs');
  assert.throws(() => cardBuildConfig({cardPath: 'x.yaml'}, tmpdir()), /"card"/);
  assert.throws(() => cardBuildConfig({rules: {systemFile: 'r.md'}}, tmpdir()), /"system"/);
});
