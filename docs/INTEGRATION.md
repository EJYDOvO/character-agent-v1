> 本文保留 test.2 的历史边界。当前 test.5 的已验证状态、部署与回滚说明以 [RELEASE-test5.md](RELEASE-test5.md) 和 [MANAGEMENT.md](MANAGEMENT.md) 为准。

# 集成与恢复边界

本仓库是原有 DSH + QQTK 部署上的扩展，不包含完整宿主和运维依赖。

1. 先确认目标 DSH/QQTK 版本、工具接口及唯一 Gateway。不要手工修改官方发行文件。
2. 在本机填写 Owner 绑定和 QQ 凭据，保持一个私聊 Owner、群聊 disabled。不要将真实 binding、Profile 或环境文件加入 Git。
3. 只读构建 Core，准备固定新版本产物及候选 Profile。在无生产凭据的隔离 Profile 先验证。`stage.cjs` 禁用 QQ/Remote Ops；集成探针使用 mock 身份。
4. 部署前重新确认宿主空闲、无待处理重要任务和审批；持有维护锁，停机并核实退出后备份。不要从活跃 SQLite 单独复制主文件。
5. 核对快照与候选文件的 SHA-256、锁文件、包版本及官方发行文件完整性，再单活切换。包管理器与打包过程需遵循现有部署约定；仓库不是一键安装流程。
6. 启动后分别核对插件 active、Preset、QQ ready、身份拒绝、审批及受控真实验收。进程已启动不等于服务健康，Sender 成功也不等于手机已收消息。

## 回滚

原流程保存离线数据快照、完整 previous Profile、QQ prefs 和 manifest。`rollback.ps1` 核对基线、确认空闲、停机后保留失败 Profile 并恢复旧 Profile 与 prefs，再启动。必须另行健康检查。

同 schema 的 Profile 回退不会自动覆盖新记忆。确实需要恢复数据时，先停机并保留当前数据，再恢复经校验的整套数据库/WAL/SHM。备份内含秘密，只能留在受控本地目录。

原版本升级没有实际演练生产回滚；公开脚本路径参数化以后也未做新的部署/回滚演练。旧 QQTK Stage 对 Character Profile 被阻止，避免重复装配 QQ/运维入口；后续升级必须审阅新候选流程。

`live-smoke.cjs` 会使用真实模型并可能向 Owner 发出明确测试消息，它不是离线测试。本仓库的 `npm test` 不执行该脚本。
