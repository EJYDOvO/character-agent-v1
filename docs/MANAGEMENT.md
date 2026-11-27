# 配置与管理

新安装入口见 [INTEGRATION](INTEGRATION.md)，实际状态见 [STATUS](STATUS.md)。参数来自仓库外私有 JSON；生成的 Core 可能包含私有 Persona，不提交 Git。

| 配置 | 作用 |
|---|---|
| runtimeRoot/resourcesDirectory/runtimeExecutable | 官方发行目录；只读官方 Creator/SDK |
| profileName / dataDirectory | 新 Home 中的独立 Profile 与 Character 数据目录 |
| card / rules.system / rules.reminder / userName | CCv3 角色卡（.json/.png/.yaml，必填；用模板时写 `characters/template/card.yaml`）、角色规则、末尾提醒与对用户的称呼；路径相对配置文件。旧的 `definition` 键会被拒绝 |
| characterId / characterPresetId / projectId | 记忆作用域的角色 ID（必填，没有默认值）、真实 Preset 与固定项目作用域 |
| model | provider/id/API/URL/input 与凭据变量名 |
| qq | 唯一账号、Owner、凭据变量名与是否启用连接；`allow` 为额外准入的私聊账号，仅在 roles 开启时允许 |
| semanticRecall | L2 语义检索（[SEMANTIC-RECALL](SEMANTIC-RECALL.md)）：`mode` 默认 `active`，可设 `shadow`/`off`；`runtimeDir`/`modelDir` 默认 `<安装根>/data/semantic-recall/{runtime,models}`，用 `node scripts/provision-semantic.cjs` 准备；`threads` 默认 2。未准备模型时 Memory 照常运行在 FTS5 上 |
| roles | 可选角色模式（默认关闭）：`publicPersona` 审阅过的公开 Persona 文件、`legacyOwnerPreset` 旧 Owner Preset id；见 [Identity & Access](IDENTITY-ACCESS.md) |
| memoryMode | off / assistant / character；由可信 Host 决定 |
| interaction / inspector | 可选交互策略、管理页；Inspector 默认 writable:false |
| extras / longTasks | 可选自有声明；长期任务默认无工具执行能力 |
| specialistWorkers / communityWorkerPresets | review 与经审查的社区真实 ID/别名 |

第三方自带 Bundle 由原生 Profile 安装管理，不重复写 Extras。普通可选插件须先安装依赖，再明确声明。Character 保留 Creator 管理工具，实际操作仍受原生权限/审批约束，不直接改 node_modules 或官方 Bundle。

旧维护后端的 features/policy 是模板，不是当前 Profile 的权威。更新必须候选构建、包/补丁哈希、冻结锁与隔离回归；不能以同版本号假设同产物。停用后不恢复旧直接 Sender，不扩大 Worker/Memory 权限。数据迁移、备份和回滚必须先停净使用该 Home 的所有进程。

## 切换角色（每个角色独立的身份、记忆与会话）

一个 Character Preset 对应一个角色和一份记忆。开启角色管理（见下节）后，切换在设置页完成；没有开启时，下面的手动方式仍然可用。手动切换时，每个角色使用自己的构建配置和独立的 `dataDirectory`（如 `data/character-<id>`），不要在原目录里改 `characterId`：

- **身份状态拒绝原地换角色。** Identity 在 `coordination.sqlite` 记录作用域指纹（App、Owner、characterId、项目、Preset），characterId 变化会拒绝启动。
- **数据目录决定隔离范围。** `binding.json`、`coordination.sqlite`、`memory.sqlite`、`conversations.json`、`hangon-model.json` 都随 `dataDirectory` 构建进 Core。记忆库另按 principal / character / project 分区。
- **Profile 覆盖行是整体替换。** 宿主对 Profile 补丁行的每个顶层键直接赋值，`config` 不与 Core 合并。若 Profile 里有 `character-identity` 行，必须保留 `presetId`、`bindingFile`、`stateFile`、`memoryMode` 四项，并把两个路径改到新目录；删掉路径会使 Identity 无法启动、QQ 无法连接。
- **新目录要预置会话路由。** Conversation Manager 在状态文件里没有记录时，会从 QQ 会话键推导 Session ID。会话键不含角色，推导结果就是该 QQ 会话最早的 Session，新角色会接着旧角色的聊天历史。部署前在新目录写入 `conversations.json`，为该会话键指定一个新的 Session ID（`sessionIds`），`lifecycle` 留空。 同时写入 `"sessionNamespace": "<角色 ID>"`（需要 Conversation Manager 0.1.0-test.6 或更高），没有记录的会话也不会推导到旧角色的 Session。
- **部署备份不含角色数据。** `DeployValidated` 只备份 Profile、`AGENTS.md` 与 task-memory；自动回滚恢复的是部署开始时的 Profile。部署前手动修改的 Profile 文件请另存原件，回滚后据此复原。
- **可以共享的内容。** 全局与工作区 `AGENTS.md` 对所有角色生效，不要写入某个角色的人设。旧角色设定的 QQ 提醒，其投递授权记在旧目录的 `coordination.sqlite`，切换后不会由新角色投递。

## 角色管理（设置 → 角色管理）

构建配置写 `"characterManager": {"enabled": true}` 后，角色成为运行时选择：构建不再读角色卡、规则和末尾提醒，Owner / Contact / Guest 的人设由运行时人设插件每次组装提示时从 `data/character-current/compiled.json` 读取；Identity、Memory、Conversation、Interaction 的路径固定为 `<install>/data/character-current/…`。设为 `false` 或删掉该键，构建结果与开启前相同。`portable` 安装本期不支持此选项。插件说明见 [dsh-character-manager](../packages/character-manager/README.md)。

```
data/characters/registry.json        角色清单 [{id, dir, addedAt, archived}]；dir 一律为绝对路径（正斜杠）
data/characters/<id>/                新导入的角色：card.json|png|yaml、rules.md、reminder.md、character.json、compiled.json，
                                     以及运行状态 binding.json、coordination.sqlite、memory.sqlite、conversations.json、hangon-model.json
data/characters/.archive/<id>-<时间>/ 归档的角色（可手动移回）
data/character-<id>/                 旧位置，接入后原地使用，不搬动
data/character-current               目录联接 → 当前角色目录（以联接实际指向为准，不另存当前角色）
data/account/                        角色模式的 identity-access.json、identity-owner.json（与角色无关，不经联接）
data/maintenance/character-switch*.json   切换请求、进行中快照、结果与历史
```

- **切换前提：watchdog 在运行。** 只有 watchdog 能停 Host、改联接、再拉起 Host。`maintenance/features.json` 的 `watchdog.enabled` 为真，且 `data/maintenance/watchdog-state.json` 两分钟内有更新，管理页才写切换请求；否则拒绝并提示先启用 watchdog。每小时最多 4 次切换请求；切换引起的启动不计入 `watchdog.maxStartsPerHour`。`character-switch.json` 或 `character-switch.inprogress.json` 任一存在都表示有未完成的切换，期间不接受新请求。
- **切换会做什么。** 目标的 `compiled.json` 必须有效。第一次切到新角色时会为其初始化会话命名空间，并为 Owner 私聊和各登记角色已经记录的会话键预置独立 Session。再次切入同一角色时保留已有的显式和派生路由。任一已有的 `conversations.json` 读不出来时拒绝切换。watchdog 等待空闲后停 Host、改联接、启动 Host，等到 QQ 就绪并确认 `runtime-health.json` 来自新进程、角色 ID 正确且人设来自编译文件，才确认成功。失败或中断后，通过进行中记录恢复原角色。旧角色的提醒和长期任务在其他角色下不执行，切回后恢复。
- **会话命名空间。** 首次接入时，`adopt-character.cjs --link` 在注册表记录唯一的旧会话归属角色。该角色继续按原公式推导未登记的 Session ID，新角色用自己的 `sessionNamespace` 推导。切回时原路由保持不变，其他角色后来记录过相同会话键也不影响续接。目标带有其他角色的命名空间时拒绝切换。旧版 Conversation Manager 会丢弃命名空间字段，因此角色管理须配套 QQTK `dsh-conversation-manager` 0.1.0-test.6 或更高。
- **角色目录被删除或移走。** 联接指向不存在的目录时，Host 无法在该目录写 `runtime-health.json`：切换校验得到「no runtime health」，按失败退回原角色。Host 若直接以这种联接启动，人设用中性回退文本，Identity 读不到 `binding.json`，QQ 无法连接；把目录放回原位或把联接改回有效角色后重启。
- **第一个角色必须接入（adopt）。** 导入新角色时，`binding.json` 的 appId、ownerId、projectId 取自当前角色。还没有当前角色时导入的角色只有 `characterId`，不能被切换到，直到用 `adopt-character.cjs` 接入当前角色后重新导入。因此生产先接入现有角色（`--link`），再导入其他角色。
- **公开版。** Contact / Guest 只读 Owner 在管理页确认过的公开版；没有确认过时用中性回退文本，不读 Owner 版。编辑规则或卡之后，新公开版待确认期间仍用上一份已确认的版本。

### 生产接入（一次性）

顺序不能调换：`Stage` 把当时的 Profile（`cordis.patch.yml`）复制进候选，`DeployValidated` 开始前核对 Profile 自 Stage 以来没有变化（否则停止并提示 "Live profile changed: stage again"）。所以 Profile 必须在 Stage 之前改好，候选才带着新的 `character-identity` 行。

1. 用 `characterManager.enabled: true` 构建并 pack（核心包、Interaction 与 `dsh-character-manager`）。
2. Host 运行中，接入现有角色目录（只新增文件，不改 `binding.json`、数据库和会话）：
   ```
   node scripts/adopt-character.cjs --root D:/DeepSeek-Harness/data --id yuha --dir D:/DeepSeek-Harness/data/character-yuha --card <卡文件> --rules <rules.md> --reminder <reminder.md> --user-name <称呼> --hang-on-text <等待提示> --link
   ```
   脚本把卡、规则、提醒复制进目录（目录里已有同名但内容不同的文件即拒绝），写 `character.json`、`compiled.json`，登记到 `registry.json`，并建联接 `data/character-current`（联接已存在即拒绝）。目录没有 `binding.json`，或其中缺 appId / ownerId / projectId、`characterId` 不是该 id，目录不在 `data/characters/<id>` 或 `data/character-<id>`、或本身是联接，都在写入前拒绝且不写任何文件。写入后任何一步失败（含建联接），本次新增的文件、`registry.json` 的改动和本次建的联接都会撤销，可以直接重跑；只有撤销本身也失败时，错误信息会列出需要手动检查的项。
3. 另存 Profile 原件（改动之前的完整副本），再按脚本最后打印的内容替换 Profile 的 `character-identity` 行，四个键都写：`presetId`、`memoryMode` 保持原值，`bindingFile`、`stateFile` 改到 `data/character-current/`。脚本不修改 Profile。新旧路径经联接指向同一目录，无论 Host 何时按新行加载，读到的都是同一份数据。
4. 更新 `plugin-policy.json` 固定（含 `dsh-character-manager` 与其 `js-yaml` 依赖），然后 `Stage`。
5. `DeployValidated`（后台运行，读 `latest-result.json` 判断结果）。部署后核对 Yuha 的身份、记忆、会话与接入前一致（路径经联接指向同一目录），然后在管理页确认公开版、导入其他角色。

`DeployValidated` 失败时的自动回滚恢复的是部署开始时的 Profile，也就是第 3 步已经改过的那份：身份行指向 `data/character-current`，联接仍指向 `character-yuha`，旧构建照样能用。要完全退回接入前，用第 3 步另存的原件替换 Profile（自动回滚不会替你做这一步）。

### 回退

部署 `characterManager.enabled: false` 的构建，并把 Profile 的 `character-identity` 行恢复为原件。关闭角色管理的构建会把角色卡和 `dataDirectory` 重新固定进核心包：若当前角色已不是 Yuha，回退要用那个角色自己的构建配置（它的卡、规则、提醒和 `dataDirectory` = 它的角色目录），身份行也指向那个目录，而不是 Yuha 的原件。联接和 `data/characters` 可以保留，不会被使用。删除联接只能用非递归方式（例如 `cmd /c rmdir data\character-current`），不要对联接路径做递归删除。

### 角色模式的授权文件

开启角色管理时，`identity-access.json`、`identity-owner.json` 在 `data/account/`，切换角色不影响 Contact 授权和封禁。其他安装若在旧位置（角色数据目录）已有这两个文件，先停 Host，再把它们移到 `data/account/`。生产从未开启角色模式，没有需要移动的文件。
