# DSH Character Agent：架构决策记录 v0.8（当前工作稿）

> GitHub 是今后的唯一主维护入口；旧 ChatGPT Library v0.7.8 只是历史快照。
> **更新：2026-10-29。** 本文件分为当前已确认决策、仍待讨论事项、历史决策继承。旧 Library 历史快照 `DECISIONS_v0.7.8.md` 保留，不将其中截至 2026-10-16 的开发和部署假设当作现状。已实施事实以 Character `docs/STATUS.md` 为准。

## 已确认：组织边界（2026-10-29）

| ID | 状态 | 决定 |
| --- | --- | --- |
| ADR-040 | **已确认** | **Character 应用层保留一个仓库**，继续组合 Persona、角色身份/权限、Memory 策略、Worker 和应用专属能力。|
| ADR-041 | **已确认** | **所有交互平台 Adapter 归入一个统一仓库**（未来目标），但每个平台需要可独立安装/配置/启停的 Package/接入入口；同仓库不等于同插件。当前尚未建该仓库。|
| ADR-042 | **已确认** | 保留八类中间功能：Messaging、Interaction、Identity、Human Input、Notification、Commands、Media、Diagnostics。**分类不等于仓库/Package/DSH Plugin 数量**；有强关联的功能可合库。|
| ADR-043 | **已确认** | 区分 Repository、Package、DSH Plugin 与可移植普通代码。依赖 DSH 原生 Agent/Session/Approval/Tools/Schedule 的部分维持 Host 集成；通用纯逻辑尽量保持框架独立，不为“可移植”另造插件框架。|
| ADR-044 | **已确认** | **中间层的层级、必需/可选性、包和仓库数量暂不定**，须继续讨论真实依赖、唯一权威和生命周期；此前“五个 DSH Plugin / 三仓库”均只是候选，不是已批准架构。|
| ADR-045 | **已确认** | **先完成架构与文档，后开发**；开发后的单模块受控切换可替代长期双轨，但必须保留备份、数据兼容、单写入者与有效授权。当前讨论不授权部署。|
| ADR-046 | **目标已确认，未实现** | 普通 DSH Agent 未来应能独立接 QQ 小号，不必安装 Character；QQ Personal、跨平台身份关联、社交 Agent 扩展不属于当前已交付能力。|

## 保留的安全与产品约束

- **不直接修改官方 DSH 发布文件和内置 Bundle**；自有 Character Core/Extras 可按审查后的变更更新。继续用原生 Agent/Session/Preset/Worker Spawn、Approval、Schedule，不重造相应运行时。
- 当前 Character V1 为**单可信 Owner 私聊**；非 Owner 与群聊禁用。未来多用户/社交目标是后续范围，不能通过消息字段自动授予权限。
- Memory 继续要求可信 `memoryIdentity@1` 授权，角色记忆与工具/Worker 权限分离。只读 Inspector 不因为架构讨论自动获得写入权限。
- 原生 Schedule 仍绑定原 Session；历史根只应保留经过证明的提醒桥接权限，不重新拥有完整 Character/Memory/工具授权。
- 旧身份标识、Session 路由、Memory、Schedule、Outbox、稳定通知事件 ID 和 `unknown` 不重放语义不可因重构而静默改变。
- V1 通知仍以明确提醒及任务事件为触发源；自主闲聊心跳、主动社交不是当前实现。
- 没有长期双轨**不等于免去停机一致备份、隔离回归、受控迁移或回滚审查**。

## 已实现事实（截至 test.23，非新设计决策）

- Character test.23 / Interaction Policy 0.1.0-test.8 / Conversation Manager 0.1.0-test.2 / QQTK test.23，基线 DSH rc.3、Windows/Node 24.21.0。
- Conversation Manager 已作为 QQTK `plugin-sources` 的独立 Host Plugin；Interaction 已作为 Character `packages` 的独立 Agent/Preset Plugin；Memory Core/Tools、Remote Ops、Inspector、Long Tasks 等已有模块。
- QQ 官方 Bot 仍依赖版本化补丁；QQ Personal Adapter、统一平台仓库和新中间层模块尚未交付。实机手机收件、审批按钮、部分流式行为仍待验收。
- test.23 Worker 原生工具守卫、委派和 test.8 Interaction 行为已在仓库记录部署；短闲聊趋向整泡，未来自然短泡只是需求讨论。

## 中间层待决（暂不编号为最终 ADR）

1. Messaging、Interaction、Human Input、Notification 是否需独立 Host Plugin？基础聊天的最小装配是什么？
2. Commands/Media/Diagnostics 是内部模块还是按需 Package？是否有长期独立服务生命周期？
3. 身份的可信平台证据、一般授权接口、Character Owner/Memory/历史根政策的权威边界在哪里？
4. 输入、回复、审批、通知分别如何关联 Conversation/Session？哪个组件拥有持久状态与写权限？
5. 统一平台仓库的可选依赖、独立启动、协议能力声明及测试契约如何定义？
6. 现有源码、独立 tarball、文档与未来仓库应按什么顺序迁移，如何保证旧数据兼容？

## 历史决策索引

`DECISIONS_v0.7.8.md` 收录截至 2026-10-16 的详细产品/安全/实施选择，包括 Core/Extras、Creator 派生、单角色 `definition.yaml`、自动记忆、Worker、单 Owner 与限定主动通知。**这里没有撤销那些安全约束**；涉及当时版本、安装路径或夜间部署授权的条款必须以当前状态与当次有效授权重新确认，不得沿用为永久部署许可。
