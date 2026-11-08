# 当前状态

本文件区分五类事实：当前 main 的代码、已合并但未部署的改动、DSH 0.2.2-rc.1 隔离验证、尚未验证的范围，以及历史验收记录。历史数字只代表当时的提交与宿主，不是当前验证结果。本仓库不记录生产部署；源码 HEAD 不等于部署 SHA，生产实际版本须由 Owner 在生产环境核实。

## 当前 main 代码

| 范围 | 状态 |
|---|---|
| Character | 0.1.0-test.33（含可选角色模式），Long Tasks 0.1.0-test.3，Interaction 0.1.0-test.9 |
| 配套 QQTK | I/O test.9、Manager test.5、Remote Ops 1.1.1-test.3、QQ0.5.2 / SDK1.0.5 |
| 官方宿主目标 | DSH 0.2.2-rc.1 / Node 24 / Windows；源码不再支持 0.2.1 Schedule API |

源码已实现：四核心插件、Creator 构建派生、通用 Memory L1–L3/FTS5/CAS/遗忘屏障、可信 Identity、原生独立 Worker、可选 Interaction、原生内嵌 Inspector 与 Long Tasks。QQTK 独立维护唯一 I/O/Manager/QQ Gateway，通知为 at-most-once handoff。

新 portable 入口显式指定发行目录、新 Home、模型、账号、Owner、Persona 与可选插件；根依赖锁和版本清单进入 Git，生成 Core/包/Profile 与数据不进入 Git。旧布局脚本仍用于现有兼容回归，不代表新设备配置默认值。

## 分支待审（未合并、未部署）

- C2 Lite（分支 `feat/c2-lite-task-activity`，Character test.34 / Long Tasks test.4）：运行中的 Long Task 依据原生 `step/start`、`tool/call`、`tool/result` 事件，经同一 Outbox 发出低频活动汇报（`task_activity`，ID `long-task:<runId>:activity:<事件序号>`）。首次在运行满 90 秒后，之后至少间隔 5 分钟且只在有新活动时发送；首次汇报后的第一次工具错误可立即提示一次。内容只有计数、步骤、工具名与等待状态，不含参数、结果、百分比或预计时间，不调用模型。每个 run 一个内存定时器，结束/取消/停用时清除；重启沿用原有结算，不重建定时器。终态状态机、终态通知 ID、权限与 `allowTools` 不变。详见 [Long Tasks README](../packages/long-tasks/README.md)。验证（2026-11-08，本机 Windows，固定 0.2.2-rc.1 宿主，合成模型与假 Sender）：Character 单元 372/372、安全 35/35；`run-native-gates.ps1` 四项门禁全部通过（lifecycle 第二阶段新增检查：慢工具任务在首次窗口后得到一条真实原生事件生成的活动汇报，Outbox 行为 `task_activity`/`sent`，其后是未改变的终态通知；短任务没有活动汇报）。首次真实宿主运行发现两处单元测试未覆盖的问题并已修正：原生 `tool/result` 的调用 ID 在 `toolCallId`/`source.callId`，不是 `callId`；合成任务在真实宿主上需要 3–4 秒，门禁首次窗口改为 15 秒。同日一次整套门禁中 lifecycle 第 127 行既有断言（未证明归属提醒的目标 Session 不应被加载）失败一次，其余三次运行通过，原因未查明；另一次 workers 门禁结束后，DSH workspace-changes 在工作副本中启动的 `git add` 阻塞约一小时，使运行器挂起（门禁本身已通过）。真实模型长任务与 QQ 手机送达未验证。

## 已合并、未部署

- test.33（C0）：`long_task_list` 对每个 run 分开报告 `execution`、`goalVerification`（无独立验证器，结算后为 `unverified`）与 `delivery`（事件 ID、Outbox 状态、入队时间），并以 `deliveryAttention` 汇总全部 run 的 unknown/partial/not-sent/长时间 pending/unrecorded 投递；`character_notifications` 增加同样的 attention 视图。只读、无正文、不重发，不改 run 状态机与 Outbox Schema。Worker 评测增加执行期预算账本契约（尚无模型执行器）。原生门禁增加固定 Host 校验（版本、哈希、签名）与统一判定。
- Memory 形成与 Worker 委派评测框架（Character #19/#20）：只有评分器与合成夹具，没有真实模型测量。
- test.32：普通工具在派发时复核当前 Character 身份；配套 QQTK Identity & Access test.3 保留撤销后的 Session 主体归属并在派发时检查租约。增加注入对抗与可重复中英文检索评测，只修正排序归一化和 FTS 候选 SQL 物化，不变更 Schema、ACL 或遗忘规则。范围、收益与剩余限制见 [安全与召回回归](HARDENING-RECALL.md)。下文各版本验收数字保留为历史记录，不代表本轮生产部署。
- DSH 0.2.2-rc.1 Schedule 适配（Character #13 / QQTK #12）。

## DSH 0.2.2-rc.1 隔离验证

固定测试宿主见 [native-host-pin.json](evidence/native-host-pin.json)；`scripts/run-native-gates.ps1` 先校验宿主，再运行 lifecycle（含 Long Tasks）、workers、roles、schedule-restart 四项必需门禁。宿主缺失、版本或哈希不符、签名不符、门禁失败或未运行，都不判为通过。GitHub Hosted CI 不含 DSH，只跑单元与安全审计；`native-host.yml` 需要专用 self-hosted Windows runner，在注册之前不会运行，也不是必需检查。

最近一次本地运行（2026-11-08，C0 分支代码 `a859f77`，运行时工作树仅 `docs/STATUS.md` 未提交；本机 Windows，非 CI runner）：宿主校验通过（版本、三项哈希、Authenticode 签名有效），lifecycle、workers（两阶段各 9 项检查）、roles、schedule-restart 均通过。模型与 QQ 传输为合成夹具，Home 为全新隔离目录；它不证明真实 QQ 送达、真实模型质量或生产迁移。

## 尚未验证

真实 QQ Gateway 与补丁 SDK 在 0.2.2 的联网装配、手机送达与 Owner 阅读；真实模型的 Memory 形成质量、Worker 委派质量与成本；预算账本在真实 Provider 下的取消延迟；生产数据迁移；Mac/Linux 原生环境。其余限制：Mac/Linux 原生环境未验收；历史 Session 的 cwd/附件绝对路径可能需要人工审阅；旧非标准数据布局无自动导入保证。真实 QQ、已有提醒/通知以及私有业务数据迁移须在另行授权的停机流程验证。

尚未实现/本轮不扩展：跨平台账号关联、多用户/群聊、完整 Approval Router、向量检索、细粒度任务 grants、旧 Task Memory 正式导入。后续工作优先现有安全回归及实机验收，然后真实 Worker/Memory/Long Tasks 质量评估；不把路线图视为已交付。

## 历史验收记录（不代表当前验证）

以下段落按原文保留，所述数字与宿主（含 rc.3）属于当时的分支和提交。

清理保留单元、安全、权限、通知、生命周期、重启和补丁一致性测试。原生隔离测试使用合成账号/模型和新 Profile；不能据此宣称手机送达、真实 QQ 审批、真实模型 Worker 质量或 Desktop 视觉验收通过。各次临时输出只留仓库外本地私有目录。

- rc.3 宿主期：本轮迁移门禁：全新 Git 工作树执行 Character 单元 262/262、安全 35/35；QQTK 单元/边界 223/223、SDK 36/36，均无跳过；两份补丁重建并精确应用上游快照。三套新 Profile（普通 QQ、Core-only、完整可选组合）完成固定版本安装、哈希校验和真实 rc.3 启动装配，QQ 连接禁用。原生 Worker 冷恢复、Inspector/Memory/Compaction、通用模块、通信、Interaction/HITL/Media、双进程生命周期与 Schedule 重启回归使用合成数据。首次 Schedule 探针仍使用旧 Sender 的失败已保留在本地，夹具对齐当前通知接口后通过；运行时发送路径没有改变。
- 0.2.2 兼容分支期：DSH 0.2.2-rc.1 兼容（分支 `compat/dsh-0.2.2-rc.1`，未部署）：Long Tasks 改用 `create/edit/view/catalog`，保留原生时间规则类型并修正 daily/weekly/cron 的 `time_zone` 映射（此前三类规则在 0.2.1 也会被原生拒绝）；去掉逾期 `[HOST BINDING]` 重新绑定，改用原生 latest-only 恢复。Character Identity 按 `target` 判定提醒归属，`new_once`/`new` 不可信；Owner 根可管理自己的提醒，包括轮换前旧 Owner Session 上持有持久绑定的提醒，任务根、其他主体与未证明归属的任务拒绝；归属在执行时用新鲜原生视图判定并钉住 CAS，不依赖缓存。QQTK Conversation Manager 的 Schedule 阻断改读 catalog `target`（原 `list({sessionId})` 在 0.2.2 静默失效）。验证（官方签名安装包仅解包、不安装，隔离 Home、合成数据）：Character 单元 281/281、安全 35/35；QQTK 单元 235/235、SDK 36/36、补丁重建通过；真实 0.2.2 Host 上 lifecycle 双进程冷恢复、Schedule 重启与工具守卫、roles、interaction、communication、inspector（含 extras、modules、workers、workers+Preset Manager）通过；Preset Manager 单元与双阶段宿主测试通过。v1→v2 四进程演练：0.2.1 写 v1；0.2.2 启动/读取不写盘、字段一致、首次写入升级 v2；0.2.2 重启读取 v2；0.2.1 无法加载 v2。真实 QQ Gateway/补丁 SDK 在 0.2.2 的联网装配、手机送达、真实模型与生产迁移未验证。
- I1/I2（分支 `feat/identity-access-i1-i2`，未部署、默认关闭）：Identity & Access 已接入 QQ 入站、命令、HITL、Conversation Manager 的 Session 选择、工具守卫与出站；三个角色 Preset 进入构建与 portable 安装，旧 `qq-character` 作为 Owner 别名兼容。验证：Character 单元 268/268、安全 35/35；QQTK 单元 235/235、SDK 36/36；真实 rc.3 隔离 Host 两阶段角色探针（含 HMR 与进程重启）及合成配置的干净安装与装配通过。真实 QQ/手机、真实模型与生产迁移未验证。详见 [IDENTITY-ACCESS](IDENTITY-ACCESS.md)。
