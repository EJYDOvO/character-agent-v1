# Interaction Policy V1

当前实现为 Interaction **0.1.0-test.5**，配套 Character test.19 与 QQTK 的 QQ Bot 0.5.2 / SDK 1.0.5 两份补丁。验证宿主为 DSH 0.2.1-rc.3，继续使用 rc.2 已有原生接口。部署与验收状态以 [STATUS](STATUS.md) 为准；历史结果见 test.10 发布记录。

## 分工与启用

独立 Agent/Preset 插件负责 Reply Policy、语义气泡、等待状态和明确修正，不新增 Agent、Session、数据库或 Agent Loop。Policy 管时序和状态；动态等待提示的生成由插件入口通过内部回调注入，只调用原生 `ctx.llm`。QQTK 只提供可信入站、唯一 Sender、审批/问答状态、平台限制和发送回执。Memory、Persona 与 QQ 不是依赖；Web 使用原生消息渲染，尚无多气泡/Host 状态 UI 适配。

Character 构建默认关闭，可通过私有构建配置的 interaction 或 DSH_CHARACTER_INTERACTION=on/off 选择。普通 Agent 在原生 Preset 追加插件并隔离 interactionPolicy 服务；不要覆盖完整 Creator 工具列表。[声明及平台契约](../packages/interaction-policy/README.md)。

| 参数 | 默认 | 语义 |
|---|---|---|
| enabled | true（已装配时） | false 时不注册策略 |
| hangOnMs | 8000 | 本轮尚无自然回复发送确认的等待阈值 |
| hangOnDraftMs | hangOnMs × 11/16（默认 5500） | 开始并发生成动态等待提示的时间，须小于 hangOnMs |
| hangOnText | 还在处理中，稍等一下。 | 动态候选未就绪或不合格时的固定文案；Host 瞬态状态，不进入 Session/Memory |
| hangOnModelFile | 无（Character 构建为 `<数据目录>/hangon-model.json`） | 可选模型路由文件位置；不是功能开关 |
| throttleMs | 180 | 累计文本更新节流 |
| maxBubbles | 3 | 进度、等待提示及结果共享语义气泡预算 |
| chatMaxChars | 240 | 短闲聊与长结果风格分界，非禁用分段或截断阈值 |
| bubbleTargetChars | 300 | 长结果软目标，通常约 150～400 字，完整结构可更长 |

## 发送与分段

短聊按完整句意分，长结果按段落及安全句界分；工具调用不再关闭分段。代码块、列表、表格、链接和引号内容尽量保持原子结构。字符数是启发式软目标，不是 Tokens 或强制单条上限。剩余气泡不足时合并余文，绝不截断；QQ 另以最多 4500 字符做协议分片，极长原子块可能被硬分片。

流式阶段仅展示首个候选片段，其余内容等待原生正式 settlement；此后按同一队列完成当前气泡并发送剩余段落。已经展示的文字不缩回、不搬到别的气泡。无 Streaming 的平台只发送正式结果。多种 Chunk 划分应保留相同正文和分段，取消、放弃尝试及工具边界仍沿用原生机制。

Hang on 仅适用于已登记的交互入站、Agent running、无审批/问答等待、尚无自然回复发送确认且气泡预算未用尽的轮次。8 秒时进入同一发送队列，真正发送前再次检查；不会越过正在发送的正文。QQ 的 onDelivered 来自成功接口回执，SDK 缓冲或模型生成文本不算；回执不证明手机收件。旧平台未实现回执契约时，成功的 update/sendText 仍是兼容信号。只有 assistant 气泡的回执确认自然回复；等待提示自身的回执不会被当成正文送达。

### 动态等待提示（test.5）

约 5.5 秒（`hangOnDraftMs`）仍满足上述条件时，并发调用一次原生 `ctx.llm.stream` 生成符合 Persona 的简短等待提示，不阻塞主 Agent。8 秒时复查运行、回执、审批/问答和取消状态：候选已完成且合格就发送，否则使用 `hangOnText`。正文回执先到、取消、停止、Turn 结束或进入审批时中止生成并丢弃候选；迟到结果和上一轮结果不会被使用。每轮最多生成一次、发送一次，等待提示在决定发送时同步占用 `maxBubbles` 名额，取消发送会退回名额。

- **输入**：只读取当前 Agent 作用域的 Persona 前缀/后缀段落，不运行完整 Prompt 组装，也不读取聊天历史、工具结果或 Memory。附加的状态只区分“正在执行工具”和“正在处理”。
- **不落盘**：请求不带 `sessionId` 和 `purpose`，因此不触发 Session checkpoint、标题生成，也不追加 Session 事件；不创建 Agent/Session，不写 Memory。
- **不编造进度**：提示词禁止描述进度、步骤、结果或剩余时间。输出只接受一行不超过 60 字的纯文本，包含数字、百分号、链接或 Markdown 的候选会被拒绝并改用固定文案。
- **模型路由**：默认继承当前 Agent 请求头里的 Provider/Model，缺失时使用原生默认模型选择。`hangOnModelFile` 指向的 `hangon-model.json` 存在时只改这一路生成，内容必须且只能是 `{"provider":"…","model":"…"}`。文件缺失即继承；格式不合法时记录一次警告并继承。每次生成时读取，修改后无需重启。

动态生成依赖 rc.3 `systemPrompt` 的作用域层读取 Persona 段落（内部 `layers.merge`）；读取失败、路由不可用、模型未完整结束或请求工具时都退回固定文案。等待提示仍是瞬态展示，不能证明任务进展。

## 权限、取消与维护

QQ 必须先登记可信 native UserMessage。runtime-context、skill-catalog、time-context、agent-instructions 仅是上下文，不消费入站登记，也不能解除后台抑制。Schedule、Web、未知来源不得借 QQ 绑定串台。

/stop 先抑制未发送显示，再执行既有原生取消。明确“更正：”由可信入口调用 revise：纯文本阶段 cancel + followup；工具已请求或执行阶段不确定时只 steer，不承诺撤销副作用。移除插件会取消未完成的显示队列。

QQ 配置 deliveryDiagnostics:true 可记录本机限量脱敏的事件→气泡→SDK 请求/回执关系，不记录正文、原始身份或凭据，详见 [QQTK](https://github.com/EJYDOvO/harness-qq-toolkit-public/blob/main/docs/INTERACTION.md)。真实完整重复气泡尚待复现；新增记录不等于已修复根因。

升级/回滚须匹配 Interaction 包、Core 策略配置、两份 QQTK 补丁和锁文件；不要单独降回旧的来源分类。停止 Host 后保留旧 Profile、自有维护文件与一致性数据备份，回滚代码时保留切换后新数据；无 Memory Schema 迁移。

## 验证

test.5 新增 15 项单元测试，覆盖并发不阻塞、超时回退、取消/停止/审批、跨 Turn、发送顺序、状态回执隔离、`maxBubbles` 名额和模型路由；Character 单元 170 项、审计 33 项通过。实际 rc.3 Host 12 项交互检查通过，其中包括：经原生 `ctx.llm` 在继承路由上生成一次动态提示且不进入 Session 历史、生成超时回退固定文案、`hangon-model.json` 改路由。模型与 Sender 为合成替身，真实模型的提示质量、延迟和手机展示仍未验证。历史结果见 STATUS。

入口：npm test、npm run test:audit、scripts/run-interaction.ps1、scripts/run-lifecycle.ps1；QQTK SDK 测试必须指定代码隔离的 QQBOT_AUDIT_SDK_DIR / QQBOT_AUDIT_DIST，不使用生产凭据。测试结果保留在本地忽略目录。