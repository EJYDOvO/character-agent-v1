# 角色管理插件设计（DSH 设置页「角色管理」）

日期：2026-11-16。基于分支 `feat/character-card-v3`（角色卡 V3 第一期，PR #25）。

## 1. 目的

QQ bot 的人设随时可能更换。现在导入一张角色卡、编辑规则、切换线上角色，要手动处理约十个文件和步骤（构建配置、数据目录、`binding.json`、会话预置、Profile 身份行、包版本固定、Stage、部署）。2026-11-15 上线 Yuha 时，其中两步出错，一次导致 QQ 离线 8 分钟，一次让新角色接着旧角色的聊天历史。

本设计做一个嵌在 DSH 原生「设置」里的角色管理页，让 Owner 在界面上完成导入、编辑、预览和切换。切换由宿主外的 watchdog 自动重启完成，失败自动退回。

## 2. 边界、目标、非目标、反目标

**边界：角色管理只管角色，Preset 管权限。**

| 归谁 | 内容 | 由谁改 |
|---|---|---|
| 角色 = 人设 + 数据 | 角色卡、规则、末尾提醒、与对话者的关系、等待提示；该角色的记忆、身份指纹、聊天会话 | 角色管理 |
| Preset = 能力 | 每个 Preset 挂哪些插件、能用哪些工具；谁用哪个 Preset（角色模式、`/role`） | 构建配置、角色模式；角色管理不碰 |

两者的唯一接触点是构建时的一次接线：Preset 里的人设插件改为「读取当前角色的人设」（见 5.2）。之后角色管理只改人设内容，不改任何 Preset、工具权限或 `/role` 授权；管理页也不显示这些。

**目标**
- 在 DSH 设置里导入 CCv3 / V2 / V1 角色卡（.json / .png / .yaml），编辑规则、末尾提醒、用户称呼、昵称、等待提示和关系，查看渲染后的提示和 token 明细，导出标准卡。
- 编辑当前在线角色的内容后热生效，不重启。
- 一键切换到另一个角色：自动重启 Host，每个角色的身份、记忆、QQ 会话完全隔离；失败自动退回上一个角色。
- 可以与角色模式（Owner / Contact / Guest）同时开启：Contact / Guest 看到当前角色的公开版人设，由同一个角色自动生成，Owner 预览确认后生效（见 5.5）；`/role` 授权和封禁不随角色切换丢失。
- 换角色不再需要重新构建、打包或部署安装包。安装包只在代码更新时才需要变动。

**非目标（本期不做）**
- 提醒和长期任务跨角色共享。两者共用原生 Schedule 和 Identity 的通知队列，归属证明都在角色目录里；切换后旧角色设的提醒和长期任务不会执行（被安全拦下，见 3.9），只在切换确认框里提示。以后两者一起做。
- 多个角色同时在线；运行中不重启地切换身份和记忆。
- 设定集（第二期）；宁栖 的迁移（旧 `definition.yaml` 格式，数据在 `data/character`，单独任务）。
- 角色记忆的查看和编辑（由 Memory Inspector 负责，本页只给跳转）。
- 永久删除角色及其记忆（本期只做可恢复的「归档」）。
- 给 Contact / Guest 开放任何工具、记忆或提醒；在生产开启角色模式（Owner 单独决定）。

**反目标（即使能用也算失败）**
- 切换后新角色能看到或写入另一个角色的记忆、身份状态或聊天历史。
- 切换失败后 QQ bot 长时间离线，或停在「人设是新的、记忆是旧的」这种混合状态。
- Contact / Guest 看到 Owner 版人设、Owner 关系，或未经 Owner 确认的公开版人设。
- 切换角色后，被封禁的人恢复了访问，或 Contact 授权丢失。
- 浏览器端可以声明身份、选择任意文件路径，或绕过 Owner 认证。
- 角色卡里的宏或文本能破坏 DSH 的严格插值（`{{` 残留）。

## 3. 现状与约束

已核实的事实：

1. **原生 GUI 扩展方式。** Memory Inspector（本仓库）和 Preset Manager（生产已装）都用同一模式：包内 `package.json` 声明 `dsh.client`，`client.js` 用 `window.__ModuleLoader__.load` 注册 `settings.section` 分区，复用宿主 React、`@deepseek-ai/dsh-client-ui-primitives` 组件和主题变量；后端用 `ctx.webServer.register({kind:'prefix'})` 注册 loopback 路由，`ctx.connection.admit(req)` 认证，只接受 Owner；前端走 `ctx.connection.rpc.call`。网页端和桌面端共用。
2. **Preset 组成在会话创建时固定。** 会话创建时挂载一个 Preset，插件和可见工具此后不变；权限级别只能做成不同的 Preset，级别变化进入新会话。权限检查分散在原生钩子上，按原计划（决策 #14）不合成统一服务：
   - QQTK `dsh-identity-access`（角色模式）判定谁、哪一级，`/role`、封禁、命令闸门、输出复核；
   - 各 Preset 自带工具范围插件（`tool-scope.mjs`、`worker-scope.mjs`、`long-task-role`），用原生 `tools.restrict` + `tools.guard`；
   - Character Identity 保证记忆、提醒、通知只属于 Owner 的当前会话；
   - 本机界面走原生 `connection.admit`。
3. **提示词每次调用模型前重新组装**（读自生产 Host 0.2.2-rc.1 的 `dsh-system-prompt` 与 `dsh-agent-loop`）：
   - 系统提示按排序值拼接，严格插值：DSH 身份（-1000）、**人设开头**（0，`deployment:persona-prefix`）、Character 执行规则（100）、Worker 规则（105）、原生策略与工具说明（500–5000）、交付与界面（9000–10100）、**人设结尾**（10200，`deployment:persona-suffix`）。
   - 消息：AGENTS.md（`dsh-agent-instructions` 以消息注入，全部角色共用）、历史、新消息，之后接一份运行时快照：长期记忆召回（80）、回复策略（85）、**末尾提醒**（95，原样输出）、原生上下文（100 起）。
   - 随角色变化的只有加粗的三处；记忆召回读当前角色目录的记忆库。
   - 原生 `@deepseek-ai/dsh-persona` 行在 Preset 作用域内注册这两个人设分区；Preset Manager 的 `live-persona.js` 已在生产用 `text` 函数每次读取最新文本。
4. **身份、记忆、会话的状态都在插件配置的文件路径里，只在启动时打开。**
   - Identity：`bindingFile`、`stateFile`（`coordination.sqlite`），其中存了作用域指纹，原地改 characterId 会拒绝启动。
   - Memory：`database`（`memory.sqlite`），记录按 principal / character / project 分区。
   - Conversation Manager（QQTK）：`stateFile`（`conversations.json`）。没有记录时从 QQ 会话键推导 Session ID；会话键不含角色。
   - Interaction：`hangOnModelFile`。
   - 角色模式：`identity-access.json`、`identity-owner.json` 目前由 `scripts/role-settings.cjs` 放在角色数据目录。
5. **Profile 覆盖行整体替换。** 宿主对 Profile 补丁行的每个顶层键直接赋值。生产 Profile 的 `character-identity` 行带有 `presetId`、`bindingFile`、`stateFile`、`memoryMode` 四项；与角色相关的覆盖行只有这一行（`long-tasks` 行只设 Preset、工具和工作目录）。
6. **插件运行在 Host 进程内，不能自己完成重启。** 生产 watchdog（`maintenance/watchdog.ps1`）是独立的 PowerShell 进程：每 30 秒检查一次，持有 `maintenance.lock` 期间不动作，Host 缺席满 90 秒才拉起，有每小时启动次数预算。它拉起的 Host 不属于 Claude 的进程树。
7. **Windows 目录联接可用。** 已在本机验证：SQLite（WAL 模式）可通过联接读写；删除联接不影响目标目录；联接可以重新指向。
8. **QQ 就绪判定。** 维护工具以 `data/maintenance/qq-health.json` 中 `connected:true, detail:'ready'`、`pid` 属于新 Host、时间晚于启动为准。全新启动会走 IDENTIFY，触发 `ready`。
9. **切换后旧提醒、旧长期任务被安全拦下。** 旧角色会话设的提醒到期时，Identity 在进入会话前要求持久投递授权（`character-identity/boundary.mjs:39`），新角色库里没有，拒绝且不跑模型；长期任务执行前 `validateConversation` 比较 `characterId`，拒绝执行。
10. **现有两张卡的设定可以共用。** Yuha、Tasha 的描述、性格、场景、示例、`rules.md`、`reminder.md` 都不含与 Owner 的关系；`{{user}}` 只在 Yuha 描述里出现一次（「不替用户说话」）。公开版与 Owner 版的差别主要是与对话者的关系。
11. 维护工具（`maintenance/`）属于 QQTK，修改它要先说明（本设计在第 6 节说明）。

## 4. 方案比较

**甲：界面驱动现有构建部署流程。** 界面收集配置，调用 build / pack / Stage / DeployValidated。每次换角色都要重新打包、更新版本固定、重启。流程长，部署工具本身也停在 Host 外面，界面只能发请求、拿不到中间状态。上次出错的步骤（Profile 身份行、会话预置）仍要每次执行。

**乙：运行时读取当前角色，重启切换（采用）。** 安装包只构建一次，人设、提醒、数据目录都改成在运行时从「当前角色」读取。身份、记忆、会话三个插件不改代码，统一使用固定路径 `data/character-current/…`，这条路径是一个目录联接，指向当前角色的目录。切换时由 watchdog 在 Host 停止期间改联接指向，然后启动 Host。人设和提醒每次组装提示时读取，所以编辑当前角色可以热生效。

**丙：完全热切换。** 不重启就换身份和记忆，需要三个核心插件都支持运行中换目录并互相协调。改动大、竞态多，隔离难以保证。已与 Owner 讨论并放弃。

Owner 选择乙：换角色时重启，编辑同一角色热生效；应用新角色时宿主自动重启。

## 5. 设计

### 5.1 目录结构

```
data/characters/
  registry.json              角色清单：[{id, dir, addedAt, archived}]
  <id>/                      一个角色（新导入的都在这里）
    card.json|card.png|card.yaml   原始卡文件，导入后不修改
    rules.md  reminder.md    部署规则与末尾提醒（Owner 版和公开版共用）
    character.json           设置（见 5.5）
    compiled.json            渲染结果（见 5.5）
    binding.json  coordination.sqlite  memory.sqlite  conversations.json  hangon-model.json   运行状态（与现在相同）
  .archive/<id>-<时间>/      归档的角色
data/character-current        目录联接 → 当前角色目录
data/account/                 与角色无关、按 QQ 账号保存，不经联接
  identity-access.json  identity-owner.json   角色模式的授权、封禁与 Owner 记录
data/maintenance/character-switch.json         切换请求（插件写，watchdog 读后删除）
data/maintenance/character-switch-result.json  切换结果（watchdog 写）
```

- `id` 规则沿用 `^[a-z0-9-]{1,48}$`。
- `registry.json` 允许条目的 `dir` 指向 `data/characters` 之外，用来收编现有的 `data/character-yuha`，不必搬动文件（我的决定：避免在 Host 运行时移动正在使用的 SQLite 文件）。
- 当前角色以联接的实际指向为准，不另存一份「当前角色 ID」（我的决定）。
- `data/account/` 本期只放角色模式的两个文件：它们决定「谁能说话」，属于人与 bot 的关系，不属于某个角色。生产从未开启角色模式，没有需要迁移的旧文件；其他安装若旧位置已有这两个文件，停机后移动到新位置（写进 `MANAGEMENT.md`）。

### 5.2 运行时组件（Character 核心包）

1. **构建改动（`scripts/build.cjs`、`scripts/role-settings.cjs`、`packages/character-definition/role-presets.mjs`）**
   - 新增构建选项 `characterManager: {enabled: true}`；关闭时完全保持现在的构建结果（构建时写死人设），以便回退。
   - Identity、Memory、Conversation、Interaction 的路径全部固定为 `<install>/data/character-current/…`；角色模式的两个文件固定为 `<install>/data/account/…`（只是 `dsh-identity-access` 的配置路径，不改它的代码）。
   - Owner Preset 的 `persona` 行（保留 id `persona`，角色模式的「Owner Persona missing」检查继续成立）换成运行时人设插件 `{audience: 'owner'}`。
   - 开启角色模式时，Contact / Guest 两个 Preset 的 `persona` 行换成运行时人设插件 `{audience: 'public'}`；它们仍从空组合装配，只含这一行和 `tool-scope`。`roles.publicPersonaFile` 只在 `characterManager` 关闭时使用。
   - 构建配置里不写任何角色的人设，只写中性回退文本（例如「角色资料暂时不可用，请简短告知对方稍后再试，不要扮演任何角色」）。原因：回退文本若是某个角色的人设，`compiled.json` 损坏时就会出现「A 的人设配 B 的记忆」（我的决定）。
   - 开启 `characterManager` 时，Owner Preset 不再挂 `dsh-character-memory-tools` 的末尾提醒行，末尾提醒改由运行时人设插件提供（避免两处注册同名上下文；我的决定）。
2. **运行时人设插件**
   - 放在新包 `dsh-character-manager` 的独立入口 `runtime-persona.mjs`，不放进 `dsh-character-memory-tools`：Contact / Guest 的 Preset 也要挂载它，而原计划要求最小 Preset 不依赖 Memory 包（tool-scope 当初就是为此移出 Memory 包的）。该入口不依赖管理页的服务端代码。
   - 注册 `deployment:persona-prefix`、`deployment:persona-suffix` 两个分区（排序值取原生 `getSectionOrder`）和末尾提醒上下文（名称 `character:reminder`，排序 95，`interpolate:false`）。`text` 每次读取 `data/character-current/compiled.json` 中对应 `audience` 的部分（按文件修改时间缓存）。
   - `audience:'public'` 只读公开部分；没有已确认的公开版时用中性回退文本，绝不读 Owner 部分。
   - 读到的文本再检查一次：不得含 `{{` 或 `}}`，长度不超过上限，`compiled.json` 的 `characterId` 必须等于当前 `binding.json` 的 `characterId`。不满足时，本进程内用同一角色上一份有效文本；启动时就无效则用中性回退文本，并在管理页和健康文件里标出「人设不可用」。
   - 启动完成后写 `data/character-current/runtime-health.json`：`{pid, characterId（来自已加载的 binding）, personaSource: 'compiled'|'neutral', compiledRevision, at}`，供 watchdog 判断切换是否成功（见 5.4）。
3. **Interaction**：`styleReminder` 和 `hangOnText` 改为在起草等待提示时读取 `compiled.json`；读不到当前角色的有效值时用中性默认（不带任何角色口吻），不用构建时的值。
4. **Profile 身份行**：一次性改为 `data/character-current/binding.json` 和 `data/character-current/coordination.sqlite`，保留四个键。

### 5.3 管理插件 `dsh-character-manager`（新包）

**服务端**
- `index.mjs`：`inject: ['webServer', 'connection']`，loopback 校验同 Memory Inspector。
- `registry.mjs`：读写 `registry.json`、角色目录。只接受合法 `id`，所有路径由 `id` 推导，不接受浏览器传入的路径。
- `compile.mjs`：复用 `packages/character-definition` 的 `loadCard` 流程（读取、规范化、渲染、限制、警告），渲染 Owner 版和公开版（见 5.5），产出 `compiled.json`。写入采用「写临时文件再重命名」的原子方式。
- `switch.mjs`：校验目标、准备数据目录、写切换请求、读取结果。
- `http.mjs`：两个入口。
  - `POST /character-manager/api`：JSON RPC，16 KiB 上限，沿用 Inspector 的认证与安全头。
  - `POST /character-manager/upload?…`：上传卡文件，上限 20 MB，流式写入临时文件，同样只接受 Owner。

**接口（RPC 方法）**

| 方法 | 作用 |
|---|---|
| `list` | 列出角色：名称、规格、token、警告数、是否当前、公开版是否待确认、是否有待处理的切换、最近一次切换结果 |
| `get(id)` | 详情：设置、规则、提醒、关系、`compiled.json`、各字段 token |
| `import(uploadId, id, options)` | 用已上传的文件新建角色：复制卡，从模板生成规则和提醒，写设置，编译；`id` 已存在则拒绝 |
| `preview(id, draft)` | 用草稿编译但不保存，返回 Owner 版和公开版的渲染结果、token 和警告 |
| `save(id, draft, revision)` | 保存并重新编译；`revision` 不匹配则拒绝（防止两个页面互相覆盖）。当前角色保存后热生效 |
| `approvePublic(id, publicHash)` | 确认当前公开版；`publicHash` 必须等于最新渲染结果，防止确认了没看到的版本 |
| `exportCard(id)` | 导出标准 CCv3 JSON |
| `switch(id)` | 发起切换（见 5.4） |
| `switchStatus()` | 查询切换请求和结果 |
| `archive(id)` | 归档非当前角色（移入 `.archive/`，可恢复） |

**前端 `client.js`（设置 → 角色管理）**

```
角色管理
┌───────────────────────────────────────────────┐
│ [导入角色卡]                                   │
│ ● Yuha（当前）   2038 token  ⚠2               │
│ ○ Tasha          2147 token  ⚠1   [切换到此角色]│
└───────────────────────────────────────────────┘
Yuha
 [资料] [规则] [末尾提醒] [关系] [设置] [预览]
  规则 ─ 文本框 ─ 保存（当前角色：立即生效）
  关系 ─ 对 Owner 的关系 / 对其他人的关系 / 公开版排除的字段
  预览 ─ [Owner 版] [公开版*]  系统提示开头 / 末尾 / 提醒全文，token 明细，警告列表
         * 公开版：标出含 {{user}} 的设定字段；[确认公开版]
```

- 复用 `Button`、`Input`、`SegmentedTabs`、`Tag`；样式只用宿主主题变量。
- 「关系」页和公开版预览始终可用（角色模式没开时也能提前写好），不显示任何权限设置。
- 切换前弹窗确认：QQ 会断开约 30 秒，桌面窗口也会关闭后重新打开；旧角色设的提醒和长期任务切换后不会执行。
- 桌面窗口：Host 重启后窗口重新打开，进入页面时显示最近一次切换结果。网页端：每次启动的访问 token 会变，旧页面无法自动重连；页面提示「Host 正在重启，请稍后从桌面应用或新链接重新打开」，下次打开时显示结果（我的决定）。

### 5.4 切换流程

插件侧（`switch(id)`，Host 运行中）：
1. 前置条件：`watchdog.enabled` 为真，且 `watchdog-state.json` 两分钟内有更新（watchdog 在运行）；否则拒绝并提示 Owner 先启用 watchdog，不写请求文件。
2. 目标必须已注册、未归档、不是当前角色，且当前没有未完成的切换请求；每小时最多 4 次切换请求。
3. 目标的 `compiled.json` 必须有效（不超限、无残留宏）。公开版未确认不阻止切换：Contact / Guest 届时用中性回退文本，管理页给出提示。
4. 准备目标的运行状态（只写目标目录里还不存在的文件，不动当前角色）：
   - `binding.json`：appId、ownerId 取自当前角色，`characterId` 为目标 id，`projectId` 沿用。
   - `conversations.json`：如果不存在，按当前 QQ 会话键写入一个新的随机 Session ID，`lifecycle` 留空。这样新角色不会推导出旧会话（见 3.4）。
5. 写 `character-switch.json`：`{target, previous, requestedAt, nonce}`，然后返回「已请求」。

watchdog 侧（独立进程，全程持有维护锁，原有「缺席 90 秒后拉起」逻辑不会同时触发）：
1. 发现请求后取得 `maintenance.lock`，用 `ops.cjs status` 等待空闲（没有运行中的 Agent；能读到时也等待通知队列清空），沿用维护工具的等待上限，超时则放弃本次请求并记录原因。
2. 停止 Host（与 `manage.ps1` 的 `Stop-TaskHost` 相同的识别和确认方式）。
3. 确认联接当前指向 `previous`，然后改为指向 `target`。删除联接只用不带递归的删除方式，绝不对联接路径做递归删除。
4. 启动 Host，等待成功条件，上限 100 秒。成功需要同时满足：QQ 就绪（3.8），以及 `runtime-health.json` 的 `pid` 属于新 Host、`characterId` 等于目标、`personaSource` 为 `compiled`（我的决定：只看 QQ 就绪，会把「QQ 连上了但角色没加载对」误判为成功）。
5. 成功：写结果 `{ok:true, target, at}`，删除请求。
6. 失败：联接指回 `previous`，再启动一次 Host 并等待就绪，写结果 `{ok:false, target, restored, reason}`，删除请求。
   - 若退回后的启动也失败：写结果 `{ok:false, restored:false}`，释放维护锁，交给 watchdog 原有的「缺席 90 秒后拉起」逻辑继续尝试 `previous`。

启动预算（我的决定）：生产 `features.json` 的 `watchdog.maxStartsPerHour` 是 3，用来防止崩溃循环。切换引起的启动不计入这个预算，否则一次切换加一次切回就可能耗尽预算，之后真的崩溃时没人拉起；切换由上面的每小时 4 次上限约束。

### 5.5 Owner 版与公开版人设（Owner 已确认）

同一个角色渲染两次，设定共用，只有「与对话者的关系」不同：

| | Owner 版 | 公开版 |
|---|---|---|
| 规则（`rules.md`） | 有 | 有 |
| 角色设定（描述、性格、场景、示例） | 全部 | 全部，减去 `publicExclude` 列出的字段 |
| 关系段 | `relationship.owner`（可选，默认空） | `relationship.public`（有默认值） |
| `{{user}}` 替换为 | `userName` | 「对方」 |
| 末尾提醒（`reminder.md`） | 有 | 有 |
| 生效条件 | 保存即生效 | Owner 在管理页确认后才生效 |

- `character.json`：`{name?, nickname?, userName, hangOnText, relationship: {owner?, public?}, publicExclude: [], publicApproved: {hash, at}?, revision}`。`publicExclude` 只能取 `scenario`、`examples`、`description`、`personality`。
- `relationship.public` 默认值大意：「正在和你聊天的是被允许来聊天的人，不是你的主人，你们并不熟。不要提起主人的私事，也不要假装记得之前的对话。」可按角色修改口吻。关系段放在规则之后、角色设定之前；两段都按规则文件同样的限制检查（不含 `{{`、`}}`，有长度上限）。
- `compiled.json`：`{revision, characterId, name, hangOnText, reminder, owner: {prefix, suffix}, public: {prefix, suffix, hash}?, pendingPublic: {prefix, suffix, hash}?, tokens, warnings, cardRevision, rulesRevision}`。
  - 每次编译生成新的公开版。若其 `hash` 等于 `publicApproved.hash`，写入 `public`；否则写入 `pendingPublic`，`public` 保留上一份已确认的内容（没有就省略）。
  - 运行时公开插件只读 `public`，所以 Contact / Guest 永远只看到 Owner 确认过的文本；编辑规则或卡之后，公开版待重新确认期间仍用旧的已确认版本。
  - `approvePublic` 把 `pendingPublic` 提升为 `public` 并记录 `publicApproved`。
- 预览时标出含 `{{user}}` 的设定字段：有些卡把关系写进了描述或场景（例如「{{user}} 是你的青梅竹马」），原样给陌生人不对，Owner 可以把该字段加入 `publicExclude`。
- 与原计划的差别：原计划要求公开人设是「单独审阅过的文件」。本设计改为「由角色自动生成，Owner 在管理页预览确认后才生效」，审阅仍由 Owner 完成（Owner 已同意）。

### 5.6 首次接入（一次性）

1. 用 `characterManager.enabled` 构建并部署新的核心包、Interaction、管理插件（按现有 `Stage` / `DeployValidated` 流程）。
2. 同一次部署前（Host 运行中，只新建文件）：
   - 建 `data/characters/registry.json`，收编 `yuha → data/character-yuha`；
   - 为 Yuha 生成 `character.json` 和 `compiled.json`；
   - 建联接 `data/character-current → data/character-yuha`；
   - 把 Profile 身份行改到 `data/character-current/…`，另存原件。
3. 部署后 Yuha 照常在线，身份、记忆、会话不变（路径经联接指向同一目录），现有提醒和通知继续投递（仍在同一个 `coordination.sqlite`）。
4. Tasha 通过界面导入。宁栖 不在本期范围内。

本期不迁移任何持久数据：Identity、Memory、Conversation 的数据文件原地不动，只是经联接打开。回退方法：部署 `characterManager.enabled:false` 的旧版构建，并把 Profile 身份行恢复为原件。联接和 `data/characters` 可以保留，不会被使用。如果回退时当前角色不是 Yuha，Profile 身份行要指向当时的当前角色目录。

### 5.7 安全与隔离

- 所有接口只接受原生认证的 Owner，只在 loopback 上提供，安全头与 Memory Inspector 相同。
- 浏览器不能指定文件路径，只能指定角色 `id`；上传文件先写入临时目录，解析失败即删除。
- 卡内容视为不可信文本：沿用 V3 第一期的宏降级、残留 `{{` 检查和 8000 token 上限，Owner 版和公开版分别检查。运行时人设插件读取 `compiled.json` 时再检查一次。
- 每个角色的身份、记忆、会话状态都在自己的目录里，同一时刻只有当前角色的目录通过联接被打开。
- Contact / Guest 的 Preset 只挂公开读取的人设插件，它没有读取 Owner 部分的代码路径；它们的工具范围与现在相同（空）。
- 切换请求只由插件写入，watchdog 只认 `data/characters` 里已注册、合法的 id，不执行请求里的任何路径。
- watchdog 对 `registry.json` 的信任范围（我的决定）：角色目录只能是 `data/characters/<id>` 或旧位置 `data/character-<id>`。解析后的真实路径必须在 `data/` 之下、不是联接本身、且目录里有 `binding.json`，`binding.json` 的 `characterId` 等于该 id。其他 `dir` 一律拒绝。

### 5.8 与现有功能的关系

- **Memory Inspector**：通过 Identity 读取当前角色的记忆，切换后自然显示新角色的记忆。角色管理页提供跳转。
- **Preset Manager**：它把 Character Bundle 视为只读，只写 Profile 覆盖。不能用它改 `persona` 行，否则会盖掉运行时人设插件。管理页检测到 Profile 里有 `persona` 覆盖时给出警告。
- **角色模式**：Preset 组成、工具范围、`/role` 逻辑都不变（见第 2 节边界）。Owner Preset id 迁移（`qq-character` → `character`、`legacyPresetIds`、`memoryAgentId` 保持旧 id）沿用现有机制，每个角色目录第一次在角色模式下打开时由 Identity 迁移自己的指纹。需在实现时确认 `ops.cjs` 要求 QQ Preset 名为 `qq-character` 在角色模式下仍满足。Contact / Guest 的会话在 `conversations.json` 里，随角色目录切换，换角色后他们进入新角色自己的新会话，与原计划「角色变化后进入新 Session」一致。
- **长期任务**：不改。任务 Preset 固定用中性「后台任务执行者」人设，不挂运行时人设插件。
- **构建时角色卡**（第一期）：`characterManager` 关闭时完全不变；开启时，构建配置里的卡不再写入 Preset。

## 6. 需要修改的范围

- 本仓库：
  - `scripts/build.cjs`、`scripts/role-settings.cjs`、`packages/character-definition/role-presets.mjs`（运行时人设接线、`data/account/` 路径）；
  - `packages/character-definition`（渲染 Owner 版和公开版：关系段、`{{user}}` 替换、字段排除）；
  - `packages/interaction-policy`（运行时读取提醒和等待提示）；
  - 新包 `packages/character-manager`（含 `runtime-persona.mjs`）；
  - 相关测试、原生门禁和文档。
- QQTK 维护工具：`maintenance/watchdog.ps1` 增加切换请求处理；`ops.cjs` 的状态检查只读复用。**这是对 QQTK 的修改，需在 QQTK 仓库单独提交，并同步到生产 `maintenance/`。**
- 生产一次性接入：见 5.6。
- 不改：DSH 核心、Conversation Manager、Memory、Character Identity、Long Tasks、QQTK `dsh-identity-access` 的代码。

## 7. 验证

- 单元测试：注册表与 `id` 校验、编译与原子写入、修订冲突、上传限制、切换前的准备（只新建文件，不动当前角色）、会话预置、运行时人设的回退与缓存；Owner 版与公开版渲染（关系段位置、`{{user}}` 替换、字段排除、含 `{{user}}` 字段的标记）；公开版确认（hash 不符拒绝、编辑后旧确认版继续生效、未确认时用中性文本、公开插件读不到 Owner 部分）。
- 前端测试：沿用 Inspector 的客户端测试方式（注册、停用、销毁、请求中止）。
- watchdog：在测试 Home 里用假 Host 进程验证请求处理、联接切换、失败退回、维护锁和启动预算；删除联接时目标目录完好。
- 原生门禁（隔离 Home、合成数据）：
  - 运行时人设热生效：修改 `compiled.json` 后，下一次模型请求的人设开头、结尾和末尾提醒随之变化，且通过 Host 自己的插值。
  - 两个角色目录之间切换后，记忆、身份、会话互不可见。
  - 切换后旧角色设的提醒到期被拦下且不触发模型对话；旧长期任务被拒绝执行。
  - 角色模式联合验证（扩展现有 `scripts/run-roles.ps1`）：切换后 Contact / Guest 的人设随之变化且不含 Owner 版内容；未确认公开版时用中性文本；切换前封禁的账号切换后仍被拒绝、Contact 授权仍在；Contact / Guest 仍看不到、执行不了任何工具。
- 生产：接入部署后核对 Yuha 的身份、记忆、会话与接入前一致；在界面上导入 Tasha、切换、再切回，每次核对隔离和 QQ 就绪。真实 QQ 收发和真实模型效果只在实际做过之后才声称通过。

## 8. 留给实现者决定

- 运行时人设的缓存方式（按修改时间或修订号），只要每次组装提示都能拿到最新的有效文本。
- 上传接口的具体分块方式和临时文件位置（必须在 `data/characters` 下的临时目录）。
- 前端的具体布局和文案，在宿主组件范围内；`relationship.public` 默认值的具体措辞。
- watchdog 中切换逻辑的代码组织，可以拆成单独的 `character-switch.ps1` 由 watchdog 调用。
- 插件侧能否读到待发通知数；读不到时只依赖 `ops.cjs status` 的空闲判断。
