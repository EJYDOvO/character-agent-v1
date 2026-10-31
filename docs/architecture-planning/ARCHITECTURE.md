# DSH Character Agent：架构设计与现状 v0.8（工作稿）

> 更新：2026-10-30（增补中间层模块组织、出入站可靠性与渐进式重构，对应 ADR-057–062）。GitHub 是后续文档维护的唯一主入口；旧 ChatGPT Library v0.7.8 仅为历史快照。
> 本文的目标章节均为**设计决定，尚未实现**，不是 test.23 的功能或现有 API。当前事实单列在第 1 节。开发按 [路线图](IMPLEMENTATION_ROADMAP.md) 的功能切片逐轮进行，文档本身不表示实现、迁移或部署已完成。

## 0. 阅读边界

Character 应用保持一个仓库；所有交互平台 Adapter 未来统一进入一个仓库，各平台单独 Package/安装，独立 SDK、配置和启停，避免安装无关平台依赖。**目标平台仓库尚未建立，切片迭代期间不创建。** 中间层的模块组织已由 ADR-057 决定（第 2 节）；具体 Package 名称和是否迁仓随各切片实现确定。此前“五个通用插件/三仓库”等候选不能作为已批准施工方案。

普通 DSH Agent 未来应能通过通用基础层独立接 QQ 个人号，不要求安装 Character；这只是目标。当前 Character 仍为单可信 Owner 私聊，群聊关闭；概念契约支持 direct/group 不表示开放群聊、多用户或扩大权限。

## 1. 当前实现基线（事实，不是未来目标）

| 项目 | 已有实现 | 边界与验收状态 |
| --- | --- | --- |
| Character | `character-agent-v1` **test.23**；Character Core/Extras、Definition、Identity、Memory、Worker、可选 Inspector/Long Tasks | 仓库记载已授权部署，13 个 Preset 健康；当前角色入口为官方 QQ Bot，单 Owner 私聊 |
| DSH 运行时 | 验证基线 **DSH 0.2.1-rc.3 / Node.js 24.21.0 / Windows** | 继续复用原生 Agent、Session、Preset、Tools、Approval、Schedule、Worker Spawn；不另造运行时 |
| Conversation Manager | **`dsh-conversation-manager@0.1.0-test.2`**，源码在 QQTK `plugin-sources/` | 已独立 DSH Host Plugin；唯一当前 Conversation→原生 Session 路由，恢复、偏好、轮换及释放；第二平台仅合成夹具验证 |
| Interaction | **`dsh-interaction-policy@0.1.0-test.8`**，源码在 Character `packages/` | 已可选独立 Agent/Preset Plugin；中断、分泡、Hang-on、Worker 续轮等；QQTK 仍负责 Sender/回执接线 |
| QQ 官方适配 | 运行实例为 QQTK Iteration 05 补丁；Bot **0.5.2** / SDK **1.0.5** 的受审版本化补丁 | 单一 Gateway；聊天收发（Iteration 01–04）与命令/基础媒体（Iteration 05）已经 Agent I/O，源码中审批/问答（Iteration 06，未部署）也已迁移到 Agent I/O HITL Bridge；诊断仍在 QQTK，不是统一跨平台库 |
| Memory | Character Memory Core/Tools、`memoryIdentity@1` 可信 Host 契约；SQLite Schema **3**、L1/L2/L3 与人格化模式 | 已支持非 Character 的 DSH Agent 选装；不等于在任意平台自动获得可信身份 |
| 其他可选能力 | Remote Ops、Memory Inspector、Long Tasks、Preset Manager | 已有独立模块/插件，不在本轮为了重构而重写 |
| 新平台 | QQ Personal / NapCat/OneBot 等 | **未实现、协议未定，未完成真实 QQ 小号测试** |

**test.23 的关键变化**：Worker 原生工具范围守卫与委派策略加强；Interaction test.8 将短闲聊改为趋向整泡、长结果继续按语义分泡，动态 Hang-on 默认 **4 秒起草 / 8 秒检查**，等待状态不占正文气泡预算，尾泡可完整预览；发送归属与判断/起草诊断增强。下一轮希望更自然的**短气泡闲聊**，只是讨论目标，**不是现有 test.8 行为**。

**证据边界**：仓库记录 Character 215 项单元、33 项安全审计、QQTK 55 项轻量与 6 项审批检查，以及若干 rc.3 Host 隔离探针；模型、Sender 等多为合成替身。**不能把 Gateway ready、API 回执或自动测试等同真实 QQ 手机送达与按钮验收。** `--workers --manager` 在 55 秒加载时限内未完成；真实手机流式撤回残留等仍待验收。具体以 `STATUS.md` 为准。


**源码核对**：

- [Interaction policy](../../packages/interaction-policy/policy.mjs) 的 `bind(transport)` 要求 `sendText`（源码 test.9 起只提交完整气泡，不再使用 `openStream`）；[原生事件装配](../../packages/interaction-policy/index.mjs) 订阅 Agent/Session 事件。它已处理部分渐进分泡，但不是新的公共 I/O v1。
- [QQTK bootstrap](https://github.com/EJYDOvO/harness-qq-toolkit-public/blob/2e8fd2299e8fb2358ac1c4e04d5b287dae1e6181/maintenance/qqbot-src/dist/gateway/bootstrap.js) 的 `createInteractionOutbound` 完成 `policy.bind`、回复目标、`sendText` 和条件 `openStream` 接线，仍包含 SDK stream。迁移需兼容/隔离这些旧路径，不能把它们提升为新公共契约。
- （Iteration 06 起已由 Agent I/O HITL Bridge 经原生 `user-questions/request` waterfall 取代。）QQTK 的 [QuestionChannel](https://github.com/EJYDOvO/harness-qq-toolkit-public/blob/2e8fd2299e8fb2358ac1c4e04d5b287dae1e6181/maintenance/qqbot-src/dist/features/question-channel.js) 仍包装共享 `userQuestions.ask()`；多平台不能分别照搬包装。
- [Character Identity](../../packages/character-identity/index.mjs) 同时管理 Owner/当前路由门禁、历史提醒绑定、QQ bindings 和 SQLite Outbox；[Character QQ lifecycle](../../packages/character-qq-adapter/lifecycle.mjs) 仍包装 `qqRemoteOps.attach`。这些耦合是迁移依据，尚未抽离。

## 2. 职责分层与模块组织（设计决定，尚未实现）

| 层/横切能力 | 模块 | 职责与组织边界 |
| --- | --- | --- |
| 上层 Character | Character 应用 | Persona、角色 Identity/Memory 策略、Worker 规则、应用组合；一个现有仓库，普通 Agent 不必安装 |
| L1 基础通信 | Unified Agent I/O | 统一聊天消息交接与发送；公共出站只有 `sendMessage()` |
| L1 | Conversation Manager | 保留已有独立 Host Plugin；Conversation → DSH Session 唯一当前路由、恢复、轮换、偏好 |
| L1 | Commands | 默认作为 I/O 内部的解析/分发模块；执行授权由 Host/业务插件负责 |
| L1 | 基础 Media | 消息契约中的附件描述与平台上传/下载；高级媒体工具（看图、发文件等）保持为现有可选工具，不另立 L3 服务 |
| L2 可选 | Interaction | 保留独立 Interaction Policy Plugin：输入插话、回复节奏、完整气泡分割、Hang-on。启用时加工 Agent 回复，关闭时透传；外部消息最终都经 I/O Sender 发送，不创建 Interaction 专属 I/O |
| L3 可选 | HITL Bridge | 建议独立可选 Plugin；只桥接原生 Approval 与 `userQuestions.ask()` 的展示及可信回应，不创建第二个审批权威 |
| L3 可选 | Notification | 建议独立可选 Plugin；复用 I/O 发送，保留稳定接收目标、持久 Outbox、去重状态与原生 Schedule |
| Identity（横切） | 各模块分担 | Platform Adapter 验证实际平台连接与身份来源；Host 校验可信来源并执行准入、工具及会话权限；Character Identity 保留 Owner、Memory ACL、Worker、历史 Session 的专属安全策略。不建立取代现有身份系统的大型 Identity Plugin；默认各平台实际账号独立 |
| Diagnostics（横切） | 各模块分担 | 统一事件关联字段与脱敏要求；各模块负责自己产生的事件；暂不建独立日志服务或强制安装的 Diagnostics Plugin |
| 下层 Platform Adapters | 每平台一个 Package | 平台真实收发、协议、附件传输、限速/分片/回复目标；未来统一平台仓库 |

**安装原则**：Conversation Manager、Unified I/O、Interaction、HITL、Notification 能按职责独立装配和启停。个人部署可以提供“全部默认安装/启用”的组合，但不能因此造成模块间不必要的强依赖（例如 I/O 不依赖 Character 或 Interaction，Interaction 关闭时普通回复仍可发送）。仓库、Package、DSH Plugin 和普通 JS Module 不需要一一对应。

这里的 L1/L2/L3 是**通信职责层**，与现有 Memory 的 L1/L2/L3 无关。Repository 是协作边界，Package 是版本/安装边界，DSH Plugin 是 Host/Agent/Preset 装配入口；可移植普通模块无需强制成为插件。已有 Conversation Manager 和 Interaction 的独立形态继续保留，是否迁仓/合包另议。

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

QQ 官方 Bot 当前 SDK stream、test.8 `sendText` / 可选 `openStream` 是现状和迁移兼容/隔离问题，不是新目标能力，在 Interaction 切片（Iteration 04）统一改用 `sendMessage()`，此前保持现有用户可见行为，不删除其所需 SDK 代码。禁用 Interaction 时，默认等原生回复完成发一条逻辑消息；Adapter 仍可按平台硬性限制分片并记录关联。

### 6.2 生成过程中可以逐泡提交

Interaction **允许在 Agent 仍生成时**，对可靠、语义完整、可独立成立且不依赖未完成工具结果的气泡，逐条提前调用 `sendMessage()`。不必等整个回复或整个 Turn settlement 才能发所有泡；这属于多个已确定消息的增量提交。

必须区分“模型已经生成的片段”和“Interaction 已确认可以对外提交的完整气泡”。未完成、可被重试改写或仍是推测的文本不能自动被视为已提交；工具成功/失败必须等真实工具结果确认，不能先宣告。不能为早发破坏 DSH 原生执行、工具或审批正确性；工具期间可发与未完成结果无关的可靠完整内容。

- 每条已提交消息只发送一次、不可修改；不把累计 Token 片段重复发送为新泡，也不在 settlement 重发已经提交的正文。
- 取消/插话时停止待发送气泡，阻止迟到的旧 Turn/旧 attempt 内容继续外发；不声称撤回已发泡或取消已经发生的副作用。
- 同一 Conversation 按序串行发送；记录每条气泡的来源 Turn/输入、发送关联及成功/失败，避免跨 Turn 混泡和重复。
- 发送失败或状态未知时避免盲目重放；重试必须依据可证明的状态。超时不证明未发送，API 回执不证明手机已收件。
- “确认可提交”“Sender 接受/确认”“平台回执”“手机实际收件”不是同一事实。发送语义、串行与取消原则见 6.4；Interaction 的可提交确认点在 Iteration 04 设计。

### 6.3 DSH 原生窗口保留原生链路

DSH 原生 Web/Desktop 聊天窗继续用 DSH 原生消息 UI、Session、渲染与 Token Streaming，**不强制绕 Unified I/O 或 Platform Adapter**。Interaction 对原生窗口的出站分泡/Hang-on 目前尚未完整适配；已订阅原生事件、能处理插话或 QQ 路径有分泡，均不能证明原生窗口出站呈现已支持。后续需要单独评估和验收。

### 6.4 出入站可靠性（ADR-058–061）

| 主题 | 决定 |
| --- | --- |
| 入站去重 | 同一平台范围内重复投递的外部消息不重复触发 Agent 输入；去重键保留平台、Adapter、接入账号及平台消息的完整范围，不同账号/平台的相同消息 ID 互不抑制；状态有界，并说明重启后的保证范围 |
| 出站授权有效性 | 实际发送前复核有效目标、来源会话与目标 Conversation 的关系及适用授权；权限撤销、会话轮换、旧 Turn 失效不能导致错误投递。合法历史提醒按其自身授权规则检查，不要求原始 Session 仍是当前主聊天 Session，但规则须由对应模块显式提供 |
| 发送语义 | 一条逻辑消息不因 settlement、模型重试或内部队列重复生成有效发送任务；区分“API 前未发送/被拒”“平台已接受”“可能已发生但未知”，部分分片成功单独表达；不保证物理 exactly-once，未知禁止盲目重发，失败不伪装成功；诊断不写凭据、原始身份、正文 |
| 串行与取消 | 同一 Conversation 按序发送，不同 Conversation 不被全局串行阻塞，队列与并发有界；取消/过期 Turn 不继续提交待发内容，多分片在分片之间复核；已进入平台 API 的调用不假定可撤销 |

这些规则是从 Iteration 01 起逐步实现的门禁：每个切片只对自己迁移的路径声明满足，跨 Interaction/HITL/Notification 的统一排序与背压在对应切片完成前不宣称已保证。Iteration 01 只对“未绑定 Interaction 的 QQ 普通文本出站”满足出站授权有效性、发送语义、串行与取消（稳定 ID 来自原生 Session ID + 事件 seq；进程内去重不跨重启）；入站去重属 Iteration 02。

## 7. D5：L3 可选服务与相关 L1 能力（设计决定，尚未实现）

| 服务 | 目标职责与权威边界 | 仍待定 |
| --- | --- | --- |
| HITL Bridge | HITL = Human-in-the-Loop，人工介入；展示原生 Approval / `userQuestions.ask`，路由已验证回应，处理取消/超时；共享 I/O Sender，原生服务唯一裁决 | Iteration 06 源码（未部署）：Agent I/O 包内可选模块 `openHITL()`，经原生 waterfall 统一接入，提示与签发按钮经 `sendMessage()`；QQ 原通道已删除 |
| Notification | 复用 I/O Sender、稳定 Conversation 目的地与持久 Outbox；去重、恢复和明确事件投递；复用原生 Schedule，不重造调度 | 建议独立可选 Plugin（ADR-057）；持久状态归属与切换在 Iteration 07 设计 |
| Commands（L1） | 默认为 I/O 内部的命令入口解析/分发，Host 执行授权；不让平台字段授予能力 | Iteration 05（已于 2026-10-31 授权部署）：`openCommands()` 路由；QQ `/stop`、`/bot-*`、会话命令与 Remote Ops `/ops` 已迁移 |
| Media（L1 基础/可选工具） | 基础消息附件属于 D1/L1；高级图片/音频/视频等工具保持现有可选工具，平台传输/路径权限留 Adapter/Host | Iteration 05（已于 2026-10-31 授权部署）：附件描述（可信资源与模型可见内容分开），QQ 入站附件/引用与 `qqbot_send_file` 已迁移；视觉理解未改 |

HITL 是统一术语；HITL Bridge 是 Agent I/O 包内的可选模块（Iteration 06 源码），不是独立插件。不能让多个平台分别猴子补丁共享的全局问答/审批服务；可信回应只能关联到原生待决请求，由 Host 验证身份、目标和有效期。Commands 与基础 Media 按 ADR-057 归入 L1，表中保留以说明与 L3 的分工。通知是服务输出，不作为普通聊天输入；审批/问答回应也不自动产生普通聊天 Turn。

## 8. D6：持久数据与受控迁移（设计决定，尚未实现）

保留旧 `principalId`、`conversationId`、原生 Session/历史链、Memory ACL/治理状态、Schedule 原 Session 归属、Character Identity QQ bindings（含 `qq_bindings`）、Outbox 事件 ID、去重与 `unknown` 不重放语义。新字段和接口不能静默改变它们，也不能让旧根重新得到完整 Owner/Memory/工具权限。

每类持久状态只有一个权威写入者；现有数据所在地不等于未来分包结论。升级前盘点与审计、停机一致备份、映射/ACL 验证、隔离恢复与回滚验证，然后受控切换；废止旧写入口，不长期双轨。回滚保全切换后新增的 Session、Memory 和通知记录，不以旧快照直接覆盖。具体迁移方式、SQL、Schema 和切换脚本留后续设计/开发，此次不提供或执行。

## 9. 剩余待决与下一步

已由本次决定收敛：中间层模块组织（ADR-057）、发送语义与串行/取消原则（ADR-060/061）、入站去重与出站授权有效性（ADR-058/059）、开发方式改为渐进式重构（ADR-062）。仍待讨论：

1. 结果结构在附件、引用、Interaction 确认点接入后的扩展（Iteration 04/05 复核）。
2. 逐泡发送状态是否持久化、崩溃恢复，以及与 Notification Outbox 的边界；不预设 exactly-once 传输保证。
3. 聊天、HITL、Notification 共用 Sender 时的跨服务排序与背压。
4. 具体 Package/Plugin 命名、是否迁仓。

QQ Personal 协议、管理员授权声明、跨平台关联及非即时聊天扩展留后续专项。Iteration 01/02（普通文本出站、普通聊天入站）已配套 test.24 授权部署；Iteration 03（Conversation Manager 统一 I/O 接线，`dsh-agent-io` 的 `openConversation()`）源码完成、未部署，见 [路线图](IMPLEMENTATION_ROADMAP.md) 3.2；Iteration 04（Interaction 出站迁移，全部 QQ 聊天气泡经 `sendMessage()`）源码完成、未部署，见 3.3；下一步为 Iteration 05。详见 [决策](DECISIONS.md)、[模块计划](MODULE_IMPLEMENTATION_PLAN.md)。
