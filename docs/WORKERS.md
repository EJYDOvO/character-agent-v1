# Worker V2：Character Root 与独立专业 Preset

本机 `resources/app.asar` 中的 DSH 0.2.1-rc.2 已具备 `dsh-tool-subagent` 的 `agentPreset`、`allowedAgentPresets` 以及 `spawn` 的独立 Preset 能力。旧 0.2.0 审计中的版本限制不再适用于这个已验证构建；仍不保证其他构建同版本号下的全部接口不变。

Worker V2 已随 test.15 部署，当前实例启用七个默认角色，review 仍按需关闭；验收边界见 [STATUS](STATUS.md)。Character 是唯一 Root/Orchestrator，保留完整 Creator 工具、Skills、原生委派、Fork 和 workflow。简单任务直接处理；复杂任务才按需使用 Planner 草案，所有结果由 Root 核验和决策。**Fork/workflow 是 Creator 原有通道，不具备此 Worker 的等价隔离边界。** 安全 Worker 使用 `subagent` 的 `spawn`，默认 `worker-general`，显式 `allowedAgentPresets`，`maxDepth:1`。

## 权限与能力

本版 Worker 是安全分析型：仅分析父 Agent 明确提供的材料，不具有文件、网络、执行、记忆或继续委派工具。它能返回分析和操作提案；主 Agent 独立核验后使用自己的工具、授权和审批。没有复制父 Agent 的 Memory handle，也没有自动批准子任务的机制。

`character-memory-tools/worker.mjs` 复用原生 Agent-scoped `tools.restrict({allow:[]})` 隐藏继承工具，`presentAs('native')` 避免 PTC 暴露执行入口，`tools.guard()` 在可扩展 pre-execute 之后单调拒绝所有执行，包括后挂载 scoped 工具和显式 allow。不是只靠提示词限制，也不以 `approvalPolicy: never` 冒充沙箱。四个核心插件不变，共用 `worker-policy.mjs` 存放构建和 Root 的角色词表，没有新增 Manager、Spawn Provider 或 Agent Loop。

独立 Session、父子通信、邻接授权和冷恢复由 DSH 原生 Subagent 管理。恢复继续挂载保存的 Worker Preset；不存在 Preset 失效后退回 Creator 的项目补偿路径。可信 Host 插件本身仍能执行进程代码，此机制不是对恶意 Host 插件的隔离沙箱。

## 角色与结果契约

以下七个独立 Preset 由 Core 构建声明，不依赖 Extras：

| Preset | 职责 |
|---|---|
| `worker-general` | 兼容通用分析，仍是默认目标 |
| `worker-explore` | 梳理给定代码片段、索引与调用关系 |
| `worker-librarian` | 比较给定文档、来源、版本与许可证 |
| `worker-oracle` | 复杂故障和架构取舍建议 |
| `worker-metis` | 规划前的需求、歧义、风险澄清 |
| `worker-momus` | 计划的可执行性、回滚及验收评审 |
| `worker-planner` | 复杂任务的计划草案，不调度或执行 |

Explore/Librarian 本版也没有读取文件或联网工具；Root 必须提供材料及来源。缺材料时返回 `blocked`/`needs_input`。没有偷偷开启执行型 Worker、多级委派或额外 Planner LLM。

各角色独立 Persona 要求返回 **WorkerResult V1**：`worker`、`status`（`ok/blocked/needs_input`）、`summary`、`findings[{claim,evidence[{reference,quote}]}]`、`uncertainties`、`proposals`。Root 的策略提示要求检查格式、来源和不确定性；它是提示与核验契约，**不是运行时强制 JSON Schema**。模型不遵守时不能宣称成功，工具安全由 Host 守卫保障，不依赖这个格式。

兼容 `worker-review` 继续按需配置。`private/build-config.json`：

```json
{"specialistWorkers":["worker-review"]}
```

构建同时生成内置 Preset、Spawn 白名单及 Root 角色说明；删除可选配置会同时移除 review 的声明和引用。Extras 内容保持原样，关闭 Extras 不影响内置分析 Worker。官方 Creator 指纹、构建源、角色词表和配置变化触发重建；构建清单记录 `workerPolicyVersion:2` 与实际白名单。

社区接入使用可信构建配置 `communityWorkerPresets:["worker-example"]`。必须先通过原生 Profile/Bundle 安装并审查对应独立 Preset，挂载相同叶子守卫，禁止 QQ/Memory/管理授权与多级委派，再加入允许名单；这不会自动安装或复制外部 Persona。配置由 Host 管理，模型不能临时扩大白名单。内置 ID、重复 ID、非法 ID 拒绝；引用缺失时原生校验失败，不能回退 Creator。**一个 `worker-*` 名字本身不证明第三方插件安全；可信 Host 插件仍能运行进程代码。**

角色/官方 Creator/构建源或配置变化会要求重新构建并回归。未来如果增加文件、检索或 Memory 授权，应另行设计可验证的最小授权；不要简单移除执行守卫或把父 Agent 的身份参数传给 Worker。

## 验证与限制

`node --test tests/workers.test.mjs` 验证角色、配置和构建契约；安装匹配 DSH 后设置 `DSH_INSTALL_ROOT`，执行 `scripts/run-inspector.ps1 --workers`，使用全新目录及两次独立 Host 进程。实际 Spawn 覆盖八个内置角色及一个审查过的社区夹具，验证独立 Session、无父历史/Persona、工具/QQ/Memory/Long Tasks 拒绝、后挂载工具与嵌套委派绕过、非父通信、释放后冷恢复和完整重启后恢复。结果按 runId 与阶段核验，不用旧报告代替本次验证。

Core-only/Core+Extras 原生回归另覆盖 Creator 工具、跨 Session Memory、自动提取、Compaction、Schedule/Outbox 和 Inspector。模型与 Sender 是确定性合成替身；这些隔离测试没有连接生产 QQ 或读取生产记忆；其后授权部署的启动与数据校验见 STATUS。真实模型的角色质量、结构化输出稳定性及主代审批完整业务验收仍未验证。

角色划分参考 [dsh-plugin-cluster-preset](https://github.com/hu568/dsh-plugin-cluster-preset)，只参考职责，未复制旧 `toolFilter`/委派 `persona`、Team Policy 或其生命周期插件。许可证及固定源码版本见 [第三方说明](../THIRD_PARTY_NOTICES.md)。
