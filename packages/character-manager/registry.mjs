// The character registry: which characters exist under <data>, where they
// live, and the operations that add, archive and export them. Directories are
// always derived from a character id and re-validated on every use; nothing
// here accepts a path from a caller. No HTTP and no switching (see switch.mjs).
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readCardFile, CardError} from './card/card-reader.mjs';
import {normalizeCard} from './card/card-normalize.mjs';
import {CARD_FILES, DEFAULT_HANG_ON_TEXT, compileCharacter} from './compile.mjs';
import {writeJsonAtomic} from './compiled.mjs';

export const ID = /^[a-z0-9-]{1,48}$/;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const REGISTRY_FILE = 'registry.json';
const CURRENT_LINK = 'character-current';
const UPLOAD_DIR = '.upload';
const ARCHIVE_DIR = '.archive';
const STALE_UPLOAD_MS = 60 * 60 * 1000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEMPLATE_DIR = path.join(import.meta.dirname, 'template');
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const EXTENDED_PREFIX = /^\\\\\?\\/;

/**
 * @typedef {{id: string, dir: string, addedAt: string, archived: boolean}} RegistryEntry
 * @typedef {{version: 1, characters: RegistryEntry[]}} Registry
 */

/** `current` would collide with the link `data/character-current`. */
export function validId(id) {
  return typeof id === 'string' && ID.test(id) && id !== 'current';
}

/**
 * Reads registry.json; a missing file is an empty registry. A leftover
 * `registry.json.<pid>.tmp` from an interrupted write is never looked at.
 * @param {string} root the data directory
 * @returns {Registry}
 */
export function readRegistry(root) {
  const file = registryFile(root);
  if (!fs.existsSync(file)) return {version: 1, characters: []};
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value?.version !== 1 || !Array.isArray(value.characters)) throw new Error('registry.json 格式不正确');
  const seen = new Set();
  const characters = value.characters.map(entry => {
    const valid = entry && validId(entry.id) && typeof entry.dir === 'string' && typeof entry.addedAt === 'string'
      && typeof entry.archived === 'boolean' && !seen.has(entry.id);
    if (!valid) throw new Error('registry.json 含无效的角色条目');
    seen.add(entry.id);
    return {id: entry.id, dir: entry.dir, addedAt: entry.addedAt, archived: entry.archived};
  });
  return {version: 1, characters};
}

/**
 * The directory of a registered, unarchived character, or an error. The
 * directory must be `<root>/characters/<id>` or the old `<root>/character-<id>`,
 * a real directory (not a link) under <root>, holding a binding.json of this id.
 * @param {string} root
 * @param {string} id
 * @returns {string} absolute path with forward slashes
 */
export function characterDir(root, id) {
  if (!validId(id)) throw new Error('角色 id 无效');
  const entry = readRegistry(root).characters.find(item => item.id === id);
  if (!entry) throw new Error(`角色未注册：${id}`);
  if (entry.archived) throw new Error(`角色已归档：${id}`);
  return checkDirectory(root, id, entry.dir);
}

/** The id of the character the link `<root>/character-current` points at, or null. */
export function currentId(root) {
  let target;
  try {
    target = fs.readlinkSync(path.join(root, CURRENT_LINK));
  } catch {
    return null;
  }
  const resolved = resolveReal(path.resolve(root, target.replace(EXTENDED_PREFIX, '')));
  const match = readRegistry(root).characters.find(entry => !entry.archived && samePath(resolveReal(entry.dir), resolved));
  return match?.id ?? null;
}

/** Adds an existing character directory (adoption of an old layout) to the registry. */
export function register(root, {id, dir}) {
  if (!validId(id)) throw new Error('角色 id 无效');
  if (typeof dir !== 'string' || !dir) throw new Error('角色目录无效');
  const registry = readRegistry(root);
  if (registry.characters.some(entry => entry.id === id)) throw new Error(`角色已存在：${id}`);
  const checked = checkDirectory(root, id, dir);
  writeRegistry(root, {...registry, characters: [...registry.characters, {id, dir: checked, addedAt: new Date().toISOString(), archived: false}]});
}

/** Starts an upload; returns its id. Uploads older than an hour are swept. */
export function beginUpload(root) {
  const base = path.join(root, 'characters', UPLOAD_DIR);
  fs.mkdirSync(base, {recursive: true});
  for (const name of fs.readdirSync(base)) {
    const old = path.join(base, name);
    try {
      if (Date.now() - fs.statSync(old).mtimeMs > STALE_UPLOAD_MS) fs.rmSync(old, {recursive: true, force: true});
    } catch {
      // Removed by someone else meanwhile.
    }
  }
  const uploadId = randomUUID();
  fs.mkdirSync(path.join(base, uploadId));
  return uploadId;
}

/**
 * Stores chunk `index` (0, 1, 2, ...; no gaps) of an upload. A chunk that
 * breaks the 20 MB limit or is not base64 deletes the whole upload.
 * @returns {{bytes: number}} the total stored so far
 */
export function appendUpload(root, uploadId, index, base64) {
  const dir = uploadPath(root, uploadId);
  const names = fs.readdirSync(dir);
  if (!Number.isInteger(index) || index !== names.length) throw new Error(`上传分块必须按顺序提交（应为第 ${names.length} 块）`);
  if (typeof base64 !== 'string' || !BASE64.test(base64)) {
    discardUpload(root, uploadId);
    throw new Error('上传数据不是有效的 base64');
  }
  const chunk = Buffer.from(base64, 'base64');
  const total = names.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0) + chunk.length;
  if (total > MAX_UPLOAD_BYTES) {
    discardUpload(root, uploadId);
    throw new Error('角色卡文件超过 20 MB');
  }
  fs.writeFileSync(path.join(dir, String(index).padStart(6, '0')), chunk);
  return {bytes: total};
}

/**
 * Creates `<root>/characters/<id>` from an uploaded card: the card file,
 * rules.md and reminder.md from the template, character.json and compiled.json.
 * Any failure removes both the new directory and the upload.
 * @returns {import('./compiled.mjs').Compiled}
 */
export function importCharacter(root, {uploadId, id, userName, parseYaml}) {
  try {
    return createFromUpload(root, {uploadId, id, userName, parseYaml});
  } finally {
    discardUpload(root, uploadId);
  }
}

function createFromUpload(root, {uploadId, id, userName, parseYaml}) {
  if (!validId(id)) throw new Error('角色 id 无效：只能用小写字母、数字和连字符（最长 48 个字符），且不能是 current');
  const registry = readRegistry(root);
  const dir = path.join(root, 'characters', id);
  if (registry.characters.some(entry => entry.id === id) || fs.existsSync(dir) || fs.existsSync(path.join(root, `character-${id}`))) {
    throw new Error(`角色 id 已存在：${id}`);
  }
  const bytes = readUpload(root, uploadId);
  let created = false;
  try {
    fs.mkdirSync(dir, {recursive: true});
    created = true;
    const cardFile = path.join(dir, classify(bytes));
    fs.writeFileSync(cardFile, bytes);
    const {data} = normalizeCard(readCardFile(cardFile, {parseYaml}).raw, cardFile);

    const rules = fs.readFileSync(path.join(TEMPLATE_DIR, 'rules.md'), 'utf8').replaceAll('「……」', `「${data.name}」`);
    fs.writeFileSync(path.join(dir, 'rules.md'), rules);
    fs.copyFileSync(path.join(TEMPLATE_DIR, 'reminder.md'), path.join(dir, 'reminder.md'));
    const settings = {...(userName === undefined ? {} : {userName}), hangOnText: DEFAULT_HANG_ON_TEXT, publicExclude: [], revision: 1};
    writeJsonAtomic(path.join(dir, 'character.json'), settings);
    const {compiled} = compileCharacter({dir, characterId: id, parseYaml});
    writeJsonAtomic(path.join(dir, 'compiled.json'), compiled);
    writeJsonAtomic(path.join(dir, 'binding.json'), bindingFor(root, id));
    writeRegistry(root, {...registry, characters: [...registry.characters, {id, dir: toPosix(dir), addedAt: new Date().toISOString(), archived: false}]});
    return compiled;
  } catch (error) {
    if (created) fs.rmSync(dir, {recursive: true, force: true});
    throw error;
  }
}

/** Moves a character other than the current one to `characters/.archive/`. */
export function archiveCharacter(root, id) {
  const dir = characterDir(root, id);
  if (currentId(root) === id) throw new Error('当前角色不能归档');
  const archive = path.join(root, 'characters', ARCHIVE_DIR);
  const target = path.join(archive, `${id}-${timestamp(new Date())}`);
  if (fs.existsSync(target)) throw new Error('归档目录已存在，请稍后重试');
  fs.mkdirSync(archive, {recursive: true});
  fs.renameSync(dir, target);
  try {
    const registry = readRegistry(root);
    writeRegistry(root, {...registry, characters: registry.characters.map(entry => (entry.id === id ? {...entry, archived: true, dir: toPosix(target)} : entry))});
  } catch (error) {
    fs.renameSync(target, dir);
    throw error;
  }
}

/**
 * The card as standard CCv3 JSON: the normalized card text fields, everything
 * else of the card (extensions included) as the file had it.
 * @returns {object}
 */
export function exportCard(root, id, parseYaml) {
  const {raw, data} = readCard(root, id, parseYaml);
  const source = raw.spec === undefined ? raw : raw.data;
  const {name, nickname, description, personality, scenario, mes_example} = data;
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {...source, name, nickname, description, personality, scenario, mes_example, extensions: source.extensions ?? {}},
  };
}

/** Which card format the character was imported from. @returns {{spec: 'v1'|'v2'|'v3', format: 'json'|'png'|'yaml'}} */
export function cardInfo(root, id, parseYaml) {
  const {spec, format} = readCard(root, id, parseYaml);
  return {spec, format};
}

function readCard(root, id, parseYaml) {
  const dir = characterDir(root, id);
  const file = CARD_FILES.map(name => path.join(dir, name)).find(candidate => fs.existsSync(candidate));
  if (!file) throw new CardError('角色目录里没有角色卡');
  const {raw, format} = readCardFile(file, {parseYaml});
  const {spec, data} = normalizeCard(raw, file);
  return {raw, data, spec, format};
}

// The identity (app, owner, project) comes from the current character; with no
// current character (first ever import) only the id is known.
function bindingFor(root, id) {
  const current = currentId(root);
  if (current) {
    try {
      const {appId, ownerId, projectId} = JSON.parse(fs.readFileSync(path.join(characterDir(root, current), 'binding.json'), 'utf8'));
      if ([appId, ownerId, projectId].every(value => typeof value === 'string' && value)) return {appId, ownerId, projectId, characterId: id};
    } catch {
      // Falls through to the id-only binding.
    }
  }
  return {characterId: id};
}

function checkDirectory(root, id, dir) {
  const resolved = path.resolve(dir);
  const allowed = [path.join(root, 'characters', id), path.join(root, `character-${id}`)];
  if (!allowed.some(candidate => samePath(candidate, resolved))) throw new Error(`角色目录不在允许的位置：${id}`);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new Error(`角色目录不存在：${id}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`角色目录不是普通目录：${id}`);
  const real = fs.realpathSync(resolved);
  const base = fs.realpathSync(root);
  const parent = path.dirname(real);
  if (!samePath(parent, base) && !samePath(parent, path.join(base, 'characters'))) throw new Error(`角色目录不在数据目录之下：${id}`);
  let bound;
  try {
    bound = JSON.parse(fs.readFileSync(path.join(resolved, 'binding.json'), 'utf8')).characterId;
  } catch {
    throw new Error(`角色目录缺少有效的 binding.json：${id}`);
  }
  if (bound !== id) throw new Error(`binding.json 属于另一个角色：${id}`);
  return toPosix(resolved);
}

function classify(bytes) {
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'card.png';
  try {
    JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/^\uFEFF/, ''));
    return 'card.json';
  } catch {
    return 'card.yaml';
  }
}

function uploadPath(root, uploadId) {
  if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId)) throw new Error('上传不存在或已过期');
  const dir = path.join(root, 'characters', UPLOAD_DIR, uploadId);
  if (!fs.existsSync(dir)) throw new Error('上传不存在或已过期');
  return dir;
}

function readUpload(root, uploadId) {
  const dir = uploadPath(root, uploadId);
  const bytes = Buffer.concat(fs.readdirSync(dir).sort().map(name => fs.readFileSync(path.join(dir, name))));
  if (!bytes.length) throw new Error('上传的文件是空的');
  return bytes;
}

function discardUpload(root, uploadId) {
  if (typeof uploadId === 'string' && UPLOAD_ID.test(uploadId)) fs.rmSync(path.join(root, 'characters', UPLOAD_DIR, uploadId), {recursive: true, force: true});
}

// Where the watchdog helper looks for it too.
function registryFile(root) {
  return path.join(root, 'characters', REGISTRY_FILE);
}

function writeRegistry(root, registry) {
  fs.mkdirSync(path.join(root, 'characters'), {recursive: true});
  writeJsonAtomic(registryFile(root), registry);
}

function resolveReal(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

function samePath(a, b) {
  const normal = value => path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normal(a).toLowerCase() === normal(b).toLowerCase() : normal(a) === normal(b);
}

function toPosix(file) {
  return path.resolve(file).replace(/\\/g, '/');
}

function timestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
