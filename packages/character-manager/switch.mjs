// Switching the current character: the checks and preparation the Host can do
// while running, and the request file the watchdog helper acts on. The Host
// never moves the link itself; it stops running during a switch. No HTTP.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {characterDir, currentId, readRegistry} from './registry.mjs';
import {readCompiled, writeJsonAtomic} from './compiled.mjs';

export const REQUEST_FILE = 'character-switch.json';
export const INPROGRESS_FILE = 'character-switch.inprogress.json';
export const RESULT_FILE = 'character-switch-result.json';
export const HISTORY_FILE = 'character-switch-history.json';
export const MAX_SWITCHES_PER_HOUR = 4;
export const WATCHDOG_STALE_MS = 120000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WATCHDOG_STATE_FILE = 'watchdog-state.json';
const IDENTITY_KEYS = ['appId', 'ownerId', 'projectId'];

/**
 * The watchdog must be switched on and have checked in recently: it is the
 * only thing that can move the link and bring the Host back.
 * @param {{maintenanceDirectory: string, featuresFile: string, now?: number}} options
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function watchdogReady({maintenanceDirectory, featuresFile, now = Date.now()}) {
  if (readJson(featuresFile)?.watchdog?.enabled !== true) return {ok: false, reason: '请先启用 watchdog，再切换角色。'};
  const checkedAt = Date.parse(readJson(path.join(maintenanceDirectory, WATCHDOG_STATE_FILE))?.checkedAt);
  if (!Number.isFinite(checkedAt) || now - checkedAt > WATCHDOG_STALE_MS) {
    return {ok: false, reason: 'watchdog 没有在运行（超过 2 分钟没有检查记录），请先启动 watchdog。'};
  }
  return {ok: true};
}

/**
 * Creates the files of `target` the Host needs to start as that character,
 * for those that do not exist yet. Nothing of `current` is written.
 * @param {{root: string, target: string, current: string}} options
 */
export function prepareTarget({root, target, current}) {
  const targetDir = characterDir(root, target);
  const currentBinding = readJson(path.join(characterDir(root, current), 'binding.json'));
  if (!currentBinding || IDENTITY_KEYS.some(key => typeof currentBinding[key] !== 'string' || !currentBinding[key])) {
    throw new Error('当前角色的 binding.json 不完整，无法准备目标角色。');
  }
  const {appId, ownerId, projectId} = currentBinding;

  // An import leaves binding.json with only the character id; the identity is added here.
  const bindingFile = path.join(targetDir, 'binding.json');
  const binding = readJson(bindingFile);
  if (!binding || IDENTITY_KEYS.some(key => typeof binding[key] !== 'string' || !binding[key])) {
    writeJsonAtomic(bindingFile, {appId, ownerId, projectId, characterId: target});
  }
  const conversationsFile = path.join(targetDir, 'conversations.json');
  if (!fs.existsSync(conversationsFile)) {
    writeJsonAtomic(conversationsFile, {overrides: {}, presets: {}, sessionIds: {[`qqbot:${appId}:c2c:${ownerId}`]: randomUUID()}, lifecycle: {}});
  }
}

/**
 * Checks everything the Host can check, prepares the target and writes the
 * request. Throws an Error with a Chinese reason when the switch cannot be asked for.
 * @param {{root: string, maintenanceDirectory: string, featuresFile: string, target: string, now?: number}} options
 * @returns {{target: string, previous: string, requestedAt: number, nonce: string}}
 */
export function requestSwitch({root, maintenanceDirectory, featuresFile, target, now = Date.now()}) {
  const ready = watchdogReady({maintenanceDirectory, featuresFile, now});
  if (!ready.ok) throw new Error(ready.reason);

  const entry = readRegistry(root).characters.find(item => item.id === target);
  if (!entry) throw new Error(`角色未注册：${target}`);
  if (entry.archived) throw new Error(`角色已归档，不能切换：${target}`);
  const previous = currentId(root);
  if (previous === null) throw new Error('无法确定当前角色，不能切换。');
  if (previous === target) throw new Error('目标已经是当前角色。');
  if (isPending(maintenanceDirectory)) throw new Error('已有一个切换请求尚未处理完。');

  const history = readHistory(maintenanceDirectory, now);
  if (history.filter(item => now - item.at < HOUR_MS).length >= MAX_SWITCHES_PER_HOUR) {
    throw new Error(`每小时最多请求 ${MAX_SWITCHES_PER_HOUR} 次切换，请稍后再试。`);
  }
  try {
    readCompiled(path.join(characterDir(root, target), 'compiled.json'), {characterId: target});
  } catch (error) {
    throw new Error(`目标角色的资料不可用，请先在管理页保存一次：${error.message}`);
  }

  prepareTarget({root, target, current: previous});
  const request = {target, previous, requestedAt: now, nonce: randomUUID()};
  writeJsonAtomic(path.join(maintenanceDirectory, HISTORY_FILE), [...history, {at: now, target}]);
  writeJsonAtomic(path.join(maintenanceDirectory, REQUEST_FILE), request);
  return request;
}

/**
 * The switch the watchdog is working on or has yet to pick up, and the last
 * result. The watchdog renames an accepted request to the in-progress file.
 * @param {{maintenanceDirectory: string}} options
 * @returns {{pending: object|null, inProgress: boolean, result: object|null}}
 */
export function switchStatus({maintenanceDirectory}) {
  const inProgress = readJson(path.join(maintenanceDirectory, INPROGRESS_FILE));
  const waiting = readJson(path.join(maintenanceDirectory, REQUEST_FILE));
  const result = readJson(path.join(maintenanceDirectory, RESULT_FILE));
  return {
    pending: isObject(inProgress) ? inProgress : isObject(waiting) ? waiting : null,
    inProgress: isObject(inProgress),
    result: isObject(result) ? result : null,
  };
}

function isPending(maintenanceDirectory) {
  return [REQUEST_FILE, INPROGRESS_FILE].some(name => fs.existsSync(path.join(maintenanceDirectory, name)));
}

// Entries of the last day only; an unreadable history counts as empty.
function readHistory(maintenanceDirectory, now) {
  const value = readJson(path.join(maintenanceDirectory, HISTORY_FILE));
  return Array.isArray(value) ? value.filter(item => isObject(item) && Number.isFinite(item.at) && now - item.at < DAY_MS) : [];
}

// A missing or unreadable file reads as null: state files may be mid-write or absent.
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
