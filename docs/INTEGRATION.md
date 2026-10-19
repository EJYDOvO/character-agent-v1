# 集成、部署与恢复

本仓库是 DSH + QQTK 上的扩展，不包含完整宿主和运维依赖。完整 Character 集成需要本机 DSH、desktop Profile 中可解析的 `js-yaml`、独立 QQTK 维护组件、Remote Ops 与版本匹配的 QQ 补丁。普通 Agent 只复用 Memory 或 QQ 时，先阅读 [REUSE.md](REUSE.md)。

## 使用脚本前

脚本通过 `DSH_INSTALL_ROOT`、`DSH_CHARACTER_PROJECT` 定位安装和源码，但仍保留原实例的 Profile、维护目录、包名、产物命名和验收文件约定。路径参数化不代表通用安装器。先审阅 build/stage/prepare/deploy/rollback 的实际要求，为目标实例准备独立配置及恢复点，不要直接在陌生实例执行部署脚本。

构建只生成源码产物；已有同版本不可变 tarball 不应被覆盖。更改源码后使用新的发布版本、重新打包并验证当前摘要，不能沿用旧验证文件。

Schema 3 的迁移工具采用复制后迁移。先在独立副本验证，再安排上线；旧 test.7 无法直接打开 Schema 3。具体数据边界见 [MEMORY-LAYERS.md](MEMORY-LAYERS.md)。

## 部署顺序

1. 先确认目标 DSH/QQTK 版本、工具接口及唯一 Gateway。不要手工修改官方发行文件。
2. 在本机填写 Owner 绑定和 QQ 凭据，保持一个私聊 Owner、群聊 disabled。不要将真实 binding、Profile 或环境文件加入 Git。
3. 构建 Core（只读官方文件、写入自有产物），准备固定新版本包及候选 Profile。在无生产 QQ 凭据的隔离 Profile 先验证。`stage.cjs` 禁用 QQ/Remote Ops；集成探针使用 mock 身份。真实 QQ 探针须遵守单连接门禁并另行记录验证范围。
4. 部署前重新确认宿主空闲、无待处理重要任务和审批；持有维护锁，停机并核实退出后备份。不要从活跃 SQLite 单独复制主文件。
5. 核对快照与候选文件的 SHA-256、锁文件、包版本及官方发行文件完整性，再单活切换。包管理器与打包过程需遵循现有部署约定；仓库不是一键安装流程。
6. 启动后分别核对插件 active、Preset、QQ ready、身份拒绝、审批及受控真实验收。进程已启动不等于服务健康，Sender 成功也不等于手机已收消息。

## 回滚

当前流程保存离线数据快照、previous Profile、QQ prefs、维护策略及候选记录。`rollback.ps1` 核对基线、确认空闲并停机；`rollback.cjs` 校验快照，保留较新记忆库，再恢复快照记忆库、旧 Profile、QQ prefs 和维护策略。随后启动，仍需验证健康与 QQ 就绪。

这是恢复到快照时间点，不是自动逆迁移。即使 Schema 相同，当前回滚脚本也会恢复快照记忆；新版写入被保留在另一份库中，不会自动合并回去。回滚前明确数据影响、保留当前状态，正确处理数据库/WAL/SHM。备份内含秘密，只能留在受控本地目录。

实际验收范围见 [RELEASE-test8.md](RELEASE-test8.md)：test.8 的回滚验证使用真实脚本、旧运行时和隔离快照副本，并非生产降级演练。不要用通用 QQTK Stage 替代 Character 的候选流程，以免重复装配 QQ/运维入口。

`live-smoke.cjs` 会使用真实模型并可能向 Owner 发出明确测试消息，它不是离线测试。本仓库的 `npm test` 不执行该脚本。
