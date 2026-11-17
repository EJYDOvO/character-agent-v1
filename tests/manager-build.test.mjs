import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import yaml from 'js-yaml';

const root = resolve(import.meta.dirname, '..');
const template = join(root, 'characters', 'template');
const PERSONA = 'dsh-character-manager/runtime-persona.mjs';
const OFFICIAL_PERSONA = '@deepseek-ai/dsh-persona';

// The build reads the official Creator composition from the Host archive. This
// fixture archive holds just what the build touches, so the tests need no Host.
const CREATOR = [{insert: [{id: 'preset-cordis', config: {id: 'cordis', name: 'Cordis', plugins: [
  {id: 'persona', name: OFFICIAL_PERSONA, config: {prefix: 'official prefix'}},
  {id: 'delegation', group: true, config: [{id: 'tool-subagent', name: 'tool-subagent', config: {provider: 'spawn'}}]},
]}}]}];

function asar(files) {
  const data = [], tree = {files: {}};
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const bytes = Buffer.from(text);
    let entry = tree;
    for (const part of name.split('/').slice(0, -1)) entry = entry.files[part] ??= {files: {}};
    entry.files[name.split('/').at(-1)] = {size: bytes.length, offset: String(offset)};
    data.push(bytes);
    offset += bytes.length;
  }
  const json = Buffer.from(JSON.stringify(tree));
  const padded = Math.ceil(json.length / 4) * 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(padded + 8, 4);
  prefix.writeUInt32LE(padded + 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  return Buffer.concat([prefix, json, Buffer.alloc(padded - json.length), ...data]);
}

// A scratch copy of the build scripts and packages: the build writes bundles,
// artifacts and package manifests next to itself, never into this repository.
mkdirSync(join(root, 'test-data'), {recursive: true});
const scratch = mkdtempSync(join(root, 'test-data', 'manager-build-'));
test.after(() => rmSync(scratch, {recursive: true, force: true}));
for (const dir of ['scripts', 'packages']) cpSync(join(root, dir), join(scratch, dir), {recursive: true});
cpSync(join(root, 'package.json'), join(scratch, 'package.json'));
const resources = join(scratch, 'host', 'resources');
mkdirSync(resources, {recursive: true});
writeFileSync(join(resources, 'app.asar'), asar({
  'dsh/package.json': JSON.stringify({version: '0.2.2-rc.1'}),
  'dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml': yaml.dump(CREATOR),
  'dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js': 'allowedAgentPresets',
}));
const install = join(scratch, 'install').replaceAll('\\', '/');
const DATA = `${install}/data`;

let runs = 0;
function build(config, env = {}) {
  const configFile = join(scratch, `build-config-${++runs}.json`);
  writeFileSync(configFile, JSON.stringify(config));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSH_')));
  const result = spawnSync(process.execPath, [join(scratch, 'scripts', 'build.cjs')], {
    cwd: scratch, encoding: 'utf8', windowsHide: true,
    env: {
      ...clean, DSH_INSTALL_ROOT: join(scratch, 'install'), DSH_CHARACTER_HOST_ROOT: join(scratch, 'host'),
      DSH_CHARACTER_BUILD_CONFIG: configFile, ...env,
    },
  });
  if (result.status !== 0) return {failure: result.stderr};
  const schema = yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', {kind: 'scalar', construct: value => ({expression: value})}));
  const core = yaml.load(readFileSync(join(scratch, 'bundles/character-core/cordis.patch.yml'), 'utf8'), {schema})[0].insert;
  const manifest = JSON.parse(readFileSync(join(scratch, 'artifacts/build-manifest.json'), 'utf8'));
  const preset = id => core.find(row => row.config?.id === id);
  const plugin = (presetId, id) => preset(presetId).config.plugins.find(p => p.id === id);
  return {core, manifest, host: id => core.find(row => row.id === id), preset, plugin, text: JSON.stringify(core)};
}

// Without the manager the build must name its character (the card comes from DSH_CHARACTER_CARD).
const offConfig = {
  characterId: 'off-character',
  rules: {systemFile: join(template, 'rules.md'), reminderFile: join(template, 'reminder.md')},
  interaction: {enabled: true, hangOnText: '构建里的等待提示'},
};
const offEnv = {DSH_CHARACTER_CARD: join(template, 'card.yaml'), DSH_CHARACTER_DATA_DIR: `${install}/off-data`};
// Nothing here may be read: the manager build ignores the card, rules, user and data directory.
const onConfig = {
  characterManager: {enabled: true},
  cardPath: 'does/not/exist.yaml', rules: {systemFile: 'missing-rules.md'}, userName: '{{bad}}', characterId: 'ignored',
  dataDirectory: 'D:/ignored',
  interaction: {enabled: true, hangOnText: '构建里的等待提示'},
};

test('manager off keeps the current build', () => {
  const built = build(offConfig, offEnv);
  assert(!built.failure, built.failure);
  assert(!built.text.includes('dsh-character-manager'));
  const persona = built.plugin('qq-character', 'persona');
  assert.equal(persona.name, OFFICIAL_PERSONA);
  assert(persona.config.prefix.includes('示例角色'), 'prefix is the rendered card');
  const reminder = readFileSync(join(template, 'reminder.md'), 'utf8').trim();
  assert.equal(built.plugin('qq-character', 'character-memory-tools').config.reminder, reminder);
  const interaction = built.plugin('qq-character', 'interaction-policy').config;
  assert.equal(interaction.styleReminder, reminder);
  assert.equal(interaction.hangOnText, '构建里的等待提示');
  assert(!('compiledFile' in interaction));
  assert.equal(built.manifest.characterId, 'off-character');
  assert.equal(built.manifest.card.spec, 'v3');
  assert(!('characterManager' in built.manifest) && !('characterManager' in built.manifest.settings));
});

test('manager on wires the runtime persona', () => {
  const built = build(onConfig);
  assert(!built.failure, built.failure);
  const current = `${DATA}/character-current`;
  const owner = built.plugin('qq-character', 'persona');
  assert.deepEqual(owner, {id: 'persona', name: PERSONA, config: {
    audience: 'owner', compiledFile: `${current}/compiled.json`, bindingFile: `${current}/binding.json`,
  }});
  assert.deepEqual(built.preset('qq-character').config.plugins.map(p => p.id).slice(0, 2), ['persona', 'delegation'], 'the row keeps its place');
  assert(!('reminder' in built.plugin('qq-character', 'character-memory-tools').config));
  const interaction = built.plugin('qq-character', 'interaction-policy').config;
  assert.equal(interaction.compiledFile, `${current}/compiled.json`);
  assert(!('styleReminder' in interaction) && !('hangOnText' in interaction));
  assert.equal(interaction.hangOnModelFile, `${current}/hangon-model.json`);
  assert.deepEqual(built.host('character-manager'), {id: 'character-manager', name: 'dsh-character-manager', config: {
    root: DATA, maintenanceDirectory: `${DATA}/maintenance`, featuresFile: `${install}/maintenance/features.json`,
    profileFile: `${DATA}/profiles/desktop/cordis.patch.yml`,
  }});
  assert.equal(built.manifest.card, null);
  assert.equal(built.manifest.characterId, null);
  assert.equal(built.manifest.characterManager, true);
  assert.deepEqual(built.manifest.settings.characterManager, {enabled: true, root: DATA});
  assert.equal(built.manifest.settings.dataDirectory, current, 'the configured data directory is ignored');
  // Every per-character path goes through the character-current link.
  assert.equal(built.host('character-identity').config.bindingFile, `${current}/binding.json`);
  assert.equal(built.host('character-identity').config.stateFile, `${current}/coordination.sqlite`);
  assert.equal(built.host('character-memory-core').config.database, `${current}/memory.sqlite`);
  assert.equal(built.host('conversation-manager').config.stateFile, `${current}/conversations.json`);
});

test('the manager build ignores DSH_CHARACTER_DATA_DIR and DSH_CHARACTER_CARD', () => {
  const built = build(onConfig, {DSH_CHARACTER_DATA_DIR: `${install}/elsewhere`, DSH_CHARACTER_CARD: 'missing.yaml'});
  assert(!built.failure, built.failure);
  assert.equal(built.host('character-identity').config.bindingFile, `${DATA}/character-current/binding.json`);
});

test('roles with manager', () => {
  const built = build({...onConfig, roles: {enabled: true}});
  assert(!built.failure, built.failure);
  const current = `${DATA}/character-current`;
  for (const id of ['character-contact', 'character-guest']) {
    assert.deepEqual(built.preset(id).config.plugins.map(p => p.id), ['persona', 'role-tool-scope']);
    assert.deepEqual(built.plugin(id, 'persona'), {id: 'persona', name: PERSONA, config: {
      audience: 'public', compiledFile: `${current}/compiled.json`, bindingFile: `${current}/binding.json`,
    }});
  }
  assert.equal(built.plugin('character', 'persona').config.audience, 'owner');
  const access = built.host('identity-access').config;
  assert(access.stateFile.startsWith(`${DATA}/account/`), access.stateFile);
  assert(access.ownerFile.startsWith(`${DATA}/account/`), access.ownerFile);
  assert(!built.text.includes('private-owner'));
  assert.deepEqual(built.manifest.rolePresets, ['character', 'character-contact', 'character-guest']);
});

test('roles without the manager still keep the account files in the data directory', () => {
  const file = join(scratch, 'public-persona.txt');
  writeFileSync(file, 'public persona');
  const built = build({...offConfig, roles: {enabled: true, publicPersonaFile: file}}, offEnv);
  assert(!built.failure, built.failure);
  assert(built.host('identity-access').config.stateFile.startsWith(`${install}/off-data/`));
  assert.deepEqual(built.plugin('character-guest', 'persona'), {id: 'persona', name: OFFICIAL_PERSONA, config: {prefix: 'public persona'}});
});

test('publicPersonaFile is refused with the manager', () => {
  const built = build({...onConfig, roles: {enabled: true, publicPersonaFile: join(scratch, 'public-persona.txt')}});
  assert.match(built.failure, /roles\.publicPersonaFile is replaced by the character's public version/);
});

test('characterManager must be {enabled: boolean}', () => {
  for (const bad of [true, {enabled: 'yes'}, {enabled: true, root: 'x'}, []]) {
    assert.match(build({characterManager: bad}).failure, /characterManager must be/);
  }
  // Disabled means the card build, exactly as without the option.
  const built = build({...offConfig, characterManager: {enabled: false}}, offEnv);
  assert(!built.failure, built.failure);
  assert(!built.text.includes('dsh-character-manager'));
});
