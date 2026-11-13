import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import {estimatePromptTokens} from '../packages/character-definition/card-tokens.mjs';
import {readCardFile, extractPngCardText, CardError} from '../packages/character-definition/card-reader.mjs';

const V3 = {spec: 'chara_card_v3', spec_version: '3.0', data: {name: 'A', description: 'd'}};
const V2 = {spec: 'chara_card_v2', spec_version: '2.0', data: {name: 'B', description: 'd'}};
const options = {parseYaml: text => yaml.load(text)};

function tempFile(name, content) {
  const file = join(mkdtempSync(join(tmpdir(), 'card-reader-')), name);
  writeFileSync(file, content);
  return file;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

// Minimal PNG container: signature, tEXt chunks and IEND. CRCs are zero on
// purpose; the reader does not validate them.
function png(texts) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const textChunks = texts.map(([keyword, value]) =>
    chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]),
      Buffer.from(Buffer.from(JSON.stringify(value), 'utf8').toString('base64'), 'latin1')])));
  return Buffer.concat([signature, ...textChunks, chunk('IEND', Buffer.alloc(0))]);
}

function assertCardError(fn, pattern, file) {
  assert.throws(fn, error => {
    assert(error instanceof CardError, 'expected CardError, got ' + error);
    assert.match(error.message, pattern);
    assert(error.message.includes(file), 'message should name the file: ' + error.message);
    return true;
  });
}

test('estimatePromptTokens uses DeepSeek ratios', () => {
  assert.equal(estimatePromptTokens(''), 0);
  assert.equal(estimatePromptTokens('abcdefghij'), 3);
  assert.equal(estimatePromptTokens('一二三四五'), 3);
  assert.equal(estimatePromptTokens('ab一'), 2);
  assert.equal(estimatePromptTokens('😀'), 1);
});

test('readCardFile reads json and yaml and strips BOM', () => {
  const json = tempFile('card.json', '﻿' + JSON.stringify(V3));
  const fromJson = readCardFile(json, options);
  assert.equal(fromJson.format, 'json');
  assert.equal(fromJson.raw.spec, 'chara_card_v3');
  assert(Buffer.isBuffer(fromJson.bytes));

  const yml = tempFile('card.YAML', '﻿' + yaml.dump(V3));
  const fromYaml = readCardFile(yml, options);
  assert.equal(fromYaml.format, 'yaml');
  assert.equal(fromYaml.raw.data.name, 'A');
});

test('PNG: ccv3 chunk wins over chara; chara alone is used', () => {
  const both = tempFile('both.png', png([['chara', V2], ['ccv3', V3]]));
  assert.equal(readCardFile(both, options).raw.spec, 'chara_card_v3');
  assert.equal(readCardFile(both, options).format, 'png');

  const legacy = tempFile('legacy.png', png([['chara', V2]]));
  assert.equal(readCardFile(legacy, options).raw.spec, 'chara_card_v2');
  assert.equal(JSON.parse(extractPngCardText(png([['chara', V2]]))).data.name, 'B');

  const empty = tempFile('empty.png', png([['Comment', {x: 1}]]));
  assertCardError(() => readCardFile(empty, options), /PNG 中没有角色卡数据/, empty);
});

test('size, encoding, syntax and format errors', () => {
  const bigJson = tempFile('big.json', Buffer.alloc(1048577, 0x20));
  assertCardError(() => readCardFile(bigJson, options), /1 MB/, bigJson);

  const bigPng = tempFile('big.png', Buffer.alloc(20971521));
  assertCardError(() => readCardFile(bigPng, options), /20 MB/, bigPng);

  const notUtf8 = tempFile('bad.json', Buffer.from([0xff, 0xfe, 0xfd]));
  assertCardError(() => readCardFile(notUtf8, options), /UTF-8/, notUtf8);

  const badJson = tempFile('syntax.json', '{"spec":');
  assertCardError(() => readCardFile(badJson, options), /JSON/, badJson);

  const badYaml = tempFile('syntax.yaml', 'a: [');
  assertCardError(() => readCardFile(badYaml, options), /YAML/, badYaml);

  for (const name of ['card.charx', 'card.webp']) {
    const file = tempFile(name, 'x');
    assertCardError(() => readCardFile(file, options), /不支持的角色卡格式/, file);
  }

  const fake = tempFile('fake.png', 'not a png at all');
  assertCardError(() => readCardFile(fake, options), /不是有效的 PNG/, fake);

  const missing = join(tmpdir(), 'card-reader-missing', 'none.json');
  assertCardError(() => readCardFile(missing, options), /无法读取/, missing);
});

test('truncated PNG chunk is rejected', () => {
  const full = png([['ccv3', V3]]);
  const file = tempFile('cut.png', full.subarray(0, 20));
  assertCardError(() => readCardFile(file, options), /不是有效的 PNG/, file);
});
