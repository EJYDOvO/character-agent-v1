// Maps the RPC operations of the settings page onto the registry, the
// compiler and the switch request. It checks request shapes and hides file
// system paths; it does no HTTP and holds no state.
import fs from 'node:fs';
import os from 'node:os';
import {approvePublic, compileCharacter, ensureCompiled, readSettings, readTexts, saveCharacter} from './compile.mjs';
import {
  appendUpload, archiveCharacter, beginUpload, cardInfo, characterDir, currentId, exportCard, importCharacter, readRegistry,
} from './registry.mjs';
import {requestSwitch, switchStatus} from './switch.mjs';

const PROFILE_WARNING = '检测到 Profile 覆盖了 persona 行（例如 Preset Manager 的修改），运行时人设可能被盖掉。';
const PATH_LIKE = /path|dir|file/i;
const SETTINGS_DRAFT_KEYS = ['userName', 'nickname', 'hangOnText', 'relationship', 'publicExclude'];
const DRAFT_KEYS = ['settings', 'rules', 'reminder'];

// operation -> the parameters it takes
const OPERATIONS = {
  list: [],
  get: ['id'],
  uploadBegin: [],
  uploadChunk: ['uploadId', 'index', 'data'],
  import: ['uploadId', 'id', 'userName'],
  preview: ['id', 'draft'],
  save: ['id', 'draft', 'revision'],
  approvePublic: ['id', 'hash'],
  exportCard: ['id'],
  switch: ['id'],
  switchStatus: [],
  archive: ['id'],
};

/**
 * @param {{root: string, maintenanceDirectory: string, featuresFile: string,
 *   profileFile?: string, parseYaml: (text: string) => unknown}} options
 * @returns {(request: unknown) => unknown}
 */
export function controller({root, maintenanceDirectory, featuresFile, profileFile, parseYaml}) {
  const operations = {
    list: () => ({
      characters: readRegistry(root).characters.map(entry => summary(entry)),
      switch: switchStatus({maintenanceDirectory}),
      profileWarnings: profileWarnings(),
    }),
    get({id}) {
      const dir = characterDir(root, id);
      return {
        settings: readSettings(dir),
        ...readTexts(dir),
        compiled: ensureCompiled({dir, characterId: id, parseYaml}),
        card: cardInfo(root, id, parseYaml),
      };
    },
    uploadBegin: () => ({uploadId: beginUpload(root)}),
    uploadChunk: ({uploadId, index, data}) => appendUpload(root, uploadId, index, data),
    import({uploadId, id, userName}) {
      if (userName !== undefined && typeof userName !== 'string') throw new Error('userName 必须是文本');
      return importCharacter(root, {uploadId, id, userName, parseYaml});
    },
    preview: ({id, draft}) => ({compiled: compileCharacter({dir: characterDir(root, id), characterId: id, parseYaml, draft: cleanDraft(draft)}).compiled}),
    save({id, draft, revision}) {
      if (!Number.isInteger(revision)) throw new Error('缺少 revision');
      return saveCharacter({dir: characterDir(root, id), characterId: id, parseYaml, draft: cleanDraft(draft), revision});
    },
    approvePublic({id, hash}) {
      if (typeof hash !== 'string' || !hash) throw new Error('缺少公开版 hash');
      return approvePublic({dir: characterDir(root, id), characterId: id, parseYaml, hash});
    },
    exportCard: ({id}) => exportCard(root, id, parseYaml),
    switch: ({id}) => requestSwitch({root, maintenanceDirectory, featuresFile, target: id}),
    switchStatus: () => switchStatus({maintenanceDirectory}),
    archive({id}) {
      archiveCharacter(root, id);
      return {ok: true};
    },
  };

  // One character that cannot be read must not hide the others.
  function summary(entry) {
    const base = {id: entry.id, name: entry.id, current: false, archived: entry.archived, tokens: 0, warningCount: 0, publicPending: false, publicApproved: false};
    if (entry.archived) return base;
    base.current = currentId(root) === entry.id;
    try {
      const compiled = ensureCompiled({dir: characterDir(root, entry.id), characterId: entry.id, parseYaml});
      return {...base, name: compiled.name, tokens: compiled.tokens.owner, warningCount: compiled.warnings.length,
        publicPending: compiled.pendingPublic !== undefined, publicApproved: compiled.public !== undefined};
    } catch (error) {
      return {...base, error: scrub(error.message)};
    }
  }

  function profileWarnings() {
    if (!profileFile) return [];
    try {
      return overridesPersona(parseYaml(fs.readFileSync(profileFile, 'utf8'))) ? [PROFILE_WARNING] : [];
    } catch {
      return [];
    }
  }

  const hidden = [root, os.tmpdir()].flatMap(path => [path, path.replace(/\//g, '\\'), path.replace(/\\/g, '/')]).filter(Boolean);
  function scrub(message) {
    return hidden.reduce((text, path) => text.replace(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '…'), String(message));
  }

  return request => {
    const {operation, ...params} = checkRequest(request);
    try {
      return operations[operation](params);
    } catch (error) {
      throw new Error(scrub(error.message));
    }
  };
}

function checkRequest(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) throw new Error('请求无效');
  const {operation} = request;
  if (typeof operation !== 'string' || !Object.hasOwn(OPERATIONS, operation)) throw new Error('未知操作');
  const keys = Object.keys(request).filter(key => key !== 'operation');
  if (keys.some(key => PATH_LIKE.test(key))) throw new Error('请求不能带路径参数');
  const unknown = keys.filter(key => !OPERATIONS[operation].includes(key));
  if (unknown.length) throw new Error(`未知参数：${unknown.join('、')}`);
  return request;
}

// The page may edit the texts and the five settings it shows; approval and
// revision are decided by the compiler, never by the request.
function cleanDraft(draft) {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('草稿无效');
  const unknown = Object.keys(draft).filter(key => !DRAFT_KEYS.includes(key));
  if (unknown.length) throw new Error(`草稿含未知项：${unknown.join('、')}`);
  for (const key of ['rules', 'reminder']) {
    if (draft[key] !== undefined && typeof draft[key] !== 'string') throw new Error(`草稿的 ${key} 必须是文本`);
  }
  if (draft.settings !== undefined) {
    const {settings} = draft;
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('草稿的 settings 无效');
    const bad = Object.keys(settings).filter(key => !SETTINGS_DRAFT_KEYS.includes(key));
    if (bad.length) throw new Error(`草稿的设置含未知项：${bad.join('、')}`);
    // JSON cannot say "no nickname"; an empty one clears it.
    if (settings.nickname === '') return {...draft, settings: {...settings, nickname: undefined}};
  }
  return draft;
}

// Any row anywhere in the profile with id 'persona'.
function overridesPersona(node) {
  if (Array.isArray(node)) return node.some(overridesPersona);
  if (node === null || typeof node !== 'object') return false;
  return node.id === 'persona' || Object.values(node).some(overridesPersona);
}
