# v0.8 架构规划工作稿

> 更新：2026-10-30。GitHub 是后续文档维护的唯一主入口；旧 ChatGPT Library v0.7.8 仅为历史快照，不再同步维护。

本目录区分**当前实现事实**、**设计决定，尚未实现**和**待决事项**。本次仅更新规划文档，不开发、不迁移数据、不部署，不表示新方案已进入 test.23。

| 文档 | 内容 |
| --- | --- |
| [整体架构](ARCHITECTURE.md) | 实现基线、L1/L2/L3 职责层、D1–D6、聊天链路及原生窗口边界 |
| [架构决策](DECISIONS.md) | ADR-040–056 的状态、继承/取代关系与未决问题 |
| [实施路线图](IMPLEMENTATION_ROADMAP.md) | 已确认设计、后续顺序、迁移前置条件与验收门槛 |
| [模块边界](MODULE_IMPLEMENTATION_PLAN.md) | 当前源码映射、目标接口边界、持久状态所有权及契约验收清单 |

## 设计决定，尚未实现

- 上层 Character 保持一个仓库；下层所有交互平台 Adapter 统一进入一个目标仓库，各平台单独 Package/安装。目标平台仓库尚未建立。
- 中间按职责分为 L1 基础通信（Messaging/薄 Unified Agent I/O + 已有独立 Conversation Manager）、L2 可选 Interaction、L3 可选服务（HITL、Notification、Commands、高级 Media）。Identity 与 Diagnostics 横切各层。职责层不等于仓库、Package 或 DSH Plugin 数量，中间分组待定。
- D1 先以 QQ 官方 Bot 和 QQ 个人号的即时聊天为概念契约基准，覆盖 direct/group、消息、引用、文字、基础附件和发送关联；不提前设计评论/帖子/动态流水线。QQ Personal 本身尚未实现。
- D2/D4 外部聊天出站为 **DSH Agent → Interaction（启用则加工，未启用则透传）→ Unified Agent I/O → Platform Adapter**；入站反向经 I/O，运行中插话交 Interaction。所有通道共用 I/O Sender（亦称 Channel Sender），不新造 Runtime、Session 或消息总线。
- I/O v1 公共发送契约只提供 `sendMessage()`，不提供 `updateMessage()`、`openStream()` 或 streaming-ability flag。Agent 内部及 DSH 原生窗口 Token Streaming 保留；外部聊天不原地流式更新。
- Interaction 可在生成期间逐条提交可靠、完整、独立且不依赖未完成工具结果的气泡，不必等待整个 Turn settlement；已提交气泡只发送一次、不可修改。取消停止待发送泡；失败/未知状态不盲目重放。禁用时默认等原生回复完成发送一条逻辑消息。
- D3 各平台实际账号身份默认独立，不按昵称/相似 ID 共享主体、Session、Memory 或权限；账号关联不等于授权。
- D5 HITL（Human-in-the-Loop，人工介入；建议名称 HITL Bridge）桥接原生 Approval / `userQuestions.ask`，不成为审批权威。Notification 复用原生 Schedule、稳定 Conversation 目的地与持久 Outbox；通知、审批等特殊业务不自动进入普通聊天。
- D6 保留旧身份、路由、Memory ACL、Schedule、Character Identity QQ bindings、Outbox 事件 ID 和 `unknown` 不重放；每类状态唯一写入者，审计、备份、验证后受控切换，不长期双轨。

DSH 原生 Web/Desktop 聊天窗继续用原生 UI、Session、渲染和 Streaming，不强制绕 Unified I/O/Platform Adapter；Interaction 的原生窗口出站分泡/Hang-on 尚未完整适配。

## 当前事实与剩余讨论

实现基线仍为 **Character test.23 / Interaction test.8 / Conversation Manager test.2 / QQTK test.23**。现有 `policy.bind sendText` / 可选 `openStream` 与 QQTK Outbound 是当前实现；新 IO、统一平台仓库及 QQ Personal 尚未实现。真实 QQ 手机收件、审批按钮等尚未完整验收。

剩余讨论主要是 Sender 返回/错误语义、已提交气泡的确认与队列行为细节、中间包/插件分组；HITL、Notification 是否各自独立插件及 Commands/Media 哪些内置仍待定。跨平台关联、管理员授权声明和 QQ Personal 协议选型留后续，不在本轮擅自定稿。

现有运行实现文档继续保留在上级目录：[架构](../ARCHITECTURE.md)、[决策](../DECISIONS.md)、[路线图](../IMPLEMENTATION_ROADMAP.md)、[模块计划](../MODULE_IMPLEMENTATION_PLAN.md)。最新版本及验证证据以 [STATUS](../STATUS.md) 为准；历史授权不自动延伸为新开发/部署许可。
