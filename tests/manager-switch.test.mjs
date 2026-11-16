import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import {beginUpload, appendUpload, importCharacter, characterDir} from '../packages/character-manager/registry.mjs';
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
  for (const id of ['cur', ...targets]) importCard(root, id);
  writeFileSync(join(characterDir(root, 'cur'), 'binding.json'), JSON.stringify({...IDENTITY, characterId: 'cur'}));
  writeFileSync(join(characterDir(root, 'cur'), 'conversations.json'), JSON.stringify({sessionIds: {k: 'old-session'}, overrides: {}, presets: {}, lifecycle: {}}));
  symlinkSync(characterDir(root, 'cur'), join(root, 'character-current'), 'junction');
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

test('prepares only missing files', () => {
  const f = fixture();
  const next = characterDir(f.root, 'next');
  writeFileSync(join(next, 'conversations.json'), '{"keep":"me"}');
  const request = requestSwitch(f.options());
  assert.equal(readFileSync(join(next, 'conversations.json'), 'utf8'), '{"keep":"me"}');

  const other = fixture({targets: ['fresh']});
  requestSwitch(other.options('fresh'));
  const fresh = JSON.parse(readFileSync(join(characterDir(other.root, 'fresh'), 'conversations.json'), 'utf8'));
  assert.deepEqual(Object.keys(fresh.sessionIds), ['qqbot:app-1:c2c:owner-1']);
  const [sessionId] = Object.values(fresh.sessionIds);
  assert.match(sessionId, /^[0-9a-f-]{36}$/);
  assert.notEqual(sessionId, 'old-session');
  assert.deepEqual([fresh.overrides, fresh.presets, fresh.lifecycle], [{}, {}, {}]);
  assert.equal(request.target, 'next');
});

test('binding copies identity but not the character', () => {
  const f = fixture();
  requestSwitch(f.options());
  assert.deepEqual(JSON.parse(readFileSync(join(characterDir(f.root, 'next'), 'binding.json'), 'utf8')), {...IDENTITY, characterId: 'next'});

  const full = fixture();
  writeFileSync(join(characterDir(full.root, 'next'), 'binding.json'), JSON.stringify({appId: 'x', ownerId: 'y', projectId: 'z', characterId: 'next'}));
  requestSwitch(full.options());
  assert.equal(JSON.parse(readFileSync(join(characterDir(full.root, 'next'), 'binding.json'), 'utf8')).appId, 'x');
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
