# DSH Character Agent：模块边界与后续实施计划 v0.8

> 更新：2026-10-30（按 ADR-057 定模块组织，补入出入站可靠性要求与 Iteration 01 模块边界）。GitHub 是后续文档维护的唯一主入口；旧 ChatGPT Library v0.7.8 仅为历史快照。
> 目标接口与迁移均为**设计决定，尚未实现**，按 [路线图](IMPLEMENTATION_ROADMAP.md) 的功能切片逐轮实施。以下是实施依据，不是 test.23 API 清单。

## 1. 分层与安装边界

Character 应用保留一个仓库；全部交互平台 Adapter 统一进入一个尚未建立的目标仓库，各平台单独 Package/安装、配置/启停和依赖。中间按 ADR-057 组织：

- **L1 基础通信**：Unified Agent I/O（统一交接与发送）；已有独立 Conversation Manager（唯一 Conversation → Session 路由）；Commands（默认为 I/O 内部解析/分发模块）；基础 Media（消息契约附件描述与平台适配）。
- **L2 可选**：Interaction（保留独立 Plugin，启用加工、关闭透传，不另设 I/O）。
- **L3 可选**：HITL Bridge、Notification（均建议独立可选 Plugin）。
- **横切**：Identity 由 Adapter（平台来源）、Host（可信校验与权限）、Character Identity（Owner/Memory ACL/Worker/历史 Session）分担，不建大型 Identity Plugin；Diagnostics 统一关联字段与脱敏要求，各模块负责自己的事件，不建独立日志服务。

上述模块应能按职责独立装配和启停；个人部署可提供全部默认启用的组合，但不能产生不必要的强依赖。Repository、Package、DSH Plugin 和可移植普通模块是不同边界，不需要一一对应。通信 L1/L2/L3 与 Memory 分层无关。HITL = Human-in-the-Loop（人工介入）。

## 2. 当前实现映射与目标职责

本表“当前”来自已核对的 Character/QQTK 源码；“目标”均尚未完成，不因某功能目前混在一个文件就确定未来分包。

| 层/模块 | 当前实现事实 | 目标职责与迁移边界 |
| --- | --- | --- |
| Character | Core/Extras；Identity、Memory、Persona、Worker；QQ lifecycle 包装 qqRemoteOps.attach | 保留角色组合/Owner/Memory 策略；不直接承担通用 QQ SDK 适配 |
| L1 Unified Agent I/O | QQTK bootstrap 的 createInteractionOutbound、transport/inbound、reply-target 等；Iteration 01 开始抽离出站 | 标准交接/路由/发送；只公开 sendMessage()；与平台协议分离；Commands 为其内部模块 |
| L1 Conversation Manager | QQTK plugin-sources 独立 Host Plugin test.2；QQTK SessionManager 已为薄适配 | 继续唯一当前 Conversation→原生 Session 路由、恢复/轮换/偏好；不授予 Character/Memory 权限，不重写 |
| L2 Interaction | Character packages/interaction-policy，独立可选 test.8；原生事件、judge、cancel/steer/followup；bind sendText / 可选 openStream | 输入插话与出站呈现分责；共用 I/O Sender；完整泡可生成中提交，未启用透传；不另设 IO |
| Identity 横切 | Character identity/index/boundary/bindings/schedule，memoryIdentity@1、Owner/历史根保护 | 可信平台证据交接与 Host 授权分离，默认平台实际账号独立；不自动合并或重算旧身份 |
| L3 HITL Bridge | QQTK ApprovalChannel/QuestionChannel；后者包装全局 userQuestions.ask；尚无独立通用桥 | 只展示/路由原生请求与已验证回应、取消/超时；原生唯一权威；禁止多 Adapter 分别猴子补丁全局服务 |
| L3 Notification | Character Identity SQLite Outbox/通知泵；Remote Ops/Long Tasks 复用通知 | 共用 Channel Sender、稳定 Conversation、持久 Outbox、原生 Schedule；唯一写入者，不当聊天输入 |
| L1 Commands（I/O 内部） | QQTK middleware slash commands、Remote Ops /ops；部分业务已有插件 | 命令入口解析/分发与 Host 授权分离；Iteration 05 盘点命令集 |
| L1 基础 Media / 可选媒体工具 | QQTK 附件解析、图片/语音与 send-file-tool | 基础附件归消息契约/L1；高级媒体工具保持现有可选工具，不另立 L3 服务；平台上传/协议及 Host 路径权限各自负责 |
| Diagnostics 横切 | Interaction trace、QQTK createDeliveryRecorder | 关联输入/Turn/attempt/气泡/平台发送、状态/时延，脱敏且不泄露安全证据；不预设独立服务 |
| Platform Adapters | 当前 QQ Official/QQTK test.23、Bot/SDK 版本化补丁与 SDK stream | 真实收发、协议限速/分片/回复目标与附件传输；各平台独立 Package。QQ Personal 未实现 |

不重造 Memory Core/Tools、Inspector、Long Tasks、Remote Ops、Preset Manager，不因重分层复制已有能力。当前版本及部署/验收以 [STATUS](../STATUS.md) 为准，表中职责不是新的插件发布列表。

## 3. D1–D3：交接、路由与身份契约（设计决定，尚未实现）

### D1 消息概念结构

首版只以 QQ 官方 Bot/个人号的即时聊天为基准，考虑：

```text
platform, adapter, accountId,
conversation { id, type: direct | group },
message { id, text, attachments, replyTo },
sender { id, displayName },
timestamp, platformData
```

这不是现有 API 或 Schema；字段类型/必填性、引用/附件细节及发送关联待细化。可逐步扩展实际平台字段，不提前做 Twitter/B站评论、帖子、动态。direct/group 契约不改变当前单 Owner 私聊和群聊禁用策略。

`accountId` 是接入账号/应用范围，发送者为 `sender.id`；按平台、Adapter/接入范围、账号和 Conversation/主体建立无歧义复合键，避免 ID/分隔符冲突，具体编码待定。原始专有数据放受控可信边界，模型不默认直接读身份/权限证据；不得把 `platformData` 原样视为模型提示或 Host 授权。

### D2 调用与权威方向

外部聊天出站统一 **DSH Agent → Interaction（启用则加工，未启用则透传）→ 薄 Unified Agent I/O → Platform Adapter → 平台**；入站反向经过 I/O，再由启用的 Interaction 处理运行中插话。I/O 路由协作于已有 Conversation Manager，不创建第二份 Session；平台事件在此按普通实时聊天处理，专门业务先走各自可信分流。

DSH 原生 Agent/Session/Approval/Tools/Schedule 与 Conversation Manager 保留；不新造 Runtime/Session/消息总线。Adapter 管真实收发、平台协议、限速/分片/回复目标，Host 管身份/Owner ACL/工具权限，不信任 Adapter 自报授权。

### D3 默认身份隔离

每个平台每个实际账号身份默认独立；不按昵称或相似 ID 共享主体、Session、Memory、权限。管理员身份授权声明、跨平台关联及额外授权为后续可选设计，暂不实施；账号关联≠授权。旧 principalId/conversationId 不因新概念键重算，具体兼容受 D6 约束。

## 4. D4：Sender 与 Interaction 的边界（设计决定，尚未实现）

| 事项 | 已确认要求 | 尚未定稿细节 |
| --- | --- | --- |
| 公共发送 | v1 只提供 sendMessage() 发送已确定消息；不提供 updateMessage()/openStream()/streaming-ability flag；所有外部通道同用 I/O Sender/Channel Sender | 参数与返回结构由 Iteration 01 提出并测试，后续切片复核扩展 |
| 发送语义（ADR-060） | 同一逻辑消息不重复生成有效发送任务；区分 API 前未发送/被拒、平台已接受、未知、部分分片；不保证物理 exactly-once；未知不盲重发；失败不伪装成功 | 持久化与崩溃恢复 |
| 授权有效性（ADR-059） | 实际发送前复核目标、来源会话关系与授权；轮换/撤权/旧 Turn 失效阻止发送；历史提醒按其模块显式规则 | 提醒授权规则在 Notification 切片接入 |
| 默认回复 | Interaction 关闭时透传，默认原生回复完成后发一条逻辑消息；平台可按硬限制分片 | 原生完成事件映射、物理发送关联及部分失败处理 |
| 提前完整泡 | Interaction 启用时，可在生成期间对可靠、完整、独立、不依赖未完成工具结果的泡逐条 sendMessage()，不等整个回复/Turn settlement | 候选到可提交的确认点、与原生 attempt/重试对齐 |
| 工具正确性 | 工具成功/失败等真实结果；未完成/重试中的推测片段不可自动当已提交；不破坏原生执行/审批 | 按原生事件可证明的确认/失效条件 |
| 已提交消息 | 每条只发一次、不可修改；不重复发送累计片段或 settlement 全文；取消不声称撤回已发泡 | Sender 接受/平台回执/用户实收的区分和记录 |
| 队列（ADR-061） | 同 Conversation 按序串行，不同 Conversation 不全局串行；队列/并发有界；取消/插话停待发送泡，多分片间复核，防旧 Turn/attempt 迟到混泡；已进入平台 API 的调用不假定可撤销 | 服务间排序与背压、崩溃恢复 |
| 重试 | 失败/未知避免盲重放，超时不能证明未发送；不承诺网络 exactly-once | 明确拒绝后由调用方决定是否以新逻辑消息重试，规则随调用方切片定 |
| 入站去重（ADR-058） | 平台、Adapter、账号、平台消息完整范围内重复投递只触发一次 Agent 输入；状态有界 | Iteration 02 盘点现有 QQ 去重后迁移 |
| 旧 QQ stream | 当前 test.8 bind sendText/可选 openStream + QQTK Outbound/SDK stream 属当前事实，后续兼容/隔离 | 切换点、兼容方式，不能成为新公共能力 |
| 原生窗口 | Web/Desktop 保留原生 UI/Session/渲染/Token Streaming，不强制绕 I/O/Adapter；Agent 内部 Streaming 保留 | Interaction 原生窗口出站分泡/Hang-on 尚未完整适配，需单独设计/验收 |

“模型已经生成的片段”“Interaction 已确认可以对外提交的完整气泡”“Sender/平台确认发送”“手机实际收件”必须分别记录和验证；这些文字不预先规定新状态机或返回枚举。输入插话处理和出站呈现策略是不同职责，不以外部平台呈现测试替代原生窗口验收。

## 5. D5：服务路由与状态所有权（设计决定，尚未实现）

| 业务/状态 | 权威或唯一写入者约束 | 迁移前需明确 |
| --- | --- | --- |
| 原生 Session/历史与 Schedule | 原生 DSH 是权威；Schedule 保留原 Session | 不能为新 IO 重建或移动旧提醒 |
| Conversation 当前路由/偏好 | 已有独立 Conversation Manager 单活写入 | 新接入范围与旧键兼容；不双写路由 |
| Owner/Memory ACL/QQ bindings | Host/Character 策略负责，模型或不可信 Adapter 不授予；Memory 保持既有治理屏障 | Character Identity QQ bindings、历史根权限及可信证据的接线 |
| Approval / userQuestions.ask | 原生服务唯一权威；HITL Bridge 只做展示/可信回应路由、取消/超时 | 多平台统一 Host 集成；禁止分别猴子补丁共享服务 |
| Outbox/通知事件 ID | 当前 Character Identity 持有；未来每类持久状态仍只能一个写入者 | Notification 是否独立、存储归属/切换方式，不提前创造第二个账本 |
| 逐泡发送关联/状态 | 需要可靠关联与可审计的唯一写入职责 | 持久性/恢复与 Outbox 的边界，不能未经设计就认定现有通知 Outbox 已支持所有聊天泡 |
| Commands/Media | 命令入口不越过 Host 授权；基础附件与高级工具分层 | 哪些内置、插件入口及路径/媒体权限 |

HITL Bridge、Notification 按 ADR-057 建议各自为独立可选 Plugin，Commands 与基础 Media 归入 L1；具体命名在对应切片确定。HITL/Notification 共用 I/O Sender，但不共用审批权威或随意互写账本；通知有稳定 Conversation 目的地，不依赖短期 msgId，复用原生 Schedule。审批、问答回应与通知不自动作为普通聊天输入。

## 6. D6：兼容与受控切换清单（设计决定，尚未实现）

必须盘点并保留：

- 旧 principalId、conversationId、当前路由、Session ID/历史链与偏好。
- Memory Schema/ACL、角色记忆治理及 memoryIdentity@1 可信授权；不恢复历史根完整权限。
- 原生 Schedule 原 Session 归属、历史提醒桥接、Character Identity QQ bindings（qq_bindings）。
- Outbox 事件 ID、稳定 Conversation、去重/投递状态，尤其 unknown 不重放。
- 现有单活 Gateway、每类状态唯一写入者、既有包版本/兼容组合和可审计恢复依据。

后续顺序为状态归属审查 → 映射/权限审计 → 停机一致备份 → 隔离升级与冷恢复/回滚验证 → 授权受控切换 → 废止旧写入口，不长期双轨。回滚保全切换后新增 Session、Memory 和通知记录，不能直接覆盖旧快照。具体迁移方式、SQL/Schema、脚本及切换窗口留后续设计/开发；此次不执行。

## 7. Iteration 01 模块边界（普通文本出站）

| 部分 | 职责 | 不负责 |
| --- | --- | --- |
| Unified I/O 出站核心 | `sendMessage()`；逻辑目标校验（平台、接入账号、Conversation）；按 Conversation 串行、跨 Conversation 有界并行；取消与分片间复核；同一逻辑消息去重；结果区分未发送/已接受/未知/部分分片；不依赖 QQ SDK、Character 或 Interaction | 平台协议、回复目标、限额、分片规则；Agent Runtime/Session/路由；持久状态 |
| QQ Official 文本 Adapter | 由可信 Conversation Manager 记录解析目标并复核来源会话；回复目标与被动回复限额（复用现有实现）；按平台限额分片；API 调用；QQ 专属错误分类（明确拒绝 vs 结果未知） | 通用队列/取消；授予权限；读模型自报 ID |
| 首个调用方 | 一条现有普通文本出站路径改用 `sendMessage()`，删除其旧直接发送代码 | Interaction 的 Streaming/渐进分泡（Iteration 04） |

具体目录、Package/Plugin 组合与对象结构由实现切片结合 DSH Host 机制提出，并在 QQTK 文档记录；本表只固定职责划分。Iteration 01 不新增持久数据库、消息总线或服务框架。

## 8. 讨论、开发及验收顺序

按 [路线图](IMPLEMENTATION_ROADMAP.md) 的 Iteration 01–10 逐切片实施：每轮实现或抽离 → 单元/集成测试 → 局部替换旧路径 → 清理旧代码；Identity 与权限验证从第一轮起即为门禁。QQ Personal 协议与真实账号接入留后续，不以模拟结果冒充实现。

后续验证须覆盖：

1. D1 direct/group、引用/附件/发送关联、多账号 ID 冲突、受控 platformData、伪造身份/Owner 授权拒绝。
2. sendMessage-only、所有通道共享 Sender、启用时完整泡提前提交/关闭时一条默认回复、工具成功/失败真实确认。
3. 同 Conversation 串行、不同 Conversation 独立、不同 Turn/attempt 隔离、取消与迟到结果、取消与在途请求竞态、发送明确失败/未知、部分分片失败/冷恢复；不盲重放、不修改已发泡；会话轮换/撤权后阻止发送；入站重复投递只触发一次。
4. HITL 原生请求关联/验证回应/取消/超时，多平台无重复全局包装；Notification 不变聊天输入、Outbox 去重/unknown 与稳定目标。
5. 老 Session/Memory ACL/Schedule/QQ bindings 保留、单写入者、恢复/回滚保全新数据、历史根不重新获权。
6. 平台独立依赖/安装/启停、普通 Agent 无 Character；真实 QQ 手机收件/按钮/回复目标与原生 Web/Desktop 独立验收。

以上均是**验收要求**，各切片只对已迁移路径声明通过。当前部署事实仍是 Character test.23 / Interaction test.8 / Conversation Manager test.2 / QQTK test.23；统一平台仓库、QQ Personal 未实现，手机收件/审批按钮未完整验收。

剩余待讨论见 [ADR](DECISIONS.md) 第 6 节。本计划不擅自定状态机、包名/仓库名或 SQL。
