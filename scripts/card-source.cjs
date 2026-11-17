// Where the character card and its deployment rules come from: the private
// build config (or DSH_CHARACTER_BUILD_CONFIG) plus DSH_CHARACTER_CARD.
// Paths in the config resolve against the repository root. Card content and
// userName are validated by loadCard (packages/character-definition/card.mjs).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const RULES_KEYS = ['systemFile', 'reminderFile'];
// Every key a build config may hold (card-source and build-settings). Any
// other key fails: a misspelled cardPath or rules would otherwise be ignored
// and the build would quietly ship a different character or no rules.
const CONFIG_KEYS = ['characterId', 'cardPath', 'rules', 'userName', 'presetId', 'dataDirectory', 'interaction', 'specialistWorkers', 'communityWorkerPresets', 'roles', 'semanticRecall'];
// Spellings that have a dedicated message.
const RENAMED_KEYS = {
  card: 'Unknown build config key "card": use cardPath',
  definitionPath: 'definitionPath is no longer supported: the definition.yaml format was replaced by Character Card V3; set cardPath instead',
};

/**
 * The private build config. It must exist: without one a build would fall back
 * to defaults and could bind a template character to a real data directory.
 * @returns {Record<string, unknown>}
 */
function readConfig() {
  const file = process.env.DSH_CHARACTER_BUILD_CONFIG || path.join(root, 'private', 'build-config.json');
  if (!fs.existsSync(file)) throw Error(`Build config not found: ${file} (set DSH_CHARACTER_BUILD_CONFIG or create private/build-config.json)`);
  const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error(`Invalid build config: expected a JSON object (${file})`);
  for (const key of Object.keys(config)) {
    if (RENAMED_KEYS[key]) throw Error(RENAMED_KEYS[key]);
    if (!CONFIG_KEYS.includes(key)) throw Error(`Unknown build config key "${key}" in ${file}: expected ${CONFIG_KEYS.join(', ')}`);
  }
  return config;
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
  if (process.env.DSH_CHARACTER_DEFINITION !== undefined) {
    throw Error('DSH_CHARACTER_DEFINITION is no longer supported: the definition.yaml format was replaced by Character Card V3; use DSH_CHARACTER_CARD');
  }
  const config = readConfig();

  // A misnamed rules key must fail: silently building without the rules would
  // ship a character without its identity constraints.
  const rules = config.rules ?? {};
  if (typeof rules !== 'object' || Array.isArray(rules)) throw Error('Invalid rules: expected {systemFile, reminderFile}');
  const unknownRules = Object.keys(rules).filter(key => !RULES_KEYS.includes(key));
  if (unknownRules.length) throw Error(`Unknown rules key ${unknownRules.join(', ')}: expected systemFile and reminderFile`);
  // One source for the reminder: the build passes rules.reminderFile to both
  // the Character plugin and Interaction.
  if (Object.hasOwn(config.interaction ?? {}, 'styleReminder')) {
    throw Error('interaction.styleReminder is not supported: the style reminder comes from rules.reminderFile');
  }

  // The character is always named: no template card and no default id. The
  // template is still available as cardPath "characters/template/card.yaml".
  const cardPath = process.env.DSH_CHARACTER_CARD || config.cardPath;
  if (cardPath === undefined || cardPath === '') throw Error('Build config must name the character card: set cardPath (or DSH_CHARACTER_CARD)');
  const characterId = config.characterId;
  if (characterId === undefined) throw Error('Build config must name the character: set characterId');
  if (typeof characterId !== 'string' || !/^[a-z0-9-]{1,48}$/.test(characterId)) throw Error('Invalid characterId');

  return {
    characterId,
    cardPath: optionalPath(cardPath, 'cardPath'),
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

module.exports = {readConfig, cardSettings, cardRevisions, revisionsOf};
