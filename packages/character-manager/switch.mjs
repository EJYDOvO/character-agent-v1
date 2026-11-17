// Switching the current character: the checks and preparation the Host can do
// while running, and the request file the watchdog helper acts on. The Host
// never moves the link itself; it stops running during a switch. No HTTP.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {characterDir, currentId, readRegistry, registeredDirectories} from './registry.mjs';
import {readCompiled, readJsonFile, writeJsonAtomic} from './compiled.mjs';

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
const CONVERSATIONS_FILE = 'conversations.json';
// The maps of Conversation Manager's state file, each keyed by conversation key.
const CONVERSATION_MAPS = ['sessionIds', 'lifecycle', 'presets', 'overrides'];

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
 * Prepares the Conversation state of `target` (which is not running): its
 * conversations.json is created, or gets its sessionNamespace (the target id)
 * and a new Session ID for each key it has none for; nothing it has is changed
 * (binding.json is never written here).
 * Nothing of `current` or any other character is written. Throws when a
 * character's conversations.json exists but cannot be read.
 * @param {{root: string, target: string, current: string}} options
 */
export function prepareTarget({root, target, current}) {
  const targetDir = characterDir(root, target);
  const currentBinding = readJson(path.join(characterDir(root, current), 'binding.json'));
  if (!currentBinding || IDENTITY_KEYS.some(key => typeof currentBinding[key] !== 'string' || !currentBinding[key])) {
    throw new Error('当前角色的 binding.json 不完整，无法准备目标角色。');
  }
  const {appId, ownerId, projectId} = currentBinding;
  // binding.json is written by import and adoption only; a target without identity is not switchable.
  const targetBinding = readJson(path.join(targetDir, 'binding.json'));
  if (!targetBinding || IDENTITY_KEYS.some(key => typeof targetBinding[key] !== 'string' || !targetBinding[key])) {
    throw new Error('目标角色的 binding.json 缺少身份信息，不能切换。');
  }

  // Conversation Manager derives the Session ID of a key it has no record of
  // from the key and the state file's sessionNamespace. The target's own id as
  // namespace keeps any key, recorded anywhere or not, from resuming another
  // character's Session. The namespace is written here only: the target is not
  // running, and Conversation Manager refuses a file changed under it.
  const state = readConversations(target, targetDir) ?? {overrides: {}, presets: {}, sessionIds: {}, lifecycle: {}};
  if (state.sessionNamespace !== undefined && state.sessionNamespace !== target) {
    throw new Error(`目标角色的 ${CONVERSATIONS_FILE} 属于另一个角色（sessionNamespace 为 ${state.sessionNamespace}），不能切换。`);
  }
  // Second line of defence, and the only one for a Conversation Manager
  // without namespaces: the Owner's key and every key a registered character
  // has recorded get a new Session in the target; what it already has is kept.
  const keys = new Set([`qqbot:${appId}:c2c:${ownerId}`]);
  for (const {id, dir} of registeredDirectories(root)) {
    for (const key of conversationKeys(readConversations(id, dir))) keys.add(key);
  }
  const recorded = state.sessionIds ?? {};
  const missing = [...keys].filter(key => typeof recorded[key] !== 'string' || !recorded[key]);
  if (!missing.length && state.sessionNamespace === target) return;
  const sessionIds = {...recorded, ...Object.fromEntries(missing.map(key => [key, randomUUID()]))};
  writeJsonAtomic(path.join(targetDir, CONVERSATIONS_FILE), {sessionNamespace: target, ...state, sessionIds});
}

// A character's Conversation Manager state; null when it has none yet. One that
// cannot be read refuses the switch: its keys would be unknown.
function readConversations(id, dir) {
  const file = path.join(dir, CONVERSATIONS_FILE);
  if (!fs.existsSync(file)) return null;
  let value;
  try {
    value = readJsonFile(file);
  } catch {
    throw new Error(`角色 ${id} 的 ${CONVERSATIONS_FILE} 无法读取，不能切换。`);
  }
  const namespace = value?.sessionNamespace;
  if (!isObject(value) || CONVERSATION_MAPS.some(name => value[name] !== undefined && !isObject(value[name]))
    || (namespace !== undefined && (typeof namespace !== 'string' || !namespace))) {
    throw new Error(`角色 ${id} 的 ${CONVERSATIONS_FILE} 格式不正确，不能切换。`);
  }
  return value;
}

function conversationKeys(state) {
  return state ? CONVERSATION_MAPS.flatMap(name => Object.keys(state[name] ?? {})) : [];
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
    return readJsonFile(file);
  } catch {
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
