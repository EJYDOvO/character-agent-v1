# 集成、部署与恢复

当前 test.11 的配套部署、备份与验收边界见 [发布记录](RELEASE-test11.md)。`pack.cjs` 与源码摘要支持 `DSH_QQTK_PROJECT` 指定独立维护源码；`prepare-host-upgrade.cjs` 现在同时准备已有 Interaction 的独立版本以及 QQ/SDK 两份补丁，并固定 SDK 1.0.5。候选必须包含匹配的 Identity、Remote Ops、锁文件和维护代码，不可只复制新版 Core。旧部署辅助脚本仍不是通用一键升级器，尤其不得直接使用旧日期的门禁报告。

本仓库是 DSH + QQTK 上的扩展，不包含完整宿主和运维依赖。完整 Character 集成需要本机 DSH、desktop Profile 中可解析的 `js-yaml`、独立 QQTK 维护组件、Remote Ops 与版本匹配的 QQ 补丁。普通 Agent 只复用 Memory 或 QQ 时，先阅读 [REUSE.md](REUSE.md)。

## 使用脚本前

脚本通过 `DSH_INSTALL_ROOT`、`DSH_CHARACTER_PROJECT` 定位安装和源码，但仍保留原实例的 Profile、维护目录、包名、产物命名和验收文件约定。路径参数化不代表通用安装器。先审阅 build/stage/prepare/deploy/rollback 的实际要求，为目标实例准备独立配置及恢复点，不要直接在陌生实例执行部署脚本。

构建只生成源码产物；已有同版本不可变 tarball 不应被覆盖。更改源码后使用新的发布版本、重新打包并验证当前摘要，不能沿用旧验证文件。

Schema 3 的迁移工具采用复制后迁移。先在独立副本验证，再安排上线；旧 test.7 无法直接打开 Schema 3。具体数据边界见 [MEMORY-LAYERS.md](MEMORY-LAYERS.md)。

test.9 的 [审计修复](AUDIT-FIXES.md) 保持 Schema 3，新增信息放在既有来源 JSON，不重命名 namespace 或记忆 ID。升级前仍需备份、隔离安装和新版本包；旧人格化记录不会被批量重写。回退原 test.8 虽可读取相同 Schema，却会重新带回模式隔离和召回缺陷，不是安全等价回滚。

跨宿主验证可设置 `DSH_CHARACTER_HOST_ROOT` 为解包后的官方发行目录，`DSH_INSTALL_ROOT` 保持原实例路径。构建和探针从待测宿主读 Creator/SDK，不修改官方文件。`DSH_CHARACTER_TEST_HOME` 必须位于源码 `test-data` 下，隔离结果与重启 checkpoint 随测试目录保存。

`prepare-host-upgrade.cjs <new-profile-name>` 生成未启动的候选：保留单 Owner 策略，处理新版内置 Schedule、已停用旧记忆声明，以及空 Extras 的可选 Bundle 迁移。它不是完整安装器；须结合官方安装包签名/哈希、离线备份、单活切换和启动验证。新旧宿主不能共用生产 QQ 同时启动。跨宿主回滚必须同时恢复完整程序、Profile 和配套数据，旧 Profile 回滚脚本不足以完成宿主降级。当前实际结果见 [test.9](RELEASE-test9.md)。

修复后的 layered-host 重启基线使用 `.checkpoint-v2`，比较 ID、revision、status、fingerprint 与来源摘要。旧纯 ID checkpoint 不能证明这些字段一致；需要先用新探针完成初始运行，再执行 `--restart`。压缩执行受阻会报告 BLOCKED 且 `ok=false`，验证断言失败报告 FAIL；不得以单个旧 `ok` 或前一轮产物充当本轮验证。

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
