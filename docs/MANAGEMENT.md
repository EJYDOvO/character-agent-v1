# 配置与管理

新安装入口见 [INTEGRATION](INTEGRATION.md)，实际状态见 [STATUS](STATUS.md)。参数来自仓库外私有 JSON；生成的 Core 可能包含私有 Persona，不提交 Git。

| 配置 | 作用 |
|---|---|
| runtimeRoot/resourcesDirectory/runtimeExecutable | 官方发行目录；只读官方 Creator/SDK |
| profileName / dataDirectory | 新 Home 中的独立 Profile 与 Character 数据目录 |
| card / rules.system / rules.reminder / userName | CCv3 角色卡（.json/.png/.yaml，默认模板卡）、角色规则、末尾提醒与对用户的称呼；路径相对配置文件。旧的 `definition` 键会被拒绝 |
| characterId / characterPresetId / projectId | 记忆作用域的角色 ID、真实 Preset 与固定项目作用域 |
| model | provider/id/API/URL/input 与凭据变量名 |
| qq | 唯一账号、Owner、凭据变量名与是否启用连接；`allow` 为额外准入的私聊账号，仅在 roles 开启时允许 |
| roles | 可选角色模式（默认关闭）：`publicPersona` 审阅过的公开 Persona 文件、`legacyOwnerPreset` 旧 Owner Preset id；见 [Identity & Access](IDENTITY-ACCESS.md) |
| memoryMode | off / assistant / character；由可信 Host 决定 |
| interaction / inspector | 可选交互策略、管理页；Inspector 默认 writable:false |
| extras / longTasks | 可选自有声明；长期任务默认无工具执行能力 |
| specialistWorkers / communityWorkerPresets | review 与经审查的社区真实 ID/别名 |

第三方自带 Bundle 由原生 Profile 安装管理，不重复写 Extras。普通可选插件须先安装依赖，再明确声明。Character 保留 Creator 管理工具，实际操作仍受原生权限/审批约束，不直接改 node_modules 或官方 Bundle。

旧维护后端的 features/policy 是模板，不是当前 Profile 的权威。更新必须候选构建、包/补丁哈希、冻结锁与隔离回归；不能以同版本号假设同产物。停用后不恢复旧直接 Sender，不扩大 Worker/Memory 权限。数据迁移、备份和回滚必须先停净使用该 Home 的所有进程。

## 切换角色（每个角色独立的身份、记忆与会话）

一个 Character Preset 对应一个角色和一份记忆。切换角色时，每个角色使用自己的构建配置和独立的 `dataDirectory`（如 `data/character-<id>`），不要在原目录里改 `characterId`：

- **身份状态拒绝原地换角色。** Identity 在 `coordination.sqlite` 记录作用域指纹（App、Owner、characterId、项目、Preset），characterId 变化会拒绝启动。
- **数据目录决定隔离范围。** `binding.json`、`coordination.sqlite`、`memory.sqlite`、`conversations.json`、`hangon-model.json` 都随 `dataDirectory` 构建进 Core。记忆库另按 principal / character / project 分区。
- **Profile 覆盖行是整体替换。** 宿主对 Profile 补丁行的每个顶层键直接赋值，`config` 不与 Core 合并。若 Profile 里有 `character-identity` 行，必须保留 `presetId`、`bindingFile`、`stateFile`、`memoryMode` 四项，并把两个路径改到新目录；删掉路径会使 Identity 无法启动、QQ 无法连接。
- **新目录要预置会话路由。** Conversation Manager 在状态文件里没有记录时，会从 QQ 会话键推导 Session ID。会话键不含角色，推导结果就是该 QQ 会话最早的 Session，新角色会接着旧角色的聊天历史。部署前在新目录写入 `conversations.json`，为该会话键指定一个新的 Session ID（`sessionIds`），`lifecycle` 留空。
- **部署备份不含角色数据。** `DeployValidated` 只备份 Profile、`AGENTS.md` 与 task-memory；自动回滚恢复的是部署开始时的 Profile。部署前手动修改的 Profile 文件请另存原件，回滚后据此复原。
- **可以共享的内容。** 全局与工作区 `AGENTS.md` 对所有角色生效，不要写入某个角色的人设。旧角色设定的 QQ 提醒，其投递授权记在旧目录的 `coordination.sqlite`，切换后不会由新角色投递。
