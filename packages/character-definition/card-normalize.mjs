// Turns a parsed V1, V2 or V3 character card into the small set of fields the
// Persona renderer uses. Pure: no I/O. Fields the deployment ignores
// (greetings, metadata, assets, extensions) are dropped here, not validated.
import {CardError} from './card-error.mjs';

const RENDERED_FIELDS = ['nickname', 'description', 'personality', 'scenario', 'mes_example'];
// Ignored with a warning (see card.mjs), so any value is accepted: a card
// must not fail over a field that never reaches the prompt.
const IGNORED_FIELDS = ['system_prompt', 'post_history_instructions'];
const PERSONA_FIELDS = ['description', 'personality', 'scenario'];

/**
 * @typedef {{name: string, nickname: string, description: string,
 *   personality: string, scenario: string, mes_example: string,
 *   system_prompt: string, post_history_instructions: string,
 *   bookEntryCount: number, bookMalformed: boolean}} CardData
 *   The two ignored fields hold their value as text (non-text values as
 *   JSON) for the warning preview. The lorebook is not used yet: only its
 *   entry count is kept, and a malformed one is flagged instead of rejected.
 *
 * @param {unknown} raw parsed card file
 * @param {string} file used in error messages
 * @returns {{spec: 'v1'|'v2'|'v3', data: CardData}}
 */
export function normalizeCard(raw, file) {
  if (!isObject(raw)) throw new CardError(`角色卡内容必须是对象：${file}`);
  const {spec, source} = detectSpec(raw, file);

  const name = textField(source, 'name', file);
  if (!name.trim()) throw new CardError(`角色卡缺少 name：${file}`);

  const data = {name: name.trim()};
  for (const field of RENDERED_FIELDS) data[field] = textField(source, field, file);
  for (const field of IGNORED_FIELDS) data[field] = previewText(source[field]);
  Object.assign(data, lorebook(source.character_book));

  if (PERSONA_FIELDS.every(field => !data[field].trim())) {
    throw new CardError(`角色卡的 description、personality、scenario 不能全为空：${file}`);
  }
  return {spec, data};
}

function detectSpec(raw, file) {
  if (raw.spec === undefined) {
    // V1 cards keep their fields at the top level and carry no spec marker.
    if (raw.name !== undefined) return {spec: 'v1', source: raw};
    throw new CardError(`无法识别的角色卡（没有 spec，也不是 V1 格式）：${file}`);
  }
  if (raw.spec === 'chara_card_v3') {
    if (typeof raw.spec_version !== 'string' || !raw.spec_version.startsWith('3.')) {
      throw new CardError(`角色卡 spec_version 应为 3.x：${file}（实际为 ${JSON.stringify(raw.spec_version)}）`);
    }
    return {spec: 'v3', source: dataObject(raw, file)};
  }
  if (raw.spec === 'chara_card_v2') return {spec: 'v2', source: dataObject(raw, file)};
  throw new CardError(`不支持的规格 ${JSON.stringify(raw.spec)}：${file}（只支持 chara_card_v2、chara_card_v3 和 V1）`);
}

function dataObject(raw, file) {
  if (!isObject(raw.data)) throw new CardError(`角色卡缺少 data 对象：${file}`);
  return raw.data;
}

function textField(source, field, file) {
  const value = source[field];
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new CardError(`角色卡字段 ${field} 必须是文本（实际为${typeName(value)}）：${file}`);
  }
  return value;
}

function previewText(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function lorebook(book) {
  if (book === undefined || book === null) return {bookEntryCount: 0, bookMalformed: false};
  if (!isObject(book) || (book.entries !== undefined && !Array.isArray(book.entries))) {
    return {bookEntryCount: 0, bookMalformed: true};
  }
  return {bookEntryCount: book.entries?.length ?? 0, bookMalformed: false};
}

function typeName(value) {
  if (Array.isArray(value)) return '列表';
  return {number: '数字', boolean: '布尔值', object: '对象'}[typeof value] ?? typeof value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
