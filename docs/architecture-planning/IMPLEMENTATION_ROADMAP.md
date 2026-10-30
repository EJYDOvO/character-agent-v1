# DSH Character Agent：当前进度与架构阶段路线图 v0.8

> 更新：2026-10-30。GitHub 是后续文档维护的唯一主入口；旧 ChatGPT Library v0.7.8 仅为历史快照。
> 本轮只更新文档；下列目标均为**设计决定，尚未实现**，不启动代码重构、配置、测试、依赖、部署或数据迁移。

## 1. 当前源码与部署记录基线

| 能力 | 当前事实 | 尚未完成的边界 |
| --- | --- | --- |
| 运行装配 | Character **test.23** / QQTK **test.23** 已有授权部署记录；DSH **0.2.1-rc.3**、Node **24.21.0**、Windows | 不等于 Mac/其他 DSH 构建可安装或验收 |
| 会话 | 独立 Conversation Manager **test.2**，QQTK 为薄会话适配；隔离恢复/唯一路由已有验证 | 模拟第二平台不代表真实第二平台；旧提醒根/单写入者约束保留 |
| Interaction | **test.8**；长回复渐进分泡、插话、Worker 续轮、4 秒 Hang-on 起草/8 秒检查、回执诊断；当前 bind sendText / 可选 openStream | 新 sendMessage-only I/O 尚无实现；自然短泡、真实模型与手机效果另验 |
| Worker | 原生 Creator/Worker Preset、显式委派、工具范围守卫；test.23 记录 13 Preset 健康 | 部分 Host 探针限时未完成；真实任务质量另验 |
| Memory/Inspector | SQLite Schema 3、记忆 L1/L2/L3、来源治理及可选 Inspector | 与通信 L1/L2/L3 无关；长期效果/桌面体验/大库性能另验 |
| 通知/Long Tasks | 原生 Schedule + 既有持久 Outbox、稳定目标/去重及可选 Long Tasks | 通用 Notification 尚未抽离；手机投递未全验 |
| 平台/原生窗口 | QQ Official Bot/SDK 版本化补丁及 SDK stream 为现状；原生窗口保留原生 UI/Streaming | QQ Personal、新 IO、统一平台仓库未实现；Interaction 原生窗口出站分泡/Hang-on 未完整适配 |

Character 单元 215、安全审计 33、QQTK 轻量 55/审批 6 是 [STATUS](../STATUS.md) 的 test.23 **历史记录，本次未重新执行**；Host 探针多用合成 Sender/LLM。`--workers --manager` 在 55 秒期限内未完成，不列为通过。真实 QQ 手机收件、审批按钮、流式残留和生产回滚演练不能假定已验收。

## 2. 已确认设计及完成程度

| 范围 | 已确认的设计决定，尚未实现 | 仍需完成 |
| --- | --- | --- |
| 组织/分层 | Character 一仓；各平台 Adapter 统一一仓、分 Package/安装；L1 基础通信、L2 可选 Interaction、L3 可选服务，Identity/Diagnostics 横切 | 平台仓库尚未建立；中间分包/插件分组待决 |
| D1 | QQ 官方 Bot/个人号即时聊天概念结构，direct/group、引用/文字/基础附件/发送关联；受控 platformData | 字段细则/可信投影/无冲突键与旧 ID 兼容；不提前设计评论等行为 |
| D2 | 双向薄 I/O、复用独立 Conversation Manager 与 DSH 原生权威；Adapter 管协议 | 交接及可信准入接口细化，不新增 Runtime/Session/总线 |
| D3 | 平台实际账号独立，不按昵称/相似 ID 合并权限/Session/Memory；账号关联≠授权 | 后续可选管理员声明/跨平台关联暂不实施 |
| D4 | 唯一出站链：Agent→可选 Interaction→I/O→Adapter；共用 Sender；sendMessage-only，无 updateMessage/openStream/streaming-ability flag | Sender 返回/错误与气泡确认/队列细节待决；旧 SDK stream 兼容/隔离待开发 |
| D4 气泡 | 可靠、完整、独立且不依赖未完成工具结果的泡可生成中逐条提交，不等整轮 settlement；已提交不可改/重发、同 Conversation 串行 | 取消竞态/安全重试/崩溃恢复细则；禁用默认原生回复完成发一条逻辑消息 |
| D5 | HITL Bridge 桥接原生审批/问答；Notification 用稳定 Conversation/Outbox/原生 Schedule；Commands/Media 分工 | HITL/Notification 是否独立插件、Commands/Media 内置范围待决 |
| D6 | 旧身份/Session/Memory ACL/Schedule/QQ bindings/Outbox 事件 ID/unknown 不重放；唯一写入者及受控切换 | 数据归属映射、迁移方式/SQL、备份/验证/回滚方案留后续 |

概念字段和完整语义见 [架构 D1–D6](ARCHITECTURE.md)，ADR 状态见 [决策](DECISIONS.md)。已确认方向不要求重新讨论是否保留公共 Streaming，亦不把仍待定的确认/错误类型提前写死。

## 3. 后续具体顺序（规划，不表示已开发）

| 顺序 | 任务与依赖 | 可审查产物/进入下一步的条件 |
| --- | --- | --- |
| P0 当前文档同步 | 记录分层、D1–D6、ADR 取代关系、事实/设计/待决 | 五份规划文档一致；根 README 入口有效即保留；仅文档 diff |
| P1 完成发送与队列语义 | 在 sendMessage-only、可提前完整气泡的决定内，讨论返回/错误、确认点、串行/取消/重试/关联 | 可验证契约与竞态场景；工具结果真实确认、不盲目重放未知状态 |
| P2 定模块/状态归属 | 基于 P1 明确中间包/插件分组、HITL/Notification 生命周期、Commands/Media 内置范围 | 每类状态一个写入者；保留现有 Manager/Interaction，不以职责数强制分插件 |
| P3 制定兼容与验收设计 | 审查当前 QQTK stream/Outbound、全局问答包装、Identity/Outbox/QQ bindings 耦合及依赖版本 | 旧 ID/ACL/路由/事件映射清单、备份/恢复/回滚门禁；具体迁移设计此时再形成 |
| P4 后续授权开发：最小契约/夹具 | P1–P3 通过后，在隔离环境实现薄 I/O 与 QQ Official 适配接线 | 普通 Agent 无 Character 可聊天；模拟第二平台证明不依赖 QQ SDK；不动现有单活 Gateway |
| P5 接入可选 Interaction | 基于已验证 I/O Sender 迁移输出策略、插话入口，兼容/隔离旧 sendText/openStream/SDK stream | 启停/多泡/一条默认回复、工具前后/重试/取消/串 Turn 验收；原生窗口单独测，不假称已适配 |
| P6 按最终分组迁移 L3/横切职责 | 基于 P2/P3 抽离 HITL/Notification 及所需 Commands/Media、身份/诊断交接 | 原生 Approval/ask 唯一权威，通知不变聊天输入；持久状态兼容及唯一写入者 |
| P7 授权受控切换与真实验收 | 隔离验证后审计、停机一致备份、迁移校验、单活切换，废止旧写入口 | 不长期双轨；保留新增数据、旧提醒和 unknown 语义；手机收件/按钮及可审计恢复另验 |
| P8 后续平台扩展 | 另行确定 QQ Personal 协议和范围后，在目标平台统一仓库按平台 Package 接入 | 独立依赖/安装/启停，真实账号收发；不能拿模拟平台代替个人号验收 |

P4–P8 为后续开发顺序，**本轮没有执行授权**。目标平台仓库的实际建立安排须随后续发布组织决定，本轮不创建仓库。跨平台关联、管理员额外授权、评论/帖子/动态和主动社交另做设计，不随 QQ Personal 接入自动启用。

## 4. 后续验收矩阵与停止条件

| 维度 | 必须证明 | 不可替代为通过的证据 |
| --- | --- | --- |
| 契约/信任 | direct/group、引用/附件/发送关联；多账号/相似 ID 不冲突；platformData 受控、伪造权限拒绝 | 只有字段存在；昵称相同；模型自报身份 |
| 发送/气泡 | 同 Conversation 串行且关联可查；完整泡可在生成期间提交；取消抑制待发/迟到泡；已提交不可改/重发；拒绝/未知分别处理 | Token 已生成即已提交；所有泡一律等整轮 settlement；超时后盲重试 |
| 工具正确性 | 工具成功/失败等真实结果；不依赖结果的完整泡可早发；原生执行/审批保持 | 对工具结果的推测；为早发中断真实工具 |
| 服务隔离 | HITL 回应验证/取消/超时/原生唯一权威；通知稳定地址、Outbox 去重、不变普通聊天输入 | 多 Adapter 各自全局包装；通知文本绕入 Agent |
| 持久数据 | principalId/conversationId/Session/Memory ACL/Schedule/QQ bindings/事件 ID 保留；unknown 不重放；单写入者、冷恢复/回滚保全新数据 | 仅进程健康；旧快照覆盖当前状态 |
| 平台与 UI | 各平台独立安装/依赖；真实 QQ 手机收件、回复目标、按钮/问答；Web/Desktop 原生行为独立检查 | Gateway ready、SDK/API 回执、模拟 Sender 或原生事件订阅 |

任一身份/ACL/路由不明、状态未知或恢复数据不一致时，不以回退到旧不安全路径掩盖问题；保留证据，阻止未经验证的切换。具体判据需 P1–P3 定稿，不能以本表宣称实施已验收。

## 5. 主要待讨论事项与来源

剩余讨论主要为 **Sender 返回/错误语义、已提交气泡确认与队列行为细节、中间 Package/Plugin 分组**。迁移方式/SQL 和 QQ Personal 协议留后续专项。

现状来源：[STATUS](../STATUS.md)、[现有架构](../ARCHITECTURE.md)、[Interaction](../INTERACTION-POLICY.md)、[Worker](../WORKERS.md)，以及 [QQTK](https://github.com/EJYDOvO/harness-qq-toolkit-public) 的 Conversation Manager 与通道源码。旧 Library 的各 v0.7.8 文档为历史背景，旧部署许可、路径和测试数量不能沿用为新工作的验收。
