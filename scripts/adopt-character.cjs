// First-time adoption: brings an existing character directory (the old layout
// data/character-<id>, possibly open in a running Host) under the character
// manager. Only new files are added — the card, rules and reminder copied in,
// character.json and compiled.json — and binding.json, the databases and the
// conversations stay untouched. Then the directory is registered and, with
// --link, data/character-current is linked to it. The Profile is not changed:
// the character-identity lines to replace by hand are printed at the end.
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

function options(argv) {
  const string = {type: 'string'};
  const {values} = parseArgs({args: argv, strict: true, options: {...Object.fromEntries(REQUIRED.map(key => [key, string])), link: {type: 'boolean'}}});
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

async function main() {
  let opts;
  try {
    opts = options(process.argv.slice(2));
  } catch {
    opts = null;
  }
  if (!opts) {
    console.error(USAGE);
    return 1;
  }
  const registry = await import('../packages/character-manager/registry.mjs');
  const {compileCharacter, CARD_FILES} = await import('../packages/character-manager/compile.mjs');
  const {writeJsonAtomic} = await import('../packages/character-manager/compiled.mjs');
  try {
    const files = plannedFiles(opts, CARD_FILES);
    check(opts, files, registry);
    const compiled = compileStaged(opts, files, compileCharacter);
    const created = [];
    try {
      for (const {source, target} of files) {
        if (fs.existsSync(target)) continue;
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
        created.push(target);
      }
      for (const [name, value] of [['character.json', opts.settings], ['compiled.json', compiled]]) {
        writeJsonAtomic(path.join(opts.dir, name), value);
        created.push(path.join(opts.dir, name));
      }
      registry.register(opts.root, {id: opts.id, dir: opts.dir});
    } catch (error) {
      for (const file of created) fs.rmSync(file, {force: true});
      throw error;
    }
    if (opts.link) {
      fs.symlinkSync(opts.dir, path.join(opts.root, CURRENT_LINK), 'junction');
      if (registry.currentId(opts.root) !== opts.id) throw new Error(`${CURRENT_LINK} 已创建，但没有指向 ${opts.id}，请检查`);
    }
    report(opts, compiled);
    return 0;
  } catch (error) {
    console.error(`接入失败：${error.message}`);
    return 1;
  }
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
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`角色目录不存在：${dir}`);
  const binding = readBinding(dir);
  if (binding.characterId !== id) throw new Error(`binding.json 的 characterId 不是 ${id}`);
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

// binding.json is never written here; adoption requires the complete one the Host already uses.
function readBinding(dir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dir, 'binding.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (value !== null && typeof value === 'object') return value;
  } catch {
    // Reported below.
  }
  throw new Error('角色目录缺少有效的 binding.json');
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
  if (compiled.warnings.length) for (const warning of compiled.warnings) console.log(`⚠ ${warning}`);
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

main().then(code => { process.exitCode = code; });
