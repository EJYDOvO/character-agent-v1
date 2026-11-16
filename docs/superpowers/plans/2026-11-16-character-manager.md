# 角色管理插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH 设置里新增「角色管理」页：导入、编辑、预览、确认公开版、一键切换角色；人设在运行时读取当前角色，切换由 watchdog 重启 Host 完成。

**Architecture:** 角色 = 人设 + 数据，放在 `data/characters/<id>/`，经目录联接 `data/character-current` 被 Host 打开。Preset 组成在构建时固定，其中的人设行换成运行时人设插件，每次组装提示时读 `compiled.json`。新包 `dsh-character-manager` 同时提供运行时人设插件、Host 管理插件和设置页；切换请求由 QQTK watchdog 调用 `manage.ps1 -Action SwitchCharacter` 执行。

**Tech Stack:** Node ≥ 24（ESM，`node:test`），DSH 0.2.2-rc.1 原生插件 API，React（宿主提供），PowerShell 5.1（QQTK 维护工具），Windows 目录联接。

**Spec:** `docs/superpowers/specs/2026-11-16-character-manager-design.md`

本计划分两部分：
- **A（Task 1–12）**：本仓库，分支 `feat/character-manager`。
- **B（Task 13–14）**：QQTK 仓库 `harness-qq-toolkit-public`，新分支 `feat/character-switch`，单独提交。
- 生产接入不在任务内，见文末「生产接入」，执行前必须得到 Owner 明确同意。

## Global Constraints

- 角色管理只管角色（人设 + 数据），不改任何 Preset 组成、工具权限或 `/role`；管理页不显示权限设置。
- 不改代码：DSH 核心、Conversation Manager、Memory、Character Identity、Long Tasks、QQTK `dsh-identity-access`。
- 构建选项 `characterManager: {enabled: true}` 关闭时，构建结果与现在逐字节相同（`artifacts/build-manifest.json` 的 `buildSourceDigest` 除外）。
- 角色 `id`：`^[a-z0-9-]{1,48}$`，且不得为 `current`（会与联接 `data/character-<id>` 撞名）。
- 角色目录只能是 `<data>/characters/<id>` 或旧位置 `<data>/character-<id>`；真实路径在 `<data>` 之下、不是联接本身、含 `binding.json` 且其 `characterId` 等于 `id`。
- 浏览器只传角色 `id`，从不传路径；所有接口只接受 loopback 上原生认证的 Owner（`connection.admit` 的 `peer.principal.kind === 'owner'`）。
- 渲染后的文本不得含 `{{` 或 `}}`；人设上限 8000 token（沿用 `MAX_TOKENS`）；末尾提醒 ≤ 4000 字符；关系段每段 ≤ 2000 字符；等待提示 ≤ 200 字符；昵称 ≤ 32 字符且不含 `{}` 和换行。
- 公开版里 `{{user}}` 替换为 `对方`。
- 中性回退人设原文：`角色资料暂时不可用。请简短告知对方稍后再试，不要扮演任何角色。`
- 公开关系默认原文：`正在和你聊天的是被允许来聊天的人，不是你的主人，你们并不熟。不要提起主人的私事，也不要假装记得之前的对话。`
- Contact / Guest 只能读到 Owner 确认过的公开版；读不到时用中性回退，绝不读 Owner 版。
- 所有 JSON 状态文件写入用「同目录临时文件 + rename」；读取时忽略残留的 `*.tmp`。
- 删除联接只用非递归方式（`lstat` 确认是联接后 `fs.unlinkSync`），绝不对联接路径递归删除。
- 切换上限：每小时 4 次请求；切换引起的启动不计入 watchdog 的 `maxStartsPerHour`。
- 版本：根 `package.json` → `0.1.0-test.38`；`dsh-interaction-policy` → `0.1.0-test.11`；新包 `dsh-character-manager` → `0.1.0-test.1`。
- 提交信息结尾：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；不写模型标识。不推送、不建 PR、不部署，除非 Owner 明确要求。

## Review Focus

1. **写到一半崩溃**：`compiled.json`、`registry.json`、`character.json` 旁留下 `*.tmp`，或正式文件是旧版本 —— `list`、`get`、运行时人设照常工作，不报错也不读临时文件（Task 3、Task 7 各加一个测试）。
2. **联接指向不存在的目录**（目录被手动删除或移走）—— Host 启动时运行时人设用中性回退、`runtime-health.json` 的 `personaSource` 为 `neutral`，切换校验因此失败并退回（Task 4 测试；Task 13 测试 `verify` 拒绝 `neutral`）。
3. **导入坏卡**（非 UTF-8 JSON、PNG 没有角色数据块、超过 20 MB）—— 返回可读的中文错误，`data/characters/.upload/` 下的临时文件被删除，不留下半个角色目录（Task 7 测试）。
4. **陈旧的切换请求**：Host 停着没人处理，或 watchdog 关了很久之后又开 —— watchdog 丢弃 `requestedAt` 超过 15 分钟的请求，写结果 `{ok:false, reason:'expired'}`，不切换（Task 13 测试）。
5. **角色 id 为 `current`** —— `data/character-current` 就是联接本身，导入和注册表都拒绝这个 id（Task 7 测试）。

---

## 文件结构

```
packages/character-manager/            新包 dsh-character-manager
  package.json                         dsh.client；dependencies: js-yaml 4.1.1；exports 见 Task 9
  card/card*.mjs                       角色卡流程（从 character-definition 移入，唯一副本）
  template/rules.md  template/reminder.md   导入时使用的模板（与 characters/template 同内容）
  compiled.mjs                         compiled.json 的常量、校验、读写（运行时与管理端共用）
  compile.mjs                          角色目录 → compiled.json；character.json 校验；公开版确认
  runtime-persona.mjs                  Preset 插件：人设两段 + 末尾提醒
  registry.mjs                         registry.json、角色目录、导入、归档、上传分块
  switch.mjs                           切换前准备、请求文件、频率与 watchdog 前置检查
  controller.mjs                       RPC 方法分发
  http.mjs                             /character-manager/api
  index.mjs                            Host 插件：注册路由、写 runtime-health.json
  client.js                            设置页
  README.md
packages/character-definition/card*.mjs     改为一行 re-export
packages/character-definition/role-presets.mjs   支持传入公开人设行
packages/interaction-policy/{policy,index}.mjs   compiledFile 选项
scripts/build-settings.cjs  scripts/build.cjs  scripts/role-settings.cjs
scripts/deployment-plan.cjs  scripts/package-plan.cjs
scripts/adopt-character.cjs                 首次接入：收编已有角色目录
scripts/{stage,run}-character-manager.*  tests/character-manager-host.mjs   原生门禁
```

---

### Task 1: 角色卡流程移入新包

**Files:**
- Create: `packages/character-manager/card/{card.mjs,card-reader.mjs,card-normalize.mjs,card-render.mjs,card-tokens.mjs,card-error.mjs}`（`git mv` 自 `packages/character-definition/`）
- Create: `packages/character-definition/{card.mjs,card-reader.mjs,card-normalize.mjs,card-render.mjs,card-tokens.mjs,card-error.mjs}`（每个一行 `export * from '../character-manager/card/<同名>';`）
- Create: `packages/character-manager/template/rules.md`、`template/reminder.md`（复制自 `characters/template/`）
- Test: `tests/manager-layout.test.mjs`

**Interfaces:**
- Produces: `packages/character-manager/card/card.mjs` 导出 `loadCard`、`CardError`、`estimatePromptTokens`、`WARN_TOKENS`、`MAX_TOKENS`、`MAX_REMINDER_CHARS`、`DEFAULT_USER_NAME`（与现在相同）。旧路径继续可用。

- [ ] **Step 1: 写测试 `tests/manager-layout.test.mjs`**
  - `card pipeline has one copy`：`packages/character-definition/card*.mjs` 每个文件内容去空白后等于 `export * from '../character-manager/card/<name>';`。
  - `import template matches the build template`：`packages/character-manager/template/{rules,reminder}.md` 与 `characters/template/` 同名文件逐字节相等。
- [ ] **Step 2: 运行** `node --test tests/manager-layout.test.mjs`，Expected: FAIL（文件不存在）。
- [ ] **Step 3: `git mv` 六个文件、写 re-export、复制模板。** 被移动文件内部的相对 import 不变（都在同一目录）。
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过（现有 476 个 + 新增 2 个）。
- [ ] **Step 5: 提交** `refactor: move the card pipeline into dsh-character-manager`

### Task 2: Owner 版与公开版渲染

**Files:**
- Modify: `packages/character-manager/card/card-render.mjs`（`renderCard`）、`packages/character-manager/card/card.mjs`（`loadCard`）
- Test: `tests/card-render.test.mjs`、`tests/card.test.mjs`

**Interfaces:**
- Consumes: Task 1 路径。
- Produces:
  - `renderCard(data, {userName, rules, relationship = '', exclude = []}) -> {displayName, prefix, suffix, parts, downgraded, userFields}`。`exclude ⊆ ['description','personality','scenario','examples']`；`userFields` 是原始文本含 `{{user}}` 或 `<user>`（不分大小写）的字段名，按上面顺序，不受 `exclude` 影响。
  - `loadCard({cardPath, systemRulesPath, reminderPath, userName, parseYaml, relationship, exclude, nickname})`，返回值新增 `userFields`。`nickname`（可选）覆盖卡内 `nickname`。
  - `export const MAX_RELATIONSHIP_CHARS = 2000`（`card.mjs`）。

- [ ] **Step 1: 写测试**（`tests/card-render.test.mjs`）
  - `relationship sits between rules and the preamble`：`prefix` 中顺序为 `rules` → `## 与对话者的关系\n<relationship>` → `PREAMBLE` → `## 角色：`。
  - `empty relationship adds no heading`：`relationship:''` 时 `prefix` 不含 `## 与对话者的关系`。
  - `excluded fields are left out`：`exclude:['scenario','examples']` → `prefix` 不含 `## 场景`，`suffix === ''`；`parts.scenario` 仍为渲染值（统计用）。
  - `userFields lists fields that address the user`：description 含 `{{User}}`、scenario 含 `<user>` → `['description','scenario']`；`exclude:['description']` 时结果不变。
- [ ] **Step 2: 写测试**（`tests/card.test.mjs`）
  - `relationship is checked like rules`：含 `{{` → `CardError` /不能包含/；2001 字 → `CardError` /2000/。
  - `unknown exclude field is rejected`：`exclude:['name']` → `CardError` /exclude/。
  - `nickname override`：`nickname:'小尤'` → 返回 `name === '小尤'`，prefix 含 `## 角色：小尤`；含 `{` 的昵称 → `CardError`。
- [ ] **Step 3: 运行** `node --test tests/card-render.test.mjs tests/card.test.mjs`，Expected: 新测试 FAIL。
- [ ] **Step 4: 实现。** 关系段与规则走同一个检查函数；`measure` 把关系段计入 `overhead`（`CONTENT_FIELDS` 不变）。
- [ ] **Step 5: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 6: 提交** `feat: render Owner and public audiences with a relationship section`

### Task 3: `compiled.json` 与公开版确认

**Files:**
- Create: `packages/character-manager/compiled.mjs`、`packages/character-manager/compile.mjs`
- Test: `tests/manager-compile.test.mjs`

**Interfaces:**
- Consumes: Task 2 `loadCard`。
- Produces（`compiled.mjs`）：
  - 常量 `COMPILED_VERSION = 1`、`NEUTRAL_PERSONA`（Global Constraints 原文）、`MAX_PERSONA_CHARS = 32000`、`MAX_HANG_ON_CHARS = 200`。
  - `validateCompiled(value: unknown, {characterId: string}) -> Compiled`，不合法抛 `Error`。`Compiled = {version:1, revision:number, characterId, name, hangOnText, reminder, owner:{prefix,suffix}, public?:{prefix,suffix,hash}, pendingPublic?:{prefix,suffix,hash}, tokens:{owner,public}, warnings:string[], userFields:string[], cardRevision, rulesRevision}`。检查：`characterId` 相等；所有文本是字符串、不含 `{{`/`}}`；`prefix+suffix ≤ MAX_PERSONA_CHARS`；`reminder ≤ 4000`；`hangOnText` 非空且 ≤ 200。
  - `readCompiled(file, {characterId}) -> Compiled`；`writeJsonAtomic(file, value) -> void`（临时文件 `<file>.<pid>.tmp` + rename）。
- Produces（`compile.mjs`）：
  - 常量 `PUBLIC_USER_NAME = '对方'`、`DEFAULT_PUBLIC_RELATIONSHIP`（Global Constraints 原文）、`CARD_FILES = ['card.json','card.png','card.yaml']`。
  - `readSettings(dir) -> CharacterSettings`：`character.json` = `{userName, nickname?, hangOnText, relationship:{owner?, public?}, publicExclude:string[], publicApproved?:{hash, at}, revision:number}`；未知键报错。
  - `compileCharacter({dir, characterId, parseYaml, draft?}) -> {compiled: Compiled, previous: Compiled|null}`。`draft = {settings?, rules?, reminder?}` 覆盖磁盘内容，不写盘。卡文件必须恰好存在一个 `CARD_FILES`。
  - `publicHash({prefix, suffix, reminder}) -> string`：`sha256(JSON.stringify([prefix, suffix, reminder]))` 的 hex。
  - `saveCharacter({dir, characterId, parseYaml, draft, revision}) -> Compiled`：`revision` ≠ 磁盘 `character.json.revision` 抛 `Error('Revision conflict')`；写 `rules.md`、`reminder.md`、`character.json`（revision+1）、`compiled.json`。
  - `approvePublic({dir, characterId, parseYaml, hash}) -> Compiled`：`hash` 必须等于重新编译后 `pendingPublic.hash`，否则抛 `Error('Public version changed')`；写 `publicApproved:{hash, at}` 后重新编译。

公开版选择规则（`compileCharacter` 内）：
```
fresh = 公开版渲染（userName '对方'，relationship.public ?? DEFAULT_PUBLIC_RELATIONSHIP，exclude publicExclude）
if settings.publicApproved?.hash === fresh.hash: public = fresh
else: pendingPublic = fresh
      public = previous?.public 且 previous.public.hash === settings.publicApproved?.hash ? previous.public : 省略
```

- [ ] **Step 1: 写测试 `tests/manager-compile.test.mjs`**（临时目录，用 `characters/template` 的卡和规则）
  - `compiles both audiences`：`owner.prefix` 含配置的 `userName` 和 `relationship.owner`；`public.prefix`（或 `pendingPublic.prefix`）含 `对方` 和默认公开关系原文，且不含 `relationship.owner`。
  - `public needs approval`：首次编译只有 `pendingPublic`，没有 `public`。
  - `approval promotes and survives unrelated edits`：`approvePublic` 后有 `public`；再改 `rules.md` 保存 → `public` 仍是旧确认版、`pendingPublic` 是新版、两者 `hash` 不同。
  - `stale approval hash is rejected`：用旧 `hash` 调 `approvePublic` → 抛 /Public version changed/。
  - `revision conflict`：`saveCharacter` 传旧 `revision` → 抛 /Revision conflict/，文件不变。
  - `validateCompiled rejects foreign or unsafe data`：`characterId` 不同、`owner.prefix` 含 `{{x}}`、`hangOnText` 201 字 → 分别抛错。
  - `leftover tmp files are ignored`（Review Focus 1）：目录里放 `compiled.json.123.tmp`（内容是坏 JSON）→ `readCompiled` 正常返回正式文件。
  - `exactly one card file`：同时有 `card.json` 和 `card.png` → 抛 /card/。
- [ ] **Step 2: 运行** `node --test tests/manager-compile.test.mjs`，Expected: FAIL（模块不存在）。
- [ ] **Step 3: 实现两个模块。** `name` 取 `loadCard` 返回的 `name`；`tokens` 取两次 `loadCard` 的 `tokens.total`；`warnings` 合并去重；`userFields` 取公开版那次；`cardRevision`/`rulesRevision` 用与 `scripts/card-source.cjs` `revisionsOf` 相同的 sha256 规则（在 `compile.mjs` 内实现同一算法，并在测试里与 `revisionsOf` 结果比对）。
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 5: 提交** `feat: compile characters into compiled.json with Owner-approved public versions`

### Task 4: 运行时人设插件

**Files:**
- Create: `packages/character-manager/runtime-persona.mjs`
- Test: `tests/runtime-persona.test.mjs`

**Interfaces:**
- Consumes: Task 3 `readCompiled`、`NEUTRAL_PERSONA`。
- Produces: Preset 插件，行名 `dsh-character-manager/runtime-persona.mjs`。
  - `export const name = 'character-runtime-persona'`；`export const inject = ['systemPrompt']`。
  - `apply(ctx, {audience: 'owner'|'public', compiledFile: string, bindingFile: string})`。
  - 注册：`deployment:persona-prefix`（order `ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')`）、`deployment:persona-suffix`（order `getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX')`）、上下文 `character:reminder`（order 95，`interpolate:false`）；三者 `text` 都是函数。
  - `export function personaState(file, bindingFile)`：返回闭包 `read() -> {source:'compiled'|'neutral', compiled?: Compiled}`，供 Task 9 写健康文件复用。

行为：`characterId` 在 `apply` 时从 `bindingFile` 读一次。每次 `text()` 检查 `compiledFile` 的 `mtimeMs` 和 `size`，变化才重读。读取或校验失败时：本进程已有有效内容 → 继续用它；从未有效 → 人设开头为 `NEUTRAL_PERSONA`，结尾和提醒为空串。`audience:'public'` 只取 `compiled.public`；没有 `public` → 中性回退。

- [ ] **Step 1: 写测试 `tests/runtime-persona.test.mjs`**（假 `ctx`：记录 `section`/`context` 注册；`getSectionOrder` 返回 0 / 10200）
  - `owner reads the Owner version`：prefix/suffix/reminder 等于 `compiled.owner` 与 `compiled.reminder`。
  - `public reads only the approved public version`：有 `public` 时用它；只有 `pendingPublic` 时 prefix 为 `NEUTRAL_PERSONA`；任何情况下返回值都不含 `owner.prefix` 的文本。
  - `edits apply on the next read`：改写 `compiled.json`（`mtime` 前移 1 秒）后 `text()` 返回新内容。
  - `a broken file keeps the last good text`：先有效，再写坏 JSON → 返回旧内容。
  - `a foreign character id is refused`：`compiled.characterId` ≠ `binding.characterId` → `NEUTRAL_PERSONA`。
  - `missing target directory`（Review Focus 2）：`compiledFile` 所在目录不存在 → `NEUTRAL_PERSONA`，`personaState(...).read().source === 'neutral'`，不抛错。
- [ ] **Step 2: 运行** `node --test tests/runtime-persona.test.mjs`，Expected: FAIL。
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 5: 提交** `feat: runtime persona plugin reads the current character per prompt`

### Task 5: Interaction 运行时读取提醒和等待提示

**Files:**
- Modify: `packages/interaction-policy/policy.mjs`（`options`）、`packages/interaction-policy/index.mjs`、`packages/interaction-policy/package.json`（`0.1.0-test.11`）、`packages/interaction-policy/README.md`
- Test: `tests/interaction.test.mjs`

**Interfaces:**
- Produces:
  - `options()` 新增可选 `compiledFile`（绝对路径，同 `hangOnModelFile` 的格式检查）；与 `styleReminder` 同时给出时抛 `Error('Invalid interaction option: compiledFile')`。
  - `index.mjs` 导出 `liveStyle(file, fallbackHangOnText, read = readFileSync) -> {styleReminder: string, hangOnText: string}`：读 `compiled.json` 的 `reminder` 和 `hangOnText`；文件缺失、JSON 错误、`hangOnText` 为空或超 200、`reminder` 超 4000 → 返回 `{styleReminder:'', hangOnText: fallbackHangOnText}`。按 `mtimeMs` 缓存。
  - 设置了 `compiledFile` 时，传给 `Interaction` 的配置对象的 `hangOnText`、`styleReminder` 是 getter，每次取值调用 `liveStyle`。`fallbackHangOnText` 是 `options()` 的默认 `还在处理中，稍等一下。`，不用构建配置里的值。

- [ ] **Step 1: 写测试**（追加到 `tests/interaction.test.mjs`）
  - `compiledFile and styleReminder are exclusive`。
  - `liveStyle follows the file`：写 `{reminder:'A', hangOnText:'等等'}` → 返回该值；改写后返回新值。
  - `liveStyle falls back to neutral defaults`：文件缺失 / 坏 JSON / `hangOnText` 201 字 → `{styleReminder:'', hangOnText:'还在处理中，稍等一下。'}`。
  - `the hang-on draft uses the live reminder`：用现有 drafter 测试夹具，设置 `compiledFile`，断言传给 `llm.stream` 的 `system` 含文件里的 `reminder`。
- [ ] **Step 2: 运行** `node --test tests/interaction.test.mjs`，Expected: 新测试 FAIL。
- [ ] **Step 3: 实现。** `policy.mjs:185` 继续读 `this.config.hangOnText`，由 getter 提供最新值。
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 5: 提交** `feat: interaction reads the style reminder and hang-on text at use time`

### Task 6: 构建接线

**Files:**
- Modify: `scripts/build-settings.cjs`、`scripts/build.cjs`、`scripts/role-settings.cjs`、`packages/character-definition/role-presets.mjs`、`scripts/deployment-plan.cjs`、`scripts/package-plan.cjs`
- Test: `tests/role-presets.test.mjs`、新建 `tests/manager-build.test.mjs`

**Interfaces:**
- Consumes: Task 4 插件行名；Task 5 `compiledFile`。
- Produces:
  - `build-settings` 返回值新增 `characterManager?: {enabled:true, root:string}`，`root` = 安装目录下 `data` 的绝对路径（正斜杠）。开启时 `dataDirectory` 强制为 `<root>/character-current`，忽略配置里的 `dataDirectory`；`characterId`、`cardPath`、`rules`、`userName` 不再读取。
  - `roleSettings(value, {characterManager: boolean})`：开启角色管理时 `publicPersonaFile` 可省略，若给出则报错 `roles.publicPersonaFile is replaced by the character's public version`。
  - `roleConfig(roles, data, {accountDirectory?})`：给出时 `identityAccess.stateFile`/`ownerFile` 在 `accountDirectory` 下，否则同现在。
  - `rolePresets({owner, publicPersona?, publicPersonaRow?, legacyOwner})`：二者恰好一个。`publicPersonaRow` 必须是 `id === 'persona'` 的插件行，原样（深拷贝）放进 Contact / Guest，取代 `{id:'persona', name:'@deepseek-ai/dsh-persona', ...}`。
  - 开启角色管理时 `build.cjs` 产出：
    - Owner 的 `persona` 行：`{id:'persona', name:'dsh-character-manager/runtime-persona.mjs', config:{audience:'owner', compiledFile:<root>/character-current/compiled.json, bindingFile:<root>/character-current/binding.json}}`；
    - `character-memory-tools` 行不带 `reminder`；
    - Interaction 行带 `compiledFile`，不带 `styleReminder`、`hangOnText`；
    - 角色模式开启时 `publicPersonaRow` 同上但 `audience:'public'`，`accountDirectory` 为 `<root>/account`；
    - Host 行追加 `{id:'character-manager', name:'dsh-character-manager', config:{root:<root>, maintenanceDirectory:<root>/maintenance, featuresFile:<安装目录>/maintenance/features.json, profileFile:<root>/profiles/desktop/cordis.patch.yml}}`；
    - `build-manifest.json` 的 `card` 为 `null`、`characterId` 为 `null`，新增 `characterManager:true`。
  - `deployment-plan.cjs` 的可选包表加 `['dsh-character-manager','packages/character-manager']`；`package-plan.cjs` 的 `folders` 加 `packages/character-manager`，并列入可选（非 `requiredFolders`）。

- [ ] **Step 1: 写测试**（`tests/role-presets.test.mjs`）
  - `public persona row replaces the static persona`：传 `publicPersonaRow`，Contact / Guest 的插件 id 仍是 `['persona','role-tool-scope']`，`persona` 行等于传入行；Owner 不变。
  - `exactly one public persona source`：两者都给或都不给 → 抛 /public Persona/。
- [ ] **Step 2: 写测试 `tests/manager-build.test.mjs`**（用临时 `DSH_CHARACTER_BUILD_CONFIG` 跑 `scripts/build.cjs` 到临时副本；沿用 `tests/card-cli.test.mjs` 运行构建的方式）
  - `manager off keeps the current build`：不含 `characterManager` 的配置 → 生成的 Core 不含 `dsh-character-manager`，`persona` 行名为 `@deepseek-ai/dsh-persona` 且 `prefix` 为卡渲染结果，`character-memory-tools` 行带 `reminder`，Interaction 行带 `styleReminder`。另在 Step 5 用现有私有配置构建，与本任务开始前构建出的 `cordis.patch.yml` 用 `git diff --no-index` 比较，Expected: 无差异。
  - `manager on wires the runtime persona`：断言上面「开启时产出」的每一条；所有路径以 `/character-current/` 或 `/account/` 结尾的目录开头。
  - `roles with manager`：开启角色模式 → Contact / Guest 的 `persona` 行 `audience:'public'`；`identity-access` 的 `stateFile` 在 `/account/` 下。
  - `publicPersonaFile is refused with the manager`。
- [ ] **Step 3: 运行** `node --test tests/role-presets.test.mjs tests/manager-build.test.mjs`，Expected: FAIL。
- [ ] **Step 4: 实现。**
- [ ] **Step 5: 运行** `npm test`，Expected: 全部通过；`node scripts/check-interaction-build.cjs` 对现有私有配置仍通过。
- [ ] **Step 6: 提交** `feat: build wiring for the character manager and roles mode`

### Task 7: 注册表、导入、归档、导出

**Files:**
- Create: `packages/character-manager/registry.mjs`
- Test: `tests/manager-registry.test.mjs`

**Interfaces:**
- Consumes: Task 3 `compileCharacter`、`saveCharacter`、`writeJsonAtomic`。
- Produces（全部以 `root` = `<data>` 为第一个参数）：
  - `ID = /^[a-z0-9-]{1,48}$/`；`validId(id) -> boolean`（拒绝 `current`）。
  - `readRegistry(root) -> {version:1, characters:[{id, dir, addedAt, archived}]}`；文件不存在返回空表。
  - `characterDir(root, id) -> string`：查注册表并按 Global Constraints 的目录规则校验，失败抛错。
  - `currentId(root) -> string|null`：读 `<root>/character-current` 的联接目标（`fs.readlinkSync`），反查注册表。
  - `register(root, {id, dir}) -> void`（收编旧目录用）。
  - `beginUpload(root) -> uploadId`；`appendUpload(root, uploadId, index, base64) -> {bytes}`（`index` 必须连续；累计 > 20 MB 抛错并删除）；上传目录 `<root>/characters/.upload/<uploadId>`，`uploadId` 为 `randomUUID()`。
  - `importCharacter(root, {uploadId, id, userName, parseYaml}) -> Compiled`：识别格式（PNG 签名 → `card.png`；能 `JSON.parse` → `card.json`；否则 `card.yaml`）；建 `<root>/characters/<id>/`；复制模板 `rules.md`（把 `「……」` 替换为 `「<卡名>」`）、`reminder.md`；写 `character.json`（`hangOnText:'还在处理中，稍等一下。'`、`publicExclude:[]`、`revision:1`）；编译。任一步失败：删除新目录和上传文件，抛 `CardError` 原消息。`id` 已存在 → 拒绝。
  - `archiveCharacter(root, id) -> void`：当前角色拒绝；移到 `<root>/characters/.archive/<id>-<yyyyMMdd-HHmmss>`，注册表标 `archived:true` 并记新 `dir`。旧位置 `data/character-<id>` 的角色同样移入 `.archive`。
  - `exportCard(root, id, parseYaml) -> object`：CCv3 JSON（`spec:'chara_card_v3'`），`data` 取卡原文规范化结果，`extensions` 原样保留。

- [ ] **Step 1: 写测试 `tests/manager-registry.test.mjs`**
  - `ids`：`current`、`A`、`a/b`、49 字符 → 拒绝；`yuha` → 接受。
  - `directory trust`：注册表 `dir` 指向 `<root>/elsewhere/x`、指向联接本身、`binding.json.characterId` 不符 → `characterDir` 抛错。
  - `import json, png and yaml`：分别用 `tests/fixtures` 里现有的三种卡导入，得到 `compiled.json` 且 `rules.md` 含卡名。
  - `bad uploads leave nothing behind`（Review Focus 3）：非 UTF-8 的 JSON、没有角色块的 PNG、累计 20 MB + 1 字节 → 抛中文错误；`characters/` 下没有新目录，`.upload/` 为空。
  - `upload chunks must be contiguous`：跳过 `index` → 抛错。
  - `archive`：当前角色（联接指向它）→ 拒绝；非当前 → 目录移入 `.archive`，`readRegistry` 标 `archived`。
  - `crash leftovers`（Review Focus 1）：`registry.json.99.tmp` 存在 → `readRegistry` 正常。
  - `id 'current' is refused everywhere`（Review Focus 5）：`importCharacter`、`register` 都拒绝。
- [ ] **Step 2: 运行** `node --test tests/manager-registry.test.mjs`，Expected: FAIL。
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 5: 提交** `feat: character registry with import, archive and export`

### Task 8: 切换准备与请求

**Files:**
- Create: `packages/character-manager/switch.mjs`
- Test: `tests/manager-switch.test.mjs`

**Interfaces:**
- Consumes: Task 7 `characterDir`、`currentId`；Task 3 `readCompiled`。
- Produces：
  - `REQUEST_FILE = 'character-switch.json'`、`RESULT_FILE = 'character-switch-result.json'`、`HISTORY_FILE = 'character-switch-history.json'`（都在 `maintenanceDirectory`）；`MAX_SWITCHES_PER_HOUR = 4`；`WATCHDOG_STALE_MS = 120000`。
  - `watchdogReady({maintenanceDirectory, featuresFile, now}) -> {ok:true}|{ok:false, reason}`：`features.json.watchdog.enabled === true` 且 `watchdog-state.json.checkedAt` 距 `now` ≤ 2 分钟。
  - `prepareTarget({root, target, current}) -> void`：只新建不存在的文件。`binding.json` = 当前角色的 `{appId, ownerId, projectId}` + `characterId: target`；`conversations.json` = `{overrides:{}, presets:{}, sessionIds:{['qqbot:'+appId+':c2c:'+ownerId]: randomUUID()}, lifecycle:{}}`。
  - `requestSwitch({root, maintenanceDirectory, featuresFile, target, now}) -> {target, previous, requestedAt, nonce}`：依次检查 watchdog、目标已注册未归档非当前、没有未处理请求、过去一小时历史 < 4、`readCompiled` 通过；然后 `prepareTarget`、追加历史、写请求文件。失败抛带中文原因的 `Error`。
  - `switchStatus({maintenanceDirectory}) -> {pending: object|null, result: object|null}`。

- [ ] **Step 1: 写测试 `tests/manager-switch.test.mjs`**
  - `watchdog must be running`：`enabled:false`、`checkedAt` 3 分钟前 → 拒绝且不写请求文件。
  - `prepares only missing files`：目标已有 `conversations.json` → 内容不变；没有 → 新建，会话键为 `qqbot:<appId>:c2c:<ownerId>`，Session ID 不等于当前角色的任何 Session ID。
  - `binding copies identity but not the character`：新 `binding.json` 的 `appId/ownerId/projectId` 同当前，`characterId === target`。
  - `current character files are untouched`：当前角色目录所有文件的 `mtime` 和内容不变。
  - `one pending request at a time`、`four per hour`：第五次 → /每小时/；一小时前的记录不计。
  - `invalid compiled target is refused`。
- [ ] **Step 2: 运行** `node --test tests/manager-switch.test.mjs`，Expected: FAIL。
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 5: 提交** `feat: prepare characters and request a watchdog switch`

### Task 9: Host 插件、RPC、健康文件

**Files:**
- Create: `packages/character-manager/{index.mjs,http.mjs,controller.mjs,package.json,README.md}`
- Test: `tests/manager-http.test.mjs`、`tests/manager-controller.test.mjs`

**Interfaces:**
- Consumes: Task 3、4（`personaState`）、7、8。
- Produces：
  - `package.json`：`name: dsh-character-manager`，`version: 0.1.0-test.1`，`dependencies: {"js-yaml": "4.1.1"}`，`files: ["*.mjs","card","template","client.js","README.md"]`，`exports: {".": "./index.mjs", "./runtime-persona.mjs": "./runtime-persona.mjs", "./client": "./client.js", "./package.json": "./package.json"}`，`dsh.client` 同 `memory-inspector`。
  - `index.mjs`：`name = 'character-manager'`；`inject = ['webServer','connection','characterIdentity']`；`apply(ctx, {root, maintenanceDirectory, featuresFile, profileFile})`。启动时写 `<root>/character-current/runtime-health.json` = `{pid: process.pid, characterId: ctx.characterIdentity.conversationScope().characterId, personaSource, compiledRevision, at}`；注册 `/character-manager` 前缀路由。
  - `http.mjs`：`handler({connection, origin, dispatch, isClosed})`，与 `memory-inspector/http.mjs` 相同的 loopback、Host、`admit`、Owner、Origin / 桌面中继、读完后二次认证规则；路径 `POST /character-manager/api`；**请求体上限 256 KiB**（规格写 16 KiB；上传分块和规则文本需要更大，见文末裁定 1）；错误码前缀 `character/`，`Revision conflict` → 409。
  - `controller.mjs`：`controller({root, maintenanceDirectory, featuresFile, parseYaml}) -> dispatch(request) -> value`。`request.operation` 取值和参数：
    - `list` → `{characters:[{id, name, current, archived, tokens, warningCount, publicPending, publicApproved}], switch: switchStatus(), profileWarnings:string[]}`。`profileWarnings`：解析 `profileFile`（YAML），任意层级出现 `id === 'persona'` 的行 → `检测到 Profile 覆盖了 persona 行（例如 Preset Manager 的修改），运行时人设可能被盖掉。`；文件不存在或解析失败 → 空数组
    - `get {id}` → `{settings, rules, reminder, compiled}`
    - `uploadBegin` → `{uploadId}`；`uploadChunk {uploadId, index, data}` → `{bytes}`
    - `import {uploadId, id, userName}` → `compiled`
    - `preview {id, draft}` → `{compiled}`（不写盘）
    - `save {id, draft, revision}` → `compiled`
    - `approvePublic {id, hash}` → `compiled`
    - `exportCard {id}` → 卡 JSON
    - `switch {id}` → 请求
    - `switchStatus` → `switchStatus()`
    - `archive {id}` → `{ok:true}`
    - 其他 `operation`、`draft` 里的未知键、出现 `path`/`dir`/`file` 字样的参数 → 抛错。

- [ ] **Step 1: 写测试 `tests/manager-http.test.mjs`**（参照 `tests/inspector.test.mjs` 的假 `connection` 与请求构造）
  - 非 loopback、Host 头不符、未认证、非 Owner、跨站 Origin、非 JSON → 403/401；超过 256 KiB → 413。
  - `client-request` 信封往返；`Revision conflict` → `{ok:false, error:{code:'character/409'}}`。
- [ ] **Step 2: 写测试 `tests/manager-controller.test.mjs`**
  - 完整流程：`uploadBegin` → 两块 `uploadChunk` → `import` → `list` 含新角色且 `publicPending:true` → `approvePublic` → `publicPending:false`。
  - `preview` 不改任何文件（比较目录快照）。
  - `get` 返回值不含任何绝对路径（`JSON.stringify` 结果不含 `root`）。
  - `profile persona override warns`：`profileFile` 内某个 Preset 行的 `plugins` 里有 `{id:'persona', ...}` → `list().profileWarnings` 长度 1；没有 → 空。
  - 未知 `operation`、带 `path` 参数 → 抛错。
  - `runtime health`：调用 `apply`（假 `webServer`/`characterIdentity`），`runtime-health.json` 的 `characterId` 来自 `conversationScope()`、`personaSource` 在有效 `compiled.json` 时为 `compiled`、目录缺失时为 `neutral`。
- [ ] **Step 3: 运行** `node --test tests/manager-http.test.mjs tests/manager-controller.test.mjs`，Expected: FAIL。
- [ ] **Step 4: 实现。** `index.mjs` 用 `import yaml from 'js-yaml'` 并以 `text => yaml.load(text, {schema: yaml.JSON_SCHEMA})` 作为 `parseYaml`（与 `scripts/card-yaml.cjs` 一致）；要求 `ctx.webServer.host` 是 loopback，否则抛错（同 Inspector）。
- [ ] **Step 5: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 6: 提交** `feat: character manager Host plugin, RPC and runtime health`

### Task 10: 设置页

**Files:**
- Create: `packages/character-manager/client.js`
- Test: `tests/manager-client.test.mjs`（参照 `tests/inspector-client.test.mjs`）

**Interfaces:**
- Consumes: Task 9 的 RPC 方法表；`ctx.connection.rpc.call('/character-manager','api',{operation,...args},signal)`。
- Produces: `window.__ModuleLoader__.load({id:'dsh-character-manager', factory})`，注册 `settings.section`，`id:'character-manager'`，`order:66`，标签 `角色管理`。

页面结构（文案为中文，组件只用 `Button`、`Input`、`SegmentedTabs`、`Tag` 和宿主主题变量）：
- 顶部显示 `profileWarnings`（如有）。
- 角色列表：名称、`当前` 标记、token、警告数、`公开版待确认` 标记、`切换到此角色` 按钮（当前角色不显示）、`导入角色卡`（文件选择 → 128 KiB 原始字节一块，base64 后 `uploadChunk`）。
- 角色详情页签：资料（只读：卡名、规格、警告）、规则、末尾提醒、关系（Owner 关系、公开关系、公开版排除的字段四个复选框）、设置（称呼、昵称、等待提示）、预览（`Owner 版`/`公开版` 切换；公开版标出 `userFields`，`确认公开版` 按钮带 `hash`）。
- 保存时带 `revision`；409 提示「已在别处修改，请刷新后再改」。
- 切换确认框原文：`切换后 QQ 会断开约 30 秒，桌面窗口会关闭后重新打开。旧角色设的提醒和长期任务切换后不会执行。确定切换到「<名称>」？`
- 打开页面时若 `switchStatus().result` 存在，显示最近一次结果。网页端请求失败时提示：`Host 正在重启，请稍后从桌面应用或新链接重新打开。`
- 页面不出现任何权限、Preset、`/role` 相关内容。

- [ ] **Step 1: 写测试**：注册 / 停用 / 销毁 / 请求中止（同 Inspector 客户端测试）；上传把 300 KiB 文件分成 3 块且 `index` 为 0,1,2；确认公开版请求携带预览返回的 `hash`；切换确认框文案等于上面原文。
- [ ] **Step 2: 运行** `node --test tests/manager-client.test.mjs`，Expected: FAIL。
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 5: 提交** `feat: character manager settings page`

### Task 11: 首次接入脚本与文档

**Files:**
- Create: `scripts/adopt-character.cjs`
- Modify: `docs/MANAGEMENT.md`、`docs/STATUS.md`、`docs/IDENTITY-ACCESS.md`、`packages/character-manager/README.md`、根 `package.json`（`0.1.0-test.38`）
- Test: `tests/adopt-character.test.mjs`

**Interfaces:**
- Consumes: Task 3 `saveCharacter`/`compileCharacter`、Task 7 `register`。
- Produces: `node scripts/adopt-character.cjs --root <data> --id <id> --dir <existing dir> --card <file> --rules <file> --reminder <file> --user-name <name> --hang-on-text <text> [--link]`
  - 复制卡、规则、提醒到 `--dir`（目标已存在同名文件且内容不同 → 拒绝）；写 `character.json`、`compiled.json`；`register`；`--link` 时建联接 `<root>/character-current → --dir`（联接已存在 → 拒绝）。
  - 不修改 Profile；结束时打印需要手动替换的 `character-identity` 行（四个键，路径改到 `character-current`）。

- [ ] **Step 1: 写测试**：在临时目录模拟 `data/character-yuha`（含 `binding.json`、假 `memory.sqlite`），运行脚本 → 原有文件逐字节不变、新增四个文件、注册表一条、联接指向该目录且经联接能读到 `memory.sqlite`；重复运行 `--link` → 拒绝。
- [ ] **Step 2: 运行** `node --test tests/adopt-character.test.mjs`，Expected: FAIL。
- [ ] **Step 3: 实现脚本；更新文档：**
  - `MANAGEMENT.md`：新增「角色管理」节（目录结构、构建选项、切换前提是 watchdog 在运行、生产接入步骤、回退方法、旧位置 `identity-access.json` 需停机后移到 `data/account/`）；「切换角色」节注明手动方式仍可用。
  - `IDENTITY-ACCESS.md`：开启角色管理时公开人设由角色生成、Owner 在管理页确认；授权文件在 `data/account/`。
  - `STATUS.md`：版本行与「未验证」清单（真实 QQ、真实模型、生产切换）。
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 5: 提交** `feat: adopt an existing character directory; docs for the character manager`

### Task 12: 原生门禁

**Files:**
- Create: `scripts/stage-character-manager.cjs`、`scripts/run-character-manager.ps1`、`tests/character-manager-host.mjs`
- Modify: `scripts/native-gates.cjs`（门禁表加 `character-manager`，列为必需）、`scripts/run-native-gates.ps1`
- Test: `tests/native-gates.test.mjs`（门禁表断言）

照 `stage-roles.cjs` / `run-roles.ps1` / `tests/roles-host.mjs` 的方式：隔离 Home、合成 QQ 传输与确定性 LLM（记录每次请求的系统提示和消息）。场景与通过条件：

1. **热生效**：Host 运行中改写当前角色 `compiled.json` 的 `owner.prefix` → 下一次模型请求的系统提示含新文本，且由 Host 自己插值通过。
2. **切换隔离**：角色 A 下写入一条记忆、设一条 1 分钟后到期的提醒；停 Host，联接改指向 B（门禁里直接用 `fs` 改，切换脚本由 Task 13 单独测试），启动 → B 的记忆召回不含 A 的记录、Owner 消息进入新 Session ID；提醒到期后 LLM 请求数不增加，且没有发往 QQ 的提醒。
3. **公开版**：开启角色模式；Guest 发消息 → 系统提示含 A 的公开版、不含 A 的 Owner 关系和 `userName`；A 只有 `pendingPublic` 时 → 中性回退。
4. **授权跨角色**：切换前 `/role block <guest>`；切到 B 后该 Guest 仍被拒绝；Contact 授权仍在。
5. **工具不可见**：Contact / Guest 请求的工具列表为空（沿用 roles 门禁断言）。

- [ ] **Step 1: 写 `tests/native-gates.test.mjs` 断言**：门禁表含 `character-manager` 且为必需。运行，Expected: FAIL。
- [ ] **Step 2: 实现三个文件和门禁表改动。**
- [ ] **Step 3: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 4: 运行** `pwsh -File scripts/run-character-manager.ps1`（需 `DSH_INSTALL_ROOT`，测试 Home 在系统临时目录、不在任何 git 工作树内），Expected: 五个场景全部 `pass`。随后运行 `scripts/run-native-gates.ps1`，Expected: 所有必需门禁通过。
- [ ] **Step 5: 提交** `test: native gate for the character manager`

---

## B. QQTK 部分（仓库 `harness-qq-toolkit-public`，分支 `feat/character-switch`）

### Task 13: 切换执行脚本 `maintenance/character-switch.cjs`

**Files:**
- Create: `maintenance/character-switch.cjs`
- Test: `maintenance/character-switch.test.mjs`

**Interfaces:**
- Consumes: Character 侧文件格式：`data/maintenance/character-switch.json` = `{target, previous, requestedAt, nonce}`；`data/characters/registry.json`；`<dir>/binding.json`；`data/character-current/runtime-health.json`。
- Produces（CLI，`root` 为安装目录；每条命令输出一行 JSON，失败退出码非 0）：
  - `pending <root>` → 有效请求则输出它，退出 0；没有请求退出 3；请求无效或 `requestedAt` 超过 15 分钟 → 写结果 `{ok:false, target, reason:'invalid'|'expired', at}`、删除请求、退出 4。
  - `apply <root>` → 联接当前必须指向 `previous` 的目录，改指向 `target` 的目录。
  - `revert <root>` → 联接改回 `previous` 的目录。
  - `verify <root> <startedAtMs> <pid,pid,...>` → `runtime-health.json` 满足 `pid ∈ pids`、`at ≥ startedAtMs`、`characterId === target`、`personaSource === 'compiled'` 才退出 0。
  - `finish <root> ok|fail <reason?> <restored?>` → 写 `character-switch-result.json`，删除请求。
  - 导出供测试：`trustedDir(root, id)`（与 Global Constraints 的目录规则一致，独立实现，不 import Character 包）、`repoint(link, expectedDir, nextDir)`、`checkHealth(health, {target, pids, startedAt})`。

- [ ] **Step 1: 写测试 `maintenance/character-switch.test.mjs`**（Windows 临时目录，真实联接）
  - `apply/revert`：联接改指向后经联接能读目标文件；`revert` 恢复；两个目标目录内容都不变。
  - `link must point to previous`：联接实际指向第三个目录 → `apply` 拒绝且不改动。
  - `untrusted dirs are refused`：注册表 `dir` 在 `data/` 之外、是联接本身、`binding.characterId` 不符、id 为 `current` → `trustedDir` 抛错。
  - `stale request expires`（Review Focus 4）：`requestedAt` 为 16 分钟前 → `pending` 退出 4，结果 `reason:'expired'`，请求文件已删除，联接未动。
  - `health check`：旧 `pid`、早于启动、`characterId` 不符、`personaSource:'neutral'`（Review Focus 2）→ 拒绝；全部符合 → 通过。
  - `unlink is not recursive`：`repoint` 之后原目标目录下的文件仍在。
- [ ] **Step 2: 运行** `node --test maintenance/character-switch.test.mjs`，Expected: FAIL。
- [ ] **Step 3: 实现。** 联接用 `fs.symlinkSync(dir, link, 'junction')`；删除前 `fs.lstatSync(link).isSymbolicLink()` 必须为真，再 `fs.unlinkSync(link)`。
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 5: 提交** `feat: character switch helper for the maintenance watchdog`

### Task 14: `manage.ps1 -Action SwitchCharacter` 与 watchdog 触发

**Files:**
- Modify: `maintenance/manage.ps1`、`maintenance/watchdog.ps1`、`maintenance/README.md`
- Test: `maintenance/runtime.test.mjs`（源码断言，沿用现有写法）

**Interfaces:**
- Consumes: Task 13 CLI。
- Produces：
  - `manage.ps1` 的 `ValidateSet` 加 `SwitchCharacter`；不允许 `-Queue`。流程（持维护锁）：`pending`（退出 3/4 → 结果 `ok:true, skipped`）→ `Wait-TaskIdle` → `Stop-TaskHost` → `apply` → 记录 `$taskStartedAt` 后 `Start-TaskHost` → `verify`（最多 20 秒，每 2 秒一次）→ `finish ok`。不做 Profile 备份。
  - 失败（`apply` 之后任一步）：停掉本次启动的 Host 进程 → `revert` → `Start-TaskHost` → `finish fail <原因> <true|false>`；退回后的启动也失败时 `finish fail <原因> false` 并释放锁。
  - `watchdog.ps1`：在维护锁 `try/finally` 之外（与 `$taskRestart` 同一位置），若 `data/maintenance/character-switch.json` 存在则同步调用 `manage.ps1 -Action SwitchCharacter`；**不**向 `$taskStarts` 追加。

- [ ] **Step 1: 写源码断言**（`maintenance/runtime.test.mjs`）：
  - `SwitchCharacter` 在 `ValidateSet` 中且不在 `-Queue` 允许列表中；
  - 在 `manage.ps1` 中，`character-switch.cjs` 的 `apply` 出现在 `Stop-TaskHost` 之后、`Start-TaskHost` 之前；
  - 失败分支先 `revert` 再 `Start-TaskHost`；
  - `watchdog.ps1` 调用 `SwitchCharacter` 的那一行不在维护锁的 `try` 块内，且同一分支里没有 `$taskStarts+=`。
- [ ] **Step 2: 运行** `node --test maintenance/runtime.test.mjs`，Expected: FAIL。
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 运行** `npm test`，Expected: 全部通过。
- [ ] **Step 5: 在测试 Home 中手动演练一次**（隔离安装目录，假角色两个，不碰生产）：写请求 → `powershell -File maintenance/watchdog.ps1 -Once` → 结果 `ok:true`、联接指向目标；再让目标的 `compiled.json` 损坏后切换 → 结果 `ok:false, restored:true`、联接指回原角色。Expected: 两次结果都与描述一致。
- [ ] **Step 6: 提交** `feat: watchdog-driven character switch in manage.ps1`

---

## 生产接入（不属于任务；每一步执行前须 Owner 明确同意）

1. QQTK：Task 13–14 合并后，把 `character-switch.cjs`、`manage.ps1`、`watchdog.ps1` 逐个审阅后同步到 `D:\DeepSeek-Harness\maintenance`（保留实例文件）。
2. Character：构建配置加 `characterManager:{enabled:true}`，构建并 pack。
3. 在 Host 运行时运行 `adopt-character.cjs --link` 收编 `yuha → data/character-yuha` 并建联接（只新增文件）。
4. 另存 Profile 原件，再把 `character-identity` 行改到 `data/character-current`（`presetId`、`bindingFile`、`stateFile`、`memoryMode` 四个键都写）。必须在 Stage 之前：Stage 把当时的 Profile 复制进候选，`DeployValidated` 发现 Profile 在 Stage 之后变过会停止（"Live profile changed: stage again"）。
5. 更新 `plugin-policy.json` 固定（含新包 `dsh-character-manager` 与其 `js-yaml` 依赖），`Stage`。
6. `DeployValidated`（后台运行，读 `latest-result.json`）；核对 Yuha 的身份、记忆、会话与接入前一致。自动回滚恢复的是第 4 步改过的 Profile（联接仍指向 yuha，旧构建可用）；完全退回接入前要用第 4 步另存的原件。
7. 界面导入 Tasha、切换、再切回，每次核对隔离和 QQ 就绪。

回退：部署 `characterManager:false` 的构建并恢复 Profile 原件。这样的构建把卡和 `dataDirectory` 重新固定进核心包；当前角色已不是 Yuha 时，要用该角色自己的构建配置（卡、规则、提醒、`dataDirectory` 为该角色目录）。

## 裁定（与规格的差异，执行前已确定）

1. RPC 请求体上限由规格的 16 KiB 改为 256 KiB：规则文本可超过 16 KiB，上传改走 RPC 分块（规格第 8 节把分块方式留给实现者），两者都需要更大的请求体。代价：单次请求解析的数据更多；仍受 Owner 认证与 10 秒超时约束。
2. 上传不另开 HTTP 入口，改为 `uploadBegin`/`uploadChunk` 两个 RPC：复用原生认证通道，桌面端与网页端行为一致。代价：base64 膨胀约 33%。
3. `character.json` 只保留 `nickname` 覆盖，不设 `name` 覆盖：卡名用于导出，显示名由昵称控制即可。
4. 角色卡流程移入 `dsh-character-manager`，`character-definition` 留 re-export：管理插件在 Host 里需要它，而 `character-definition` 不是安装包；保留唯一副本避免两份代码漂移。
5. 新包依赖 `js-yaml 4.1.1`（与本仓库 devDependency 同版本），用于在 Host 内读取 .yaml 卡。代价：Stage 需要联网安装这一依赖一次。
6. `portable` 安装路径本期不支持 `characterManager`（规格未要求）。
7. 原生门禁的切换场景直接用 `fs` 改联接，watchdog 切换另由 Task 13–14 测试。
8. 切换前的空闲判断只用 `Wait-TaskIdle`（`ops.cjs status` 的 `idle`），不单独等待通知队列清空：插件读不到 Identity 通知队列的待发数（规格第 8 节允许）。代价：切换瞬间未发出的通知留在旧角色目录，切回后才会继续发送。
