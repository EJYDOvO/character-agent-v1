# test.7：通用依赖拆分交付

日期：2026-10-19。以本机官方 DSH 0.2.0-rc.2、QQ 0.5.2 为准。Character test.7 / Remote Ops 1.1.0 已部署。官方发行文件未修改，私人角色沿用原配置。

## 已完成

- 基础 QQ 去除 Remote Ops 硬依赖；修复用户目录偏好跨项目串用，DSH_HOME 独立隔离；进程内共享 Gateway 租约；Preset 失效拒绝降级。
- Remote Ops 保留独立包，支持独立 Owner/stateDirectory、可信 Host 后端和旧 Windows root 后端。
- Memory Core/Tools 通过 memoryIdentity v1 使用通用授权与可信来源，保留原 SQLite/FTS5/CAS/提取/治理引擎及旧数据库 scope。
- Character 专用确认、角色提示和通知查询移至现有包内集成入口；旧 character_* 工具保留，四运行时包结构不变。
- Definition 路径、Preset ID、数据目录参数化；Creator 指纹检查与构建派生保留。

接口和安装示例：[ARCHITECTURE](ARCHITECTURE.md)、[REUSE](REUSE.md)。

## 验收证据

| 组合/测试 | 状态 | 实际覆盖 |
|---|---|---|
| A：普通 Agent + QQ，无 Character/Remote Ops | 已验证 | 独立 Profile 仅安装 QQ，真实 SDK ready；普通 Creator、Session 创建/恢复、无效 Preset 拒绝、共享租约为1 |
| B：普通 Agent + Memory，无 Character Identity | 已验证 | 原生宿主，独立可信 Provider；九工具、中文检索/跨 Session 注入、Host 确认、CAS/遗忘、重启恢复；真实配置模型提取及本次消息来源关联，共8项 |
| C：完整 Character | 已验证 | 现有 Owner Session 恢复；真实模型 remember→recall→forget→recall，通过唯一 requestId/序号边界核对本次结果 |
| D：Core-only / Core+Extras | 已验证 | 各10项隔离宿主回归；两个配置分别真实生产启动，各1个 QQ ready |
| 自动测试 | 已验证 | Character 32/32；QQ审批/边界/Remote Ops 15/15 |
| 旧版恢复 | 已验证 | 停机检查点后实际恢复 test.6、健康且QQ ready=1，再切回 test.7 + Extras |
| 生产访问/依赖校验 | 已验证 | Doctor/verify通过，单私人 Owner、群聊禁用，官方 ASAR 哈希保持不变 |
| 手机收件/审批按钮 | 未验证 | 本轮未让用户点击，不将 Mock 或 API 成功等同于手机验收 |
| macOS/其他 DSH 版本 | 未验证 | 未在这些实际宿主运行；旧 Windows 维护后端仍需平台适配 |

本机原始证据位于忽略的 artifacts：test-results、generic-memory-host、generic-qq-host、core-only-host、core-extras-host、refactor-deployment、唯一请求命名的 live-smoke 报告。测试与部署门禁关联源码摘要和 QQ 补丁哈希。原始凭据、消息与报告不进入公共仓库。

首次 QQ-only 验收确实失败：上游 PrefsStore 读取了用户目录中的 Character 偏好。流程恢复旧生产版后加入 DSH_HOME 补丁并重跑，最终A通过；没有把失败记录改写成通过。

## 数据与回滚

先保存源代码/配置和 SQLite 在线快照，再在空闲、维护锁、停止全部宿主后完成201文件离线检查点。候选包/补丁通过哈希门禁后单活切换。实际执行 test.7 Core-only → test.6 旧 Profile → test.7 Core+Extras，均通过健康检查。

本次没有新 Schema Migration，SQLite Schema仍为2。回滚演练只切换 Profile、插件和维护策略，数据库、Session、提醒与通知记录原位保留。生产记忆验收只写入带唯一标识的临时记录，随后通过记忆工具遗忘，审计/遗忘来源记录仍保留。

本机旧 Profile 和检查点路径保存在私有部署记录中。将来回滚：先空闲/停机，验证旧 Profile及包哈希，恢复匹配的旧维护策略，保持现有数据，启动并验证QQ单例/会话恢复。不要直接用历史 `rollback.cjs` 覆盖升级后数据库；该脚本是旧全量恢复流程。未来 Schema升级需重新评估兼容性。

## 尚未解除的耦合与限制

- Character Adapter 仍依赖 QQTK attach/notifyEvent，用于恢复Owner路由和统一通知账本，这是项目集成边界；通用QQ与通用Memory无此依赖。
- 历史包名仍为 dsh-character-memory-*，服务别名 characterMemory 和旧SQLite列名 character保留，避免破坏存量引用与数据。
- Core/Extras及本机部署适配器仍属于Character项目；prepare-deploy拒绝自作主张迁移角色身份/路由/数据路径。
- Remote Ops 独立后端的 stop 只停止Owner主会话；维护任务和子Agent树需可信维护后端。旧Windows脚本没有冒充通用跨平台实现。
- Remote Ops 动态增删需重载 Gateway。进程内单例不能替代跨进程/跨机器互斥。
- 不新增记忆层级、跨经历巩固、摘要投影、记忆消费策略、Worker或主动闲聊。既有语义冲突判断与遗忘相似度边界仍存在，不宣称已解决全部长期记忆问题。
