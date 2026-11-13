// Checks a character card without building: what the Persona would cost and
// which warnings or errors a build would report. Reads no deployment config.
//   node scripts/check-card.cjs <card> [--rules <file>] [--reminder <file>] [--user-name <name>]
const path = require('node:path');
const yaml = require('js-yaml');

const USAGE = '用法：node scripts/check-card.cjs <卡文件> [--rules <规则文件>] [--reminder <末尾提醒文件>] [--user-name <用户称呼>]';
const FLAGS = {'--rules': 'systemRulesPath', '--reminder': 'reminderPath', '--user-name': 'userName'};

function parseArgs(args) {
  const options = {};
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const key = FLAGS[args[i]];
    if (key) {
      if (i + 1 >= args.length) return null;
      options[key] = args[++i];
    } else if (args[i].startsWith('--')) {
      return null;
    } else {
      files.push(args[i]);
    }
  }
  if (files.length !== 1) return null;
  return {cardPath: path.resolve(files[0]), ...options};
}

function report(build, {WARN_TOKENS, MAX_TOKENS}) {
  const fields = Object.entries(build.tokens.fields).map(([field, value]) => `${field} ${value}`).join(' / ');
  return [
    `角色：${build.name}（${build.spec}）`,
    `人设约 ${build.tokens.total} token（警告线 ${WARN_TOKENS}，上限 ${MAX_TOKENS}）`,
    `  ${fields}`,
    ...build.warnings.map(warning => `⚠ ${warning}`),
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error(USAGE);
    return 1;
  }
  const card = await import('../packages/character-definition/card.mjs');
  try {
    const build = card.loadCard({...options, parseYaml: text => yaml.load(text)});
    console.log(report(build, card));
    return 0;
  } catch (error) {
    if (!(error instanceof card.CardError)) throw error;
    console.error(`角色卡检查失败：${error.message}`);
    return 1;
  }
}

main().then(code => { process.exitCode = code; });
