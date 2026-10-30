# DSH Character Agent：模块边界调研与接口待决 v0.8

> **更新：2026-10-29｜状态：架构阶段，尚未形成实施任务。** 此文作为 GitHub 中后续讨论的工作表；GitHub 是今后的唯一主维护入口，旧 ChatGPT Library v0.7.8 只是历史快照；旧 `MODULE_IMPLEMENTATION_PLAN_v0.7.8.md` 保留历史详细背景，不得直接复制其中的旧版本 API 假设作为新开发指令。

## 1. 对象和术语

- **Repository**：源码协作、审查与发布管理边界，可包含多个 Package。
- **Package**：独立版本/安装边界；不要求每个包都是 DSH Plugin。
- **DSH Plugin**：由 DSH Host/Agent/Preset 装配的入口，可使用 Host 提供的原生 API。
- **可移植模块**：无 DSH/Character/QQ SDK 直接依赖的普通 JS 逻辑；只有真实移植需求时才额外独立打包。
- **Character 挂件**：面向这个角色应用的身份/记忆策略、Persona、Worker 规则与组合。
- **Platform Adapter**：负责一个交互平台的协议、可信发送者验证、收发及专有 UI；与 DSH Host 适配不同。

**两端仓库归属已决定**：Character 应用一仓；Platform Adapters 统一一仓，各平台可独立包。**中间通用层仍不定仓库/包/Plugin 数量。** 不写死此前候选五插件划分。

## 2. 八类职责逐项调研表

| 模块分类 | 当前可确认的源码或机制 | 现有风险 / 设计待办 | 是否已有独立插件 |
| --- | --- | --- | --- |
| Messaging | QQTK `gateway/bootstrap.js` 的 `createInteractionOutbound`、`transport/inbound.js`、`reply-target.js` | 入站证据、消息 ID→回复目标、Sender 能力和回执抽象；QQ 私有限额留平台 | 否 |
| Interaction | Character `packages/interaction-policy`，原生 Agent-scoped events、LLM judge、cancel/steer/followup | DSH API 与可移植分泡算法分层；短泡自然性需求尚未开发 | **是，test.8 可选** |
| Identity | Character `character-identity/{identity,index,boundary,bindings,schedule}.mjs` | 平台可信身份与 Character Owner/Memory ACL/历史根授权解耦，不自动重映射旧 ID | Character 专属模块，未通用 |
| Human Input | QQTK `features/approval-channel.js` 和 `question-channel.js` | 不能多 Adapter 并行包装 `userQuestions.ask()`；Approval 原生唯一权威 | 否 |
| Notification | Character Identity SQLite Outbox/QQ 通知泵；Remote Ops 通知 | 持久数据唯一所有权、去重、`unknown`、老 Schedule 提醒与稳定地址 | 否 |
| Commands | QQTK `middleware-setup.js` slash commands、Remote Ops `/ops` | 入口解析与 Host 授权动作分离；可作为内部模块，暂不预设插件 | 部分业务在 Remote Ops 独立插件 |
| Media | QQTK 内容/附件解析、图片/语音、`send-file-tool.js` | 上传发送与 QQ 权限限制留平台；媒体公共描述可移植 | 否 |
| Diagnostics | Interaction `trace` + QQTK `createDeliveryRecorder` | 消息关联、失败/延迟、脱敏、跨平台最小字段；通常是横切模块 | 否 |

**不归本次重造**：独立 Conversation Manager test.2；Memory Core/Tools、Inspector、Long Tasks、Remote Ops、Preset Manager；它们要按未来接口接入，但不为分类表强行再造第二份。

## 3. 已确认依赖/权威约束

1. DSH **原生 Session** 是唯一 Agent 会话历史和恢复机制；Conversation Manager 是 Conversation 当前路由的权威，不授予 Character 权限。
2. DSH **原生 Approval** 是工具审批唯一裁决来源；Human Input 只做请求渠道/可信回应，不能另建批准数据库。
3. **真实平台身份**必须在平台入站校验，再交给 Host/Character 的授权策略；QQ OpenID、群聊/临时消息字段不应成为所有平台的公共格式假设。
4. **Interaction** 可以选择发送行为，但是否流式编辑、如何回执、主动或被动回复配额属于各个平台；累积 Streaming update 不得被当作新消息重复发送。
5. **Outbox** 保留原有事件去重、投递状态、稳定目标及 `unknown` 不重放；原生 Schedule 原 Session 不能因通知抽离而被移动。
6. **历史根/Memory** 不能通过恢复旧 Session、伪造消息字段或跨平台账号自动关联而获权。
7. **Character** 不应直接操作 QQ SDK；未来 QQ Official 与 QQ Personal 适配在统一平台仓库但各自独立安装。

## 4. 下一轮讨论清单（不要直接开发）

**A｜基础层**：一个最小的普通 DSH Agent + 单平台聊天需要哪些必装能力？Conversation Manager 是否必须有？Messaging 跟 Adapter 应如何分工？

**B｜可选层**：Interaction、Human Input、Notification、Commands、Media 哪些独立启停、哪些按渠道能力启用？哪些功能只用普通函数而无需 Plugin？

**C｜依赖/发布**：哪些模块紧耦合并需要共仓？每仓有哪些独立 Package 入口？如何避免新增互相循环 inject 和巨大装配 Bundle？

**D｜权限/状态**：身份与消息可信证据的具体接口；Approval/Questions 的多平台路由；通知的旧数据库与单一写入者迁移方案。

**E｜验收**：模拟第二平台的契约夹具、功能等价测试、手机实机 QQ 验收、冷恢复/历史提醒/通知去重、版本锁定及可审计回滚。

## 5. 本阶段输出和限制

只有 A–E 的讨论形成可验证决定后，才扩充逐接口伪代码、拟议 Package 目录、实现任务和迁移顺序。**当前没有授权创建新平台仓库、修改代码、迁移 SQLite/Session/Memory 或部署生产实例。**

实际开发状态见 `IMPLEMENTATION_ROADMAP.md`，设计已确认与待定见 `DECISIONS.md`；此文不是 test.23 部署日志，具体证据在 GitHub Character `docs/STATUS.md`。
