import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const definition = path.join(root, 'packages', 'character-definition');
const manager = path.join(root, 'packages', 'character-manager');

test('card pipeline has one copy', () => {
  const files = fs.readdirSync(definition).filter(name => /^card.*\.mjs$/.test(name));
  assert.ok(files.length >= 6);
  for (const name of files) {
    const text = fs.readFileSync(path.join(definition, name), 'utf8');
    assert.equal(text.replace(/\s+/g, ''), `export*from'../character-manager/card/${name}';`.replace(/\s+/g, ''), name);
    assert.ok(fs.existsSync(path.join(manager, 'card', name)), `${name} moved into the manager package`);
  }
});

test('import template matches the build template', () => {
  for (const name of ['rules.md', 'reminder.md']) {
    const imported = fs.readFileSync(path.join(manager, 'template', name));
    const built = fs.readFileSync(path.join(root, 'characters', 'template', name));
    assert.ok(imported.equals(built), name);
  }
});
