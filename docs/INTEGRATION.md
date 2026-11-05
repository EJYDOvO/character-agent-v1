# 安装、迁移与恢复

完整的双仓库新安装、私有配置、离线数据备份与回滚步骤统一在 [QQTK 安装与恢复](https://github.com/EJYDOvO/harness-qq-toolkit-public/blob/main/docs/RESTORE.md)。在本分支配套验证时必须使用两边同名清理分支，不能混入旧 main 脚本。

Character 入口：

```sh
npm ci
node scripts/portable.cjs prepare --qqtk <ABSOLUTE_QQTK_CLONE> --config <PRIVATE_JSON> --home <NEW_EMPTY_HOME>
node scripts/portable.cjs install --qqtk <ABSOLUTE_QQTK_CLONE> --home <NEW_HOME>
node scripts/portable.cjs verify --qqtk <ABSOLUTE_QQTK_CLONE> --home <NEW_HOME>
```

私有配置基于 examples/portable.config.example.json。DSH 0.2.2-rc.1、Node 24；构建只读官方 Creator，不复制发行文件进入 Git。Persona 路径、Preset、Home、数据目录、模型、唯一 Owner 与凭据变量显式配置。input:[text,image] 只在实际模型支持图片时声明。

开启 roles 时 prepare 另外装配 QQTK `dsh-identity-access`、写入私有 `identity-owner.json`，并生成 `character`/`character-contact`/`character-guest`（可选 `qq-character` Owner 别名）。已有单 Owner 实例迁移前先停机一致备份；旧 Session、提醒绑定与 Memory 命名空间按 [Identity & Access](IDENTITY-ACCESS.md) 的兼容规则保留，不改 Memory Schema。

Core 必需四运行包及 QQTK I/O/Manager；Remote Ops 声明可关闭，不要求维护后端。Inspector、Interaction、Long Tasks 与 Extras 根据明确配置选择，无需安装全部可选组件；关闭后不补旧发送路径。Inspector 默认只读，Long Tasks 默认无执行工具。社区 Worker 必须自行审查安装，工具不自动授予。

源码与用户数据分开；binding、Memory、coordination、路由、原生 Sessions/Schedule/storageDomain 和通知账本只保存在用户 Home 及本地私有备份。旧安装的非标准绝对路径需额外离线盘点，不自动迁移生产数据。

现有 prepare-deploy/prepare-host-upgrade、deployment-plan、switch/rollback 脚本保留用于已有 Windows 布局的离线候选/回滚回归，不是干净安装入口。它们的 directory/Profile 约定必须按目标实例审阅；本轮不运行生产切换。新安装只用 portable 入口，不依赖这些旧布局工具。

更改官方 Creator、SDK 或包版本后重新构建、固定哈希、隔离测试。回滚先验证旧代码能读取当前数据，不恢复旧 Memory/通知快照覆盖新增数据。版本及实际验证状态见 [STATUS](STATUS.md)。

## 从 DSH 0.2.1 升级到 0.2.2-rc.1

Character 0.1.0-test.30 与 QQTK Conversation Manager 0.1.0-test.5 只使用 0.2.2 的 Schedule API（`create/edit/view/catalog`），不能运行在 0.2.1 Host 上；旧版 Character 也不能运行在 0.2.2 上。宿主、Character 与 QQTK 必须作为一组切换。

**Schedule 存储惰性升级。** 0.2.2 直接读取 v1 Schedule 存储，启动与读取不写盘；第一次修改或到期投递把存储单元升级为 v2，未被写入的行保持原形状并照常解码（v1 的 Session 绑定成为 `target:{kind:'session'}`，`inactive` 读作 `ended`）。不使用自制迁移脚本。**旧 0.2.1 Host 不能加载 v2**（Schedule 服务启动失败：`stored version 2 != expected 1`），所以一旦新宿主写过 Schedule，回滚宿主就不再是可用路径。

**升级前检查清单（另行授权的停机窗口内）：**

1. 记录当前宿主、Character、QQTK、Preset Manager 版本与包哈希；在隔离 Home 用目标宿主跑完单元、安全、原生宿主、冷恢复与 `scripts/run-schedule-migration.ps1`。
2. 确认空闲：没有运行中的 Agent、未完成的 Long Task occurrence 或待发送 Outbox；记录将在切换窗口内到期的提醒与任务。
3. 维护锁下停止宿主，做一致快照：Profile、Sessions、storages（含 Schedule 与 `character_long_tasks`）、coordination.sqlite、Memory（含 WAL）、QQ prefs 与通知账本；记录 Schedule 任务清单（id、target/session、状态、下次时间）及文件 SHA-256。
4. 离线只读审计：`scripts/audit-qq-schedules.mjs` 对快照报告 bound / verified_missing / unproven / untrusted_target，未证明的提醒按原规则保持不执行。
5. 切换：一次性替换宿主与匹配的 Character/QQTK 包；Profile 实例自己的 `plugin-policy.json` 只更新 `testedRuntime` 与本次固定的包版本/哈希，不用仓库模板覆盖。
6. 启动后验收：单一 QQ Gateway 就绪、Preset 无 broken、Owner 提醒归属审计无新增异常、Schedule 清单与快照一致、Memory quick_check 与 Schema 不变；在 QQ 中实际收发与审批另行验收（mock 通过不等于手机送达）。

**回滚边界：** Schedule 尚未被新宿主写入（文件哈希仍等于快照）时，可停止新宿主、换回旧宿主与旧包，数据保持原样。已写入 v2 后，回滚只能整体恢复切换前快照，会丢失窗口内的新提醒、投递回执、任务账本、Session 与通知；这与“不覆盖新数据”的规则冲突，须由维护者明确决定，默认优先修复前进而不是回滚。
