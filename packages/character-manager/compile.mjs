// Character directory → compiled.json. A directory holds one card file,
// optional rules.md / reminder.md and character.json (the manager's settings);
// compiling renders the Owner persona and the public persona the runtime
// serves to Contact and Guest. The public persona only reaches `public` once
// the Owner has approved its exact content (see publicApproved).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadCard, DEFAULT_USER_NAME} from './card/card.mjs';
import {COMPILED_VERSION, MAX_HANG_ON_CHARS, readCompiled, validateCompiled, writeFileAtomic, writeJsonAtomic} from './compiled.mjs';

export const PUBLIC_USER_NAME = '对方';
export const DEFAULT_PUBLIC_RELATIONSHIP = '正在和你聊天的是被允许来聊天的人，不是你的主人，你们并不熟。不要提起主人的私事，也不要假装记得之前的对话。';
export const CARD_FILES = ['card.json', 'card.png', 'card.yaml'];
export const DEFAULT_HANG_ON_TEXT = '还在处理中，稍等一下。';

const SETTINGS_FILE = 'character.json';
const COMPILED_FILE = 'compiled.json';
const RULES_FILE = 'rules.md';
const REMINDER_FILE = 'reminder.md';
const SETTINGS_KEYS = ['userName', 'nickname', 'hangOnText', 'relationship', 'publicExclude', 'publicApproved', 'revision'];

/**
 * @typedef {{userName: string, nickname?: string, hangOnText: string,
 *   relationship: {owner?: string, public?: string}, publicExclude: string[],
 *   publicApproved?: {hash: string, at: string}, revision: number}} CharacterSettings
 * @typedef {{settings?: Partial<CharacterSettings>, rules?: string, reminder?: string}} Draft
 *   Unsaved edits that replace the matching on-disk content while compiling.
 * @typedef {import('./compiled.mjs').Compiled} Compiled
 */

/**
 * Reads character.json; a missing file means the defaults. Unknown keys are
 * errors so a misspelled setting cannot be silently ignored.
 * @param {string} dir
 * @returns {CharacterSettings}
 */
export function readSettings(dir) {
  const file = path.join(dir, SETTINGS_FILE);
  return normalizeSettings(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
}

/**
 * @param {{dir: string, characterId: string, parseYaml: (text: string) => unknown,
 *   draft?: Draft}} options
 * @returns {{compiled: Compiled, previous: Compiled|null}} nothing is written.
 */
export function compileCharacter({dir, characterId, parseYaml, draft = {}}) {
  const settings = effectiveSettings(dir, draft);
  const previous = readPrevious(dir, characterId);
  const scratch = new Scratch();
  try {
    const shared = {
      cardPath: cardPathOf(dir),
      systemRulesPath: ruleFile(dir, RULES_FILE, draft.rules, scratch),
      reminderPath: ruleFile(dir, REMINDER_FILE, draft.reminder, scratch),
      nickname: settings.nickname,
      parseYaml,
    };
    const ownerBuild = loadCard({...shared, userName: settings.userName, relationship: settings.relationship.owner ?? ''});
    const publicBuild = loadCard({
      ...shared,
      userName: PUBLIC_USER_NAME,
      relationship: settings.relationship.public ?? DEFAULT_PUBLIC_RELATIONSHIP,
      exclude: settings.publicExclude,
    });

    const fresh = {prefix: publicBuild.prefix, suffix: publicBuild.suffix, hash: publicHash(publicBuild)};
    const approved = settings.publicApproved?.hash;
    const compiled = {
      version: COMPILED_VERSION,
      revision: settings.revision,
      characterId,
      name: ownerBuild.name,
      hangOnText: settings.hangOnText,
      reminder: ownerBuild.reminder,
      owner: {prefix: ownerBuild.prefix, suffix: ownerBuild.suffix},
      ...selectPublic({fresh, approved, previous}),
      tokens: {owner: ownerBuild.tokens.total, public: publicBuild.tokens.total},
      warnings: [...new Set([...ownerBuild.warnings, ...publicBuild.warnings])],
      userFields: publicBuild.userFields,
      ...revisionsOf(ownerBuild.inputs),
    };
    return {compiled: validateCompiled(compiled, {characterId}), previous};
  } finally {
    scratch.dispose();
  }
}

/**
 * Identifies the exact public persona the Owner is asked to approve.
 * @param {{prefix: string, suffix: string, reminder: string}} persona
 */
export function publicHash({prefix, suffix, reminder}) {
  return sha256(JSON.stringify([prefix, suffix, reminder]));
}

/**
 * Validates by compiling first, then writes rules.md, reminder.md,
 * character.json (revision + 1) and compiled.json. Nothing is written when
 * the revision is stale or the result does not compile.
 * @param {{dir: string, characterId: string, parseYaml: (text: string) => unknown,
 *   draft: Draft, revision: number}} options
 * @returns {Compiled}
 */
export function saveCharacter({dir, characterId, parseYaml, draft, revision}) {
  const disk = readSettings(dir);
  if (revision !== disk.revision) throw new Error('Revision conflict');
  const next = normalizeSettings({...disk, ...draft.settings, revision: revision + 1});
  const {compiled} = compileCharacter({dir, characterId, parseYaml, draft: {...draft, settings: next}});

  if (draft.rules !== undefined) writeFileAtomic(path.join(dir, RULES_FILE), draft.rules);
  if (draft.reminder !== undefined) writeFileAtomic(path.join(dir, REMINDER_FILE), draft.reminder);
  writeJsonAtomic(path.join(dir, SETTINGS_FILE), next);
  writeJsonAtomic(path.join(dir, COMPILED_FILE), compiled);
  return compiled;
}

/**
 * Approves the pending public persona. `hash` must still be the one pending
 * after recompiling, so an edit made after the Owner looked is not approved.
 * @param {{dir: string, characterId: string, parseYaml: (text: string) => unknown,
 *   hash: string}} options
 * @returns {Compiled}
 */
export function approvePublic({dir, characterId, parseYaml, hash}) {
  const {compiled: current} = compileCharacter({dir, characterId, parseYaml});
  if (current.pendingPublic?.hash !== hash) throw new Error('Public version changed');

  const disk = readSettings(dir);
  const next = {...disk, publicApproved: {hash, at: new Date().toISOString()}, revision: disk.revision + 1};
  const {compiled} = compileCharacter({dir, characterId, parseYaml, draft: {settings: next}});
  writeJsonAtomic(path.join(dir, SETTINGS_FILE), next);
  writeJsonAtomic(path.join(dir, COMPILED_FILE), compiled);
  return compiled;
}

/**
 * The compiled.json on disk when it is still in step with character.json and
 * the files it was compiled from; otherwise recompiles and rewrites it. This
 * heals an interrupted save or approval (files are written one at a time).
 * @param {{dir: string, characterId: string, parseYaml: (text: string) => unknown}} options
 * @returns {Compiled}
 */
export function ensureCompiled({dir, characterId, parseYaml}) {
  const current = readPrevious(dir, characterId);
  if (current && isCurrent(current, dir)) return current;
  const {compiled} = compileCharacter({dir, characterId, parseYaml});
  if (JSON.stringify(compiled) !== JSON.stringify(current)) writeJsonAtomic(path.join(dir, COMPILED_FILE), compiled);
  return compiled;
}

function isCurrent(compiled, dir) {
  const settings = readSettings(dir);
  const read = name => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name)) : null);
  const files = revisionsOf({card: fs.readFileSync(cardPathOf(dir)), systemRules: read(RULES_FILE), reminder: read(REMINDER_FILE)});
  const approved = settings.publicApproved?.hash;
  return compiled.revision === settings.revision
    && compiled.cardRevision === files.cardRevision
    && compiled.rulesRevision === files.rulesRevision
    && (approved === undefined || compiled.public?.hash === approved);
}

// The public persona is whatever the Owner last approved: the fresh render if
// it is the approved one, otherwise the previously compiled approved version
// (if any) stays public while the fresh render waits as pendingPublic.
function selectPublic({fresh, approved, previous}) {
  if (approved === fresh.hash) return {public: fresh};
  const kept = approved !== undefined && previous?.public?.hash === approved ? previous.public : undefined;
  return {...(kept ? {public: kept} : {}), pendingPublic: fresh};
}

function effectiveSettings(dir, draft) {
  return normalizeSettings({...readSettings(dir), ...draft.settings});
}

function normalizeSettings(raw) {
  if (!isObject(raw)) throw new Error('character.json must be an object');
  const unknown = Object.keys(raw).filter(key => !SETTINGS_KEYS.includes(key));
  if (unknown.length) throw new Error(`Unknown character.json key ${unknown.join(', ')}`);

  const settings = {
    userName: raw.userName ?? DEFAULT_USER_NAME,
    hangOnText: raw.hangOnText ?? DEFAULT_HANG_ON_TEXT,
    relationship: raw.relationship ?? {},
    publicExclude: raw.publicExclude ?? [],
    revision: raw.revision ?? 0,
  };
  if (raw.nickname !== undefined) settings.nickname = raw.nickname;
  if (raw.publicApproved !== undefined) settings.publicApproved = raw.publicApproved;

  // userName, nickname and publicExclude are checked by loadCard when compiling.
  if (typeof settings.userName !== 'string') throw new Error('userName must be a string');
  if (settings.nickname !== undefined && typeof settings.nickname !== 'string') throw new Error('nickname must be a string');
  if (typeof settings.hangOnText !== 'string' || !settings.hangOnText.trim() || [...settings.hangOnText].length > MAX_HANG_ON_CHARS) {
    throw new Error(`hangOnText must be 1-${MAX_HANG_ON_CHARS} characters`);
  }
  const {relationship} = settings;
  if (!isObject(relationship) || Object.keys(relationship).some(key => !['owner', 'public'].includes(key)
    || typeof relationship[key] !== 'string')) {
    throw new Error('relationship must be {owner?, public?} with text values');
  }
  if (!Array.isArray(settings.publicExclude) || settings.publicExclude.some(field => typeof field !== 'string')) {
    throw new Error('publicExclude must be a list of field names');
  }
  if (!Number.isInteger(settings.revision) || settings.revision < 0) throw new Error('revision must be a non-negative integer');
  const approval = settings.publicApproved;
  if (approval !== undefined && !(isObject(approval) && typeof approval.hash === 'string' && typeof approval.at === 'string')) {
    throw new Error('publicApproved must be {hash, at}');
  }
  return settings;
}

function cardPathOf(dir) {
  const found = CARD_FILES.filter(name => fs.existsSync(path.join(dir, name)));
  if (found.length !== 1) {
    throw new Error(`Character directory needs exactly one card file (${CARD_FILES.join(', ')}), found ${found.length}: ${dir}`);
  }
  return path.join(dir, found[0]);
}

// A previous compiled.json that cannot be read only costs the approved public
// version (it must be approved again); it must not block compiling.
function readPrevious(dir, characterId) {
  try {
    return readCompiled(path.join(dir, COMPILED_FILE), {characterId});
  } catch {
    return null;
  }
}

// The same rule as scripts/card-source.cjs revisionsOf, so a compiled.json
// and a build of the same files agree on what is stale.
function revisionsOf({card, systemRules, reminder}) {
  const hash = bytes => sha256(bytes ?? '');
  return {cardRevision: sha256(card), rulesRevision: sha256(JSON.stringify([hash(systemRules), hash(reminder)]))};
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Rules and reminder are optional files; an unsaved draft is staged in a
// scratch directory so loadCard (which reads paths) never needs the disk copy.
function ruleFile(dir, name, draftText, scratch) {
  if (draftText !== undefined) return scratch.write(name, draftText);
  const file = path.join(dir, name);
  return fs.existsSync(file) ? file : null;
}

class Scratch {
  #dir = null;

  write(name, content) {
    this.#dir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compile-'));
    const file = path.join(this.#dir, name);
    fs.writeFileSync(file, content);
    return file;
  }

  dispose() {
    if (this.#dir) fs.rmSync(this.#dir, {recursive: true, force: true});
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
