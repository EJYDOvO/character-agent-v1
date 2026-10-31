# DSH Character Agent：当前进度与渐进式重构路线图 v0.8

> 更新：2026-10-30（开发方式改为按功能切片的渐进式重构，ADR-062）。GitHub 是后续文档维护的唯一主入口；旧 ChatGPT Library v0.7.8 仅为历史快照。
> 下列目标均为**设计决定，尚未实现**，除非标明已实现。每个切片的开发都在与生产隔离的环境进行，切片完成不等于部署；部署需另行授权并走既有门禁。

## 1. 当前源码与部署记录基线

| 能力 | 当前事实 | 尚未完成的边界 |
| --- | --- | --- |
| 运行装配 | Character **test.23** / QQTK **test.23** 已有授权部署记录；DSH **0.2.1-rc.3**、Node **24.21.0**、Windows | 不等于 Mac/其他 DSH 构建可安装或验收 |
| 会话 | 独立 Conversation Manager **test.2**，QQTK 为薄会话适配；隔离恢复/唯一路由已有验证 | 模拟第二平台不代表真实第二平台；旧提醒根/单写入者约束保留 |
| Interaction | **test.9** 已部署（Iteration 04）只提交完整气泡，`bind` 只用 `sendText`，QQ 侧经 `sendMessage()` 发送 | 真实 QQ 手机收件与实机分泡节奏未验收 |
| Worker | 原生 Creator/Worker Preset、显式委派、工具范围守卫；test.23 记录 13 Preset 健康 | 部分 Host 探针限时未完成；真实任务质量另验 |
| Memory/Inspector | SQLite Schema 3、记忆 L1/L2/L3、来源治理及可选 Inspector | 与通信 L1/L2/L3 无关；长期效果/桌面体验/大库性能另验 |
| 通知/Long Tasks | 原生 Schedule + 既有持久 Outbox、稳定目标/去重及可选 Long Tasks | 通用 Notification 尚未抽离；手机投递未全验 |
| 平台/原生窗口 | QQ Official Bot/SDK 版本化补丁及 SDK stream 为现状；原生窗口保留原生 UI/Streaming | QQ Personal、统一平台仓库未实现；Interaction 原生窗口出站分泡/Hang-on 未完整适配 |

Character 单元 215、安全审计 33、QQTK 轻量 55/审批 6 是 [STATUS](../STATUS.md) 的 test.23 **历史记录**；Host 探针多用合成 Sender/LLM。`--workers --manager` 在 55 秒期限内未完成，不列为通过。真实 QQ 手机收件、审批按钮、流式残留和生产回滚演练不能假定已验收。

## 2. 开发方式（ADR-062）

现有 Character + QQ Official Bot 系统实际运行中，不推倒重写。每轮只迁移一个相对完整、可独立验证的功能切片：

**选择切片 → 实现或抽离 → 单元测试 → 集成测试 → 局部替换旧路径 → 清理不再使用的代码 → 进入下一切片。**

1. 复用现有 DSH Agent、Session、Tools、Approval、Schedule 和 Conversation Manager；复用成熟算法，不为架构整洁重写。
2. 不长期维持两套生产发送路径或两个状态写入者；替换旧调用点后清理确实不再需要的旧代码。
3. 开发和测试与现有生产部署隔离；切片开发不修改运行中的 DSH 实例、生产配置、私有数据，不直接修改官方 DSH 发行文件或内置 Bundle。
4. 设计与 Host 能力不兼容时记录证据和替代方案，不绕过权限或重造 Runtime。
5. **Identity 与权限验证从 Iteration 01 起就是安全门禁**：每个切片对自己迁移的路径保留可信来源、Owner/Memory ACL、会话路由与授权检查，不留到 Iteration 08 补。
6. 每个切片只对已迁移路径声明满足 ADR-058–061，不宣称尚未实现的跨模块保证。

## 3. 功能切片顺序

以下是建议顺序，可依实际依赖适度调整，调整须在本文档说明原因。

| 切片 | 内容 | 依赖与排序理由 | 进入下一切片的条件 |
| --- | --- | --- | --- |
| **Iteration 01** | 普通文本出站 Unified I/O：最小 `sendMessage()` + QQ Official 文本 Adapter，接入一条现有普通文本出站路径 | 出站是所有后续切片（Interaction、HITL、Notification）的共同依赖；文本是最小可验证单位，不涉及入站身份交接 | 见 3.1 验收 |
| Iteration 02 | 通用入站消息与可信身份交接、入站去重（ADR-058） | 入站需要可信身份交接，先有出站契约可闭环验证“收—发”；去重需盘点现有 QQ 行为 | 平台/账号/消息完整范围去重；模型不可见安全证据；现有 Owner 准入不变 |
| Iteration 03 | Conversation Manager 的统一 I/O 接线 | 依赖 01/02 的 target/来源表达；Manager 保持唯一路由写入者 | 出入站共用同一 Conversation 引用；轮换/恢复与 I/O 授权复核一致 |
| Iteration 04 | Interaction 迁移：`sendText`/`openStream` 改用 `sendMessage()`，可提交确认点 | 依赖 01（发送语义）与 03（Conversation 引用）；最复杂的出站调用方，放在基础稳定后 | 不再有 Interaction 专属发送路径；旧 SDK stream 路径按决定隔离或移除；启停/取消/重试/工具前后验收 |
| Iteration 05 | Commands / 基础 Media 抽离 | Commands 作为 I/O 内部解析/分发，依赖 02 的入站契约；基础附件依赖 01 的消息结构扩展 | 命令解析与 Host 授权分离；附件描述进入消息契约 |
| Iteration 06 | HITL Bridge | 依赖 01 发送与 02 可信回应；原生 Approval/`userQuestions.ask()` 唯一权威 | 回应验证/取消/超时；不多平台各自猴子补丁全局服务 |
| Iteration 07 | Notification | 依赖 01 发送与稳定目标；Outbox 持久状态迁移需单写入者设计 | 稳定目标、Outbox 去重、`unknown` 不重放、历史提醒按自身授权检查（ADR-059） |
| Iteration 08 | Identity 剩余耦合与 Diagnostics 整理、整体回归 | 前面切片各自保留门禁后，统一清理 Character Identity 与平台耦合、关联字段/脱敏一致性 | 全量回归、无遗留双写入者 |
| Iteration 09 | 受控生产切换与真实验收 | 需要 01–08 的源码与隔离验证；单独授权 | 审计、停机一致备份、单活切换、手机收件/按钮验收、回滚演练 |
| Iteration 10 | QQ Personal 等后续平台 | 依赖统一契约稳定；需另定协议 | 在统一平台仓库按平台 Package 接入，真实账号收发 |

各切片之间的部署由用户另行授权；切片完成后可以只合并源码不部署。目标平台仓库在 Iteration 10 前再决定建立时机，迭代期间不创建。

### 3.1 Iteration 01：普通文本出站 Unified I/O

**状态**：源码完成，自动化测试与隔离 rc.3 Host 探针通过；未部署，真实 QQ/手机收件未验收。实现见 QQTK `plugin-sources/dsh-agent-io`，覆盖范围以其 README 为准。

**目标**：从现有 QQTK 中提取可复用的聊天消息发送接口，建立最小 Unified Agent I/O 出站能力，并通过 QQ Official Adapter 实现普通文本消息发送。上层提交一条与 QQ SDK 无关的逻辑聊天消息，由通用 I/O 交给 QQ Official Adapter，后者复用现有 QQ 发送逻辑（回复目标解析、被动回复限额、诊断）。

**范围**：

- 一个实际可调用、与 QQ SDK 解耦的 `sendMessage()`：逻辑目标可明确识别平台、接入账号及 Conversation；发送前复核可信路由证据；区分未发送/已接受/未知/部分分片；同 Conversation 串行、不同 Conversation 并行且有界；未开始的任务可取消；同一逻辑消息不重复发送。
- QQ Official 文本 Adapter：回复目标解析、平台限额、必要分片、API 调用、平台专属错误分类。
- 至少一条现有普通文本出站路径改用新接口，替换旧调用点并清理不再需要的旧代码，不留第二个发送所有者。
- 接口说明、示例与测试运行方法。

**非目标**：QQ Personal Adapter；统一平台新仓库；完整入站聊天流程；重写 Conversation Manager；完整迁移 Interaction（含 Streaming、渐进分泡与 SDK `openStream()`）；HITL Bridge / Notification；Memory 或 Character Identity 重构；Outbox/Session/Schedule 数据迁移；公共消息编辑/Streaming API；DSH 原生 Web/Desktop 展示改动；部署到运行中的 Character / QQ Gateway；新的持久状态数据库或消息总线。

**验收条件**：

1. 有与 QQ SDK 解耦、实际可调用的 `sendMessage()` 与 QQ Official 文本 Adapter。
2. 至少一条现有普通文本出站路径已接入新接口，旧路径不再重复发送。
3. 自动化测试覆盖：成功交接、I/O 不依赖 Character/Interaction、无第二条并行路径、QQ 回复目标/限额/分片、明确拒绝、超时/未知不重发、同 Conversation 顺序、不同 Conversation 独立、取消未开始任务、取消与在途请求竞态、会话/授权失效阻止发送、多账号/多平台不复用目标、旧普通发送回归、Interaction/Streaming 无退化、普通 Agent 无需 Character。
4. Interaction、Conversation Manager 与 Character Identity 的既有安全与会话边界不变；不修改运行中的 DSH 安装或生产数据。
5. 明确记录未覆盖的输入、Streaming、HITL、Notification 和其他平台能力；无法安全完成的项标记未完成，不以模拟结果冒充真实 QQ 验收。

### 3.2 Iteration 03：Conversation Manager 统一 I/O 接线

**状态**：源码完成（QQTK `dsh-agent-io@0.1.0-test.4`），自动化测试与隔离 rc.3 Host 探针通过；已授权部署（部署计划显式升级 test.3 → test.4）；真实 QQ/手机未验收。接口见 QQTK `plugin-sources/dsh-agent-io/README.md` 的 `openConversation()`。

**实现**：

- 统一 Conversation 引用 `{platform, accountId, conversation: {type, id}}`：入站由通道固定平台与账号，出站由同一接线校验；两者经同一 `scopes` 映射到 Manager 的 `(scope, peer)`，已持久化的 Session Key（QQ 仍为 `qqbot:<appId>:<scope>:<peer>`）、偏好与生命周期状态不变。
- 平台无关的 Host 接口 `agentIO.openConversation({platform, adapter, accountId, manager, scopes, admits, onInput})`：`handoff()` 完成访问复核 → Manager `getOrCreate`（保留创建/恢复/轮换与 Character Owner-only 等包装）→ 同一 Conversation 且 `isCurrentSession` → 原生 `UserMessage` → Interaction `admitInput` 后 `intervene()` 或 `followup()`；`submit()` 供显式更正；`route()`/`registerAdapter()` 是出站可信路由（Manager 当前记录 + `isCurrentSession`，每个分片前复核）；`policy()` 为唯一 Interaction 查询。不依赖 QQ SDK、Character、Interaction 或 Manager 包。
- QQ Official 已实际改用：入站 `deliverInbound` 只保留 QQ 协议（C2C 发送者、回复目标、正文组装、兜底提示、群历史、typing、等待本轮）；出站文本 Adapter 只保留回复目标检查、分片、发送与错误分类；显式更正、`/stop` 与出站 Interaction 绑定改用同一 `policy()`。删除了 QQ 内的 `getOrCreate`/`isCurrentSession`/原生输入创建、`manager.interactionPolicy`/`registerInteractionInput` 与另外两处重复的 Interaction 查询。
- Conversation Manager 未改动，仍是唯一 Session 路由权威；未新增 Manager、数据库、权限系统或持久状态。

**验收证据**：QQTK 新增 `conversation-io.test.mjs`（真实 Conversation Manager、不含 QQ 代码的合成第二平台）覆盖普通 Agent 收发、跨平台/账号/direct-group 隔离、冷恢复、自动轮换与显式重置后的迟到输出、Manager/接线关闭竞态、准入拒绝与 Owner-only 包装、伪造来源、入站去重、出站分片间复核与 Interaction；QQ 测试经 Gateway 自己的接线代码运行；关键校验经变异检查确认会被测试捕获。隔离 rc.3 探针确认已安装包从 Agent I/O 插件上下文取到原生 Interaction 服务、用 Host `dsh-llm` 创建原生输入，QQ 入站/出站经新接口各一次且重复推送/陌生人不产生输入。

**未覆盖**：Interaction 出站迁移（04，见 3.3）；Remote Ops 启动路由恢复与 Character Identity 准入仍直接调用 Manager（非 Agent 输入）；命令/问答/审批（05/06）；通知与历史提醒（07）；持久发送状态；真实第二平台（只有合成夹具）；真实 QQ 手机收件；部署与回滚演练（Character 部署计划会拒绝缺 `openConversation` 的 `dsh-agent-io`，但尚不能升级已安装的 test.3，部署前需补该步骤）。

### 3.3 Iteration 04：Interaction 出站迁移

**状态**：源码完成（Character Interaction `0.1.0-test.9` + QQTK 补丁；Agent I/O 仍为 `0.1.0-test.4`，公共接口不变），自动化测试与隔离 rc.3 Host 探针通过；已授权部署，真实 QQ/手机未验收。

**实现**：

- Interaction 只负责语义分泡、Hang-on、插话与回复节奏，只提交完整气泡：不再预览未定稿文本，不再使用 `openStream`；长回复在生成期间按与 settlement 一致的定稿点提前提交（保留一泡给开放尾部），工具调用前已结算的气泡在工具执行期间提交，其余在 settlement 后提交。
- QQ 桥接层把每个气泡、等待提示和工具/轮次错误提示都作为一条逻辑消息交给 `agentIO.sendMessage()` → QQ 文本 Adapter → Gateway Sender；稳定逻辑 ID `qq:<Session>:<Turn>:<策略实例>:<回复>.<气泡>:<kind>`；按原生输入 ID 选择回复目标（仍须属于该 Conversation）；被动回复额度与主动降级不变。
- 可靠性：Agent I/O 负责同 Conversation 顺序、逻辑 ID 去重、逐片复核访问配置与 Manager 当前 Session、取消（策略令牌与原生 Turn 的 `AbortSignal`）及诚实结果；只有 `sent` 计为确认，`not-sent`/`partial`/`unknown` 回报给 Interaction，不重发并扣留同一回复的后续气泡。
- 移除：Interaction 专属的 QQ SDK Stream 发送（`boundedStream`、Gateway Sender `openStream`）以及普通回复的 SDK 流式输出（`StreamingWriter`；`streaming` 配置项停用）。QQ 聊天输出不再有 `sendMarkdown` 直发路径；审批/问答/文件发送仍走 Gateway Sender（05/06）。
- 兼容：新 QQ 补丁配旧 Interaction（test.8）仍可工作（旧策略在无 `openStream` 时只用 `sendText`）；新 Interaction 配旧 QQ 补丁会绕过 I/O，因此两者须配套部署。

**验收证据**：Character Interaction 单元测试改为只提交完整气泡的语义（生成期间提前提交、无预览、取消信号、未确认气泡扣留、工具执行中/后的分泡）；QQTK 桥接测试覆盖开启/关闭 Interaction 均经 `sendMessage()`、稳定 ID 与重复提交、按输入回复目标、`/stop`/策略撤回/Turn 中止、部分失败/未知结果、轮换与撤权、诊断字段；SDK 审计以真实 Interaction + 桥接 + I/O + QQ 文本 Adapter + SDK MessageApi 覆盖限额、被动额度、提前提交、取消与轮换；关键保护经变异检查确认会被测试捕获；隔离 rc.3 探针确认真实 Agent/Interaction 的全部气泡、等待提示与 steer 回复都经已安装的 Agent I/O 发送。

**未覆盖**：气泡发送状态不持久（进程重启后不识别重复）；实机手机消息格式、分泡节奏与被动额度；审批/问答/通知（05–07）；部署（Agent I/O 已安装版本升级仍受部署保护限制，见 [STATUS](../STATUS.md)）。

## 4. 后续验收矩阵与停止条件

| 维度 | 必须证明 | 不可替代为通过的证据 |
| --- | --- | --- |
| 契约/信任 | direct/group、引用/附件/发送关联；多账号/相似 ID 不冲突；platformData 受控、伪造权限拒绝 | 只有字段存在；昵称相同；模型自报身份 |
| 入站去重 | 平台/Adapter/账号/消息范围内重复投递只触发一次 Agent 输入；不同范围相同 ID 互不抑制 | 仅按消息 ID 或文本去重 |
| 出站授权 | 发送时（而非入队时）复核目标、来源会话关系与授权；会话轮换/权限撤销/旧 Turn 失效阻止发送；历史提醒按自身规则 | 入队时检查一次；信任模型给出的 ID |
| 发送/气泡 | 同 Conversation 串行且关联可查；完整泡可在生成期间提交；取消抑制待发/迟到泡；已提交不可改/重发；未发送/已接受/未知/部分分片分别处理 | Token 已生成即已提交；所有泡一律等整轮 settlement；超时后盲重试；失败记为成功 |
| 工具正确性 | 工具成功/失败等真实结果；不依赖结果的完整泡可早发；原生执行/审批保持 | 对工具结果的推测；为早发中断真实工具 |
| 服务隔离 | HITL 回应验证/取消/超时/原生唯一权威；通知稳定地址、Outbox 去重、不变普通聊天输入 | 多 Adapter 各自全局包装；通知文本绕入 Agent |
| 持久数据 | principalId/conversationId/Session/Memory ACL/Schedule/QQ bindings/事件 ID 保留；unknown 不重放；单写入者、冷恢复/回滚保全新数据 | 仅进程健康；旧快照覆盖当前状态 |
| 平台与 UI | 各平台独立安装/依赖；真实 QQ 手机收件、回复目标、按钮/问答；Web/Desktop 原生行为独立检查 | Gateway ready、SDK/API 回执、模拟 Sender 或原生事件订阅 |

任一身份/ACL/路由不明、状态未知或恢复数据不一致时，不以回退到旧不安全路径掩盖问题；保留证据，阻止未经验证的切换。

## 5. 主要待讨论事项与来源

剩余讨论见 [决策](DECISIONS.md) 第 6 节：结果结构扩展、持久发送状态与恢复、跨服务排序与背压、具体 Package/Plugin 命名。迁移方式/SQL 和 QQ Personal 协议留后续专项。

现状来源：[STATUS](../STATUS.md)、[现有架构](../ARCHITECTURE.md)、[Interaction](../INTERACTION-POLICY.md)、[Worker](../WORKERS.md)，以及 [QQTK](https://github.com/EJYDOvO/harness-qq-toolkit-public) 的 Conversation Manager 与通道源码。旧 Library 的各 v0.7.8 文档为历史背景，旧部署许可、路径和测试数量不能沿用为新工作的验收。
