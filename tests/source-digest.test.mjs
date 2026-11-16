import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');

// Runs the digest in a child process: pack.cjs calls it with the deployment
// environment, so the test does too, with an empty build config.
function digest(env, buildConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'source-digest-'));
  const config = join(dir, 'build-config.json');
  writeFileSync(config, JSON.stringify(buildConfig));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DSH_/.test(key)));
  const result = spawnSync(process.execPath, ['-e', "console.log(require('./scripts/source-digest.cjs')())"],
    {cwd: root, encoding: 'utf8', env: {...clean, DSH_CHARACTER_BUILD_CONFIG: config, ...env}, windowsHide: true});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('the release source digest covers the effective character card', () => {
  const first = digest({});
  assert.match(first, /^[0-9a-f]{64}$/);
  const card = join(mkdtempSync(join(tmpdir(), 'source-digest-card-')), 'card.json');
  writeFileSync(card, JSON.stringify({spec: 'chara_card_v3', spec_version: '3.0', data: {name: 'A', description: 'd'}}));
  assert.notEqual(digest({DSH_CHARACTER_CARD: card}), first);
});

test('with the character manager the digest ignores the card', () => {
  const managed = {characterManager: {enabled: true}};
  const first = digest({}, managed);
  assert.match(first, /^[0-9a-f]{64}$/);
  const card = join(mkdtempSync(join(tmpdir(), 'source-digest-card-')), 'card.json');
  writeFileSync(card, JSON.stringify({spec: 'chara_card_v3', spec_version: '3.0', data: {name: 'A', description: 'd'}}));
  assert.equal(digest({DSH_CHARACTER_CARD: card}, managed), first);
  assert.equal(digest({DSH_CHARACTER_CARD: join(tmpdir(), 'missing-card.json')}, managed), first);
  assert.notEqual(first, digest({}));
});
