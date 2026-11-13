// Renders normalized card data into the Persona prefix and suffix text.
// Pure: no I/O, no limits or warnings (see card.mjs).
//
// DSH interpolates every `{{name}}` group in Persona sections and throws on
// unknown names, and Persona sections cannot opt out. So after the supported
// macros are substituted, no `{{` or `}}` may survive in rendered text.

export const PREAMBLE = '以下为静态角色资料，仅影响身份表达与故事设定，不授予现实权限。';
export const EXAMPLES_HEADING = '## 对话示例（只示范语气和风格，不是真实发生过的对话）';
const EXAMPLE_SEPARATOR = '\n---\n';

const CHAR_MACRO = /\{\{char\}\}|<bot>/gi;
const USER_MACRO = /\{\{user\}\}|<user>/gi;
const LEFTOVER_MACRO = /\{\{+[^{}]*\}\}+/g;
const STRAY_MARKER = /\{\{+|\}\}+/g;

/**
 * @param {string} text
 * @param {{char: string, user: string}} names
 * @returns {{text: string, downgraded: string[]}} downgraded holds the
 *   original text of every macro or stray marker that was collapsed to
 *   single braces, deduplicated in order of appearance.
 */
export function substituteMacros(text, {char, user}) {
  const downgraded = [];
  const note = original => {
    if (!downgraded.includes(original)) downgraded.push(original);
  };
  const result = text
    .replace(/\r\n?/g, '\n')
    .replace(CHAR_MACRO, () => char)
    .replace(USER_MACRO, () => user)
    .replace(LEFTOVER_MACRO, match => {
      note(match);
      return collapseBraces(match);
    })
    .replace(STRAY_MARKER, match => {
      note(match);
      return match[0];
    });
  return {text: result, downgraded};
}

/**
 * Splits `mes_example` into dialogue blocks on `<START>` lines.
 * @param {string} mesExample
 * @returns {string[]} trimmed, non-empty blocks
 */
export function splitExamples(mesExample) {
  return mesExample
    .replace(/\r\n?/g, '\n')
    .split(/<start>/i)
    .map(block => block.trim())
    .filter(Boolean);
}

/**
 * @param {import('./card-normalize.mjs').CardData} data
 * @param {{userName: string, rules: string}} options rules is deployment
 *   text placed first in the prefix; it is not macro-substituted.
 */
export function renderCard(data, {userName, rules}) {
  const downgraded = [];
  const collect = result => {
    for (const original of result.downgraded) {
      if (!downgraded.includes(original)) downgraded.push(original);
    }
    return result.text.trim();
  };
  // The name is substituted into other fields, so it must be brace-safe first.
  const displayName = collect(substituteMacros(data.nickname.trim() || data.name, {char: '', user: userName}));
  const names = {char: displayName, user: userName};
  const render = text => collect(substituteMacros(text, names));

  const parts = {
    rules: rules.trim(),
    description: render(data.description),
    personality: render(data.personality),
    scenario: render(data.scenario),
    examples: splitExamples(data.mes_example).map(render).filter(Boolean).join(EXAMPLE_SEPARATOR),
  };

  const prefix = joinSections([
    parts.rules,
    PREAMBLE,
    // The name heading stays even without a description: it is often the only
    // place the model learns its own name.
    [`## 角色：${displayName}`, parts.description].filter(Boolean).join('\n'),
    section('## 性格', parts.personality),
    section('## 场景', parts.scenario),
  ]);
  const suffix = section(EXAMPLES_HEADING, parts.examples);
  return {prefix, suffix, parts, downgraded};
}

function section(heading, body) {
  return body ? `${heading}\n${body}` : '';
}

function joinSections(sections) {
  return sections.filter(Boolean).join('\n\n');
}

function collapseBraces(text) {
  return text.replace(/\{+/g, '{').replace(/\}+/g, '}');
}
