// First-time adoption: brings an existing character directory (the old layout
// data/character-<id>, possibly open in a running Host) under the character
// manager. Only new files are added — the card, rules and reminder copied in,
// character.json and compiled.json — and binding.json, the databases and the
// conversations stay untouched. Then the directory is registered and, with
// --link, data/character-current is linked to it. All of it or nothing: a
// failure after the first write undoes every step this run took. The Profile
// is not changed: the character-identity lines to replace by hand are printed.
//   node scripts/adopt-character.cjs --root <data> --id <id> --dir <existing dir>
//     --card <file> --rules <file> --reminder <file> --user-name <name>
//     --hang-on-text <text> [--link]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {parseArgs} = require('node:util');
const {parseCardYaml} = require('./card-yaml.cjs');

const USAGE = '用法：node scripts/adopt-character.cjs --root <数据目录> --id <角色 id> --dir <已有角色目录> --card <卡文件> --rules <rules.md> --reminder <reminder.md> --user-name <称呼> --hang-on-text <等待提示> [--link]';
const REQUIRED = ['root', 'id', 'dir', 'card', 'rules', 'reminder', 'user-name', 'hang-on-text'];
const CARD_NAMES = {'.json': 'card.json', '.png': 'card.png', '.yaml': 'card.yaml', '.yml': 'card.yaml'};
const IDENTITY_KEYS = ['appId', 'ownerId', 'projectId'];
const CURRENT_LINK = 'character-current';

/** The command line as adoption options, or null when it is incomplete. */
function parseOptions(argv) {
  const string = {type: 'string'};
  let values;
  try {
    ({values} = parseArgs({args: argv, strict: true, options: {...Object.fromEntries(REQUIRED.map(key => [key, string])), link: {type: 'boolean'}}}));
  } catch {
    return null;
  }
  if (REQUIRED.some(key => !values[key])) return null;
  return {
    root: path.resolve(values.root),
    id: values.id,
    dir: path.resolve(values.dir),
    sources: {card: path.resolve(values.card), rules: path.resolve(values.rules), reminder: path.resolve(values.reminder)},
    settings: {userName: values['user-name'], hangOnText: values['hang-on-text'], publicExclude: [], revision: 1},
    link: values.link === true,
  };
}

/** The manager modules adoption works with; tests replace single functions to inject failures. */
async function loadModules() {
  const registry = await import('../packages/character-manager/registry.mjs');
  const {compileCharacter, CARD_FILES} = await import('../packages/character-manager/compile.mjs');
  const {writeFileAtomic, writeJsonAtomic} = await import('../packages/character-manager/compiled.mjs');
  return {registry, compileCharacter, CARD_FILES, writeFileAtomic, writeJsonAtomic, link: (target, file) => fs.symlinkSync(target, file, 'junction')};
}

/**
 * Adopts the directory or throws with a Chinese reason, leaving the directory,
 * registry.json and the link as they were.
 * @returns {import('../packages/character-manager/compiled.mjs').Compiled}
 */
function adopt(opts, modules) {
  const {registry} = modules;
  const files = plannedFiles(opts, modules.CARD_FILES);
  check(opts, files, registry);
  const compiled = compileStaged(opts, files, modules.compileCharacter);

  const undo = [];
  try {
    for (const {source, target} of files) {
      if (fs.existsSync(target)) continue;
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      undo.push(() => fs.rmSync(target, {force: true}));
    }
    for (const [name, value] of [['character.json', opts.settings], ['compiled.json', compiled]]) {
      const file = path.join(opts.dir, name);
      undo.push(() => fs.rmSync(file, {force: true}));
      modules.writeJsonAtomic(file, value);
    }
    undo.push(registrySnapshot(opts.root, modules));
    registry.register(opts.root, {id: opts.id, dir: opts.dir, preserveLegacySessions: opts.link});
    if (opts.link) {
      const file = path.join(opts.root, CURRENT_LINK);
      modules.link(opts.dir, file);
      // Only the link this run created is removed, and never recursively.
      undo.push(() => {
        if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
      });
      if (registry.currentId(opts.root) !== opts.id) throw new Error(`${CURRENT_LINK} 没有指向 ${opts.id}`);
    }
    return compiled;
  } catch (error) {
    const left = [];
    for (const step of undo.reverse()) {
      try {
        step();
      } catch (undoError) {
        left.push(undoError.message);
      }
    }
    if (left.length) error.message += `；回滚未完成，请手动检查：${left.join('；')}`;
    throw error;
  }
}

// Undoing register restores registry.json byte for byte (or removes it, and
// the characters directory it created, when there was none before).
function registrySnapshot(root, {registry, writeFileAtomic}) {
  const file = registry.registryFile(root);
  const parent = path.dirname(file);
  const hadParent = fs.existsSync(parent);
  const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
  return () => {
    if (before) {
      writeFileAtomic(file, before);
      return;
    }
    fs.rmSync(file, {force: true});
    if (!hadParent && fs.existsSync(parent) && !fs.readdirSync(parent).length) fs.rmdirSync(parent);
  };
}

// The card, rules and reminder as they will be named in the character directory.
function plannedFiles({dir, sources}, cardFiles) {
  const cardName = CARD_NAMES[path.extname(sources.card).toLowerCase()];
  if (!cardName) throw new Error(`角色卡只能是 ${Object.keys(CARD_NAMES).join(' / ')}：${sources.card}`);
  const other = cardFiles.filter(name => name !== cardName && fs.existsSync(path.join(dir, name)));
  if (other.length) throw new Error(`角色目录里已有另一张角色卡：${other.join(', ')}`);
  return [
    {source: sources.card, target: path.join(dir, cardName)},
    {source: sources.rules, target: path.join(dir, 'rules.md')},
    {source: sources.reminder, target: path.join(dir, 'reminder.md')},
  ];
}

// Everything that can be refused is refused here, before the first write.
function check({root, id, dir, link}, files, registry) {
  if (!registry.validId(id)) throw new Error('角色 id 无效：只能用小写字母、数字和连字符（最长 48 个字符），且不能是 current');
  // The registry's own rule: allowed location, a real directory under <root>, binding.json of this id.
  registry.checkCharacterDirectory(root, id, dir);
  const binding = JSON.parse(fs.readFileSync(path.join(dir, 'binding.json'), 'utf8').replace(/^\uFEFF/, ''));
  const missing = IDENTITY_KEYS.filter(key => typeof binding[key] !== 'string' || !binding[key]);
  if (missing.length) throw new Error(`binding.json 缺少 ${missing.join('、')}，不能接入`);
  if (registry.readRegistry(root).characters.some(entry => entry.id === id)) throw new Error(`角色已注册：${id}`);
  for (const name of ['character.json', 'compiled.json']) {
    if (fs.existsSync(path.join(dir, name))) throw new Error(`角色目录里已有 ${name}，可能已经接入过`);
  }
  for (const {source, target} of files) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`找不到文件：${source}`);
    if (fs.existsSync(target) && !fs.readFileSync(target).equals(fs.readFileSync(source))) {
      throw new Error(`角色目录里已有内容不同的 ${path.basename(target)}`);
    }
  }
  if (link && exists(path.join(root, CURRENT_LINK))) throw new Error(`${CURRENT_LINK} 已存在，不覆盖`);
}

// Compiles a copy in a scratch directory so a card or rules that do not
// compile leave the character directory exactly as it was.
function compileStaged({id, sources, settings}, files, compileCharacter) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-adopt-'));
  try {
    for (const {source, target} of files) fs.copyFileSync(source, path.join(staging, path.basename(target)));
    fs.writeFileSync(path.join(staging, 'character.json'), JSON.stringify(settings));
    return compileCharacter({dir: staging, characterId: id, parseYaml: parseCardYaml}).compiled;
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
}

function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function report({root, id, dir, link}, compiled) {
  const current = `${root.replaceAll('\\', '/')}/${CURRENT_LINK}`;
  console.log(`已接入角色 ${id}（${compiled.name}）：${dir.replaceAll('\\', '/')}`);
  console.log(`Owner 版 ${compiled.tokens.owner} token；公开版待 Owner 在管理页确认。`);
  for (const warning of compiled.warnings) console.log(`⚠ ${warning}`);
  console.log(link ? `${CURRENT_LINK} → ${dir.replaceAll('\\', '/')}` : `未建 ${CURRENT_LINK}（没有 --link）。`);
  console.log('');
  console.log('本脚本不修改 Profile。请在 Profile 中把 character-identity 行整体替换为下面四个键（presetId、memoryMode 保持 Profile 原值），并先另存原件：');
  console.log('  - id: character-identity');
  console.log('    config:');
  console.log('      presetId: <Profile 原值>');
  console.log(`      bindingFile: ${current}/binding.json`);
  console.log(`      stateFile: ${current}/coordination.sqlite`);
  console.log('      memoryMode: <Profile 原值>');
}

async function main() {
  const opts = parseOptions(process.argv.slice(2));
  if (!opts) {
    console.error(USAGE);
    return 1;
  }
  try {
    report(opts, adopt(opts, await loadModules()));
    return 0;
  } catch (error) {
    console.error(`接入失败：${error.message}`);
    return 1;
  }
}

module.exports = {parseOptions, loadModules, adopt};
if (require.main === module) main().then(code => { process.exitCode = code; });
