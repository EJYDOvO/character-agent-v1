import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

// R4: the Host-side runtime path and Interaction stay small and decoupled.
// Every `import … from`, `export … from` and `import(…)` specifier of a file.
function specifiers(file) {
  const text = fs.readFileSync(file, 'utf8');
  const found = [];
  for (const pattern of [/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const match of text.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}
const builtin = specifier => specifier.startsWith('node:');
function onlyImports(file, allowed) {
  const name = path.relative(root, file);
  for (const specifier of specifiers(file)) assert.ok(allowed(specifier), `${name} imports ${specifier}`);
}

test('import graph (R4)', () => {
  const cardDir = path.join(manager, 'card');
  for (const name of fs.readdirSync(cardDir).filter(file => file.endsWith('.mjs'))) {
    onlyImports(path.join(cardDir, name), specifier => builtin(specifier) || /^\.\/card-[a-z-]+\.mjs$/.test(specifier));
  }
  onlyImports(path.join(manager, 'compiled.mjs'), builtin);
  onlyImports(path.join(manager, 'runtime-persona.mjs'), specifier => builtin(specifier) || specifier === './compiled.mjs');
  const policy = path.join(root, 'packages', 'interaction-policy');
  for (const name of fs.readdirSync(policy).filter(file => /\.(?:mjs|js)$/.test(file))) {
    for (const specifier of specifiers(path.join(policy, name))) {
      assert.ok(!/character-manager/.test(specifier), `interaction-policy/${name} imports ${specifier}`);
    }
  }
});

test('the import parser sees every form', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-layout-'));
  try {
    const file = path.join(dir, 'probe.mjs');
    fs.writeFileSync(file, "import a from './a.mjs';\nimport {b,\n c} from \"./b.mjs\";\nexport * from './c.mjs';\nexport {d} from './d.mjs';\nimport './e.mjs';\nconst f = await import('./f.mjs');\n");
    assert.deepEqual(specifiers(file).sort(), ['./a.mjs', './b.mjs', './c.mjs', './d.mjs', './e.mjs', './f.mjs']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('import template matches the build template', () => {
  for (const name of ['rules.md', 'reminder.md']) {
    const imported = fs.readFileSync(path.join(manager, 'template', name));
    const built = fs.readFileSync(path.join(root, 'characters', 'template', name));
    assert.ok(imported.equals(built), name);
  }
});
