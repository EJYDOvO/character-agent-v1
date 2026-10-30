# DSH Character Agent：架构决策记录 v0.8（当前工作稿）

> 更新：2026-10-30（增补 ADR-057–062：中间层模块组织、出入站可靠性、渐进式重构）。GitHub 是后续文档维护的唯一主入口；旧 ChatGPT Library v0.7.8 仅为历史快照。
> 状态用语：**已实现**＝已在源码并有测试/部署记录；**设计决定，尚未实现**＝方向已确认，不能计入 test.23 功能、部署或验收；**待决**＝仍需讨论。当前事实以 [STATUS](../STATUS.md) 及源码为准。

## 1. 原 ADR 的延续与状态修订

保留 ADR 编号，不把已确认职责重新写为全盘待定，也不把既有运行约束写成已废止。

| ID | 状态 | 决定及继承关系 |
| --- | --- | --- |
| ADR-040 | 组织原则保留；新架构为**设计决定，尚未实现** | Character 应用保持一个仓库，组合 Persona、角色身份/Memory 策略、Worker 与应用能力。现有仓库并不表示新分层已经完成。 |
| ADR-041 | **设计决定，尚未实现** | 所有交互平台 Adapter 统一进入一个目标仓库，各平台单独 Package/安装、配置/启停及依赖。该目标仓库尚未建立，Iteration 01–09 期间不创建。 |
| ADR-042 | 分类保留，术语/层级由 ADR-047、ADR-057 更新 | Messaging、Interaction、Identity、HITL、Notification、Commands、Media、Diagnostics 八类职责继续保留；HITL 为统一术语。分类不等于仓库/Package/DSH Plugin 数。 |
| ADR-043 | 约束保留 | 区分 Repository、Package、DSH Plugin、可移植普通模块；依赖原生 Agent/Session/Approval/Tools/Schedule 的部分维持 Host 集成，不另造框架。 |
| ADR-044 | **被 ADR-047、ADR-057 取代** | 原“中间层层级、必需/可选全部待定”已由 L1/L2/L3（ADR-047）和模块组织（ADR-057）取代。“五插件/三仓库”仍只是历史候选；具体 Package 名称在各功能切片实现时确定。 |
| ADR-045 | 安全约束保留；开发顺序由 **ADR-062** 更新 | 升级审计、备份、验证和受控切换，不长期双轨继续有效。原“先完成全部设计与文档，再开发”改为按功能切片的渐进式重构（ADR-062）。文档更新与开发均不授权部署。 |
| ADR-046 | **设计决定，尚未实现** | 普通 DSH Agent 未来应可独立接 QQ 个人号，不必安装 Character；QQ Personal 与其他社交扩展不是当前交付能力。 |

## 2. 已确认的设计 ADR（ADR-047–056）

下表各行状态均为**设计决定，尚未实现**，除非另注。其中引用的既有组件仅说明复用依据，不表示新组合已完成。

| ID | 设计主题 | 已确认边界 |
| --- | --- | --- |
| ADR-047 | 三种职责层与横切能力（L1/L3 成员由 ADR-057 细化） | L1 基础通信 = 薄 Unified Agent I/O + 已有独立 Conversation Manager；L2 可选 Interaction；L3 可选服务。Identity/Diagnostics 横切。层数不决定仓库/插件数。原列入 L3 的 Commands、基础 Media 按 ADR-057 归入 L1。 |
| ADR-048 | D1 即时聊天概念契约 | 以 QQ 官方 Bot/QQ 个人号为首版基准，覆盖 direct/group、文字/基础附件、引用、发送关联。概念结构考虑 platform、adapter、accountId、conversation{id,type}、message{id,text,attachments,replyTo}、sender{id,displayName}、timestamp、platformData；不是现有 API。不提前扩展评论/帖子/动态。 |
| ADR-049 | D2 薄 Unified Agent I/O | 外部聊天双向经过 I/O/对应 Adapter，Interaction 启用时处理运行中插话；I/O 负责交接/路由/发送，Adapter 负责真实协议、限速/分片/回复目标。保留原生 Agent/Session/Approval/Tools/Schedule 与 Conversation Manager，不新造 Runtime/Session/消息总线，不下放 Host 权限/Owner ACL。 |
| ADR-050 | D3 默认账号隔离 | 每个平台实际账号身份默认独立，不按昵称/相似 ID 共享主体、Session、Memory、权限；可信证据与模型可见数据分离，复合键避免冲突。管理员授权声明、跨平台关联和额外授权暂不实施；账号关联≠授权。 |
| ADR-051 | D4 唯一出站链与原生窗口边界 | DSH Agent → Interaction（启用则加工，未启用则透传）→ Unified Agent I/O → Platform Adapter；所有外部通道共用 I/O Sender，不另设 Interaction 专属 I/O。原生 Web/Desktop 保留原生 UI/Session/渲染/Token Streaming，不强制绕 I/O/Adapter；原生窗口出站分泡/Hang-on 尚未完整适配。 |
| ADR-052 | I/O v1 只提供 sendMessage() | 公共发送只接受已确定消息；不提供 updateMessage()/openStream()/streaming-ability flag，不做外部消息原地流式更新。保留 Agent 内部与原生窗口 Streaming；QQ SDK stream 和 test.8 `sendText`/`openStream` 仅属迁移兼容/隔离问题，不是新公共契约。 |
| ADR-053 | 生成期间的完整气泡增量提交（发送语义由 ADR-060/061 细化） | Interaction 可提前逐条 sendMessage() 可靠、语义完整、独立且不依赖未完成工具结果的气泡，不必等整轮 settlement。已提交消息只发一次、不可修改；取消/插话停待发送泡，不声称撤回已发泡；工具结果等真实确认。禁用时默认原生回复完成发一条逻辑消息。 |
| ADR-054 | D5 L3 业务边界（插件形态由 ADR-057 细化） | HITL 仅展示/路由原生 Approval 和 userQuestions.ask 的已验证回应及取消/超时，不新造审批权威、不多平台猴子补丁全局服务。Notification 用同一 I/O Sender、稳定 Conversation 与持久 Outbox，复用原生 Schedule；特殊业务不自动变聊天输入。Commands 解析与 Host 授权分离。 |
| ADR-055 | D6 数据兼容与唯一写入者 | 保留 principalId/conversationId/Session/Memory ACL/Schedule/Character Identity QQ bindings/Outbox 事件 ID/unknown 不重放。每类持久状态唯一写入者，先审计、备份、验证再受控切换，不长期双轨；具体迁移方式/SQL 留后续。 |
| ADR-056 | 事实、目标及验收分开 | test.23/test.8/Manager test.2/QQTK test.23 仍是部署基线。手机收件/审批按钮等未完整验收；自动检查或 API 回执不证明用户端效果。GitHub 唯一后续维护入口，Library v0.7.8 仅历史快照。 |

### ADR-048/050 的可信边界

平台原始专有数据留在受控可信边界，`platformData` 不默认对模型开放身份/权限证据；Host 负责可信性与授权，不能信任 Adapter 自报权限。新复合键应隔离平台、Adapter/接入账号、Conversation/发送者，并避免歧义；具体编码/映射仍待定，不重算旧标识。

### ADR-053 的提交边界

“模型已经生成的片段”不等于“Interaction 已确认可对外提交的完整气泡”，也不等于 Sender/平台已确认发送。未完成或重试中的推测文本不能自动提交；提前发泡不能牺牲 DSH 工具执行与审批正确性。发送语义、串行与取消的原则见 ADR-060/061；具体返回结构以实现切片的契约与测试为准。

## 3. 本次新增的设计 ADR（ADR-057–062）

除特别说明外，状态均为**设计决定，尚未实现**。

### ADR-057 中间层模块组织（取代 ADR-044 的分组待决；细化 ADR-047/054）

| 层/横切 | 模块 | 决定 |
| --- | --- | --- |
| L1 基础通信 | Unified Agent I/O | 统一聊天消息交接与发送；公共出站只有 `sendMessage()`（ADR-052）。 |
| L1 | Conversation Manager | 保留已有独立 Host Plugin，继续是 Conversation → DSH Session 的唯一当前路由；I/O 不复制、不替代。 |
| L1 | Commands | 默认作为 I/O 内部的解析/分发模块，不单独成为插件；执行授权仍由 Host/业务插件负责。 |
| L1 | 基础 Media | 作为消息契约（附件描述）与平台适配（上传/下载）的基础功能。高级媒体工具（看图、发文件等）保持为现有可选工具，不另立 L3 服务。 |
| L2 可选 | Interaction | 保留当前独立 Interaction Policy Plugin：输入插话、回复节奏、完整气泡分割、Hang-on。启用时加工 Agent 回复，关闭时透传；最终所有外部消息都经 Unified I/O Sender 发送，不创建 Interaction 专属 I/O。 |
| L3 可选 | HITL Bridge | 建议独立可选 Plugin；只桥接原生 Approval 与 `userQuestions.ask()` 的展示及可信回应，不创建第二个审批权威。 |
| L3 可选 | Notification | 建议独立可选 Plugin；复用 I/O 发送能力，保留稳定接收目标、持久 Outbox、去重状态与原生 Schedule。 |
| 横切 | Identity | Platform Adapter 验证实际平台连接与身份来源；Host 校验可信来源并执行准入、工具及会话权限；Character Identity 保留 Owner、Memory ACL、Worker 和历史 Session 的专属安全策略。**不建立**取代所有现有身份系统的大型 Identity Plugin。默认各平台实际账号独立；跨平台关联、管理员授权声明后续实现。 |
| 横切 | Diagnostics | 统一事件关联字段与脱敏要求；各模块负责自己产生的事件。暂不创建独立日志服务或强制安装的 Diagnostics Plugin。 |

**安装原则**：Conversation Manager、Unified I/O、Interaction、HITL、Notification 应能按职责独立装配和启停；个人部署可提供“全部默认安装/启用”的组合，但不能因此产生模块间不必要的强依赖。仓库、Package、DSH Plugin 和普通 JS Module 不需要一一对应。Character 维持单仓库；平台 Adapter 未来统一平台仓库、每平台独立 Package（ADR-041），切片迭代期间不创建新平台仓库。

### ADR-058 入站去重

同一平台范围内重复投递的外部消息，不应重复触发 Agent 输入。去重键必须保留可区分 **平台、Adapter、接入账号及平台消息** 的完整身份范围，不能只按消息 ID、昵称或文本判断；不同账号或平台出现相同消息 ID 时不得互相抑制。去重状态的保存期与容量需有界，并说明重启后的保证范围。现有 QQ 入站的去重行为在 Iteration 02 盘点后迁移，此前不宣称已统一。

### ADR-059 出站授权有效性

实际发送前（而不只是入队时）验证：目标有效且属于对应平台/账号范围；来源会话与目标 Conversation 的关系仍成立；适用授权仍有效。权限撤销、会话轮换和旧 Turn 失效不能导致错误投递。证据只来自 Host/Conversation Manager 等可信路由，不来自模型自报 ID、权限声明或原始 `platformData`。

合法的历史提醒按自己的授权规则（Character Identity 历史提醒桥接、Notification 稳定目标）检查，**不要求**其原始 Session 仍是当前主聊天 Session；但这类规则必须由对应模块显式提供，I/O 不能为了兼容提醒而放宽普通聊天回复的检查。

### ADR-060 发送语义（解决原待决 1 的原则部分）

- 一条逻辑气泡/消息不得因 settlement、模型重试或内部队列重复生成有效发送任务；重复提交同一逻辑消息应返回已有结果，而不是再次发送。
- 平台分片可把一条逻辑消息映射为多个物理发送，结果必须保留同一逻辑发送的关联。
- 发送结果至少区分：调用平台 API 前明确失败或被拒绝（未发送）；平台 API 已明确接受（不等于手机已收到）；可能已发生但无法确定（未知）。部分分片已接受后失败，需要单独表达。
- 网络发送可能出现不确定结果，**不保证物理 exactly-once**；未知状态禁止盲目重新发送，失败不得被静默伪装为成功。
- 普通诊断日志不写凭据、原始身份或聊天正文。

具体返回对象、类型命名由实现切片提出并以测试固定；Iteration 01 的普通文本出站实现是第一个候选，后续切片复核后再扩展。

### ADR-061 串行与取消

- 同一 Conversation 的发送顺序必须可控（按序执行）；不同 Conversation 不被无意义地全局串行阻塞；队列与并发均有界。
- 取消及过期 Turn 不得继续提交待发内容：尚未开始发送的任务可因取消或有效性失效而不再发送；多分片消息在分片之间复核。
- 已经进入平台 API 的发送不能假定可以撤销，也不能宣称撤回。
- 跨 Interaction/HITL/Notification 的统一排序与背压在对应切片设计，未实现前不得宣称已保证。

### ADR-062 渐进式重构（更新 ADR-045 的开发顺序）

现有 Character + QQ Official Bot 系统实际运行中，不推倒重写。每轮只迁移一个相对完整、可独立验证的功能切片，循环为：**选择切片 → 实现或抽离 → 单元测试 → 集成测试 → 局部替换旧路径 → 清理不再使用的代码 → 进入下一切片**。复用 DSH 原生 Agent/Session/Tools/Approval/Schedule 与 Conversation Manager，复用成熟算法；不长期维持两套生产发送路径或两个状态写入者；开发测试与生产部署隔离，切片开发不包含部署。设计与 Host 能力不兼容时记录证据与替代方案，不绕过权限或重造 Runtime。

Identity 与权限验证是**从 Iteration 01 起持续有效的安全门禁**，不是等到 Iteration 08 才处理。切片顺序见 [路线图](IMPLEMENTATION_ROADMAP.md)。

## 4. 保留的安全与产品约束

- 不直接修改官方 DSH 发布文件与内置 Bundle；复用原生 Agent/Session/Preset/Worker Spawn、Tools、Approval、Schedule。
- 当前 Character 为单可信 Owner 私聊，非 Owner 与群聊禁用；D1 的 group 概念不授予群聊权限。
- Memory 要求可信 `memoryIdentity@1`；角色记忆、工具和 Worker 权限分离，Inspector 不因规划更新获得写权限。
- Schedule 保留原 Session；历史根仅有经证明的提醒桥接权限，不能恢复完整 Character/Memory/工具权限。
- 通知以明确提醒/任务事件为来源；自主闲聊心跳、主动社交仍非当前能力。
- 回滚保全新增数据及治理屏障，不将未经修复的旧版本当作安全回滚。历史安装路径、版本和部署授权不自动延续。

## 5. 当前实现事实（不是上述新设计已落地）

- 部署基线：Character **test.23** / Interaction **test.8** / Conversation Manager **test.2** / QQTK **test.23**；记录的验证基线为 DSH 0.2.1-rc.3、Windows、Node 24.21.0。
- Conversation Manager 已为 QQTK `plugin-sources` 内独立 Host Plugin；Interaction 已为 Character `packages` 内可选独立 Agent/Preset Plugin；Memory/Inspector/Long Tasks 等已有模块。
- test.8 `policy.bind` 仍是 `sendText` / 可选 `openStream`；QQTK `createInteractionOutbound` 负责接线，QQ 官方 Bot/SDK 仍有 stream。此事实与 ADR-052 目标分别记录。
- 原生窗口分泡/Hang-on 尚未完整适配；真实 QQ 手机收件、审批按钮和部分流式残留仍未完整验收。当前状态及测试数量见 [STATUS](../STATUS.md)。
- Iteration 01（普通文本出站 Unified I/O）的实现状态以 QQTK 源码与其文档为准；未合并、未部署前不计入部署基线。

## 6. 剩余待决（不提前定为最终 ADR）

1. **返回结构的扩展**：ADR-060 已定区分原则；附件、引用、Interaction 气泡确认点接入后，结果结构是否需要扩展，在 Iteration 04/05 复核。
2. **持久发送状态与恢复**：逐泡发送关联是否需要持久化、崩溃后如何恢复、与 Notification Outbox 的边界；不在未设计前认定现有 Outbox 覆盖聊天泡。
3. **跨服务排序与背压**：聊天、HITL、Notification 共用 Sender 时的优先级与背压（ADR-061 最后一条）。
4. **具体 Package/Plugin 命名与仓库归属**：ADR-057 已定职责组合，名称与是否迁仓随切片实现确定。

QQ Personal 协议、跨平台管理员声明/账号关联/额外权限及非聊天扩展留后续专项。迁移方式、Schema/SQL 等要在状态所有权明确后设计。后续顺序见 [路线图](IMPLEMENTATION_ROADMAP.md)，接口与验收待办见 [模块计划](MODULE_IMPLEMENTATION_PLAN.md)。

## 7. 历史索引

旧 Library `DECISIONS_v0.7.8.md` 仅保留历史产品/安全选择，不作为当前维护副本；本仓库 [现有实现决策](../DECISIONS.md) 也需结合 STATUS 的最新版本阅读。本轮未撤销 Core/Extras、Memory 治理、单 Owner、原生权限与数据保护等不变量；仅按上表更新目标设计及取代关系。
