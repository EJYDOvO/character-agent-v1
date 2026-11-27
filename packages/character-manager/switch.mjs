// Switching the current character: the checks and preparation the Host can do
// while running, and the request file the watchdog helper acts on. The Host
// never moves the link itself; it stops running during a switch. No HTTP.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {characterDir, currentId, readRegistry, recordLegacySessionOwner, registeredDirectories} from './registry.mjs';
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
 * conversations.json is initialized with a namespace on first activation.
 * Existing namespaces and the original role's legacy fallback preserve their
 * derived Session routes, as well as any explicit Session IDs.
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

  const state = readConversations(target, targetDir) ?? {overrides: {}, presets: {}, sessionIds: {}, lifecycle: {}};
  if (state.sessionNamespace !== undefined && state.sessionNamespace !== target) {
    throw new Error(`目标角色的 ${CONVERSATIONS_FILE} 属于另一个角色（sessionNamespace 为 ${state.sessionNamespace}），不能切换。`);
  }
  const entries = registeredDirectories(root).map(({id, dir}) => ({
    id, dir, state: id === target ? state : readConversations(id, dir),
  }));
  const legacyOwner = originalSessionOwner(root, current, entries);
  // An unrecorded conversation may already have a native Session. Changing
  // its namespace or inserting a random ID would silently orphan the route.
  if (state.sessionNamespace === target || legacyOwner === target) return;

  // Seed known keys once for a new namespace. Subsequent switches preserve
  // every route, including IDs the native Host derives without recording.
  const keys = new Set([`qqbot:${appId}:c2c:${ownerId}`]);
  for (const entry of entries) {
    for (const key of conversationKeys(entry.state)) keys.add(key);
  }
  const recorded = state.sessionIds ?? {};
  const missing = [...keys].filter(key => typeof recorded[key] !== 'string' || !recorded[key]);
  const sessionIds = {...recorded, ...Object.fromEntries(missing.map(key => [key, randomUUID()]))};
  writeJsonAtomic(path.join(targetDir, CONVERSATIONS_FILE), {...state, sessionNamespace: target, sessionIds});
}

function originalSessionOwner(root, current, entries) {
  const {legacySessionOwner} = readRegistry(root);
  if (legacySessionOwner !== undefined) return legacySessionOwner;
  // Recover older adoptions from the previous Host record or the old layout.
  // Unused imported roles have neither, even when their state has no namespace.
  const unnamespaced = entries.filter(entry => entry.state?.sessionNamespace === undefined);
  const served = unnamespaced.filter(({id, dir}) => {
    const health = readJson(path.join(dir, 'runtime-health.json'));
    return health?.characterId === id && Number.isFinite(health.at) && Number.isSafeInteger(health.pid) && health.pid > 0;
  });
  const candidates = served.length ? served : unnamespaced;
  const oldLayout = candidates.filter(({id, dir}) => path.relative(root, dir) === `character-${id}`);
  const prior = served.length === 1 ? served[0] : oldLayout.length === 1 ? oldLayout[0] : undefined;
  if (!prior && served.length > 1) throw new Error('无法确认旧会话的唯一归属角色，不能更改会话路由。');
  const active = unnamespaced.find(entry => entry.id === current);
  const owner = (served.length ? prior : active ?? prior)?.id;
  if (owner !== undefined) recordLegacySessionOwner(root, owner);
  return owner;
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
