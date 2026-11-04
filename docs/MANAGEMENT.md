# 配置与管理

新安装入口见 [INTEGRATION](INTEGRATION.md)，实际状态见 [STATUS](STATUS.md)。参数来自仓库外私有 JSON；生成的 Core 可能包含私有 Persona，不提交 Git。

| 配置 | 作用 |
|---|---|
| runtimeRoot/resourcesDirectory/runtimeExecutable | 官方发行目录；只读官方 Creator/SDK |
| profileName / dataDirectory | 新 Home 中的独立 Profile 与 Character 数据目录 |
| definition / characterPresetId / projectId | Persona YAML、真实 Preset 与固定项目作用域 |
| model | provider/id/API/URL/input 与凭据变量名 |
| qq | 唯一账号、Owner、凭据变量名与是否启用连接；`allow` 为额外准入的私聊账号，仅在 roles 开启时允许 |
| roles | 可选角色模式（默认关闭）：`publicPersona` 审阅过的公开 Persona 文件、`legacyOwnerPreset` 旧 Owner Preset id；见 [Identity & Access](IDENTITY-ACCESS.md) |
| memoryMode | off / assistant / character；由可信 Host 决定 |
| interaction / inspector | 可选交互策略、管理页；Inspector 默认 writable:false |
| extras / longTasks | 可选自有声明；长期任务默认无工具执行能力 |
| specialistWorkers / communityWorkerPresets | review 与经审查的社区真实 ID/别名 |

第三方自带 Bundle 由原生 Profile 安装管理，不重复写 Extras。普通可选插件须先安装依赖，再明确声明。Character 保留 Creator 管理工具，实际操作仍受原生权限/审批约束，不直接改 node_modules 或官方 Bundle。

旧维护后端的 features/policy 是模板，不是当前 Profile 的权威。更新必须候选构建、包/补丁哈希、冻结锁与隔离回归；不能以同版本号假设同产物。停用后不恢复旧直接 Sender，不扩大 Worker/Memory 权限。数据迁移、备份和回滚必须先停净使用该 Home 的所有进程。
