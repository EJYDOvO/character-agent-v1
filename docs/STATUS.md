# 当前状态

本页是版本与验收状态的统一入口。历史发布记录说明当时结果，不代表最新运行状态。

## 安装与源码

当前实例：DSH **0.2.1-rc.2**，Character/Core/Extras **test.12**，Remote Ops **1.1.1-test.1**，Interaction 和 Inspector **0.1.0-test.2**，QQ Bot **0.5.2**、SDK **1.0.5**。本次已完成一致性备份、候选依赖安装及冻结锁文件、切换和重启，QQ Gateway 已连接，Agent 空闲。

test.12 包含原生分析 Worker、可选 Inspector，以及遗忘脱敏、分层筛选、异步请求和保留新增记忆的回滚修复。Inspector 已以 **`writable:false`** 启用；人格化保持 Character 模式。现有角色绑定、QQ Session 路由与官方 ASAR 哈希保持一致，记忆数据库完整性检查通过。后续修改已发布包内容必须分配新版本，不能覆盖不可变包。

## 验证范围

- 本次单元测试 **115/115**、审计回归 **33/33**，无跳过。公开提交 `889f46a` 的 [GitHub Actions](https://github.com/EJYDOvO/character-agent-v1/actions/runs/39385106958) 已在 Linux/Windows 成功；本次追加的完整维护版本清单修复已在本地回归，不将前一提交的 CI 结果用于证明后续修改。
- 当前安装版原生宿主：Core-only、Core+Extras、普通 Creator + 独立 Identity/Core/Inspector；Extras 工具可见、停用和恢复；Inspector 独立卸载；Interaction 单独启停；Provider 撤销使依赖服务和旧 capability 失效。
- 本次还用候选实际安装包完成隔离 Host 验收。真实切换首次因维护策略残留旧 Character pin 被完整性检查阻止，自动恢复旧 Profile 后修复；重试通过。发布策略现在同步本次全部已验证包，失败恢复和 Session 保持有回归测试。当前 Host 的插件、Preset、Inspector 认证访问及未登录拒绝已验证。
- Worker：独立 Preset/Session、晚挂载 scoped tool 守卫、伪造 Memory 授权拒绝及冷恢复。模型和 QQ Sender 使用合成替身，不证明手机投递或复杂任务质量。
- 原生 Schedule 到期、去重与同 Session 的进程重启恢复已验证；没有稳定目标迁移或自动 Session 轮换。
- Inspector 已在 DSH Web 设置页实际操作；Desktop 使用安装版 relay 验证，尚缺实际桌面窗口验收。
- 100/1,000/10,000 条合成性能基线可用 `tests/inspector-benchmark.mjs` 重跑；同步 SQLite 和大库冷投影仍有阻塞，非并发服务吞吐保证。

## 尚未完成的验收

实际 Desktop 窗口中的完整操作、手机端实际收件及 QQ 审批按钮仍需真人验收。Gateway ready 不能证明手机投递成功。Inspector 保持 `writable:false`，没有开启 GUI 写入权限。

任务级细粒度授权、旧 Task Memory 正式导入、自动轮换及稳定 Schedule 目标、具备执行权限的专业 Worker、向量检索和 Mac 迁移均不是已交付能力。参见 [路线图](IMPLEMENTATION_ROADMAP.md)。

详细运行日志、截图、临时审计和模型对照记录仅留在本地忽略目录。历史版本可从 `RELEASE-test*.md` 查询，实际恢复始终使用 [当前集成说明](INTEGRATION.md)。
