import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import yaml from 'js-yaml';

const root = resolve(import.meta.dirname, '..');
const TEMPLATE = join(root, 'characters', 'template', 'card.yaml');
const run = (script, args) => spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {cwd: root, encoding: 'utf8', windowsHide: true});
const tempDir = () => mkdtempSync(join(tmpdir(), 'card-cli-'));

function cardFile(data) {
  const file = join(tempDir(), 'card.json');
  writeFileSync(file, JSON.stringify({spec: 'chara_card_v3', spec_version: '3.0', data: {name: '乙', description: '乙是测试角色', ...data}}));
  return file;
}

test('check-card reports the template with rules', () => {
  const result = run('check-card.cjs', [TEMPLATE, '--rules', join(root, 'characters/template/rules.md'), '--reminder', join(root, 'characters/template/reminder.md')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /示例角色/);
  assert.match(result.stdout, /v3/);
  assert.match(result.stdout, /token/);
  assert.match(result.stdout, /rules \d+/);
  assert(!result.stdout.includes('⚠'));
});

test('check-card shows warnings and fails with the error on stderr', () => {
  const warned = run('check-card.cjs', [cardFile({system_prompt: 'Write 2-4 paragraphs.'}), '--user-name', '你']);
  assert.equal(warned.status, 0, warned.stderr);
  assert.match(warned.stdout, /⚠ 已忽略 system_prompt：「Write 2-4 paragraphs\.」/);

  const tooLong = run('check-card.cjs', [cardFile({description: '字'.repeat(14000)})]);
  assert.equal(tooLong.status, 1);
  assert.match(tooLong.stderr, /上限 8000/);

  const usage = run('check-card.cjs', []);
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /用法/);
});

test('export-card converts the YAML template to equivalent standard JSON', () => {
  const out = join(tempDir(), 'card.json');
  const result = run('export-card.cjs', [TEMPLATE, out]);
  assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(out, 'utf8');
  assert(text.endsWith('}\n'));
  assert.deepEqual(JSON.parse(text), yaml.load(readFileSync(TEMPLATE, 'utf8')));
  assert.equal(run('check-card.cjs', [out]).status, 0);

  const stdout = run('export-card.cjs', [TEMPLATE]);
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.deepEqual(JSON.parse(stdout.stdout), JSON.parse(text));
});

test('export-card refuses non-YAML input and invalid cards', () => {
  const json = run('export-card.cjs', [cardFile({})]);
  assert.equal(json.status, 1);
  assert.match(json.stderr, /\.yaml/);

  const invalid = join(tempDir(), 'bad.yaml');
  writeFileSync(invalid, 'spec: chara_card_v3\nspec_version: "3.0"\ndata:\n  name: 丙\n');
  const result = run('export-card.cjs', [invalid]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不能全为空/);
});
