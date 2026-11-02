# 集成、部署与恢复

版本与部署状态统一见 [STATUS](STATUS.md)。本仓库不包含 DSH 本体，不是通用一键安装器；现有运维入口仍面向 desktop Profile、单 Owner 私聊及 QQTK 维护目录。普通 Agent 复用模块见 [REUSE](REUSE.md)。

## 单模型图片能力声明

rc.3 的原生 `read_image` 检查当前实际 provider/model 的 `inputModalities`。服务能够看图但配置没有声明 image 时，工具会在读取前拒绝；不能移除这个门禁，也不能只在 QQ 附件侧标为图片。

test.28 候选准备支持显式 `--model-inputs=<本地审核过的 JSON 文件>`，可传给 `prepare-deploy.cjs` 或 `prepare-host-upgrade.cjs <候选目录名>`。文件格式为 `[{"provider":"provider-id","model":"model-id","input":["text","image"]}]`。仅允许修改已配置的原生 pi-ai `providers[provider].models[].input`；保留凭据引用、其他模型和配置，未知/重复目标、冲突的 modelOverrides 或读取失败会拒绝准备。rc.3 自定义 models 列表不能同时使用 modelOverrides。未提供参数则不改变能力声明，不能按模型名字自动推断支持图片。

这只准备候选，部署仍需独立授权。无凭据隔离 Host 的原生元数据/read_image 正负对照通过；随后使用当前模型，在独立 Session 中实际读取随机合成 PNG，并正确识别颜色和数字。QQ 图片下载/展示及手机收件仍须实机验收，现有部署的能力声明未因此改变。

## Iteration 08 门禁与后续实例切换

本机 2026-11-02 已授权部署；后续实例仍需独立通过以下门禁。成套版本为 Character test.27、Agent I/O test.8、Conversation Manager test.3、Remote Ops `1.1.1-test.3` 与本轮 QQ 0.5.2 补丁；SDK 1.0.5 补丁保持兼容。Interaction test.9、Inspector test.3、Long Tasks test.1 不变。Character QQ Adapter 启动前检查 `gatewayLifecycleContractVersion:1`，QQ 入口要求 I/O 的 scoped reply；缺失即拒绝，不回退 Creator 或旧 Sender。

已有 pin 默认保留。明确升级独立包时，使用 `--agent-io-artifact=<绝对 tgz 路径>`、`--conversation-artifact=<绝对 tgz 路径>`、`--remote-ops-artifact=<绝对 tgz 路径>`；准备脚本核对名称、变化后的版本、内容接口与哈希，并保留旧包。新补丁要求 Manager 的脱敏/诊断契约，旧 Manager 必须显式升级。状态文件仍须存在；没有空路由初始化或数据迁移。开发时已通过合成 Profile 门禁，本次另获授权完成实际冷切换；现场结果见 STATUS。

Iteration 09 的受控切换顺序：重新确认 main/候选 SHA 和包/补丁哈希 → 独立 Profile 冻结安装及完整原生回归 → 获得部署授权 → 空闲/审批/未完成任务检查 → 停净 Host 并一致备份 Memory、Session、Schedule、Manager、SQLite Outbox 和 JSON Ledger → 单活冷切换 → 检查所有必需服务、唯一 Gateway、当前 Session 与数据保留 → 用户手机验收。不能把 API accepted 当作手机到达；unknown/partial 禁止盲重发。没有这些证据不得自动进入下一步。

Remote Ops 单独卸载会撤销旧命令和监听器，单独重装不自动接回存活 Gateway；必须重载 QQ Gateway 才能恢复新命令和通知器。重新准备候选时按最终源码重打包并验证哈希，不能使用复审前的同版本候选产物。长命令超过 300 秒输入回复授权不代表执行失败，应通过原有任务记录/通知核对，不要重发同一请求触发操作。

手机验收至少包含：短/长文本与气泡、Hang-on、重复推送、/stop/更正、审批允许/拒绝及多题问答、附件、历史提醒与长任务/维护通知、关闭可选模块、重启和断网恢复。Desktop/Web 原生回退另验。观察到通知疑似丢失时先核对 Outbox 与 I/O 诊断，不重置账本。

回滚必须先停净进程，再成套恢复旧 Profile、包/锁/补丁及维护策略；保留最新 Memory、Session、Schedule 和通知账本。旧代码不支持的新终态仍禁止重发；不要恢复旧 SQLite/JSON 快照覆盖新增记录。本次健康门禁触发的自动回退已验证旧 Profile 可恢复，当前用户数据保留；其他故障场景未完整演练。

## test.21 的历史引入步骤

Core 声明独立 `dsh-conversation-manager@0.1.0-test.1`，QQ 补丁和 Character Adapter 原生依赖该服务，Identity 要求公开 ownership 契约。包源码在独立 QQTK 仓库，不由 Character pack 隐式重打包。必须先审阅/打包并在离线 Profile 中安装固定 tarball，记录 `character-artifacts.json` 的 source/version/SHA-256，再准备 Character 候选。

QQTK Iteration 01 起，QQ 补丁与 Character QQ 包装还原生依赖独立 `dsh-agent-io`（统一普通文本出站，源码同在 QQTK `plugin-sources/`）。Core 构建声明 `agent-io`；补丁要求该服务而 Core 未声明时准备脚本拒绝。Profile 已固定该包时按 source/version/SHA-256 复核；首次装配须显式传 `--agent-io-artifact=<已审阅 tarball 的绝对路径>`，脚本校验包名/版本并复制到 `plugin-packages/` 后固定，不自动打包或下载。已安装旧版而补丁需要新接口（如 `openConversation()`）时，同样显式传该参数升级：先按固定记录复核已安装包，新包须为另一个版本并提供补丁所需接口；旧 tarball 保留在 `plugin-packages/` 与切换前的旧 Profile 中，回滚随 Profile 恢复。不传参数时仍拒绝准备。QQTK Iteration 05 的补丁调用 `openCommands()`：此时新包须同时提供 `openConversation()` 与 `openCommands()`（`dsh-agent-io@0.1.0-test.5` 或更新），已安装 test.4 须按同一方式显式升级。QQTK Iteration 06 的补丁调用 `openHITL()`：新包还须提供 `openHITL()` 与 HITL Bridge 模块（`dsh-agent-io@0.1.0-test.6` 或更新），已安装 test.5 同样须显式升级。QQTK Iteration 07 的补丁调用 `openNotifications()`：新包还须提供它（`dsh-agent-io@0.1.0-test.7` 或更新），已安装 test.6 同样须显式升级；配套 Character test.26（Identity Outbox 改经通知器发送，不迁移、不改 SQLite 表）。Remote Ops `1.1.1-test.2` 不是 Character 部署的前提，已部署的 `1.1.1-test.1` 继续委托 Outbox。缺少该服务时 QQ Gateway 拒绝启动，不退回旧直接发送路径。

首次切换前清点并一致备份 Memory、配置、原生 Sessions/Schedule/storageDomain、旧 prefs、Identity binding/coordination 及通知账本；保留任务 ID、原提醒根及所有去重状态。Core 默认的 stateFile 为 Character 数据目录下的 `conversations.json`；经审查完整复制旧偏好，或明确调整该服务声明，不能以缺省空文件替代。准备脚本核对独立依赖的已安装版本/包元数据/哈希，并要求首次跨旧 Core 提供 `--conversation-state-reviewed` 以及存在的状态文件；缺失即阻断，不隐式迁移或授权。

本机已授权完成首次离线清点、精确复制原路由、安装独立包和单活切换，具体状态见 STATUS；这些步骤不授权其他实例直接切换。首次引入依赖应先在独立候选 Profile 安装并固定包/哈希，不能为了通过现有包校验而修改活动 Profile。回滚须配套恢复 QQ 补丁、Identity/Core、Profile 和锁文件；保留新增 Memory/Session/任务/通知以及当前路由，禁止用旧 prefs 快照覆盖切换后的活动。SDK 补丁不变。新旧接口不兼容时停用入口并审查，不能回退 Creator。

## 构建与候选准备

通过 `DSH_INSTALL_ROOT` / `DSH_CHARACTER_PROJECT` 指定安装与源码；`DSH_QQTK_PROJECT` 指定独立 QQTK 源码。官方 DSH 文件及内置 Bundle 不手工修改。Creator/SDK 从实际安装包读取，指纹变化后必须重新构建、测试。

- `pack.cjs` 默认打包自有九包，分别记录版本、源码摘要和 SHA-256；`--core-only` 只打包四个核心插件及 Core Bundle。打包不等于启用，Extras 与可选组件按当前有效声明选择。
- `prepare-deploy.cjs` / `prepare-host-upgrade.cjs` 共用依赖清单。Core 必需包必须存在；只有启用的 Inspector/Interaction/Long Tasks 才要求本次对应产物，未启用的已安装依赖保留。启用状态按自有 Core/Extras 和 Profile 覆盖计算，不自动扫描第三方任意代码动态装配。
- 配置选择遵循原生 patch 的替换语义，保留 `!!js` 条件但不执行。Preset 的 `config.plugins` 不能用全局子 ID 覆盖；需修改所属 Preset 声明。条件启停无法静态判定时保守保留产物，实际启停仍由 Host 决定。
- Extras 是否启用沿用 Profile；常规准备支持 `--extras` 显式启用。第三方搜索等已有 Bundle 保留，不能因替换 Core 而被移除。专业分析 Worker 在 Core 显式声明，与 Extras 启停无关。
- Remote Ops 不由 Character 隐式重打包或写死版本。默认验证当前安装版本、Profile 的 pin、tarball 包元数据和 SHA-256 后保留相同版本；缺少 pin、哈希不符或版本不符直接失败。Iteration 08 支持以 `--remote-ops-artifact` 显式审查候选升级；没有参数不得更换版本，候选仍需独立验收。
- 依据安装的 QQ Bot/SDK 版本选择两份版本化补丁；两条候选路径记录相同格式的版本/哈希。补丁文件、workspace、锁文件及已安装版本必须一致。没有匹配的已审阅补丁则拒绝准备。
- `task-memory` 声明存在则停用，已停用保持停用，缺失不报错；旧 Bundle 不重新激活。保留旧依赖与数据，不导入、不删除。
- `--inspector` 在唯一 Profile/Extras 声明上设置 `writable:false`。Inspector 是普通插件，不会自动获得 Bundle；Core 不依赖 Inspector。

候选复制旧锁文件只是安装输入。必须在隔离候选目录安装依赖、更新锁文件并完成冻结锁文件验证；部署门禁检查 specifier、安装版本、产物及 QQ/SDK patch hash，不能把准备成功当成可以切换。已有同版本产物若内容变化必须使用新版本，不能覆盖不可变包。

构建参数中的角色与数据目录必须与现有绑定一致。常规准备保留原始项目/角色绑定，不把项目重写为 `personal`。切换前再次核对绑定、Profile、QQ prefs、维护策略和官方 ASAR 基线。

切换时同步维护策略中本次全部已验证的包版本与哈希，包括新增 Inspector；未参与更新的包清单保留。只更新 Remote Ops 会使 Character 升级后的完整性检查失败。

独立 [Preset Manager](https://github.com/EJYDOvO/dsh-preset-manager) 使用自己的原生 Profile Bundle，不复制到 Core/Extras。切换脚本保留 Profile 内 `.dsh-preset-manager/` 的自定义配置、合并基线及 Skills 版本；更新前仍需随 Profile 一致备份。回滚时较新状态随失败 Profile 保留；重新安装该插件前核对并恢复对应目录，不以空状态覆盖它。

## 验证与切换

1. `npm test`、`npm run test:audit`；原生隔离入口为 `run-inspector.ps1`、`--extras`、`--modules` 和 `run-interaction.ps1`。测试数据与结果只在 `test-data/`。
2. 在无生产 QQ 凭据的候选中确认插件装配、Worker/ACL、Session、提醒恢复与独立启停。不要同时启动同一 QQ 应用的两套 Gateway。
3. 实际部署另行授权，确认空闲及无待处理审批；持有维护锁，停机后制作含数据库/WAL、Session、Profile 和维护策略的一致快照。
4. 核验当前提交的测试证据、安装后的候选及快照；单活切换后检查健康、路由、权限及真实链路。进程启动或 Sender 无错误不是手机送达证明。

跨宿主测试可使用 `DSH_CHARACTER_HOST_ROOT` 选择官方发行目录。整机宿主降级还涉及匹配的官方程序、运行依赖及数据格式，不能仅运行 Profile 回滚脚本。

## 回滚

test.16 的社区 ID/别名修复没有数据迁移；本次保留 test.15 Profile 与一致性快照。回退仍须停机持锁、验证当前 Memory 的一致副本并保留新增数据，不能覆盖旧快照。若以后启用了社区目标，回退前还要核查已有子 Session 对真实 Preset ID 的依赖；别名不能替代缺失的目标。test.16 本轮未执行生产回滚演练。

test.15 / Worker V2 不更改 Memory Schema，不需要数据迁移。部署与恢复时按构建清单逐项核对 Worker Preset，不能将默认关闭的 review 或未配置的社区 Preset 当作启动必需项。本轮已实际回退到保留的 test.14 Profile 并再次上线，当前记忆始终保留；该回滚点包含 Interaction test.3、匹配 QQ 补丁和搜索 0.9.15，不能拿未经回复修复的同名 test.14 产物替代。验证范围统一见 STATUS。

优先禁用可选 Inspector，保留 Core 与记忆库。回退 Core 必须停机并持锁；`rollback-memory.cjs` 创建当前数据库的一致副本，用旧运行时检查 Schema、记录、修订及遗忘屏障没有改变。

兼容时恢复旧 Profile、Binding、QQ prefs 与维护策略，**当前记忆数据库和新增记录保留原位**。不兼容则拒绝自动降级；checkpoint 仅作灾难恢复资源，不能自动覆盖新版写入。历史文档中的“恢复旧快照记忆库”不再是当前流程。

Schema 相同也不代表行为安全等价：旧 Core 可能重新带回已经修复的读取缺陷。需要维持新隐私保证时，只禁用/回退 GUI，不回退修复后的 Core。

失败 Profile 切换会恢复 Profile、Binding、QQ prefs 和策略；源码和合成安装测试覆盖该路径。完整生产切换、异常启动及实际 QQ 恢复仍需专门验收。部署脚本不自动启用轮换、迁移提醒、导入旧记忆或放开 Worker 权限。

test.13 已通过隔离验证并在本机部署，具体边界见 STATUS。QQ 生命周期开关需明确配置；备份包含 DSH_HOME/qqbot 的路由和生命周期状态、原生 Session/Schedule/storageDomain，以及 Character coordination.sqlite（含 WAL）和 Memory。原协调库新增 qq_bindings/identity_state 两张表，Memory Schema 不变。旧提醒仍绑定原 Session，不要删除旧 Session 或只复制当前主路由。

长期任务必须另装可选包并启用 Extras 条目。停用/回滚前先取消不需执行的计划、等待当前工作结束并制作一致性备份；回滚不得用旧快照覆盖新增记忆或清空执行/通知账本。停用插件不自动删除计划；重新启用可能处理仍有效的逾期任务，详见 [恢复契约](../packages/long-tasks/README.md)。回滚 QQ 补丁时还须恢复匹配的 QQTK 维护源码、上游 manifest 和补丁文件，不能只切换 Profile；完整快照保留了这些文件。实际手机验收与生产回滚演练未完成。

test.14 历史 Session 修复不更改数据库 Schema、任务 ID/规则或通知键，只补充可证的提醒绑定。Identity 与新增 `isCurrentSession/commitSession` 的 QQTK 补丁必须配套；旧补丁缺少契约时明确拒绝 attach，不静默降级。本次使用新的 test.14 包版本及配套补丁哈希，未覆盖已发布 test.13 包。已在授权后完成一致性备份、单活切换和启动验证；实际 QQ 收件和生产回滚仍未验收。

回退到原 test.13 会重新引入历史根完整授权缺陷，不能视为安全回滚。需保留这层安全修复，或停用 QQ 集成及相关冷恢复入口，复核后再开放；只关自动轮换不会撤销已有历史绑定。兼容性测试保留原表、Session/Schedule 与 Outbox，修复写入失败事务回滚；未验证整套旧版本的生产回滚。不可用旧 coordination/Memory 快照覆盖后续通知和记忆。

### test.17 Worker 配置兼容

候选准备脚本递归清理精确的旧 Worker Boundary 行，并迁移独立 Preset Manager 合并基线；仅刷新未被用户修改的旧默认 Persona。自定义工具、Skills 及版本/历史保留。切换前验证 Manager 源状态和候选状态哈希，过期拒绝切换。旧模块保持无权限行为的兼容入口，冷恢复不会因该路径缺失而回退其他 Agent。失败切换恢复旧 Profile、prefs、binding 和策略，不覆盖 Session/Memory。回滚 Core/Tools 时一并恢复匹配 Profile 和 Manager base；test.16 会重新施加其旧零工具策略。Preset Manager 仍是独立原生 Bundle，不加入 Core 或 Extras。

### 官方安装目录变化（rc.3）

数据目录仍由 `DSH_INSTALL_ROOT` / DSH_HOME 选择；官方可执行文件与 SDK 可通过 `DSH_CHARACTER_HOST_ROOT` 指向另一绝对目录。隔离测试、SDK resolver、部署/回滚进程选择和离线备份均使用所选宿主，含空格的 Windows CLI 路径会显式引用。候选记录并检查所选 ASAR 的路径/哈希，不能测试新版却启动旧目录。原生启动/数据不需要迁移；本次 rc.3 Creator 定义与关键插件 SDK 实现未变。QQTK 的 `host-runtime.json` 为独立维护入口选择同一宿主，不应启动两套实例。官方文件保持只读。
