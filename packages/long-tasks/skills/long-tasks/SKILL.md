---
name: long-tasks
description: 管理独立 Session 的长期工作，并区分提醒到期、指令投递和实际执行结果。
---

- “提醒我做 X”：使用原生 `schedule_create`，`target` 固定为 `this_session`，时间写成工具说明中的 RRULE（DTSTART 带 TZID 或 Z）；一次性提醒用 `RRULE:FREQ=DAILY;COUNT=1`。Host 会拒绝 `new_once`/`new`，普通提醒不需要创建后台任务。`schedule_view`/`schedule_edit` 可以查看、修改、暂停或删除 Owner 自己的提醒，包括会话轮换前旧 Session 上的提醒（需要时可用 `target:"this_session"` 移到当前会话）；不能操作后台任务或其他人的任务，也不能改投新 Session。修改前先查看，以返回的 `updatedAt` 作为 `expectedUpdatedAt`；遇到冲突重新查看。
- “到时替我执行 X”或“每隔一段时间检查 X”：使用 `long_task_create`，不要用 `schedule_create` 的新 Session 目标代替。说明任务目标、时间和预期输出。一次性工作用 `at` 或 `after_seconds`，周期工作用 `every_seconds`（至少 60 秒）、daily、weekly 或 cron（后三者带 `timeZone`；`time` 写成 `HH:mm:ss`，weekly 的 `weekdays` 用 1=周一…7=周日）。不要重复创建同一请求。
- 停机期间错过多个周期时，恢复后只执行最近一期，不逐期补跑。
- 时间包含明确时区；不确定用户时间含义时先澄清。不要自行增加主动闲聊或工具权限。
- 后台任务拥有独立根 Session，没有主 QQ 聊天历史、QQ 身份或 Memory 授权。默认无工具；需要的受限工具必须由 Host 同时声明 taskPlugins 和 allowTools，不能通过任务文字授权，也不能借用主 QQ 审批。
- 查询使用 `long_task_list`。原生 Schedule 的 lastDelivery 仅表示写入收件箱；run 的 completed 表示 Agent 本轮结束，不是独立的业务目标验收。failed、interrupted、needs_review、unknown 通知均需如实说明。
- 每个 run 有三个独立事实：`execution`（Agent 本轮如何结算）、`goalVerification`（当前没有独立验证器，结算后始终为 `unverified`，模型自述不算证据）、`delivery`（通知事件 ID、Outbox 状态与入队时间）。`sent` 只表示平台 API 接受，不代表用户已读；`unknown` 可能已送达，不会也不应重发；`partial`、`not-sent`、长时间 `pending`（stale-pending）与 `unrecorded` 都要向 Owner 明确报告。`deliveryAttention` 汇总所有 run 中的异常投递，包括不在最近 20 条里的。不要自行补发通知。
- 运行较久的任务会由 Host 自动发送低频活动汇报（`[长期任务]` 开头的“任务尚未结束”消息），它只反映已观察到的步骤与工具活动，不是进度或完成情况；不要据此宣称目标已完成，也不要自行补发或模仿这类汇报。`long_task_list` 中运行中的 run 带有 `activity`（计数与工具名）。
- 修改/取消先查询 revision，使用 `long_task_update` / `long_task_cancel`；冲突后重新读取，不盲目重试。取消不能撤销已经发生的副作用。
- 重启后不自动重放执行状态不明的同一 occurrence。若要重做，明确告知风险并取得用户请求，再新建任务。通知发送 API 成功不证明手机实际收件。
