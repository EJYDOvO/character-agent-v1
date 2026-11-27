import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import {beginUpload, appendUpload, importCharacter, characterDir, archiveCharacter} from '../packages/character-manager/registry.mjs';
import {
  REQUEST_FILE, INPROGRESS_FILE, RESULT_FILE, HISTORY_FILE, MAX_SWITCHES_PER_HOUR, WATCHDOG_STALE_MS,
  watchdogReady, prepareTarget, requestSwitch, switchStatus,
} from '../packages/character-manager/switch.mjs';

const CARD = {spec: 'chara_card_v3', spec_version: '3.0', data: {name: '小夜', description: '一个人。', personality: '', scenario: '', mes_example: ''}};
const IDENTITY = {appId: 'app-1', ownerId: 'owner-1', projectId: 'personal'};
const NOW = Date.parse('2026-11-16T10:00:00Z');
const roots = [];
test.after(() => roots.forEach(root => rmSync(root, {recursive: true, force: true})));

function importCard(root, id) {
  const uploadId = beginUpload(root);
  appendUpload(root, uploadId, 0, Buffer.from(JSON.stringify(CARD)).toString('base64'));
  importCharacter(root, {uploadId, id, parseYaml: text => yaml.load(text)});
}

// <root> is the data directory; character `cur` is current, the others are registered targets.
function fixture({watchdog = true, checkedAgo = 30000, targets = ['next']} = {}) {
  const base = mkdtempSync(join(tmpdir(), 'manager-switch-'));
  roots.push(base);
  const root = join(base, 'data');
  const maintenanceDirectory = join(root, 'maintenance');
  mkdirSync(maintenanceDirectory, {recursive: true});
  importCard(root, 'cur');
  writeFileSync(join(characterDir(root, 'cur'), 'binding.json'), JSON.stringify({...IDENTITY, characterId: 'cur'}));
  writeFileSync(join(characterDir(root, 'cur'), 'conversations.json'), JSON.stringify({sessionIds: {k: 'old-session'}, overrides: {}, presets: {}, lifecycle: {}}));
  symlinkSync(characterDir(root, 'cur'), join(root, 'character-current'), 'junction');
  for (const id of targets) importCard(root, id); // imported with a current character: the binding gets its identity
  const featuresFile = join(base, 'features.json');
  writeFileSync(featuresFile, JSON.stringify({watchdog: {enabled: watchdog, maxStartsPerHour: 3}}));
  writeFileSync(join(maintenanceDirectory, 'watchdog-state.json'), JSON.stringify({checkedAt: new Date(NOW - checkedAgo).toISOString()}));
  const options = (target = 'next', now = NOW) => ({root, maintenanceDirectory, featuresFile, target, now});
  const file = name => join(maintenanceDirectory, name);
  return {root, maintenanceDirectory, featuresFile, options, file};
}

function snapshot(dir) {
  return readdirSync(dir).sort().map(name => [name, statSync(join(dir, name)).mtimeMs, readFileSync(join(dir, name), 'utf8')]);
}

test('constants are the spec values', () => {
  assert.deepEqual([REQUEST_FILE, INPROGRESS_FILE, RESULT_FILE, HISTORY_FILE],
    ['character-switch.json', 'character-switch.inprogress.json', 'character-switch-result.json', 'character-switch-history.json']);
  assert.equal(MAX_SWITCHES_PER_HOUR, 4);
  assert.equal(WATCHDOG_STALE_MS, 120000);
});

test('watchdog must be running', () => {
  const disabled = fixture({watchdog: false});
  assert.equal(watchdogReady({...disabled, now: NOW}).ok, false);
  assert.throws(() => requestSwitch(disabled.options()), /watchdog/);
  assert.equal(existsSync(disabled.file(REQUEST_FILE)), false);

  const stale = fixture({checkedAgo: 3 * 60 * 1000});
  assert.deepEqual(watchdogReady({...stale, now: NOW}).ok, false);
  assert.throws(() => requestSwitch(stale.options()), /watchdog/);
  assert.equal(existsSync(stale.file(REQUEST_FILE)), false);
  assert.equal(existsSync(stale.file(HISTORY_FILE)), false);

  assert.deepEqual(watchdogReady({...fixture(), now: NOW}), {ok: true});
  assert.equal(watchdogReady({...fixture({checkedAgo: 119000}), now: NOW}).ok, true);
  const missing = fixture();
  rmSync(missing.file('watchdog-state.json'));
  assert.equal(watchdogReady({...missing, now: NOW}).ok, false);
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNER_KEY = 'qqbot:app-1:c2c:owner-1';
const conversationsOf = (root, id) => JSON.parse(readFileSync(join(characterDir(root, id), 'conversations.json'), 'utf8'));

test('prepares only missing files and keys', () => {
  const f = fixture();
  const next = characterDir(f.root, 'next');
  writeFileSync(join(next, 'conversations.json'), '{"keep":"me"}');
  const request = requestSwitch(f.options());
  const kept = conversationsOf(f.root, 'next');
  assert.equal(kept.keep, 'me', 'other content of the file stays');
  assert.deepEqual(Object.keys(kept.sessionIds).sort(), ['k', OWNER_KEY]);

  const other = fixture({targets: ['fresh']});
  requestSwitch(other.options('fresh'));
  const fresh = conversationsOf(other.root, 'fresh');
  // The Owner and every key the current character knows ('k') get a new Session.
  assert.deepEqual(Object.keys(fresh.sessionIds).sort(), ['k', OWNER_KEY]);
  for (const sessionId of Object.values(fresh.sessionIds)) {
    assert.match(sessionId, UUID);
    assert.notEqual(sessionId, 'old-session');
  }
  assert.notEqual(fresh.sessionIds.k, fresh.sessionIds[OWNER_KEY]);
  assert.deepEqual([fresh.overrides, fresh.presets, fresh.lifecycle], [{}, {}, {}]);
  assert.equal(request.target, 'next');
});

test('every key a registered character knows gets a fresh Session in the target; existing ones are untouched', () => {
  const f = fixture({targets: ['next', 'other', 'gone']});
  const write = (id, value) => writeFileSync(join(characterDir(f.root, id), 'conversations.json'), JSON.stringify(value));
  const lifecycle = {lastUserAt: 1, bootId: 'boot'};
  write('other', {sessionIds: {'s-other': 'other-1'}, lifecycle: {'l-other': lifecycle}, presets: {'p-other': 'character'}, overrides: {'o-other': {provider: 'p', model: 'm'}}});
  write('gone', {sessionIds: {'s-archived': 'gone-1'}, overrides: {}, presets: {}, lifecycle: {}});
  archiveCharacter(f.root, 'gone'); // archived characters' Sessions are still in the shared store
  const own = {sessionIds: {k: 'next-own', 's-other': 'next-s'}, lifecycle: {'l-next': lifecycle}, presets: {'p-next': 'character-guest'}, overrides: {}, extra: {kept: true}};
  write('next', own);

  requestSwitch(f.options());
  const next = conversationsOf(f.root, 'next');
  const added = ['l-next', 'l-other', 'o-other', 'p-next', 'p-other', 's-archived', OWNER_KEY];
  assert.deepEqual(Object.keys(next.sessionIds).sort(), ['k', 's-other', ...added].sort());
  assert.equal(next.sessionIds.k, 'next-own', 'an existing Session ID is kept');
  assert.equal(next.sessionIds['s-other'], 'next-s', 'an existing Session ID is kept');
  const fresh = added.map(key => next.sessionIds[key]);
  assert(fresh.every(id => UUID.test(id)), 'fresh ids are random UUIDs');
  assert.equal(new Set(fresh).size, fresh.length, 'one Session per key');
  assert.deepEqual([next.lifecycle, next.presets, next.overrides, next.extra], [own.lifecycle, own.presets, own.overrides, own.extra]);

  // Preparing again changes nothing.
  const file = join(characterDir(f.root, 'next'), 'conversations.json');
  const before = [readFileSync(file, 'utf8'), statSync(file).mtimeMs];
  prepareTarget({root: f.root, target: 'next', current: 'cur'});
  assert.deepEqual([readFileSync(file, 'utf8'), statSync(file).mtimeMs], before);
  // Nothing of the other characters is written.
  assert.deepEqual(conversationsOf(f.root, 'other').sessionIds, {'s-other': 'other-1'});
});

// Conversation Manager derives the Session id of an unrecorded key from the
// key and the state file's sessionNamespace; with the Character id there, no
// key can resume another Character's Session, recorded or not.
test('the target gets its own session namespace; the current character is not written', () => {
  const f = fixture({targets: ['next', 'fresh']});
  const current = join(characterDir(f.root, 'cur'), 'conversations.json'), before = readFileSync(current, 'utf8');
  writeFileSync(join(characterDir(f.root, 'next'), 'conversations.json'), JSON.stringify({sessionIds: {[OWNER_KEY]: 'kept'}, overrides: {}, presets: {}, lifecycle: {}}));
  requestSwitch(f.options('next'));
  const next = conversationsOf(f.root, 'next');
  assert.equal(next.sessionNamespace, 'next', 'added to a file that has every key already');
  assert.equal(next.sessionIds[OWNER_KEY], 'kept');
  assert.equal(readFileSync(current, 'utf8'), before, 'the running character\'s file is never written');

  const g = fixture({targets: ['fresh']});
  requestSwitch(g.options('fresh'));
  assert.equal(conversationsOf(g.root, 'fresh').sessionNamespace, 'fresh', 'a new file carries it');
});

test('a target whose namespace names another character refuses the switch', () => {
  const f = fixture();
  const file = join(characterDir(f.root, 'next'), 'conversations.json');
  const copied = JSON.stringify({sessionNamespace: 'cur', sessionIds: {}, overrides: {}, presets: {}, lifecycle: {}});
  writeFileSync(file, copied);
  assert.throws(() => requestSwitch(f.options()), /sessionNamespace/);
  assert.equal(readFileSync(file, 'utf8'), copied);
  assert.equal(existsSync(f.file(REQUEST_FILE)), false);
});

test('switching back keeps the original role’s derived routes and an existing namespace’s derived routes', () => {
  const f = fixture();
  const originalFile = join(characterDir(f.root, 'cur'), 'conversations.json');
  const original = readFileSync(originalFile, 'utf8');
  prepareTarget({root: f.root, target: 'next', current: 'cur'});
  assert.equal(conversationsOf(f.root, 'next').sessionNamespace, 'next');

  // A visitor who started on A by derivation may later have a recorded route on B.
  const nextFile = join(characterDir(f.root, 'next'), 'conversations.json');
  const next = conversationsOf(f.root, 'next');
  next.sessionIds.visitor = 'next-explicit';
  writeFileSync(nextFile, JSON.stringify(next));
  prepareTarget({root: f.root, target: 'cur', current: 'next'});
  assert.equal(readFileSync(originalFile, 'utf8'), original, 'A keeps all explicit and implicit routes');

  // A visitor who started on B by derivation must stay on that route after A records a route of its own.
  const updated = conversationsOf(f.root, 'cur');
  updated.sessionIds['other-visitor'] = 'cur-explicit';
  writeFileSync(originalFile, JSON.stringify(updated));
  const before = readFileSync(nextFile, 'utf8');
  prepareTarget({root: f.root, target: 'next', current: 'cur'});
  assert.equal(readFileSync(nextFile, 'utf8'), before, 'B keeps all explicit and implicit routes');
});

test('an older installation already on a namespaced role keeps the old-layout role’s legacy routes', () => {
  const f = fixture();
  const legacy = join(f.root, 'character-cur');
  renameSync(characterDir(f.root, 'cur'), legacy);
  const registryFile = join(f.root, 'characters', 'registry.json');
  const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
  registry.characters.find(entry => entry.id === 'cur').dir = legacy;
  writeFileSync(registryFile, JSON.stringify(registry));
  writeFileSync(join(characterDir(f.root, 'next'), 'conversations.json'), '{"sessionNamespace":"next"}');
  const original = readFileSync(join(legacy, 'conversations.json'), 'utf8');
  prepareTarget({root: f.root, target: 'cur', current: 'next'});
  assert.equal(readFileSync(join(legacy, 'conversations.json'), 'utf8'), original);
  assert.equal(JSON.parse(readFileSync(registryFile, 'utf8')).legacySessionOwner, 'cur');
});

test('the original role can be recovered from its previous Host record in the standard layout', () => {
  const f = fixture({targets: ['next', 'unused']});
  const originalDir = characterDir(f.root, 'cur');
  const originalFile = join(originalDir, 'conversations.json');
  const original = readFileSync(originalFile, 'utf8');
  writeFileSync(join(originalDir, 'runtime-health.json'), JSON.stringify({characterId: 'cur', pid: 42, at: NOW, personaSource: 'compiled'}));
  writeFileSync(join(characterDir(f.root, 'next'), 'conversations.json'), '{"sessionNamespace":"next"}');
  prepareTarget({root: f.root, target: 'cur', current: 'next'});
  assert.equal(readFileSync(originalFile, 'utf8'), original);
});

test('an unreadable conversations.json refuses the switch', () => {
  for (const [where, content] of [['other', '{broken'], ['next', '{broken'], ['next', '{"sessionIds":[]}'], ['other', '{"sessionNamespace":5}']]) {
    const f = fixture({targets: ['next', 'other']});
    const file = join(characterDir(f.root, where), 'conversations.json');
    writeFileSync(file, content);
    assert.throws(() => requestSwitch(f.options()), /conversations\.json/, `${where}: ${content}`);
    assert.equal(existsSync(f.file(REQUEST_FILE)), false);
    assert.equal(readFileSync(file, 'utf8'), content);
    if (where === 'other') assert.equal(existsSync(join(characterDir(f.root, 'next'), 'conversations.json')), false);
  }
});

test('a conversations.json with a byte order mark is read', () => {
  const f = fixture();
  writeFileSync(join(characterDir(f.root, 'cur'), 'conversations.json'), `\uFEFF${JSON.stringify({sessionIds: {bom: 'x'}})}`);
  requestSwitch(f.options());
  assert.deepEqual(Object.keys(conversationsOf(f.root, 'next').sessionIds).sort(), ['bom', OWNER_KEY]);
});

test('binding copies identity but not the character', () => {
  const f = fixture();
  assert.deepEqual(JSON.parse(readFileSync(join(characterDir(f.root, 'next'), 'binding.json'), 'utf8')), {...IDENTITY, characterId: 'next'});
  requestSwitch(f.options());
  assert.deepEqual(JSON.parse(readFileSync(join(characterDir(f.root, 'next'), 'binding.json'), 'utf8')), {...IDENTITY, characterId: 'next'});

  // A complete binding is never rewritten; one without identity makes the target unswitchable.
  const full = fixture();
  const file = join(characterDir(full.root, 'next'), 'binding.json');
  writeFileSync(file, JSON.stringify({appId: 'x', ownerId: 'y', projectId: 'z', characterId: 'next'}));
  const before = [readFileSync(file, 'utf8'), statSync(file).mtimeMs];
  requestSwitch(full.options());
  assert.deepEqual([readFileSync(file, 'utf8'), statSync(file).mtimeMs], before);

  const bare = fixture();
  writeFileSync(join(characterDir(bare.root, 'next'), 'binding.json'), JSON.stringify({characterId: 'next'}));
  assert.throws(() => requestSwitch(bare.options()), /缺少身份信息/);
  assert.equal(existsSync(bare.file(REQUEST_FILE)), false);
  assert.equal(existsSync(join(characterDir(bare.root, 'next'), 'conversations.json')), false);
});

test('current character files are untouched', () => {
  const f = fixture();
  const before = snapshot(characterDir(f.root, 'cur'));
  requestSwitch(f.options());
  assert.deepEqual(snapshot(characterDir(f.root, 'cur')), before);
});

test('the request has the shape the watchdog expects', () => {
  const f = fixture();
  const request = requestSwitch(f.options());
  assert.deepEqual(Object.keys(request).sort(), ['nonce', 'previous', 'requestedAt', 'target']);
  assert.equal(request.previous, 'cur');
  assert.equal(request.requestedAt, NOW);
  assert.equal(typeof request.nonce, 'string');
  assert.deepEqual(JSON.parse(readFileSync(f.file(REQUEST_FILE), 'utf8')), request);
  assert.deepEqual(readdirSync(f.maintenanceDirectory).filter(name => name.endsWith('.tmp')), []);
});

test('one pending request at a time', () => {
  const f = fixture({targets: ['next', 'other']});
  requestSwitch(f.options());
  assert.throws(() => requestSwitch(f.options('other')), /尚未处理/);
  renameSync(f.file(REQUEST_FILE), f.file(INPROGRESS_FILE));
  assert.throws(() => requestSwitch(f.options('other')), /尚未处理/);
  rmSync(f.file(INPROGRESS_FILE));
  requestSwitch(f.options('other'));
});

test('four per hour', () => {
  const f = fixture();
  for (let n = 0; n < 4; n += 1) {
    requestSwitch(f.options('next', NOW + n * 1000));
    rmSync(f.file(REQUEST_FILE));
  }
  assert.throws(() => requestSwitch(f.options('next', NOW + 5000)), /每小时/);
  assert.equal(existsSync(f.file(REQUEST_FILE)), false);
  // The oldest request is an hour old (and the watchdog has checked in since).
  writeFileSync(f.file('watchdog-state.json'), JSON.stringify({checkedAt: new Date(NOW + 60 * 60 * 1000).toISOString()}));
  requestSwitch(f.options('next', NOW + 60 * 60 * 1000 + 1));
  assert.equal(existsSync(f.file(REQUEST_FILE)), true);
});

test('requests older than an hour do not count', () => {
  const f = fixture();
  writeFileSync(f.file(HISTORY_FILE), JSON.stringify(Array.from({length: 4}, () => ({at: NOW - 2 * 60 * 60 * 1000, target: 'next'}))));
  requestSwitch(f.options());
  assert.equal(JSON.parse(readFileSync(f.file(HISTORY_FILE), 'utf8')).length, 5);
});

test('targets are checked', () => {
  const f = fixture();
  assert.throws(() => requestSwitch(f.options('cur')), /当前角色/);
  assert.throws(() => requestSwitch(f.options('nobody')), /未注册/);
  assert.throws(() => requestSwitch(f.options('current')), /./);
  assert.equal(existsSync(f.file(REQUEST_FILE)), false);
});

test('invalid compiled target is refused', () => {
  const f = fixture();
  const compiled = join(characterDir(f.root, 'next'), 'compiled.json');
  const good = JSON.parse(readFileSync(compiled, 'utf8'));
  writeFileSync(compiled, JSON.stringify({...good, reminder: '含有 {{user}} 的提醒'}));
  assert.throws(() => requestSwitch(f.options()), /资料不可用/);
  writeFileSync(compiled, '{broken');
  assert.throws(() => requestSwitch(f.options()), /资料不可用/);
  rmSync(compiled);
  assert.throws(() => requestSwitch(f.options()), /资料不可用/);
  assert.equal(existsSync(f.file(REQUEST_FILE)), false);
  assert.equal(existsSync(join(characterDir(f.root, 'next'), 'conversations.json')), false);
});

test('switchStatus reports pending, in progress and the result', () => {
  const f = fixture();
  assert.deepEqual(switchStatus(f), {pending: null, inProgress: false, result: null});
  const request = requestSwitch(f.options());
  assert.deepEqual(switchStatus(f), {pending: request, inProgress: false, result: null});

  renameSync(f.file(REQUEST_FILE), f.file(INPROGRESS_FILE));
  assert.deepEqual(switchStatus(f), {pending: request, inProgress: true, result: null});

  // Both files at once (a new request next to a dead run's snapshot): in progress wins.
  writeFileSync(f.file(REQUEST_FILE), JSON.stringify({...request, nonce: 'newer'}));
  assert.equal(switchStatus(f).pending.nonce, request.nonce);
  rmSync(f.file(REQUEST_FILE));
  rmSync(f.file(INPROGRESS_FILE));

  writeFileSync(f.file(RESULT_FILE), JSON.stringify({ok: false, target: 'next', reason: 'expired', surprise: 1, at: NOW}));
  assert.deepEqual(switchStatus(f).result, {ok: false, target: 'next', reason: 'expired', surprise: 1, at: NOW});
  writeFileSync(f.file(RESULT_FILE), '{"ok":tru');
  writeFileSync(f.file(REQUEST_FILE), '[1]');
  assert.deepEqual(switchStatus(f), {pending: null, inProgress: false, result: null});
});

test('prepareTarget is also usable on its own and needs a complete current binding', () => {
  const f = fixture();
  prepareTarget({root: f.root, target: 'next', current: 'cur'});
  assert.equal(existsSync(join(characterDir(f.root, 'next'), 'conversations.json')), true);
  writeFileSync(join(characterDir(f.root, 'cur'), 'binding.json'), JSON.stringify({characterId: 'cur'}));
  const g = fixture();
  writeFileSync(join(characterDir(g.root, 'cur'), 'binding.json'), JSON.stringify({characterId: 'cur'}));
  assert.throws(() => prepareTarget({root: g.root, target: 'next', current: 'cur'}), /binding\.json/);
});
