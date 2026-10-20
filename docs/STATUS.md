# 当前状态

本页是版本与验收状态的统一入口。历史发布记录说明当时结果，不代表最新运行状态。

## 安装与源码

2026-10-20 只读核验安装元数据：DSH **0.2.1-rc.2**，Character/Core **test.11**，Remote Ops **1.1.1-test.1**，Interaction **0.1.0-test.2**，QQ Bot **0.5.2**、SDK **1.0.5**。Inspector 未安装。本轮没有检查实时 QQ 连通状态，没有修改生产配置、数据库或重启。

源码仍为 **test.12 候选**：包含原生分析 Worker、可选 Inspector，以及遗忘脱敏、分层筛选、异步请求和保留新增记忆的回滚修复；未部署。不可覆盖同版本不可变发布包，实际发布前需分配版本并重新打包验证。

## 验证范围

- `npm test` / `npm run test:audit` 保留安全、权限、CAS、遗忘、防数据丢失和交互回归。前一提交 `55551ff` 的 [GitHub Actions](https://github.com/EJYDOvO/character-agent-v1/actions/runs/39377065399) 已在 Linux/Windows 成功；不代表后续未提交改动的 CI 已通过。
- 当前安装版原生宿主：Core-only、Core+Extras、普通 Creator + 独立 Identity/Core/Inspector；Extras 工具可见、停用和恢复；Inspector 独立卸载；Interaction 单独启停；Provider 撤销使依赖服务和旧 capability 失效。
- Worker：独立 Preset/Session、晚挂载 scoped tool 守卫、伪造 Memory 授权拒绝及冷恢复。模型和 QQ Sender 使用合成替身，不证明手机投递或复杂任务质量。
- 原生 Schedule 到期、去重与同 Session 的进程重启恢复已验证；没有稳定目标迁移或自动 Session 轮换。
- Inspector 已在 DSH Web 设置页实际操作；Desktop 使用安装版 relay 验证，尚缺实际桌面窗口验收。
- 100/1,000/10,000 条合成性能基线可用 `tests/inspector-benchmark.mjs` 重跑；同步 SQLite 和大库冷投影仍有阻塞，非并发服务吞吐保证。

## 发布前仍需完成

完整候选 Profile 的依赖安装/冻结锁文件、真实切换与恢复、实际 Desktop 窗口和必要的 QQ 审批验收。候选准备和哈希检查不等于安装成功；生产动作需另行授权。初始 Inspector 保持 `writable:false`。

任务级细粒度授权、旧 Task Memory 正式导入、自动轮换及稳定 Schedule 目标、具备执行权限的专业 Worker、向量检索和 Mac 迁移均不是已交付能力。参见 [路线图](IMPLEMENTATION_ROADMAP.md)。

详细运行日志、截图、临时审计和模型对照记录仅留在本地忽略目录。历史版本可从 `RELEASE-test*.md` 查询，实际恢复始终使用 [当前集成说明](INTEGRATION.md)。
