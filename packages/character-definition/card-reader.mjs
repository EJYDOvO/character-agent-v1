// Reads a character card file into its parsed object. The only module of the
// card pipeline that touches the file system; it knows file formats, not card
// semantics (see card-normalize.mjs).
import {readFileSync} from 'node:fs';
import {extname} from 'node:path';
import {CardError} from './card-error.mjs';

export {CardError};

const MB = 1024 * 1024;
const FORMATS = {
  '.json': {format: 'json', maxBytes: MB, limit: '1 MB'},
  '.yaml': {format: 'yaml', maxBytes: MB, limit: '1 MB'},
  '.yml': {format: 'yaml', maxBytes: MB, limit: '1 MB'},
  '.png': {format: 'png', maxBytes: 20 * MB, limit: '20 MB'},
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// SillyTavern writes the V3 card as `ccv3` and keeps a V2 copy as `chara`.
const PNG_CARD_KEYWORDS = ['ccv3', 'chara'];

/**
 * @param {string} file
 * @param {{parseYaml: (text: string) => unknown}} options
 * @returns {{raw: unknown, bytes: Buffer, format: 'json'|'png'|'yaml'}}
 */
export function readCardFile(file, {parseYaml}) {
  const kind = FORMATS[extname(file).toLowerCase()];
  if (!kind) throw new CardError(`不支持的角色卡格式：${file}（只支持 .json、.png、.yaml、.yml）`);

  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    throw new CardError(`无法读取角色卡：${file}（${error.code ?? error.message}）`);
  }
  if (bytes.length > kind.maxBytes) {
    throw new CardError(`角色卡文件超过 ${kind.limit}：${file}（${bytes.length} 字节）`);
  }

  if (kind.format === 'png') {
    let text;
    try {
      text = extractPngCardText(bytes);
    } catch (error) {
      throw new CardError(`${error.message}：${file}`);
    }
    return {raw: parseJson(text, file), bytes, format: 'png'};
  }

  const text = decodeUtf8(bytes, file);
  if (kind.format === 'json') return {raw: parseJson(text, file), bytes, format: 'json'};
  try {
    return {raw: parseYaml(text), bytes, format: 'yaml'};
  } catch (error) {
    throw new CardError(`角色卡 YAML 解析失败：${file}（${firstLine(error.message)}）`);
  }
}

/**
 * Returns the card JSON text stored in a PNG `tEXt` chunk, preferring `ccv3`.
 * Chunk CRCs are not checked: a damaged image is still a readable card.
 * @param {Buffer} bytes
 * @returns {string}
 */
export function extractPngCardText(bytes) {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是有效的 PNG');
  }
  const found = new Map();
  let offset = PNG_SIGNATURE.length;
  for (;;) {
    if (offset + 8 > bytes.length) throw new Error('不是有效的 PNG（数据块被截断）');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error('不是有效的 PNG（数据块被截断）');
    if (type === 'IEND') break;
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd);
      const separator = data.indexOf(0);
      const keyword = separator < 0 ? '' : data.toString('latin1', 0, separator);
      if (PNG_CARD_KEYWORDS.includes(keyword) && !found.has(keyword)) {
        found.set(keyword, data.toString('latin1', separator + 1));
      }
    }
    offset = dataEnd + 4;
  }
  const keyword = PNG_CARD_KEYWORDS.find(name => found.has(name));
  if (!keyword) throw new Error('PNG 中没有角色卡数据');
  const decoded = Buffer.from(found.get(keyword), 'base64');
  return decodeUtf8(decoded, `PNG ${keyword} 块`);
}

function decodeUtf8(bytes, where) {
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new CardError(`角色卡不是有效的 UTF-8 文本：${where}`);
  }
  return text.replace(/^﻿/, '');
}

function parseJson(text, file) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CardError(`角色卡 JSON 解析失败：${file}（${error.message}）`);
  }
}

function firstLine(text) {
  return String(text).split('\n')[0];
}
