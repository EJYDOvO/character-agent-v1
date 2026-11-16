import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, relative} from 'node:path';
import yaml from 'js-yaml';
import {
  validId, readRegistry, characterDir, currentId, register, beginUpload, appendUpload, importCharacter,
  archiveCharacter, exportCard,
} from '../packages/character-manager/registry.mjs';
import {readCompiled} from '../packages/character-manager/compiled.mjs';

const parseYaml = text => yaml.load(text);
const CARD = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: '小夜', description: '{{char}}是一个安静的人，常和{{user}}聊天。', personality: '温和', scenario: '', mes_example: '',
    extensions: {fav: true, nested: {a: [1, 2]}},
  },
};

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
function png(texts) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = texts.map(([keyword, value]) => chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]),
    Buffer.from(Buffer.from(JSON.stringify(value), 'utf8').toString('base64'), 'latin1')])));
  return Buffer.concat([signature, ...chunks, chunk('IEND', Buffer.alloc(0))]);
}

const roots = [];
function dataRoot() {
  const root = mkdtempSync(join(tmpdir(), 'manager-registry-'));
  roots.push(root);
  return root;
}
test.after(() => roots.forEach(root => rmSync(root, {recursive: true, force: true})));

function upload(root, bytes, size = 100 * 1024) {
  const uploadId = beginUpload(root);
  for (let offset = 0, index = 0; offset < bytes.length; offset += size, index += 1) {
    appendUpload(root, uploadId, index, bytes.subarray(offset, offset + size).toString('base64'));
  }
  return uploadId;
}
const importBytes = (root, id, bytes, extra = {}) => importCharacter(root, {uploadId: upload(root, bytes), id, parseYaml, ...extra});
const characterNames = root => (existsSync(join(root, 'characters')) ? readdirSync(join(root, 'characters')).filter(name => !name.startsWith('.') && !name.startsWith('registry.json')) : []);
const uploadNames = root => (existsSync(join(root, 'characters', '.upload')) ? readdirSync(join(root, 'characters', '.upload')) : []);

// A character directory the way an older layout or an adoption leaves it.
function plainCharacter(root, id, where = join('characters', id)) {
  const dir = join(root, where);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'binding.json'), JSON.stringify({characterId: id}));
  return dir;
}

test('ids', () => {
  for (const bad of ['current', 'A', 'a/b', 'a'.repeat(49), '', 'a_b', 7, undefined]) assert.equal(validId(bad), false, String(bad));
  for (const good of ['yuha', 'a', 'a-1', 'a'.repeat(48)]) assert.equal(validId(good), true, good);
});

test('directory trust', () => {
  const root = dataRoot();
  const elsewhere = plainCharacter(root, 'x', 'elsewhere/x');
  const plain = plainCharacter(root, 'plain');
  const mismatch = plainCharacter(root, 'mismatch');
  writeFileSync(join(mismatch, 'binding.json'), JSON.stringify({characterId: 'other'}));
  const noBinding = plainCharacter(root, 'nobind');
  rmSync(join(noBinding, 'binding.json'));
  mkdirSync(join(root, 'characters', 'real'), {recursive: true});
  symlinkSync(join(root, 'characters', 'real'), join(root, 'characters', 'linked'), 'junction');
  symlinkSync(plain, join(root, 'character-current'), 'junction');
  const entry = (id, dir) => ({id, dir: dir.replace(/\\/g, '/'), addedAt: 'x', archived: false});
  writeFileSync(join(root, 'characters', 'registry.json'), JSON.stringify({version: 1, characters: [
    entry('x', elsewhere), entry('plain', plain), entry('mismatch', mismatch), entry('nobind', noBinding),
    entry('linked', join(root, 'characters', 'linked')), entry('y', join(root, 'character-current')),
    {...entry('gone', join(root, 'characters', 'gone'))},
  ]}));

  assert.equal(characterDir(root, 'plain'), join(root, 'characters', 'plain').replace(/\\/g, '/'));
  for (const id of ['x', 'mismatch', 'nobind', 'linked', 'y', 'gone', 'unknown']) assert.throws(() => characterDir(root, id), undefined, id);
  assert.throws(() => characterDir(root, 'mismatch'), /binding\.json/);
  assert.throws(() => characterDir(root, '../plain'), /id/);
});

test('a registry dir must be absolute (one format, as QQTK requires)', () => {
  const root = dataRoot();
  const dir = plainCharacter(root, 'rel');
  const relativeDir = relative(process.cwd(), dir);
  assert.equal(isAbsolute(relativeDir), false);
  assert.throws(() => register(root, {id: 'rel', dir: relativeDir}), /绝对路径/);
  writeFileSync(join(root, 'characters', 'registry.json'), JSON.stringify({version: 1, characters: [{id: 'rel', dir: relativeDir, addedAt: 'x', archived: false}]}));
  assert.throws(() => characterDir(root, 'rel'), /绝对路径/);
});

test('a binding.json with a byte order mark is accepted', () => {
  const root = dataRoot();
  const dir = plainCharacter(root, 'bom');
  writeFileSync(join(dir, 'binding.json'), `\uFEFF${JSON.stringify({characterId: 'bom'})}`);
  register(root, {id: 'bom', dir});
  assert.equal(characterDir(root, 'bom'), dir.replace(/\\/g, '/'));
});

test('the old location data/character-<id> is accepted', () => {
  const root = dataRoot();
  const dir = plainCharacter(root, 'old', 'character-old');
  register(root, {id: 'old', dir});
  assert.equal(characterDir(root, 'old'), dir.replace(/\\/g, '/'));
  assert.match(readRegistry(root).characters[0].dir, /^[A-Za-z]:\/|^\//);
  assert(!readRegistry(root).characters[0].dir.includes('\\'));
});

test('import json, png and yaml', () => {
  const root = dataRoot();
  const cases = [['from-json', Buffer.from(JSON.stringify(CARD)), 'card.json'],
    ['from-png', png([['ccv3', CARD]]), 'card.png'],
    ['from-yaml', Buffer.from(yaml.dump(CARD)), 'card.yaml']];
  for (const [id, bytes, file] of cases) {
    const compiled = importBytes(root, id, bytes);
    const dir = characterDir(root, id);
    assert(existsSync(join(dir, file)), file);
    assert.equal(compiled.name, '小夜');
    assert.equal(readCompiled(join(dir, 'compiled.json'), {characterId: id}).revision, 1);
    const rules = readFileSync(join(dir, 'rules.md'), 'utf8');
    assert(rules.includes('「小夜」') && !rules.includes('「……」'), rules);
    assert(existsSync(join(dir, 'reminder.md')));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'character.json'), 'utf8')), {hangOnText: '还在处理中，稍等一下。', publicExclude: [], revision: 1});
    assert.equal(compiled.pendingPublic !== undefined, true);
  }
  assert.deepEqual(readRegistry(root).characters.map(entry => entry.id), ['from-json', 'from-png', 'from-yaml']);
  assert.equal(uploadNames(root).length, 0);
  assert.throws(() => importBytes(root, 'from-json', Buffer.from(JSON.stringify(CARD))), /已存在/);
  assert.equal(importBytes(root, 'named', Buffer.from(JSON.stringify(CARD)), {userName: '阿宁'}).owner.prefix.includes('阿宁'), true);
});

test('bad uploads leave nothing behind', () => {
  const root = dataRoot();
  const fail = (id, bytes, pattern) => assert.throws(() => importBytes(root, id, bytes), pattern);
  fail('bad-utf8', Buffer.concat([Buffer.from('{"spec":"x","name":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}')]), /UTF-8/);
  fail('no-chunk', png([['Comment', {x: 1}]]), /PNG 中没有角色卡数据/);
  fail('not-a-card', Buffer.from('{"hello": 1}'), /角色卡/);
  assert.deepEqual(characterNames(root), []);
  assert.deepEqual(uploadNames(root), []);
  assert.equal(existsSync(join(root, 'characters', 'registry.json')), false);

  const id = beginUpload(root);
  const megabyte = Buffer.alloc(1024 * 1024, 1).toString('base64');
  for (let index = 0; index < 20; index += 1) appendUpload(root, id, index, megabyte);
  assert.throws(() => appendUpload(root, id, 20, Buffer.from([1]).toString('base64')), /20 MB/);
  assert.deepEqual(uploadNames(root), []);
  assert.deepEqual(characterNames(root), []);
  assert.throws(() => appendUpload(root, id, 21, 'AA=='), /不存在/);
  assert.throws(() => importCharacter(root, {uploadId: id, id: 'big', parseYaml}), /不存在/);
});

test('upload chunks must be contiguous', () => {
  const root = dataRoot();
  const id = beginUpload(root);
  assert.deepEqual(appendUpload(root, id, 0, Buffer.from('abc').toString('base64')), {bytes: 3});
  assert.throws(() => appendUpload(root, id, 2, 'AA=='), /顺序/);
  assert.throws(() => appendUpload(root, id, 0, 'AA=='), /顺序/);
  assert.deepEqual(appendUpload(root, id, 1, Buffer.from('de').toString('base64')), {bytes: 5});
  assert.throws(() => appendUpload(root, '../x', 0, 'AA=='), /不存在/);
  assert.throws(() => appendUpload(root, beginUpload(root), 0, 'not base64!'), /base64/);
});

test('archive', () => {
  const root = dataRoot();
  importBytes(root, 'cur', Buffer.from(JSON.stringify(CARD)));
  importBytes(root, 'other', Buffer.from(JSON.stringify(CARD)));
  symlinkSync(characterDir(root, 'cur'), join(root, 'character-current'), 'junction');
  assert.equal(currentId(root), 'cur');
  assert.throws(() => archiveCharacter(root, 'cur'), /当前/);

  archiveCharacter(root, 'other');
  const entry = readRegistry(root).characters.find(item => item.id === 'other');
  assert.equal(entry.archived, true);
  assert.match(entry.dir, /characters\/\.archive\/other-\d{8}-\d{6}$/);
  assert(existsSync(entry.dir));
  assert.deepEqual(characterNames(root), ['cur']);
  assert.throws(() => characterDir(root, 'other'), /归档/);

  const old = plainCharacter(root, 'legacy', 'character-legacy');
  register(root, {id: 'legacy', dir: old});
  archiveCharacter(root, 'legacy');
  assert.equal(existsSync(old), false);
  assert.match(readRegistry(root).characters.find(item => item.id === 'legacy').dir, /\.archive\/legacy-/);
});

test('currentId is null without a link or for an unregistered target', () => {
  const root = dataRoot();
  assert.equal(currentId(root), null);
  const stranger = plainCharacter(root, 'stranger');
  symlinkSync(stranger, join(root, 'character-current'), 'junction');
  assert.equal(currentId(root), null);
});

test('crash leftovers', () => {
  const root = dataRoot();
  importBytes(root, 'a', Buffer.from(JSON.stringify(CARD)));
  const before = readRegistry(root);
  writeFileSync(join(root, 'characters', 'registry.json.99.tmp'), '{"version":1,"characters":[{"truncated');
  assert.deepEqual(readRegistry(root), before);
  assert.equal(characterDir(root, 'a').endsWith('/characters/a'), true);
});

test("id 'current' is refused everywhere", () => {
  const root = dataRoot();
  assert.throws(() => importBytes(root, 'current', Buffer.from(JSON.stringify(CARD))), /id/);
  assert.deepEqual(characterNames(root), []);
  assert.deepEqual(uploadNames(root), []);
  const dir = plainCharacter(root, 'current', 'character-current');
  assert.throws(() => register(root, {id: 'current', dir}), /id/);
  assert.equal(existsSync(join(root, 'characters', 'registry.json')), false);
});

test('export gives CCv3 JSON that keeps extensions', () => {
  const root = dataRoot();
  importBytes(root, 'a', png([['chara', {spec: 'chara_card_v2', spec_version: '2.0', data: {...CARD.data, extensions: {fav: true}}}]]));
  const card = exportCard(root, 'a', parseYaml);
  assert.equal(card.spec, 'chara_card_v3');
  assert.equal(card.spec_version, '3.0');
  assert.equal(card.data.name, '小夜');
  assert.equal(card.data.description, CARD.data.description);
  assert.deepEqual(card.data.extensions, {fav: true});

  importBytes(root, 'b', Buffer.from(JSON.stringify(CARD)));
  assert.deepEqual(exportCard(root, 'b', parseYaml).data.extensions, CARD.data.extensions);
  assert.throws(() => exportCard(root, 'missing', parseYaml), /未注册/);
});

test('import copies the identity of the current character into binding.json', () => {
  const root = dataRoot();
  importBytes(root, 'first', Buffer.from(JSON.stringify(CARD)));
  // First ever import: no current character, only the id is known.
  assert.deepEqual(JSON.parse(readFileSync(join(characterDir(root, 'first'), 'binding.json'), 'utf8')), {characterId: 'first'});
  writeFileSync(join(characterDir(root, 'first'), 'binding.json'), JSON.stringify({appId: 'a', ownerId: 'o', projectId: 'p', characterId: 'first'}));
  symlinkSync(characterDir(root, 'first'), join(root, 'character-current'), 'junction');
  importBytes(root, 'second', Buffer.from(JSON.stringify(CARD)));
  assert.deepEqual(JSON.parse(readFileSync(join(characterDir(root, 'second'), 'binding.json'), 'utf8')), {appId: 'a', ownerId: 'o', projectId: 'p', characterId: 'second'});
});
