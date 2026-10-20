# 模块接口与维护入口

最新接口细节、分层筛选语义、授权矩阵与回滚变更见 [当前状态与验收边界](STATUS.md)。Inspector L3 Browse 现在返回逐条投影引用，不再返回单个投影容器；原 `projection()` 接口不变。

| 模块 | 当前接口/位置 | 管理与停用 |
|---|---|---|
| Identity | `packages/character-identity`，memoryIdentity v1 / QQ binding / outbox；新增 `characterIdentity.route(handle)` | Core 管理；撤销绑定即撤销记忆访问 |
| Memory Core | `LayeredMemory`；Inspector 接口在 `layered.mjs`，仍由 Core 强制 ACL/CAS/屏障 | 关闭 UI 不影响 Core；Schema 3，无本轮迁移 |
| Memory Tools | 通用 `index.mjs` / Character `character.mjs` / 分析 Worker `worker.mjs` | 每个 Agent Preset 单独装配 |
| Definition / Worker | `packages/character-definition`；构建时派生官方 Creator | `specialistWorkers` 显式选择；构建变更需回归 |
| QQ Adapter / QQTK | 现有专用 Adapter + 独立 QQTK | 本轮未改 QQTK；不额外连接 QQ |
| Interaction | 独立可选 Agent 插件 | 原有配置与流式实现保持 |
| Inspector | `packages/memory-inspector`，原生 `settings.section` 客户端、Connection RPC 和受控 Core API | 普通插件，Extras/Profile 声明一次；默认只读，可独立禁用 |
| Session / Schedule | 原有 routes/outbox + 原生 Schedule；route 接口报告自动轮换关闭 | 旧提醒不迁移，稳定目标未完成前不自动轮换 |

测试入口：`tests/inspector.test.mjs`、`tests/workers.test.mjs`、`tests/notifications.test.mjs`、`tests/inspector-host.mjs`。原生运行脚本 `scripts/run-inspector.ps1` 创建全新数据目录，不读取生产配置或凭据；`--extras` 验证 UI/专业 Worker 的可选装配。`--preview` 仅用于合成数据预览，临时登录便利路由只存在于测试探针，不在发布插件中。

`--modules` 使用普通 Creator 和示例通用 Identity，真实挂载/卸载 Core、Inspector 与 Interaction；不加载 Character Identity 或 QQTK。`--extras` 从原生测试 Bundle 加载工具并验证停用/恢复；不是再次注册 QQ Gateway。候选准备契约集中在 `scripts/deployment-plan.cjs`，回归在 `tests/deployment-plan.test.mjs`，不形成新的运行时服务。

边界、示例与验收见 [Worker](WORKERS.md)、[Inspector](MEMORY-INSPECTOR.md)、[test.12](RELEASE-test12.md)。
