# 功能管理与维护

test.8 的分层记忆仅完成隔离验证，尚未部署生产。人格化模式、L3 预算、后台节奏和 Schema 3 回滚要求见 [分层记忆管理](MEMORY-LAYERS.md)。旧工具名称继续兼容。

| 功能 | 管理方式 | 边界 |
|---|---|---|
| 自动记忆 | Core 配置 `character-memory-core.config.autoCapture`；Owner 可要求调用 `character_memory_status`、`character_memory_retry` | 默认开；后台每 5 秒挑选最多 4 个任务串行执行，当前 Agent 空闲才调用现有模型；45 秒超时，最多 3 次；可能产生现有模型 API 用量 |
| 自主保存与召回 | 自然语言要求保存/回忆，使用 `character_remember` / `character_recall` | 三类 semantic/episodic/procedural；模型保存默认 uncertain；作用域来自 Host，不接受参数声明身份 |
| 检查与纠错 | `character_inspect` / `character_correct` | 修改需当前 revision；并发冲突应重新读取，不覆盖他人的更新 |
| 分层检查 | `character_trace` / `character_projection` / `character_layers_status` | 追溯 L1、查看本 Agent 的 L3 和后台状态；仅 test.8 |
| 人格化 | Identity Host 配置 `memoryMode`、`memoryAgentId` | 默认 off；assistant/character 可选；关掉不删除数据，不影响通用记忆 |
| 跨事件巩固 | Core `consolidation`、`consolidateIntervalMs` | 默认每作用域/Agent/模式低频 6 小时；相同输入跳过；来源不足不归纳 |
| 确认事实 | `character_confirm` | 最新 10 分钟内真实 QQ 原文需逐字包含确认词和记忆完整陈述或 ID；泛泛的“确认”不能提升任意记忆置信度 |
| 合并与遗忘 | `character_merge` / `character_forget` | 合并要求两条 revision 和高相似度、相同否定/数字形态；不同事实请纠错，不能强行合并。遗忘保留屏障 |
| 通知记录 | `character_notifications` | 查看 sent/pending/unknown；unknown 不自动重发。先核对手机收件，再由 Owner 明确决定创建新的提醒或维护任务；不直接修改 SQLite 状态 |
| 定时提醒 | 官方 `schedule_create/list/update/delete` 及官方 UI | 只允许明确任务；依赖官方 framing，版本变化需重测。不是主动闲聊 |
| QQTK 运维与功能 | 既有 `/ops status`、`/ops features` 和 QQTK 管理流程 | 保留原审批及维护权限；QQTK 是独立版本化依赖，Core 只装配一次。增量见 `qqtk-notifications.patch` |
| Creator / 人格 | 编辑角色定义后构建；`node scripts/ensure-build.cjs` 检查官方变更；stage/pack 自动调用 | 官方 Creator 变动会重新派生；重新构建不等于升级已验证，仍需隔离宿主测试和新版本产物 |
| 数据/恢复 | 安装目录 `data/character`，与源码隔离 | SQLite 主库和通知库、binding 都不入 Git；离线备份必须包含 SQLite WAL；回滚按版本配套恢复 |

QQTK 继续独立维护，没有把它迁为第五个 Character 插件，也不安装第二份 QQ 网关。发布前审阅该补丁在 QQTK 原基线上的差异，单独生成版本化包，更新维护策略哈希；不要在已安装 node_modules 中临时修补。

生产依赖部署本机已经配置的 QQ/DSH/QQTK，脚本不是跨机器通用安装器。Node 依赖安装使用缓存和 `--ignore-scripts`；迁移机器前需要重新构建官方派生配置并核对路径。测试产物、配置、凭据和会话均被 Git 忽略。

本次部署的 QQTK 独立源码提交为 `8b947d7`（本机依赖源码仓库）；公共 Character 仓库保存可审查补丁，不复制私有配置或安装产物。

## 本机角色试用配置（test.6）

公开的 `characters/character-a/definition.yaml` 继续作为通用样例。本机可在 Git 忽略的 `private/build-config.json` 中配置 `definitionPath`，指向私有角色 YAML；也可以使用 `DSH_CHARACTER_DEFINITION` 显式覆盖路径。默认角色 ID 仍为 `character-a`，修改 ID 需要另行迁移 Identity 绑定与记忆归属。

构建从实际角色文件读取显示名称；`ensure-build.cjs` 同时检查官方 Creator 和角色文件的指纹。测试与部署源码摘要包含实际角色内容，避免角色修改后复用旧测试证据。角色设定需要重新构建、隔离验证和版本化部署，不是热更新。

本机 test.6 只更新角色与构建选源方式，四个运行插件的功能源码保持 test.5 基线；先前审计发现的记忆确认、冲突处理等问题并未在此次角色试用中修复。私有角色文件、生成的 Core、打包产物和模型测试记录均不进入 Git。真实模型会收到角色提示词，提示词里的虚构测试标记不应作为真实凭据。
