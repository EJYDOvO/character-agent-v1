import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import {controller} from '../packages/character-manager/controller.mjs';
import * as plugin from '../packages/character-manager/index.mjs';
import {characterDir} from '../packages/character-manager/registry.mjs';

const CARD = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {name: '小夜', description: '{{char}}是一个安静的人，常和{{user}}聊天。', personality: '', scenario: '', mes_example: '', extensions: {fav: 1}},
};
const roots = [];
test.after(() => roots.forEach(root => rmSync(root, {recursive: true, force: true})));

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'manager-controller-'));
  roots.push(base);
  const root = join(base, 'data');
  const maintenanceDirectory = join(root, 'maintenance');
  mkdirSync(maintenanceDirectory, {recursive: true});
  const featuresFile = join(base, 'features.json');
  writeFileSync(featuresFile, JSON.stringify({watchdog: {enabled: true}}));
  const profileFile = join(base, 'cordis.patch.yml');
  const api = controller({root, maintenanceDirectory, featuresFile, profileFile, parseYaml: text => yaml.load(text)});
  const importCard = (id, card = CARD) => {
    const {uploadId} = api({operation: 'uploadBegin'});
    const bytes = Buffer.from(JSON.stringify(card));
    const half = Math.floor(bytes.length / 2);
    assert.equal(api({operation: 'uploadChunk', uploadId, index: 0, data: bytes.subarray(0, half).toString('base64')}).bytes, half);
    assert.equal(api({operation: 'uploadChunk', uploadId, index: 1, data: bytes.subarray(half).toString('base64')}).bytes, bytes.length);
    return api({operation: 'import', uploadId, id});
  };
  return {base, root, maintenanceDirectory, featuresFile, profileFile, api, importCard};
}

function tree(dir) {
  return readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? tree(file) : [[file, statSync(file).mtimeMs, readFileSync(file, 'utf8')]];
  });
}

test('import, list, approve', () => {
  const f = fixture();
  const compiled = f.importCard('yuha');
  assert.equal(compiled.name, '小夜');
  const listed = f.api({operation: 'list'});
  assert.deepEqual(listed.characters.map(c => [c.id, c.name, c.current, c.archived, c.publicPending, c.publicApproved]), [['yuha', '小夜', false, false, true, false]]);
  assert.equal(typeof listed.characters[0].tokens, 'number');
  assert.equal(listed.characters[0].warningCount, 0);
  assert.deepEqual(listed.switch, {pending: null, inProgress: false, result: null});
  assert.deepEqual(listed.profileWarnings, []);

  const {pendingPublic} = f.api({operation: 'get', id: 'yuha'}).compiled;
  const approved = f.api({operation: 'approvePublic', id: 'yuha', hash: pendingPublic.hash});
  assert.equal(approved.public.hash, pendingPublic.hash);
  assert.equal(approved.pendingPublic, undefined);
  const after = f.api({operation: 'list'}).characters[0];
  assert.equal(after.publicPending, false);
  assert.equal(after.publicApproved, true);
  assert.throws(() => f.api({operation: 'approvePublic', id: 'yuha', hash: 'stale'}), /Public version changed/);
});

test('preview writes nothing', () => {
  const f = fixture();
  f.importCard('yuha');
  const before = tree(f.root);
  const {compiled} = f.api({operation: 'preview', id: 'yuha', draft: {rules: '新的规则。', settings: {userName: '阿宁'}}});
  assert(compiled.owner.prefix.includes('阿宁'));
  assert(compiled.owner.prefix.includes('新的规则。'));
  assert.deepEqual(tree(f.root), before);
});

test('save needs the current revision', () => {
  const f = fixture();
  f.importCard('yuha');
  const saved = f.api({operation: 'save', id: 'yuha', revision: 1, draft: {reminder: '简短回答。', settings: {nickname: '夜夜'}}});
  assert.equal(saved.revision, 2);
  assert.equal(saved.reminder, '简短回答。');
  assert.throws(() => f.api({operation: 'save', id: 'yuha', revision: 1, draft: {}}), /Revision conflict/);
  assert.throws(() => f.api({operation: 'save', id: 'yuha', draft: {}}), /revision/);
  const got = f.api({operation: 'get', id: 'yuha'});
  assert.equal(got.settings.nickname, '夜夜');
  assert.equal(got.reminder, '简短回答。');
  assert(got.rules.includes('「小夜」'));
});

test('an empty nickname clears the nickname', () => {
  const f = fixture();
  f.importCard('yuha');
  assert.equal(f.api({operation: 'save', id: 'yuha', revision: 1, draft: {settings: {nickname: '夜夜'}}}).owner.prefix.includes('夜夜'), true);
  const cleared = f.api({operation: 'save', id: 'yuha', revision: 2, draft: {settings: {nickname: ''}}});
  assert.equal(cleared.owner.prefix.includes('夜夜'), false);
  assert.equal(f.api({operation: 'get', id: 'yuha'}).settings.nickname, undefined);
});

test('a draft cannot approve the public version or set the revision', () => {
  const f = fixture();
  f.importCard('yuha');
  for (const settings of [{publicApproved: {hash: 'x', at: 'y'}}, {revision: 9}, {surprise: 1}]) {
    assert.throws(() => f.api({operation: 'save', id: 'yuha', revision: 1, draft: {settings}}), /未知项/);
    assert.throws(() => f.api({operation: 'preview', id: 'yuha', draft: {settings}}), /未知项/);
  }
  assert.throws(() => f.api({operation: 'save', id: 'yuha', revision: 1, draft: {extra: 1}}), /未知项/);
  assert.throws(() => f.api({operation: 'save', id: 'yuha', revision: 1, draft: {rules: 5}}), /文本/);
});

test('get returns no absolute path', () => {
  const f = fixture();
  f.importCard('yuha');
  const got = f.api({operation: 'get', id: 'yuha'});
  const text = JSON.stringify(got);
  for (const needle of [f.root, f.root.replace(/\\/g, '/'), JSON.stringify(f.root).slice(1, -1)]) assert(!text.includes(needle), needle);
  assert.deepEqual(got.card, {spec: 'v3', format: 'json'});
});

test('errors do not leak the data directory', () => {
  const f = fixture();
  const {uploadId} = f.api({operation: 'uploadBegin'});
  f.api({operation: 'uploadChunk', uploadId, index: 0, data: Buffer.from('{"spec":"chara_card_v3"').toString('base64')});
  let message;
  try {
    f.api({operation: 'import', uploadId, id: 'broken'});
  } catch (error) {
    message = error.message;
  }
  assert(message, 'import should fail');
  assert(message.includes('…'), message);
  assert(!message.includes(f.root) && !message.includes(f.root.replace(/\\/g, '/')), message);
});

test('export, archive and switch', () => {
  const f = fixture();
  f.importCard('yuha');
  f.importCard('tasha');
  assert.equal(f.api({operation: 'exportCard', id: 'yuha'}).data.name, '小夜');
  symlinkSync(characterDir(f.root, 'yuha'), join(f.root, 'character-current'), 'junction');
  assert.equal(f.api({operation: 'list'}).characters.find(c => c.id === 'yuha').current, true);
  assert.throws(() => f.api({operation: 'archive', id: 'yuha'}), /当前/);
  assert.throws(() => f.api({operation: 'switch', id: 'tasha'}), /watchdog/);
  assert.deepEqual(f.api({operation: 'archive', id: 'tasha'}), {ok: true});
  const archived = f.api({operation: 'list'}).characters.find(c => c.id === 'tasha');
  assert.equal(archived.archived, true);
  assert.deepEqual(f.api({operation: 'switchStatus'}), {pending: null, inProgress: false, result: null});
});

test('one broken character does not fail the list', () => {
  const f = fixture();
  f.importCard('good');
  f.importCard('bad');
  rmSync(join(characterDir(f.root, 'bad'), 'card.json'));
  const listed = f.api({operation: 'list'}).characters;
  assert.equal(listed.find(c => c.id === 'good').name, '小夜');
  const bad = listed.find(c => c.id === 'bad');
  assert.equal(typeof bad.error, 'string');
  assert(!bad.error.includes(f.root));
});

test('list heals an interrupted save', () => {
  const f = fixture();
  f.importCard('yuha');
  const dir = characterDir(f.root, 'yuha');
  writeFileSync(join(dir, 'rules.md'), '被改过的规则。'); // rules.md written, compiled.json not yet
  writeFileSync(join(dir, 'compiled.json.99.tmp'), 'half');
  f.api({operation: 'list'});
  assert(JSON.parse(readFileSync(join(dir, 'compiled.json'), 'utf8')).owner.prefix.includes('被改过的规则。'));
});

test('profile persona override warns', () => {
  const f = fixture();
  assert.deepEqual(f.api({operation: 'list'}).profileWarnings, []);
  writeFileSync(f.profileFile, yaml.dump({presets: [{id: 'qq-character', plugins: [{id: 'other'}, {id: 'persona', name: 'x'}]}]}));
  const warnings = f.api({operation: 'list'}).profileWarnings;
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Profile 覆盖了 persona 行/);
  writeFileSync(f.profileFile, yaml.dump({presets: [{id: 'qq-character', plugins: [{id: 'other'}]}]}));
  assert.deepEqual(f.api({operation: 'list'}).profileWarnings, []);
  writeFileSync(f.profileFile, ': : not yaml [');
  assert.deepEqual(f.api({operation: 'list'}).profileWarnings, []);
});

test('unknown operations and path-like parameters are refused', () => {
  const f = fixture();
  f.importCard('yuha');
  for (const request of [
    {operation: 'delete', id: 'yuha'}, {operation: 'constructor'}, {operation: '__proto__'}, {}, null, [], 'list',
    {operation: 'get', id: 'yuha', path: '/etc'}, {operation: 'get', id: 'yuha', dir: 'x'}, {operation: 'exportCard', id: 'yuha', file: 'x'},
    {operation: 'get', id: 'yuha', extra: 1}, {operation: 'list', id: 'yuha'},
  ]) assert.throws(() => f.api(request), undefined, JSON.stringify(request));
  assert.throws(() => f.api({operation: 'get', id: '../yuha'}), /id/);
  assert.throws(() => f.api({operation: 'get', id: 'current'}), /id/);
  assert(!existsSync(join(f.base, 'x')));
});

function applyPlugin(root, {characterId = 'yuha', host = '127.0.0.1'} = {}) {
  const routes = [];
  const cleanups = [];
  const ctx = {
    webServer: {host, getOrigin: () => `http://${host}:1`, register: route => { routes.push(route); return () => routes.splice(routes.indexOf(route), 1); }},
    connection: {admit: () => ({rejection: 401})},
    characterIdentity: {conversationScope: () => ({characterId})},
    effect: fn => cleanups.push(fn()),
  };
  const dirs = {root, maintenanceDirectory: join(root, 'maintenance'), featuresFile: join(root, 'features.json')};
  plugin.apply(ctx, dirs);
  return {routes, cleanups, ctx, dirs};
}

test('runtime health', () => {
  assert.equal(plugin.name, 'character-manager');
  assert.deepEqual(plugin.inject, ['webServer', 'connection', 'connection.authentication', 'characterIdentity']);
  const f = fixture();
  f.importCard('yuha');
  symlinkSync(characterDir(f.root, 'yuha'), join(f.root, 'character-current'), 'junction');
  const current = join(f.root, 'character-current');
  writeFileSync(join(current, 'binding.json'), JSON.stringify({appId: 'a', ownerId: 'o', projectId: 'p', characterId: 'yuha'}));

  const started = Date.now();
  const {routes, cleanups} = applyPlugin(f.root);
  const health = JSON.parse(readFileSync(join(current, 'runtime-health.json'), 'utf8'));
  assert.deepEqual(Object.keys(health).sort(), ['at', 'characterId', 'compiledRevision', 'personaSource', 'pid']);
  assert.equal(health.pid, process.pid);
  assert.equal(health.characterId, 'yuha');
  assert.equal(health.personaSource, 'compiled');
  assert.equal(health.compiledRevision, 1);
  assert(health.at >= started && health.at <= Date.now());
  assert.deepEqual(routes.map(route => [route.kind, route.path]), [['prefix', '/character-manager']]);
  cleanups.forEach(fn => fn());
  assert.equal(routes.length, 0);

  rmSync(join(current, 'compiled.json'));
  applyPlugin(f.root, {characterId: 'yuha'});
  const neutral = JSON.parse(readFileSync(join(current, 'runtime-health.json'), 'utf8'));
  assert.equal(neutral.personaSource, 'neutral');
  assert.equal(neutral.compiledRevision, null);
  assert.equal(neutral.characterId, 'yuha');
  assert.deepEqual(readdirSync(current).filter(name => name.endsWith('.tmp')), []);
});

test('a link to a missing directory does not stop the Host', () => {
  const f = fixture();
  mkdirSync(join(f.base, 'gone'));
  symlinkSync(join(f.base, 'gone'), join(f.root, 'character-current'), 'junction');
  rmSync(join(f.base, 'gone'), {recursive: true});
  assert.doesNotThrow(() => applyPlugin(f.root));
});

test('the plugin needs loopback and absolute options', () => {
  const f = fixture();
  assert.throws(() => applyPlugin(f.root, {host: '0.0.0.0'}), /loopback/);
  const ctx = {webServer: {host: '127.0.0.1'}, characterIdentity: {}, effect() {}};
  assert.throws(() => plugin.apply(ctx, {root: 'relative', maintenanceDirectory: f.root, featuresFile: f.root}), /root/);
  assert.throws(() => plugin.apply(ctx, {}), /root/);
});
