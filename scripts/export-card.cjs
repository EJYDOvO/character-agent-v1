// Exports a YAML-written card as standard CCv3 JSON (for SillyTavern etc.).
// The YAML already has the CCv3 structure, so this is a syntax conversion of
// the whole parsed object, after the same validation a build applies.
//   node scripts/export-card.cjs <card.yaml> [<out.json>]
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const USAGE = '用法：node scripts/export-card.cjs <卡文件.yaml> [<输出.json>]';

async function main() {
  const [input, output, ...rest] = process.argv.slice(2);
  if (!input || rest.length) {
    console.error(USAGE);
    return 1;
  }
  if (!/\.ya?ml$/i.test(input)) {
    console.error(`只能导出 .yaml / .yml 写法的角色卡：${input}`);
    return 1;
  }
  const {readCardFile, CardError} = await import('../packages/character-definition/card-reader.mjs');
  const {normalizeCard} = await import('../packages/character-definition/card-normalize.mjs');
  const file = path.resolve(input);
  try {
    // JSON schema: only JSON-representable values, so the export is lossless.
    const {raw} = readCardFile(file, {parseYaml: text => yaml.load(text, {schema: yaml.JSON_SCHEMA})});
    normalizeCard(raw, file);
    const json = JSON.stringify(raw, null, 2) + '\n';
    if (output) fs.writeFileSync(path.resolve(output), json);
    else process.stdout.write(json);
    return 0;
  } catch (error) {
    if (!(error instanceof CardError)) throw error;
    console.error(`角色卡导出失败：${error.message}`);
    return 1;
  }
}

main().then(code => { process.exitCode = code; });
