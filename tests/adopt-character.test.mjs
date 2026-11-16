// scripts/adopt-character.cjs brings an existing character directory (the old
// layout data/character-<id>, in use by a running Host) under the manager:
// it only adds files, registers the directory and links character-current.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {readRegistry, currentId} from '../packages/character-manager/registry.mjs';
import {readCompiled} from '../packages/character-manager/compiled.mjs';
import {ensureCompiled, readSettings} from '../packages/character-manager/compile.mjs';

const root = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(root, 'scripts', 'adopt-character.cjs');
const BINDING = {appId: 'app-1', ownerId: 'owner-1', projectId: 'project-1', characterId: 'yuha'};
const {parseOptions, loadModules, adopt: adoptInProcess} = createRequire(import.meta.url)(SCRIPT);
const ADDED = ['card.json', 'character.json', 'compiled.json', 'reminder.md', 'rules.md'];

function fixture({binding = BINDING, dirName = 'character-yuha'} = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-character-'));
  const data = path.join(base, 'data');
  const dir = path.join(data, dirName);
  fs.mkdirSync(dir, {recursive: true});
  if (binding) fs.writeFileSync(path.join(dir, 'binding.json'), JSON.stringify(binding));
  fs.writeFileSync(path.join(dir, 'memory.sqlite'), Buffer.from([0x53, 0x51, 0x4c, 0x00, 0xff, 0x01]));
  fs.writeFileSync(path.join(dir, 'conversations.json'), '{"sessionIds":{}}');
  const source = path.join(base, 'source');
  fs.mkdirSync(source);
  const card = {spec: 'chara_card_v3', spec_version: '3.0', data: {name: 'Yuha', description: 'Yuha 认识 {{user}} 很久了。', personality: '安静'}};
  const files = {
    card: path.join(source, 'yuha.json'),
    rules: path.join(source, 'rules.md'),
    reminder: path.join(source, 'reminder.md'),
  };
  fs.writeFileSync(files.card, JSON.stringify(card));
  fs.writeFileSync(files.rules, '# 规则\n回复简短。\n');
  fs.writeFileSync(files.reminder, '保持角色口吻。\n');
  return {base, data, dir, files, cleanup: () => fs.rmSync(base, {recursive: true, force: true})};
}

function argsFor(f, extra = []) {
  return ['--root', f.data, '--id', 'yuha', '--dir', f.dir, '--card', f.files.card, '--rules', f.files.rules,
    '--reminder', f.files.reminder, '--user-name', '阿澄', '--hang-on-text', '稍等，我在想。', ...extra];
}

function adopt(f, extra = []) {
  return spawnSync(process.execPath, [SCRIPT, ...argsFor(f, extra)], {cwd: root, encoding: 'utf8', windowsHide: true});
}

// Everything adoption may touch: the character directory, registry.json, the characters directory and the link.
function state(f) {
  const registry = path.join(f.data, 'characters', 'registry.json');
  const link = path.join(f.data, 'character-current');
  return {
    dir: snapshot(f.dir),
    registry: fs.existsSync(registry) ? fs.readFileSync(registry, 'utf8') : null,
    characters: fs.existsSync(path.join(f.data, 'characters')),
    link: fs.existsSync(link) || (() => { try { fs.lstatSync(link); return true; } catch { return false; } })(),
  };
}

function snapshot(dir) {
  return Object.fromEntries(fs.readdirSync(dir).sort().map(name => [name, fs.readFileSync(path.join(dir, name))]));
}

test('adoption adds the manager files, registers the directory and links character-current', () => {
  const f = fixture();
  try {
    const before = snapshot(f.dir);
    const result = adopt(f, ['--link']);
    assert.equal(result.status, 0, result.stderr);

    const after = snapshot(f.dir);
    for (const [name, bytes] of Object.entries(before)) assert(after[name].equals(bytes), `${name} must stay byte for byte`);
    assert.deepEqual(Object.keys(after).filter(name => !(name in before)).sort(), ADDED);
    assert(after['card.json'].equals(fs.readFileSync(f.files.card)));
    assert(after['rules.md'].equals(fs.readFileSync(f.files.rules)));
    assert(after['reminder.md'].equals(fs.readFileSync(f.files.reminder)));

    const settings = readSettings(f.dir);
    assert.equal(settings.userName, '阿澄');
    assert.equal(settings.hangOnText, '稍等，我在想。');
    const compiled = readCompiled(path.join(f.dir, 'compiled.json'), {characterId: 'yuha'});
    assert.match(compiled.owner.prefix, /阿澄/);
    assert.equal(compiled.public, undefined, 'the public version waits for the Owner');
    assert(compiled.pendingPublic);
    const parseYaml = () => assert.fail('a JSON card needs no YAML');
    assert.deepEqual(ensureCompiled({dir: f.dir, characterId: 'yuha', parseYaml}), compiled, 'compiled.json is current');

    const {characters} = readRegistry(f.data);
    assert.equal(characters.length, 1);
    assert.deepEqual({...characters[0], addedAt: undefined}, {id: 'yuha', dir: f.dir.replaceAll('\\', '/'), addedAt: undefined, archived: false});

    const link = path.join(f.data, 'character-current');
    assert(fs.lstatSync(link).isSymbolicLink());
    assert(fs.readFileSync(path.join(link, 'memory.sqlite')).equals(before['memory.sqlite']));
    assert.equal(currentId(f.data), 'yuha');

    const current = `${f.data.replaceAll('\\', '/')}/character-current`;
    assert.match(result.stdout, /character-identity/);
    for (const key of ['presetId', 'memoryMode']) assert.match(result.stdout, new RegExp(`${key}: `));
    assert(result.stdout.includes(`bindingFile: ${current}/binding.json`), result.stdout);
    assert(result.stdout.includes(`stateFile: ${current}/coordination.sqlite`), result.stdout);
  } finally {
    f.cleanup();
  }
});

test('running it again is refused and changes nothing', () => {
  const f = fixture();
  try {
    assert.equal(adopt(f, ['--link']).status, 0);
    const registry = fs.readFileSync(path.join(f.data, 'characters', 'registry.json'));
    const files = snapshot(f.dir);
    const again = adopt(f, ['--link']);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /接入失败/);
    assert(fs.readFileSync(path.join(f.data, 'characters', 'registry.json')).equals(registry));
    assert.deepEqual(snapshot(f.dir), files);
    assert.equal(currentId(f.data), 'yuha');
  } finally {
    f.cleanup();
  }
});

test('an existing character-current link is refused before anything is written', () => {
  const f = fixture();
  try {
    const other = path.join(f.data, 'elsewhere');
    fs.mkdirSync(other);
    fs.symlinkSync(other, path.join(f.data, 'character-current'), 'junction');
    const before = snapshot(f.dir);
    const result = adopt(f, ['--link']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /character-current/);
    assert.deepEqual(snapshot(f.dir), before);
    assert.equal(fs.existsSync(path.join(f.data, 'characters', 'registry.json')), false);
  } finally {
    f.cleanup();
  }
});

test('without --link nothing is linked', () => {
  const f = fixture();
  try {
    assert.equal(adopt(f).status, 0);
    assert.equal(fs.existsSync(path.join(f.data, 'character-current')), false);
    assert.equal(readRegistry(f.data).characters.length, 1);
  } finally {
    f.cleanup();
  }
});

test('a directory without binding.json, or with an incomplete one, is refused', () => {
  for (const binding of [null, {characterId: 'yuha'}, {...BINDING, characterId: 'other'}]) {
    const f = fixture({binding});
    try {
      const before = snapshot(f.dir);
      const result = adopt(f, ['--link']);
      assert.equal(result.status, 1, JSON.stringify(binding));
      assert.match(result.stderr, /binding\.json/);
      assert.deepEqual(snapshot(f.dir), before);
      assert.equal(fs.existsSync(path.join(f.data, 'characters', 'registry.json')), false);
      assert.equal(fs.existsSync(path.join(f.data, 'character-current')), false);
    } finally {
      f.cleanup();
    }
  }
});

test('a different file of the same name is refused; an identical one is kept', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.dir, 'rules.md'), '旧规则\n');
    const before = snapshot(f.dir);
    const refused = adopt(f);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /rules\.md/);
    assert.deepEqual(snapshot(f.dir), before);

    fs.copyFileSync(f.files.rules, path.join(f.dir, 'rules.md'));
    assert.equal(adopt(f).status, 0);
    assert(fs.readFileSync(path.join(f.dir, 'rules.md')).equals(fs.readFileSync(f.files.rules)));
  } finally {
    f.cleanup();
  }
});

test('a card that does not compile leaves the directory and the registry untouched', () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.files.card, JSON.stringify({spec: 'chara_card_v3', spec_version: '3.0', data: {name: 'Yuha', description: '字'.repeat(14000)}}));
    const before = snapshot(f.dir);
    const result = adopt(f, ['--link']);
    assert.equal(result.status, 1);
    assert.deepEqual(snapshot(f.dir), before);
    assert.equal(fs.existsSync(path.join(f.data, 'characters', 'registry.json')), false);
    assert.equal(fs.existsSync(path.join(f.data, 'character-current')), false);
  } finally {
    f.cleanup();
  }
});

test('a directory outside the allowed locations, or a link, is refused before anything is written', () => {
  const misplaced = fixture({dirName: 'elsewhere/yuha'});
  try {
    // A card that does not compile as well: the location is refused first, before any compile or write.
    fs.writeFileSync(misplaced.files.card, JSON.stringify({spec: 'chara_card_v3', spec_version: '3.0', data: {name: 'Yuha', description: '字'.repeat(14000)}}));
    const before = state(misplaced);
    const result = adopt(misplaced, ['--link']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /不在允许的位置/);
    assert.deepEqual(state(misplaced), before);
  } finally {
    misplaced.cleanup();
  }
  const linked = fixture({dirName: 'stash/character-yuha'});
  try {
    const junction = path.join(linked.data, 'character-yuha');
    fs.symlinkSync(linked.dir, junction, 'junction');
    const real = snapshot(linked.dir);
    const result = adopt({...linked, dir: junction}, ['--link']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /不是普通目录/);
    assert.deepEqual(snapshot(linked.dir), real);
    assert.equal(fs.existsSync(path.join(linked.data, 'characters')), false);
    assert.equal(fs.existsSync(path.join(linked.data, 'character-current')), false);
  } finally {
    linked.cleanup();
  }
});

test('a failure in register undoes the files already written', async () => {
  const f = fixture();
  try {
    const before = state(f);
    const modules = await loadModules();
    const registry = {...modules.registry, register: () => { throw new Error('injected register failure'); }};
    assert.throws(() => adoptInProcess(parseOptions(argsFor(f, ['--link'])), {...modules, registry}), /injected register failure/);
    assert.deepEqual(state(f), before);
  } finally {
    f.cleanup();
  }
});

test('a failed link undoes the registration and the files, and a re-run then succeeds', async () => {
  const f = fixture();
  try {
    // Another character already registered: registry.json must come back byte for byte.
    const other = path.join(f.data, 'characters', 'other');
    fs.mkdirSync(other, {recursive: true});
    fs.writeFileSync(path.join(other, 'binding.json'), JSON.stringify({...BINDING, characterId: 'other'}));
    const modules = await loadModules();
    modules.registry.register(f.data, {id: 'other', dir: other});
    const before = state(f);
    const failing = {...modules, link: () => { throw new Error('injected link failure'); }};
    assert.throws(() => adoptInProcess(parseOptions(argsFor(f, ['--link'])), failing), /injected link failure/);
    assert.deepEqual(state(f), before);

    // A link that points elsewhere after creation is removed again (and only that link).
    const elsewhere = path.join(f.data, 'elsewhere');
    fs.mkdirSync(elsewhere);
    const wrong = {...modules, link: (target, file) => fs.symlinkSync(elsewhere, file, 'junction')};
    assert.throws(() => adoptInProcess(parseOptions(argsFor(f, ['--link'])), wrong), /没有指向 yuha/);
    assert.deepEqual(state(f), before);
    assert(fs.existsSync(elsewhere), 'the link target itself is untouched');

    assert.equal(adopt(f, ['--link']).status, 0);
    assert.equal(currentId(f.data), 'yuha');
    assert.deepEqual(readRegistry(f.data).characters.map(entry => entry.id), ['other', 'yuha']);
  } finally {
    f.cleanup();
  }
});

test('a failure with no registry before leaves no registry or characters directory behind', async () => {
  const f = fixture();
  try {
    const before = state(f);
    assert.equal(before.registry, null);
    const modules = await loadModules();
    assert.throws(() => adoptInProcess(parseOptions(argsFor(f, ['--link'])), {...modules, link: () => { throw new Error('injected'); }}), /injected/);
    assert.deepEqual(state(f), before);
  } finally {
    f.cleanup();
  }
});

test('missing options print the usage', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--id', 'yuha'], {cwd: root, encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /用法/);
});
