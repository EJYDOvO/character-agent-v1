# 当前状态

本页是版本与验收状态的统一入口。历史发布记录说明当时结果，不代表最新运行状态。

## DSH 0.2.1-rc.3 适配

官方更新改为用户安装目录，数据继续沿用原目录。关键 Preset/Subagent/Tools/Config SDK 与 Creator 定义逐文件比对未变；Client registry 的变化为发行提交标识。修复验证/维护脚本误指向旧二进制和含空格路径的引用，保留旧版测试能力；没有修改官方 DSH 或更换插件运行包。

rc.3 隔离验证：Character 178/178、Preset Manager 107 通过 + 1 项原有平台跳过、QQTK 28 轻量 + 30 SDK 边界通过。十个 Worker/Manager 配置及两进程恢复、Core+Extras、Memory/Compaction、Interaction、Session 轮换与长期任务/提醒恢复均通过，模型和 Sender 为合成替身。Desktop 已只读验证设置入口与 Worker 列表，未验证桌面写操作/HMR 或真实手机收件。

当前 rc.3 实例健康、QQ 单连接、13 个 Preset 无装配失败；自有维护入口已选择新安装目录，数据/Profile/模型偏好保持。切换保留一致性快照，实际维护失败恢复后校验用户数据不变。没有发送真实 QQ 测试消息。详细路径、备份及临时日志仅留本机。

## test.17 当前版本

Worker 默认 Boundary 已移除，权限完全沿用原生 Preset/Scope；旧模块为无操作兼容入口。候选迁移覆盖嵌套 Override、自定义 Preset 与 Manager 合并 base，保留用户工具、Skills/版本和历史，拒绝过期状态切换。

本轮 Character **178/178** 单元/安全回归通过，无跳过；当前 DSH 0.2.1-rc.2 的 Core-only/Core+Extras、十个原生 Worker 实际工具调用、原生一级深度、Root 身份/Memory/任务拒绝、冷恢复与两进程重启通过。跨仓库测试由独立 Preset Manager 经 Owner API 为真正的 Character Worker 配置 Plugins/Skills，重启后实际工具执行继续通过。Creator、Memory/Compaction、Schedule/Outbox 回归通过。模型与 QQ Sender 是合成替身，不代表真实业务质量或手机收件。

Preset Manager test.2：107 通过，1 项原有 Windows 符号链接跳过；实际打包产物两进程 Host、Profile 替换、Schema/依赖/Scope/CAS、版本和失败回退通过。Web 原生设置已实测配置表单、搜索、添加、排序、停用/移除、错误提示、Skills 分配/启停和刷新；Desktop 实际窗口与视觉 HMR 未验证。运行验证与历史实例记录如下。

### test.17 首次部署（rc.2 历史记录）

已单活部署 Character **0.1.0-test.17**（运行代码 `5c23b75`）和独立 Preset Manager **0.1.0-test.2**（运行代码 `34db4a1`）。新 Host 健康、Agent 空闲、13 个 Preset 无失败、七个默认 Worker 均只有 Persona，单一 QQ Gateway connected/ready。Owner API、Schema、原生版本化客户端资源及未登录/跨来源拒绝通过；现场未改 Worker 工具配置，工具执行验收使用隔离 Profile。

切换前保留旧 Profile 及 297 文件校验快照。Memory/治理表、绑定、QQ prefs、Schedule 和官方 ASAR 的前后校验一致；未进行生产数据迁移、未发送真实 QQ 测试消息。隔离切换失败回滚通过，生产实例本轮未执行回滚演练。后续迁移脚本额外收窄为只刷新内置 Worker Persona，明确不改变 Root Persona；此维护脚本不改变已部署运行包。

Character 运行代码的 GitHub Actions 已通过；Manager 本提交未查到远端 Actions 运行，不将本地通过写成远端 CI 已验收。Desktop 当时没有可操作窗口，实际 Desktop GUI/HMR 和手机审批收件仍未验证。

## test.16 实例记录

**test.16 当时实例 / 社区 Preset ID 修复**，代码提交 `1c587f2`。兼容字符串真实 ID，支持 `{id,alias?}`；原生白名单、Spawn 和持久恢复只使用真实 ID。配置冲突、已知受保护 Root、Character 自引用均拒绝，不自动安装或授权。当前实例仍只有七个默认 Worker，没有新增或启用社区目标。

test.16 原发布验证：Character **174/174**、QQTK **57/57** 自动回归通过，无跳过。实际安装候选包的 Core-only/Core+Extras、普通 Agent 模块启停、十个 Preset 的原生委派/权限隔离/双进程恢复，以及缺失、实际装配失败、卸载后恢复拒绝均通过，无 Creator 回退；Session/Long Tasks、Memory/Compaction、Schedule/通知和 Interaction 回归通过。第三方样例为合成夹具，未审查或验证任何真实第三方插件的安全性与质量。

授权部署时发现原 Host 已停止，旧 QQ 健康记录不作为在线证明。离线确认无未完成 Turn、无未决审批和 active Schedule，持维护锁制作 289 文件一致性快照后单活切换。新 Host 健康且空闲，七个默认 Worker 均正常，QQ connected 且单次 ready；Memory/修订/治理表、绑定、路由/模型偏好、Schedule 内容和官方 ASAR 校验保持一致。保留 test.15 Profile 与快照；DSH 0.2.1-rc.2、QQ Bot 0.5.2 / SDK 1.0.5 及原补丁、Interaction test.3、搜索 0.9.15 保持不变，Inspector 只读、人格化 Character。详细日志、凭据、数据和备份只留本机。

未发送真实 QQ 测试消息，手机收件和真实模型的第三方 Worker 质量不属于已验证项。用法与限制见 [Worker](WORKERS.md)。

### 可选 Preset Manager

当时 test.16 Profile 另装独立 `dsh-preset-manager@0.1.0-test.1` Bundle，运行产物对应其仓库 `f82ccac`；Core/Extras、QQTK、Interaction、Memory 及其版本未变。安装后 13 个 Preset 无装配失败，七个 Worker 与单 QQ Gateway 正常；Owner API、Schema 和原生前端图公布的版本化客户端资源通过，未登录/跨来源请求拒绝。Memory/治理表、Session 路由、绑定、Schedule 和官方 ASAR 的重启前后校验保持一致。

首次切换被错误的固定客户端资源地址检查拦截，已实际回退并验证数据保留；按实际 SDK 改用原生图中的版本 URL，补充隔离回归后重新部署通过。既有 Profile 与一致性快照保留本机。Character 新增 Profile 切换保留插件状态目录的回归后 **175/175** 通过；管理器独立 **103 通过、1 项上游 Windows 平台跳过**，打包产物两进程原生验收通过。管理页实际点击/布局/桌面窗口未验收，未发送真实 QQ 测试消息。详细过程、配置和日志不公开。

### test.15 历史部署记录

**test.15 当时的实例：Worker V2 / `0.1.0-test.15`**（2026-10-26）：Character 保持唯一 Root；Core 新增 explore/librarian/oracle/metis/momus/planner 六个独立分析 Preset，保留 general 与可选 review。通过原生 Spawn 白名单和叶子工具守卫装配；没有额外 Agent Manager、执行型 Worker、Memory Schema 或 QQTK 改动。社区 Preset 只支持 Host 审查安装后的显式引用，不自动安装。这是当时的零工具限制；test.17 当前权限见 [Worker](WORKERS.md)。代码提交 `981ce79`；其余依赖版本与 QQTK 补丁保持不变。

隔离验收：Character **172/172**、QQTK **57/57** 自动回归通过，无跳过。实际安装候选包的 Core-only/Core+Extras、普通 Agent 模块启停、九种 Worker Preset 的原生委派/权限攻击/冷恢复及完整 Host 重启恢复通过；Memory 提取与 Compaction、Schedule/通知去重、QQ 生命周期/Long Tasks 和 Interaction 回归通过。攻击测试按本次输入和真实 tool-call 记录断言；Interaction 只调整测试计时间隔，未改运行插件。

2026-10-26 授权部署：空闲门禁、维护锁、283 文件一致性快照及单活切换通过。启动健康且空闲，七个默认 Worker Preset 正常、单 QQ ready；review 没有配置启用。Memory 及修订/治理表、绑定、路由/模型偏好、Schedule 内容和官方 ASAR 校验保持一致，Inspector 只读、人格化 Character，Interaction test.3、搜索 0.9.15 保持。本轮启动检查曾误将可选 review 当作必需项，实际回退到保留的 test.14 并保留当前数据；按构建清单修正本地门禁后重新上线成功。旧 Profile、快照和详细证据仅保留本机。

未发送真实 QQ 测试消息，也未验证真实模型的 Worker 分工质量、JSON 稳定性或手机审批完整链路；合成模型/Sender 通过不代表这些能力已验收。

### test.14 历史部署记录

**test.14 当时的实例 + Interaction test.3**：Character 四插件及 Core/Extras 保持 `0.1.0-test.14`，Interaction 为 `0.1.0-test.3`，配套 QQTK 补丁已更新，DSH 保持 `0.2.1-rc.2`。本次回复修复提交 Character `1c4f40e`、QQTK `72866b6`；test.14 权限修复继续保留。已持维护锁完成空闲门禁、273 文件校验快照及候选切换，旧 Profile 与检查点保留本机。

启动检查：新宿主健康且空闲、单 QQ ready，Identity/Memory/QQ/Remote Ops/Inspector 活跃；记忆及修订、绑定、官方 ASAR、无用户入站时的路由/计时保持不变。Inspector 继续 `writable:false`、人格化 Character。本轮没有触发提醒或发送 QQ 测试消息，不等于手机收件验收。回退未经修复的 test.13 会恢复权限缺陷，须遵守下述安全回滚边界。

2026-10-26 回复修复：原生 `time-context` / `agent-instructions` 不再被误当作其他渠道输入而关闭 QQ 输出；Interaction 和 QQ 适配器同步分类，后台、Web 与取消隔离仍保留。Character **169/169**、QQTK **27/27 + 30/30** 自动回归通过；实际候选包 Core-only/Core+Extras、模块启停、双进程生命周期及含原生时间投影的 Interaction 隔离验收通过。模型/Sender 为合成替身，实际手机收件待验收。补丁从上游快照应用后 15 文件与源码一致，部署后安装代码哈希一致；冻结锁文件校验通过。修复未涉及搜索策略或记忆 Schema。回滚须配套恢复 Interaction、QQ 补丁及维护快照，旧 test.14 组合会重新带回吞回复问题。

2026-10-26 搜索升级：独立 `dsh-free-search` 从 `0.8.9` 升至 `0.9.15`，维护版本清单与锁文件同步更新，其余插件及 QQ 补丁保持不变。新版本通过原生配置接口接管搜索；保留 Auto 模式，中文/英文池将 DuckDuckGo 排在 Bing 前。25 组上游测试通过（Windows 不覆盖 POSIX 进程组行为），实际 rc.2 Creator 的 `web_search`、新插件与已安装 Character/Extras 组合验收通过；Provider 为合成模型，搜索使用真实公开网络。旧优先顺序仍复现 Bing 年份百科偏题，调整后实例搜索接口返回电影相关来源；来源内容和上映日期未逐条核实。已授权备份、切换、重启；单 QQ ready，记忆/修订、绑定和 QQ prefs 保持一致，Inspector 只读。未发送真实 QQ 验收消息。详细临时证据与回滚检查点仅保留本机。

### test.13 历史部署记录

**test.13 当时的实例（2026-10-25 部署）**：QQTK 的重启/12h 无用户输入换空白主 Session、独立长期任务均已显式启用；源码和 Extras 默认仍停用。长期任务仅开放模型分析，没有执行工具或 Memory 权限。原生 Schedule/Session/Preset/storageDomain 与现有 Outbox 保持复用，单 Owner 私聊和原角色、模型配置不变。Inspector 维持只读、人格化维持 Character。配置与恢复见 [Long Tasks](../packages/long-tasks/README.md) 和 [功能管理](MANAGEMENT.md)。

test.13 隔离验证：Character 单元/安全回归 **127 + 33 = 160**，QQTK 轻量/真实 SDK 边界 **24 + 34 = 58**，全部通过、无跳过。当前 rc.2 原生 Host 的 Core-only、Core+Extras、通用模块启停与 Interaction 回归通过；长期任务验证两个独立 Host 进程、停机逾期、实际周期到期、独立 Session/工具权限/Memory 拒绝、重复拒绝、旧提醒冷恢复、稳定 Conversation 通知及真实插件卸载后的拒绝执行。实际候选安装包使用 DSH 原生依赖解析通过，无测试 SDK 别名。隔离模型和 Sender 为合成替身，不代表手机收件或实际业务任务质量。

部署后发现并修复 Remote Ops 预热被误算为用户输入的问题：预热不改变路由、不更新用户计时，真实 QQ messageId 的入站才检查轮换。已补充单元、双进程及真实启动门禁；修正版启动验证通过。当前仅一套 QQ Gateway，插件/Preset 正常、Host 空闲、Inspector 认证访问与未登录拒绝通过；记忆完整性正常，官方 ASAR、绑定及启动前路由/计时保持不变。保留了一致性快照及旧 Profile，未执行生产回滚演练，也未发送 QQ 验收消息。

### test.14 历史 Session 权限修复与验证

完整身份只授予当前主路由，历史根仅做 Host 提醒桥接；原生工具、后挂载工具、模型请求、Memory 和长期任务创建保持拒绝。QQTK 补丁同时修复 rc.2 模型切换旧 `.events` API，并将路由/模型偏好原子持久化。只读审计可发现升级前缺失绑定；仅原生持久祖先链有证据时事务补写提醒绑定，不更改 Schedule、主路由、去重键或 Memory Schema。

已完成真实 rc.2 双进程隔离验证：模型切换与重启、12h/并发轮换、缺失旧绑定恢复、合法旧提醒到达合成 Sender、历史根权限拒绝，以及未证明归属的冷恢复不消耗原任务。SQLite 补写失败/回滚、离线审计、撤销与同 Gateway 重挂载竞态有回归。模型和 Sender 为合成替身；没有真实 QQ、完整应用 HMR 或生产回滚验收。当前实例只读 Schedule 审计：2 个 inactive、0 个 active，均有可核实绑定，无补写建议；此审计阶段未读取生产 Memory 或修改数据；其后已另行授权部署，状态见页首。

本候选 Character **166/166** 单元/安全回归、QQTK **26/26** 轻量与 **34/34** 实际 SDK 边界通过，无跳过；两份补丁从上游快照干净应用并逐文件匹配。原生 Core-only、Core+Extras 的 Creator/Skills/Worker、Memory/Compaction、Schedule、Inspector/Web/桌面 relay 通过；已存活且归属不明的根也验证到期后不写收件箱、不记 lastDelivery、任务仍 active。未做真实手机投递、完整桌面 HMR 或旧运行时生产回退；模型切换写盘失败使用隔离故障注入验证。

回退到未经修复的 test.13 会重新开放历史根权限，不能视为安全回滚；配套与保留数据的要求见 [回滚](INTEGRATION.md#回滚)。

### test.12 历史部署记录

test.12 当时的实例：DSH **0.2.1-rc.2**，Character/Core/Extras **test.12**，Remote Ops **1.1.1-test.1**，Interaction 和 Inspector **0.1.0-test.2**，QQ Bot **0.5.2**、SDK **1.0.5**。当时完成一致性备份、冻结锁文件、切换和重启；本轮保留这些第三方版本。

test.12 包含原生分析 Worker、可选 Inspector，以及遗忘脱敏、分层筛选、异步请求和保留新增记忆的回滚修复。Inspector 已以 **`writable:false`** 启用；人格化保持 Character 模式。现有角色绑定、QQ Session 路由与官方 ASAR 哈希保持一致，记忆数据库完整性检查通过。后续修改已发布包内容必须分配新版本，不能覆盖不可变包。

## test.12 历史验证范围

- 本次单元测试 **115/115**、审计回归 **33/33**，无跳过。公开提交 `889f46a` 的 [GitHub Actions](https://github.com/EJYDOvO/character-agent-v1/actions/runs/39385106958) 已在 Linux/Windows 成功；本次追加的完整维护版本清单修复已在本地回归，不将前一提交的 CI 结果用于证明后续修改。
- 当前安装版原生宿主：Core-only、Core+Extras、普通 Creator + 独立 Identity/Core/Inspector；Extras 工具可见、停用和恢复；Inspector 独立卸载；Interaction 单独启停；Provider 撤销使依赖服务和旧 capability 失效。
- 本次还用候选实际安装包完成隔离 Host 验收。真实切换首次因维护策略残留旧 Character pin 被完整性检查阻止，自动恢复旧 Profile 后修复；重试通过。发布策略现在同步本次全部已验证包，失败恢复和 Session 保持有回归测试。当前 Host 的插件、Preset、Inspector 认证访问及未登录拒绝已验证。
- Worker：独立 Preset/Session、晚挂载 scoped tool 守卫、伪造 Memory 授权拒绝及冷恢复。模型和 QQ Sender 使用合成替身，不证明手机投递或复杂任务质量。
- 原生 Schedule 到期、去重与同 Session 的进程重启恢复已验证；没有稳定目标迁移或自动 Session 轮换。
- Inspector 已在 DSH Web 设置页实际操作；Desktop 使用安装版 relay 验证，尚缺实际桌面窗口验收。
- 100/1,000/10,000 条合成性能基线可用 `tests/inspector-benchmark.mjs` 重跑；同步 SQLite 和大库冷投影仍有阻塞，非并发服务吞吐保证。

## 尚未完成的验收

实际 Desktop 窗口中的完整操作、手机端实际收件及 QQ 审批按钮仍需真人验收。Gateway ready 不能证明手机投递成功。Inspector 保持 `writable:false`，没有开启 GUI 写入权限。

任务级细粒度 grants、旧 Task Memory 正式导入、提醒目标迁移、具备执行权限的专业 Worker、向量检索和 Mac 迁移仍未交付。test.13 的真实 QQ 收件、业务任务效果及完整 HMR 仍需验收；参见 [路线图](IMPLEMENTATION_ROADMAP.md)。

详细运行日志、截图、临时审计和模型对照记录仅留在本地忽略目录。历史版本可从 `RELEASE-test*.md` 查询，实际恢复始终使用 [当前集成说明](INTEGRATION.md)。
