# 角色管理插件设计（DSH 设置页「角色管理」）

日期：2026-11-16。基于分支 `feat/character-card-v3`（角色卡 V3 第一期，PR #25）。

## 1. 目的

QQ bot 的人设随时可能更换。现在导入一张角色卡、编辑规则、切换线上角色，要手动处理约十个文件和步骤（构建配置、数据目录、`binding.json`、会话预置、Profile 身份行、包版本固定、Stage、部署）。2026-11-15 上线 Yuha 时，其中两步出错，一次导致 QQ 离线 8 分钟，一次让新角色接着旧角色的聊天历史。

本设计做一个嵌在 DSH 原生「设置」里的角色管理页，让 Owner 在界面上完成导入、编辑、预览和切换。切换由宿主外的 watchdog 自动重启完成，失败自动退回。

## 2. 目标、非目标、反目标

**目标**
- 在 DSH 设置里导入 CCv3 / V2 / V1 角色卡（.json / .png / .yaml），编辑规则、末尾提醒、用户称呼、昵称和等待提示，查看渲染后的提示和 token 明细。
- 编辑当前在线角色的人设类内容后热生效，不重启。
- 一键切换到另一个角色：自动重启 Host，每个角色的身份、记忆、QQ 会话完全隔离；失败自动退回上一个角色。
- 定时提醒、长期任务和通知属于用户：按用户隔离，在角色之间共享，切换角色后照常送达（见 5.5）。
- 角色模式（Owner / Contact / Guest）可以与角色管理同时开启（Owner 已确认放在本期）：每个角色可带一份自己的公开人设，切换时 Contact / Guest 看到的人设一起切换；`/role` 授权和封禁按 QQ 账号保存，不随角色切换丢失（见 5.9）。
- 换角色不再需要重新构建、打包或部署安装包。安装包只在代码更新时才需要变动。

**非目标（本期不做）**
- 多个角色同时在线（维护工具规定 QQ 路由只能用 `qq-character` 这一个 Preset）。
- 运行中不重启地切换身份和记忆。
- 设定集（第二期）。
- 宁栖 的迁移。她仍是旧 `definition.yaml` 格式，数据在 `data/character`。迁移是单独的任务。
- 角色记忆的查看和编辑。由现有的 Memory Inspector 负责，本页只给出跳转。
- 永久删除角色及其记忆。本期只做「归档」（移走目录，可恢复）。
- 给 Contact / Guest 开放提醒、长期任务或记忆。原计划没有这些能力，本期不改变；存储结构按用户划分，不妨碍以后扩展。

**反目标（即使能用也算失败）**
- 切换后新角色能看到或写入另一个角色的记忆、身份状态或聊天历史。
- 切换角色后，被封禁的人恢复了访问，或 Contact 的授权丢失、被别人继承。
- Contact / Guest 看到 Owner 的私有人设，或看到不属于当前角色的公开人设。
- 迁移或回滚丢掉切换后新增的提醒授权、通知或长期任务记录（原计划 D6 / ADR-055）。
- 切换失败后 QQ bot 长时间离线，或停在「人设是新的、记忆是旧的」这种混合状态。
- 浏览器端可以声明身份、选择任意文件路径，或绕过 Owner 认证。
- 角色卡里的宏或文本能破坏 DSH 的严格插值（`{{` 残留）。

## 3. 现状与约束

已核实的事实：

1. **原生 GUI 扩展方式。** Memory Inspector（本仓库）和 Preset Manager（生产已装）都用同一模式：包内 `package.json` 声明 `dsh.client`，`client.js` 用 `window.__ModuleLoader__.load` 注册 `settings.section` 分区，复用宿主 React、`@deepseek-ai/dsh-client-ui-primitives` 组件和主题变量；后端用 `ctx.webServer.register({kind:'prefix'})` 注册 loopback 路由，`ctx.connection.admit(req)` 认证，只接受 Owner；前端走 `ctx.connection.rpc.call`。网页端和桌面端共用。
2. **人设可以热更新。** DSH 每次调用模型前都重新组装系统提示。Preset Manager 的 `live-persona.js` 用 `ctx.systemPrompt.section({name:'deployment:persona-prefix'|'deployment:persona-suffix', text: () => …})` 每次读取最新文本。Interaction 的等待提示按这两个分区名读取人设。
3. **身份、记忆、会话的状态都在插件配置的文件路径里，只在启动时打开。**
   - Identity：`bindingFile`、`stateFile`（`coordination.sqlite`）。它在 `coordination.sqlite` 里存了作用域指纹，原地改 characterId 会拒绝启动。
   - Memory：`database`（`memory.sqlite`），记录按 principal / character / project 分区。
   - Conversation Manager（QQTK）：`stateFile`（`conversations.json`）。状态里没有记录时，它会从 QQ 会话键推导 Session ID；会话键不含角色。
   - Interaction：`hangOnModelFile`。
4. **Profile 覆盖行整体替换。** 宿主对 Profile 补丁行的每个顶层键直接赋值。生产 Profile 的 `character-identity` 行带有 `presetId`、`bindingFile`、`stateFile`、`memoryMode` 四项。
5. **插件运行在 Host 进程内，不能自己完成重启。** 生产 watchdog（`maintenance/watchdog.ps1`）是独立的 PowerShell 进程：每 30 秒检查一次，持有 `maintenance.lock` 期间不动作，Host 缺席满 90 秒才拉起，有每小时启动次数预算。它拉起的 Host 不属于 Claude 的进程树。
6. **Windows 目录联接可用。** 已在本机验证：SQLite（WAL 模式）可通过联接读写；删除联接不影响目标目录；联接可以重新指向。
7. **QQ 就绪判定。** 维护工具以 `data/maintenance/qq-health.json` 中 `connected:true, detail:'ready'`、`pid` 属于新 Host、时间晚于启动为准。全新启动会走 IDENTIFY，触发 `ready`。
8. 维护工具（`maintenance/`）属于 QQTK，修改它要先说明（本设计在第 6 节说明）。

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
    rules.md  reminder.md    部署规则与末尾提醒
    public.md                可选：给 Contact / Guest 的公开人设（Owner 单独审阅的纯文本，不从卡生成）
    character.json           设置：{name?, nickname?, userName, hangOnText, revision}
    compiled.json            渲染结果：{revision, characterId, name, prefix, suffix, reminder, hangOnText, publicPrefix?, tokens, warnings, cardRevision, rulesRevision, publicRevision?}
    binding.json  coordination.sqlite  memory.sqlite  conversations.json  hangon-model.json   运行状态（与现在相同）
  .archive/<id>-<时间>/      归档的角色
data/character-current        目录联接 → 当前角色目录
data/users/                   按 QQ 账号保存、在角色之间共享，不经联接
  identity-access.json  identity-owner.json   角色模式的授权、封禁与 Owner 记录（见 5.9）
  <principalId>/delivery.sqlite               该用户的通知队列与提醒投递授权（见 5.5）
data/maintenance/character-switch.json         切换请求（插件写，watchdog 读后删除）
data/maintenance/character-switch-result.json  切换结果（watchdog 写）
```

- `id` 规则沿用 `^[a-z0-9-]{1,48}$`。
- `registry.json` 允许条目的 `dir` 指向 `data/characters` 之外，用来收编现有的 `data/character-yuha`，不必搬动文件（我的决定：避免在 Host 运行时移动正在使用的 SQLite 文件）。
- 当前角色以联接的实际指向为准，不另存一份「当前角色 ID」，避免两处记录不一致（我的决定）。

### 5.2 运行时组件（Character 核心包）

1. **构建改动（`scripts/build.cjs`）**
   - Identity、Memory、Conversation、Interaction 的路径全部固定为 `<install>/data/character-current/…`。
   - Character Preset 的 `persona` 行（保留 id `persona`）换成新的运行时人设插件。该行不再写入任何角色的人设，只写一段中性的回退文本（例如「角色资料暂时不可用，请简短告知用户稍后再试，不要扮演任何角色」）。原因：回退文本若是某个角色的人设，当前角色的 `compiled.json` 损坏时就会出现「A 的人设配 B 的记忆」（我的决定）。
   - 开启角色模式时，Contact / Guest 两个 Preset 的 `persona` 行同样换成运行时人设插件（`role: 'public'`），读 `publicPrefix`；仍从空组合装配，只含这一行和 `tool-scope`（见 5.9）。
   - 新增构建选项 `characterManager: {enabled: true}`；关闭时完全保持现在的构建结果（构建时写死人设），以便回退。
2. **运行时人设插件**
   - 放在新包 `dsh-character-manager` 的独立入口 `runtime-persona.mjs`，不放进 `dsh-character-memory-tools`。原因：Contact / Guest 的 Preset 也要挂载它，而原计划要求最小 Preset 不依赖 Memory 包（tool-scope 当初就是为此移出 Memory 包的）。该入口不依赖管理页的服务端代码。
   - 配置 `role: 'owner' | 'public'`。`owner` 读 `prefix` / `suffix`；`public` 只读 `publicPrefix`，没有时用中性回退文本，绝不回退到 Owner 的私有人设。
   - 注册 `deployment:persona-prefix` 和 `deployment:persona-suffix` 两个分区，`text` 每次读取 `data/character-current/compiled.json`（按文件修改时间缓存）。
   - 末尾提醒的 `context()` 也改为每次读取。
   - 读到的文本仍要再检查一次：不得含 `{{` 或 `}}`，长度不超过上限，`compiled.json` 里的角色 id 必须等于当前 `binding.json` 的 `characterId`。不满足时，本进程内用同一角色上一份有效文本；启动时就无效则用中性回退文本，并在管理页和健康文件里标出「人设不可用」。
   - Interaction 的 `styleReminder` / `hangOnText` 同理：读不到当前角色的有效值时用中性默认（不带任何角色口吻），不用构建时的值。
   - 启动完成后，插件写 `data/character-current/runtime-health.json`：`{pid, characterId（来自已加载的 binding）, personaSource: 'compiled'|'neutral', compiledRevision, at}`，供 watchdog 判断切换是否成功（见 5.4）。
3. **Interaction**：`styleReminder` 和 `hangOnText` 改为在起草等待提示时读取 `compiled.json`，配置值作为回退。
4. **Profile 身份行**：一次性改为 `data/character-current/binding.json` 和 `data/character-current/coordination.sqlite`，保留四个键。

### 5.3 管理插件 `dsh-character-manager`（新包）

**服务端**
- `index.mjs`：`inject: ['webServer', 'connection']`，loopback 校验同 Memory Inspector。
- `registry.mjs`：读写 `registry.json`、角色目录。只接受合法 `id`，所有路径由 `id` 推导，不接受浏览器传入的路径。
- `compile.mjs`：复用 `packages/character-definition` 的 `loadCard` 流程（读取、规范化、渲染、限制、警告），产出 `compiled.json`。写入采用「写临时文件再重命名」的原子方式。
- `switch.mjs`：校验目标、准备数据目录、写切换请求、读取结果。
- `http.mjs`：两个入口。
  - `POST /character-manager/api`：JSON RPC，16 KiB 上限，沿用 Inspector 的认证与安全头。
  - `POST /character-manager/upload?…`：上传卡文件，上限 20 MB，流式写入临时文件，同样只接受 Owner。

**接口（RPC 方法）**

| 方法 | 作用 |
|---|---|
| `list` | 列出角色：名称、规格、token、警告数、是否当前、是否有待处理的切换、最近一次切换结果 |
| `get(id)` | 详情：设置、规则、提醒、公开人设、`compiled.json`、各字段 token |
| `import(uploadId, id, options)` | 用已上传的文件新建角色：复制卡，从模板生成规则和提醒，写设置，编译；`id` 已存在则拒绝 |
| `preview(id, draft)` | 用草稿（规则、提醒、公开人设、设置）编译但不保存，返回渲染结果、token 和警告 |
| `save(id, draft, revision)` | 保存并重新编译；`revision` 不匹配则拒绝（防止两个页面互相覆盖）。当前角色保存后热生效 |
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
 [资料] [规则] [末尾提醒] [公开人设*] [设置] [预览]      * 仅角色模式开启时显示
  规则 ─ 文本框 ─ 保存（当前角色：立即生效）
  预览 ─ 系统提示开头 / 末尾 / 提醒全文，token 明细，警告列表
```

- 复用 `Button`、`Input`、`SegmentedTabs`、`Tag`；样式只用宿主主题变量。
- 切换前弹窗确认：说明 QQ 会断开约 30 秒，桌面窗口也会关闭后重新打开。
- 桌面窗口：Host 重启后窗口重新打开，进入页面时显示最近一次切换结果。网页端：每次启动的访问 token 会变，旧页面无法自动重连；页面提示「Host 正在重启，请稍后从桌面应用或新链接重新打开」，下次打开时显示结果（我的决定）。

### 5.4 切换流程

插件侧（`switch(id)`，Host 运行中）：
1. 目标必须已注册、未归档、不是当前角色，且当前没有未完成的切换请求。
2. 目标的 `compiled.json` 必须有效（不超限、无残留宏）；开启角色模式时还必须有有效的 `publicPrefix`（见 5.9）。
3. 准备目标的运行状态（只写目标目录里还不存在的文件，不动当前角色）：
   - `binding.json`：appId、ownerId 取自当前角色，`characterId` 为目标 id，`projectId` 沿用。
   - `conversations.json`：如果不存在，按当前 QQ 会话键写入一个新的随机 Session ID，`lifecycle` 留空。这样新角色不会推导出旧会话（见 3.3）。
4. 写 `character-switch.json`：`{target, previous, requestedAt, nonce}`，然后返回「已请求」。

watchdog 侧（独立进程）：
1. 发现请求后取得 `maintenance.lock`，用 `ops.cjs status` 等待 Agent 空闲（沿用维护工具的等待上限，超时则放弃本次请求并记录原因）。
2. 停止 Host（与 `manage.ps1` 的 `Stop-TaskHost` 相同的识别和确认方式）。
3. 确认联接当前指向 `previous`，然后改为指向 `target`。删除联接只用不带递归的删除方式，绝不对联接路径做递归删除。
4. 启动 Host，等待成功条件，上限 100 秒。成功需要同时满足：QQ 就绪（第 3 节第 7 点），以及 `runtime-health.json` 的 `pid` 属于新 Host、`characterId` 等于目标、`personaSource` 为 `compiled`（我的决定：只看 QQ 就绪，会把「QQ 连上了但角色没加载对」误判为成功）。
5. 成功：写结果 `{ok:true, target, at}`，删除请求。
6. 失败：联接指回 `previous`，再启动一次 Host 并等待就绪，写结果 `{ok:false, target, restored, reason}`，删除请求。
   - 若退回后的启动也失败：写结果 `{ok:false, restored:false}`，释放维护锁，交给 watchdog 原有的「缺席 90 秒后拉起」逻辑继续尝试 `previous`。

启动预算（我的决定）：生产 `features.json` 的 `watchdog.maxStartsPerHour` 是 3，用来防止崩溃循环。切换引起的启动不计入这个预算，否则一次切换加一次切回就可能耗尽预算，之后真的崩溃时没人拉起。切换另设上限：每小时最多 4 次切换请求，超出时 `switch()` 直接拒绝并说明原因。

前置条件：`watchdog.enabled` 为假、或 `watchdog-state.json` 超过 2 分钟没有更新（watchdog 不在运行）时，`switch()` 拒绝，提示 Owner 先启用 watchdog；不写请求文件。
7. 全程持有维护锁，watchdog 自身的「缺席 90 秒后拉起」逻辑不会同时触发。

### 5.5 用户级存储：提醒与通知按用户隔离、在角色之间共享（Owner 已确认）

**原则。** 定时提醒、长期任务、通知属于用户，不属于角色：同一用户切换到任何角色都照常收到；不同用户之间隔离。人设、记忆、身份作用域指纹、QQ 会话路由（聊天历史）属于角色。

**已核实的现状。**
- 提醒到期时，Identity 把提醒原文套上固定格式「[提醒到期]……」放进通知队列（outbox）后转发，不经过模型，也不套人设。
- 长期任务（C1）每次执行都在独立的 `long-task` 会话里，汇报是只陈述事实的固定格式，经 outbox 发出。
- outbox 的种类只有 `scheduled_reminder`、`task_*`、`maintenance_result`、`configured_alert`，没有角色的聊天回复。
- 提醒的投递授权（`qq_bindings`：哪个会话设的提醒允许投递给 Owner）和 outbox 本身，目前都在每个角色自己的 `coordination.sqlite` 里。切换后，新角色的库里没有这些记录：旧提醒发不出去，未发完的通知被困在旧库。
- 提醒列表（DSH 原生 Schedule）和长期任务账本（原生 `character_long_tasks` storageDomain）本来就保存在 Home 级，不在角色目录里。
- 但长期任务按「用户 + 角色 + 项目 + 会话」四项归属：`long-tasks/service.mjs` 的 `scoped` 与列表过滤比较 `characterId`，每次执行、结算和发通知前调用的 Identity `validateConversation`（`character-identity/index.mjs:157`）也比较 `characterId`。所以在 Yuha 下建的任务，切到 Tasha 后查不到、改不了，到期执行会以「Foreign task conversation」被拒。

**本期做法。**
1. Identity 的状态拆成两个库：
   - 角色级（不变）：`<角色目录>/coordination.sqlite`，保存 `identity_state`（作用域指纹）和 `routes`。
   - 用户级（新增）：`data/users/<principalId>/delivery.sqlite`，保存 `outbox` 和 `qq_bindings`。`principalId` 与 Identity 现在推导的一致（`owner-<摘要>`）。
2. 新增 Identity 配置 `userStateDirectory`（默认 `<install>/data/users`），构建写入固定路径，不经联接。
3. 授权逻辑不变：投递仍要求会话、conversation、Owner Preset 全部匹配；只是查询的库换成用户级库。conversationId 本来就只由 appId 和 Owner 决定，与角色无关，所以跨角色天然一致。
4. 目前只有 Owner 能设提醒、使用长期任务（角色模式下 Contact / Guest 没有这些工具），因此实际只会有 Owner 一个用户目录。
5. **长期任务去掉角色维（Owner 已确认）。** 任务归属改为「用户 + 项目 + 会话」三项：
   - `long-tasks` 的 `scoped` 和列表过滤不再比较 `characterId`；
   - Identity 新增 `validateDelivery(scope)`，只比较 `principalId`、`projectId`、`conversationId`，供长期任务和用户级通知使用；原 `validateConversation` 与 Memory 的 `current(scope)` 仍比较 `characterId`，记忆隔离不变；
   - 已有任务记录不改写：`scope.characterId` 保留为「创建时的角色」，只用于显示，不再参与授权（我的决定：不改写记录就不需要迁移账本，也不违反 D6）；
   - 任务执行本来就用固定的中性「后台任务执行者」人设，不挂载角色人设，去掉角色维不影响执行内容。
6. 迁移（见 5.6）：把当前角色库里的 `outbox` 与 `qq_bindings` 搬到 Owner 的用户库，按 D6 受控切换，搬完后角色库不再保留这两类数据的写入者。

**实现前必须先验证。** 提醒到期时，DSH 会唤醒设这个提醒的原会话。要在原生门禁里确认这一步不会跑一次模型对话。如果会跑，就会出现「旧角色的聊天记录配新角色的人设」的一轮回复。那样的话，Identity 必须在这一步拦下：只转发提醒，不交给模型。这一项不通过，切换功能不上线。

**以后的扩展（本期不做，结构已留好）。** Contact / Guest 获得提醒或长期任务权限后，各自使用自己的 `data/users/<principalId>/`，存储结构不变；届时再让提醒列表和长期任务按用户过滤（现在只有 Owner，全局可见即等于按用户可见）。

### 5.6 首次接入（一次性迁移）

1. 用 `characterManager.enabled` 构建并部署新的核心包、Identity、Interaction、管理插件（按现有 `Stage` / `DeployValidated` 流程）。
2. 同一次部署前（Host 运行中，只新建文件）：
   - 建 `data/characters/registry.json`，收编 `yuha → data/character-yuha`。
   - 为 Yuha 生成 `character.json` 和 `compiled.json`。
   - 建联接 `data/character-current → data/character-yuha`。
   - 把 Profile 身份行改到 `data/character-current/…`，并加上 `userStateDirectory`，另存原件。
3. **Owner 用户库迁移按原计划 D6 / ADR-055 受控切换**（每类持久状态唯一写入者；先审计、备份、验证再切换；不长期双轨）：
   - 在维护窗口执行：持维护锁、确认空闲（没有运行中的 Agent、未完成的长期任务 run、待发通知），停 Host。
   - 备份 Yuha 的 `coordination.sqlite`（含 WAL）一致副本。
   - 迁移脚本 `scripts/migrate-user-state.cjs`：把 `outbox` 与 `qq_bindings` 复制到用户库，核对行数和每条事件 ID / 绑定键一致后，在同一步从角色库删除这两类行，并在两个库各写迁移标记（时间、行数、摘要）。任一核对不符就不删除、不写标记、报错退出，Host 按旧配置启动。
   - 新版 Identity 启动时强制单一写入者：配置了 `userStateDirectory` 但用户库没有迁移标记、或角色库里仍有 `outbox` / `qq_bindings` 行，就拒绝启动并说明原因。不在启动时自动迁移。
4. 部署后 Yuha 照常在线，身份、记忆、会话不变（路径经联接指向同一目录），提醒和未发通知继续投递。
5. Tasha 通过界面导入。宁栖 不在本期范围内。

回退方法：
- 同一迁移脚本提供反向模式 `--restore-into <角色目录>`：在维护窗口停 Host 后，把用户库里的 `outbox` 与 `qq_bindings`（包括迁移后新增的）写回指定角色库，核对后清空用户库并写回退标记。这样回滚保全切换后新增的记录，不用旧快照覆盖（原计划 D6 的要求）。
- 然后部署 `characterManager.enabled:false` 的旧版构建，并把 Profile 身份行恢复为原件。
- 回退只能写回一个角色库：切换期间在其他角色下设的提醒授权，也会归到这个角色库（它们本来就属于同一个 Owner）。
- 长期任务记录没有改写，旧版会重新按 `characterId` 过滤：在其他角色下建的任务回退后不可见、不执行，回退说明里要列出这些任务，由 Owner 决定取消或重建。
- 联接、`data/characters` 和 `data/users` 可以保留，不会被使用。

### 5.7 安全与隔离

- 所有接口只接受原生认证的 Owner，只在 loopback 上提供，安全头与 Memory Inspector 相同。
- 浏览器不能指定文件路径，只能指定角色 `id`；上传文件先写入临时目录，解析失败即删除。
- 卡内容视为不可信文本：沿用 V3 第一期的宏降级、残留 `{{` 检查和 8000 token 上限。运行时人设插件读取 `compiled.json` 时再检查一次。
- 每个角色的身份、记忆、会话状态都在自己的目录里，同一时刻只有当前角色的目录通过联接被打开。
- 切换请求只由插件写入，watchdog 只认 `data/characters` 里已注册、合法的 id，不执行请求里的任何路径。
- watchdog 对 `registry.json` 的信任范围（我的决定）：角色目录只能是 `data/characters/<id>` 或旧位置 `data/character-<id>`。解析后的真实路径必须在 `data/` 之下、不是联接本身、且目录里有 `binding.json`，`binding.json` 的 `characterId` 等于该 id。其他 `dir` 一律拒绝。
- 已核实：生产 Profile 中与角色相关的覆盖行只有 `character-identity`。`long-tasks` 行只设 Preset、工具和工作目录，不含角色路径。迁移只需改 `character-identity` 一行。

### 5.8 与现有功能的关系

- **Memory Inspector**：通过 Identity 读取当前角色的记忆，切换后自然显示新角色的记忆。角色管理页提供跳转。
- **Preset Manager**：它把 Character Bundle 视为只读，只写 Profile 覆盖。不能用它改 `persona` 行，否则会盖掉运行时人设插件。管理页检测到 Profile 里有 `persona` 覆盖时给出警告。
- **角色模式**：见 5.9。
- **构建时角色卡**（第一期）：`characterManager` 关闭时完全不变；开启时，构建配置里的卡只作为回退文本。

### 5.9 角色模式与角色管理同时开启（Owner 已确认放在本期）

两个功能是交叉的两个维度：角色模式决定「说话的人能用什么」（Owner / Contact / Guest 三个 Preset），角色管理决定「bot 是谁」（Yuha、Tasha……）。现有角色模式是按「只有一个角色、构建时写死」设计的，直接叠加会出三个问题：

| 现有做法（已核实） | 与角色管理叠加后的问题 | 本期做法 |
|---|---|---|
| `role-presets.mjs` 把 `roles.publicPersonaFile` 的内容在构建时写进 Contact / Guest 的 `persona` 行 | 切到 Tasha 后，Contact / Guest 仍看到为 Yuha 写的公开人设 | 每个角色可选 `public.md`，编译进 `compiled.json` 的 `publicPrefix`；Contact / Guest 的 `persona` 行改为运行时人设插件（`role:'public'`）。`publicPersonaFile` 只在 `characterManager` 关闭时使用 |
| `role-settings.cjs` 把 `identity-access.json`（授权、封禁）和 `identity-owner.json` 放在角色数据目录 | 每个角色一份授权表：切换后被封禁的人自动解封，Contact 授权丢失 | 两个文件放到 `data/users/`，不经联接，所有角色共用。这只是 QQTK `dsh-identity-access` 的配置路径，不改它的代码 |
| `rolePresets` 要求 Owner Preset 有 id 为 `persona` 的行 | 运行时人设插件替换了该行 | 保留 id `persona`，检查继续成立；构建测试覆盖这一组合 |

其他规则：
- 开启角色模式时，切换目标必须有有效的 `public.md`，否则 `switch()` 拒绝并提示先写公开人设；Contact / Guest 不会回退到私有人设。公开人设由 Owner 在管理页单独编辑和审阅，不从角色卡自动生成。
- Contact / Guest 的会话在 `conversations.json` 里，随角色目录切换，所以换角色后他们也进入新角色自己的新 Session，与原计划「角色变化后进入新 Session」一致。
- Owner Preset id 迁移（`qq-character` → `character`、`legacyPresetIds`、`memoryAgentId` 保持旧 id）沿用现有机制：每个角色目录第一次在角色模式下打开时由 Identity 迁移自己的指纹。需在实现时确认 `ops.cjs` 对 QQ Preset 名 `qq-character` 的要求在角色模式下仍满足。
- 生产目前没有开启角色模式；本期交付「可以同时开启且经过验证」，不在生产开启（开启是 Owner 单独的决定）。

## 6. 需要修改的范围

- 本仓库：`scripts/build.cjs`、`scripts/role-settings.cjs` 与 `packages/character-definition/role-presets.mjs`（角色模式的运行时公开人设和 `data/users/` 路径，见 5.9）、`packages/character-identity`（状态拆成角色级与用户级两个库、新增 `validateDelivery`，见 5.5）、`packages/long-tasks`（归属去掉角色维）、`packages/character-memory-tools`（运行时末尾提醒）、`packages/interaction-policy`（运行时读取提醒和等待提示）、新包 `packages/character-manager`（含 `runtime-persona.mjs`）、迁移脚本 `scripts/migrate-user-state.cjs`、相关测试、原生门禁和文档。
- QQTK 维护工具：`maintenance/watchdog.ps1` 增加切换请求处理；`ops.cjs` 的状态检查只读复用。**这是对 QQTK 的修改，需在 QQTK 仓库单独提交，并同步到生产 `maintenance/`。**
- 生产一次性迁移：见 5.6。
- DSH 核心、Conversation Manager、Memory、QQTK `dsh-identity-access` 的代码不改。Identity 的记忆与会话作用域不改；投递授权（提醒、长期任务通知）改为不比较角色，两张表换到用户库。

## 7. 验证

- 单元测试：Identity 用户库（表搬迁一次且只一次、授权条件不变、两个角色库共享同一用户库时投递正确、角色库仍然隔离）、注册表与 `id` 校验、编译与原子写入、修订冲突、上传限制、切换前的准备（只新建文件，不动当前角色）、会话预置、运行时人设的回退与缓存。
- 前端测试：沿用 Inspector 的客户端测试方式（注册、停用、销毁、请求中止）。
- watchdog：在测试 Home 里用假 Host 进程验证请求处理、联接切换、失败退回、维护锁和启动预算；删除联接时目标目录完好。
- 原生门禁：
  - 隔离 Host 上验证运行时人设热生效：修改 `compiled.json` 后，下一次模型请求的系统提示随之变化，且通过 Host 自己的插值。
  - 两个角色目录之间切换后，记忆、身份、会话互不可见；Owner 在角色 A 设的提醒，切到角色 B 后到期仍送达。
  - 提醒到期唤醒旧角色会话时不触发模型对话（见 5.5，必须先通过）。
- 角色模式联合验证（扩展现有 `scripts/run-roles.ps1`，隔离 Home）：两个角色各带公开人设，切换后 Contact / Guest 的系统提示随之变化且不含 Owner 私有人设；切换前封禁的账号切换后仍被拒绝、Contact 授权仍在；没有 `public.md` 的角色在角色模式下切换被拒绝；Contact / Guest 仍看不到、执行不了任何工具。
- 长期任务：在角色 A 建的任务切到角色 B 后可见、可改、到期执行并经用户库通知；记忆仍按角色隔离（任务 Agent 本来就无 Memory）。
- 迁移脚本：正向迁移核对失败时不删除旧行；Identity 在缺迁移标记或角色库仍有旧行时拒绝启动；反向模式保全迁移后新增的通知与提醒授权。
- 生产：迁移部署后核对 Yuha 的身份、记忆、会话与迁移前一致；在界面上导入 Tasha、切换、再切回，每次核对隔离和 QQ 就绪。

## 8. 留给实现者决定

- 运行时人设的缓存方式（按修改时间或修订号），只要每次组装提示都能拿到最新的有效文本。
- 上传接口的具体分块方式和临时文件位置（必须在 `data/characters` 下的临时目录）。
- 前端的具体布局和文案，在宿主组件范围内。
- watchdog 中切换逻辑的代码组织，可以拆成单独的 `character-switch.ps1` 由 watchdog 调用。
