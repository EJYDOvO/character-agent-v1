# Character Card V3 第一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 CCv3 / V2 / V1 角色卡（JSON、PNG、YAML）取代自创的 `definition.yaml`，在构建时把它渲染进 Persona prefix 和 suffix，加上部署级规则和末尾提醒。

**Architecture:**
- 新增 `packages/character-definition/card-*.mjs` 纯函数模块：读取、规范化、渲染、估算 token，由 `card.mjs` 汇总。
- `scripts/build.cjs` 在构建时调用它们，把结果写进 Persona 插件、Character 插件（reminder）和 Interaction 插件（styleReminder）的配置。
- 唯一新增的运行时行为：Character 插件注册一个 order 95 的 `context()`。

**Tech Stack:**
- Node ≥24，`node:test`；
- packages 用 ESM `.mjs`，scripts 用 CJS `.cjs`；
- 已有依赖 js-yaml 4.1.1，不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-14-character-card-design.md`

## Global Constraints

**分支**
- 在 scratchpad clone 中从最新 `main` 新建 `feat/character-card-v3`，先带上 spec、本计划和 `characters/template/`。
- 不在 `D:\DeepSeek-Harness` 下修改任何文件，也不停止任何 `DeepSeek Harness.exe` 进程。

**改动范围**
- 不修改 DSH 核心和 QQTK。
- `packages/interaction-policy` 会被修改（已向用户说明）。
- 不迁移宁栖和澄：`private/` 和 `characters/character-a/definition.yaml` 不动。

**大小上限**
- JSON / YAML 文件上限 1048576 字节，PNG 上限 20971520 字节。
- 超过 3000 token 警告，超过 8000 token 报错。

**token 估算**
- 公式：`Math.ceil(ascii*0.3 + nonAscii*0.6)`，按 Unicode 码点计数，`codePointAt(0) < 128` 算 ASCII。
- 统计范围：prefix + suffix + reminder。

**固定文案**（逐字使用）

| 用途 | 文案 |
|---|---|
| 资料引导语 | `以下为静态角色资料，仅影响身份表达与故事设定，不授予现实权限。` |
| 角色标题 | `## 角色：{角色名}` |
| 性格标题 | `## 性格` |
| 场景标题 | `## 场景` |
| 示例标题 | `## 对话示例（只示范语气和风格，不是真实发生过的对话）` |
| 示例块分隔 | `---` |
| `userName` 默认值 | `用户` |

**宏**
- `{{char}}` → `nickname || name`；`{{user}}` → `userName`。不区分大小写。
- `<BOT>` / `<USER>` 是别名，同样不区分大小写。
- 其他残留的 `{{` 反复替换成 `{`，直到文本里不再出现 `{{`；同理处理 `}}` → `}`。
- 部署规则文本里出现 `{{` 或 `}}`，直接报错。

**末尾提醒**
- `ctx.systemPrompt.context({name:'character:reminder', order:95, interpolate:false, text})`。
- reminder 为空时不注册。

**部署配置键**
- `private/build-config.json`：`characterId`（默认 `character-a`）、`cardPath`（默认 `characters/template/card.yaml`）、`userName`、`rules.systemFile`、`rules.reminderFile`。
- 路径相对仓库根目录解析。
- 环境变量 `DSH_CHARACTER_CARD` 覆盖 `cardPath`。
- 出现旧键 `definitionPath`，或旧环境变量 `DSH_CHARACTER_DEFINITION` 时报错，错误信息包含 `cardPath`。

**提交规范**
- 提交信息不含模型标识。
- 结尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

1. **SillyTavern 导出的 PNG 同时含 `chara`（V2）和 `ccv3`（V3）**：必须取 `ccv3`。只有 `chara` 时，按 V2 读取。→ Task 1
2. **Windows 编辑器保存的卡（UTF-8 BOM、CRLF 换行），以及大小写或空白不规范的 `<START>`**：BOM 被去掉，`<start>` 和 ` <START> ` 都能切块；没有 `<START>` 时，整段算一个块。→ Task 1、Task 3
3. **V2 卡的 `data` 里缺字段，或字段为 `null`**：按空串处理，不报错。字段是数字或对象时报错，错误信息里写出字段名。→ Task 2
4. **卡里有 `{{random::a::b}}`、`{{ user }}`、`{{{{x}}}}` 这类非常规宏**：渲染结果中不能留下任何 `{{`（DSH 严格插值遇到会抛错），并发出降级警告列出这些宏。→ Task 3
5. **规则文件带 BOM、CRLF 或首尾空白**：读取时清理干净；规则文件路径指向不存在的文件时，报错并写出路径。→ Task 4

---

### Task 1: token 估算和卡文件读取

**Files:**
- Create: `packages/character-definition/card-tokens.mjs`
- Create: `packages/character-definition/card-reader.mjs`
- Test: `tests/card-reader.test.mjs`

**Interfaces:**
- Produces:
  - `estimatePromptTokens(text: string): number`（card-tokens.mjs）
  - `readCardFile(file: string, {parseYaml: (text:string)=>unknown}): {raw: unknown, bytes: Buffer, format: 'json'|'png'|'yaml'}`（card-reader.mjs）
  - `extractPngCardText(bytes: Buffer): string`（card-reader.mjs）
  - `class CardError extends Error`（card-reader.mjs，所有卡相关错误都用它，`message` 为中文）

- [ ] **Step 1: Write the failing tests**

```js
test('estimatePromptTokens uses DeepSeek ratios',()=>{
 assert.equal(estimatePromptTokens(''),0);
 assert.equal(estimatePromptTokens('abcdefghij'),3);   // 10*0.3
 assert.equal(estimatePromptTokens('一二三四五'),3);     // 5*0.6
 assert.equal(estimatePromptTokens('ab一'),2);          // ceil(0.6+0.6)
});
test('readCardFile reads json/yaml and strips BOM',()=>{ /* 写临时 .json（带 \uFEFF）和 .yaml，raw.spec==='chara_card_v3' */ });
test('PNG: ccv3 chunk wins over chara; chara alone is used',()=>{
 // 辅助函数 png(chunks) 拼出：8 字节签名 + 若干 tEXt 块（keyword\0base64）+ IEND。CRC 写 0，读取器不校验 CRC
 // 两个块都有时 → raw.spec==='chara_card_v3'；只有 chara → 'chara_card_v2'；都没有 → throws CardError /PNG 中没有角色卡数据/
});
test('size, encoding and format errors',()=>{
 // .json 1048577 字节 → /1 MB/；.png 20971521 字节 → /20 MB/
 // 非 UTF-8 字节（0xff 0xfe 0xfd）→ /UTF-8/
 // .charx、.webp → /不支持的角色卡格式/
 // 签名错误的 .png → /不是有效的 PNG/
 // 所有错误 instanceof CardError，且 message 包含文件路径
});
```

- [ ] **Step 2: Run** `node --test tests/card-reader.test.mjs` → Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement**
  - 按扩展名分派：`.json` / `.yaml` / `.yml` / `.png`，不区分大小写。
  - 先检查大小上限，再用 `TextDecoder('utf-8',{fatal:true})` 解码，并去掉开头的 `\uFEFF`。
  - PNG：校验 8 字节签名，逐块遍历（4 字节长度 + 4 字节类型 + 数据 + 4 字节 CRC），读到 IEND 为止。取 `tEXt` 块中 keyword 为 `ccv3` 或 `chara` 的数据，base64 解码后按 UTF-8 解码。
  - JSON 解析失败时，抛 `CardError` 并带上原因。

- [ ] **Step 4: Run** `node --test tests/card-reader.test.mjs` → Expected: PASS

- [ ] **Step 5: Commit** `feat(card): token estimate and card file reader`

### Task 2: 规范化（V1 / V2 / V3 → CCv3 data）

**Files:**
- Create: `packages/character-definition/card-normalize.mjs`
- Test: `tests/card-normalize.test.mjs`

**Interfaces:**
- Consumes: `CardError`（Task 1）
- Produces: `normalizeCard(raw: unknown, file: string): {spec: 'v1'|'v2'|'v3', data: CardData}`
  - `CardData`：`name`、`nickname`、`description`、`personality`、`scenario`、`mes_example`、`system_prompt`、`post_history_instructions`，全部为 string（缺失或 `null` 时为 `''`）；另有 `bookEntryCount: number`，取 `character_book.entries.length`，没有时为 0。
  - 其他字段不保留。

- [ ] **Step 1: Write the failing tests**

```js
test('detects v3, v2, v1',()=>{
 assert.equal(normalizeCard({spec:'chara_card_v3',spec_version:'3.0',data:{name:'A',description:'d'}},'f').spec,'v3');
 assert.equal(normalizeCard({spec:'chara_card_v3',spec_version:'3.1',data:{name:'A',description:'d'}},'f').spec,'v3');
 assert.equal(normalizeCard({spec:'chara_card_v2',spec_version:'2.0',data:{name:'A',personality:'p'}},'f').spec,'v2');
 assert.equal(normalizeCard({name:'A',scenario:'s'},'f').spec,'v1');
});
test('missing or null fields become empty strings',()=>{
 const {data}=normalizeCard({spec:'chara_card_v2',data:{name:'A',description:'d',personality:null}},'f');
 assert.equal(data.personality,'');assert.equal(data.mes_example,'');assert.equal(data.nickname,'');assert.equal(data.bookEntryCount,0);
});
test('book entry count',()=>{assert.equal(normalizeCard({spec:'chara_card_v3',spec_version:'3.0',data:{name:'A',description:'d',character_book:{entries:[{},{}]}}},'f').data.bookEntryCount,2);});
test('rejects bad input with field names',()=>{
 assert.throws(()=>normalizeCard({spec:'chara_card_v4',data:{}},'f'),/不支持的规格/);
 assert.throws(()=>normalizeCard({spec:'chara_card_v3',spec_version:'2.0',data:{name:'A',description:'d'}},'f'),/spec_version/);
 assert.throws(()=>normalizeCard({spec:'chara_card_v3',spec_version:'3.0',data:{description:'d'}},'f'),/name/);
 assert.throws(()=>normalizeCard({spec:'chara_card_v3',spec_version:'3.0',data:{name:'A',description:5}},'f'),/description/);
 assert.throws(()=>normalizeCard({spec:'chara_card_v3',spec_version:'3.0',data:{name:'A'}},'f'),/description、personality、scenario 不能全为空/);
 assert.throws(()=>normalizeCard([],'f'),CardError);
});
```

- [ ] **Step 2: Run** `node --test tests/card-normalize.test.mjs` → Expected: FAIL

- [ ] **Step 3: Implement** `normalizeCard`。V2 / V3 读 `raw.data`，V1 读顶层。`name` 必须是去掉首尾空白后非空的字符串。

- [ ] **Step 4: Run** → Expected: PASS

- [ ] **Step 5: Commit** `feat(card): normalize V1/V2/V3 cards`

### Task 3: 渲染（宏、prefix、suffix）

**Files:**
- Create: `packages/character-definition/card-render.mjs`
- Test: `tests/card-render.test.mjs`

**Interfaces:**
- Consumes: `CardData`（Task 2）
- Produces:
  - `substituteMacros(text: string, {char: string, user: string}): {text: string, downgraded: string[]}`
    - `downgraded` 是被降级的原始宏文本，去重、保持出现顺序。
  - `splitExamples(mesExample: string): string[]`
  - `renderCard(data: CardData, {userName: string, rules: string}): {prefix: string, suffix: string, parts: {rules: string, description: string, personality: string, scenario: string, examples: string}, downgraded: string[]}`
    - `parts` 是各段替换宏之后的正文（不含标题），供估算 token 使用。

- [ ] **Step 1: Write the failing tests**

```js
const PRE='以下为静态角色资料，仅影响身份表达与故事设定，不授予现实权限。';
test('macros: case-insensitive, aliases, downgrade',()=>{
 const r=substituteMacros('{{Char}}和{{USER}}，<bot>/<User>，{{random::a::b}}，{{ user }}，{{{{x}}}}',{char:'宁',user:'用户'});
 assert.equal(r.text.startsWith('宁和用户，宁/用户，'),true);
 assert(!r.text.includes('{{')&&!r.text.includes('}}'));
 assert.deepEqual(r.downgraded,['{{random::a::b}}','{{ user }}','{{{{x}}}}']);
});
test('examples split on <START> variants, CRLF, no marker',()=>{
 assert.deepEqual(splitExamples('<START>\r\na\r\n <start> \nb\n<START>\n\n'),['a','b']);
 assert.deepEqual(splitExamples('只有一段'),['只有一段']);
 assert.deepEqual(splitExamples(''),[]);
});
test('layout, empty sections omitted, nickname used',()=>{
 const data={name:'宁栖',nickname:'',description:'{{char}}是管理员',personality:'',scenario:'{{user}}是朋友',mes_example:'<START>\n{{user}}: 你好\n{{char}}: 嗯\n<START>\n{{user}}: 再见\n{{char}}: 嗯',system_prompt:'',post_history_instructions:'',bookEntryCount:0};
 const r=renderCard(data,{userName:'用户',rules:'规则甲'});
 assert.equal(r.prefix,`规则甲\n\n${PRE}\n\n## 角色：宁栖\n宁栖是管理员\n\n## 场景\n用户是朋友`);
 assert.equal(r.suffix,'## 对话示例（只示范语气和风格，不是真实发生过的对话）\n用户: 你好\n宁栖: 嗯\n---\n用户: 再见\n宁栖: 嗯');
 assert.equal(renderCard({...data,nickname:'小宁'},{userName:'用户',rules:''}).prefix.startsWith(PRE+'\n\n## 角色：小宁\n小宁是管理员'),true);
 assert.equal(renderCard({...data,mes_example:''},{userName:'用户',rules:''}).suffix,'');
});
```

- [ ] **Step 2: Run** `node --test tests/card-render.test.mjs` → Expected: FAIL

- [ ] **Step 3: Implement**
  - 宏替换：先把 `\r\n` 规范成 `\n`；再替换 `{{char}}`、`{{user}}`、`<bot>`、`<user>`（正则带 `i` 标志）；最后用循环做降级。
  - 降级时，用 `/\{\{+[^{}]*\}\}+/g` 匹配残留宏并记录原文（`{{{{x}}}}` 整体算一个），再把其中连续的 `{` 和 `}` 各压成一个。
  - 之后如果文本里仍有零散的 `{{` 或 `}}`，循环替换成单个，直到两者都不出现为止。
  - prefix 各段之间用 `\n\n` 连接，标题和正文之间用 `\n`，每段正文去掉首尾空白。
  - 示例块之间用 `\n---\n` 连接。

- [ ] **Step 4: Run** → Expected: PASS

- [ ] **Step 5: Commit** `feat(card): render card into persona prefix/suffix`

### Task 4: 汇总加载、上限、警告和模板

**Files:**
- Create: `packages/character-definition/card.mjs`
- Modify: `characters/template/card.yaml`、`rules.md`、`reminder.md`（只在测试暴露问题时才改）
- Test: `tests/card.test.mjs`

**Interfaces:**
- Consumes: Task 1–3 的全部导出
- Produces:
  - `loadCard({cardPath: string, systemRulesPath?: string|null, reminderPath?: string|null, userName?: string, parseYaml}): CardBuild`
  - `CardBuild` = `{name, spec, prefix, suffix, reminder, tokens: {total, fields: {rules, description, personality, scenario, examples, reminder}}, warnings: string[]}`
  - 导出常量：`WARN_TOKENS = 3000`、`MAX_TOKENS = 8000`
  - 再导出 `CardError`、`estimatePromptTokens`

- [ ] **Step 1: Write the failing tests**

```js
test('template card builds clean',()=>{
 const b=loadCard({cardPath:'characters/template/card.yaml',systemRulesPath:'characters/template/rules.md',reminderPath:'characters/template/reminder.md',parseYaml:yaml.load});
 assert.equal(b.spec,'v3');assert.equal(b.name,'示例角色');assert.deepEqual(b.warnings,[]);
 assert(!/\{\{|\}\}/.test(b.prefix+b.suffix+b.reminder));assert(b.tokens.total<3000);
});
test('warnings',()=>{
 // system_prompt='Write 2-4 paragraphs…'（超过 60 字）→ 某条警告以 '已忽略 system_prompt：「' 开头，且只含前 60 个字
 // post_history_instructions 非空 → '已忽略 post_history_instructions：「'
 // character_book.entries 3 条 → '设定集 3 条，第二期才生效，目前不起作用'
 // 卡里有 {{random::a}} → '以下宏已降级为单花括号：{{random::a}}'
 // first_mes、creator_notes 非空 → 不产生警告
 // description 为约 3100 token 的中文 → 警告含 '超过 3000'
});
test('errors',()=>{
 // 约 8100 token → throws /上限 8000/，且 message 里有占比最大的字段名，例如 'description'
 // 规则文件含 '{{x}}' → throws /规则文件/
 // systemRulesPath 指向不存在的文件 → throws，message 包含该路径
});
test('rules files: BOM, CRLF, whitespace trimmed; reminder counted in total',()=>{
 // rules 文件内容 '\uFEFF  甲\r\n乙  \r\n' → prefix 以 '甲\n乙\n\n以下为静态角色资料' 开头
 // reminder '提醒' → b.reminder==='提醒'，b.tokens.fields.reminder===2
 // b.tokens.total===每段估算值之和
});
```

- [ ] **Step 2: Run** `node --test tests/card.test.mjs` → Expected: FAIL

- [ ] **Step 3: Implement** `loadCard`：读取 → 规范化 → 渲染 → 估算 → 生成警告 → 检查上限。
  - 总 token = 各段（rules、description、personality、scenario、examples、reminder）估算值之和。
  - 超过上限的报错信息：`渲染后的人设约 ${total} token，上限 8000。占比最大的字段：` 后面接最大的三个字段及其数值。
  - 警告文案：

| 情况 | 文案 |
|---|---|
| 超过警告线 | `人设约 ${total} token，超过 3000，模型可能忽略部分规则` |
| 卡带规则字段 | `已忽略 ${field}：「${前60字}」` |
| 卡带设定集 | `设定集 ${n} 条，第二期才生效，目前不起作用` |
| 宏被降级 | `以下宏已降级为单花括号：${list.join('、')}` |

- [ ] **Step 4: Run** → Expected: PASS

- [ ] **Step 5: Commit** `feat(card): load card with limits and warnings; template`

### Task 5: 构建接入（配置、build、ensure-build）

**Files:**
- Create: `scripts/card-source.cjs`（取代 `scripts/definition-source.cjs`，删除后者）
- Modify: `scripts/build-settings.cjs`、`scripts/build.cjs`、`scripts/ensure-build.cjs`、`scripts/build-inputs.cjs`、`scripts/check-interaction-build.cjs`
- Delete: `packages/character-definition/loader.mjs`、`tests/definition.test.mjs`
- Test: `tests/card-source.test.mjs`

**Interfaces:**
- Consumes: `loadCard`（Task 4）
- Produces:
  - `card-source.cjs` 导出 `cardSettings(): {characterId, cardPath, systemRulesPath, reminderPath, userName}`（路径为绝对路径或 `null`）。
  - `card-source.cjs` 导出 `cardRevisions(s): {revision: string, rulesRevision: string}`：分别对卡文件字节，以及「两个规则文件内容，按 system、reminder 顺序，缺失视为空串」做 sha256，结果为 hex。
  - `build-settings.cjs` 返回值：去掉 `definitionPath`，加入 `characterId` 和 `card: {cardPath, systemRulesPath, reminderPath, userName}`，这个对象可以直接展开传给 `loadCard`。
  - `build.cjs` 的输出：
    - Persona `config.prefix` = `card.prefix`；
    - `card.suffix` 非空时写入 `config.suffix`；
    - Character 插件配置加 `reminder`；
    - interaction 选项加 `styleReminder`（仅在非空时加）；
    - manifest 写入 `characterId`、`card: {spec, revision, tokens, warnings}`、`rulesRevision`，去掉 `definitionRevision`。

- [ ] **Step 1: Write the failing tests** `tests/card-source.test.mjs`，用 `DSH_CHARACTER_BUILD_CONFIG` 指向临时配置：

```js
test('defaults to template card',()=>{ /* 空配置 → cardPath 以 characters/template/card.yaml 结尾，characterId==='character-a'，userName==='用户'，两个 rules 路径为 null */ });
test('config keys and env override',()=>{ /* cardPath/rules/userName/characterId 生效；DSH_CHARACTER_CARD 覆盖 cardPath */ });
test('old keys rejected',()=>{ /* {definitionPath:'x'} → throws /cardPath/；env DSH_CHARACTER_DEFINITION → throws /cardPath/ */ });
test('invalid values rejected',()=>{ /* characterId 'Bad Id' → throws（规则同旧的 /^[a-z0-9-]{1,48}$/）；userName 为空串或超过 32 字 → throws */ });
test('cardRevisions changes when card or either rules file changes',()=>{ /* 三次修改，三个哈希各自变化 */ });
```

- [ ] **Step 2: Run** `node --test tests/card-source.test.mjs` → Expected: FAIL

- [ ] **Step 3: Implement** `card-source.cjs`，然后接入以下脚本：

| 文件 | 改动 |
|---|---|
| `build.cjs` | 每条警告用 `console.warn('角色卡警告：'+w)` 打印 |
| `ensure-build.cjs` | 用 `cardRevisions` 和 manifest 中的 `card.revision`、`rulesRevision` 比较；错误信息改为 `Creator, release or character card changed; rebuild and validate before deploy` |
| `build-inputs.cjs` | 摘要列表加入 `scripts/card-source.cjs` 和 4 个 `packages/character-definition/card*.mjs` |
| `check-interaction-build.cjs` | 复制文件列表改成新文件；fixture 改写成最小 V3 JSON 卡；环境变量改用 `DSH_CHARACTER_CARD` |

- [ ] **Step 4: Run** `npm test` → Expected: 全部 PASS，且不再有 definition.test

- [ ] **Step 5: Run** 构建检查。它会读取宿主归档，只读，不改动生产：

```bash
DSH_INSTALL_ROOT='D:\DeepSeek-Harness\host-runtimes\0.2.2-rc.1' DSH_CHARACTER_HOST_ROOT='D:\DeepSeek-Harness\host-runtimes\0.2.2-rc.1' node scripts/check-interaction-build.cjs
```

Expected：输出 `{"ok":true,...}`。另外在 fixture 的 patch 中，Persona 插件有 prefix，`character-memory-tools` 插件配置里有 `reminder` 键。

- [ ] **Step 6: Commit** `feat(card): wire card loading into build and deploy checks`

### Task 6: 末尾提醒（运行时）

**Files:**
- Create: `packages/character-memory-tools/reminder.mjs`
- Modify: `packages/character-memory-tools/character.mjs`（`apply` 中调用）
- Test: `tests/character-reminder.test.mjs`

**Interfaces:**
- Produces: `registerReminder(ctx, reminder: unknown): boolean`
  - reminder 是非空字符串时注册并返回 `true`，否则返回 `false`。
  - 不是字符串，或者长度超过 4000 时抛错。

- [ ] **Step 1: Write the failing tests**

```js
test('registers order 95 context without interpolation',()=>{
 const calls=[];const ctx={effect:f=>f(),systemPrompt:{context:o=>calls.push(o)}};
 assert.equal(registerReminder(ctx,'嗯，开头'),true);
 assert.equal(calls[0].name,'character:reminder');assert.equal(calls[0].order,95);assert.equal(calls[0].interpolate,false);assert.equal(calls[0].text({}),'嗯，开头');
});
test('empty or missing reminder registers nothing',()=>{ /* '', undefined, '   ' → false，calls 为空 */ });
test('character.mjs calls registerReminder with config.reminder',()=>{ /* 和 root-policy.test 一样做源码断言：/registerReminder\(ctx,config\.reminder\)/ */ });
test('contact/guest presets carry no reminder',()=>{ /* 调 rolePresets（参照 role-presets.test 的 owner fixture，在 character-memory-tools 配置中加 reminder:'x'），contact/guest 的插件里没有 character-memory-tools */ });
```

- [ ] **Step 2: Run** `node --test tests/character-reminder.test.mjs` → Expected: FAIL

- [ ] **Step 3: Implement** `registerReminder`，并在 `character.mjs` 的 `apply` 末尾加一行调用。

- [ ] **Step 4: Run** `npm test` → Expected: PASS

- [ ] **Step 5: Commit** `feat(character): end-of-history style reminder context`

### Task 7: 等待提示生成器适配（Interaction）

**Files:**
- Modify: `packages/interaction-policy/policy.mjs`（`options` 中加 `styleReminder`）
- Modify: `packages/interaction-policy/index.mjs`（`hangOnPrompt` 和 persona 截断）
- Test: `tests/interaction-hang-on.test.mjs`（追加）

**Interfaces:**
- Produces:
  - `options({styleReminder?: string})`：字符串长度 ≤4000，否则抛 `Invalid interaction option: styleReminder`；不传时结果中没有这个键。
  - `hangOnPrompt(persona: string, reminder = ''): string`：reminder 非空时放在 persona 之后、`【等待提示】` 之前，两侧各用 `\n\n` 分隔。
  - persona 截断上限从 8000 字符改为 32000 字符。（实现方决定：构建端已经保证不超过 8000 token，这里只作兜底）

- [ ] **Step 1: Write the failing tests**（追加到现有文件）

```js
test('hang-on prompt includes style reminder after persona',()=>{
 assert.equal(hangOnPrompt('P','R').startsWith('P\n\nR\n\n【等待提示】'),true);
 assert.equal(hangOnPrompt('P').startsWith('P\n\n【等待提示】'),true);
 const f=plugin({styleReminder:'嗯，开头'});/* draft 后 stream 的 system 包含 '（后缀）\n\n嗯，开头\n\n【等待提示】' */
});
test('persona up to 32000 chars is not truncated',()=>{ /* persona='字'.repeat(20000) → system 中包含完整的 20000 字 */ });
test('styleReminder validation',()=>{ assert.throws(()=>options({styleReminder:'x'.repeat(4001)}),/styleReminder/);assert.throws(()=>options({styleReminder:3}),/styleReminder/);assert.equal('styleReminder' in options({}),false); });
```

- [ ] **Step 2: Run** `node --test tests/interaction-hang-on.test.mjs` → Expected: 新测试 FAIL

- [ ] **Step 3: Implement**：`drafter` 改为调用 `hangOnPrompt(persona(agent), config.styleReminder ?? '')`。

- [ ] **Step 4: Run** `npm test` → Expected: PASS

- [ ] **Step 5: Commit** `feat(interaction): hang-on drafts follow the style reminder`

### Task 8: 检查命令和导出命令

**Files:**
- Create: `scripts/check-card.cjs`、`scripts/export-card.cjs`
- Test: `tests/card-cli.test.mjs`

**Interfaces:**
- Consumes: `loadCard`、`readCardFile`、`normalizeCard`、`CardError`
- Produces 两个命令：

| 命令 | 行为 |
|---|---|
| `node scripts/check-card.cjs <card> [--rules <file>] [--reminder <file>] [--user-name <name>]` | 不读部署配置。输出：角色名、规格版本、总 token、各字段 token、每条警告（以 `⚠ ` 开头）。成功退出码 0；`CardError` 时把 message 输出到 stderr，退出码 1 |
| `node scripts/export-card.cjs <card.yaml> [<out.json>]` | 先用 `normalizeCard` 校验，再把**原始解析对象**按 2 空格缩进写成 JSON，末尾加换行。没有指定 out 时输出到 stdout。输入不是 `.yaml` 或 `.yml` 时，退出码 1 |

- [ ] **Step 1: Write the failing tests**（用 `spawnSync(process.execPath, …)`）

```js
test('check-card reports template',()=>{ /* status 0；stdout 含 '示例角色'、'v3'、'token' */ });
test('check-card shows warnings and fails on errors',()=>{ /* 带 system_prompt 的卡 → stdout 含 '⚠ 已忽略 system_prompt'；超长卡 → status 1，stderr 含 '上限 8000' */ });
test('export-card round-trips template',()=>{ /* 导出 JSON 后：JSON.parse(out) 深等于 yaml.load(模板)；再对导出的 .json 跑 check-card，status 0 */ });
```

- [ ] **Step 2: Run** `node --test tests/card-cli.test.mjs` → Expected: FAIL

- [ ] **Step 3: Implement** 两个脚本。ESM 模块用 `await import()` 加载，参照 `build.cjs` 的写法。

- [ ] **Step 4: Run** `npm test` → Expected: PASS

- [ ] **Step 5: Commit** `feat(card): check-card and export-card commands`

### Task 9: portable 入口和文档

**Files:**
- Modify: `scripts/portable.cjs`
  - 读 `c.card`、`c.rules?.system`、`c.rules?.reminder`、`c.userName`、`c.characterId`，路径相对配置文件解析；
  - 没有 `c.card` 时用模板；
  - 出现 `c.definition` 时 assert 失败，提示改用 `card`；
  - 写出的 build 配置使用 Task 5 的新键名。
- Modify: `examples/portable.config.example.json`（`definition` 改为 `card`，并加上 `rules` 示例）
- Modify: `README.md`（`packages/character-definition` 的说明改为「CCv3 角色卡读取、校验与 Persona 渲染」）
- Modify: `docs/REUSE.md:96`（`definitionPath` / `DSH_CHARACTER_DEFINITION` / `definition-source.cjs` 改成新名称）
- Test: `tests/card-source.test.mjs`（追加 portable 键名测试）

- [ ] **Step 1: Write the failing test**：`portable.cjs` 源码里不再出现 `definitionPath`，并且出现 `c.definition` 时会被拒绝。参照 `deployment-plan.test.mjs` 的源码断言风格，正则匹配 `c\.definition` 所在的 assert。

- [ ] **Step 2: Run** → Expected: FAIL

- [ ] **Step 3: Implement**，并更新文档。

- [ ] **Step 4: Run** `npm test`，以及 `npm run test:audit` → Expected: PASS

- [ ] **Step 5: Commit** `feat(card): portable config and docs use character cards`

### Task 10: 全量验证

- [ ] **Step 1:** `npm test`，以及 `npm run test:audit` → 全部 PASS。

- [ ] **Step 2:** 运行原生门禁（耗时超过 10 分钟，后台运行。只读取生产宿主，homes 写在 clone 的 `test-data/` 下）：

```bash
powershell -NoProfile -File scripts/run-native-gates.ps1 -Summary test-data/native-summary.json
```

  - 环境变量：
    - `DSH_INSTALL_ROOT` 和 `DSH_CHARACTER_HOST_ROOT` 都指向 `D:\DeepSeek-Harness\host-runtimes\0.2.2-rc.1`；
    - `DSH_QQTK_PROJECT` 指向 scratchpad 里的 QQTK clone；
    - 从 pwsh 调用时，去掉 `PSModulePath`。
  - Expected：summary 的 verdict 为 `passed`。

- [ ] **Step 3:** 用户的测试角色写好后，执行：

```bash
node scripts/check-card.cjs <测试角色卡> --rules <rules> --reminder <reminder>
```

  - 检查输出的 token 数和警告是否合理。
  - 再用 `DSH_CHARACTER_BUILD_CONFIG` 指向一份临时配置构建一次，检查 `bundles/character-core/cordis.patch.yml` 里的 prefix、suffix 和 reminder。
  - **不部署**。
