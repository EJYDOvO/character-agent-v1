# test.9：DSH 0.2.1-rc.2 适配与记忆审计修复

2026-10-19。本版本沿用四个运行插件与 Core/Extras，数据库仍为 Schema 3。包含 [test.8 审计修复](AUDIT-FIXES.md)，不新增记忆层级或 Worker Preset。

## 兼容改动

- Core 重新从实际安装包的 Creator 构建；本次原生 Creator 有 34 个工具，Character 有 47 个，保留所有 Creator 工具。
- `DSH_CHARACTER_HOST_ROOT` 可选择待验证的官方宿主，`DSH_INSTALL_ROOT` 继续定位既有实例配置与依赖。读取归档不会修改官方文件。
- 新宿主自带 Schedule 时，不再装入旧实验 Schedule Bundle。现有任务存储、Session 和通知账本保留。
- `prepare-host-upgrade.cjs` 只生成全新候选 Profile，检查单 Owner 私聊、锁文件基线和不可变产物。已停用的旧项目记忆移除装配，保留包与数据。
- Extras 为空。原本由旧 Extras 装配的搜索、Bilibili 在本机转为各自原生 Bundle，保留配置和功能，不重复装配 QQ。
- QQTK 健康检查和功能配置只要求实际装配的旧记忆插件，不重新生成失效的覆盖项。QQ Bot 仍为 0.5.2，Remote Ops 仍为 1.1.0。
- 隔离分层探针支持独立测试目录；结果与重启 checkpoint 同目录，避免另一份库的 checkpoint 或旧遗忘屏障污染本次验证。Compaction 从被测宿主加载 SDK。

## 已验证

- 新版自带 Node 24.21.0：72/72 Character 测试通过；QQ/审批/维护回归 18/18 通过。
- 新版真实 DSH 宿主：Core-only、Core+Extras 的工具继承、跨 Session 记忆、L3 注入、CAS、遗忘、未绑定身份拒绝、Schedule 创建/取消/到期和通知账本去重通过。
- 独立可信身份接入：实际配置模型完成本次两条输入的提取和跨事件巩固；来源关联、遗忘影响 L3 通过。
- 真实 `/compact` 成功，重启后再次成功；记忆 ID、revision、status、fingerprint 和来源摘要保持一致。
- 实际 QQ SessionManager 在新版宿主的隔离测试通过：创建/恢复保持 Session ID、历史消息、Character Preset 和 Host 绑定；未知 Preset 与非 Owner 被拒绝，detach 撤销身份。该探针不创建 QQ 网络连接，不使用生产会话。
- 候选安装的 17 个运行时模块与被测源码逐文件一致。官方安装器签名有效、SHA-512 匹配官方更新源；官方 ASAR 不做手工修改。

上述宿主测试使用合成身份/数据，Character 集成测试的通知 Sender 为替身；真实模型测试不连接 QQ。不能据此声称手机消息送达或按钮审批已通过。

## 部署与恢复

本机已部署并通过最终健康检查，详见 [STATUS](STATUS.md)。离线快照逐文件校验 1762 个文件，覆盖 Profile、Session、存储、QQ 状态、Character 数据与桌面配置，包含 SQLite WAL。旧完整官方运行时和旧 Profile 同时保留。生产的四插件、Remote Ops、QQ 和 Browser active；QQ 单次 ready，QQ Session 映射与快照一致，人格化 Character、单 Owner 和禁群策略保留。

首次上线被过严的 PID 相等门禁误判，自动回退程序和数据；独立核验确认旧宿主及 QQ 正常。修正进程树校验后再次升级成功。此次确实执行了恢复，不能仅以恢复脚本存在作为证据。未进行手机端消息/审批验收，也未通过生产记忆工具写入测试记录。

新版桌面服务运行在 Electron 子进程：健康检查需同时核对启动时间、进程父子关系、本次日志和 QQ ready，不能要求服务 PID 等于桌面启动 PID，也不能仅依赖历史健康文件。

回滚需要成套恢复旧运行时、Profile、维护策略及对应离线数据，先保留升级后的状态。不能只回退 ASAR 或以 Schema 相同为由忽略记忆策略变化；回退原 test.8 会带回已修复缺陷。旧 `deploy.ps1`/`rollback.ps1` 不是跨 DSH 版本的完整恢复脚本。

## 限制

手机端收件和真实按钮点击未重新验收。Self Model 任务结果理解、语义归纳正确性、事件级 L1 聚合与大库性能等原有限制仍在，见审计修复报告。本次未新增主动聊天，也未自动开放独立 Worker。
