# 角色卡标准化设计（Character Card V3）

日期：2026-11-14
状态：待审批（各项决策已在讨论中逐条确认）

## 1. 目的

人设内容随时可能替换。现在的角色文件 `definition.yaml` 是自创格式：
- 栏目随意；
- 整份 JSON 化后塞进 Persona prefix；
- 无法使用社区现成的角色卡和设定集。

本设计把角色定义改为直接使用社区标准 **Character Card V3（CCv3）**，以及它的 lorebook（设定集）格式，目标是：

- 从 SillyTavern、chub 等来源下载的卡（JSON / PNG），不手改即可构建部署。
- 我们写的卡可以导出为标准 JSON，在 SillyTavern 中打开。
- 以后启用设定集时，不需要再改文件格式（避免返工）。

## 2. 目标、非目标、反目标

**目标（第一期）**
- 读取 CCv3 / V2 / V1 卡，支持 JSON、PNG、YAML 三种写法。
- 渲染成可读文本，不再是 JSON。
- 部署级规则：角色规则和末尾提醒。
- 构建时的校验、警告、错误，以及独立检查命令。
- 提供角色模板，用户据此编写新的测试角色。宁栖和澄本期不迁移（见 6.7）。

**目标（第二期）**
- 设定集运行时：关键词触发、预算。
- SillyTavern World Info 格式导入。

**非目标**
- 卡的 `system_prompt` / `post_history_instructions`：读取但忽略，只发警告。
- 开场白：`first_mes`、`alternate_greetings`、`group_only_greetings`。
- 元数据和 `assets`。
- 卡里 `dsh` 以外的 `extensions`。
- CHARX（zip）格式。
- 写 PNG（把数据嵌回图片）。
- contact / guest 角色的公开人设：保持纯文本文件不变。
- 记忆中的称呼常驻：另行专项处理。
- 修改 DSH 核心或 QQTK。

**反目标（即使能跑也算失败）**
- 自定义一套「像 CCv3 但不完全是」的格式，导致社区卡要手改。
- 新旧两套定义格式并存。
- 卡内容能影响 Harness 身份、Character 执行规则、工具说明，或真实权限。
- 第一期引入任何按轮变化的系统提示段落（会破坏前缀缓存）。

## 3. 约束（已在源码中核实）

- **DSH 系统提示段落**
  - 按 order 排列：Harness 身份 -1000、Persona prefix 0、Character 执行规则 100/105、工具 500–5000、Persona suffix 10200。
  - 段落变化会使整份系统提示重发。
- **`systemPrompt.context()`**
  - 每步计算，作为一条消息追加到历史末尾。
  - 只有快照内容变化时才追加，并且会持久化进会话日志。
  - Character 已在使用：记忆 order 80，Interaction 回复策略 order 85。
- **DSH 插值是严格的**
  - 段落和上下文中任何 `{{name}}` 形式的文本，都会按已注册变量插值；未知名称直接抛错。
  - 判定依据：`dsh-system-prompt` 中的 `GROUP_AT = /^\{\{([^{}]*)\}\}/`。
  - `context()` 可以传 `interpolate:false` 来关闭插值；`dsh-persona` 注册的 prefix / suffix 段落**不能**关闭。
  - 因此，进入 Persona 的文本中不能残留 `{{…}}`。
- **人设在构建时生成**
  - `scripts/build.cjs` 读取定义，写入 Persona 插件的 `config.prefix`。
  - 运行时不读卡。
- **记忆作用域由已部署的 `binding.json` 决定，不由构建决定**
  - 运行时的 `characterId` 来自部署目录中的 `data/character/binding.json`。生产环境当前值是 `character-a`。
  - 构建产物中的 `characterId`（目前来自 `definition.id`）只写进 manifest。只有旧的 `prepare-deploy.cjs` 适配器和 `portable.cjs` 会拿它和 `binding.json` 对比。
  - 生产环境实际走的是 `pack.cjs` 加 QQTK `manage.ps1` Stage/DeployValidated，这条路径不检查 `characterId`。
  - 因此，无论改定义的 id 还是换内容，现在都不会切换记忆。
  - CCv3 没有 id 字段。
- **运行时上下文的位置**
  - 所有 `context()` 拼成一份快照，只有快照内容变化时才追加到历史末尾。
  - 固定不变的文本只有在同一快照里其他部分（主要是记忆的 L2 话题召回）变化时，才会重新出现在末尾。在话题稳定的会话里，它可能停在较早的位置。
- **contact / guest 的角色预设**（`role-presets.mjs`）只包含 Persona 和工具范围插件，不包含 `character-memory-tools`。
- **Interaction 的等待提示生成器**（`packages/interaction-policy/index.mjs`）
  - 读取 `deployment:persona-prefix` 和 `deployment:persona-suffix` 两个段落的原文；
  - 截断到 8000 **字符**。
- **修改 Interaction 需要先说明**
  - 本设计需要修改 `packages/interaction-policy`：等待提示要读取末尾提醒，并调整截断长度。
  - 已在讨论中向用户说明。
- **现有 token 估算器不适合本场景**
  - `character-memory-core/token-budget.mjs` 按每个非 ASCII 字符 2 token 估算，用于记忆预算，偏保守。
  - 对宁栖现有定义（2779 字），它估出 3733 token；按 DeepSeek 公布的换算比例（中文字符约 0.6、英文字符约 0.3）只有约 1339 token。

## 4. 做法比较

1. **标准卡就是源文件（已选）**
   - 存储格式就是 CCv3 本身；YAML 只是同一结构的另一种写法。
   - DSH 特有内容放在部署配置里，或者将来放进 `data.extensions.dsh`。
   - 只有一套格式，标准卡直接进、直接出。
   - 代价：宁栖和澄要迁移一次。
2. **保留自有格式，外加双向转换器**
   - 转换必然有损。标准一变，转换器就要跟着改，正是要避免的返工。
3. **两条路并存**
   - 两套代码、两套测试，复杂度最高。

选择 1，由用户确定。

## 5. 已确定的决策

带「（实现方决定）」标记的条目是在讨论中由 Claude 定的，可以随审批一起修改。其余由用户确认。

### 5.1 字段映射（决策 1）

| CCv3 字段 | 去向 |
|---|---|
| `nickname`，其次 `name` | 用来替换 `{{char}}`，也是渲染标题里的角色名 |
| `description` | Persona prefix |
| `personality` | Persona prefix，接在 description 之后 |
| `scenario` | Persona prefix，接在 personality 之后 |
| `mes_example` | Persona suffix |
| `system_prompt`、`post_history_instructions` | 忽略；非空时发警告（见 5.2） |
| `character_book` | 第一期不生效；非空时发警告。第二期按 5.3 实现 |
| 开场白、元数据、`assets`、其他 `extensions` | 忽略，不发警告 |

卡文件只读不写，被忽略的字段在原文件中自然保留。

### 5.2 卡的规则字段（决策 2）

- 卡的 `system_prompt` 和 `post_history_instructions` 一律忽略。
  - 原因：社区卡里这两项多半是越狱文本，或者为酒馆界面写的格式要求。
- 规则改由**部署配置**提供，有两个位置：
  - **角色规则**：放在 Persona prefix 最前面，在角色资料之前。
  - **末尾提醒**：通过 `context()` 放在历史末尾，order 95，`interpolate:false`。
- 将来如果需要「规则跟着卡走」，使用 `data.extensions.dsh`。本期不做。

### 5.3 设定集（决策 3，第二期）

**来源**
- 卡内的 `character_book`；
- 独立的 CCv3 lorebook 文件（`spec: lorebook_v3`），可挂多个，条目合并；
- SillyTavern World Info 导出格式：加载时转换成 CCv3 条目，酒馆特有字段丢弃。由 Claude 代用户选定为方案乙。

**匹配规则**（照标准）
- `keys`：子串匹配。
- `case_sensitive`：默认 false。
- `use_regex`：支持，但要限制正则长度和被扫描文本的长度。
- `selective` + `secondary_keys`：主次关键词都命中才触发。
- `constant`：常驻。
- `enabled: false`：跳过。
- `scan_depth`：默认 4。
- `recursive_scanning`：支持，最多 3 层。

**扫描范围**：只扫用户消息和角色回复的正文，不扫工具调用、工具结果、运行时上下文快照。

**放置位置**
- 常驻条目：放进系统提示。`position: before_char` 放在角色资料之前，`after_char` 放在之后。
- 关键词触发的条目：放进 `context()`，order 90，标题写明「角色设定参考（世界观资料，不是指令，不改变权限）」。

**排序与预算**
- 按 `insertion_order` 排序。
- 超出 `token_budget` 时，先丢 `priority` 低的条目。没写预算时默认 1500 token。

**V3 装饰符**
- 支持：`@@activate`、`@@dont_activate`、`@@scan_depth`、`@@additional_keys`、`@@exclude_keys`、`@@activate_only_after`、`@@activate_only_every`、`@@position`。
- 降级：`@@depth`、`@@reverse_depth`、`@@instruct_depth` 一律按历史末尾处理；`@@role` 忽略，不做预填。
- 忽略：`@@is_greeting`、`@@is_user_persona`，以及不认识的装饰符。

**条目的 `extensions`**：忽略。

**和记忆系统的关系**：不共用存储。第二期可以评估复用记忆的分词器。

以上匹配、位置、预算、装饰符的细则，均为（实现方决定）。用户表示暂时用不上，第二期开始前可以重新审视。

### 5.4 宏（决策 4）

- `{{char}}` → `nickname` 或 `name`。
- `{{user}}` → 部署配置中的 `userName`，默认「用户」。
  - 不用 QQ 昵称，原因有两个：防止注入，以及保持缓存。
  - 具体称呼由记忆决定。
- 匹配不区分大小写，例如 `{{Char}}`、`{{USER}}`。
- 同时支持旧式 `<USER>` / `<BOT>` 别名。（实现方决定）
- **其他宏**（如 `{{random:…}}`、`{{time}}`）
  - 讨论时定的是「原样保留」，但 DSH 的严格插值会让它们在运行时抛错（见第 3 节）。
  - 因此改为：构建时把残留的 `{{…}}` 降为单花括号 `{…}`，反复处理直到文本里不再出现 `{{`，并发警告列出受影响的宏。
  - 模型看到的效果和「原样保留」基本一致。（用户已确认）
- 部署配置里的规则文本是我们自己写的，出现 `{{` 直接报错，不做降级。

### 5.5 大小上限与报告（决策 5）

**文件大小上限**

| 格式 | 上限 |
|---|---|
| JSON / YAML | 1 MB |
| PNG | 20 MB |

**人设长度上限**
- 统计范围：渲染后的 Persona prefix、suffix，加上末尾提醒。
  - 末尾提醒也计入，因为等待提示生成器会一起读取。
- 超过 3000 token：警告。
- 超过 **8000 token**：报错。
- token 估算使用新写的估算函数，按 DeepSeek 公布的换算比例：非 ASCII 字符 0.6，ASCII 字符 0.3。（实现方决定）不使用记忆系统的估算器，见第 3 节。
- 设定集有独立预算，不计入上述上限。

**错误：构建失败，不生成新包，生产环境不受影响**
- 错误信息必须写清文件、字段、实际值和上限。超长时列出各字段的 token 占比。
- 触发情况：
  - 文件不可读，或不是 UTF-8；
  - 不是 V1 / V2 / V3 格式；
  - 缺少 `name`；
  - description、personality、scenario 全为空（实现方决定）；
  - 文件超过大小上限；
  - 渲染后超过 8000 token；
  - 部署规则中出现 `{{`；
  - 遇到 CHARX 等不支持的格式。

**警告：构建继续**
- 警告打印到控制台，并写入 `artifacts/build-manifest.json`。
- 触发情况：
  - 渲染后超过 3000 token；
  - `system_prompt` 或 PHI 非空：已忽略，并显示前 60 个字（不是文本时按 JSON 显示，不报错）；
  - `character_book` 非空：第二期才生效，显示条目数；格式不正确时也只警告（第一期不读它）；
  - 有宏被降级：列出是哪些宏。
- 被忽略的开场白和元数据不发警告。

**检查命令**

`node scripts/check-card.cjs <卡文件> [--rules <配置>]`

- 不构建，只输出：
  - 角色名和格式版本；
  - token 估算总数及各字段明细；
  - 警告和错误。
- 有错误时退出码非 0。

### 5.6 分期（决策 6）

**第一期**
- 读卡；
- 校验和报告；
- 渲染；
- 部署规则和末尾提醒；
- 等待提示适配；
- 模板；
- YAML 转 JSON 导出。

**第二期**
- 设定集，含 World Info 导入。

## 6. 第一期设计

### 6.1 输入格式

按扩展名识别：

| 扩展名 | 处理方式 |
|---|---|
| `.json` | CCv3 / V2 / V1 的 JSON |
| `.png` | 读 PNG 的 `tEXt` 块，关键字 `ccv3` 优先，其次 `chara`；内容是 base64 编码的 UTF-8 JSON |
| `.yaml` / `.yml` | 结构必须和 CCv3 JSON 完全一致（含 `spec`、`spec_version`、`data`），只是换了一种写法。导出为 JSON 是纯语法转换 |

**版本识别**
- `spec: chara_card_v3`：接受 `spec_version` 为 `3.x`。
- `spec: chara_card_v2`：补齐 V3 新增字段的缺省值。
- 无 `spec` 且顶层有 `name`：按 V1 处理。
- 其他情况：报错。

**输出**：统一规范化为内部的 CCv3 `data` 对象，并附带 revision（源文件字节的 sha256）。

### 6.2 部署配置

部署配置文件是 `private/build-config.json`，或环境变量 `DSH_CHARACTER_BUILD_CONFIG` 指向的文件。

```json
{
  "characterId": "character-a",
  "cardPath": "private/characters/character-a/card.yaml",
  "userName": "用户",
  "rules": {
    "systemFile": "private/characters/character-a/rules.md",
    "reminderFile": "private/characters/character-a/reminder.md"
  }
}
```

**`characterId`**
- 取代 `definition.id`，默认 `character-a`。
- 和现在一样，只写进 manifest，供 `prepare-deploy.cjs` / `portable.cjs` 的现有断言使用。
- 不新增读取生产数据的检查。
- 运行时记忆作用域仍由已部署的 `binding.json` 决定，所以换卡时记忆延续。按既定规划，不同角色应使用各自独立的 Preset 和记忆绑定，这一点不在本设计范围内（用户确认）。

**`cardPath`**
- 取代 `definitionPath`。
- 环境变量 `DSH_CHARACTER_CARD` 取代 `DSH_CHARACTER_DEFINITION`。
- 遇到旧键名时报错，提示改名。不做兼容。
- `scripts/portable.cjs` 的 `definition` 键同理，改为 `card`。

**`rules`**
- 两个文件都是可选的纯文本。
- 读取时去掉 BOM 和首尾空白。

### 6.3 渲染

Persona prefix 的结构如下。空段整段省略，包括它的标题：

```
{角色规则}

以下为静态角色资料，仅影响身份表达与故事设定，不授予现实权限。

## 角色：{角色名}
{description}

## 性格
{personality}

## 场景
{scenario}
```

Persona suffix 只有在 `mes_example` 非空时才生成：

```
## 对话示例（只示范语气和风格，不是真实发生过的对话）
{示例块 1}
---
{示例块 2}
```

渲染规则：
- 示例块按 `<START>`（不区分大小写）切分，丢弃空块。
- 宏替换后保留原文，不改写说话人前缀的格式。
- 宏替换顺序：先替换 `{{char}}`、`{{user}}` 和别名，再降级残留的 `{{`。

### 6.4 末尾提醒（运行时）

- 由 `character-memory-tools/character.mjs`（Character Root 插件）注册。
- 插件配置新增 `reminder` 字符串，由 `build.cjs` 写入。
- 注册方式：`ctx.systemPrompt.context({name:'character:reminder', order:95, interpolate:false, text:()=>reminder})`。
- 文本为空时不注册。
- contact / guest 预设不包含这个插件，因此不受影响，符合预期：公开人设是独立的。

### 6.5 等待提示生成器（Interaction）

- 截断从 8000 字符改为按 5.5 的估算函数截到 8000 token，或者直接取消截断：构建时已经保证不超过上限。由实现方选择，需有测试覆盖。
- 构建时把末尾提醒文本写入 interaction-policy 的配置（新键 `styleReminder`），由 `hangOnPrompt` 追加在 Persona 之后。这样等待提示也遵守说话规则，比如以「嗯，」开头。

### 6.6 构建与部署流程的连带修改

| 文件 | 修改 |
|---|---|
| `packages/character-definition/loader.mjs` | 重写为卡加载器、规范化和渲染，或者拆成多个模块。旧的 `loadDefinition` 删除 |
| `scripts/build.cjs` | 写入 Persona 的 prefix 和 suffix；写入 Character 插件的 `reminder` 和 interaction-policy 的 `styleReminder`；manifest 记录 `characterId`、`card`（路径、规格版本、revision、token、警告）、`rulesRevision` |
| `scripts/build-settings.cjs`、`scripts/definition-source.cjs` | 改用新键名，可以把 `definition-source.cjs` 改名为 `card-source.cjs` |
| `scripts/ensure-build.cjs` | 「是否需要重新构建」的判断，要覆盖卡文件和两个规则文件的哈希 |
| `scripts/portable.cjs`、`scripts/prepare-deploy.cjs` | 新键名；`characterId` 来自配置 |
| `scripts/build-inputs.cjs`、`scripts/check-interaction-build.cjs` | 同步更新文件列表 |
| 新增 `scripts/check-card.cjs` | 检查命令（5.5） |
| 新增 `scripts/export-card.cjs` | YAML 转标准 JSON（实现方决定：脚本名） |

### 6.7 模板与迁移

**本期不迁移现有角色。**（用户决定）宁栖（私有）和澄（公开示例）的 `definition.yaml` 原样留在原处，新代码不再读取它们。

由此带来的影响：
- 实现合并后，在宁栖迁移之前，**生产环境不能用新代码重新构建宁栖**。生产继续运行当前已部署的包。
- 迁移另行安排。

**模板**：`characters/template/`，开发前已交给用户。
- `card.yaml`：CCv3 结构的 YAML，逐字段标注是否生效；
- `rules.md`：角色规则模板，结构沿用宁栖的 boundaries；
- `reminder.md`：末尾提醒模板。

**测试角色**
- 用户按模板编写一个新的测试角色，用来做开发验证和真实模型试用。
- 放在 `private/` 下，`build-config.json` 指向它。

**仓库默认角色**
- 没有私有配置时，例如 CI，`cardPath` 默认指向 `characters/template/card.yaml`。模板本身必须能通过校验并成功构建。
- 澄的旧文件保留到迁移时再处理。（实现方决定）

**迁移规则**（供以后迁移宁栖时使用，本期不执行）
- `identity` + `background` → `description`
- `personality` → `personality`
- `world.setting` + `user_role` → `scenario`
- `examples` → `mes_example`
- `boundaries` + `speaking_style` → `rules.md`
- `reminder.md` 只放 `speaking_style` 里最关键几条的简短复述。末尾提醒不保证每轮都在最末尾（见第 3 节），所以完整规则必须留在系统提示里。

### 6.8 测试（第一期）

- **加载器**
  - V1、V2、V3 的 JSON；
  - PNG：仅 `chara`、仅 `ccv3`、两者都有；
  - YAML；
  - 损坏的文件、非 UTF-8、超大文件、未知 spec、CHARX → 报错；
  - 旧键名 `definitionPath` → 报错。
- **渲染**
  - 字段顺序；
  - 空段省略；
  - 示例分块；
  - `{{char}}` / `{{user}}` / 别名的大小写不敏感替换；
  - 残留宏降级后，文本中不再有 `{{`；
  - 用渲染结果走一遍 DSH 插值函数，不抛错（回归 DSH 严格插值）。
- **上限**
  - 3000 警告和 8000 报错的边界；
  - 估算函数在中文和英文上的比例。
- **警告**
  - `system_prompt` / PHI / `character_book` 非空时都会警告；
  - 开场白不警告。
- **末尾提醒**
  - 注册 order 95，并且 `interpolate:false`；
  - 文本为空时不注册；
  - contact / guest 不包含提醒。
- **等待提示**：会读到提醒，且截断符合新规则。
- **构建**：manifest 字段齐全；`ensure-build` 能检测到卡文件或规则文件变化。
- **原生门禁**：按现有 `run-native-gates` 流程回归。

## 7. 留给实现方的事项

- 加载器的模块拆分方式和函数命名。
- PNG 块解析的实现：不引入新依赖。
- 检查命令的输出排版。
- 等待提示截断的具体做法（6.5 中的两个选项）。
- 文档更新范围：ARCHITECTURE、PUBLICATION、README 等提到 definition 的地方。

## 8. 审阅中提出的问题及答复

1. **换卡时记忆是否延续**
   - 本轮不处理。
   - 按既定规划，一个角色 Preset 绑定独立的角色和记忆，由那项工作负责。
2. **残留宏降级为单花括号**：用户接受。
3. **生产部署路径是否检查 `characterId`**
   - 查明不检查，记忆作用域由已部署的 `binding.json` 决定。
   - 本设计不新增检查（见第 3 节）。
4. **末尾提醒不保证每轮都在最末尾**
   - 完整的说话规则保留在系统提示里，末尾提醒只作简短复述（见 6.7）。
