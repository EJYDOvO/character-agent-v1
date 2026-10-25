# 运行架构与复用边界（test.14 源码）

test.13 在既有原生分析 Worker、Memory Inspector 上引入可选 QQ Session 生命周期和独立长期任务；test.14 收紧历史根权限并补充存量提醒审计。隔离与当前实例部署的验收边界统一见 [STATUS](STATUS.md)。阶段对照见 [路线图](IMPLEMENTATION_ROADMAP.md)，任务契约见 [Long Tasks](../packages/long-tasks/README.md)。

新增 Worker 使用官方 `subagent` 的 `agentPreset / allowedAgentPresets` 和 `spawn`，Core 自带 `worker-general`；执行守卫位于现有 Memory Tools 包的独立入口，不增加自定义 Spawn 或 Agent Loop。主 Character 保留完整 Creator。Inspector 是额外可选双端插件：原生 `dsh.client` 将 React 页面注册到 `settings.section`，复用 DSH 导航、组件与主题；通过原生 Connection RPC 访问有界 Host API，Host 复用 `webServer` 与 `connection.admit()`，经认证后调用 Core 的授权 API，浏览器不能直连 SQLite 或指定可信主体。四个核心插件与可选 Extras 边界保持；详见 [Worker](WORKERS.md) 和 [Inspector](MEMORY-INSPECTOR.md)。

**test.10 交互增量**：独立可选 `dsh-interaction-policy` 通过原生 Agent-scoped 事件和 Preset 服务隔离管理表达与发送策略。QQTK 只接入 Sender 与可信修正入口；Character Identity 复用原入站校验和证据逻辑提供提前接入钩子。没有新数据库、Planner 或 Agent Loop，原四插件和 Core/Extras 保留。详细接口及当前验证见 [Interaction Policy](INTERACTION-POLICY.md)。下文为既有记忆架构。

这是源码实现说明。test.8 增加分层记忆与可选人格化；部署和验收范围见 [发布记录](RELEASE-test8.md)，详细层次、生命周期和限制见 [分层记忆](MEMORY-LAYERS.md)。四个核心 Character 运行时包保留；Definition 是构建模块，Core/Extras 是项目 Bundle。Extras 仅含默认停用的自有长期任务声明，不是第二个 QQ Gateway。

| 组件 | 之前 | 现在 |
|---|---|---|
| 版本化 QQ 基础适配 | `agents + qqRemoteOps` 必需 | `agents` 必需；原生 `agentPresets` 用于会话组合；Remote Ops 可不安装 |
| Remote Ops | 显式安装根目录下的私人维护脚本 | 独立状态目录和 Owner；可选 Host `qqMaintenance` 后端；兼容旧 root 后端 |
| Memory Core | `characterIdentity` | 标准 `memoryIdentity@1`、DSH LLM/Agent/默认模型；不导入 QQ/Character |
| Memory Tools 默认入口 | Character 身份、提示词、通知查询 | `memoryIdentity@1 + dshMemory + tools + systemPrompt`，Agent-scoped |
| Tools `character.mjs` | 无独立边界 | 同包内专用入口：旧工具名、Character 提示、QQ 通知查询 |
| Character Identity | QQ Owner、会话绑定、通知账本 | 原有职责 + 标准可信身份适配、QQ 全消息确认策略 |
| Character QQ Adapter | QQTK attach 拦截 | 保留；只允许配置的 Character Preset，不接受解析失败降级 |
| Definition / Creator 派生 | 固定默认路径和 Preset | 角色路径、Preset ID、数据目录可配置；官方 Creator 指纹变更触发重建 |

## 数据流

```mermaid
flowchart LR
  QQ[QQ SDK 与入口白名单] --> G[单一 QQ Gateway]
  G --> S[Session / Sender / 审批 / 问答]
  S --> A[原生 DSH Agent]
  G -.可选.-> O[Remote Ops]
  O -.可选.-> M[可信维护后端]
  G --> CI[Character QQ Adapter + Identity]
  L[其他项目的可信 Host 入口] --> LI[独立 Identity Provider]
  CI --> I[memoryIdentity v1]
  LI --> I
  I --> C[Memory Core / SQLite]
  A --> T[Agent-scoped Memory Tools]
  T --> I
  T --> C
  C --> E[原有 LLM 提取队列与治理引擎]
```

图中 CI 和 LI 是替代配置，单个作用域只装配一个 Provider。其他项目不需要安装 Character Identity、QQ Adapter 或两个 Character Bundle。

Inspector 可以直接依赖 Core 的管理 API；Core 不反向依赖 Inspector，不新增接口服务。Character Adapter 对 Identity、Memory、Remote Ops 的组合依赖是项目边界，不能据此推断基础 QQ 或通用 Memory 也必须安装它们。Worker guard 继续复用 Tools 包入口，不单独拆包。

v0.7.8 的主体目标已有实现，但项目范围由可信 binding 固定配置；尚无任务级独立 grants 或项目管理 UI。主 Session 生命周期在 QQTK，稳定 Conversation 及 Outbox 在 Identity；原生 Schedule 仍指向原 Session，使用持久 qq_bindings 冷恢复原根，不迁移提醒。独立长期任务通过原生 storageDomain 保存任务/执行账本，使用独立任务根 Session 和受限 Preset；不新增 Coordinator、调度器或 Memory 数据库。旧 Task Memory 只有只读预览，未完成受控正式导入。

## 可信契约

Host 服务 `memoryIdentity`：

- `contractVersion: 1`。
- `forSession(sessionId)`：查询真实 Host Agent/Session，返回不可伪造、可撤销的句柄。不得把模型提供的 principal/project/namespace 直接包装成权限。
- `authorize(handle, 'read'|'write')`：验证句柄仍有效，返回 `{principalId, namespaceId, projectId}`。
- `current([principalId, namespaceId, projectId])`：只返回同作用域的可用 Session，供中断提取任务恢复；不得跨项目退回默认用户。
- `onEvidence(listener)`：订阅可信入口证据，返回卸载函数。事件是 `(handle, {sessionId, eventSeq, origin, messageId, text, receivedAt})`。真实用户原文使用 `direct_user`；模型记忆工具只产生 `inference`。工具输出不可冒充用户。
- 可选 `confirmationEvidence(handle, {memory, quote})`：Host 核对真实、近期的完整确认输入，返回来源。未提供时 confirm 工具拒绝执行，不静默确认。

Core 提供 `dshMemory`，保留 `characterMemory` 服务别名。SQLite 原有 `character` 列承载通用 namespace；旧 Character scope 值保持不变。test.8 的部署记录已确认生产迁移到 Schema 3；本次审计修复没有访问生产库，也没有再次部署。可选 Host 字段 `agentId`、`memoryMode`、`l3Tokens` 控制人格化与投影；模型不能填写这些权限字段。

当前源码的读取先验证 Host、Agent 和形成模式，再排除退休证据，汇合可见用途做相关性排序与预算。冲突检查只在当前可见集合内进行，避免暴露另一 Agent 的私有条目。新形成的人格化来源带 `memoryPolicy`；Assistant 不读取 Character 或缺少模式标记的历史人格化记录。详细兼容边界见 [审计修复](AUDIT-FIXES.md)。

test.12 审计进一步将内部可见性判断与公开脱敏分离，避免遗忘擦除公开 `source` 后反向影响内部授权。Inspector 使用授权 SQL 分页/统计，L3 Browse 按当前有效引用分页；L3 缓存只保存派生结果，每次仍授权，并按 SQLite 修改版本、外部连接变更、模式和时间失效。Schema 3 增加可重复创建索引，不新增记忆层或数据库。详见 [当前状态与验收边界](STATUS.md)。

身份句柄只在当前进程有效，Session 恢复后重新由 Host 确认。示例 Provider 用实际 Agent 对象、挂载的 Preset 和 WeakSet 颁发/验证句柄。它用于可信单用户本机入口，不是互联网登录或多租户认证系统。能够加载任意 Host 插件的代码属于可信计算基，插件同进程执行不构成恶意代码沙箱。

**历史 QQ 根修复（test.14，已部署）**：`routes` 加 QQTK 当前偏好路由共同决定完整身份，`qq_bindings` 仅保存提醒归属。冷恢复不会颁发完整能力；实际 Agent plane 的原生 tool guard、pre-step/request 门禁动态查询当前 Identity，停用后保持拒绝，当前主 Agent 保留 Creator。`isCurrentSession(record)` 核对真实 manager record、持久路由的内存镜像和 Agent 注册表，异步旧请求不得把主路由改回历史根。

存量审计只读原生 `schedule.catalog()` 与 `sessionPersistence.stat()`；仅从固定作用域的 `routes/qq_bindings`、QQ prefs 当前/previousSessionId 出发，沿原生持久 `parentSession` 向祖先查证，并核对 Preset 与非委派根。Preset/cwd/消息正文相同都不能单独证明归属。启动/冷恢复可事务补齐已核实的**提醒绑定**，不修改主路由、Schedule 或 Memory；并发证据变化拒绝补写。归属不明的冷恢复在原生投递确认前拒绝，保留任务；已存活的未绑定根在原生 `followup` 接入前拒绝 Schedule，避免消费 occurrence，工具及模型也被拒绝。重载扫描已有 Character 根，实际 Agent 上的门禁动态查询新 Provider；不增加 inbox、调度器或权限存储。此处不替代有权加载任意 Host 插件的可信计算基。

## 生命周期与单例

- QQ 接入、问答与审批只由基础 Gateway 建立。Core 的 Adapter 调用该 Gateway；Extras 不包含 QQ 条目。Preset 不创建连接。
- 维护补丁在进程级共享注册表中按 QQ appId 占用租约；重复模块副本也拒绝重复启动。卸载先停止 SDK/Session，再释放租约。
- 多进程不能靠内存租约互斥；部署脚本用维护锁和单活检查隔离真实 QQ 验证与生产。
- 上游 QQ 用户目录偏好会跨 Profile 共用；维护补丁优先使用 DSH_HOME/qqbot。不同项目必须分开 DSH_HOME；无环境配置时保留旧路径，不自动迁移或覆盖旧数据。
- Remote Ops 在 Gateway 引导时可选绑定。运行中新增/移除它应重载 Gateway 或重启 Profile；暂不支持无重载的动态能力发现。
- Character Adapter 保留 QQTK 通知到 Character outbox 的桥接，卸载撤销身份。失效 Preset 拒绝服务，不能退回权限不同的宿主组合。

## 明确未改变的部分

保留既有三类记忆、FTS5、CAS、近重复处理、时效、来源、遗忘防复活和提取队列。test.8 已新增 L1、跨事件 L2 巩固、L3 摘录投影及话题消费策略；不追溯改变 test.7 交付声明。test.12 增加受限分析 Worker，没有主动闲聊。冲突的完整语义判断、网络投递 exactly-once、提醒目标迁移与跨机器认证仍不是已完成能力；test.13 的可选 QQ 轮换已隔离验证并在本机启用，实际收件待验收。
