# DSH Character Agent：架构决策记录 v0.8（当前工作稿）

> 更新：2026-10-30。GitHub 是后续文档维护的唯一主入口；旧 ChatGPT Library v0.7.8 仅为历史快照。
> **设计决定，尚未实现**表示方向已确认，不能计入 test.23 功能、部署或验收；**待决**表示仍需讨论。当前事实以 [STATUS](../STATUS.md) 及源码为准。

## 1. 原 ADR 的延续与状态修订

保留 ADR 编号，不把已确认职责重新写为全盘待定，也不把既有运行约束写成已废止。

| ID | 状态 | 决定及继承关系 |
| --- | --- | --- |
| ADR-040 | 组织原则保留；新架构为**设计决定，尚未实现** | Character 应用保持一个仓库，组合 Persona、角色身份/Memory 策略、Worker 与应用能力。现有仓库并不表示新分层已经完成。 |
| ADR-041 | **设计决定，尚未实现** | 所有交互平台 Adapter 统一进入一个目标仓库，各平台单独 Package/安装、配置/启停及依赖。该目标仓库尚未建立。 |
| ADR-042 | 分类保留，术语/层级由 ADR-047 更新 | Messaging、Interaction、Identity、HITL、Notification、Commands、Media、Diagnostics 八类职责继续保留；HITL 为统一术语。分类不等于仓库/Package/DSH Plugin 数。 |
| ADR-043 | 约束保留 | 区分 Repository、Package、DSH Plugin、可移植普通模块；依赖原生 Agent/Session/Approval/Tools/Schedule 的部分维持 Host 集成，不另造框架。 |
| ADR-044 | **部分被 ADR-047 取代；分组仍待决** | 原“中间层层级、必需/可选全部待定”已由 L1/L2/L3 决定取代；中间仓库/Package/Plugin 数量与命名仍待定。“五插件/三仓库”仍只是历史候选。 |
| ADR-045 | 工作约束保留 | 先完成设计与文档，后开发；升级审计、备份、验证和受控切换，不长期双轨。此次仅文档更新/提交，不授权新开发、迁移或部署。 |
| ADR-046 | **设计决定，尚未实现** | 普通 DSH Agent 未来应可独立接 QQ 个人号，不必安装 Character；QQ Personal 与其他社交扩展不是当前交付能力。 |

## 2. 本轮确认的设计 ADR

下表各行状态均为**设计决定，尚未实现**。其中引用的既有组件仅说明复用依据，不表示新组合已完成。

| ID | 设计主题 | 已确认边界 |
| --- | --- | --- |
| ADR-047 | 三种职责层与横切能力 | L1 基础通信 = Messaging/薄 Unified Agent I/O + 已有独立 Conversation Manager；L2 可选 Interaction；L3 可选 HITL、Notification、Commands、高级 Media。Identity/Diagnostics 横切。层数不决定仓库/插件数，HITL Bridge 为建议名称。 |
| ADR-048 | D1 即时聊天概念契约 | 以 QQ 官方 Bot/QQ 个人号为首版基准，覆盖 direct/group、文字/基础附件、引用、发送关联。概念结构考虑 platform、adapter、accountId、conversation{id,type}、message{id,text,attachments,replyTo}、sender{id,displayName}、timestamp、platformData；不是现有 API。不提前扩展评论/帖子/动态。 |
| ADR-049 | D2 薄 Unified Agent I/O | 外部聊天双向经过 I/O/对应 Adapter，Interaction 启用时处理运行中插话；I/O 负责交接/路由/发送，Adapter 负责真实协议、限速/分片/回复目标。保留原生 Agent/Session/Approval/Tools/Schedule 与 Conversation Manager，不新造 Runtime/Session/消息总线，不下放 Host 权限/Owner ACL。 |
| ADR-050 | D3 默认账号隔离 | 每个平台实际账号身份默认独立，不按昵称/相似 ID 共享主体、Session、Memory、权限；可信证据与模型可见数据分离，复合键避免冲突。管理员授权声明、跨平台关联和额外授权暂不实施；账号关联≠授权。 |
| ADR-051 | D4 唯一出站链与原生窗口边界 | DSH Agent → Interaction（启用则加工，未启用则透传）→ Unified Agent I/O → Platform Adapter；所有外部通道共用 I/O Sender，不另设 Interaction IO。原生 Web/Desktop 保留原生 UI/Session/渲染/Token Streaming，不强制绕 I/O/Adapter；原生窗口出站分泡/Hang-on 尚未完整适配。输入插话与出站呈现分别负责。 |
| ADR-052 | I/O v1 只提供 sendMessage() | 公共发送只接受已确定消息；不提供 updateMessage()/openStream()/streaming-ability flag，不做外部消息原地流式更新。保留 Agent 内部与原生窗口 Streaming；QQ SDK stream 和旧绑定仅属迁移兼容/隔离问题。此项取代旧规划中把可选 openStream 作为未来公共能力的表述，不改当前代码。 |
| ADR-053 | 生成期间的完整气泡增量提交 | Interaction 可提前逐条 sendMessage() 可靠、语义完整、独立且不依赖未完成工具结果的气泡，不必等整轮 settlement。已提交消息只发一次、不可修改；取消/插话停待发送泡，不声称撤回已发泡；工具结果等真实确认。同 Conversation 串行并记录关联/成功/失败，隔离 Turn/attempt，失败/未知不盲目重放。禁用时默认原生回复完成发一条逻辑消息。 |
| ADR-054 | D5 L3 业务边界 | HITL 仅展示/路由原生 Approval 和 userQuestions.ask 的已验证回应及取消/超时，不新造审批权威、不多平台猴子补丁全局服务。Notification 用同一 Channel Sender、稳定 Conversation 与持久 Outbox，复用原生 Schedule；特殊业务不自动变聊天输入。Commands 解析与 Host 授权分离，基础附件/高级 Media 分层；各自插件形态待决。 |
| ADR-055 | D6 数据兼容与唯一写入者 | 保留 principalId/conversationId/Session/Memory ACL/Schedule/Character Identity QQ bindings/Outbox 事件 ID/unknown 不重放。每类持久状态唯一写入者，先审计、备份、验证再受控切换，不长期双轨；具体迁移方式/SQL 留后续。 |
| ADR-056 | 事实、目标及验收分开 | test.23/test.8/Manager test.2/QQTK test.23 仍是基线；新 IO、统一平台仓库和 QQ Personal 未实现。手机收件/审批按钮等未完整验收；自动检查或 API 回执不证明用户端效果。GitHub 唯一后续维护入口，Library v0.7.8 仅历史快照。 |

### ADR-048/050 的可信边界

平台原始专有数据留在受控可信边界，`platformData` 不默认对模型开放身份/权限证据；Host 负责可信性与授权，不能信任 Adapter 自报权限。新复合键应隔离平台、Adapter/接入账号、Conversation/发送者，并避免歧义；具体编码/映射仍待定，不重算旧标识。

### ADR-053 的提交边界

“模型已经生成的片段”不等于“Interaction 已确认可对外提交的完整气泡”，也不等于 Sender/平台已确认发送。未完成或重试中的推测文本不能自动提交；提前发泡不能牺牲 DSH 工具执行与审批正确性。每条发送需要关联/状态记录，但本 ADR **未定稿** Sender 返回类型、确认点、队列状态机、崩溃恢复或安全重试算法。

## 3. 保留的安全与产品约束

- 不直接修改官方 DSH 发布文件与内置 Bundle；复用原生 Agent/Session/Preset/Worker Spawn、Tools、Approval、Schedule。
- 当前 Character 为单可信 Owner 私聊，非 Owner 与群聊禁用；D1 的 group 概念不授予群聊权限。
- Memory 要求可信 `memoryIdentity@1`；角色记忆、工具和 Worker 权限分离，Inspector 不因规划更新获得写权限。
- Schedule 保留原 Session；历史根仅有经证明的提醒桥接权限，不能恢复完整 Character/Memory/工具权限。
- 通知以明确提醒/任务事件为来源；自主闲聊心跳、主动社交仍非当前能力。
- 回滚保全新增数据及治理屏障，不将未经修复的旧版本当作安全回滚。历史安装路径、版本和部署授权不自动延续。

## 4. 当前实现事实（不是上述新设计已落地）

- Character **test.23** / Interaction **test.8** / Conversation Manager **test.2** / QQTK **test.23**；记录的验证基线为 DSH 0.2.1-rc.3、Windows、Node 24.21.0。
- Conversation Manager 已为 QQTK `plugin-sources` 内独立 Host Plugin；Interaction 已为 Character `packages` 内可选独立 Agent/Preset Plugin；Memory/Inspector/Long Tasks 等已有模块。
- test.8 `policy.bind` 仍是 `sendText` / 可选 `openStream`；QQTK `createInteractionOutbound` 负责接线，QQ 官方 Bot/SDK 仍有 stream。此事实与 ADR-052 目标分别记录。
- test.23 Worker 工具范围守卫与委派策略、test.8 分泡/插话/Hang-on 已有源码和部署记录；短闲聊趋向整泡，长结果有渐进分泡。新统一契约及自然短泡改进不能据此记为已完成。
- 原生窗口分泡/Hang-on 尚未完整适配；真实 QQ 手机收件、审批按钮和部分流式残留仍未完整验收。当前状态及测试数量见 [STATUS](../STATUS.md)，本次未重跑运行测试。

## 5. 剩余待决（不提前定为最终 ADR）

1. **Sender 返回/错误语义**：接受、成功、明确拒绝、未知的证明与物理分片关联；超时与可安全重试条件。
2. **气泡确认与队列细节**：可提交确认点、Sender 确认、取消竞态、跨 Turn/attempt 隔离、重复抑制、背压、崩溃恢复、跨聊天/HITL/通知的排序。已定串行/不可改写/不盲重放，不等于已定状态机。
3. **中间分组**：仓库/Package/DSH Plugin 数与生命周期；HITL、Notification 是否各自独立；Commands/Media 哪些内置。

QQ Personal 协议、跨平台管理员声明/账号关联/额外权限及非聊天扩展留后续专项，暂不实施。迁移方式、Schema/SQL 等要在状态所有权明确后设计。后续顺序见 [路线图](IMPLEMENTATION_ROADMAP.md)，接口与验收待办见 [模块计划](MODULE_IMPLEMENTATION_PLAN.md)。

## 6. 历史索引

旧 Library `DECISIONS_v0.7.8.md` 仅保留历史产品/安全选择，不作为当前维护副本；本仓库 [现有实现决策](../DECISIONS.md) 也需结合 STATUS 的最新版本阅读。本轮未撤销 Core/Extras、Memory 治理、单 Owner、原生权限与数据保护等不变量；仅按上表更新目标设计及取代关系。
