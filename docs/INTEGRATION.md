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
2. 切换前版本锁定（只读）：保留生产实例的旧 testedRuntime 不变。在独立 Home 装配并审核目标候选 Profile，使用 QQTK `maintenance/pin-check.mjs --phase pre-switch --runtime <目标宿主> --profile <隔离候选Profile> --instance-profile <实际Profile>`。候选必须与实例 Profile 不同且互不包含；两者不得指向同一目录。检查目标 Host、精确依赖、补丁文件哈希、实际安装文件与候选 plugin-policy.json。缺失/损坏/不合法策略直接失败；本工具不创建或修改策略，不安装插件。仅候选检查通过不代表已切换。窗口内不确认 Desktop 更新或单独更新 QQ 包。
3. 确认空闲：没有运行中的 Agent、未完成的 Long Task occurrence 或待发送 Outbox；记录将在切换窗口内到期的提醒与任务。
4. 维护锁下停止宿主，做一致快照：Profile、Sessions、storages（含 Schedule 与 `character_long_tasks`）、coordination.sqlite、Memory（含 `-wal`/`-shm`，同一时刻复制）、QQ prefs 与通知账本；记录 Schedule 任务清单（id、target/session、状态、下次时间）。在快照上运行 `node scripts/rollback-gate.mjs record --home <DSH_HOME> --sqlite <coordination.sqlite> --sqlite <memory.sqlite> [--file <QQ prefs/会话状态>] --out <manifest>`，清单随快照保存。
5. 离线只读审计：`scripts/audit-qq-schedules.mjs` 对快照报告 bound / verified_missing / unproven / untrusted_target，未证明的提醒按原规则保持不执行。
6. 切换：一次性替换宿主与匹配的 Character/QQTK 包；Profile 实例自己的 `plugin-policy.json` 只更新 `testedRuntime` 与本次固定的包版本/哈希，不用仓库模板覆盖。
7. 切换后只读检查实际 Profile：`node <QQTK>/maintenance/pin-check.mjs --phase post-switch --runtime <目标宿主> --profile <实际Profile>` 必须通过；确认实际策略 testedRuntime、依赖与已安装补丁全部匹配。失败则保持维护状态、停止验收，不自动降级或恢复快照。启动后验收：单一 QQ Gateway 就绪、Preset 无 broken、Owner 提醒归属审计无新增异常、Schedule 清单与快照一致、Memory quick_check 与 Schema 不变；在 QQ 中实际收发与审批另行验收（mock 通过不等于手机送达）。

**回滚门禁（`scripts/rollback-gate.mjs check`，宿主停止后只读运行）：** 只比较 Schedule 文件哈希不够。门禁把当前数据与快照清单对比，逐项检查：每个 storage 单元的版本与内容（Schedule v1→v2 等）、per-record 域（`character_long_tasks`）的记录版本与运行中的 occurrence、Session 日志的格式版本与新增/改动、每个 SQLite 的 Schema/`user_version` 与经只读连接读出的逻辑内容（已提交的 WAL 帧计入）、Outbox `sending` 行，以及指定的状态文件。结论：

| 结论 | 退出码 | 含义 |
|---|---|---|
| `host_rollback_allowed` | 0 | 自快照后无任何改动：可停止新宿主，换回旧宿主与旧包，数据原地保留 |
| `host_rollback_needs_replay` | 2 | 格式与 Schema 未变，但新宿主写入了 Session/行/记录：先把当前数据复制到隔离 Home，用旧宿主加载验证后才可换回 |
| `host_rollback_refused` | 3 | 有存储单元、Session 格式或 Schema 前进（如 Schedule 已是 v2），或存在进行中的 Outbox/Long Task：不能只换宿主 |

被拒绝时只剩整体恢复快照：门禁列出的所有改动（新提醒、投递回执、任务账本、Session、Memory、通知）都会丢失，这与“不覆盖新数据”的规则冲突，须由维护者明确决定；默认修复前进。门禁不复制、不恢复也不写入任何数据。四进程演练中，rc.3 写入后为 `allowed`，rc.1 首次写入后为 `refused`（`schedule version 1 -> 2`），rc.3 随后确实无法加载 v2。

**已知残余：** 0.2.1 写入、此后从未修改过的 Schedule 行没有 `updatedAt`，原生工具参数无法携带 null CAS，Owner 对这类行的第一次修改不能钉住修订号；执行时的新鲜视图仍会先确认归属，窗口只剩该次视图与原生写入之间。


### 部署门禁补充：候选与实例分离

切换前只检查隔离候选：

```sh
node <QQTK>/maintenance/pin-check.mjs --phase pre-switch --runtime <TARGET_HOST> --profile <CANDIDATE_PROFILE> --instance-profile <INSTANCE_PROFILE>
```

旧实例保留旧 testedRuntime；候选的 plugin-policy.json 须经维护者审阅，明确 schemaVersion、profile、testedRuntime、精确 targets、qqPatch 和 localPackages。不要为通过校验而修改旧实例，也不要用模板覆盖实例策略。

另行批准切换后，检查实际实例：

```sh
node <QQTK>/maintenance/pin-check.mjs --phase post-switch --runtime <TARGET_HOST> --profile <INSTANCE_PROFILE>
```

两阶段均严格检查目标版本、补丁 pin/文件哈希和已安装文件；工具没有安装、修改策略或切换能力。

回滚门禁使用格式版本 2 清单。停机维护锁下 record，check 使用完全相同的绝对 Home、全部 --sqlite 与 --file 参数；不得省略或替换监控路径。新增、修改、删除 Session/记录域/记录/状态文件均计入，Schedule 版本及 SQLite Schema 前进、损坏、缺失或无法确定状态均拒绝。指定 --file 是 JSON 状态文件。旧清单须重新从一致快照生成，不能编辑为通过。SQLite 主文件和 WAL 按一致快照保管；WAL 内容变化也需回放验证。

allowed（退出 0）只表示监控状态完全未变；needs_replay（2）须复制当前数据到隔离旧 Host 验证；refused（3）不得只换宿主。任何可能丢失新增数据的整体快照恢复均须维护者单独明确决定，默认向前修复。

旧 TaskMemoryStore 的 task-memory/*.json 为自定义 vault（taskId/title/updatedAt/entries），不按原生 per-record 解码；门禁完整记录原始哈希，仅完全未变允许，新增、修改、删除或损坏均拒绝，不自动迁移或排除这些文件。
