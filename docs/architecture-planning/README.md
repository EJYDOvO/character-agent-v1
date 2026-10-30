# v0.8 架构规划工作稿

GitHub 是今后的唯一主维护入口。本目录暂存 v0.8 架构工作稿；旧 ChatGPT Library v0.7.8 只是历史快照，不再同步维护，历史文件未随本次提交迁入。

| 文档 | 内容 |
| --- | --- |
| [整体架构](ARCHITECTURE.md) | 当前实现基线、两端归属及八类功能地图 |
| [架构决策](DECISIONS.md) | 已确认原则与中间层开放问题 |
| [实施路线图](IMPLEMENTATION_ROADMAP.md) | 设计阶段、后续开发前置条件与验收边界 |
| [模块边界](MODULE_IMPLEMENTATION_PLAN.md) | 职责调研与接口待决清单 |

已定原则：Character 应用一个仓库；所有社交/交互平台 Adapter 统一归一个目标仓库。保留 Messaging、Interaction、Identity、Human Input、Notification、Commands、Media、Diagnostics 八类功能；中间层层级、必需/可选、Package、Plugin 和仓库数量继续讨论，尚未定稿。

工作稿记录的实现基线为 Character test.23 / Interaction test.8 / Conversation Manager test.2 / QQTK test.23。新架构重构尚未开展，本目录不表示新方案已实现、已部署或已通过实机验收。

现有运行实现文档继续保留在上级目录：[架构](../ARCHITECTURE.md)、[决策](../DECISIONS.md)、[路线图](../IMPLEMENTATION_ROADMAP.md)、[模块计划](../MODULE_IMPLEMENTATION_PLAN.md)；实际部署与验证证据见 [STATUS](../STATUS.md)。
