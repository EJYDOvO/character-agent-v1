# DSH Interaction Policy V1

独立、无第三方运行依赖的 Agent/Preset 插件。要求 DSH 原生 scoped events、`systemPrompt`、`llm` 和 `agentPresets.serviceFor`；动态等待提示的 Persona 读取在 0.2.1-rc.3 验证。不创建 Agent、Session、Agent Loop、数据库或 Planner，不依赖 Character、QQ、Memory 或 Remote Ops。

安装本包后，将下面的条目追加到目标 Preset 的 `plugins`。必须保留 `isolate`；不要用只有这一项的数组覆盖完整 Creator 工具配置。

```yaml
- id: interaction-policy
  name: dsh-interaction-policy
  isolate:
    interactionPolicy: true
  config:
    enabled: true
    hangOnMs: 8000
    hangOnDraftMs: 5500
    hangOnText: '嗯，还在处理中，稍等一下。'
    # 可选：只为等待提示单独选模型，见下文
    hangOnModelFile: '<absolute-path>/hangon-model.json'
    throttleMs: 180
    maxBubbles: 3
    chatMaxChars: 240
    bubbleTargetChars: 300
```

这是插件条目，不是 Host 根插件，也不是自动启用的 Bundle。`enabled: false` 时不注册服务和提示词。既有 Session 可能保留旧 Preset revision；按 DSH 原生机制切换/重载，在空闲时创建新 Session 验证关闭，不强制取消运行中的工具。

Host 适配器通过 `ctx.agentPresets.serviceFor(agent, 'interactionPolicy')` 获取该 Agent 的实例服务，再调用 `get(agent)`。禁止把模型提供的 Session ID 转成任意 Agent；查找只接受已由原生 scoped 事件登记的真实对象。

`policy.bind({key, sendText(text, metadata), openStream?, waitingForUser?, deliveryReceipts?, trace?})` 绑定唯一输出所有者。`openStream(metadata)` 返回支持 `update(累计文本)`、`complete()` 和可选 `cancel()` 的对象。平台可用真实回执时设置 `deliveryReceipts:true`，仅在接口确认发送成功后调用 `metadata.onDelivered()`；SDK 更新进入缓冲不算送达。无回执能力的旧适配器仍以成功的 update/sendText 为兼容信号。QQ 回执不证明手机收件。`metadata.kind` 区分 assistant/status/tool-or-error；`status` 带 `transient:true`，不得追加到 Session。平台不可用 Streaming 时省略 `openStream`。

默认 8 秒仍无本轮自然回复发送确认时，向同一发送队列加入一次 Hang on；实际发送前再次检查回执、运行状态和审批/问答等待。慢网络正在发送的正文不会被状态提示越过。约 5.5 秒时插件会并发调用一次原生 `ctx.llm`，按当前 Persona 生成一句等待提示；8 秒时候选已就绪且合格才使用，否则发送 `hangOnText`。该请求不带 `sessionId`，不进入 Session 历史或 Memory。`hangOnModelFile` 指向的 JSON 只能包含 `provider` 和 `model`，存在时只改等待提示的模型，缺失时继承当前 Agent。只有 `kind:'assistant'` 气泡的 `onDelivered` 确认自然回复；`status` 的回执不算。短闲聊可按句拆；超过 `chatMaxChars` 的结果按自然段和安全句界向 `bubbleTargetChars` 靠拢，调用工具不阻止拆分。字符数为软目标，Markdown 块保持完整；`maxBubbles` 由进度、状态和结果共享，最后一泡保留全部余文。协议硬分片由平台另行负责。长回复在流式期间按与 settlement 相同的规则逐泡定稿（保留一泡给开放尾部），闲聊长度内的回复仍在原生 settlement 后统一切分；已定稿气泡不改写、不重发。

输出适配器收到 `session/event` 时可调用 `policy.event(event)`，同一事件对象会去重。插件自身消费原生事件和 `agent/assistant-stream`；适配器接管 assistant 输出后须阻止原通道重复发送。不要同时保留两套出站处理器输出同一回复。

`bind` 设置 `requireIngress: true` 时，可信平台入口必须先用 `admitInput(nativeUserMessage)` 登记输入。DSH 的 `runtime-context`、`skill-catalog`、`time-context`、`agent-instructions` 是上下文投影，不切换输入来源、不消耗登记，也不恢复后台或已取消的输出。适配器必须采用相同分类；这些来源本身不提供身份或 QQ 投递权限。

每条已登记输入开启独立回复上下文：`metadata` 带 `input`（原生 UserMessage ID）、`reply` 与该回复内的 `bubble` 序号，`maxBubbles` 按回复计算。平台按 `input` 自行选择回复目标，Interaction 不保存平台路由或额度。已登记回复中产生的子 Session 完成时（原生 `subagent-settled` 且 `senderSessionId` 已在 `subagent/catalog` 中登记），通知作为该回复的续轮输出；其他非用户来源保持后台。适配器在抑制非用户来源前可调用 `policy.admitsSource(message)`。

Agent 运行期间到达的可信输入调用 `policy.intervene(message)`：插件用原生 `llm`（不带 Session 归属）把它判断为 revise/priority/supplement/append，并只用原生 cancel/steer/followup 执行；判断期间暂停未发送输出，2.5 秒超时或失败按 append（followup）处理，工具与审批从不被 cancel。返回 `queued`/`steered`/`restarted`，或判断中的 `judging`。

明确用户修正由可信入口构建原生 UserMessage 后调用 `policy.revise(message)`（等同 `intervene(message,{explicit:"revise"})`，不经判断）。该方法不是模型工具：纯生成阶段调用原生 cancel（保留 Inbox）并 followup；已请求工具或阶段不确定时只 steer。`stopOutput()` 仅抑制未发送的显示内容，平台仍须调用原生 `/stop` 或 cancel。它不能回滚工具副作用。

完整边界、配置、测试和 Character/QQ 接入见 [Interaction 文档](../../docs/INTERACTION-POLICY.md)。
