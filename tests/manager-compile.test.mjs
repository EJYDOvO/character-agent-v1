import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import yaml from 'js-yaml';
import {
  compileCharacter, ensureCompiled, saveCharacter, approvePublic, readSettings, publicHash,
  PUBLIC_USER_NAME, DEFAULT_PUBLIC_RELATIONSHIP, CARD_FILES,
} from '../packages/character-manager/compile.mjs';
import {
  validateCompiled, readCompiled, writeJsonAtomic, COMPILED_VERSION, NEUTRAL_PERSONA, MAX_PERSONA_CHARS, MAX_HANG_ON_CHARS,
} from '../packages/character-manager/compiled.mjs';

const {revisionsOf} = createRequire(import.meta.url)('../scripts/card-source.cjs');
const parseYaml = text => yaml.load(text);
const template = resolve(import.meta.dirname, '..', 'characters', 'template');
const characterId = 'demo';

function characterDir(settings) {
  const dir = mkdtempSync(join(tmpdir(), 'manager-compile-'));
  for (const name of ['card.yaml', 'rules.md', 'reminder.md']) copyFileSync(join(template, name), join(dir, name));
  if (settings) writeFileSync(join(dir, 'character.json'), JSON.stringify(settings));
  return dir;
}

const options = dir => ({dir, characterId, parseYaml});
const owner = {userName: '阿宁', relationship: {owner: '正在和你聊天的是你的主人阿宁。'}};

test('a missing character.json yields the default wait text', () => {
  assert.equal(compileCharacter(options(characterDir())).compiled.hangOnText, '还在处理中，稍等一下。');
});

test('constants are the spec values', () => {
  assert.equal(COMPILED_VERSION, 1);
  assert.equal(NEUTRAL_PERSONA, '角色资料暂时不可用。请简短告知对方稍后再试，不要扮演任何角色。');
  assert.equal(MAX_PERSONA_CHARS, 32000);
  assert.equal(MAX_HANG_ON_CHARS, 200);
  assert.equal(PUBLIC_USER_NAME, '对方');
  assert.equal(DEFAULT_PUBLIC_RELATIONSHIP, '正在和你聊天的是被允许来聊天的人，不是你的主人，你们并不熟。不要提起主人的私事，也不要假装记得之前的对话。');
  assert.deepEqual(CARD_FILES, ['card.json', 'card.png', 'card.yaml']);
});

test('compiles both audiences', () => {
  const {compiled, previous} = compileCharacter(options(characterDir(owner)));
  assert.equal(previous, null);
  assert(compiled.owner.prefix.includes('阿宁'));
  assert(compiled.owner.prefix.includes('正在和你聊天的是你的主人阿宁。'));
  const publicText = (compiled.public ?? compiled.pendingPublic).prefix;
  assert(publicText.includes('对方'));
  assert(publicText.includes(DEFAULT_PUBLIC_RELATIONSHIP));
  assert(!publicText.includes('你的主人阿宁'));
  assert(!publicText.includes('阿宁'));
  assert.equal(compiled.name, '示例角色');
  assert.equal(compiled.characterId, characterId);
  assert(compiled.tokens.owner > 0 && compiled.tokens.public > 0);
  validateCompiled(compiled, {characterId});
});

test('public needs approval', () => {
  const {compiled} = compileCharacter(options(characterDir(owner)));
  assert.equal(compiled.public, undefined);
  assert.equal(compiled.pendingPublic.hash, publicHash({...compiled.pendingPublic, reminder: compiled.reminder}));
});

test('approval promotes and survives unrelated edits', () => {
  const dir = characterDir(owner);
  const pending = compileCharacter(options(dir)).compiled.pendingPublic;
  const approved = approvePublic({...options(dir), parseYaml, hash: pending.hash});
  assert.equal(approved.pendingPublic, undefined);
  assert.deepEqual(approved.public, pending);
  assert.deepEqual(readCompiled(join(dir, 'compiled.json'), {characterId}), approved);

  const edited = saveCharacter({...options(dir), revision: readSettings(dir).revision,
    draft: {rules: `${readFileSync(join(dir, 'rules.md'), 'utf8')}\n新增一条规则。`}});
  assert.deepEqual(edited.public, pending);
  assert.notEqual(edited.pendingPublic.hash, pending.hash);
  assert(edited.pendingPublic.prefix.includes('新增一条规则。'));
  assert(!edited.public.prefix.includes('新增一条规则。'));
  assert(edited.owner.prefix.includes('新增一条规则。'));
});

test('an unchanged approved public version stays public after recompiling', () => {
  const dir = characterDir(owner);
  const {hash} = compileCharacter(options(dir)).compiled.pendingPublic;
  approvePublic({...options(dir), hash});
  const {compiled} = compileCharacter(options(dir));
  assert.equal(compiled.public.hash, hash);
  assert.equal(compiled.pendingPublic, undefined);
});

test('stale approval hash is rejected', () => {
  const dir = characterDir(owner);
  const stale = compileCharacter(options(dir)).compiled.pendingPublic.hash;
  saveCharacter({...options(dir), revision: 0, draft: {reminder: '换一条提醒。'}});
  assert.throws(() => approvePublic({...options(dir), hash: stale}), /Public version changed/);
  assert.equal(readCompiled(join(dir, 'compiled.json'), {characterId}).public, undefined);
});

test('revision conflict', () => {
  const dir = characterDir(owner);
  saveCharacter({...options(dir), revision: 0, draft: {settings: {hangOnText: '请稍等。'}}});
  assert.equal(readSettings(dir).revision, 1);
  const before = ['character.json', 'compiled.json', 'rules.md'].map(name => readFileSync(join(dir, name), 'utf8'));
  assert.throws(() => saveCharacter({...options(dir), revision: 0, draft: {rules: '改动', settings: {hangOnText: '另一句'}}}), /Revision conflict/);
  assert.deepEqual(['character.json', 'compiled.json', 'rules.md'].map(name => readFileSync(join(dir, name), 'utf8')), before);
});

test('save writes files and keeps a draft out of compileCharacter writes', () => {
  const dir = characterDir(owner);
  const draft = {settings: {nickname: '小尤', hangOnText: '稍等哦'}, rules: '【说话规则】简短回答', reminder: '别忘了简短'};
  const {compiled} = compileCharacter({...options(dir), draft});
  assert.equal(compiled.name, '小尤');
  assert.equal(compiled.hangOnText, '稍等哦');
  assert.equal(compiled.reminder, '别忘了简短');
  assert(compiled.owner.prefix.startsWith('【说话规则】简短回答'));
  assert.equal(readdirSync(dir).includes('compiled.json'), false);
  assert.equal(readSettings(dir).hangOnText === '稍等哦', false);

  const saved = saveCharacter({...options(dir), revision: 0, draft});
  assert.equal(saved.revision, 1);
  assert.equal(readFileSync(join(dir, 'rules.md'), 'utf8'), '【说话规则】简短回答');
  assert.equal(readFileSync(join(dir, 'reminder.md'), 'utf8'), '别忘了简短');
  assert.equal(readSettings(dir).nickname, '小尤');
  assert.deepEqual(readCompiled(join(dir, 'compiled.json'), {characterId}), saved);
});

test('publicExclude leaves fields out of the public version only', () => {
  const dir = characterDir({...owner, publicExclude: ['scenario', 'examples']});
  const {compiled} = compileCharacter(options(dir));
  assert(compiled.owner.prefix.includes('## 场景') || compiled.owner.suffix.includes('## 对话示例'));
  assert(!compiled.pendingPublic.prefix.includes('## 场景'));
  assert.equal(compiled.pendingPublic.suffix, '');
});

test('revisions follow the build rule', () => {
  const dir = characterDir();
  const {compiled} = compileCharacter(options(dir));
  const read = name => readFileSync(join(dir, name));
  const expected = revisionsOf({card: read('card.yaml'), systemRules: read('rules.md'), reminder: read('reminder.md')});
  assert.equal(compiled.cardRevision, expected.revision);
  assert.equal(compiled.rulesRevision, expected.rulesRevision);
});

test('validateCompiled rejects foreign or unsafe data', () => {
  const {compiled} = compileCharacter(options(characterDir(owner)));
  assert.doesNotThrow(() => validateCompiled(structuredClone(compiled), {characterId}));
  assert.throws(() => validateCompiled(compiled, {characterId: 'other'}), /another character/);
  assert.throws(() => validateCompiled({...compiled, owner: {...compiled.owner, prefix: '含{{x}}'}}, {characterId}), /\{\{/);
  assert.throws(() => validateCompiled({...compiled, hangOnText: '长'.repeat(201)}, {characterId}), /hangOnText/);
  assert.throws(() => validateCompiled({...compiled, hangOnText: ' '}, {characterId}), /hangOnText/);
  assert.throws(() => validateCompiled({...compiled, reminder: '字'.repeat(4001)}, {characterId}), /reminder/);
  assert.throws(() => validateCompiled({...compiled, owner: {prefix: '甲'.repeat(20000), suffix: '乙'.repeat(12001)}}, {characterId}), /exceeds/);
  assert.throws(() => validateCompiled({...compiled, version: 2}, {characterId}), /version/);
  assert.throws(() => validateCompiled(null, {characterId}), /object/);
});

test('leftover tmp files are ignored', () => {
  const dir = characterDir(owner);
  const saved = saveCharacter({...options(dir), revision: 0, draft: {}});
  writeFileSync(join(dir, 'compiled.json.123.tmp'), '{broken');
  writeFileSync(join(dir, 'character.json.123.tmp'), '{broken');
  assert.deepEqual(readCompiled(join(dir, 'compiled.json'), {characterId}), saved);
  assert.equal(readSettings(dir).revision, 1);
  assert.doesNotThrow(() => compileCharacter(options(dir)));
});

test('writeJsonAtomic replaces the file and leaves no temporary file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manager-atomic-'));
  const file = join(dir, 'state.json');
  writeJsonAtomic(file, {a: 1});
  writeJsonAtomic(file, {a: 2});
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {a: 2});
  assert.deepEqual(readdirSync(dir), ['state.json']);
});

test('exactly one card file', () => {
  const dir = characterDir(owner);
  writeFileSync(join(dir, 'card.json'), '{}');
  assert.throws(() => compileCharacter(options(dir)), /card/);
  const empty = mkdtempSync(join(tmpdir(), 'manager-nocard-'));
  assert.throws(() => compileCharacter(options(empty)), /card/);
});

test('settings reject unknown keys and bad values', () => {
  const bad = settings => () => readSettings(characterDir(settings));
  assert.throws(bad({surprise: 1}), /surprise/);
  assert.throws(bad({relationship: {friend: 'x'}}), /relationship/);
  assert.throws(bad({hangOnText: ''}), /hangOnText/);
  assert.throws(bad({publicExclude: 'scenario'}), /publicExclude/);
  assert.throws(bad({revision: -1}), /revision/);
  assert.deepEqual(readSettings(characterDir()).relationship, {});
});

test('ensureCompiled returns the file when it is current and heals it otherwise', () => {
  const dir = characterDir(owner);
  const saved = saveCharacter({...options(dir), revision: 0, draft: {}});
  const mtime = () => readFileSync(join(dir, 'compiled.json'), 'utf8');
  const before = mtime();
  assert.deepEqual(ensureCompiled(options(dir)), saved);
  assert.equal(mtime(), before);

  // Crash after rules.md was replaced but before compiled.json.
  writeFileSync(join(dir, 'rules.md'), '【说话规则】崩溃后的新规则');
  const healed = ensureCompiled(options(dir));
  assert(healed.owner.prefix.includes('崩溃后的新规则'));
  assert.deepEqual(readCompiled(join(dir, 'compiled.json'), {characterId}), healed);

  // No compiled.json at all.
  writeFileSync(join(dir, 'compiled.json'), '{broken');
  assert.equal(ensureCompiled(options(dir)).characterId, characterId);
});

test('ensureCompiled recovers an approval whose compiled.json was not written', () => {
  const dir = characterDir(owner);
  const {hash} = saveCharacter({...options(dir), revision: 0, draft: {}}).pendingPublic;
  writeFileSync(join(dir, 'character.json'), JSON.stringify({...readSettings(dir), publicApproved: {hash, at: '2026-11-16T00:00:00.000Z'}}));
  assert.equal(readCompiled(join(dir, 'compiled.json'), {characterId}).public, undefined);
  const healed = ensureCompiled(options(dir));
  assert.equal(healed.public.hash, hash);
  assert.equal(healed.pendingPublic, undefined);
});

test('a failed write of compiled.json leaves the old one valid', () => {
  const dir = characterDir(owner);
  const old = saveCharacter({...options(dir), revision: 0, draft: {}});
  const target = join(dir, 'compiled.json');
  // A directory where the temporary file belongs makes the write fail.
  mkdirSync(`${target}.${process.pid}.tmp`);
  assert.throws(() => saveCharacter({...options(dir), revision: 1, draft: {reminder: '新的提醒'}}));
  assert.deepEqual(readCompiled(target, {characterId}), old);
  // The interrupted save is healed on the next read, once the obstacle is gone.
  rmSync(`${target}.${process.pid}.tmp`, {recursive: true});
  assert.equal(ensureCompiled(options(dir)).reminder, '新的提醒');
});

test('text files are written atomically', () => {
  const dir = characterDir(owner);
  saveCharacter({...options(dir), revision: 0, draft: {rules: '新的规则', reminder: '新的提醒'}});
  assert.equal(readdirSync(dir).some(name => name.endsWith('.tmp')), false);
  assert.equal(readFileSync(join(dir, 'rules.md'), 'utf8'), '新的规则');
});
