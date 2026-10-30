# DSH Character Agent：当前进度与架构阶段路线图 v0.8

> GitHub 是今后的唯一主维护入口；旧 ChatGPT Library v0.7.8 只是历史快照。
> 更新：**2026-10-29**。本页同时列出已有实现、仍待实机验收及下一阶段的**文档设计工作**。旧 Library 历史快照 `IMPLEMENTATION_ROADMAP_v0.7.8.md` 保存截至 10 月中旬的历史计划，不代表全部待办仍未开发。

## 1. 当前源码与部署记录基线

| 能力 | 当前事实 | 未完成 / 谨慎边界 |
| --- | --- | --- |
| 运行与装配 | Character **test.23** / QQTK **test.23** 已有授权部署记录；DSH **0.2.1-rc.3**、Node **24.21.0**、Windows | 不等于 Mac/其他 DSH 构建可直接安装 |
| 会话 | 独立 Conversation Manager **test.2**；QQTK 已变薄适配；生命周期、持久恢复与路由唯一性隔离验证 | 模拟第二平台不等于真实第二平台接入；旧提醒根与单写入者约束须保留 |
| Interaction | **test.8**；流式长回复、分泡、插话、Worker 续轮、4 秒 Hang-on 起草/8 秒状态检查及回执诊断 | 真实模型表现、手机端流式残留与重复泡仍需验证；自然短泡只是讨论中的改进 |
| Character/Worker | 原生 Creator/Worker Preset、显式委派及工具守卫；test.23 记录 13 Preset 健康 | 有些 Host 探针未在限时内完成；真实复杂任务质量与最小权限组合需实机评价 |
| Memory/Inspector | SQLite Schema 3、长期记忆 L1/L2/L3、来源/治理与可选 Inspector | 自然长期效果、桌面窗口体验及大库性能需分别验证 |
| Notifications/Long Tasks | 原生 Schedule + 已有 Outbox；稳定 Conversation 目标、状态/去重；可选 Long Tasks | 真实 QQ 手机投递未全验；通用通知模块尚未独立 |
| 平台 | QQ Official + 版本化 Bot/SDK 补丁正常运行记录 | QQ Personal Adapter、统一平台仓库、NapCat/OneBot 选型尚无实现 |

**验证表达**：Character 单元 215、安全审计 33、QQTK 轻量 55/审批 6 是 test.23 文档记录，不是本次文档更新重新执行的测试；许多 Host 检查使用合成 Sender/LLM。手机实机验收、生产回滚演练仍不得假定已通过。

## 2. 本阶段：先完成架构设计（尚未开始功能重构）

| 顺序 | 设计任务 | 完成标准 |
| --- | --- | --- |
| A0 | **冻结两端归属**：Character 应用一个仓库；所有交互平台 Adapter 一个仓库 | 已作为组织原则记录；平台仓库尚未建立 |
| A1 | **厘清八类职责与层级**：Messaging / Interaction / Identity / Human Input / Notification / Commands / Media / Diagnostics | 区分最小必需与可选，避免把功能类别直接当包名 |
| A2 | **确定唯一权威与依赖方向** | Session、可信身份、输出、Approval、Outbox 各有明确所有者；不重造原生系统 |
| A3 | **确定中间库/Package/DSH Plugin 边界** | 哪些合库、哪些独立安装、哪些纯普通模块，以真实依赖和状态生命周期为证据 |
| A4 | **制定接口与迁移约束** | 消息契约、发送回执/Streaming 能力、可信授权、审批/问答、通知持久化、版本兼容与模拟第二平台测试 |
| A5 | **文档定稿后再拆解开发任务** | 技术方案已审查、数据/安全门禁明确，才允许安排实现与受控切换 |

**尚未决定：** 中间层最终仓库数、Plugin 数、Package 数、接口命名、QQ 小号底层协议。此前一次提出的“五个通用 DSH Plugin/一个 Communication 仓库”属于候选方案，不能作为施工指令。

## 3. 后续开发阶段（未授权启动）

1. 在隔离夹具中先实现并验证最小公共契约，不动现有单活 QQ Gateway。
2. 根据最终分层逐模块迁移 QQTK/Character 的通用职责；先完成功能测试，再受控切换，废止旧运行入口，不长期双轨。
3. Identity/Outbox 涉及持久状态：停机一致备份、迁移映射核验、原生 Schedule/Memory ACL/历史根权限审计、单写入者及审慎回滚是前置条件。
4. 统一平台 Adapter 仓库按平台分 Package；先模拟另一平台证明不依赖 QQSDK，再考虑 QQ Personal 协议开发与真实账号验收。
5. 新增平台、主动社交和跨平台用户绑定均需独立设计授权、风险与运营边界，不随本轮架构讨论自动启用。

## 4. 历史记录和可信来源

- Character 仓库：`docs/STATUS.md`、`docs/ARCHITECTURE.md`、`docs/INTERACTION-POLICY.md`、`docs/WORKERS.md`。
- QQTK 仓库：`plugin-sources/dsh-conversation-manager/README.md`、`docs/INTERACTION.md`、`docs/GENERIC-INTEGRATION.md`。
- Library 归档：`IMPLEMENTATION_ROADMAP_v0.7.8.md` 和各个 `v0.7.8` 设计文档；历史实验和授权不自动顺延至新工作。
