# 集成、部署与恢复

版本与部署状态统一见 [STATUS](STATUS.md)。本仓库不包含 DSH 本体，不是通用一键安装器；现有运维入口仍面向 desktop Profile、单 Owner 私聊及 QQTK 维护目录。普通 Agent 复用模块见 [REUSE](REUSE.md)。

## 构建与候选准备

通过 `DSH_INSTALL_ROOT` / `DSH_CHARACTER_PROJECT` 指定安装与源码；`DSH_QQTK_PROJECT` 指定独立 QQTK 源码。官方 DSH 文件及内置 Bundle 不手工修改。Creator/SDK 从实际安装包读取，指纹变化后必须重新构建、测试。

- `pack.cjs` 默认打包自有九包，分别记录版本、源码摘要和 SHA-256；`--core-only` 只打包四个核心插件及 Core Bundle。打包不等于启用，Extras 与可选组件按当前有效声明选择。
- `prepare-deploy.cjs` / `prepare-host-upgrade.cjs` 共用依赖清单。Core 必需包必须存在；只有启用的 Inspector/Interaction/Long Tasks 才要求本次对应产物，未启用的已安装依赖保留。启用状态按自有 Core/Extras 和 Profile 覆盖计算，不自动扫描第三方任意代码动态装配。
- 配置选择遵循原生 patch 的替换语义，保留 `!!js` 条件但不执行。Preset 的 `config.plugins` 不能用全局子 ID 覆盖；需修改所属 Preset 声明。条件启停无法静态判定时保守保留产物，实际启停仍由 Host 决定。
- Extras 是否启用沿用 Profile；常规准备支持 `--extras` 显式启用。第三方搜索等已有 Bundle 保留，不能因替换 Core 而被移除。专业分析 Worker 在 Core 显式声明，与 Extras 启停无关。
- Remote Ops 不再由 Character 隐式重打包或写死版本。验证当前安装版本、Profile 的 pin、tarball 包元数据和 SHA-256 后保留相同版本；缺少 pin、哈希不符或版本不符直接失败。独立升级 QQTK 须先完成其受控升级及验收。
- 依据安装的 QQ Bot/SDK 版本选择两份版本化补丁；两条候选路径记录相同格式的版本/哈希。补丁文件、workspace、锁文件及已安装版本必须一致。没有匹配的已审阅补丁则拒绝准备。
- `task-memory` 声明存在则停用，已停用保持停用，缺失不报错；旧 Bundle 不重新激活。保留旧依赖与数据，不导入、不删除。
- `--inspector` 在唯一 Profile/Extras 声明上设置 `writable:false`。Inspector 是普通插件，不会自动获得 Bundle；Core 不依赖 Inspector。

候选复制旧锁文件只是安装输入。必须在隔离候选目录安装依赖、更新锁文件并完成冻结锁文件验证；部署门禁检查 specifier、安装版本、产物及 QQ/SDK patch hash，不能把准备成功当成可以切换。已有同版本产物若内容变化必须使用新版本，不能覆盖不可变包。

构建参数中的角色与数据目录必须与现有绑定一致。常规准备保留原始项目/角色绑定，不把项目重写为 `personal`。切换前再次核对绑定、Profile、QQ prefs、维护策略和官方 ASAR 基线。

切换时同步维护策略中本次全部已验证的包版本与哈希，包括新增 Inspector；未参与更新的包清单保留。只更新 Remote Ops 会使 Character 升级后的完整性检查失败。

## 验证与切换

1. `npm test`、`npm run test:audit`；原生隔离入口为 `run-inspector.ps1`、`--extras`、`--modules` 和 `run-interaction.ps1`。测试数据与结果只在 `test-data/`。
2. 在无生产 QQ 凭据的候选中确认插件装配、Worker/ACL、Session、提醒恢复与独立启停。不要同时启动同一 QQ 应用的两套 Gateway。
3. 实际部署另行授权，确认空闲及无待处理审批；持有维护锁，停机后制作含数据库/WAL、Session、Profile 和维护策略的一致快照。
4. 核验当前提交的测试证据、安装后的候选及快照；单活切换后检查健康、路由、权限及真实链路。进程启动或 Sender 无错误不是手机送达证明。

跨宿主测试可使用 `DSH_CHARACTER_HOST_ROOT` 选择官方发行目录。整机宿主降级还涉及匹配的官方程序、运行依赖及数据格式，不能仅运行 Profile 回滚脚本。

## 回滚

优先禁用可选 Inspector，保留 Core 与记忆库。回退 Core 必须停机并持锁；`rollback-memory.cjs` 创建当前数据库的一致副本，用旧运行时检查 Schema、记录、修订及遗忘屏障没有改变。

兼容时恢复旧 Profile、Binding、QQ prefs 与维护策略，**当前记忆数据库和新增记录保留原位**。不兼容则拒绝自动降级；checkpoint 仅作灾难恢复资源，不能自动覆盖新版写入。历史文档中的“恢复旧快照记忆库”不再是当前流程。

Schema 相同也不代表行为安全等价：旧 Core 可能重新带回已经修复的读取缺陷。需要维持新隐私保证时，只禁用/回退 GUI，不回退修复后的 Core。

失败 Profile 切换会恢复 Profile、Binding、QQ prefs 和策略；源码和合成安装测试覆盖该路径。完整生产切换、异常启动及实际 QQ 恢复仍需专门验收。部署脚本不自动启用轮换、迁移提醒、导入旧记忆或放开 Worker 权限。

test.13 仅在隔离环境验证。QQ 生命周期开关需明确配置；备份包含 DSH_HOME/qqbot 的路由和生命周期状态、原生 Session/Schedule/storageDomain，以及 Character coordination.sqlite（含 WAL）和 Memory。原协调库新增 qq_bindings/identity_state 两张表，Memory Schema 不变。旧提醒仍绑定原 Session，不要删除旧 Session 或只复制当前主路由。

长期任务必须另装可选包并启用 Extras 条目。停用/回滚前先取消不需执行的计划、等待当前工作结束并制作一致性备份；回滚不得用旧快照覆盖新增记忆或清空执行/通知账本。停用插件不自动删除计划；重新启用可能处理仍有效的逾期任务，详见 [恢复契约](../packages/long-tasks/README.md)。本轮未做生产安装、迁移或重启。
