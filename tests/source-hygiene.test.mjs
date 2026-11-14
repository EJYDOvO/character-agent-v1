import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SOURCE = /\.(?:mjs|cjs|js)$/;

function sources(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return SOURCE.test(entry.name) ? [path] : [];
  });
}

// An invisible U+FEFF in source is easy to delete by accident: an editor that
// strips it silently turns a BOM-handling test into one that always passes.
// Source writes it as the escape \uFEFF instead.
test('source files spell U+FEFF as an escape, never as the raw character', () => {
  const offenders = ['packages', 'scripts', 'tests']
    .flatMap(dir => sources(join(root, dir)))
    .filter(file => readFileSync(file, 'utf8').includes('\uFEFF'))
    .map(file => relative(root, file));
  assert.deepEqual(offenders, []);
});
