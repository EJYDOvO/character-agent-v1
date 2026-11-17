# DSH Character Agent

基于官方 Creator 构建的完整主 Agent，提供可信身份、分层长期记忆、QQ 组合适配及原生独立 Worker。QQ 接入与通用 I/O/Conversation Manager 位于独立的 [QQTK](https://github.com/EJYDOvO/harness-qq-toolkit-public) 仓库。两个仓库都不分发 DSH 本体、真实 Persona、凭据或用户数据。

当前源码：Character **0.1.0-test.30**，Interaction **0.1.0-test.9**；目标宿主 **DSH 0.2.2-rc.1 / Node 24**（Schedule API 只支持 0.2.2）。源码、隔离验证与实例部署分别记录在 [STATUS](docs/STATUS.md)。

## 内容

| 目录 | 用途 |
|---|---|
| packages/character-definition | Character Card V3/V2/V1 角色卡读取、校验与 Persona 渲染；Creator 构建派生 |
| packages/character-identity | Owner、可信 Session、Memory 授权与通知 Outbox |
| packages/character-memory-core / character-memory-tools | SQLite/FTS5/CAS、L1–L3、通用记忆工具 |
| packages/character-qq-adapter | 复用唯一 QQ Gateway 的 Character 组合适配 |
| packages/interaction-policy | 可关闭的 Agent 层表达、插话、气泡与等待提示 |
| packages/long-tasks / memory-inspector | 可选原生定时任务及内嵌 Web/Desktop 管理页 |
| bundles/character-core / character-extras | 核心装配及默认停用的可选长期任务 |
| examples / characters | 无真实身份的配置、Provider 和角色示例 |
| scripts / tests | 构建、迁移与必要权限/生命周期回归 |

生成的 Core YAML、tarball 和私有构建配置都忽略，不提交 Git。Extras 不复制第三方 Bundle，不创建第二个 Gateway。

## 干净设备开始

先安装合法取得的官方 DSH 0.2.2-rc.1 和 Node 24，再 Clone 本仓库及 QQTK，分别执行 `npm ci`。完整操作见 [安装、私有配置、数据迁移与回滚](docs/INTEGRATION.md)。构建不依赖已有 desktop Profile；依赖通过根锁文件固定，官方 Creator 从显式指定的发行包只读获取。

`npm test` 和 `npm run test:audit` 不连接真实 QQ。原生宿主测试另需 DSH；不能把 Node 测试或 QQ API accepted 当作手机验收。

## 使用与边界

- [架构与可信契约](docs/ARCHITECTURE.md)、[决策](docs/DECISIONS.md)、[路线图](docs/IMPLEMENTATION_ROADMAP.md)、[v0.8 架构规划与 ADR-040–062](docs/architecture-planning/README.md)、[跨项目复用](docs/REUSE.md)。
- [记忆](docs/MEMORY-LAYERS.md)、[Inspector](docs/MEMORY-INSPECTOR.md)、[Interaction](docs/INTERACTION-POLICY.md)、[Worker](docs/WORKERS.md)、[Long Tasks](packages/long-tasks/README.md)。
- [管理](docs/MANAGEMENT.md)、[来源与许可](docs/PROVENANCE.md)、[第三方声明](THIRD_PARTY_NOTICES.md)。

默认单 Owner QQ 私聊；人格化默认 Off。记忆与 Worker 结果不能修改 Persona、ACL 或审批。第三方 Preset 必须先审查安装，再加入真实 ID 白名单。Self Model 长期质量、真实模型任务表现、手机投递和跨系统数据迁移仍需专门验收。

修改操作方式时同步维护对应文档。临时报告、日志、测试库和性能输出仅保留本地；公开库保留可复现的安全与功能回归。

可选角色模式（`roles.enabled`，默认关闭）：白名单准入的其他私聊默认为 guest，Owner 用 `/role` 授予 contact；两者使用独立的 `character-contact`/`character-guest` Preset，只有公开 Persona 与基础聊天，无 Memory、Worker、Schedule 或工具。Owner 保持原有能力，旧 `qq-character` Session 兼容。见 [Identity & Access](docs/IDENTITY-ACCESS.md)；未部署，未经真实 QQ/手机验收。
