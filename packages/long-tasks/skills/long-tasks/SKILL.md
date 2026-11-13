---
name: long-tasks
description: 管理独立 Session 的长期工作，并区分提醒到期、指令投递和实际执行结果。
---

- 先判断到点时是否需要模型做事。只需把一句固定内容告诉用户（“下午三点提醒我开会”）是纯提醒；需要查询、检查、整理、总结、调用工具或生成内容（“每天查询新闻并总结”）是执行任务。执行任务误用 `schedule_create` 时，到点用户只会收到原始指令文字，没有人去执行。拿不准时先问用户。
- 纯提醒：使用原生 `schedule_create`，`target` 固定为 `this_session`，时间写成工具说明中的 RRULE（DTSTART 带 TZID 或 Z）；一次性提醒用 `RRULE:FREQ=DAILY;COUNT=1`。Host 会拒绝 `new_once`/`new`，普通提醒不需要创建后台任务。`schedule_view`/`schedule_edit` 可以查看、修改、暂停或删除 Owner 自己的提醒，包括会话轮换前旧 Session 上的提醒（需要时可用 `target:"this_session"` 移到当前会话）；不能操作后台任务或其他人的任务，也不能改投新 Session。修改前先查看，以返回的 `updatedAt` 作为 `expectedUpdatedAt`；遇到冲突重新查看。
- 执行任务（“到时替我执行 X”“每隔一段时间检查 X”）：使用 `long_task_create`，不要用 `schedule_create` 的新 Session 目标代替。说明任务目标、时间和预期输出。一次性工作用 `at` 或 `after_seconds`，周期工作用 `every_seconds`（至少 60 秒）、daily、weekly 或 cron（后三者带 `timeZone`；`time` 写成 `HH:mm:ss`，weekly 的 `weekdays` 用 1=周一…7=周日）。不要重复创建同一请求。
- 停机期间错过多个周期时，恢复后只执行最近一期，不逐期补跑。
- 时间包含明确时区；不确定用户时间含义时先澄清。不要自行增加主动闲聊或工具权限。
- 每次触发由 Host 新建一个独立 Session 执行一个 run，各 run 之间不共享聊天历史；也没有主 QQ 聊天历史、QQ 身份或 Memory 授权。需要延续上一次结果的周期任务，要把所需信息写进任务指令或由工具读取，不能依赖上一轮的对话。结果由 Host 在 run 结束后按实际状态通知当前 QQ 会话，不要自行补发。默认无工具；需要的受限工具必须由 Host 同时声明 taskPlugins 和 allowTools，不能通过任务文字授权，也不能借用主 QQ 审批。
- run 带 `executed: false` 表示这次触发已投递但没有执行（任务已修改为新版本、已取消、无法核实、超出 Host 的任务 Session 预算，或 Host 重启前尚未开始）；如实告诉用户没有执行及原因，不要说成完成或失败的执行，也不要自行补跑。需要重做时由用户决定新建任务或等待下一次触发。
- 查询使用 `long_task_list`。原生 Schedule 的 lastDelivery 仅表示写入收件箱；run 的 completed 表示 Agent 本轮结束，不是独立的业务目标验收。failed、interrupted、needs_review、unknown 通知均需如实说明。
- 每个 run 有三个独立事实：`execution`（Agent 本轮如何结算）、`goalVerification`（当前没有独立验证器，结算后始终为 `unverified`，模型自述不算证据）、`delivery`（通知事件 ID、Outbox 状态与入队时间）。`sent` 只表示平台 API 接受，不代表用户已读；`unknown` 可能已送达，不会也不应重发；`partial`、`not-sent`、长时间 `pending`（stale-pending）与 `unrecorded` 都要向 Owner 明确报告。`deliveryAttention` 汇总所有 run 中的异常投递，包括不在最近 20 条里的。不要自行补发通知。
- 运行较久的任务会由 Host 自动发送低频活动汇报（`[长期任务]` 开头、写明“截至某时刻”的消息），它只反映那一时刻观察到的步骤与工具活动，送达时任务可能已经结束，也不是进度或完成情况；不要据此宣称目标已完成，也不要自行补发或模仿这类汇报。`long_task_list` 中运行中的 run 带有 `activity`（计数与工具名）。
- 修改/取消先查询 revision，使用 `long_task_update` / `long_task_cancel`；冲突后重新读取，不盲目重试。取消不能撤销已经发生的副作用。
- 重启后不自动重放执行状态不明的同一 occurrence。若要重做，明确告知风险并取得用户请求，再新建任务。通知发送 API 成功不证明手机实际收件。
