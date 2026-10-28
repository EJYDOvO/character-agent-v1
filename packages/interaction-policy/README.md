# DSH Interaction Policy V1

独立、无运行依赖的 Agent/Preset 插件。要求 DSH 0.2.1-rc.2 原生 scoped events、`systemPrompt.context` 和 `agentPresets.serviceFor`。不创建 Agent Loop、数据库或 Planner，不依赖 Character、QQ、Memory 或 Remote Ops。

安装本包后，将下面的条目追加到目标 Preset 的 `plugins`。必须保留 `isolate`；不要用只有这一项的数组覆盖完整 Creator 工具配置。

```yaml
- id: interaction-policy
  name: dsh-interaction-policy
  isolate:
    interactionPolicy: true
  config:
    enabled: true
    hangOnMs: 8000
    hangOnText: '嗯，还在处理中，稍等一下。'
    throttleMs: 180
    maxBubbles: 3
    chatMaxChars: 240
    bubbleTargetChars: 300
```

这是插件条目，不是 Host 根插件，也不是自动启用的 Bundle。`enabled: false` 时不注册服务和提示词。既有 Session 可能保留旧 Preset revision；按 DSH 原生机制切换/重载，在空闲时创建新 Session 验证关闭，不强制取消运行中的工具。

Host 适配器通过 `ctx.agentPresets.serviceFor(agent, 'interactionPolicy')` 获取该 Agent 的实例服务，再调用 `get(agent)`。禁止把模型提供的 Session ID 转成任意 Agent；查找只接受已由原生 scoped 事件登记的真实对象。

`policy.bind({key, sendText(text, metadata), openStream?, waitingForUser?, deliveryReceipts?, trace?})` 绑定唯一输出所有者。`openStream(metadata)` 返回支持 `update(累计文本)`、`complete()` 和可选 `cancel()` 的对象。平台可用真实回执时设置 `deliveryReceipts:true`，仅在接口确认发送成功后调用 `metadata.onDelivered()`；SDK 更新进入缓冲不算送达。无回执能力的旧适配器仍以成功的 update/sendText 为兼容信号。QQ 回执不证明手机收件。`metadata.kind` 区分 assistant/status/tool-or-error；`status` 带 `transient:true`，不得追加到 Session。平台不可用 Streaming 时省略 `openStream`。

默认 8 秒仍无本轮自然回复发送确认时，向同一发送队列加入一次 Hang on；实际发送前再次检查回执、运行状态和审批/问答等待。慢网络正在发送的正文不会被状态提示越过。短闲聊可按句拆；超过 `chatMaxChars` 的结果按自然段和安全句界向 `bubbleTargetChars` 靠拢，调用工具不阻止拆分。字符数为软目标，Markdown 块保持完整；`maxBubbles` 由进度、状态和结果共享，最后一泡保留全部余文。协议硬分片由平台另行负责。流式阶段只展示首个候选片段，其余在原生 settlement 后按顺序发送。

输出适配器收到 `session/event` 时可调用 `policy.event(event)`，同一事件对象会去重。插件自身消费原生事件和 `agent/assistant-stream`；适配器接管 assistant 输出后须阻止原通道重复发送。不要同时保留两套出站处理器输出同一回复。

`bind` 设置 `requireIngress: true` 时，可信平台入口必须先用 `admitInput(nativeUserMessage)` 登记输入。DSH 的 `runtime-context`、`skill-catalog`、`time-context`、`agent-instructions` 是上下文投影，不切换输入来源、不消耗登记，也不恢复后台或已取消的输出。适配器必须采用相同分类；这些来源本身不提供身份或 QQ 投递权限。

明确用户修正由可信入口构建原生 UserMessage 后调用 `policy.revise(message)`。该方法不是模型工具：纯生成阶段调用原生 cancel（保留 Inbox）并 followup；已请求工具或阶段不确定时只 steer。`stopOutput()` 仅抑制未发送的显示内容，平台仍须调用原生 `/stop` 或 cancel。它不能回滚工具副作用。

完整边界、配置、测试和 Character/QQ 接入见 [Interaction 文档](../../docs/INTERACTION-POLICY.md)。
