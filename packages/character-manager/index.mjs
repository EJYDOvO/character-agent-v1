// Host plugin of the character manager: serves the settings page's RPC on the
// loopback web listener and reports, for the watchdog, which character this
// Host started with and where its persona came from.
import path from 'node:path';
import yaml from 'js-yaml';
import {controller} from './controller.mjs';
import {handler} from './http.mjs';
import {writeJsonAtomic} from './compiled.mjs';
import {personaState} from './runtime-persona.mjs';

export const name = 'character-manager';
export const inject = ['webServer', 'connection', 'characterIdentity'];

const ROUTE = '/character-manager';
// Same schema as scripts/card-yaml.cjs: no YAML-only types in cards.
const parseYaml = text => yaml.load(text, {schema: yaml.JSON_SCHEMA});

/**
 * @param {object} ctx
 * @param {{root: string, maintenanceDirectory: string, featuresFile: string, profileFile?: string}} config
 */
export function apply(ctx, config = {}) {
  const {root, maintenanceDirectory, featuresFile, profileFile} = config;
  for (const [key, value] of Object.entries({root, maintenanceDirectory, featuresFile})) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`Invalid character manager option: ${key}`);
  }
  if (profileFile !== undefined && (typeof profileFile !== 'string' || !path.isAbsolute(profileFile))) {
    throw new Error('Invalid character manager option: profileFile');
  }
  if (!['127.0.0.1', '::1'].includes(ctx.webServer.host)) throw new Error('Character manager requires a loopback DSH Web listener');

  writeRuntimeHealth(ctx, root);

  let closed = false;
  const serve = handler({
    connection: ctx.connection,
    origin: () => ctx.webServer.getOrigin(),
    dispatch: controller({root, maintenanceDirectory, featuresFile, profileFile, parseYaml}),
    isClosed: () => closed,
  });
  ctx.effect(() => {
    const release = ctx.webServer.register({kind: 'prefix', path: ROUTE, handler: serve});
    return () => {
      closed = true;
      release();
    };
  });
}

// What the watchdog checks after a switch: this process, the character it
// loaded, and whether the persona came from a valid compiled.json.
function writeRuntimeHealth(ctx, root) {
  const current = path.join(root, 'character-current');
  const state = personaState(path.join(current, 'compiled.json'), path.join(current, 'binding.json')).read();
  const health = {
    pid: process.pid,
    characterId: ctx.characterIdentity.conversationScope().characterId,
    personaSource: state.source,
    compiledRevision: state.source === 'compiled' ? state.compiled.revision : null,
    at: Date.now(),
  };
  try {
    writeJsonAtomic(path.join(current, 'runtime-health.json'), health);
  } catch {
    // No health file means the watchdog does not accept the start; the Host itself keeps running.
  }
}
