// compiled.json: the compiled form of a character, shared by the manager
// (which writes it) and the runtime persona plugin (which reads it). This
// module has no dependencies besides node:fs so the runtime can load it alone.
import fs from 'node:fs';

export const COMPILED_VERSION = 1;
export const NEUTRAL_PERSONA = '角色资料暂时不可用。请简短告知对方稍后再试，不要扮演任何角色。';
export const MAX_PERSONA_CHARS = 32000;
export const MAX_HANG_ON_CHARS = 200;
// Matches MAX_REMINDER_CHARS of the card pipeline (tests keep them equal).
const MAX_REMINDER_CHARS = 4000;

const REVISION_FIELDS = ['cardRevision', 'rulesRevision'];

/**
 * @typedef {{prefix: string, suffix: string}} PersonaText
 * @typedef {PersonaText & {hash: string}} PublicPersona
 * @typedef {{version: 1, revision: number, characterId: string, name: string,
 *   hangOnText: string, reminder: string, owner: PersonaText,
 *   public?: PublicPersona, pendingPublic?: PublicPersona,
 *   tokens: {owner: number, public: number}, warnings: string[],
 *   userFields: string[], cardRevision: string, rulesRevision: string}} Compiled
 *
 * Checks a parsed compiled.json and returns a clean copy (unknown keys are
 * dropped). Everything the model can see (name, personas, reminder, wait
 * text) must be free of `{{`/`}}`, which DSH would try to interpolate;
 * warnings are shown to the Owner only and may quote macros.
 * @param {unknown} value
 * @param {{characterId: string}} options
 * @returns {Compiled}
 */
export function validateCompiled(value, {characterId}) {
  if (!isObject(value)) throw new Error('compiled.json must be an object');
  if (value.version !== COMPILED_VERSION) throw new Error(`Unsupported compiled version ${JSON.stringify(value.version)}`);
  if (value.characterId !== characterId) throw new Error('compiled.json belongs to another character');

  const name = text(value.name, 'name');
  if (!name.trim()) throw new Error('compiled name must not be empty');
  const hangOnText = text(value.hangOnText, 'hangOnText');
  if (!hangOnText.trim() || [...hangOnText].length > MAX_HANG_ON_CHARS) {
    throw new Error(`hangOnText must be 1-${MAX_HANG_ON_CHARS} characters`);
  }
  const reminder = text(value.reminder, 'reminder');
  if ([...reminder].length > MAX_REMINDER_CHARS) throw new Error(`reminder exceeds ${MAX_REMINDER_CHARS} characters`);

  const compiled = {
    version: COMPILED_VERSION,
    revision: nonNegativeInteger(value.revision, 'revision'),
    characterId,
    name,
    hangOnText,
    reminder,
    owner: persona(value.owner, 'owner'),
  };
  for (const key of ['public', 'pendingPublic']) {
    if (value[key] !== undefined) compiled[key] = {...persona(value[key], key), hash: text(value[key].hash, `${key}.hash`)};
  }
  compiled.tokens = {
    owner: nonNegativeInteger(value.tokens?.owner, 'tokens.owner'),
    public: nonNegativeInteger(value.tokens?.public, 'tokens.public'),
  };
  compiled.warnings = stringList(value.warnings, 'warnings');
  compiled.userFields = stringList(value.userFields, 'userFields');
  for (const field of REVISION_FIELDS) compiled[field] = text(value[field], field);
  return compiled;
}

/**
 * Reads and validates a compiled.json. Only the file itself is read: a
 * leftover `<file>.<pid>.tmp` from an interrupted write is never looked at.
 * @param {string} file
 * @param {{characterId: string}} options
 * @returns {Compiled}
 */
export function readCompiled(file, {characterId}) {
  return validateCompiled(JSON.parse(fs.readFileSync(file, 'utf8')), {characterId});
}

/** Writes JSON through a same-directory temporary file and a rename. */
export function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, {force: true});
    throw error;
  }
}

function persona(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const prefix = text(value.prefix, `${label}.prefix`);
  const suffix = text(value.suffix, `${label}.suffix`);
  if ([...prefix].length + [...suffix].length > MAX_PERSONA_CHARS) {
    throw new Error(`${label} persona exceeds ${MAX_PERSONA_CHARS} characters`);
  }
  return {prefix, suffix};
}

function text(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (/\{\{|\}\}/.test(value)) throw new Error(`${label} must not contain {{ or }}`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label} must be a list of strings`);
  return [...value];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
