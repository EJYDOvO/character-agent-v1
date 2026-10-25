# 当前状态

本页是版本与验收状态的统一入口。历史发布记录说明当时结果，不代表最新运行状态。

## 安装与源码

**当前实例 test.13（2026-10-25 已部署）**：QQTK 的重启/12h 无用户输入换空白主 Session、独立长期任务均已显式启用；源码和 Extras 默认仍停用。长期任务仅开放模型分析，没有执行工具或 Memory 权限。原生 Schedule/Session/Preset/storageDomain 与现有 Outbox 保持复用，单 Owner 私聊和原角色、模型配置不变。Inspector 维持只读、人格化维持 Character。配置与恢复见 [Long Tasks](../packages/long-tasks/README.md) 和 [功能管理](MANAGEMENT.md)。

test.13 隔离验证：Character 单元/安全回归 **127 + 33 = 160**，QQTK 轻量/真实 SDK 边界 **24 + 34 = 58**，全部通过、无跳过。当前 rc.2 原生 Host 的 Core-only、Core+Extras、通用模块启停与 Interaction 回归通过；长期任务验证两个独立 Host 进程、停机逾期、实际周期到期、独立 Session/工具权限/Memory 拒绝、重复拒绝、旧提醒冷恢复、稳定 Conversation 通知及真实插件卸载后的拒绝执行。实际候选安装包使用 DSH 原生依赖解析通过，无测试 SDK 别名。隔离模型和 Sender 为合成替身，不代表手机收件或实际业务任务质量。

部署后发现并修复 Remote Ops 预热被误算为用户输入的问题：预热不改变路由、不更新用户计时，真实 QQ messageId 的入站才检查轮换。已补充单元、双进程及真实启动门禁；修正版启动验证通过。当前仅一套 QQ Gateway，插件/Preset 正常、Host 空闲、Inspector 认证访问与未登录拒绝通过；记忆完整性正常，官方 ASAR、绑定及启动前路由/计时保持不变。保留了一致性快照及旧 Profile，未执行生产回滚演练，也未发送 QQ 验收消息。

### test.12 历史部署记录

test.12 当时的实例：DSH **0.2.1-rc.2**，Character/Core/Extras **test.12**，Remote Ops **1.1.1-test.1**，Interaction 和 Inspector **0.1.0-test.2**，QQ Bot **0.5.2**、SDK **1.0.5**。当时完成一致性备份、冻结锁文件、切换和重启；本轮保留这些第三方版本。

test.12 包含原生分析 Worker、可选 Inspector，以及遗忘脱敏、分层筛选、异步请求和保留新增记忆的回滚修复。Inspector 已以 **`writable:false`** 启用；人格化保持 Character 模式。现有角色绑定、QQ Session 路由与官方 ASAR 哈希保持一致，记忆数据库完整性检查通过。后续修改已发布包内容必须分配新版本，不能覆盖不可变包。

## test.12 历史验证范围

- 本次单元测试 **115/115**、审计回归 **33/33**，无跳过。公开提交 `889f46a` 的 [GitHub Actions](https://github.com/EJYDOvO/character-agent-v1/actions/runs/39385106958) 已在 Linux/Windows 成功；本次追加的完整维护版本清单修复已在本地回归，不将前一提交的 CI 结果用于证明后续修改。
- 当前安装版原生宿主：Core-only、Core+Extras、普通 Creator + 独立 Identity/Core/Inspector；Extras 工具可见、停用和恢复；Inspector 独立卸载；Interaction 单独启停；Provider 撤销使依赖服务和旧 capability 失效。
- 本次还用候选实际安装包完成隔离 Host 验收。真实切换首次因维护策略残留旧 Character pin 被完整性检查阻止，自动恢复旧 Profile 后修复；重试通过。发布策略现在同步本次全部已验证包，失败恢复和 Session 保持有回归测试。当前 Host 的插件、Preset、Inspector 认证访问及未登录拒绝已验证。
- Worker：独立 Preset/Session、晚挂载 scoped tool 守卫、伪造 Memory 授权拒绝及冷恢复。模型和 QQ Sender 使用合成替身，不证明手机投递或复杂任务质量。
- 原生 Schedule 到期、去重与同 Session 的进程重启恢复已验证；没有稳定目标迁移或自动 Session 轮换。
- Inspector 已在 DSH Web 设置页实际操作；Desktop 使用安装版 relay 验证，尚缺实际桌面窗口验收。
- 100/1,000/10,000 条合成性能基线可用 `tests/inspector-benchmark.mjs` 重跑；同步 SQLite 和大库冷投影仍有阻塞，非并发服务吞吐保证。

## 尚未完成的验收

实际 Desktop 窗口中的完整操作、手机端实际收件及 QQ 审批按钮仍需真人验收。Gateway ready 不能证明手机投递成功。Inspector 保持 `writable:false`，没有开启 GUI 写入权限。

任务级细粒度 grants、旧 Task Memory 正式导入、提醒目标迁移、具备执行权限的专业 Worker、向量检索和 Mac 迁移仍未交付。test.13 的真实 QQ 收件、业务任务效果及完整 HMR 仍需验收；参见 [路线图](IMPLEMENTATION_ROADMAP.md)。

详细运行日志、截图、临时审计和模型对照记录仅留在本地忽略目录。历史版本可从 `RELEASE-test*.md` 查询，实际恢复始终使用 [当前集成说明](INTEGRATION.md)。
