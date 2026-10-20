# 原生 Worker V1

本机 `resources/app.asar` 中的 DSH 0.2.1-rc.2 已具备 `dsh-tool-subagent` 的 `agentPreset`、`allowedAgentPresets` 以及 `spawn` 的独立 Preset 能力。旧 0.2.0 审计中的版本限制不再适用于这个已验证构建；仍不保证其他构建同版本号下的全部接口不变。

Core 构建声明 `worker-general`，将 Character 原有 `subagent` 工具的默认目标设为它，只允许显式白名单。主 Character 仍由完整 Creator 派生；工具、Skills、原生子 Agent 管理、Fork 和 workflow 均保留。**Fork/workflow 是 Creator 原有委派通道，不应把它们描述成此安全 Worker 的等价入口。** 需要此 Worker 边界时使用 `subagent`。

## 权限与能力

本版 Worker 是安全分析型：仅分析父 Agent 明确提供的材料，不具有文件、网络、执行、记忆或继续委派工具。它能返回分析和操作提案；主 Agent 独立核验后使用自己的工具、授权和审批。没有复制父 Agent 的 Memory handle，也没有自动批准子任务的机制。

`character-memory-tools/worker.mjs` 复用原生 Agent-scoped `tools.restrict({allow:[]})` 隐藏继承工具，并使用原生 `tools.guard()` 拒绝执行，包括后续挂载的 scoped 工具。并非只靠提示词限制，也不以 `approvalPolicy: never` 冒充沙箱。四个核心插件结构不变，该文件只作为现有包的额外入口。

独立 Session、父子通信、邻接授权和冷恢复由 DSH 原生 Subagent 管理。恢复继续挂载保存的 Worker Preset；不存在 Preset 失效后退回 Creator 的项目补偿路径。可信 Host 插件本身仍能执行进程代码，此机制不是对恶意 Host 插件的隔离沙箱。

## 专业 Worker

默认关闭。构建配置 `private/build-config.json` 可增加：

```json
{"specialistWorkers":["worker-review"]}
```

`worker-review` 提供代码/证据审阅提示，同样没有执行工具。构建同时生成 Preset 与允许名单；关闭时同时移除两者，避免悬空引用。依据既有 Q-003，本版选择在自有 Core 中按需声明，避免为了 Extras 动态接线另造注册层。Extras 保持空模板，不是安装 Worker 的前提。

角色/官方 Creator/构建源或配置变化会要求重新构建并回归。未来如果增加文件、检索或 Memory 授权，应另行设计可验证的最小授权；不要简单移除执行守卫或把父 Agent 的身份参数传给 Worker。

## 验证与限制

原生 Host 测试覆盖独立 Spawn/Session、非法 Preset、继承工具不可见、后挂载 scoped 工具实际调用被拒绝、伪造 Memory 句柄、非父 Agent 通信拒绝，以及释放后原生冷恢复保留 Preset/ACL。Creator 工具列表一致性已验证；真实任务能力 A/B、真实 QQ 上的主代审批完整流程尚未验证。测试模型是确定性夹具，不代表外部模型能稳定遵守提案格式。
