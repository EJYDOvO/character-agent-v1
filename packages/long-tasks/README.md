# 独立长期任务（可选）

`dsh-character-long-tasks` 是 Character Extras 的可选 Host 插件。使用 DSH **0.2.1-rc.2** 原生 Schedule、AgentPreset、根 Session、storageDomain，以及 Character Identity 的既有 QQ Outbox。不新增调度器、Agent Loop 或数据库。普通 DSH 项目的通用 QQ、Memory 不依赖它。

## 安装与配置

将本包安装到目标 Profile，启用 `dsh-character-extras`，再在 Profile 显式覆盖 Extras 中默认停用的条目：

```yaml
- id: long-tasks
  disabled: false
  config:
    presetId: long-task
    allowTools: []
    taskPlugins: []
```

依赖可信 `characterIdentity` 和原生 `schedule/storageDomain/agentPresets/agents/sessions/sessionPersistence/tools/skills`。不能在同一 Profile 再声明第二个实例或同名任务 Preset。默认不开放工具，也没有主 QQ Session、Memory 或审批代理权限。

有实际工作工具时，Host 必须同时配置 `taskPlugins`（原生 Preset 插件声明数组）和精确 `allowTools`。只安装/允许经过审查的受限工具。任务文字不能扩大权限；晚挂载工具仍受执行守卫限制。Memory、QQ、Schedule、Spawn 和插件管理入口不在本插件允许范围内。审批不能借用主 QQ 身份；需要这类能力的工作留给主 Agent，不能靠修改任务提示词解决。

## Agent 工具与 Skill

插件注册原生 runtime Skill `long-tasks`，以及四个工具：

| 工具 | 用途 |
|---|---|
| `long_task_create` | title/prompt + 一个原生时间选择器：at、after_seconds、every_seconds（至少 60 秒）、daily、weekly、cron |
| `long_task_list` | 当前 Owner/项目/角色/Conversation 范围的任务、原生投递、执行及通知状态 |
| `long_task_update` | id + revision；修改 title/prompt 或原生 change 规则（kind: at/every/daily/weekly/cron） |
| `long_task_cancel` | id + revision；删除未来触发并请求原生 cancel，不撤销已经发生的副作用 |

日历规则必须显式时区；原生时间规则和最低频率限制由 Schedule 校验。每个任务保留独立根 Session，周期轮次会沿用这个任务自身历史，不携带主聊天历史。工具权限和身份在实际 Host 对象上校验，不能由工具参数填写。创建以 Host tool call ID 幂等；独立的新调用仍是新请求，不应盲目重试创建。

“提醒我做 X”继续用 `schedule_create`；“到时替我执行 X”才创建独立任务。一次性任务结束后不能改成重新执行，需明确新建。list 的 `executionState: ended` 表示原生单次触发已结束；查看 runs 判断实际执行结论。

## 持久化、通知与恢复

任务及 occurrence 执行账本位于原生 `character_long_tasks` storageDomain（per-record 布局）；执行内容位于原生 Session，计划位于原生 Schedule。角色绑定和通知仍使用既有 coordination.sqlite。没有第二个记忆数据库。更换 Owner/项目/角色不能复用原协调状态目录冒充旧身份。

Schedule `lastDelivery` 只证明指令写入任务收件箱。插件在原生 pre-step 中先持久化 occurrence 认领，再允许模型/工具执行；只有匹配的 Host Schedule 来源、任务版本和计划 ID 才能进入执行。重复 occurrence 不再次执行。`completed` 表示 Agent 本轮实际结束，**不是业务目标独立验收**；工具显式错误会得到 needs_review。

通知绑定稳定 Conversation，复用现有 Outbox 和稳定事件 ID。sent 代表发送 API 接受，不证明手机收件；unknown 不盲目重发。重启后不自动重放已认领但结果不明的工具操作，标记 interrupted/needs_review 并通知。账本保留用于防重，不自动清除；大量任务长期运行的账本增长需要后续留存策略。

rc.2 不保证自动重试失败的冷恢复。启动后，插件只对自己的逾期计划使用原生 CAS 指令更新触发重新绑定，不改变到期时间；与原生已投递竞态通过 catalog 确认处理，不添加轮询调度器。极端情况下多个 occurrence 合并到同一轮会拒绝执行，需人工检查，不能静默合并多个目标。

## 停用、备份与回滚

停用插件会撤销工具和 Preset；残留任务工具守卫拒绝新执行。**停用不自动删除原生计划或账本**。应先通过工具取消不再执行的任务，等待运行结束并保留完整 DSH_HOME 和 Character 数据备份，再移除依赖。保留中的计划在停用期间无法执行；重新启用会检查逾期计划，不能据此承诺补跑每一个错过的周期。

回滚代码前先停用本可选条目，保留原生 storageDomain、Schedule、Session 和协调库的一致快照。协调库新增表是追加式，Memory Schema 未改变；不要用旧备份覆盖新增记忆或删除账本来重试任务。未在生产执行回滚或实机 QQ 验收。

## 隔离验证

`npm test` 覆盖身份、CAS、认领/去重、工具错误、恢复与通知边界。设置 DSH_INSTALL_ROOT 后运行 `scripts/run-lifecycle.ps1`，使用合成数据、确定性模型和假 Sender，验证两个真实 Host 进程、停机逾期、原生周期到期、独立根 Session、最小工具权限、Memory 拒绝、旧提醒恢复和主路由保持。不连接 QQ，不证明真实模型任务质量或手机送达。
