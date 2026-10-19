# test.10 Interaction / QQTK 潜在 Bug 审计

结论：**NO-GO，不满足下一版发布条件。** 本轮仅新增隔离测试、审计报告和入口说明，没有修复运行代码、打包发布、推送或部署。未发现已证实的 P0；下面的 P1 足以阻断发布。没有声称不存在其他缺陷。

## 基线、范围与证据等级

- Character Git 基线 `f2aae367962a2539895d9bfdb7925d438072f12a`，QQTK `56d1a1687ee70777e9b67085b4bf95144706f7e9`；本次只读查询 GitHub main，两者与本地 HEAD 一致。
- 从已安装 ASAR 读取实际 DSH `0.2.1-rc.2`；QQ Bot `0.5.2`，实际传递依赖 `qqbot-nodejs 1.0.5`，Node `24.21.0`。没有用上游主分支替换运行基线。
- 四个 Character 插件已安装版本为 `0.1.0-test.10`，Interaction 独立版本 `0.1.0-test.1`；所有自有 `.mjs` 与本地源码哈希一致。QQ 补丁维护的 10 个文件也与已安装代码一致。不同包采用独立版本不是缺陷。
- 只读取安装目录中的代码和包元数据。没有读取生产 Profile 配置、凭据、会话、日志或记忆库；没有创建 QQBot、调用生产 QQ 或更改官方文件。网络操作仅为 GitHub 分支只读核对。
- 真实宿主运行在新建 DSH_HOME，Provider、工具输入与 Sender 均为合成替身。SDK 网络故障通过内存替代 HTTP 层注入；不是 QQ 服务端验收。
- **已复现**：执行实际自有实现或安装版本 SDK，在隔离输入下违反断言。**静态高可信**：代码路径明确，但完整运行条件未重现。**待验证**：需要原生事件异常顺序、实际 HMR 或 QQ 服务端条件。**设计限制**：已知能力边界，不当成新 Bug。

路径记法：`C/` 为 Character 仓库根，`Q/` 为 QQTK 仓库根；本机分别位于 `D:/DeepSeek-Harness/source-repository/character-agent-v1` 与 `D:/DeepSeek-Harness/source-repository/harness-qq-toolkit`。`SDK/` 为已安装 `data/profiles/desktop/node_modules/@tencent-connect/qqbot-nodejs/dist`；`QQ/` 为同层 `@tencent-connect/dsh-qqbot/dist`。测试只导入它们的隔离代码副本。下列行号对应上述 Git/安装基线。

## P1：优先修复

### F01 失败尝试被完成为正式气泡——已复现，含真实 DSH Loop

- 位置：`C/packages/interaction-policy/policy.mjs:98`，尤其 102、108 行。
- 触发：流产生文字后，以 `assistant/attempt` 提交失败记录，或以 `abandoned` 结束；新 attempt 开始也会先 `finish()` 旧草稿。
- 影响：用户收到失败、未提交为 assistant/message 的答案；重试成功又收到另一份答案。普通静态发送也受影响，并非 Streaming 天生可见草稿的不可避免限制。
- 复现：A01、A02 失败；新增真实宿主探针实际执行 2 次 Provider，原生记录含 `assistant/attempt` 和 `assistant/message`，输出数组却同时含“失败尝试的未提交草稿”和“最终成功的结果”。报告 `nativeRetryVerified=true, ok=false`，runId `742b333f-0893-4103-80c9-c83d59c39487`。
- 最小修复：按 attempt 的 committed/abandoned 和 eventType 分流；失败时丢弃未发部分，已展示部分只作可识别的失败收尾，不把它当成功正文。最终内容按匹配的持久事件确认；不能通过删掉失败断言来解决。
- 影响面：重试、网络异常、最终消息去重、取消收尾。

### F02 静态和流式正文绕过 QQ 长度限制——已复现

- 位置：`Q/maintenance/qqbot-src/dist/gateway/bootstrap.js:49-53`；`C/packages/interaction-policy/policy.mjs:70-81`。原路径 `QQ/transport/outbound.js:121` 使用 chunker，新路径提前 return。
- 触发：4501、5001、10001 字符完整消息，`textChunkLimit=4500`；闲聊长度阈值不会分割复杂长回答。
- 影响：整个正文直接交给 `sendMarkdown` 或单个 Stream；SDK `MessageApi`/`StreamSession` 均没有这里需要的分段。模拟 5000 上限时，5001/10001 请求被拒，结果没有可靠补送；不能说它只是少了自然气泡。
- 复现：Q01 六个用例均失败，实际 SDK 请求体长度仍为输入全长；Q08 的静态/流式 4500 字符控制通过。没有连接 QQ，**未证明服务端精确上限或实际手机丢字**；已证明配置上限被绕过及拒绝后的损失路径。
- 最小修复：平台适配负责硬长度拆分和有序交付，语义拆分与协议拆分分开；对 Markdown/代码围栏保真，多 Stream 必须同时纳入 F07 的额度和顺序管理。
- 影响面：全部长 Assistant 结果、代码、长列表及流式降级。

### F03 首次流更新失败后，最终尾巴永久丢失——已复现

- 位置：`C/packages/interaction-policy/policy.mjs:64-81`。
- 触发：第一次 `update(prefix)` 抛错，后续继续生成 committed 完整正文。`m.failed` 阻止后续 update；已有 stream 导致不会静态 fallback。
- 影响：SDK `complete()` 只持有旧 prefix，可能只补送前缀，最终结果无人交付；策略把错误收进数组，没有可供 Host 检查的交付结论。
- 复现：A14、真实 SDK 替代 HTTP 的 Q07 均失败。测试模拟“明确拒绝”，不以可能已投递的超时作为任意重发理由。
- 最小修复：区分明确拒绝、成功、未知；保存最后确认状态和 committed 全文，对可安全重试情况发最新内容，未知情况返回明确交付状态并等待恢复决策，不能静默成功。
- 影响面：失败重试、降级、防重复、完成通知。

### F04 stop 会把 SDK 尚未发送的尾巴补发，重试也可越过取消——已复现

- 位置：`C/packages/interaction-policy/policy.mjs:94-96`；`SDK/streaming.js:91-109,178-194`。
- 触发：SDK update 已返回但节流缓冲尚未发出；或 SDK 正在 429 重试等待。`invalidate()` 调用 complete 而非取消缓冲/重试。
- 影响：明确停止后仍生成新的 DONE 正文或重试请求。SDK 的 `cancel()` 本身也没有中断 `sendWithRetry()` 的等待/循环，所以仅替换一个方法名不足以修好。
- 复现：A12、Q05 证明停后新 DONE 包含原来未发的“尾巴”；Q06 真实 SDK 在取消后继续重试/完成。A17 控制证明**尚未进入执行的策略队列项**确实能被丢弃，问题在另一个状态层。
- 最小修复：输出 generation/abort 信号贯穿策略、适配器及 SDK 重试；取消待发缓冲，若必须收尾仅使用最后确认已发送文本。已经到达服务端的在途请求不可保证撤回，应明确边界。
- 影响面：`/stop`、明确更正、插件卸载、关闭与重连。

### F05 工具阶段更正和停止后的 external 通道仍输出旧内容——已复现

- 位置：`C/packages/interaction-policy/policy.mjs:94-96,130-138`；`Q/maintenance/qqbot-src/dist/gateway/bootstrap.js:38-41`。
- 触发：工具已出现后执行 `revise()`；或 stop 后旧工具结果走 `external()`。前者只 steer 不失效旧展示队列；后者因 invalidate 立即换成未取消 token 而可重新入队，且没有 active/turn 检查。
- 影响：保留工具副作用是正确的，但尚未发出的过时回答仍会出现。停止后迟到工具错误/结果也可重新输出。
- 复现：A08 保证仅调用 steer、没有 cancel，但旧结果仍发；A09 stop 后 external 仍发送。
- 最小修复：把工具执行生命期与输出 generation 分开；steer 保留工具，却撤销旧答案的未发部分；external 必须携带所属 turn/generation，系统通知使用单独明确通道。
- 影响面：工具结果展示、维护通知、修正后跟进；不能把所有通知一并禁掉。

### F06 同 Agent 的 Web/后台轮次可沿用 QQ Sender；Hang-on 无可信入口门禁——已复现路由条件

- 位置：`Q/maintenance/qqbot-src/dist/gateway/bootstrap.js:44-53`；`C/packages/interaction-policy/policy.mjs:32-40`。
- 触发：QQ 已映射该 Session；其后由 Web、Schedule 或后台 followup 启动同一 Agent。路由只查 Session，不查本轮真实入口，transport 也跨轮保留。
- 影响：非 QQ 对话的结果或等待提示进入 QQ；Schedule 即使有明确通知账本，也可能多出通用等待/普通回答。是同一受信 Owner 的渠道混用，**本次没有证明跨 Owner ACL 绕过**。
- 复现：A11、实际桥接代码 Q09 失败；底层通道没有可信 turn origin 字段。测试不声称已从真实 Web 浏览器发起此操作。
- 最小修复：Host 为输入绑定 turn origin、delivery intent、reply target lease；QQTK 只登记 QQ 入口，Agent 插件按来源选择输出；Schedule 的显式通知保留独立账本语义。
- 影响面：Web/QQ 共用 Session、Schedule、后台任务、跨平台扩展。

### F07 Stream 不计入被动回复额度，过期 ID 还能重新变成允许——已复现

- 位置：`Q/maintenance/qqbot-src/dist/gateway/bootstrap.js:101-110`；`QQ/transport/reply-limiter.js:13-27`；`QQ/transport/reply-target.js:23-38`。
- 触发：多个气泡或工具步骤共用 msgId；ReplyLimiter 只包住 sendMarkdown，没有包 openStream。已跟踪 ID 过期后被删除，下一次检查被当作从未见过；显式 ID 与缓存 ID 相同可在同一次 resolve 中触发。
- 影响：六个 Stream 全部用被动目标，额度仍未消耗；过期降级被绕过。静态 ReplyLimiter 的复活问题继承自上游，并非 Interaction 新增。
- 复现：Q02、Q03、Q04 失败。SDK 每个 Stream 使用一个随机 msg_seq，**没有证实所有 Stream 都固定同一 msg_seq**，不把此疑点写成 Bug。
- 最小修复：静态、Stream 和其他占用回复额度的发送共用有接收时间的目标租约；一次新 Stream 消耗一个额度，update 不重复消耗；候选去重，过期墓碑不能删除后再许可。降级为主动消息仍受平台配额约束，不能保证一定送达。
- 期限边界：本机缓存是群聊 5 分钟、私聊 30 分钟；ReplyLimiter 默认却按首次发送起算 1 小时。显式 replyTarget 无接收时间且可优先于缓存。**“私聊超过五分钟必定失效”未验证**；应依据当前平台规则并处理实际失效错误，不照抄假设。
- 影响面：气泡、长任务、审批、媒体、主动通知的额度协调。

### F08 HTTP 超时不覆盖正文，可能永久堵住输出和卸载——已复现 SDK 缺陷

- 位置：`SDK/protocol/api/api-client.js:60-79`；`C/packages/interaction-policy/policy.mjs:28-29,140`。
- 触发：HTTP 响应头到达，正文一直未结束。SDK 在 fetch 返回后清除 timeout，随后 await res.text 没有期限；Interaction 也无限 await chain。
- 影响：后续输出、dispose/HMR 被同一队列阻塞。网络恢复不是显式恢复机制，也不会自动替换旧 Sender。
- 复现：Q10 使用实际 ApiClient、模拟带 AbortSignal 的慢正文，10ms 超时配置下 50ms 后仍 hung，只有手工释放合成正文才退出；A13 的通用永不完成 Sender 同样无法关闭。50/60ms 是缩短的测试窗口，不是建议生产超时值。
- 最小修复：期限覆盖取 Token、响应头、响应正文及重试全流程；外层增加可取消的 drain 和隔离晚完成结果的 generation。不能只 Promise.race 后让旧发送继续影响新轮次。
- 影响面：网络阻塞、服务停止、HMR、单 Gateway 租约释放。

### F09 merge 的 survivor 下游未结束时，下一条已并发进入——已复现上游 SDK 缺陷

- 位置：`SDK/middleware/concurrency-guard.js:119-125,171-175,251-283`；QQTK 启用点 `Q/maintenance/qqbot-src/dist/gateway/middleware-setup.js:90`。
- 触发：A 正在处理，B 排队；A 结束后释放 B 的 waiter，却不等待 B 的下游完成，随即清掉 busy。此时 C 到来。
- 影响：同 peer 下游并发，Session 的 replyTarget、入站证据和回答先后可能互相覆盖；DSH Agent 自己仍串行运行，**不能因此直接声称工具 Loop 已并发执行**。
- 复现：Q12 调用实际 concurrencyGuard，A/B/C 有明确 gate，测得下游 active 峰值 2，期望 1。
- 最小修复：批次 survivor 必须继续持有 peer 锁，并在其真正完成后释放；超时、队列清空、stop 和后续批次都走统一 finalizer。放在自有适配或 SDK 版本补丁，不能手改官方发行目录。
- 影响面：普通消息合并、修正、取消、回复归属、消息来源引用。

### F10 遗忘后 inspect/trace 仍暴露 source.quote——已复现真实临时 SQLite

- 位置：`C/packages/character-memory-core/store.mjs:94-100,114`；`C/packages/character-memory-core/layered.mjs:56,130,154-155`；工具出口 `C/packages/character-memory-tools/index.mjs:20`。
- 触发：保存带 quote 的记忆后 forget，再按已知 ID 调用 get/inspect/trace。自动提取确实会保存 quote，见 `extraction.mjs:23`。
- 影响：statement/L1 body 清空、Recall/L3 不再出现该事实，但模型可通过正常工具读出 source 中旧原文。这是公开读取接口的遗忘语义缺陷，不是“备份仍保留”的已知限制，也不是跨主体 ACL 漏洞。
- 复现：M01 创建全新合成库；Recall 和 projection 控制通过，但公开响应仍包含完整虚构 quote。
- 最小修复：对 forgotten/retired/merged 等状态统一净化公开 DTO 中的 quote/text/quotes；关联被退役证据的有效状态也需检查。保留不可逆摘要和必要来源 ID 用于防复活，私有修订存储是否物理清理另行明确策略。
- 影响面：inspect、trace、记忆纠错/遗忘及旧记录兼容；不应削弱 tombstone。

### F11 活跃 Agent 重挂策略时可能吞结果，并可阻断 native stop——隔离生命周期复现，实际 HMR 待验证

- 位置：`C/packages/interaction-policy/index.mjs:9-21`；`policy.mjs:22-26,98-100,119`；`Q/maintenance/qqbot-src/dist/gateway/middleware-setup.js:56-62`。
- 触发：新 controller 接到已运行 Agent 的帧，但没有经历 turn/start，active=false；桥接却仍拦截完整消息。或 service 存在而 get(agent) 尚不可用，/stop 在调用 nativeStop 前抛错。
- 影响：本轮剩余回答被丢弃；最需要停止时命令失效。另一个 manager 重绑定现存 policy 会触发 Only one output owner，没有可撤销旧 lease 的 API。
- 复现：A15 模拟新插件接入既有运行 Agent，完整答案没有发送；Q14 注入真实 get 失败条件后 nativeStop 未执行。没有在真实 HMR 中切换正在运行的生产 Agent，实际触发频率未知。
- 最小修复：明确重挂恢复/等待下一轮的协议；仅在输出 ownership 成功且 controller 可处理时截获消息；策略失败也必须执行 nativeStop。提供有 token 的释放/重绑定接口，拒绝未撤销的第二个 Sender。
- 影响面：HMR、停用、Gateway 重建、Preset 恢复。不能通过宽松 get 绕开 scoped Agent 校验。

### F12 Identity detach 没卸载 bot 中间件——隔离 attach/detach 复现

- 位置：`C/packages/character-identity/index.mjs:60-76`；`SDK/QQBot.js:190-201`。
- 触发：保留同一个 bot，对 runtime detach 后以新 runtime object 重新 attach。旧 bot.use 闭包仍在，命中 runtime!==旧 value 后抛 Gateway detached。
- 影响：后续合法 Owner 入站被旧中间件阻断。重建整个 bot 的普通重启路径未证明存在同样问题。
- 复现：I01 使用实际 Identity 和合成 binding/SQLite，重新 attach 后合法消息不能到达下游。SDK use 返回 bot 本身，不返回撤销函数；本地 detach 只恢复 manager 方法。
- 最小修复：安装一个可更新委托的 ingress 中间件，detach 撤销能力并解除委托；或只支持销毁 bot 后重挂并在生命周期中强制执行。旧入口不得继续发放身份 capability。
- 影响面：插件热重载、QQ Adapter 重挂、可信入站生命周期。

## P2：功能、性能与工程质量

| ID / 分类 | 具体位置 | 触发、复现与影响 | 最小修复及影响面 |
|---|---|---|---|
| F13 分段，已复现 | `C/packages/interaction-policy/policy.mjs:12-15,50-54` | A04 首句“好。”使 regex 首次匹配 index<3，后面完整句也不再找；A05 同文整块和逐字在 chatMaxChars 边界产生不同气泡；A06 会拆开中文引号；A07 后续才出现 Markdown 时，与整块输入行为不同 | 定义可测试的增量解析状态，追踪引号/代码/链接/列表，遍历候选边界；选择并记录流式前瞻策略。完整格式控制 A18 通过，不代表所有分片都安全 |
| F14 慢网络更新积压，已复现 | `C/packages/interaction-policy/policy.mjs:28,58-67` | A19 第一次 update 阻塞期间排入100个累计快照，释放后执行101次 update；没有 latest-only 合并或队列上限，长输出放大延迟与保留内存 | 同一未完成气泡保留一个最新待发送快照，生命周期命令保持 FIFO；不能跨气泡/attempt 合并 |
| F15 通用 QQ 更正不刷新 msgId，已复现 | `Q/maintenance/qqbot-src/dist/gateway/middleware-setup.js:77-87`；缓存入口 `bootstrap.js:79-83` | Q13 无 Character admission hook 时，收到 new msgId 的更正后 record.replyTarget 仍是 old；该分支也绕过普通 cacheMsgId。Character hook 调 getOrCreate 会缓解当前实例，但通用插件仍有缺陷 | 在可信 QQ 适配入口统一更新发送租约及缓存，不依赖 Character 身份插件；再调用策略修正 |
| F16 SDK 频控异常识别字段错误，已复现 | `SDK/streaming.js:196-203`；`SDK/protocol/types.js:17-36` | Q11 真实 ApiError 的 httpStatus=429、bizCode=50002 无英文 rate limit 时，isRateLimitError 返回 false；它读的是 code/err_code | 使用 SDK 实际结构字段和有限重试；配合 F04 取消。不要把所有错误都重试，未知提交仍需隔离 |
| F17 大库同步扫描，已测量 | `C/packages/character-memory-core/layered.mjs:55-71,138-151,217-240` | get/inspect 经默认 #conflicts 扫完整 scope；recall 查询后又全库构建冲突；每候选执行额外 SQL；projection 每次重新枚举，即使最终写入因指纹一致而跳过。10,000条合成记忆：inspect 661–678ms，recall 853–893ms，context 411–478ms，阻塞同一 Node 事件循环 | 按 claim_key 查相关冲突、批量取有效性、使用 scope revision 缓存投影；保持授权和过期/遗忘校验。数值只代表本机合成样本，不是生产 SLA |
| F18 兼容声明缺失，静态高可信 | `C/packages/interaction-policy/package.json:7`；`C/scripts/build.cjs:33-34`；其他四包 package.json:11 | 没有 engines.dsh，也无相关 DSH peer 约束。实际宿主 `dsh-app-boot/lib/index.js:279-287` 对无两者的包返回无不兼容项；使用0.2.1原生帧的插件可被放入不匹配宿主而不提前阻止 | 声明已验证宿主范围；生成器同步保留，避免下次 build 擦掉。Node版本约束不替代DSH兼容约束 |
| F19 候选发布闭包不完整，静态高可信 | `C/scripts/prepare-host-upgrade.cjs:23-28,45-56`；`scripts/pack.cjs:3-6`；`scripts/deploy-guard.cjs:5`；`scripts/rollback.cjs:9-19` | pack 包含 Interaction/Remote Ops，prepare 自动刷新却只处理六个 character 包，另两包沿用旧 manifest路径；旧流程还依赖固定历史报告路径。回滚恢复 Profile/路由/策略/Memory，不恢复所有维护源文件、Identity绑定/通知状态或DSH本体。当前已安装代码比对一致，**未证明当前运行版本错装** | 用统一不可变发布 manifest列出全部源码/包/补丁/锁/维护文件/Schema，先完整校验再切换；回滚显式区分应恢复配置和应保留通知账本，避免通知重放。发布脚本只能在新隔离目录演练，不能以本次代码审计宣称完整恢复通过 |

## 待验证假设和设计限制

1. **迟到 turn/end /乱序 chunk /不一致 canonical settlement**：A03/A10/A16 的强故障注入均失败，位置 `policy.mjs:84-91,98-108,112-127`。新 turn 不校验旧 end 的 turn ID；高 revision 先到会丢掉低 revision；最终全文与草稿不一致只记错不修正。本机 SDK 使用进程内递增 revision，持久事件按 turn 平衡，尚未证明正常 native 通道会乱序或发送不同正文。因此列作防御缺口/待验证，不冒充三项已发生的生产 Bug。建议用 turn/attempt/settlement seq 关联，最终一致性失败应可观测。
2. **maxBubbles 不是整轮所有消息总上限**：仅限制主动语义切分次数，工具步骤和完整消息仍会产生新气泡；chatMaxChars 不是输出字数上限。这个语义本身是设计限制，F07 必须保证即使气泡变多也不越过平台预算。
3. **Hang-on 不入历史**：源码只调用 Sender，没有 Session append；实际原生宿主检查通过。审批/问答 pending 时的抑制、已有自然 delta 后的抑制也通过。收到 delta 就视为 natural，因此实际发送失败时不会再发等待提示；和 F03 交付状态一起改进。审批等待超过首次 timer 后不会补发，属于当前一次性提示策略。
4. **记忆质量边界**：L1 是可信输入/Host工具返回记录，Compaction 做遗漏检查，不把压缩摘要当新事实；逐字 quote 只证明引用存在，不能数学证明归纳正确。Self Model 只记录“工具正常/错误返回”，不证明任务完成。此次没发现 Interaction 把 Host状态写入L1的代码路径。真实多轮LLM质量未运行。
5. **通知可靠性**：既有测试验证稳定eventId去重、pending恢复、sending/unknown隔离。网络结果未知不自动重发是保护性设计，不能等同于 exactly-once 手机投递；Schedule真实时钟投递、手机按钮和断网重连没有本次证据。
6. **身份/权限**：现有可信Host capability、伪造handle拒绝、Owner白名单、群聊关闭、Memory多scope隔离回归通过；没有发现模型通过权限字段提权的确定性路径。保存的Session若由其他受信入口操纵仍属于Host授权边界，需和F06的渠道归属分开讨论。
7. **Gateway单例**：同进程Symbol租约和Character adapter租约仍存在，Core/Extras构建没有增加第二套Gateway；跨进程/跨机器单活不能靠这个锁保证。没有在本轮启动任何真实Gateway来测断线重连。

## 测试结果与覆盖缺口

| 验证 | 本轮结果 | 证明范围 |
|---|---|---|
| 既有 Character 单元回归 | 89/89 PASS | Memory ACL/CAS/模式/遗忘屏障、Compaction验证器、Identity、通知、旧Interaction用例 |
| 既有 QQTK 轻量回归 | 13/13 PASS | Remote Ops、桥接、旧任务记忆；不含全部SDK行为 |
| 实际SDK审批/问答/边界回归 | 10/10 PASS | nonce、Owner、拒绝/取消、晚失败、文件junction逃逸；所有发送器为替身 |
| 原生 DSH 基础宿主 | 8/8 PASS | Creator工具同构、两个Preset隔离、原生帧、cancel/steer、状态不入Session；runId `3be8b990-f31c-4f2e-96fa-6f5791994019` |
| 新增 Character 发布门禁 | 21项：2 PASS / 19 FAIL | `tests/audit/*.test.mjs`；含故障注入，不把每个断言计作独立Bug |
| 新增 QQ/SDK 发布门禁 | 19项：1 PASS / 18 FAIL | `maintenance/audit/interaction-sdk.test.mjs`；真实SDK+替代网络，无QQ连接 |
| 新增真实宿主重试门禁 | FAIL，原生retry本身成功 | 失败草稿和最终答案双交付；不是启动错误或过期报告 |
| 合成Memory容量测试 | 完成100/1000/10000条测量 | 临时SQLite；不含模型、真实用户数据或生产负载 |
| 隔离构建on/off | 2/2 PASS | Creator插件保留、Extras字节不变、无私人角色配置 |
| QQ补丁 | --check PASS；全新fixture git apply后10/10字节匹配 | 不是只比较文档版本号 |
| 生产锁文件/数据/配置、真实QQ、实际HMR/回滚/断网恢复 | 未验证 / BLOCKED（本轮禁止） | 没有绕过边界去补证据 |

合计新增纯离线门禁40项，3通过、37失败；**不是37个独立已确认Bug**，其中包含同一问题的多长度/模式变体及待验证事件假设。未使用 skip/todo/expected-failure 消除失败，也未降低旧断言。`npm test` 保留原基线范围，`npm run test:audit` 是单独且当前返回非零的新增门禁；发布不能只跑前者。

原生宿主首次在受限沙箱中因ASAR realpath EPERM未启动，没有计作通过；在允许只读加载官方代码、仍使用全新隔离Profile后才得到上述结果。测试进程均由专用runner退出并恢复调用环境，没有停止生产宿主。

现有测试盲区：短中文分片用例只比较拼接全文和气泡数，没有比较语义切点；失败流测试只断言“不静态重复”，没断言最终全文交付；cancel测试只测策略队列，没测SDK内部缓冲/重试；工具steer测试没检查旧输出；原有forget测试没检查source字段；慢网络测试没覆盖响应正文卡住和merge survivor锁。

## 复跑与修复顺序

```powershell
# Character：Node 24+；全合成输入，无需生产配置
npm test
npm run test:audit
node tests/audit/memory-scale.mjs
# 实际 DSH 安装根仅用于代码/SDK读取；该runner创建新DSH_HOME
$env:DSH_INSTALL_ROOT = '<absolute DSH installation>'
./tests/audit/run-host.ps1
```

QQ SDK门禁的显式代码fixture方法见 QQTK `docs/AUDIT-INTERACTION-test10.md`。不得把QQBOT测试路径指向生产Profile运行其他探针；本报告只授权/记录这里的离线方式。

最小修改顺序：

1. 修复F10公开遗忘读取，以及F01/F03提交与交付状态，先防止错误内容进入用户视野。
2. 实现输出generation与可信入口租约，处理F04/F05/F06/F11/F12；保留工具执行，不将展示取消等同于撤销副作用。
3. 修复平台硬分块、统一msgId预算/期限、SDK重试/响应正文超时（F02/F07/F08/F16），通过自有适配或版本化依赖补丁完成。
4. 修复merge串行锁及通用更正目标（F09/F15），验证普通消息、stop、修正和新一轮的交错。
5. 完成分段规则、积压合并和记忆查询优化（F13/F14/F17），不降低格式、来源或ACL断言。
6. 补兼容声明及统一发布闭包（F18/F19）；在隔离环境重跑新旧测试，独立演练升级/重启/回滚。真实QQ异常网络及手机验收须另获授权。

下一版放行至少要求：已确认P1门禁通过；强故障注入中尚未验证的协议假设有明确处理契约；普通Agent和完整Character的隔离宿主回归通过；包/补丁/锁/Schema与测试证据同版；恢复演练可复核。当前不满足。
