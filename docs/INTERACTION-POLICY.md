# Interaction Policy V1

当前实现为 Interaction **0.1.0-test.4**，配套 Character test.18 与 QQTK 的 QQ Bot 0.5.2 / SDK 1.0.5 两份补丁。验证宿主为 DSH 0.2.1-rc.3，继续使用 rc.2 已有原生接口。部署与验收状态以 [STATUS](STATUS.md) 为准；历史结果见 test.10 发布记录。

## 分工与启用

独立 Agent/Preset 插件负责 Reply Policy、语义气泡、等待状态和明确修正，不新增模型、数据库或 Agent Loop。QQTK 只提供可信入站、唯一 Sender、审批/问答状态、平台限制和发送回执。Memory、Persona 与 QQ 不是依赖；Web 使用原生消息渲染，尚无多气泡/Host 状态 UI 适配。

Character 构建默认关闭，可通过私有构建配置的 interaction 或 DSH_CHARACTER_INTERACTION=on/off 选择。普通 Agent 在原生 Preset 追加插件并隔离 interactionPolicy 服务；不要覆盖完整 Creator 工具列表。[声明及平台契约](../packages/interaction-policy/README.md)。

| 参数 | 默认 | 语义 |
|---|---|---|
| enabled | true（已装配时） | false 时不注册策略 |
| hangOnMs | 8000 | 本轮尚无自然回复发送确认的等待阈值 |
| hangOnText | 还在处理中，稍等一下。 | Host 瞬态状态，不进入 Session/Memory |
| throttleMs | 180 | 累计文本更新节流 |
| maxBubbles | 3 | 进度、等待提示及结果共享语义气泡预算 |
| chatMaxChars | 240 | 短闲聊与长结果风格分界，非禁用分段或截断阈值 |
| bubbleTargetChars | 300 | 长结果软目标，通常约 150～400 字，完整结构可更长 |

## 发送与分段

短聊按完整句意分，长结果按段落及安全句界分；工具调用不再关闭分段。代码块、列表、表格、链接和引号内容尽量保持原子结构。字符数是启发式软目标，不是 Tokens 或强制单条上限。剩余气泡不足时合并余文，绝不截断；QQ 另以最多 4500 字符做协议分片，极长原子块可能被硬分片。

流式阶段仅展示首个候选片段，其余内容等待原生正式 settlement；此后按同一队列完成当前气泡并发送剩余段落。已经展示的文字不缩回、不搬到别的气泡。无 Streaming 的平台只发送正式结果。多种 Chunk 划分应保留相同正文和分段，取消、放弃尝试及工具边界仍沿用原生机制。

Hang on 仅适用于已登记的交互入站、Agent running、无审批/问答等待且尚无自然回复发送确认的轮次。8 秒时进入同一发送队列，真正发送前再次检查；不会越过正在发送的正文。QQ 的 onDelivered 来自成功接口回执，SDK 缓冲或模型生成文本不算；回执不证明手机收件。旧平台未实现回执契约时，成功的 update/sendText 仍是兼容信号。

## 权限、取消与维护

QQ 必须先登记可信 native UserMessage。runtime-context、skill-catalog、time-context、agent-instructions 仅是上下文，不消费入站登记，也不能解除后台抑制。Schedule、Web、未知来源不得借 QQ 绑定串台。

/stop 先抑制未发送显示，再执行既有原生取消。明确“更正：”由可信入口调用 revise：纯文本阶段 cancel + followup；工具已请求或执行阶段不确定时只 steer，不承诺撤销副作用。移除插件会取消未完成的显示队列。

QQ 配置 deliveryDiagnostics:true 可记录本机限量脱敏的事件→气泡→SDK 请求/回执关系，不记录正文、原始身份或凭据，详见 [QQTK](https://github.com/EJYDOvO/harness-qq-toolkit-public/blob/main/docs/INTERACTION.md)。真实完整重复气泡尚待复现；新增记录不等于已修复根因。

升级/回滚须匹配 Interaction 包、Core 策略配置、两份 QQTK 补丁和锁文件；不要单独降回旧的来源分类。停止 Host 后保留旧 Profile、自有维护文件与一致性数据备份，回滚代码时保留切换后新数据；无 Memory Schema 迁移。

## 验证

本轮 Character 188 项、QQTK 轻量 30 项及 SDK 隔离 33 项通过；实际 rc.3 Host 10 项交互检查、两进程生命周期/旧提醒/长期任务恢复通过。模型、Sender/API 为合成替身，没有发送真实 QQ 测试消息。真实异常网络、手机展示及完整重复气泡原因仍未确认。

入口：npm test、npm run test:audit、scripts/run-interaction.ps1、scripts/run-lifecycle.ps1；QQTK SDK 测试必须指定代码隔离的 QQBOT_AUDIT_SDK_DIR / QQBOT_AUDIT_DIST，不使用生产凭据。测试结果保留在本地忽略目录。