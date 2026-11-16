import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import yaml from 'js-yaml';
import {compileCharacter, approvePublic, saveCharacter, readSettings} from '../packages/character-manager/compile.mjs';
import {NEUTRAL_PERSONA, writeJsonAtomic} from '../packages/character-manager/compiled.mjs';
import {apply, inject, name, personaState} from '../packages/character-manager/runtime-persona.mjs';

const template = resolve(import.meta.dirname, '..', 'characters', 'template');
const characterId = 'demo';
const parseYaml = text => yaml.load(text);
const NEUTRAL = {prefix: NEUTRAL_PERSONA, suffix: '', reminder: ''};

// A character directory built from the template card, with a real compiled.json.
function fixture({approved = true} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-persona-'));
  for (const file of ['card.yaml', 'rules.md', 'reminder.md']) copyFileSync(join(template, file), join(dir, file));
  writeFileSync(join(dir, 'character.json'), JSON.stringify({userName: '阿宁'}));
  writeFileSync(join(dir, 'binding.json'), JSON.stringify({characterId}));
  const compiledFile = join(dir, 'compiled.json');
  writeJsonAtomic(compiledFile, compileCharacter({dir, characterId, parseYaml}).compiled);
  if (approved) {
    const {pendingPublic} = compileCharacter({dir, characterId, parseYaml}).compiled;
    approvePublic({dir, characterId, parseYaml, hash: pendingPublic.hash});
  }
  const read = () => compileCharacter({dir, characterId, parseYaml}).compiled;
  return {dir, compiledFile, bindingFile: join(dir, 'binding.json'), read};
}

// Records what the plugin registers, like the native systemPrompt service.
function host(config) {
  const sections = new Map(), contexts = new Map();
  const orders = {DEPLOYMENT_PERSONA_PREFIX: 0, DEPLOYMENT_PERSONA_SUFFIX: 10200};
  const ctx = {
    effect: register => { register(); },
    systemPrompt: {
      getSectionOrder: key => orders[key],
      section: entry => sections.set(entry.name, entry),
      context: entry => contexts.set(entry.name, entry),
    },
  };
  apply(ctx, config);
  const prefix = sections.get('deployment:persona-prefix');
  const suffix = sections.get('deployment:persona-suffix');
  const reminder = contexts.get('character:reminder');
  return {prefix, suffix, reminder, read: () => ({prefix: prefix.text(), suffix: suffix.text(), reminder: reminder.text()})};
}

function bump(file, seconds = 1) {
  const at = new Date(Date.now() + seconds * 1000);
  utimesSync(file, at, at);
}

test('plugin identity and registrations', () => {
  assert.equal(name, 'character-runtime-persona');
  assert.deepEqual(inject, ['systemPrompt']);
  const {compiledFile, bindingFile} = fixture();
  const h = host({audience: 'owner', compiledFile, bindingFile});
  assert.equal(h.prefix.order, 0);
  assert.equal(h.suffix.order, 10200);
  assert.equal(h.reminder.order, 95);
  assert.equal(h.reminder.interpolate, false);
  for (const entry of [h.prefix, h.suffix, h.reminder]) assert.equal(typeof entry.text, 'function');
});

test('owner reads the Owner version', () => {
  const {compiledFile, bindingFile, read} = fixture();
  const compiled = read();
  assert.deepEqual(host({audience: 'owner', compiledFile, bindingFile}).read(), {
    prefix: compiled.owner.prefix, suffix: compiled.owner.suffix, reminder: compiled.reminder,
  });
});

test('public reads only the approved public version', () => {
  const approved = fixture();
  const compiled = approved.read();
  assert(compiled.public);
  const publicText = host({audience: 'public', compiledFile: approved.compiledFile, bindingFile: approved.bindingFile}).read();
  assert.deepEqual(publicText, {prefix: compiled.public.prefix, suffix: compiled.public.suffix, reminder: compiled.public.reminder});

  const pending = fixture({approved: false});
  assert(pending.read().pendingPublic && !pending.read().public);
  const neutral = host({audience: 'public', compiledFile: pending.compiledFile, bindingFile: pending.bindingFile}).read();
  assert.deepEqual(neutral, NEUTRAL);
  for (const result of [publicText, neutral]) {
    assert(!Object.values(result).join('\n').includes(compiled.owner.prefix));
  }
});

test('an edited reminder reaches the Owner only until the Owner approves it', () => {
  const {dir, compiledFile, bindingFile, read} = fixture();
  const approvedReminder = read().public.reminder;
  saveCharacter({dir, characterId, parseYaml, revision: readSettings(dir).revision, draft: {reminder: '没确认过的新提醒。'}});
  bump(compiledFile);
  const owner = host({audience: 'owner', compiledFile, bindingFile}).read();
  const publicText = host({audience: 'public', compiledFile, bindingFile}).read();
  assert.equal(owner.reminder, '没确认过的新提醒。');
  assert.equal(publicText.reminder, approvedReminder);
  assert(!JSON.stringify(publicText).includes('没确认过的新提醒。'));
});

test('approving the public version takes effect on the next read', () => {
  const {dir, compiledFile, bindingFile, read} = fixture({approved: false});
  const h = host({audience: 'public', compiledFile, bindingFile});
  assert.deepEqual(h.read(), NEUTRAL);
  approvePublic({dir, characterId, parseYaml, hash: read().pendingPublic.hash});
  bump(compiledFile);
  assert.equal(h.read().prefix, read().public.prefix);
});

test('edits apply on the next read', () => {
  const {compiledFile, bindingFile, read} = fixture();
  const compiled = read();
  const h = host({audience: 'owner', compiledFile, bindingFile});
  assert.equal(h.read().prefix, compiled.owner.prefix);
  writeJsonAtomic(compiledFile, {...compiled, reminder: '新的提醒', owner: {prefix: '新的开头', suffix: '新的结尾'}});
  bump(compiledFile);
  assert.deepEqual(h.read(), {prefix: '新的开头', suffix: '新的结尾', reminder: '新的提醒'});
});

test('a broken file keeps the last good text', () => {
  const {compiledFile, bindingFile, read} = fixture();
  const compiled = read();
  const h = host({audience: 'owner', compiledFile, bindingFile});
  const good = h.read();
  assert.equal(good.prefix, compiled.owner.prefix);
  writeFileSync(compiledFile, '{broken');
  bump(compiledFile);
  assert.deepEqual(h.read(), good);
  writeJsonAtomic(compiledFile, {...compiled, owner: {prefix: '恢复', suffix: ''}});
  bump(compiledFile, 2);
  assert.equal(h.read().prefix, '恢复');
});

test('a file that is broken from the start gives the neutral persona', () => {
  const {compiledFile, bindingFile} = fixture();
  writeFileSync(compiledFile, '{broken');
  assert.deepEqual(host({audience: 'owner', compiledFile, bindingFile}).read(), NEUTRAL);
});

test('a foreign character id is refused', () => {
  const {compiledFile, bindingFile, read} = fixture();
  writeJsonAtomic(compiledFile, {...read(), characterId: 'someone-else'});
  assert.deepEqual(host({audience: 'owner', compiledFile, bindingFile}).read(), NEUTRAL);
});

test('missing target directory gives the neutral persona without throwing', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'runtime-persona-gone-')), 'character-current');
  const compiledFile = join(dir, 'compiled.json'), bindingFile = join(dir, 'binding.json');
  assert.deepEqual(host({audience: 'owner', compiledFile, bindingFile}).read(), NEUTRAL);
  assert.deepEqual(personaState(compiledFile, bindingFile).read(), {source: 'neutral'});
});

test('personaState reports the source and the compiled data', () => {
  const {compiledFile, bindingFile, read} = fixture();
  assert.deepEqual(personaState(compiledFile, bindingFile).read(), {source: 'compiled', compiled: read()});
});

test('leftover temporary files are never read', () => {
  const {dir, compiledFile, bindingFile, read} = fixture();
  const compiled = read();
  writeFileSync(join(dir, `compiled.json.${process.pid}.tmp`), JSON.stringify({...compiled, owner: {prefix: '临时', suffix: ''}}));
  assert.equal(host({audience: 'owner', compiledFile, bindingFile}).read().prefix, compiled.owner.prefix);
});

test('a binding that appears later is picked up', () => {
  const {compiledFile, bindingFile, read} = fixture();
  rmSync(bindingFile);
  const h = host({audience: 'owner', compiledFile, bindingFile});
  assert.deepEqual(h.read(), NEUTRAL);
  writeFileSync(bindingFile, JSON.stringify({characterId}));
  assert.equal(h.read().prefix, read().owner.prefix);
});

test('audience and paths are validated', () => {
  const {compiledFile, bindingFile} = fixture();
  assert.throws(() => host({audience: 'guest', compiledFile, bindingFile}), /audience/);
  assert.throws(() => host({audience: 'owner', compiledFile: 'relative.json', bindingFile}), /compiledFile/);
  assert.throws(() => host({audience: 'owner', compiledFile}), /bindingFile/);
});
