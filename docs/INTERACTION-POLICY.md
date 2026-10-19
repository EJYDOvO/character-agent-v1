# Interaction Policy V1（test.10）

> 2026-10-20 未发布修复候选：以下为 test.10 初始设计记录；新的可信输入登记、取消契约、两份 QQ/SDK 补丁及验证边界以 [审计修复说明](INTERACTION-AUDIT-FIXES.md) 为准。正式语义分段延后至 settlement；平台硬分片不再由闲聊长度参数承担。

2026-10-19，以本机 DSH **0.2.1-rc.2** 和 QQ Bot **0.5.2** 为接口基线。初期开发在隔离环境完成；随后经授权部署 test.10 并开启策略。实际部署、恢复与验收边界见 [test.10 发布记录](RELEASE-test10.md)。官方发行文件保持不变。

## 分工

| 层 | 实现与职责 |
|---|---|
| Agent | 独立 `dsh-interaction-policy` 包，版本 `0.1.0-test.1`；Preset-scoped 服务与 Reply Policy |
| 原生 DSH | Session、Agent Loop、模型调用、工具、Streaming 帧、followup/steer/cancel 和 Compaction |
| 平台适配 | QQTK 的两处版本化补丁接入原生 Preset 服务、输出与明确修正；不包含人格或复杂度 Planner |
| Character | 原有四插件结构保留；Identity 增加可信提前入站钩子，让明确修正也经过 Owner 验证并产生真实用户证据 |
| Remote Ops | `1.1.1-test.1` 源码版本；Interaction 存在时让出普通进度提示，保留运维告警、超时和完成通知 |

Core/Extras 没有新增 Gateway。新插件不依赖 QQTK、Character Identity 或 Memory；可在普通 Preset 中独立使用。人格仍来自 Persona，交互策略只约束表达与呈现，不修改身份、工具权限或记忆 ACL。

```text
真实用户 → 平台白名单/问答/可信入站 → 原生 Agent Inbox
                                      ↓
Persona + Reply Policy → 原生 Agent Loop / Tools
                                      ↓
原生 scoped stream + Session events → Interaction
                                      ↓
                           串行发送队列 → 平台 Sender
Host 等待状态 ───────────────────────────┘（不进 Session）
```

## 行为

- **Reply Policy**：统一沿用 Persona 风格。闲聊简洁；复杂任务允许完整说明、代码和依据。模型可以先给简短自然进度，再执行工具并输出完整结果。没有额外分类模型或自动编造的进度文本。
- **Hang on**：默认运行 12 秒且没有自然文本时提示一次。必须是真实 running 状态；等待审批/问答时抑制。发送前再次检查，避免排队期间已有自然回复仍重复提示。结束、停止、卸载撤销计时器。
- **分段**：中文句末和空行作为保守语义边界，短聊天也能拆成多个气泡。代码、链接、列表、表格保守保留。每轮最多主动拆成 3 个气泡；不是每轮最多 3 条消息，工具前后回复和平台长度切片仍可增加消息数。
- **Assistant**：检测到工具请求后停止闲聊式细分；保留此前自然进度，结果继续流式展示。长文本也切换为连续结果，内容不截断。
- **Streaming**：使用 0.2.1 的 `agent/assistant-stream`，不依赖旧 `assistant/chunk`。单一队列串行处理 update、complete、静态气泡和原 QQ 工具错误。正式 assistant/message 只负责收尾，不重复发全文。
- **错误**：打开 Stream 明确失败时静态发送。已有 Stream 的 update 失败可能已到达 QQ，记录为投递不确定，不盲目重发全文。状态不是持久通知账本，重启后不补发旧“稍等”。
- **明确修正**：QQ 私聊中以 `更正：` 或 `更正:` 开头的非空文本，在当前 Agent 运行时生效。先通过白名单与待答问题处理，再执行可信入站钩子；附带附件、普通追问、“等等看”等仍走原消息合并。
- **工具边界**：仅本轮尚未请求任何工具时 cancel + followup；工具调用片段、已开始/已完成工具或阶段未知时都 steer，不抢停工具。检查到提交之间无异步等待。`/stop` 保留原生明确取消语义，先关闭未发送的呈现内容。任何取消都不承诺撤销已发生的副作用。

## 安装与开关

普通项目先通过原生 Profile 插件管理安装本地包或审查后的发布包，例如在本地克隆中：

```powershell
dsh plugin --profile <profile-name> add <absolute-path-to-repo>/packages/interaction-policy
```

再向目标 Preset 的 `plugins` 追加 [插件声明](../packages/interaction-policy/README.md)，保留完整原有插件列表。`isolate: { interactionPolicy: true }` 是原生 Preset 服务隔离要求，不能省略。包不自带自动生效的 Bundle，因为应由具体 Agent 选择策略。

Character 构建默认不插入 Interaction。可通过 `DSH_CHARACTER_INTERACTION=on` 或私有 `build-config.json` 中的 `interaction: {enabled: true, ...}` 明确选择；`off` 强制关闭。`ensure-build` 会比较该设置，配置改变需重新构建验证。构建只增加 Preset 条目，不安装包。隔离 Stage 会在启用时增加本地包依赖；生产发布仍需单独安装审查后的包并匹配新的 QQTK 补丁与 Identity，不能直接复用旧部署流程宣称已上线。

本机已完成配套打包、锁文件与补丁核对、备份和部署，并实际执行过回退；详见发布记录。其他实例仍须独立验证。仓库旧 QQTK tgz 仍是旧恢复版本，不包含这次候选源码。

| 参数 | 默认 | 含义 |
|---|---|---|
| enabled | true（仅安装到 Preset 后） | false 时完全不注册策略 |
| hangOnMs | 12000 | 无自然回应的等待阈值 |
| hangOnText | 还在处理中，稍等一下。 | Host 固定提示，可按 Persona 配置，不经额外模型生成 |
| throttleMs | 180 | 流式更新节流间隔 |
| maxBubbles | 3 | 每轮主动语义拆分上限 |
| chatMaxChars | 240 | 超过后保留连续结果，不作为输出截断长度 |

## 验证与限制

2026-10-19 隔离验证结果：

| 检查 | 结果 | 证据边界 |
|---|---|---|
| Character 自动化回归 | 89/89 通过 | 含 16 项 Interaction 与 1 项可信修正入站测试；其余为原有 Identity/Memory/通知回归 |
| QQTK 自动化回归 | 13/13 通过 | 适配代码、可信入站拒绝、Remote Ops 和旧任务记忆；传输替身 |
| 已安装 0.2.1-rc.2 原生宿主 | 8/8 检查通过 | 实际 Loop/工具/SDK/QQ 适配代码，确定性 Provider/Sender，无网络连接 |
| 构建 on/off | 2/2 配置通过 | 全新 fixture、无私有角色配置；Creator 插件保留、Extras 字节不变 |
| QQ 版本化补丁 | 通过 | 原始 0.5.2 快照独立应用后，10 个文件逐字节匹配维护源码 |

最新原生报告 runId 为 `bf0c1016-31fe-4681-9b84-a03ff08a544b`，在本地忽略目录 `test-data/interaction-ea84f845-65b5-4adc-8315-91f27d0d1b77/result.json`；报告/运行日志不进入公开源码。已确认测试子进程退出、调用环境恢复。受限沙箱曾因官方 ASAR 的 realpath 权限拒绝而启动失败，此次失败不计为通过；允许启动独立测试宿主后复测成功。构建检查用 `node scripts/check-interaction-build.cjs`，需先指定 `DSH_INSTALL_ROOT`；该脚本只在新 fixture 构建。

自动化覆盖短中文多种分片边界、代码结果、发送顺序、最终消息去重、状态提示竞争、审批等待抑制、停止与迟到帧、工具修正边界、失败降级、跨 Preset 和卸载。QQ 适配单测执行实际适配代码，SDK 和 Sender 使用替身，不是 QQ 网络验收。

`scripts/run-interaction.ps1` 创建全新 DSH_HOME，运行真实官方宿主、原生 Agent Loop、Scoped 服务、Creator 衍生 Preset、原生工具与 cancel/steer/followup；Provider 是确定性测试适配器。报告必须匹配本次 runId，失败返回非零，结束后停止本次测试进程。它不把 Mock 输出质量视为真实模型表现。

原生测试曾发现并修复 `agent/created` 串行监听器返回值截断后续 Subagent 注册的问题；现已加入自动回归。Creator 工具列表与无 Interaction 的同构对照一致，两个启用的 Preset 服务互不泄漏。

仍未验证或不包含：真实 QQ Streaming API 限额及异常网络表现、真实模型对自然语气/长度策略的遵循、Web 气泡/状态 UI 适配、热升级回滚。DSH Web 可使用 Reply Policy，仍由原生 UI 渲染消息；要展示额外 Host 状态和多气泡需后续 UI 适配，不能声称已经具备。

句式拆分是确定性启发规则，不是真正的语义理解。字符阈值不等于模型 Token 预算。已发送内容无法撤回；Stream 更新失败可能留下部分结果；传输超时依赖平台 Sender。运行中移除平台插件、网络断线恢复、长期高并发和跨机器迁移未在本轮端到端验收。

本机实际 QQ 入站与手机气泡现已得到用户确认：显示正常、无重复；后台对应请求完成。详细证据及仍未专项验收的部分见 [test.10](RELEASE-test10.md)。
