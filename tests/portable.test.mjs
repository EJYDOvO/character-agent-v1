import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {buildStepReport} = require('../scripts/portable.cjs');

test('a failed build step reports its error instead of hiding it', () => {
  const stderr = '角色卡警告：已忽略 system_prompt：「x」\nCardError: 角色卡缺少 name：C:\cards\a.json\n    at normalizeCard (file:///x.mjs:1:1)\n';
  const report = buildStepReport('build', {status: 1, stderr});
  assert.equal(report.failure, 'Private Character build failed; no running Profile was modified: 角色卡缺少 name：C:\cards\a.json');
  assert.deepEqual(report.warnings, ['角色卡警告：已忽略 system_prompt：「x」']);
});

test('a successful build step passes its card warnings on', () => {
  const report = buildStepReport('build', {status: 0, stderr: Buffer.from('角色卡警告：人设约 3200 token\r\n')});
  assert.equal(report.failure, null);
  assert.deepEqual(report.warnings, ['角色卡警告：人设约 3200 token']);
});

test('a failure with no output still names the step and exit status', () => {
  assert.equal(buildStepReport('pack', {status: 3, stderr: ''}).failure,
    'Private Character pack failed; no running Profile was modified (exit 3)');
  assert.equal(buildStepReport('pack', {status: null, stderr: null, error: Error('spawn ENOENT')}).failure,
    'Private Character pack failed; no running Profile was modified: spawn ENOENT');
});
