// Where the character card and its deployment rules come from: the private
// build config (or DSH_CHARACTER_BUILD_CONFIG) plus DSH_CHARACTER_CARD.
// Paths in the config resolve against the repository root.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const DEFAULT_CARD = 'characters/template/card.yaml';
const DEFAULT_CHARACTER_ID = 'character-a';
const DEFAULT_USER_NAME = '用户';
const MAX_USER_NAME_CHARS = 32;

function readConfig() {
  const file = process.env.DSH_CHARACTER_BUILD_CONFIG || path.join(root, 'private', 'build-config.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function optionalPath(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw Error(`Invalid ${name}: expected a file path`);
  return path.resolve(root, value);
}

function userName(value = DEFAULT_USER_NAME) {
  const valid = typeof value === 'string' && value.trim() && [...value].length <= MAX_USER_NAME_CHARS && !/[{}\r\n]/.test(value);
  if (!valid) throw Error(`Invalid userName: 1-${MAX_USER_NAME_CHARS} characters without braces or line breaks`);
  return value.trim();
}

/**
 * @returns {{characterId: string, cardPath: string, systemRulesPath: string|null,
 *   reminderPath: string|null, userName: string}}
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

  const rules = config.rules ?? {};
  if (typeof rules !== 'object' || Array.isArray(rules)) throw Error('Invalid rules: expected {systemFile, reminderFile}');

  return {
    characterId,
    cardPath: optionalPath(process.env.DSH_CHARACTER_CARD || config.cardPath || DEFAULT_CARD, 'cardPath'),
    systemRulesPath: optionalPath(rules.systemFile, 'rules.systemFile'),
    reminderPath: optionalPath(rules.reminderFile, 'rules.reminderFile'),
    userName: userName(config.userName),
  };
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function fileHash(file) {
  return file ? sha256(fs.readFileSync(file)) : sha256('');
}

/**
 * Content revisions used to decide whether a build is stale.
 * @param {{cardPath: string, systemRulesPath: string|null, reminderPath: string|null}} settings
 */
function cardRevisions({cardPath, systemRulesPath, reminderPath}) {
  return {
    revision: sha256(fs.readFileSync(cardPath)),
    rulesRevision: sha256(JSON.stringify([fileHash(systemRulesPath), fileHash(reminderPath)])),
  };
}

module.exports = {cardSettings, cardRevisions};
