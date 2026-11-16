// Preset plugin: the Persona of whichever character is current. The text is
// read from compiled.json whenever DSH assembles a prompt, so an edit, an
// approval or a character switch needs no rebuild. It depends on compiled.mjs
// and node built-ins only, so the Host-side path stays small.
import fs from 'node:fs';
import path from 'node:path';
import {NEUTRAL_PERSONA, readCompiled} from './compiled.mjs';

export const name = 'character-runtime-persona';
export const inject = ['systemPrompt'];

const REMINDER_CONTEXT = 'character:reminder';
const REMINDER_ORDER = 95;
const AUDIENCES = ['owner', 'public'];
const NEUTRAL = Object.freeze({prefix: NEUTRAL_PERSONA, suffix: '', reminder: ''});

/**
 * @param {{systemPrompt: {getSectionOrder: Function, section: Function, context: Function}, effect: Function}} ctx
 * @param {{audience: 'owner'|'public', compiledFile: string, bindingFile: string}} config
 */
export function apply(ctx, config = {}) {
  const {audience, compiledFile, bindingFile} = config;
  if (!AUDIENCES.includes(audience)) throw new Error('Invalid persona option: audience');
  for (const [key, value] of Object.entries({compiledFile, bindingFile})) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`Invalid persona option: ${key}`);
  }
  const state = personaState(compiledFile, bindingFile);
  const view = () => textFor(state.read(), audience);
  const {systemPrompt} = ctx;
  ctx.effect(() => systemPrompt.section({
    name: 'deployment:persona-prefix', order: systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: () => view().prefix,
  }));
  ctx.effect(() => systemPrompt.section({
    name: 'deployment:persona-suffix', order: systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'), text: () => view().suffix,
  }));
  // The reminder is deployment-authored: prompt interpolation stays off.
  ctx.effect(() => systemPrompt.context({name: REMINDER_CONTEXT, order: REMINDER_ORDER, interpolate: false, text: () => view().reminder}));
}

/**
 * Reads compiled.json when its mtime or size changed. A read that fails keeps
 * the last good content of this process; before any good read the state is
 * neutral. The character id comes from binding.json, read once it is readable.
 * @param {string} file compiled.json
 * @param {string} bindingFile
 * @returns {{read: () => {source: 'compiled', compiled: import('./compiled.mjs').Compiled} | {source: 'neutral'}}}
 */
export function personaState(file, bindingFile) {
  let characterId, key = null, last = null;
  const current = () => (last ? {source: 'compiled', compiled: last} : {source: 'neutral'});
  return {
    read() {
      let stat;
      try {
        stat = fs.statSync(file);
        characterId ??= readCharacterId(bindingFile);
      } catch {
        return current();
      }
      const next = `${stat.mtimeMs}:${stat.size}`;
      if (next === key) return current();
      key = next;
      try {
        last = readCompiled(file, {characterId});
      } catch {
        // Keep the last good content.
      }
      return current();
    },
  };
}

function textFor(state, audience) {
  if (state.source !== 'compiled') return NEUTRAL;
  const {compiled} = state;
  const persona = audience === 'public' ? compiled.public : compiled.owner;
  return persona ? {prefix: persona.prefix, suffix: persona.suffix, reminder: compiled.reminder} : NEUTRAL;
}

function readCharacterId(bindingFile) {
  const {characterId} = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
  if (typeof characterId !== 'string' || !characterId) throw new Error('binding.json has no characterId');
  return characterId;
}
