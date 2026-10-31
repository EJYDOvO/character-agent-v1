# 当前状态

本页是版本与验收状态的统一入口。历史发布记录说明当时结果，不代表最新运行状态。

## Iteration 07 源码（Character test.26 / Agent I/O test.7，未部署）

Notification：主动通知统一经 Agent I/O 发送，保留稳定目标、持久 Outbox、原生 Schedule 与独立授权边界。全部为源码与隔离验证，**未部署、未合并**；运行实例为下一节的 Character test.25 / Agent I/O test.6。

- **调用链**：原生 Schedule 提醒（`schedule:` + sha256(schedule_id, occurrence)）、Long Tasks 结果（`long-task:<run>`）、Remote Ops 维护/长任务提示（`qqtk:<key>`）与 `notify()` 都只写入 Character Identity 的既有 SQLite Outbox；Outbox 是唯一写入者，经 QQ Gateway 交来的 Agent I/O 通知器发送。原 `runtime.sender.sendMarkdown` 直发路径删除。通知不成为 Agent 输入，不产生 Turn。
- **授权**：通知发往 Owner 私聊的稳定 Conversation，不要求来源 Session 仍是当前 Session。每个分片前复核：仍是同一次 Gateway 附加、Owner-only 访问配置、Owner 私聊 Conversation；提醒另须其来源 Session 仍有持久 `qq_bindings` 证据（来源 Session 随行记在 `identity_state` 的 `outbox-source:<eventId>`，不改表结构）。无绑定证据的根仍被拒绝；升级前遗留、没有来源记录的待发提醒保持 pending，不发送，等待人工审查。普通聊天、HITL 的当前 Session 检查与 Memory ACL 不变。
- **状态**：pending → sending → sent | unknown | partial | not-sent，或 pending → cancelled。持久认领后才交出；进程中断留下的 sending 在下一个所有者启动时记为 unknown，永不重发；只有平台之前被证明未发出（未授权、未准入、Gateway 关闭、队列满）或限流的尝试回到 pending 并暂缓；平台明确拒绝记为 not-sent。终态写入只作用于本所有者仍持有的 sending 行；HMR 时新实例等旧实例关闭后才恢复和发送。新增的 not-sent/partial 对旧代码只是未知状态（回滚安全）。
- **入口修复**：此前 pump 正在运行时 `notifySystem` 会立刻看到 pending 并抛错，Remote Ops 把实际稍后送达的通知记为 failed；现在 pump 串行并为后到调用补跑一轮，错误携带 Outbox 状态。
- **定向复审修复**：Pump 补跑使用最新附着上下文；旧尝试的迟到拒绝不能覆盖新附着释放的授权暂缓。I/O ID 使用事件哈希、实例 UUID 与尝试号，保持原始持久事件 ID，并满足 I/O 的 256 字符限制。关闭等待真实在途交接和前任所有者，重复 close/连续 HMR 不提前释放 SQLite；若底层永不结束则保持关闭等待，宁可暂缓接管。分页越过暂缓行，20 条缺来源的旧提醒不再阻塞后续合法事件；同时间戳按既有 SQLite rowid 保留入账顺序，不按事件 ID 重排。自动 Pump 的存储故障捕获后明确告警。
- **Remote Ops**（QQTK `1.1.1-test.2`，Character 部署不需要）：与 Character 集成时只由 Outbox 发送；独立运行时经通知器发送并如实记录状态，不再直接调用 Sender。
- **启停与排序**：QQ `notifications.enabled: false` 时不打开通知器，Outbox 中的通知保持 pending。通知与聊天共用同一 Conversation 的 I/O 队列（先后顺序、有界、可取消），没有优先级或公平性保证；Outbox 一次只交出一条，不会成串阻塞聊天。
- **部署依赖**：需要 `dsh-agent-io@0.1.0-test.7`（部署计划在补丁调用 `openNotifications()` 时要求，已安装 test.6 须显式 `--agent-io-artifact` 升级）与 Character test.26 包（Identity 变更，Core 成套升版）；SQLite 不迁移、不改表。

PR 初次验证（历史基线，未部署、未连接 QQ）：QQTK 轻量 190（新增通知 7：稳定目标、伪造凭据、逐片授权与准入、与聊天同队列的顺序/队列满/取消、平台结果、Remote Ops 账本与唯一发送方）、边界 3、代码隔离 SDK 审计 35（新增 Q24：真实 SDK 消息代码发出的通知、无输入时主动推送、限额内复用被动回复 ID、超时/5xx 为 unknown、403 为 not-sent）、两份补丁重建一致且可应用；Character 单元 232（新增 Outbox/通知 10：去重与并发、各结果、授权暂缓、崩溃与落盘失败、HMR 交接、关闭、轮换后旧 Session 的合法提醒、伪造根与发送前撤销绑定/撤权、遗留提醒、pump 串行）、安全审计 33；变异检查 15/15 被捕获；隔离 rc.3 Host：Interaction 探针 26 项（已安装 test.7 的通知器与真实 Outbox：无当前 Session 的稳定目标、伪造凭据拒绝、聊天仍需当前 Session、中断与超时为 unknown 不重发），Inspector 探针（真实 Identity + 原生 Schedule 到期 → Outbox → 通知器，去重）与 Lifecycle 探针（轮换与冷恢复后的旧 Session 提醒、长任务结果、Manager 卸载重装不重放 Outbox）通过，`qqNetwork: false`。

未验证：真实 QQ 主动推送额度、通知在手机上的显示；生产 Outbox 上的升级（部署时应先离线审计 pending/sending 行）；跨服务优先级与公平性；多进程同时打开同一 Outbox（依赖单活部署约束）；`run-generic-probe` 使用生产凭据，未运行。

定向复审追加验证（未部署）：Character 单元 244/244、安全审计 33/33；QQTK 单元 194/194、SDK 隔离审计及边界 38/38，两份补丁重建并在上游快照应用一致。新增回归覆盖重附着时六类旧发送结果及并发调用、保留 I/O 缓存的 HMR 重试、发送 ID 长度、连续 HMR 与重复 close、暂缓行分页、固定同毫秒入账的批量 FIFO、真实临时 SQLite 写锁/只读故障，以及 Remote Ops 初次落盘失败、写入结果不确定、终态写入失败和旧实例迟到写回。rc.3 Interaction/Notification 与 Inspector 探针通过；Lifecycle 的一次重启阶段出现原生 Subagent `cannot create effect on inactive context`，后续全新 Profile 复测及未改 PR Head 的两次对照通过，根因尚未确认，不将首次失败抹去或宣称稳定性完全验收。首次推送的 Ubuntu CI 捕获分页实现将同毫秒批量提醒按事件 ID 重排的回归，已以固定时间用例复现并改用入账顺序；未降低原顺序断言。

升级/回滚边界：尚未保护真实运行数据。从不包含本修复的旧代码升级，或回滚到旧代码，必须停止旧 Host 并确认退出后再切换，不能依赖旧实现的 10 秒关闭超时或跨版本 HMR。新实现内部 HMR 的所有权防护不能约束仍在执行的旧版代码。底层发送永久不结束时，关闭会等待而不放开所有权；需停净进程后以 unknown 屏障冷恢复，不盲目补发。

## Iteration 06（Agent I/O test.6，已授权部署）

2026-11-01 按授权部署：QQTK `main` `61ad840`（PR #7）的补丁与 70 个维护文件（新增 `ops.cjs` 与 `manage.ps1`：其 verify/Stage 改查 HITL Bridge 接线），Character `main` `4a2ac56`（PR #8）；已安装的 `dsh-agent-io` 经显式 `--agent-io-artifact` 由 test.5 升至 test.6，tarball 与在 `main` 上重跑的隔离 rc.3 探针（25 项，`hitl`/`inbound`/`media` 均已实测）所装的包逐字节一致。Character 包、Interaction test.9 与 Conversation Manager test.2 不变。

- **第一次切换未完成并已自动回滚**：分离启动的 Windows PowerShell 继承了 pwsh 的模块路径，离线快照脚本找不到 `Get-FileHash`；失败发生在停机之后、快照/审计/Profile 替换/维护文件替换之前，部署脚本恢复策略文件并以原 Profile（Agent I/O test.5）重启，QQ 重新连接（`ready`）。留下一个空的快照目录 `20261101-035837`（0 个文件）。改用 Windows PowerShell 自身的模块路径后第二次切换成功。
- **切换**：停机一致性快照 `20261101-035945`（404 个文件）；离线审计无未完成 Turn/审批（26/26）、无 active 提醒、Outbox 不变（sent 3）、Memory Schema 3 / 15 条；最终路径冻结锁文件安装与逐文件比对通过，维护完整性校验（新 `ops.cjs verify`）通过。
- **启动后**：新 Host 13 个 Preset 健康、单一 QQ Gateway（`Bot ready` 一次、QQ `connected/ready`）、`agent-io` test.6 与 Manager 激活、官方 ASAR 未变、错误日志为空；Owner 上下文、只读 Inspector、未登录/外站拒绝、QQ 路由、旧偏好、提醒与 Outbox 检查通过。旧 Profile 保留以便回滚。
- 部署前（11-01 03:09 起）旧 Host 的 QQ 健康记录停在 `reconnecting`：同期 Host 有 `ERR_NAME_NOT_RESOLVED`，为本机网络/DNS 中断；SDK 以 resume 重连成功时不更新该记录，因此当时无法确认是否已恢复。切换（含回滚那次重启）后 QQ 均为全新连接并 `ready`。

未发送 QQ 验收消息：真实 QQ 审批/问答按钮的显示与点击、手机端仍未验收。

HITL Bridge：原生审批与 `ask_user_question` 的 QQ 展示和作答迁移到 Agent I/O（QQTK PR #7 / Character PR #8，定向审查的多题发送竞态与文档基线修复后合并）。

- **权威不变**：原生 Approval（`approval/request`）与 `userQuestions.ask()`（`user-questions/request`）仍是唯一业务权威：审批策略、结果闭合集合（`allowed-once|rejected|cancelled|unavailable`）、审计事件与 `ASK_ABORTED` 错误语义都不变。Bridge 只负责请求关联、展示、可信回应、取消、超时与状态清理。
- **集中接入**：`dsh-agent-io@0.1.0-test.6` 在第一个平台打开 Bridge 时以 `prepend` 注册这两个原生 waterfall 的监听器一次，最后一个关闭时移除；不属于已打开 Bridge 当前 Session 的请求原样交给原生 Web/Desktop。不再修改全局 `userQuestions.ask`。
- **统一出站**：审批提示、提问、下一题与提问超时提示都经 `sendMessage()` 发送（同 Conversation 顺序、当前 Session/准入复核、去重、取消）。按钮是新的 `message.actions`，只能由 Bridge 签发，其他调用方与模型都不能构造；纯文本与附件消息不变。审批提示被证明未送达时为 `unavailable`（从不批准），结果未知时不重发按钮；被拒的提问按钮以纯文本重发一次。
- **可信回应**：按钮与文本回应须来自同一 Conversation 的预期作答者（群聊按点击成员 `group_member_openid`；原通道在群里比较的是 `user_openid`），请求未完成、原生信号未中止、Session 仍为当前且仍被准入；伪造、重复、迟到、过期、跨会话与旧题回应一律拒绝，每个请求（每道题）只完成一次。文本作答在 I/O 入站去重范围内认领，重投不再作答也不进入 Agent；不满足条件的文本照常是普通聊天。
- **QQ**：只保留原 Markdown 渲染（问题另显示原生 `detail`，计划审阅需要它）、键盘渲染与按钮事件转换；原 `ApprovalChannel`/`QuestionChannel`/`questionAnswer` 不再被引用，Gateway 直发审批/问答的路径已删除。`hitl.enabled: false` 时交回原生 Web/Desktop。
- **Character**：部署计划在补丁调用 `openHITL()` 时要求 `dsh-agent-io` 提供 `openHITL()` 与 Bridge 模块（test.6），已安装 test.5 须显式 `--agent-io-artifact` 升级；隔离探针新增真实 Host 的审批与问答检查。Character 运行包无改动。

验证（本机，未部署、未连接 QQ）：QQTK 轻量 183（新增 HITL 14，含定向审查修复：每题独立取消，已作答题目排队或未开始的提示分片不再发送）、边界 3、代码隔离 SDK 审计 34（新增 Q22/Q23：真实 SDK 消息代码发出的键盘请求、真实 `INTERACTION_CREATE` 分发与 `acknowledgeInteraction`、群成员校验、未知不重发、被拒按钮）、两份补丁重建一致且可应用；HITL 关键保护的变异检查 15 项中 14 项被捕获（余 1 项为等价变异）；Character 单元 221、安全审计 33；隔离 rc.3 探针 25 项（原生审批 `decide()` 与 `userQuestions.ask()` 经已安装 test.6 的 Bridge：按钮允许/拒绝、逐题按钮与文本作答、中止、重投去重；另一 Agent 与 Bridge 关闭后请求留在原生应答者），`qqNetwork: false`。

未验证：真实 QQ 按钮键盘的显示与点击（含 keyboard 权限、群聊点击字段）、手机端；同一 Session 并发的第二个审批仍为 `unavailable`；HITL 状态只在内存，重启即取消；`run-generic-probe` 使用生产凭据，未运行。

## Iteration 05（Agent I/O test.5，2026-10-31 授权部署，已由 Iteration 06 取代）

2026-10-31 按授权部署：QQTK `main` `47a2a43` 的补丁与 67 个维护文件、Character `main` `15ec724`；已安装的 `dsh-agent-io` 经显式 `--agent-io-artifact` 由 test.4 升至 test.5（tarball 与在 `main` 上重跑的隔离 rc.3 探针所装的包一致）。Character 包、Interaction test.9 与 Conversation Manager test.2 不变。停机一致性快照 400 个文件；离线审计无未完成 Turn/审批、无 active 提醒、Outbox 不变、Memory Schema 3 / 15 条；最终路径冻结锁文件安装与逐文件比对通过；新 Host 13 个 Preset 健康、单一 QQ Gateway、`agent-io` test.5 与 Manager 激活，部署后 Owner 上下文/Inspector/路由/提醒/Outbox 检查通过；旧 Profile 保留以便回滚。未发送 QQ 验收消息，真实 QQ 命令、媒体与手机端仍未验收。

Commands 与基础 Media 抽离，并修复第四轮遗留的 Turn 取消控制器淘汰问题（QQTK PR #6 / Character PR #7，定向审查的两个问题修复后合并）。

- **Commands**：QQTK `dsh-agent-io@0.1.0-test.5` 新增 I/O 内部命令路由（`conversation.openCommands()`）：识别、解析、在入站去重范围内一次性认领（`claim()`）与路由；执行与授权仍由命令所属插件负责。QQ 的 `/stop`、`/bot-*`、`/new`、`/compact`、`/model`、`/preset` 与 Remote Ops `/ops` 改经该路由，QQ `commandGate` 只做 @ 标记与群 @ 判断，位置仍在并发合并之前；SDK `slashCommand` 已移除。命令消息不会重复执行，也不会再成为 Agent 输入；未知命令仍作为普通聊天。审批/问答回应与显式更正保持原语义。
- **基础 Media**：`sendMessage()` 与入站标准消息新增可选附件描述（图片/语音/视频/文件；可信资源 `resource` 与模型可见内容分开）及入站引用 `quote`。QQ 入站附件与引用改为标准描述，模型可见正文从描述组装（格式不变）；`qqbot_send_file` 改经 `sendMessage()` 作为附件消息发送——只能发往调用者 Agent 的当前会话（不再接受其他 openid）、路径白名单与符号链接解析保留并在发送时复核、上传与媒体消息分阶段分类（上传失败 `not-sent`，消息超时 `unknown` 不重发）、同轮同文件不重发。原 `mediaSender` 直发路径已删除。
- **Iteration 04 遗留修复**：QQ Gateway 的 Turn 控制器改为租约：仍在 I/O 中的提交持有其控制器，容量（每 Session 8、全局 256）只淘汰空闲控制器，`/stop` 总能取消排队中的旧 Turn 输出；Session 释放（Conversation Manager `release`）与 Gateway 关闭时中止并清理；被持有的数量受 I/O 队列上限约束。
- **定向审查修复**：(1) 同一 Session 已有 8 个被持有的控制器时，新建的控制器会在取得租约前被容量清理删除，`/stop`、Session 释放与 Gateway 关闭都够不到它（含无 Turn 输出与中止墓碑）；现在新建的控制器不参与本次清理。(2) 入站下载结果原按文件名关联（上游组装逻辑同样如此），同名附件、无名的引用附件或下载失败的同名附件会指向同一个/别的文件；现在逐个附件下载并按附件序号关联，不改上游中间件文件。均有最小复现转成的回归测试与变异检查。
- **Character**：部署计划在补丁使用 `openCommands()` 时要求 `dsh-agent-io` 同时提供 `openConversation()` 与 `openCommands()`（test.5），已安装 test.4 时须显式 `--agent-io-artifact` 升级；隔离 Interaction 探针新增命令与媒体检查。Character 运行包无改动。

验证（本机，未部署、未连接 QQ）：QQTK 轻量 169（新增命令路由 10、Turn 控制器 9、QQ 媒体 14 及命令/取消集成项；SDK 相关项需验证 Profile，否则跳过）、审批/边界 12、代码隔离 SDK 审计 32（新增真实 SDK MediaApi 的上传/发送与错误分类）、两份补丁重建一致且可应用、导出检查无本地密钥；Character 单元 220、安全审计 33；隔离 rc.3 Interaction 探针 24 项（含已安装 test.5 的命令路由与 QQ 门、真实文件经 I/O 的 `qqbot_send_file`、入站附件描述），`qqNetwork: false`。关键保护的变异检查（租约淘汰、命令认领/准入/门控、发送时白名单与真实路径复核、目标限制、上传阶段分类、远程资源、附件预检、未知不重试）均被测试捕获。

未验证：真实 QQ 上传与手机展示（图片/语音/视频/文件的格式与大小限制）、真实群聊命令与 @ 行为、语音 STT；视觉理解等高级媒体工具未改；出站引用（`replyTo`）与远程 URL 附件未实现；`run-generic-probe` 使用生产凭据，未运行。

## Interaction test.9 / Agent I/O test.4 / QQTK Iteration 03–04（已授权部署）

Character 其余包与 Core/Extras 不变（仍为 test.25，产物哈希与运行实例一致），仅 `dsh-interaction-policy` 升至 `0.1.0-test.9`；已安装的 `dsh-agent-io` 经部署计划新增的显式升级路径（`--agent-io-artifact`：先按固定记录复核已安装包，新包须为另一版本且提供 `openConversation()`）由 test.3 升至 test.4，所用 tarball 与隔离 rc.3 Interaction 探针（入站已实测）安装的包逐字节一致，旧 tarball 与旧 Profile 保留。QQ 补丁与 QQTK 维护源码来自 QQTK PR #5 `e01fcce`，Character 来自 PR #6 `811a880`（部署时两 PR 尚未合并；之后已合并：QQTK `main` `51c0e41`、Character `main` `b880464`，合并后的代码除文档外与部署一致）。

已按授权完成空闲门禁、停机一致性快照（395 个文件）与离线状态审计（无未完成 Turn/审批、无 active 提醒、Memory Schema 3 / 15 条），候选离线安装与最终路径冻结锁文件校验通过（已安装运行代码逐文件比对已审源码），替换 63 个 QQTK 维护文件后单活切换。启动后 13 个 Preset 健康、单一 QQ Gateway（`Bot ready` 一次）、`agent-io`（test.4）与 Manager 激活、官方 ASAR 未变、启动日志无错误；Owner 上下文、只读 Inspector、未登录/外站拒绝、QQ 路由、提醒与 Outbox 保持不变。未发送 QQ 验收消息；QQ 不再边生成边显示（短回复与最后一个气泡在生成结束后整条出现），实际分泡节奏与手机收件待真实对话确认。

## Iteration 04 源码（Interaction test.9，已随上文部署）

Interaction `0.1.0-test.9` 只提交完整气泡（长回复在生成期间按定稿规则提前提交，其余在 settlement 后提交；不预览、不使用 `openStream`）。QQTK 补丁的桥接层把每个气泡、等待提示与工具/轮次错误都作为一条逻辑消息交给 Agent I/O `sendMessage()` → QQ 文本 Adapter：稳定逻辑 ID（Session/Turn/策略实例/回复/气泡）、按原生输入的回复目标、逐片权限与当前 Session 复核、`/stop`/撤回/Turn 中止取消、未确认气泡不重发并扣留同回复后续气泡。Interaction 专属 SDK Stream 与普通回复的 SDK 流式输出已移除（`streaming` 停用）。Agent I/O 公共接口不变（仍为 `0.1.0-test.4`）。范围见 [路线图](architecture-planning/IMPLEMENTATION_ROADMAP.md) 3.3。

验证（部署前，本机、未连接 QQ）：Character 单元 219、安全审计 33；QQTK 轻量 128、审批/边界 12、代码隔离 SDK 审计 30（新代码隔离夹具）、两份补丁重建一致且可应用；关键保护的变异检查均被测试捕获；隔离 rc.3 Interaction 探针 22 项（真实 Agent/Interaction 的气泡、等待提示与 steer 回复全部经已安装的 Agent I/O，未调用直发或 SDK 流）。`run-generic-probe` 会以生产 QQ 凭据启动 Gateway，未运行。新 Interaction 与新 QQ 补丁须配套部署（新 Interaction 配旧补丁会绕过 I/O）。

### Agent I/O 升级限制（已解决，保护未绕过）

部署计划现以显式 `--agent-io-artifact` 升级已安装的 Agent I/O（见上文与 [集成说明](INTEGRATION.md)）；不传参数时仍拒绝。以下为部署前的记录：运行实例当时为 `dsh-agent-io@0.1.0-test.3`。Iteration 03/04 的 QQ 补丁需要 test.4 的 `openConversation()`：Gateway 在旧包上启动即报错，Character 部署计划检测到补丁使用 `openConversation` 时拒绝已安装的旧包（“this plan does not upgrade the installed dsh-agent-io yet”）或不含该接口的新包。部署计划目前不能把已安装的 Agent I/O 原地升级，这一保护未被修改或绕过；部署 03/04 前须先单独实现并审查“已安装 Agent I/O 升级”步骤。

## Iteration 03 源码（Agent I/O test.4，随上文部署）

QQTK `dsh-agent-io@0.1.0-test.4` 新增平台无关的 `openConversation()`：入站交接（Conversation Manager `getOrCreate` → `isCurrentSession` → 原生 `UserMessage` → Interaction `intervene`/`followup`）与出站可信路由（Manager 当前记录 + `isCurrentSession`，每个分片前复核）收在一处，出入站共用 `{platform, accountId, conversation}` 引用。QQ Official 入站、出站文本、显式更正与 `/stop` 已改用；Session Key、持久状态、Character Identity/Owner/Memory ACL 与 Conversation Manager 均未改。Character 包无改动，仅更新隔离 Interaction 探针、部署计划检查与文档：QQ 补丁使用 `openConversation()` 时，部署计划拒绝没有该接口的 `dsh-agent-io`（已安装的 test.3 或首次安装的旧 tarball），避免 Gateway 启动即失败；计划本身尚不支持升级已安装的 `dsh-agent-io`。

验证（本机，未部署、未连接 QQ）：QQTK 轻量 124（含新增 Conversation 接线 10 项）、审批/边界 12、代码隔离 SDK 审计 33、两份补丁重建一致且可应用；Character 单元 220、安全审计 33；隔离 rc.3 Interaction 探针 21 项（含已安装 test.4 包的 Interaction 查询、Host `dsh-llm` 原生输入与 QQ 入站/出站经新接口）。`run-generic-probe` 会以生产 QQ 凭据启动 Gateway，未运行；`maintenance.test.cjs` 需安装目录的 `js-yaml`，在源码仓库与 `main` 上同样无法运行。范围与遗留见 [路线图](architecture-planning/IMPLEMENTATION_ROADMAP.md) 3.2。

## test.25（已授权部署）

起因：test.24 上线后的真实 QQ 对话里，被问到“今年的年度游戏提名”时，模型虽有 `web_search`/`research` 等工具却未调用，直接给出虚构名单；工具、模型路由（`navigator/gemma-4-31b-it`）与提示均与部署前相同，系统提示也没有“先查证”的要求。

修复：所有 Character 共用的 Root 执行策略（系统提示 `character:execution`，由 `dsh-character-memory-tools` 注入；不进入 Worker，也不改私有 Persona）新增一条：涉及当年、最新、实时或近期的具体事实（作品与名单、奖项提名、发售、价格、版本、新闻等）或不确定的作品归属，先用可用的搜索工具查证并说明来源；“猜猜看”也先查已知事实，再把推测标为推测；查不到、搜索失败或无搜索工具时如实说明，不编造名称或细节。原有文字不变，策略文本移入可测试的 `root-policy.mjs`。这只提高主动搜索的概率，是否调用工具仍由模型决定。

已按授权完成空闲门禁、停机一致性快照（393 个文件）与离线状态审计（无未完成 Turn/审批、无 active 提醒、Memory Schema 3 不变），候选离线安装与最终路径冻结锁文件校验通过后单活切换；Core 与 test.24 完全相同，QQ 补丁与 Agent I/O 不变，仅同步一份 QQTK 文档。启动后 13 个 Preset 健康、单一 QQ Gateway、`agent-io` 与 Manager 激活、官方 ASAR 未变；部署后复核（Owner 上下文、只读 Inspector、未登录/外站拒绝、QQ 路由、提醒与 Outbox）不变，启动日志无错误。Character 单元 219、安全审计 33。未发送 QQ 验收消息；模型实际是否改为先搜索待真实对话确认。旧 Profile 与快照留在本机。

## test.24 / Agent I/O test.3（已授权部署）

Unified Agent I/O Iteration 01/02 上线：Core 新增 `dsh-agent-io@0.1.0-test.3`（首次安装，tarball 与隔离 rc.3 Interaction 探针入站/出站实测的包逐字节一致），QQ 包装声明 `agentIO`，QQTK 补丁为 QQTK main `ebc2568`。未绑定 Interaction 的普通文本出站（回复、Streaming 静态降级、工具错误、轮次错误）改经 `sendMessage()`，带稳定消息 ID、Turn 取消与发送前当前 Session/访问复核；普通聊天入站经 `openInbound()` 去重后由 QQ 会话入口复核访问并在交接前复核当前 Session，再经 Conversation Manager 创建原生输入。Character 其余包只升版本号，运行代码与 test.23 一致；Core 仅新增 `agent-io` 一行；Interaction test.8、Manager test.2、Persona、Owner、Extras 不变。

已按授权完成空闲门禁、停机一致性快照（377 个文件）与离线状态审计（无未完成 Turn/审批、无 active 提醒、Memory Schema 3 / 13 条不变），候选离线安装与最终路径冻结锁文件校验通过（含补丁新增文件逐一比对已审源码），替换 60 个 QQTK 维护文件后单活切换。启动后 13 个 Preset 健康、单一 QQ Gateway（`Bot ready` 一次）、`agent-io` 与 Manager 激活、官方 ASAR 未变；Owner 上下文、只读 Inspector、未登录/外站拒绝、QQ 路由、提醒与 Outbox 保持不变，启动日志无错误。未发送 QQ 验收消息；旧 Profile、被替换的维护文件与快照留在本机。

验证：Character 单元 217、安全审计 33；QQTK 轻量 114（含真实 Conversation Manager 源码的关闭竞态与 SDK 合并串行回归）、SDK 隔离 33，补丁在原始 0.5.2 包上经 Host 自带 pnpm 应用 18/18 一致；真实 rc.3 Interaction 19 项（`inbound: exercised`），旧 I/O 包会使入站必验项失败。模型、Sender 与 QQ 网络为合成替身。

未验证：真实 QQ 收发与手机展示、重连补投；并发重复不等待首条结果、入站在途数量无上限、`failed/unknown` 后不提示用户，均为已记录的契约边界（QQ 路径不会触发）。

## test.23 / Interaction test.8（已授权部署）

针对 test.22 实机审计的修复。已按授权完成空闲门禁、停机一致性快照（367 个文件）与离线状态审计（无未完成 Turn/审批、无 active 提醒、Memory Schema 不变），候选离线安装及最终路径冻结锁文件校验通过后单活切换。启动后 13 个 Preset 健康、单一 QQ Gateway、Manager 与关键服务激活，官方 ASAR 未变；已部署的 Core 中七个内置 Worker 均装配工具范围、等待提示起草为 4 秒。Owner 上下文、只读 Inspector、未登录/外站拒绝、QQ 路由、提醒与 Outbox 保持不变。未发送 QQ 验收消息；旧 Profile 与快照留在本机。

- **Worker 工具范围（安全）**：内置 Worker Preset 增加 `worker-scope.mjs`，在 Preset 自身组合内用原生 `ctx.tools.restrict({deny})` 屏蔽只读搜索以外的全部 Host 全局工具（Browser MCP 含 `run_code_unsafe`、`long_task_*`、`qqbot_send_file`、`working_directory` 等），并随 `tools/change` 刷新；刷新前由原生 `ctx.tools.guard()` 拒绝执行。Preset 自带工具、Root 与原生全局权限不变，未给 Worker 增加文件/终端/网络权限。详见 [Worker](WORKERS.md)。
- **委派可靠性**：Root 策略说明 Worker 无文件工具（Root 先读材料并附来源）、`subagent` 返回子 Agent ID 而非 job、结果经 settlement 自动送达；blocked/needs_input 时如实说明，不把推测当结论，不复述内部工具细节；查看目录用 glob 或限定深度，不把递归全量列表放进对话。
- **Interaction test.8**：闲聊不再逐句碎泡（只在空行处分段）；等待提示不占正文气泡预算；尾泡流式时完整预览；动态等待提示于 4 秒起草并参考请求节选、避免重复；回复策略补充对问候/表情的轻松解读。详见 [Interaction Policy](INTERACTION-POLICY.md)。
- **诊断**：`delivery-confirmed` 按发出该气泡的回复归属；`intervene` 带判断耗时 `elapsedMs`；`hang-on`/`hang-on-draft` 带 `draft` 结局；QQTK 记录器同步放行这些枚举/数字字段及 `superseded`。
- **测试**：Character 单元 215、安全审计 33；QQTK 轻量 55、审批（含新增 5 分钟超时）6；真实 rc.3：Worker 两阶段（十个 Preset，Spawn 前后注册的全局工具及 `long_task_create` 的模型调用均未执行，WorkerResult 以 settlement 回到 Root，冷恢复与整机重启）、Interaction 17 项、Inspector Core-only/Extras/模块、Lifecycle 两阶段均通过。模型、判断器与 Sender 为合成替身。`--workers --manager` 探针在 55 秒加载期限内未完成，本轮未作为通过项。

未解决与待决：原生 pwsh 输出没有按 Preset 的内联上限，只能靠 Root 策略避免递归列表；QQ Session 工作目录由生产 Profile 指向 `default-workspace`，其中有旧版 `character-agent-v1` 副本（test.2），未改动；私有 Persona 的“每次以嗯开头”和固定等待文案只给出建议文案，未覆盖；流式撤回残留待手机确认；测试残留文件保留。

## test.22 / Conversation Manager test.2（已授权部署）

隔离复现 test.21 遗留问题后，修复普通 ENOENT 被误判为缺失、Preset 查询吞异常、关闭重复释放/未等待旧句柄和清理异常中断收尾。Identity 保留现有包装方式，只增加 rebuild 前后 epoch 校验及卸载时的包装归属检查；旧操作完成不能授予新 epoch 权限。不修改 Memory Schema、Persona、Owner、Interaction 或 Worker 授权，也不增加服务。

复现：同一组 Manager 回归在原 test.21 源码上出现 11 项失败；修复后 QQTK 54/54、SDK 隔离 33/33；Character 单元 204/204、安全审计 33/33。实际 rc.3 的最终 Manager tarball 双进程验证通过，包含真实持久化、依赖错误注入、冷恢复、轮换、Memory ACL、历史提醒、独立任务、Outbox 与服务重载。原生 Interaction 17 项及十个 Worker 配置/冷恢复通过；QQ/SDK 补丁未变且快照应用一致。模型、Sender及故障为合成替身。

已按授权完成空闲门禁、停机一致备份和原位升级，候选/最终路径均通过离线与冻结锁文件校验；13 个 Preset、单一 QQ Gateway、Manager 和关键服务健康，官方 ASAR 未变。当前 Manager JSON、旧偏好、Memory Schema/数量、提醒和通知状态保留；Character 记忆模式及只读 Inspector 保持，Owner 上下文正常，未登录/外站 Origin 被拒绝。部署包与双进程隔离验证的 tarball 哈希一致。

未发送 QQ 验收消息，也未做生产故障注入或回滚演练；旧 Profile、维护文件与一致性快照留在本机。可以开始受控真实 QQ 验收，仍需检查普通/长回复、工具前后插话、停止、首条消息轮换及手机审批。没有开发新平台或更换权限模型。

## test.21 / Interaction test.7 / Conversation Manager test.1（已授权部署）

- Interaction：工具全部完成后重置阶段；分类期间连续输入、显式更正和空闲切换保持顺序并消费一次，迟到结果无效。渐进分泡、Worker 续轮、动态等待提示与回执协议保留。
- 会话管理：QQTK 的 SessionManager 变为薄适配；新独立包持有唯一当前路由与显式状态文件，复用原生 Sessions/Preset/模型与 Schedule。Identity 不再读 QQTK 私有 prefs/sessions，使用公开 Host 归属契约。没有新数据库、权限体系或 Agent Loop。
- 可靠性：偏好写失败回退内存并报错；只有明确不存在才新建 Session，创建需 Flush 确认；清模型偏好不重置归属；Manager/Agent/QQ 卸载释放 Typing。部署入口增加已审阅状态和独立包 pin/哈希门禁。

验证：Character 单元 201/201、安全审计 33/33；QQTK 轻量 43/43、SDK 隔离 33/33，两份补丁在原始代码快照上重建/应用一致。真实 rc.3 Interaction 17 项检查通过，包含工具后 priority/revise。两个真实 Host 进程验证模拟第二平台、并发、重启/12h 轮换、历史根禁权/提醒、Memory、独立任务/Outbox、Manager 卸载重载和身份重绑；10 个 Worker 配置的原生 Spawn/工具/冷恢复回归通过。Provider、判别器、Sender/SDK 网络均使用合成替身。

后续已获授权并完成单活部署：空闲门禁、停机一致性备份、存量 Session/Schedule/绑定及通知账本审计通过；旧偏好完整复制到 Manager 状态文件，原文件保留。候选离线安装与最终路径冻结锁文件校验通过，13 个 Preset 健康、单 QQ Gateway、独立 Manager 与关键服务激活，官方 ASAR 未变。Memory Schema/数量、原提醒及通知状态保持；Owner 上下文重新建立，Character 记忆模式与只读 Inspector 保留，未登录及外站 Origin 被拒绝。

发布前再次通过 201 项单元、33 项安全审计和 QQTK 43 项轻量测试，两份补丁在上游快照应用一致；上线 Manager tarball 哈希与双进程隔离验证的包一致。旧 Profile、维护文件与一致性快照保留在本机，未做生产故障注入/回滚演练，未发送 QQ 验收消息。真实模型连续插话、手机收件/审批、Desktop 视觉及 NapCat 协议仍未验证。ChatGPT Library 原文不可直接访问，本轮参考本地 v0.7.8 归档及实际 SDK。详细审计、日志和用户数据只留本地，不上传。

## Interaction test.6（Character test.20）部署记录

已部署 Character test.20 / Interaction test.6（含下文第 1–3 阶段），配套更新的 QQ Bot 补丁（含 `inbound.js`）。候选 Profile 离线安装并冻结锁文件，产物校验通过；Profile 配置未改动，其他运行代码未变，官方 ASAR 未变，无 Memory 迁移，未发送真实 QQ 测试消息。

本次线上 Host 由 13:33 的非维护启动产生，维护状态接口不可达；经所有者授权停机，停机后离线一致性快照（338 个文件）与离线状态审计确认无未完成 Turn 或审批，再执行切换。切换后 13 个 Preset 健康、单 QQ Gateway、诊断开启。旧 Profile 保留在 `data/maintenance/interaction6-*/profile-before`。

真实模型的插话判断准确率与延迟、真实 QQ 入站和手机展示仍待实机验收。

## Interaction test.6 第 2、3 阶段

- **渐进分泡**：长回复流式期间按与 settlement 相同的切分逐泡定稿，保留一泡给开放尾部；已定稿气泡不改写、不重发，重试和 settlement 改写只记录诊断。切分新增引导语与标题规则（修复实机截图中标题和引言被切到上一泡末尾的问题）。
- **执行期间的新消息**：QQ 入站在 Agent 运行时把新输入交给 `intervene`，不再在入口层扣到整轮结束；插件用原生 `llm` 判断 revise/priority/supplement/append，只调用原生 cancel/steer/followup，工具与审批不被 cancel，超时或失败按排队处理。入站不再等待整轮结束，改由会话级 typing 保活维持“正在输入”。

验证：Character 单元 197/197（第 2 阶段新增 8 项，第 3 阶段新增 11 项）、审计 33/33；QQTK 轻量 37/37（含入站与判断诊断枚举）及补丁重建校验；实际 rc.3 Host 16 项，新增判断为 priority 时原生 cancel 并立即回答新输入、判断为 append 时原回复完整送达后再回答。Provider、判断器与 Sender 为合成替身；真实模型的判断准确率与延迟、真实 QQ 入站（`handleInbound` 只有单元覆盖）与手机展示均未验证。QQTK 的 SDK 隔离审计需要专用夹具目录，本轮未运行（SDK 补丁未改）。

## Interaction test.6 第 1 阶段

回复归属与 Worker 续轮。修复 Worker 完成结果被当作后台输出整轮丢弃（实机 Turn 7 确认）；回复上下文按输入划分（编号、预算、`input` 归属），修复跨 Turn 尾泡编号串号和同 Turn 多输入挤占预算；QQTK 按输入 ID 选择回复目标、委托 Interaction 判断非用户来源，并为主动回退失败、抑制来源和不确定流式分段增加脱敏诊断。插话控制（第 3 阶段）与渐进分泡（第 2 阶段）尚未实现。

验证：Character 单元 178/178（新增 8 项，均在旧代码上失败）、审计 33/33；QQTK 轻量 35/35（新增 4 项）及补丁重建校验；实际 rc.3 Host 14 项（新增原生 steer 独立回复上下文、Worker 续轮投递原目标与伪造子 Session 抑制；其中 `subagent/catalog` 为合成注入，续轮通知为原生 followup）。未部署，未发送真实 QQ。

## Interaction test.5（Character test.19）

源码与隔离验证完成：约 5.5 秒仍无自然回复回执时，经原生 `ctx.llm` 并发生成一句 Persona 等待提示，8 秒复查后发送候选或固定文案；请求不带 Session 归属，不写历史或 Memory。默认继承当前 Agent 的 Provider/Model，`hangon-model.json` 可单独改路由。同时修复等待提示回执被当作正文送达，以及等待提示与正文分泡之间的 `maxBubbles` 计数竞态。QQTK 投递诊断新增 `kind`/`dynamic` 枚举字段，QQTK 不调用模型。

验证：Character 单元 170/170（含新增 15 项）、审计 33/33，QQTK 轻量 31/31 及补丁重建校验；实际 rc.3 Host 12 项交互检查（含动态生成、超时回退、模型路由）及两进程生命周期/旧提醒/长期任务恢复通过。模型与 Sender 为合成替身，真实模型的提示质量、生成延迟和手机展示尚未验证。

已部署 Character test.19 / Interaction test.5，配套更新的 QQ Bot 补丁；Profile 配置未改动，`hangon-model.json` 未创建，即继承主模型。冻结锁文件安装与产物校验通过，13 个 Preset 健康、单 QQ Gateway，官方 ASAR 未变。部署前保留离线一致性快照和旧 Profile，无 Memory 迁移，未发送真实 QQ 测试消息。Preset Manager / Inspector 保持 test.3，Inspector 仍只读。

## Interaction test.4（Character test.18）

源码与隔离验证完成：长工具结果可按安全句界/段落分泡；8 秒未收到自然回复发送确认时加入一次等待提示；SDK 缓冲不算确认。QQTK 新增默认关闭的脱敏投递记录及只观察的 SDK 回执钩子。完整重复气泡尚未复现，本轮不宣称已修复其根因。

验证：Character 单元/安全审计 188/188、QQTK 轻量 30/30、代码隔离 SDK 测试 33/33；实际 rc.3 Host 10 项交互检查及两进程生命周期/旧提醒/长期任务恢复通过。模型、Sender/API 为合成替身；不等同于真实 QQ 手机收件。已部署 Character test.18 / Interaction test.4，配套两份 QQTK 补丁；13 个 Preset 健康、单 QQ Gateway，8 秒策略与脱敏诊断已启用。Preset Manager / Inspector 保持 test.3，Inspector 仍只读。保留一致性备份和旧 Profile；本轮因非交互安装确认曾中止并自动恢复旧版，补齐参数后重试成功，未覆盖用户数据。真实手机效果仍待复现。

## 上一轮管理界面更新（Inspector / Manager test.3）

当时部署：DSH rc.3、Character Core test.17、独立 Preset Manager test.3、Memory Inspector test.3。只更新两个管理包，沿用 Profile、角色/模型、Memory、Session、QQ 与 Schedule；未改官方文件和 Worker 权限，没有 Schema 迁移。13 个 Preset 健康、QQ 单连接，Inspector 继续 writable:false；已保留一致性备份和旧 Profile。

本轮现场复现的是「无有效活动上下文」，并非已证实的 React 白屏或数据库为空。Host 重启后当前可信身份必须重新建立，旧 Session 不自动授予记忆权限。UI 增加加载、请求错误/重试、无上下文引导、分层零记录与局部渲染恢复；授权刷新失败不会继续展示旧记录。没有读取真实记忆正文。

验证：Character 单元及安全审计共 182/182；Manager 112 通过、1 项原有平台跳过。实际 rc.3 验证 Core+Extras、只读重载/撤销、Compaction、十个 Worker/Manager 配置及冷恢复、历史提醒和长期任务重启恢复。Web GUI 在合成数据中已点击验收；新 UI 的 Desktop 点击写操作、视觉 HMR及真实手机收件仍未验证。原生 Desktop relay 的认证/Origin 拒绝通过，不将它等同于桌面视觉验收。测试和详细维护证据仅存本地忽略目录。


## DSH 0.2.1-rc.3 适配

官方更新改为用户安装目录，数据继续沿用原目录。关键 Preset/Subagent/Tools/Config SDK 与 Creator 定义逐文件比对未变；Client registry 的变化为发行提交标识。修复验证/维护脚本误指向旧二进制和含空格路径的引用，保留旧版测试能力；没有修改官方 DSH 或更换插件运行包。

rc.3 隔离验证：Character 178/178、Preset Manager 107 通过 + 1 项原有平台跳过、QQTK 28 轻量 + 30 SDK 边界通过。十个 Worker/Manager 配置及两进程恢复、Core+Extras、Memory/Compaction、Interaction、Session 轮换与长期任务/提醒恢复均通过，模型和 Sender 为合成替身。Desktop 已只读验证设置入口与 Worker 列表，未验证桌面写操作/HMR 或真实手机收件。

当前 rc.3 实例健康、QQ 单连接、13 个 Preset 无装配失败；自有维护入口已选择新安装目录，数据/Profile/模型偏好保持。切换保留一致性快照，实际维护失败恢复后校验用户数据不变。没有发送真实 QQ 测试消息。详细路径、备份及临时日志仅留本机。

## test.17 原生 Worker 权限基础

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
