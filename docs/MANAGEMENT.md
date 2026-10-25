# 功能管理与维护

实例版本统一见 [当前状态](STATUS.md)；源码默认与实例启用状态分开记录。

安装版本和验收范围以 [STATUS](STATUS.md) 为唯一当前入口。官方内置 Schedule 保持；旧项目记忆数据保留，但不自动导入新库。

test.8 的分层记忆已完成隔离验证及授权生产部署，验证范围见 [发布记录](RELEASE-test8.md)。人格化模式、L3 预算、后台节奏和 Schema 3 回滚要求见 [分层记忆管理](MEMORY-LAYERS.md)。修改模式时必须保留完整 Identity 配置，不能只覆盖 memoryMode；旧工具名称继续兼容。

| 功能 | 管理方式 | 边界 |
|---|---|---|
| 自动记忆 | Core 配置 `character-memory-core.config.autoCapture`；Owner 可要求调用 `character_memory_status`、`character_memory_retry` | 默认开；后台每 5 秒挑选最多 4 个任务串行执行，当前 Agent 空闲才调用现有模型；45 秒超时，最多 3 次；可能产生现有模型 API 用量 |
| 自主保存与召回 | 自然语言要求保存/回忆，使用 `character_remember` / `character_recall` | 三类 semantic/episodic/procedural；模型保存默认 uncertain；作用域来自 Host，不接受参数声明身份 |
| 检查与纠错 | `character_inspect` / `character_correct` | 修改需当前 revision；并发冲突应重新读取，不覆盖他人的更新 |
| 分层检查 | `character_trace` / `character_projection` / `character_layers_status` | 追溯 L1、查看本 Agent 的 L3 和后台状态；test.8 起支持 |
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

## 审计修复后的记忆管理

test.9 已部署的审计修复调整了记忆管理行为：Assistant 只管理明确在 Assistant 策略下形成且符合其基本规则的人格化记录；Character/未知模式历史记录仍可在 Character 中管理，Off 继续隐藏它们。切换模式不删除记录或改 Agent ID。纠错在当前模式下重新标记形成策略，不能用 Character 改写内容却保留 Assistant 可见标记。

跨用途相同 `claimKey` 的不同事实会在 inspect/recall 中显示当前可见冲突，L3 暂不采用。真实 Host 确认某项后，只记录当前 Agent/模式对当时其他候选修订的取舍；其他候选后来修改或新增时，冲突会重新出现。不会把另一 Agent 私有记录 ID 写入共享 general 来源。具体边界和未实现能力见 [修复报告](AUDIT-FIXES.md)。

## Extras 与后续插件声明

当前源码的 `bundles/character-extras/cordis.patch.yml` 仅声明默认停用的 `dsh-character-long-tasks`。不预置搜索或 Bilibili，它们使用各自原生 Bundle。构建保留已有 Extras 声明，避免角色重建覆盖后续维护内容。长期任务需要另装可选包并明确启用条目；只开启 Extras 不会自动执行任务。

默认维护约定：本项目自有的可选插件声明放 Extras，固定角色/Identity/Memory/QQ 归 Core，密钥和 Owner 参数只放私有 Profile。外部完整 Bundle 由原生管理器装入 Profile，不复制其插入项到 Extras，也不编辑已安装的 node_modules。普通插件包还需独立安装依赖，只有 YAML 声明并不等于已安装。

Character 构建保留官方 Creator 的 `tool-plugin-manager`。本机 DSH 0.2.0-rc.2 的 `plugin_manager` 支持列举、开关、安装/移除 Bundle 等操作；每次需满足 `danger-full-access` 或当前调用审批，不授予 Character 无条件安装权。安装写入当前 Profile 的依赖/锁文件及 Bundle 列表，开关写入 Profile patch；接口没有目标 Bundle/Extras 参数。

因此，上述约定不是“原生安装后自动转存 Extras”的已实现机制，也不是权限隔离。如果需要严格强制所有扩展经过 Extras，需要另行实现自有安装适配与声明迁移、重复加载检查、失败恢复，并保留原生审批；不能仅靠提示词承诺这些保证。目前未修改官方插件管理器或安装链路。

生产依赖部署本机已经配置的 QQ/DSH/QQTK，脚本不是跨机器通用安装器。Node 依赖安装使用缓存和 `--ignore-scripts`；迁移机器前需要重新构建官方派生配置并核对路径。测试产物、配置、凭据和会话均被 Git 忽略。

QQTK 使用独立仓库的版本化补丁和产物哈希核验，当前部署范围见 STATUS；不复制私有配置或安装产物到公开仓库。

## 本机角色试用配置（test.6）

公开的 `characters/character-a/definition.yaml` 继续作为通用样例。本机可在 Git 忽略的 `private/build-config.json` 中配置 `definitionPath`，指向私有角色 YAML；也可以使用 `DSH_CHARACTER_DEFINITION` 显式覆盖路径。默认角色 ID 仍为 `character-a`，修改 ID 需要另行迁移 Identity 绑定与记忆归属。

构建从实际角色文件读取显示名称；`ensure-build.cjs` 同时检查官方 Creator 和角色文件的指纹。测试与部署源码摘要包含实际角色内容，避免角色修改后复用旧测试证据。角色设定需要重新构建、隔离验证和版本化部署，不是热更新。

本机 test.6 只更新角色与构建选源方式，四个运行插件的功能源码保持 test.5 基线；先前审计发现的记忆确认、冲突处理等问题并未在此次角色试用中修复。私有角色文件、生成的 Core、打包产物和模型测试记录均不进入 Git。真实模型会收到角色提示词，提示词里的虚构测试标记不应作为真实凭据。

## 可选交互策略（test.10）

test.10 提供独立 `dsh-interaction-policy`。普通 Agent 在自己的 Preset 配置；Character 可用 `DSH_CHARACTER_INTERACTION=on/off` 或私有构建配置选择。默认不增加交互条目，不改变运行中的 Agent。等待文案、阈值、流式节流与分段上限，以及安全修正和关闭方式见 [Interaction Policy](INTERACTION-POLICY.md)。

## test.13 可选 Session 生命周期与长期任务（实例启用状态见 STATUS）

QQ 条目可设置 `sessionLifecycle: {enabled: true, freshOnHostRestart: true, inactivityMs: 43200000}`，默认关闭。仅真实用户入站更新计时；回复、Schedule 和后台工作不刷新计时。Host 重启/到期后下次安全输入创建空白 Session；忙碌、待审批/问答和未完成收件箱延后。QQ manager `getStatus().lifecycle` 提供 pendingReason/blockedBy/generation。旧提醒保留原 Session 并冷恢复，长期 Memory 与固定 Persona 不清空。

独立长期任务的启用、工具/Skill、最小工具配置、状态查询和停用恢复见 [Long Tasks](../packages/long-tasks/README.md)。默认无执行工具、无主 QQ/Memory 身份；不提供主代审批。执行状态与发送状态分别查询，不能把 lastDelivery 当作完成。关闭 Extras 前先取消不需继续的长期任务；不得删除账本来强行重试。

Inspector 的入口为 DSH 网页/桌面的 **设置 → 记忆管理**。详细配置见 [Memory Inspector](MEMORY-INSPECTOR.md)。部署记录未变，源码候选不代表已上线。

## 历史 QQ Session 与存量提醒审计（test.14）

完整 Identity/Memory 只给当前主 QQ Session；换主根或切换模型后，旧句柄立即失效。旧根的原生提醒由 Host 按稳定 Conversation 经原 Outbox 通知，不运行模型或普通工具，不具备长期任务创建能力。历史聊天仍保留，不迁移、取消或重建原任务。无法核实归属的冷恢复明确报错并保持原任务；rc.2 不保证自动重试失败恢复，应在人工确认后使用原生管理方式处理，不能删除账本强制重发。

`characterIdentity.auditSchedules()` 是 Host-only 只读检查，无 Agent 工具或浏览器入口。可离线执行 `scripts/audit-qq-schedules.mjs`：使用所选 DSH 0.2.1-rc.2 的 Electron，设置 `ELECTRON_RUN_AS_NODE=1`、绝对 `DSH_INSTALL_ROOT`，传入 `--expose-internals`，脚本参数必须显式给出：

```text
--binding <binding.json> --state <coordination.sqlite>
--prefs <model-prefs.json> --schedule <storages/schedule.json>
--sessions <原生sessions目录> --preset <Character-Preset-ID>
```

默认物理 Session 编码为 zstd；未压缩实例加 `--uncompressed`。脚本只装载独立的原生持久化读取后端，不启动 Profile、调度、QQ 或 Memory。输出仅含计数、任务/Session 哈希别名与异常码，不含正文、身份和凭据。退出码 0 表示一致且所有任务归属可证；2 表示存在未证明绑定、头部异常或读取期间状态变化，不是授权修复成功。其他独立任务也可能显示 `unproven`，含义仅是未证明属于本 QQ 作用域，不应因此删除或授权。

离线脚本不补写任何绑定。运行时只对 Host 持久链可证明的祖先补写 `qq_bindings`，失败整批回滚；不恢复完整身份，不复投已停用任务，不更改任务 ID、规则、到期时间和通知去重 ID。审计和修复的真实启用边界见 STATUS。
