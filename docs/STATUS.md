# 当前状态

本文件区分五类事实：当前 main 的代码、已合并但未部署的改动、DSH 0.2.2-rc.1 隔离验证、尚未验证的范围，以及历史验收记录。历史数字只代表当时的提交与宿主，不是当前验证结果。本仓库不记录生产部署；源码 HEAD 不等于部署 SHA，生产实际版本须由 Owner 在生产环境核实。

## 当前 main 代码

| 范围 | 状态 |
|---|---|
| Character | 0.1.0-test.36（含可选角色模式），Long Tasks 0.1.0-test.6，Interaction 0.1.0-test.9 |
| 配套 QQTK | I/O test.9、Manager test.5、Remote Ops 1.1.1-test.3、QQ0.5.2 / SDK1.0.5 |
| 官方宿主目标 | DSH 0.2.2-rc.1 / Node 24 / Windows；源码不再支持 0.2.1 Schedule API |

源码已实现：四核心插件、Creator 构建派生、通用 Memory L1–L3/FTS5/CAS/遗忘屏障、可信 Identity、原生独立 Worker、可选 Interaction、原生内嵌 Inspector 与 Long Tasks。QQTK 独立维护唯一 I/O/Manager/QQ Gateway，通知为 at-most-once handoff。

新 portable 入口显式指定发行目录、新 Home、模型、账号、Owner、Persona 与可选插件；根依赖锁和版本清单进入 Git，生成 Core/包/Profile 与数据不进入 Git。旧布局脚本仍用于现有兼容回归，不代表新设备配置默认值。

## 已合并、未部署

- test.36（C1 执行边界审计修复，PR #24 同一分支）：DSH agent-loop 在 `agent/pre-step` 之前就把投递从持久收件箱取出，被拒绝的投递不会放回。修复前，已投递但在认领前遇到任务修改（旧版本指令）、取消或无法读取原生计划的 occurrence 会被消耗而不留 run、也不通知；Host 在取出后、认领前停止的 occurrence 重启后同样无痕丢失（真实 Host 门禁在修复前确实失败）。现在这些可信投递一律以 `executed:false` 的终态 run 结算并经 Outbox 通知（`stale_revision`/`cancelled`/`unverified_delivery`/`task_unavailable`/重启后的 `restart_unclaimed`），从不执行旧版本指令、不补跑、不标 completed；伪造帧仍直接拒绝。新增每 Host 进程 `runSessionBudget`（默认 1000）限制可执行的 per-run Session 数（0.2.2-rc.1 无公开 API 释放 Session；实测每个最小 Session 约 50–70 KB 堆），超出的 occurrence 结算为 `session_budget` 并每任务通知一次。Session→任务索引避免 pre-step 线性扫描账本。同一周期任务的并行 run 保持默认允许（原生 `new` 目标不占执行槽），身份、状态、通知与取消已测试独立。生产 2026-11-13 已部署的是 test.35（本分支早先提交），不含这些修复。
- test.35（C1 统一执行层）：需要 Agent 执行的定时任务只走 Long Tasks 一套 Task / Run 生命周期，不为普通 Schedule 另建结果回传。新任务使用原生 Schedule `target:{kind:'new',create:{agentPreset:long-task,cwd}}`：每次 occurrence 由 Host `sessionController` 新建任务 Preset 的独立 Session，Run ID 仍为任务 ID + occurrence；pre-step 认领时凭原生投递帧、任务自己的计划 ID 与当前指令、实时 `view()`（已提交时 `lastDelivery.targetSessionId` 必须是该 Session）把 Session 绑定到一个 run，先写账本再执行，之后该 Session 不再接受任何回合。最终结果复用既有 `turn/end` 结算与 Outbox（`long-task:<runId>`），活动汇报不变；正常结束但没有可用最终回复改为 `needs_review`。Host 缺少 Session 创建器时创建明确失败，不降级。历史 `target:session` 根 Session 任务原样执行、修改、取消、恢复，可与新任务共存；`sessionMode: task-root` 为显式兼容选项。纯提醒仍是 `schedule_create` + Identity 到期提醒，不启动 Agent；Skill 与工具说明写明选择规则。已知限制：0.2.2-rc.1 无公开 API 卸载 per-run Session（保持加载至 Host 重启）；原生 `new` 目标不占执行槽，同一周期任务的相邻 run 可并行。详见 [Long Tasks README](../packages/long-tasks/README.md)。
- test.34（C2 Lite，Character #22）：运行中的 Long Task 依据原生 `step/start`、`tool/call`、`tool/result` 事件，经同一 Outbox 发出低频活动汇报（`task_activity`，ID `long-task:<runId>:activity:<事件序号>`，与终态通知 ID 分开）。运行满 90 秒首报，之后至少间隔 5 分钟且只在有新活动时发送；每个 run 最多一次快速异常提醒（首报前的错误并入首报）。汇报以 Host 时钟的“截至 日期 时间（UTC±hh:mm）”开头并注明送达时任务可能已结束；只含步骤、调用与返回计数、工具名和等待状态，不含参数、结果、百分比或预计时间，不调用模型。未返回调用按调用 ID 跟踪（最多 20 个）：未挤出时报告精确数，挤出后只报告可证明的下界。活动计数与工具错误标记（`toolError` → `needs_review`）共用一条归属规则（本 run 的 turn、认领之后、带原生序号、未处理过）。每个 run 一个内存定时器，结束、取消、停用时清除；重启沿用原有结算，不重建定时器、不补发。终态状态机、终态通知、权限与 `allowTools` 不变。详见 [Long Tasks README](../packages/long-tasks/README.md)。
- 原生门禁隔离（Character #23）：隔离 Home 建在仓库外的系统临时目录；运行器只等待门禁进程本身，单项超时 20 分钟；宿主按自己启动的进程树停止。lifecycle 中“未证明归属提醒的目标不被加载”改为统计被 Identity 放行的冷恢复（必须为 0，含被接受的对照），不再对注册表瞬时采样。
- test.33（C0）：`long_task_list` 对每个 run 分开报告 `execution`、`goalVerification`（无独立验证器，结算后为 `unverified`）与 `delivery`（事件 ID、Outbox 状态、入队时间），并以 `deliveryAttention` 汇总全部 run 的 unknown/partial/not-sent/长时间 pending/unrecorded 投递；`character_notifications` 增加同样的 attention 视图。只读、无正文、不重发，不改 run 状态机与 Outbox Schema。Worker 评测增加执行期预算账本契约（尚无模型执行器）。原生门禁增加固定 Host 校验（版本、哈希、签名）与统一判定。
- Memory 形成与 Worker 委派评测框架（Character #19/#20）：只有评分器与合成夹具，没有真实模型测量。
- test.32：普通工具在派发时复核当前 Character 身份；配套 QQTK Identity & Access test.3 保留撤销后的 Session 主体归属并在派发时检查租约。增加注入对抗与可重复中英文检索评测，只修正排序归一化和 FTS 候选 SQL 物化，不变更 Schema、ACL 或遗忘规则。范围、收益与剩余限制见 [安全与召回回归](HARDENING-RECALL.md)。下文各版本验收数字保留为历史记录，不代表本轮生产部署。
- DSH 0.2.2-rc.1 Schedule 适配（Character #13 / QQTK #12）。

## DSH 0.2.2-rc.1 隔离验证

固定测试宿主见 [native-host-pin.json](evidence/native-host-pin.json)；`scripts/run-native-gates.ps1` 先校验宿主，再运行 lifecycle（含 Long Tasks）、workers、roles、schedule-restart 四项必需门禁。宿主缺失、版本或哈希不符、签名不符、门禁失败或未运行，都不判为通过。隔离 Home 建在系统临时目录下的 `dsh-character-gates`（可用 `DSH_CHARACTER_TEST_ROOT` 指定），必须位于任何 git 工作树之外：DSH workspace-changes 会在每轮结束时对 Session 工作目录所在仓库做快照，Home 放在项目内时，宿主在快照中途被停止会留下孤儿 `git add`，并因继承的句柄挂住运行器。运行器只等待各门禁进程本身（输出写文件，单项超时 20 分钟），残留子进程不再阻塞。GitHub Hosted CI 不含 DSH，只跑单元与安全审计；`native-host.yml` 需要专用 self-hosted Windows runner，在注册之前不会运行，也不是必需检查。

最近一次本地运行（2026-11-13，C1 分支代码 `a402a6f`；本机 Windows，非 CI runner）：Character 单元 394/394（含 per-run 13 项、历史根 Session 兼容 34 项）、安全审计 35/35，QQTK 审计 36/36；`run-native-gates.ps1` 宿主校验通过（版本、三项哈希、Authenticode 签名有效），lifecycle 112 s、workers 19 s、roles 21 s、schedule-restart 21 s 全部通过。lifecycle 新增 C1 检查：per-run 周期任务经原生 run-now 与一次定时触发，在两个由 Host Session 创建器新建的 `long-task` Session 中各执行一个 run，各自结算 `completed` 并各发一条结果通知；这些 Session 不是 QQ Session、无 Memory 身份、只有任务工具白名单、不含 QQ 聊天历史，每个 Session 只有一条投递；一次性、工具错误、日/周/Cron 与活动汇报任务均为 per-run，历史根 Session 周期任务继续执行与取消。未证明归属目标 18 次冷恢复尝试、0 次被接受。重启后恢复“已投递未认领”的 per-run 投递只在单元测试中覆盖，未在真实 Host 中演练。

此前一次（2026-11-09，#22 与 #23 整合后的代码 `826abad`，干净工作区；本机 Windows，非 CI runner）：Character 单元 381/381、安全审计 35/35；`run-native-gates.ps1` 宿主校验通过（版本、三项哈希、Authenticode 签名有效），lifecycle 98 s、workers 23 s、roles 24 s、schedule-restart 22 s 全部通过，共 174 s，Home 位于仓库外，结束后无残留 git 进程。lifecycle 包含活动汇报检查（慢工具任务得到一条由原生事件生成的汇报，Outbox 为 `task_activity`/`sent`，其后是未改变的终态通知；短任务没有活动汇报）以及“未证明归属的目标 20 次冷恢复尝试、0 次被接受、无投递”。模型与 QQ 传输为合成夹具，不证明真实 QQ 送达、真实模型质量或生产迁移。

## 尚未验证

真实 QQ Gateway 与补丁 SDK 在 0.2.2 的联网装配、手机送达与 Owner 阅读；真实模型的 Memory 形成质量、Worker 委派质量与成本；预算账本在真实 Provider 下的取消延迟；生产数据迁移；Mac/Linux 原生环境。其余限制：Mac/Linux 原生环境未验收；历史 Session 的 cwd/附件绝对路径可能需要人工审阅；旧非标准数据布局无自动导入保证。真实 QQ、已有提醒/通知以及私有业务数据迁移须在另行授权的停机流程验证。

已知非阻断事项：未证明归属的提醒到期后，原生 Schedule 每次 drive 请求都会重试冷恢复目标，并被 Identity 拒绝（隔离 lifecycle 中每次运行约 20 次，每次 15–55 ms，无执行、无投递），只造成重复开销与警告日志；Home 位于 git 仓库内时，DSH workspace-changes 启动的 git（`add`、`rev-parse`）在宿主停止后可能成为孤儿并长时间不退出，原因未查明，隔离 Home 后不再触发。

尚未实现/本轮不扩展：跨平台账号关联、多用户/群聊、完整 Approval Router、向量检索、细粒度任务 grants、旧 Task Memory 正式导入。后续工作优先现有安全回归及实机验收，然后真实 Worker/Memory/Long Tasks 质量评估；不把路线图视为已交付。

## 历史验收记录（不代表当前验证）

以下段落按原文保留，所述数字与宿主（含 rc.3）属于当时的分支和提交。

清理保留单元、安全、权限、通知、生命周期、重启和补丁一致性测试。原生隔离测试使用合成账号/模型和新 Profile；不能据此宣称手机送达、真实 QQ 审批、真实模型 Worker 质量或 Desktop 视觉验收通过。各次临时输出只留仓库外本地私有目录。

- rc.3 宿主期：本轮迁移门禁：全新 Git 工作树执行 Character 单元 262/262、安全 35/35；QQTK 单元/边界 223/223、SDK 36/36，均无跳过；两份补丁重建并精确应用上游快照。三套新 Profile（普通 QQ、Core-only、完整可选组合）完成固定版本安装、哈希校验和真实 rc.3 启动装配，QQ 连接禁用。原生 Worker 冷恢复、Inspector/Memory/Compaction、通用模块、通信、Interaction/HITL/Media、双进程生命周期与 Schedule 重启回归使用合成数据。首次 Schedule 探针仍使用旧 Sender 的失败已保留在本地，夹具对齐当前通知接口后通过；运行时发送路径没有改变。
- 0.2.2 兼容分支期：DSH 0.2.2-rc.1 兼容（分支 `compat/dsh-0.2.2-rc.1`，未部署）：Long Tasks 改用 `create/edit/view/catalog`，保留原生时间规则类型并修正 daily/weekly/cron 的 `time_zone` 映射（此前三类规则在 0.2.1 也会被原生拒绝）；去掉逾期 `[HOST BINDING]` 重新绑定，改用原生 latest-only 恢复。Character Identity 按 `target` 判定提醒归属，`new_once`/`new` 不可信；Owner 根可管理自己的提醒，包括轮换前旧 Owner Session 上持有持久绑定的提醒，任务根、其他主体与未证明归属的任务拒绝；归属在执行时用新鲜原生视图判定并钉住 CAS，不依赖缓存。QQTK Conversation Manager 的 Schedule 阻断改读 catalog `target`（原 `list({sessionId})` 在 0.2.2 静默失效）。验证（官方签名安装包仅解包、不安装，隔离 Home、合成数据）：Character 单元 281/281、安全 35/35；QQTK 单元 235/235、SDK 36/36、补丁重建通过；真实 0.2.2 Host 上 lifecycle 双进程冷恢复、Schedule 重启与工具守卫、roles、interaction、communication、inspector（含 extras、modules、workers、workers+Preset Manager）通过；Preset Manager 单元与双阶段宿主测试通过。v1→v2 四进程演练：0.2.1 写 v1；0.2.2 启动/读取不写盘、字段一致、首次写入升级 v2；0.2.2 重启读取 v2；0.2.1 无法加载 v2。真实 QQ Gateway/补丁 SDK 在 0.2.2 的联网装配、手机送达、真实模型与生产迁移未验证。
- I1/I2（分支 `feat/identity-access-i1-i2`，未部署、默认关闭）：Identity & Access 已接入 QQ 入站、命令、HITL、Conversation Manager 的 Session 选择、工具守卫与出站；三个角色 Preset 进入构建与 portable 安装，旧 `qq-character` 作为 Owner 别名兼容。验证：Character 单元 268/268、安全 35/35；QQTK 单元 235/235、SDK 36/36；真实 rc.3 隔离 Host 两阶段角色探针（含 HMR 与进程重启）及合成配置的干净安装与装配通过。真实 QQ/手机、真实模型与生产迁移未验证。详见 [IDENTITY-ACCESS](IDENTITY-ACCESS.md)。
