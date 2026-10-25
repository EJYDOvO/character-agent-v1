---
name: long-tasks
description: 管理独立 Session 的长期工作，并区分提醒到期、指令投递和实际执行结果。
---

- “提醒我做 X”：使用原生 `schedule_create`，它绑定当前 Session；普通提醒不需要创建后台任务。
- “到时替我执行 X”或“每隔一段时间检查 X”：使用 `long_task_create`。说明任务目标、时间和预期输出。一次性工作用 `at` 或 `after_seconds`，周期工作用 `every_seconds`（至少 60 秒）、daily、weekly 或 cron。不要重复创建同一请求。
- 时间包含明确时区；不确定用户时间含义时先澄清。不要自行增加主动闲聊或工具权限。
- 后台任务拥有独立根 Session，没有主 QQ 聊天历史、QQ 身份或 Memory 授权。默认无工具；需要的受限工具必须由 Host 同时声明 taskPlugins 和 allowTools，不能通过任务文字授权，也不能借用主 QQ 审批。
- 查询使用 `long_task_list`。原生 Schedule 的 lastDelivery 仅表示写入收件箱；run 的 completed 表示 Agent 本轮结束，不是独立的业务目标验收。failed、interrupted、needs_review、unknown 通知均需如实说明。
- 修改/取消先查询 revision，使用 `long_task_update` / `long_task_cancel`；冲突后重新读取，不盲目重试。取消不能撤销已经发生的副作用。
- 重启后不自动重放执行状态不明的同一 occurrence。若要重做，明确告知风险并取得用户请求，再新建任务。通知发送 API 成功不证明手机实际收件。
