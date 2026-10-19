const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
module.exports = function definitionSource() {
  const file = path.join(root, 'private', 'build-config.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : {};
  const selected = process.env.DSH_CHARACTER_DEFINITION || config.definitionPath || 'characters/character-a/definition.yaml';
  if (typeof selected !== 'string' || !selected.trim()) throw Error('Invalid character definition path');
  return path.resolve(root, selected);
};
