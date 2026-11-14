// Where the character card and its deployment rules come from: the private
// build config (or DSH_CHARACTER_BUILD_CONFIG) plus DSH_CHARACTER_CARD.
// Paths in the config resolve against the repository root. Card content and
// userName are validated by loadCard (packages/character-definition/card.mjs).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const DEFAULT_CARD = 'characters/template/card.yaml';
const DEFAULT_CHARACTER_ID = 'character-a';
const RULES_KEYS = ['systemFile', 'reminderFile'];

function readConfig() {
  const file = process.env.DSH_CHARACTER_BUILD_CONFIG || path.join(root, 'private', 'build-config.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function optionalPath(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw Error(`Invalid ${name}: expected a file path`);
  return path.resolve(root, value);
}

/**
 * @returns {{characterId: string, cardPath: string, systemRulesPath: string|null,
 *   reminderPath: string|null, userName?: unknown}}
 */
function cardSettings() {
  const config = readConfig();
  if (process.env.DSH_CHARACTER_DEFINITION !== undefined) {
    throw Error('DSH_CHARACTER_DEFINITION is no longer supported: the definition.yaml format was replaced by Character Card V3; use DSH_CHARACTER_CARD');
  }
  if (Object.hasOwn(config, 'definitionPath')) {
    throw Error('definitionPath is no longer supported: the definition.yaml format was replaced by Character Card V3; set cardPath instead');
  }

  const characterId = config.characterId ?? DEFAULT_CHARACTER_ID;
  if (typeof characterId !== 'string' || !/^[a-z0-9-]{1,48}$/.test(characterId)) throw Error('Invalid characterId');

  // A misnamed key must fail: silently building without the rules (or with the
  // template card) would ship a character without its identity constraints.
  if (Object.hasOwn(config, 'card')) throw Error('Unknown build config key "card": use cardPath');
  const rules = config.rules ?? {};
  if (typeof rules !== 'object' || Array.isArray(rules)) throw Error('Invalid rules: expected {systemFile, reminderFile}');
  const unknownRules = Object.keys(rules).filter(key => !RULES_KEYS.includes(key));
  if (unknownRules.length) throw Error(`Unknown rules key ${unknownRules.join(', ')}: expected systemFile and reminderFile`);
  // One source for the reminder: the build passes rules.reminderFile to both
  // the Character plugin and Interaction.
  if (Object.hasOwn(config.interaction ?? {}, 'styleReminder')) {
    throw Error('interaction.styleReminder is not supported: the style reminder comes from rules.reminderFile');
  }

  return {
    characterId,
    cardPath: optionalPath(process.env.DSH_CHARACTER_CARD || config.cardPath || DEFAULT_CARD, 'cardPath'),
    systemRulesPath: optionalPath(rules.systemFile, 'rules.systemFile'),
    reminderPath: optionalPath(rules.reminderFile, 'rules.reminderFile'),
    ...(config.userName !== undefined ? {userName: config.userName} : {}),
  };
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Content revisions used to decide whether a build is stale.
 * @param {{card: Buffer, systemRules: Buffer|null, reminder: Buffer|null}} inputs
 *   file contents; null for a rules file that is not configured
 */
function revisionsOf({card, systemRules, reminder}) {
  const hash = bytes => sha256(bytes ?? '');
  return {
    revision: sha256(card),
    rulesRevision: sha256(JSON.stringify([hash(systemRules), hash(reminder)])),
  };
}

/**
 * revisionsOf for the files named by cardSettings().
 * @param {{cardPath: string, systemRulesPath: string|null, reminderPath: string|null}} settings
 */
function cardRevisions({cardPath, systemRulesPath, reminderPath}) {
  const read = file => (file ? fs.readFileSync(file) : null);
  return revisionsOf({card: read(cardPath), systemRules: read(systemRulesPath), reminder: read(reminderPath)});
}

module.exports = {cardSettings, cardRevisions, revisionsOf};
