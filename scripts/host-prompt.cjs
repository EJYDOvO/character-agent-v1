// Loads the official Host's own prompt renderer (dsh-system-prompt) so build
// checks verify rendered Persona text against the real interpolation rules,
// not our reading of them. Read-only: the module source is copied out of the
// Host archive into a scratch directory, with inert stand-ins for its three
// runtime imports; renderPrompt and renderContextSections never use them.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const MODULE = 'dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js';
const STUBS = {
  '@deepseek-ai/cordis': 'export class Service {}',
  '@deepseek-ai/schemastery': 'const any = new Proxy(function () {}, {get: (target, key) => (key === "prototype" ? {} : any), apply: () => any, construct: () => any});\nexport default any;',
  '@deepseek-ai/dsh-scope': 'export class AnonymousEntries {}\nexport class NamedEntries {}\nexport class ScopedLayers {}\nexport function scopeTarget() {}',
};

/**
 * @param {string} dir empty scratch directory to load the module from
 * @returns {Promise<{renderPrompt: Function, renderContextSections: Function}>}
 */
async function hostPromptRenderer(dir) {
  const archive = require('./host-archive.cjs').openArchive();
  let source;
  try {
    source = archive.read(MODULE);
  } finally {
    archive.close();
  }
  for (const [name, body] of Object.entries(STUBS)) {
    const target = path.join(dir, 'node_modules', ...name.split('/'));
    fs.mkdirSync(target, {recursive: true});
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({name, type: 'module', exports: './index.js'}));
    fs.writeFileSync(path.join(target, 'index.js'), body);
  }
  const file = path.join(dir, 'system-prompt.mjs');
  fs.writeFileSync(file, source);
  const {renderPrompt, renderContextSections} = await import(pathToFileURL(file).href);
  if (typeof renderPrompt !== 'function' || typeof renderContextSections !== 'function') {
    throw Error('The Host prompt renderer no longer exports renderPrompt/renderContextSections');
  }
  return {renderPrompt, renderContextSections};
}

module.exports = {hostPromptRenderer};
