# 独立长期任务（可选）

`dsh-character-long-tasks` 是 Character Extras 的可选 Host 插件。使用 DSH **0.2.2-rc.1** 原生 Schedule（`create/edit/view/catalog`）、AgentPreset、根 Session、storageDomain，以及 Character Identity 的既有 QQ Outbox。不再兼容 0.2.1 的旧 Schedule API。不新增调度器、Agent Loop 或数据库。普通 DSH 项目的通用 QQ、Memory 不依赖它。

## 安装与配置

将本包安装到目标 Profile，启用 `dsh-character-extras`，再在 Profile 显式覆盖 Extras 中默认停用的条目：

```yaml
- id: long-tasks
  disabled: false
  config:
    presetId: long-task
    allowTools: []
    taskPlugins: []
    # 可选：任务 Session 的工作目录（绝对路径；存在时必须是目录），默认 Host 进程目录
    # cwd: D:/DSH/task-workspace
```

依赖可信 `characterIdentity` 和原生 `schedule/storageDomain/agentPresets/agents/sessions/sessionPersistence/tools/skills`。创建新任务还需要 Host 提供原生 `sessionController`（DSH Desktop / Web 组合自带），由它为每次触发创建 Session；缺少时创建会明确失败。不能在同一 Profile 再声明第二个实例或同名任务 Preset。默认不开放工具，也没有主 QQ Session、Memory 或审批代理权限。

有实际工作工具时，Host 必须同时配置 `taskPlugins`（原生 Preset 插件声明数组）和精确 `allowTools`。只安装/允许经过审查的受限工具。任务文字不能扩大权限；晚挂载工具仍受执行守卫限制。Memory、QQ、Schedule、Spawn 和插件管理入口不在本插件允许范围内。审批不能借用主 QQ 身份；需要这类能力的工作留给主 Agent，不能靠修改任务提示词解决。

## Agent 工具与 Skill

插件注册原生 runtime Skill `long-tasks`，以及四个工具：

| 工具 | 用途 |
|---|---|
| `long_task_create` | title/prompt + 一个原生时间选择器：at、after_seconds、every_seconds（至少 60 秒）、daily、weekly、cron |
| `long_task_list` | 当前 Owner/项目/角色/Conversation 范围的任务、原生投递、执行及通知状态 |
| `long_task_update` | id + revision；修改 title/prompt 或原生 change 规则（kind: at/every/daily/weekly/cron） |
| `long_task_cancel` | id + revision；删除未来触发并请求原生 cancel，不撤销已经发生的副作用 |

日历规则必须显式时区（工具参数 `timeZone`，内部映射为原生 `time_zone`）；原生时间规则和最低频率限制由 Schedule 校验。每种规则保留原生类型（after/at/every/daily/weekly/cron），不改写为 RRULE。新任务的计划投递到原生 `target: {kind:'new', create:{agentPreset:<任务 Preset>, cwd:<已校验目录>}}`：每次触发由 DSH Schedule 经 Host 的 Session 创建器（`sessionController`）新建一个独立根 Session，执行一个 run（见下节）。发起的 Owner Session 只作为原生 `actorSessionId` 记录，不是投递目标，也不把主 Session 的身份、Memory 或工具权限带给任务。不同 run 之间、run 与 QQ 主会话之间都不继承聊天历史。工具权限和身份在实际 Host 对象上校验，不能由工具参数填写。创建以 Host tool call ID 幂等；独立的新调用仍是新请求，不应盲目重试创建。

### 选择规则：纯提醒还是执行任务

判断标准是“到点时是否需要模型做事”：

- 到点只需把一句固定内容告诉用户（“下午三点提醒我开会”）→ 原生 `schedule_create`（`target:this_session`）。到期时 Character Identity 直接把 `[提醒到期]` 和提醒内容经 Outbox 发到 QQ，不启动后台 Agent，也不经过本插件。
- 到点需要查询、检查、整理、总结、调用工具或生成内容（“每天查询新闻并总结”“明早九点检查部署状态”）→ `long_task_create`。如果误用 `schedule_create`，用户只会在到点收到原始指令文本，而不会有人执行它。
- 请求含糊（“明天记得看看天气”既可能是提醒也可能是代查）时先向用户确认，不要猜。

一次性任务结束后不能改成重新执行，需明确新建。list 的 `executionState: ended` 表示原生单次触发已结束，`paused` 表示计划被外部暂停，`schedule_mismatch` 表示计划已不再投递到本任务自己的目标（新任务：带本任务 Preset、目录和指令头的新建 Session 目标；历史任务：其根 Session），修改会被拒绝；查看 runs 判断实际执行结论（每个 run 带 `sessionId`）。修改使用原生 `expectedUpdatedAt` CAS，冲突时不写入新版本。

## 每次触发一个 Run（统一 Task / Run 生命周期）

所有由 Character 管理、需要 Agent 执行的定时任务共用一套 Task / Run 生命周期：Task 保存定义、时间规则、Owner / Conversation 绑定、模型路由和权限；Run 对应一次 Schedule occurrence，ID 为 `sha256(任务 ID + occurrence 时间)`，与 Session 无关。没有第二套调度器、Agent Loop、数据库或 QQ 发送通道。

调用链：`long_task_create` → 原生 `schedule.create(target new)` → 到期时 Schedule 先在自己的记录中预留 Session ID（`pendingDelivery`），再调用 `sessionController.create({sessionId, cwd, agentPreset})`（Host 的 `agents.createSession` + `agentPresets.mount`，与历史根 Session 挂载同一个受限 Preset）→ 向新 Session 写入一条 `[SCHEDULE REMINDER]` 投递并提交 `lastDelivery` → 新 Session 第一步的原生 `agent/pre-step` 由本插件认领 → 执行 → 原生 `turn/end` 结算 → Character Identity `notifyConversation` → Outbox → QQTK Agent I/O 通知出口 → QQ。

Session ID 由 Schedule 在投递时生成，Character 不预先创建，也不认为一个 Task 永久对应一个 Session。认领（`admitRun`）时的归属证据缺一不可：

1. 实际 Host Agent 对象，组合 Preset 为任务 Preset，根 Session（无 `parentSession`、非委派）；
2. 恰好一个原生 Schedule 投递（生产者类型 `schedule`），其 `schedule_id` 是某个 per-run 任务自己的计划，提示词等于该任务当前版本的指令，任务处于 active 且 Conversation 校验通过；
3. 当场读取原生 `schedule.view`：该计划仍投递到带同一 Preset 与目录的新建 Session；若这条投递已提交（`lastDelivery.messageId` 相同），其 `targetSessionId` 必须就是当前 Session。0.2.2-rc.1 的公开 `view/catalog` 不暴露 `pendingDelivery`，所以提交之前只能依赖前两项（`schedule_id` 由 Host Schedule 写入投递帧，模型和用户输入不能伪造该生产者类型）；
4. 该 occurrence 尚无 run。

先把 run（含 `sessionId`、`scheduleId`、`messageId`）写入账本，再允许这一步执行；之后该 Session 只绑定这一个 run。同一轮后续步骤继续；此后该 Session 的任何新回合（用户在 Web 界面输入、重复投递、其他 occurrence）一律拒绝。找不到归属、Conversation 无法验证、计划被改投或 Preset 不符时拒绝执行，不猜测 QQ 目标。投递失败后原生 Schedule 会重试同一个预留 Session；即使 Host 另起一个新 ID，同一 occurrence 也已有 run，不会二次执行。

最终结果（C1）与活动汇报（C2）沿用同一套设施，不按投递方式分支：`turn/end` 只结算本 run 的 turn；`assistant/message` 取本 run 认领之后的最后一条回复；`completed` 只表示 Agent 本轮正常结束、**不是业务目标已验证**；工具显式错误或没有可用最终回复（空回复）都结算为 `needs_review`（`review: tool_error | no_result`），中断为 `interrupted`，取消为 `cancelled`，其余为 `failed`。终态通知事件 ID 仍是 `long-task:<runId>`，活动汇报仍是 `long-task:<runId>:activity:<序号>`，同一个 Outbox 去重；`unknown` 不重发。后台结果不经过 Interaction，也不放开 Interaction 对 schedule 来源的过滤：Interaction 只处理普通聊天，后台执行经可信通知出口发送；任务 Session 不是 QQ 会话，QQTK 不会再为它生成普通回复。

取消会删除未来触发，并对该任务每个运行中的 run Session 请求原生 cancel。Host 缺少 `sessionController`（无法创建 Session）时 `long_task_create` 明确报错且不写入任何计划，**不会**降级到共享根 Session 或 QQ 主会话。

### 历史任务兼容

此前创建的任务（记录中没有 `delivery` 字段，计划为 `target:{kind:'session'}`，预先创建的独立根 Session）不迁移，继续按原方式执行、修改、取消和重启恢复：同一根 Session 承载其所有周期，`taskAgent`、工具守卫、认领、活动汇报与通知都与新任务共用同一代码路径。两种任务可以共存。配置 `sessionMode: task-root` 可以让新任务也使用旧方式（仅用于没有 Session 创建器的 Host，属于显式选择）；默认 `per-run`。

### 已知限制

- DSH 0.2.2-rc.1 的 `sessionController` 没有卸载或释放 Session 的公开 API，Agent 句柄只属于创建者。每个 run 的 Session 在 Host 进程内保持加载直到 Host 重启（与 Web 界面里原生 `new` 目标计划的行为相同）；高频周期任务会累积内存中的空闲 Agent。原生对 `new` 目标设有 60 秒最小投递间隔（`newSessionIntervalSeconds`）。
- 原生 `new` 目标不占用执行槽：周期间隔短于单次执行时间时，同一任务的相邻两个 run 可以在各自 Session 中并行。它们是不同的 run，分别认领、汇报和通知；历史根 Session 任务则在同一 Session 中排队。工具副作用不能并行的任务应选择足够长的间隔。
- 新 Session 会按 `cwd` 加入已注册的 Workspace，并以“任务标题 · 时间”命名，因此会出现在 DSH 会话列表中。

## 持久化、通知与恢复

任务及 occurrence 执行账本位于原生 `character_long_tasks` storageDomain（per-record 布局）；执行内容位于原生 Session，计划位于原生 Schedule。角色绑定和通知仍使用既有 coordination.sqlite。没有第二个记忆数据库。更换 Owner/项目/角色不能复用原协调状态目录冒充旧身份。

Schedule `lastDelivery` 只证明指令写入任务收件箱。插件在原生 pre-step 中先持久化 occurrence 认领，再允许模型/工具执行；只有匹配的 Host Schedule 来源、任务版本和计划 ID 才能进入执行。重复 occurrence 不再次执行。`completed` 表示 Agent 本轮实际结束，**不是业务目标独立验收**；工具显式错误会得到 needs_review。

通知绑定稳定 Conversation，复用现有 Outbox 和稳定事件 ID。sent 代表发送 API 接受，不证明手机收件；unknown 不盲目重发。重启后不自动重放已认领但结果不明的工具操作，标记 interrupted/needs_review 并通知。账本保留用于防重，不自动清除；大量任务长期运行的账本增长需要后续留存策略。

逾期恢复使用 DSH 0.2.2 原生语义：停机跨越多个周期时只投递最近一期（latest-only），不逐期补跑；投递已写入收件箱但尚未执行的消息由原生从恢复的收件箱重新唤醒，不生成第二次投递。插件不再通过修改指令（旧 `[HOST BINDING]` 后缀）触发重新绑定，也不添加轮询或补跑队列；历史计划中残留的该后缀仍被识别为同一版本。0.2.2 在任务被其他 Session 修改时注入的 `[SCHEDULE CHANGE]` 通知不是 occurrence，不认领执行，也不打断进行中的一轮。极端情况下多个 occurrence 合并到同一轮会拒绝执行，需人工检查，不能静默合并多个目标。

## 执行期间活动汇报

运行中的 occurrence 会把 DSH 原生 Session 事件折叠为本 run 的活动记录：`step/start`（执行步骤）、`tool/call`（工具名与调用 ID）、`tool/result`（按调用 ID 配对，识别显式工具错误）。只记录计数、工具名和时间，不记录参数或结果内容。`turn/start` 在 pre-step 认领之前写入，因此 run 以认领时刻为开始；`turn/end` 仍交给原有终态逻辑。只接受本 run 所在 turn、认领之后、带原生序号且尚未处理过的事件。活动计数和终态用的工具错误标记（`toolError` → `needs_review`）使用同一条归属规则，所以周期任务上一轮的旧错误、回放或无序号的事件既不计入活动，也不会让本轮变成 `needs_review`。

活动汇报经由同一个 Outbox 以 `task_activity` 类型发出，事件 ID 为 `long-task:<runId>:activity:<最后覆盖的事件序号>`，与终态通知 `long-task:<runId>` 分开：

- 运行满 90 秒才发第一条；之后至少间隔 5 分钟，并且只在有新活动时发送。90 秒内结束的 run 只有原来的终态通知。
- 每个 run 最多一次快速异常提醒。首报前发生的工具错误不会提前单独通知，而是并入首报（首报以“检测到工具执行异常”开头），并算作这一次提醒；首报时没有异常的，之后第一次工具错误可以不等 5 分钟间隔立即提示。此后的错误按普通间隔汇报。工具出错不等于任务失败。
- 内容由确定的模板生成，不调用模型：观察时刻、尚未观察到本轮结束事件、所处步骤、工具调用与返回次数、正在等待的工具。不给出完成百分比、预计时间或业务结论；名称不符合安全格式的工具一律写成“一个工具”。
- 每条汇报以“截至 <日期 时:分:秒>（UTC±hh:mm）”开头，时间取自生成汇报时的 Host 时钟，按 Host 所在时区显示并写明偏移。Gateway 暂时不可用时汇报会留在 Outbox 稍后送达，正文不变，所以只描述那一时刻观察到的事件，并注明送达时任务可能已经结束。不编辑、撤回或过期清理已入队的汇报。
- 未返回调用按调用 ID 跟踪，明细最多 20 个。没有调用被挤出列表时，报告精确的未返回数；无法匹配任何调用的返回不会减少这个数。一旦有调用被挤出（只计数，不保存），这些调用是否已返回无法确认，只报告可证明的下界（“至少有 N 个工具调用尚未返回”），不点名，也不按截断后的列表配对。
- 每个 run 只有一个内存定时器，任务结束、取消或插件停用时清除。重启时原有恢复逻辑会把运行中的 run 结算为 interrupted 或 needs_review，因此不会重建定时器，也不会补发历史活动。
- 先在 run 账本中写入汇报标记，再入队；入队前崩溃最多丢失一条汇报，不会重复。投递结果不影响 run 状态。`unknown` 不重发，`sent` 只表示平台 API 已接受。
- 可选配置 `activityReport: {firstSeconds, intervalSeconds}`（1–3600 / 1–86400 秒），默认 90 / 300。

后台任务 Agent 没有任何发送权限。汇报由可信 Host 插件根据原生事件生成；`allowTools`、Preset 与工具守卫均未改变。

## 停用、备份与回滚

停用插件会撤销工具和 Preset；残留任务工具守卫拒绝新执行。**停用不自动删除原生计划或账本**。应先通过工具取消不再执行的任务，等待运行结束并保留完整 DSH_HOME 和 Character 数据备份，再移除依赖。保留中的计划在停用期间无法执行；重新启用会检查逾期计划，不能据此承诺补跑每一个错过的周期。

回滚代码前先停用本可选条目，保留原生 storageDomain、Schedule、Session 和协调库的一致快照。DSH 0.2.2 第一次写入 Schedule（修改或到期投递）后，存储升级为 v2，旧 0.2.1 Host 的 Schedule 服务无法加载 v2（隔离演练已证实），因此本版本不能单独回滚到旧 Host。协调库新增表是追加式，Memory Schema 未改变；不要用旧备份覆盖新增记忆或删除账本来重试任务。未在生产执行回滚或实机 QQ 验收。

## 隔离验证

`npm test` 覆盖身份、CAS、认领/去重、工具错误、恢复、通知边界与活动汇报（节流、去重、取消、重启、并发、周期轮次、投递失败）。`tests/long-tasks.test.mjs` 是历史根 Session 任务的兼容套件；`tests/long-task-runs.test.mjs` 按 0.2.2-rc.1 的 `new` 目标投递顺序（预留 ID → Session 创建器 → 投递 → 提交 lastDelivery）模拟 per-run Session，覆盖一次性/周期、提交前后认领、重复与批量投递、乱序事件、各类终态、重启、并发、越权 Session、无 Session 创建器的 Host 以及新旧任务共存。设置 DSH_INSTALL_ROOT 后运行 `scripts/run-lifecycle.ps1`，使用合成数据、确定性模型和假 Sender，验证两个真实 Host 进程（第二阶段把首次窗口设为 15 秒，并加入一个 20 秒的慢工具任务，检查原生事件生成的活动汇报与 Outbox 行）、停机逾期、原生周期到期、per-run Session（原生 run-now 加一次定时触发，两个 run 在两个由 Host 创建的 Session 中各自结算和通知）、历史根 Session 任务、最小工具权限、Memory 拒绝、旧提醒恢复和主路由保持。不连接 QQ，不证明真实模型任务质量或手机送达。
