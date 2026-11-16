// Entry point of the character card pipeline: read → normalize → render →
// measure. Applies the deployment limits and collects build warnings; the
// stages themselves live in the card-*.mjs modules.
import {readCardFile, readRulesFile, CardError} from './card-reader.mjs';
import {normalizeCard} from './card-normalize.mjs';
import {renderCard, EXCLUDABLE_FIELDS} from './card-render.mjs';
import {estimatePromptTokens} from './card-tokens.mjs';

export {CardError, estimatePromptTokens};

export const WARN_TOKENS = 3000;
export const MAX_TOKENS = 8000;
// The reminder is re-validated by the Character plugin and Interaction at
// Host start; rejecting it here keeps that from ever failing in production.
// tests/reminder-limit.test.mjs keeps the three limits equal.
export const MAX_REMINDER_CHARS = 4000;
export const DEFAULT_USER_NAME = '用户';
export const MAX_RELATIONSHIP_CHARS = 2000;
const MAX_NAME_CHARS = 32;

// Card fields that carry rules the deployment replaces with its own files,
// as [CardData key, name shown in the warning].
const IGNORED_RULE_FIELDS = [
  ['system_prompt', 'system_prompt'],
  ['post_history_instructions', 'post_history_instructions'],
  ['depth_prompt', 'extensions.depth_prompt'],
];
const IGNORED_PREVIEW_CHARS = 60;
const CONTENT_FIELDS = ['rules', 'description', 'personality', 'scenario', 'examples'];

/**
 * @typedef {{name: string, spec: 'v1'|'v2'|'v3', prefix: string,
 *   suffix: string, reminder: string, userFields: string[],
 *   tokens: {total: number, fields: Record<string, number>},
 *   warnings: string[],
 *   inputs: {card: Buffer, systemRules: Buffer|null, reminder: Buffer|null}}} CardBuild
 *   inputs holds the files exactly as read, so a build can fingerprint the
 *   content it rendered rather than re-reading files that may have changed.
 *
 * @param {{cardPath: string, systemRulesPath?: string|null,
 *   reminderPath?: string|null, userName?: unknown,
 *   parseYaml: (text: string) => unknown, relationship?: string,
 *   exclude?: string[], nickname?: string}} options relationship is the
 *   section about who the character talks to; exclude names fields to leave
 *   out of the Persona (see EXCLUDABLE_FIELDS); nickname overrides the card's.
 * @returns {CardBuild}
 */
export function loadCard({cardPath, systemRulesPath = null, reminderPath = null, userName, parseYaml,
  relationship = '', exclude = [], nickname}) {
  const user = resolveShortName(userName ?? DEFAULT_USER_NAME, 'userName');
  const unknown = exclude.filter(field => !EXCLUDABLE_FIELDS.includes(field));
  if (unknown.length) throw new CardError(`exclude 含未知字段 ${unknown.join('、')}：应为 ${EXCLUDABLE_FIELDS.join('、')}`);
  const card = readCardFile(cardPath, {parseYaml});
  const {spec, data} = normalizeCard(card.raw, cardPath);
  if (nickname !== undefined) data.nickname = resolveShortName(nickname, '昵称');
  const rules = readOptionalRules(systemRulesPath);
  const reminder = readOptionalRules(reminderPath);
  if ([...reminder.text].length > MAX_REMINDER_CHARS) {
    throw new CardError(`末尾提醒超过 ${MAX_REMINDER_CHARS} 字：${reminderPath}`);
  }

  const relation = checkOwnText(relationship, '关系段', MAX_RELATIONSHIP_CHARS);
  const {displayName, prefix, suffix, parts, downgraded, userFields} = renderCard(data, {
    userName: user, rules: rules.text, relationship: relation, exclude,
  });
  const tokens = measure({prefix, suffix, reminder: reminder.text, parts});
  if (tokens.total > MAX_TOKENS) {
    throw new CardError(`渲染后的人设约 ${tokens.total} token，上限 ${MAX_TOKENS}。占比最大的字段：${largestFields(tokens.fields)}（${cardPath}）`);
  }

  return {
    name: displayName,
    spec,
    prefix,
    suffix,
    reminder: reminder.text,
    userFields,
    tokens,
    warnings: collectWarnings(data, downgraded, tokens.total),
    inputs: {card: card.bytes, systemRules: rules.bytes, reminder: reminder.bytes},
  };
}

// A name or form of address is substituted into the Persona, so it must be
// short and unable to form a `{{` group or break a line.
function resolveShortName(value, label) {
  const valid = typeof value === 'string' && value.trim() && [...value].length <= MAX_NAME_CHARS && !/[{}\r\n]/.test(value);
  if (!valid) throw new CardError(`${label} 无效：应为 1-${MAX_NAME_CHARS} 个字符，不能包含花括号或换行`);
  return value.trim();
}

function readOptionalRules(file) {
  if (!file) return {text: '', bytes: null};
  const rules = readRulesFile(file);
  return {...rules, text: checkOwnText(rules.text, '规则文件', Infinity, file)};
}

// Rules and the relationship section are our own text: a macro in them is a
// mistake, not something to fix up.
function checkOwnText(text, label, maxChars, where = '') {
  if (/\{\{|\}\}/.test(text)) throw new CardError(`${label}不能包含 {{ 或 }}${where && `：${where}`}`);
  if ([...text].length > maxChars) throw new CardError(`${label}超过 ${maxChars} 字`);
  return text;
}

// Every token of the rendered prompt is attributed to one field; the
// preamble, headings and separators form `overhead`, so fields sum to total.
function measure({prefix, suffix, reminder, parts}) {
  const fields = {};
  for (const field of CONTENT_FIELDS) fields[field] = estimatePromptTokens(parts[field]);
  fields.reminder = estimatePromptTokens(reminder);
  const total = estimatePromptTokens(prefix) + estimatePromptTokens(suffix) + fields.reminder;
  const content = Object.values(fields).reduce((sum, value) => sum + value, 0);
  fields.overhead = Math.max(0, total - content);
  return {total: content + fields.overhead, fields};
}

function largestFields(fields) {
  return Object.entries(fields)
    .filter(([field, value]) => field !== 'overhead' && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([field, value]) => `${field} ${value}`)
    .join('、');
}

function collectWarnings(data, downgraded, totalTokens) {
  const warnings = [];
  for (const [key, label] of IGNORED_RULE_FIELDS) {
    // One line, so a multi-line field does not break up the warning.
    const text = data[key].replace(/\s+/g, ' ').trim();
    if (text) warnings.push(`已忽略 ${label}：「${[...text].slice(0, IGNORED_PREVIEW_CHARS).join('')}」`);
  }
  if (data.bookMalformed) warnings.push('设定集格式不正确，已忽略（第二期才生效）');
  else if (data.bookEntryCount > 0) warnings.push(`设定集 ${data.bookEntryCount} 条，第二期才生效，目前不起作用`);
  if (downgraded.length) warnings.push(`以下宏已降级为单花括号：${downgraded.join('、')}`);
  if (totalTokens > WARN_TOKENS) warnings.push(`人设约 ${totalTokens} token，超过 ${WARN_TOKENS}，模型可能忽略部分规则`);
  return warnings;
}
