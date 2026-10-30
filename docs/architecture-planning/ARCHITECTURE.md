# DSH Character Agent：架构设计与现状 v0.8（工作稿）

> 更新：2026-10-30。GitHub 是后续文档维护的唯一主入口；旧 ChatGPT Library v0.7.8 仅为历史快照。
> 本文的目标章节均为**设计决定，尚未实现**，不是 test.23 的功能或现有 API。当前事实单列在第 1 节；本轮仅改文档，不进行开发、数据迁移或部署。

## 0. 阅读边界

Character 应用保持一个仓库；所有交互平台 Adapter 未来统一进入一个仓库，各平台单独 Package/安装，独立 SDK、配置和启停，避免安装无关平台依赖。**目标平台仓库尚未建立。** 中间层职责已决定，分包、分库及 DSH Plugin 数量仍待定；此前“五个通用插件/三仓库”等候选不能作为已批准施工方案。

普通 DSH Agent 未来应能通过通用基础层独立接 QQ 个人号，不要求安装 Character；这只是目标。当前 Character 仍为单可信 Owner 私聊，群聊关闭；概念契约支持 direct/group 不表示开放群聊、多用户或扩大权限。

## 1. 当前实现基线（事实，不是未来目标）

| 项目 | 已有实现 | 边界与验收状态 |
| --- | --- | --- |
| Character | `character-agent-v1` **test.23**；Character Core/Extras、Definition、Identity、Memory、Worker、可选 Inspector/Long Tasks | 仓库记载已授权部署，13 个 Preset 健康；当前角色入口为官方 QQ Bot，单 Owner 私聊 |
| DSH 运行时 | 验证基线 **DSH 0.2.1-rc.3 / Node.js 24.21.0 / Windows** | 继续复用原生 Agent、Session、Preset、Tools、Approval、Schedule、Worker Spawn；不另造运行时 |
| Conversation Manager | **`dsh-conversation-manager@0.1.0-test.2`**，源码在 QQTK `plugin-sources/` | 已独立 DSH Host Plugin；唯一当前 Conversation→原生 Session 路由，恢复、偏好、轮换及释放；第二平台仅合成夹具验证 |
| Interaction | **`dsh-interaction-policy@0.1.0-test.8`**，源码在 Character `packages/` | 已可选独立 Agent/Preset Plugin；中断、分泡、Hang-on、Worker 续轮等；QQTK 仍负责 Sender/回执接线 |
| QQ 官方适配 | QQTK test.23；Bot **0.5.2** / SDK **1.0.5** 的受审版本化补丁 | 单一 Gateway；接入/发送/审批/问答/媒体/命令/诊断混在 QQTK，不是统一跨平台库 |
| Memory | Character Memory Core/Tools、`memoryIdentity@1` 可信 Host 契约；SQLite Schema **3**、L1/L2/L3 与人格化模式 | 已支持非 Character 的 DSH Agent 选装；不等于在任意平台自动获得可信身份 |
| 其他可选能力 | Remote Ops、Memory Inspector、Long Tasks、Preset Manager | 已有独立模块/插件，不在本轮为了重构而重写 |
| 新平台 | QQ Personal / NapCat/OneBot 等 | **未实现、协议未定，未完成真实 QQ 小号测试** |

**test.23 的关键变化**：Worker 原生工具范围守卫与委派策略加强；Interaction test.8 将短闲聊改为趋向整泡、长结果继续按语义分泡，动态 Hang-on 默认 **4 秒起草 / 8 秒检查**，等待状态不占正文气泡预算，尾泡可完整预览；发送归属与判断/起草诊断增强。下一轮希望更自然的**短气泡闲聊**，只是讨论目标，**不是现有 test.8 行为**。

**证据边界**：仓库记录 Character 215 项单元、33 项安全审计、QQTK 55 项轻量与 6 项审批检查，以及若干 rc.3 Host 隔离探针；模型、Sender 等多为合成替身。**不能把 Gateway ready、API 回执或自动测试等同真实 QQ 手机送达与按钮验收。** `--workers --manager` 在 55 秒加载时限内未完成；真实手机流式撤回残留等仍待验收。具体以 `STATUS.md` 为准。


**源码核对**：

- [Interaction policy](../../packages/interaction-policy/policy.mjs) 的 `bind(transport)` 要求 `sendText`，允许可选 `openStream`；[原生事件装配](../../packages/interaction-policy/index.mjs) 订阅 Agent/Session 事件。它已处理部分渐进分泡，但不是新的公共 I/O v1。
- [QQTK bootstrap](https://github.com/EJYDOvO/harness-qq-toolkit-public/blob/2e8fd2299e8fb2358ac1c4e04d5b287dae1e6181/maintenance/qqbot-src/dist/gateway/bootstrap.js) 的 `createInteractionOutbound` 完成 `policy.bind`、回复目标、`sendText` 和条件 `openStream` 接线，仍包含 SDK stream。迁移需兼容/隔离这些旧路径，不能把它们提升为新公共契约。
- QQTK 的 [QuestionChannel](https://github.com/EJYDOvO/harness-qq-toolkit-public/blob/2e8fd2299e8fb2358ac1c4e04d5b287dae1e6181/maintenance/qqbot-src/dist/features/question-channel.js) 仍包装共享 `userQuestions.ask()`；多平台不能分别照搬包装。
- [Character Identity](../../packages/character-identity/index.mjs) 同时管理 Owner/当前路由门禁、历史提醒绑定、QQ bindings 和 SQLite Outbox；[Character QQ lifecycle](../../packages/character-qq-adapter/lifecycle.mjs) 仍包装 `qqRemoteOps.attach`。这些耦合是迁移依据，尚未抽离。

## 2. 职责分层与组织边界（设计决定，尚未实现）

| 层/横切能力 | 职责 | 必需/可选及组织边界 |
| --- | --- | --- |
| 上层 Character | Persona、角色 Identity/Memory 策略、Worker 规则、应用组合 | 一个现有仓库；普通 Agent 不必安装 |
| L1 基础通信 | Messaging/薄 Unified Agent I/O；复用已有独立 Conversation Manager | 外部即时聊天的基础；不另造会话运行时 |
| L2 Interaction | 输入插话处理；可选出站气泡/呈现与 Hang-on 策略 | 可选，关闭则透传；两类职责分别验证 |
| L3 可选服务 | HITL Bridge、Notification、Commands、高级 Media | 业务按需；是否分别成为插件尚未定 |
| Identity（横切） | 可信证据交接、平台账号隔离、Host 授权与 Character Owner/ACL 边界 | 安全校验不可因未装可选服务而省略 |
| Diagnostics（横切） | 入站/Turn/气泡/发送关联、成功/失败/未知及脱敏诊断 | 不预设独立运行服务 |
| 下层 Platform Adapters | 平台真实收发、协议、附件传输、限速/分片/回复目标 | 一个未来统一仓库，各平台独立 Package/安装 |

这里的 L1/L2/L3 是**通信职责层**，与现有 Memory 的 L1/L2/L3 无关，也不等于仓库或插件数量。Repository 是协作边界，Package 是版本/安装边界，DSH Plugin 是 Host/Agent/Preset 装配入口；可移植普通模块无需强制成为插件。已有 Conversation Manager 和 Interaction 的独立形态是现状，是否迁仓/合包另议。

## 3. D1：即时聊天通用数据契约（设计决定，尚未实现）

第一版以 QQ 官方 Bot 和 QQ 个人号聊天场景为基准，只覆盖即时聊天的 direct/group、消息、引用、文字、基础附件与发送关联。先验证两种 QQ 接入在同一聊天模型下的适配，不提前设计 Twitter/B站评论、帖子、动态或主动社交流水线；其他行为以后通过额外插件或契约扩展支持。

以下是**待实现的概念结构，不是现有 API、Schema 或可直接调用示例**；必填性、类型细节、版本和 Sender 返回值仍需后续契约设计：

```text
{
  platform,
  adapter,
  accountId,
  conversation: { id, type: direct | group },
  message: { id, text, attachments, replyTo },
  sender: { id, displayName },
  timestamp,
  platformData
}
```

`accountId` 表达 Adapter 所接入的账号/应用范围，`sender.id` 表达该范围下的实际发言主体，不能混为同一 ID。`replyTo`、基础附件描述和发送关联需要能回到正确平台消息/目标，具体结构仍待设计。平台协议分片可把一条逻辑消息映射为多个物理发送，关联和失败必须可追踪，不要求模型处理 QQ 配额。

平台原始专有字段保留在**受控可信边界**；`platformData` 不是把完整平台事件、令牌或权限证据默认塞给模型的通道。平台入口校验真实来源，Host 校验可信性并负责授权；模型可见投影与安全证据分离。任何不可信 Adapter 提交的数据都不能自行证明 Owner 或获取 Host 权限。

身份/Conversation 键需带平台、Adapter/接入范围、账号和主体/会话的命名空间，使用无歧义编码避免相似 ID、分隔符或多账号冲突；具体编码与兼容映射待设计，不用这个概念结构静默重算已有 `principalId` / `conversationId`。以后按实际平台需求扩展字段，不先穷举所有社交行为。

## 4. D2：薄 Unified Agent I/O 与原生权威（设计决定，尚未实现）

```text
外部聊天出站：
DSH Agent → Interaction（启用则加工，未启用则透传）
          → 薄 Unified Agent I/O → 对应 Platform Adapter → QQ/其他外部聊天平台

外部聊天入站：
QQ/其他外部聊天平台 → 对应 Platform Adapter → 薄 Unified Agent I/O
                    → Interaction（启用时处理运行中插话）→ DSH Agent

原生会话与路由：
DSH 原生 Agent / Session ← 已有独立 Conversation Manager 的唯一当前路由
Host 保留 Tools / Approval / Schedule 和身份授权权威
```

I/O 只负责标准消息交接、路由与发送；Conversation Manager 继续维护 Conversation→原生 Session 的唯一当前路由、恢复和轮换，不被 I/O 替换。平台 Adapter 负责真实收发、协议校验、平台限速、分片、上传、回复目标及私有能力兼容。Host 权限和 Owner ACL 不下放给不可信 Adapter。

接入本聊天流水线的外部平台聊天事件，按普通实时会话处理；运行中输入反向经 I/O 交 Interaction 使用原生 cancel/steer/followup 等机制处理。输入插话调度与出站气泡呈现是不同职责，不能因关闭分泡就丢弃输入正确性。审批回应、通知、命令和专门服务事件由已验证的业务路由处理，不自动当普通用户聊天输入。

复用 DSH 原生 Agent/Session/Approval/Tools/Schedule 和独立 Conversation Manager，不新建 Runtime、Session、消息总线或第二套审批/调度系统。不直接修改官方 DSH 发布文件及内置 Bundle。

## 5. D3：账号身份默认隔离（设计决定，尚未实现）

默认每个平台、每个实际账号身份独立；不按昵称、相似 ID 或模型推断自动共享用户主体、Session、Memory 或权限。群会话本身也不能替代具体发送者身份。平台证据进入 Host 后仍需通过对应授权策略，恢复 Session 不代表恢复完整身份。

管理员身份授权声明、显式跨平台账号关联及授予额外权限均是后续可选设计，暂不实施。**账号关联≠授权**；即使未来确认同一人，也不自动合并会话、记忆 ACL 或工具授权。Character Owner、`memoryIdentity@1`、Worker/工具权限和历史根提醒门禁继续有效。

## 6. D4：统一 Sender、完整气泡与原生窗口（设计决定，尚未实现）

最终出站链路固定为 **DSH Agent → Interaction（启用则加工，未启用则透传）→ Unified Agent I/O → Platform Adapter**。所有外部通道共用 I/O Sender（Channel Sender 是同一发送职责），不另立 Interaction 专用 IO；HITL/Notification 等服务也复用发送通道，但保留各自业务准入和状态所有权。

### 6.1 I/O v1 只发送已确定消息

公共发送契约**只提供 `sendMessage()`**，不提供 `updateMessage()` / `openStream()` / streaming-ability flag，不要求“支持或不支持流式”的公共分类。Agent 内部 Token Streaming 与 DSH 原生窗口 Streaming 保留；外部平台聊天消息不做原地流式更新。

QQ 官方 Bot 当前 SDK stream、test.8 `sendText` / 可选 `openStream` 是现状和迁移兼容/隔离问题，不是新目标能力。此次不修改 SDK、旧绑定或运行配置。禁用 Interaction 时，默认等原生回复完成发一条逻辑消息；Adapter 仍可按平台硬性限制分片并记录关联。

### 6.2 生成过程中可以逐泡提交

Interaction **允许在 Agent 仍生成时**，对可靠、语义完整、可独立成立且不依赖未完成工具结果的气泡，逐条提前调用 `sendMessage()`。不必等整个回复或整个 Turn settlement 才能发所有泡；这属于多个已确定消息的增量提交。

必须区分“模型已经生成的片段”和“Interaction 已确认可以对外提交的完整气泡”。未完成、可被重试改写或仍是推测的文本不能自动被视为已提交；工具成功/失败必须等真实工具结果确认，不能先宣告。不能为早发破坏 DSH 原生执行、工具或审批正确性；工具期间可发与未完成结果无关的可靠完整内容。

- 每条已提交消息只发送一次、不可修改；不把累计 Token 片段重复发送为新泡，也不在 settlement 重发已经提交的正文。
- 取消/插话时停止待发送气泡，阻止迟到的旧 Turn/旧 attempt 内容继续外发；不声称撤回已发泡或取消已经发生的副作用。
- 同一 Conversation 按序串行发送；记录每条气泡的来源 Turn/输入、发送关联及成功/失败，避免跨 Turn 混泡和重复。
- 发送失败或状态未知时避免盲目重放；重试必须依据可证明的状态。超时不证明未发送，API 回执不证明手机已收件。
- “确认可提交”“Sender 接受/确认”“平台回执”“手机实际收件”不是同一事实。返回/错误语义、确认点、排队取消与重试细则仍待讨论，不在此定成状态机或新 API。

### 6.3 DSH 原生窗口保留原生链路

DSH 原生 Web/Desktop 聊天窗继续用 DSH 原生消息 UI、Session、渲染与 Token Streaming，**不强制绕 Unified I/O 或 Platform Adapter**。Interaction 对原生窗口的出站分泡/Hang-on 目前尚未完整适配；已订阅原生事件、能处理插话或 QQ 路径有分泡，均不能证明原生窗口出站呈现已支持。后续需要单独评估和验收。

## 7. D5：L3 可选服务（设计决定，尚未实现）

| 服务 | 目标职责与权威边界 | 仍待定 |
| --- | --- | --- |
| HITL Bridge | HITL = Human-in-the-Loop，人工介入；展示原生 Approval / `userQuestions.ask`，路由已验证回应，处理取消/超时；共享发送通道，原生服务唯一裁决 | 建议名称；是否独立插件、Host 集成方式 |
| Notification | 复用 Channel Sender、稳定 Conversation 目的地与持久 Outbox；去重、恢复和明确事件投递；复用原生 Schedule，不重造调度 | 是否独立插件、持久状态迁移归属 |
| Commands | 命令入口解析/分发，Host 执行授权；不让平台字段授予能力 | 哪些内置、哪些可选 |
| Media | 基础消息附件属于 D1/L1；高级图片/音频/视频等工具按需，平台传输/路径权限留 Adapter/Host | 哪些内置、哪些独立服务/工具 |

HITL 是统一术语；HITL Bridge 不是已发布插件。不能让多个平台分别猴子补丁共享的全局问答/审批服务；可信回应只能关联到原生待决请求，由 Host 验证身份、目标和有效期。HITL、Notification 是否各自独立插件尚未决定。通知是服务输出，不作为普通聊天输入；审批/问答回应也不自动产生普通聊天 Turn。

## 8. D6：持久数据与受控迁移（设计决定，尚未实现）

保留旧 `principalId`、`conversationId`、原生 Session/历史链、Memory ACL/治理状态、Schedule 原 Session 归属、Character Identity QQ bindings（含 `qq_bindings`）、Outbox 事件 ID、去重与 `unknown` 不重放语义。新字段和接口不能静默改变它们，也不能让旧根重新得到完整 Owner/Memory/工具权限。

每类持久状态只有一个权威写入者；现有数据所在地不等于未来分包结论。升级前盘点与审计、停机一致备份、映射/ACL 验证、隔离恢复与回滚验证，然后受控切换；废止旧写入口，不长期双轨。回滚保全切换后新增的 Session、Memory 和通知记录，不以旧快照直接覆盖。具体迁移方式、SQL、Schema 和切换脚本留后续设计/开发，此次不提供或执行。

## 9. 剩余待决与下一步

主要待讨论：

1. Sender 返回/错误语义：何时能证明接受/成功/拒绝/未知，物理分片如何关联，哪些错误可以安全重试。
2. 已提交气泡的确认与队列行为：提交边界、取消竞态、旧 Turn/attempt 失效、崩溃恢复、跨业务发送排序/背压；不预设 exactly-once 传输保证。
3. 中间 Package/Plugin/仓库分组：HITL 与 Notification 是否独立、Commands/Media 内置范围；保留既有模块的生命周期和唯一状态所有者。

QQ Personal 协议、管理员授权声明、跨平台关联及非即时聊天扩展留后续专项。方向已确认并不等于这些细节已定稿。依次完成契约/队列讨论、模块与状态归属、迁移验收设计，再进入另行授权的开发。详见 [决策](DECISIONS.md)、[路线图](IMPLEMENTATION_ROADMAP.md)、[模块计划](MODULE_IMPLEMENTATION_PLAN.md)。
