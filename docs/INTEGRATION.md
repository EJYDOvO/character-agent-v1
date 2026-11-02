# 安装、迁移与恢复

完整的双仓库新安装、私有配置、离线数据备份与回滚步骤统一在 [QQTK 安装与恢复](https://github.com/EJYDOvO/harness-qq-toolkit-public/blob/main/docs/RESTORE.md)。在本分支配套验证时必须使用两边同名清理分支，不能混入旧 main 脚本。

Character 入口：

```sh
npm ci
node scripts/portable.cjs prepare --qqtk <ABSOLUTE_QQTK_CLONE> --config <PRIVATE_JSON> --home <NEW_EMPTY_HOME>
node scripts/portable.cjs install --qqtk <ABSOLUTE_QQTK_CLONE> --home <NEW_HOME>
node scripts/portable.cjs verify --qqtk <ABSOLUTE_QQTK_CLONE> --home <NEW_HOME>
```

私有配置基于 examples/portable.config.example.json。DSH rc.3、Node 24；构建只读官方 Creator，不复制发行文件进入 Git。Persona 路径、Preset、Home、数据目录、模型、唯一 Owner 与凭据变量显式配置。input:[text,image] 只在实际模型支持图片时声明。

Core 必需四运行包及 QQTK I/O/Manager；Remote Ops 声明可关闭，不要求维护后端。Inspector、Interaction、Long Tasks 与 Extras 根据明确配置选择，无需安装全部可选组件；关闭后不补旧发送路径。Inspector 默认只读，Long Tasks 默认无执行工具。社区 Worker 必须自行审查安装，工具不自动授予。

源码与用户数据分开；binding、Memory、coordination、路由、原生 Sessions/Schedule/storageDomain 和通知账本只保存在用户 Home 及本地私有备份。旧安装的非标准绝对路径需额外离线盘点，不自动迁移生产数据。

现有 prepare-deploy/prepare-host-upgrade、deployment-plan、switch/rollback 脚本保留用于已有 Windows 布局的离线候选/回滚回归，不是干净安装入口。它们的 directory/Profile 约定必须按目标实例审阅；本轮不运行生产切换。新安装只用 portable 入口，不依赖这些旧布局工具。

更改官方 Creator、SDK 或包版本后重新构建、固定哈希、隔离测试。回滚先验证旧代码能读取当前数据，不恢复旧 Memory/通知快照覆盖新增数据。版本及实际验证状态见 [STATUS](STATUS.md)。
