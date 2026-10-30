# DSH Character Agent：架构设计与现状 v0.8（工作稿）

> **更新日期：2026-10-29｜状态：现状同步 + 已确认的两端边界；中间通用层继续讨论。**  
> GitHub 是今后的唯一主维护入口，本目录用于维护 v0.8 架构工作稿；旧 ChatGPT Library v0.7.8 只是历史快照。旧 Library 历史快照中的完整设计名为 `ARCHITECTURE_v0.7.8.md`（2026-10-16），其当时的「尚未部署」及版本假设属于历史语境，不代表目前状态。项目源码以 [Character 状态记录](https://github.com/EJYDOvO/character-agent-v1/blob/main/docs/STATUS.md) 和 [QQTK](https://github.com/EJYDOvO/harness-qq-toolkit-public) 为实施证据；当前文档不代表已经进行了新的架构迁移。

## 0. 先给结论

**[已决定] 上层 Character 应用归一个仓库；下层所有交互平台 Adapter 归一个仓库。** 这两端的组织方向基本确定。平台仓库可以同时有 QQ Official、QQ Personal 和未来其他平台，每个平台仍应作为可单独安装、启用的 Package/DSH 入口，不要求把所有 SDK 装到一起。**该统一平台仓库目前尚未建立。**

**[待定] 中间八类能力的分层、必要性、Package 数量、DSH Plugin 数量、仓库数量和命名仍需讨论。** 保留八类功能地图，但**八类功能不等于八个仓库，也不等于八个必装插件**。相关且需要共同维护/发布的功能可以合库；适合独立安装的能力仍应能独立启停。

**[已决定] 本阶段只做架构与文档工作，不开始重构、部署、平台迁移。** 中间层讨论定稿后再写完整接口和迁移验收设计，然后进入开发。迁移时可按模块一次性切换，不长期维持两套生产路径；安全状态必须备份、审计、单写入者。

**[目标] 普通 DSH Agent + QQ 小号能够独立运行，不需要安装 Character；Character 则在通用基础能力上叠加角色专属身份、Persona、Memory 策略和 Worker。** 不代表 QQ 小号 Adapter 已存在或已验证。

## 1. 当前实现基线（事实，不是未来目标）

| 项目 | 已有实现 | 边界与验收状态 |
| --- | --- | --- |
| Character | `character-agent-v1` **test.23**；Character Core/Extras、Definition、Identity、Memory、Worker、可选 Inspector/Long Tasks | 仓库记载已授权部署，13 个 Preset 健康；当前角色入口为官方 QQ Bot，单 Owner 私聊 |
| DSH 运行时 | 验证基线 **DSH 0.2.1-rc.3 / Node.js 24.21.0 / Windows** | 继续复用原生 Agent、Session、Preset、Tools、Approval、Schedule、Worker Spawn；不另造运行时 |
| Conversation Manager | **`dsh-conversation-manager@0.1.0-test.2`**，源码在 QQTK `plugin-sources/` | 已独立 DSH Host Plugin；唯一当前 Conversation→原生 Session 路由，恢复、偏好、轮换及释放；第二平台仅合成夹具验证 |
| Interaction | **`dsh-interaction-policy@0.1.0-test.8`**，源码在 Character `packages/` | 已可选独立 Agent/Preset Plugin；中断、分泡、Hang-on、Worker 续轮等；QQTK 仍负责 Sender/回执接线 |
| QQ 官方适配 | QQTK test.23；Bot **0.5.2** / SDK **1.0.5** 的受审版本化补丁 | 单一 Gateway；接入/发送/审批/问答/媒体/命令/诊断混在 QQTK，不是统一跨平台库 |
| Memory | Character Memory Core/Tools、`memoryIdentity@1` 可信 Host 契约；SQLite Schema **3**、L1/L2/L3 与人格化模式 | 已支持非 Character 的 DSH Agent 选装；不等于在任意平台自动获得可信身份 |
| 其他可选能力 | Remote Ops、Memory Inspector、Long Tasks、Preset Manager | 已有独立模块/插件，不在本轮为了重构而重写 |
| 新平台 | QQ Personal / NapCat/OneBot 等 | **未实现、协议未定，未完成真实 QQ 小号测试** |

**test.23 的关键变化**：Worker 原生工具范围守卫与委派策略加强；Interaction test.8 将短闲聊改为趋向整泡、长结果继续按语义分泡，动态 Hang-on 默认 **4 秒起草 / 8 秒检查**，等待状态不占正文气泡预算，尾泡可完整预览；发送归属与判断/起草诊断增强。下一轮希望更自然的**短气泡闲聊**，只是讨论目标，**不是现有 test.8 行为**。

**证据边界**：仓库记录 Character 215 项单元、33 项安全审计、QQTK 55 项轻量与 6 项审批检查，以及若干 rc.3 Host 隔离探针；模型、Sender 等多为合成替身。**不能把 Gateway ready、API 回执或自动测试等同真实 QQ 手机送达与按钮验收。** `--workers --manager` 在 55 秒加载时限内未完成；真实手机流式撤回残留等仍待验收。具体以 `STATUS.md` 为准。

## 2. 已确认的组织方向（头尾固定，中间不预设）

```text
上层：Character 应用仓库（一个，确定）
  definition / Persona / Character Identity & Memory policy
  Worker policy / 应用装配 / Character-only 扩展
                 ↑  依赖并组合
中间：通用能力层（继续设计，不预定仓库数）
  可移植普通 JS 模块 + 可选 DSH Plugins + DSH 运行时集成
  Conversation Manager（已独立）、Interaction（已独立）等
                 ↑↓  稳定公共契约
下层：Platform Adapters 统一仓库（一个，确定为目标）
  qq-official / qq-personal（未来） / 其他交互平台（未来）
  各平台独立 Package/SDK/配置/启用/测试
                 ↕
        平台原生协议与外部事件

DSH Native Host：目前提供 Agent/Session/Tools/Approval/Schedule
（运行基础，不是再建一套 Agent 框架）。
```

说明：图表达**逻辑归属与协作**，不是说 DSH Host 位于平台协议之下，也不是已建立的 Monorepo。平台 Adapter（QQ/Telegram 协议）和 DSH Adapter（把通用逻辑接入 Host）是不同概念。一个仓库可包含多个 Package；Package 可包含普通逻辑与 DSH Plugin 入口；**仓库 ≠ Package ≠ DSH Plugin ≠ Character 挂件**。

## 3. 八类功能地图（确认分类，尚未确认分包）

| 分类 | 负责的问题 | 当前实现线索 | 中间层待决事项 |
| --- | --- | --- | --- |
| **1 Messaging** | 消息模型、可信入站交接、发送关联、出站回执 | QQTK `gateway/bootstrap.js`、`transport/inbound.js`、`reply-target.js` | 最小消息契约、平台 Sender 能力、归属唯一性 |
| **2 Interaction** | 插话/更正、回复生命周期、气泡计划、Hang-on、Worker 续轮 | Character `interaction-policy` + QQTK 出站桥 | DSH 原生事件与纯策略边界；可选安装；恢复自然短泡 |
| **3 Identity** | 平台真实主体、角色授权、Session/Memory 权限 | Character `character-identity` + QQ 可信中间件 | 可信平台证明与 Character Owner/历史根 ACL 分界；不自动关联跨平台身份 |
| **4 Human Input** | 工具审批、Agent 向用户提问、选项/文字回答、取消/超时 | QQTK `ApprovalChannel` / `QuestionChannel` | DSH 原生 Approval 唯一权威；不让多个 Adapter 重复接管全局服务 |
| **5 Notification** | Outbox、稳定收件目标、去重、投递状态、恢复 | Character Identity SQLite、Remote Ops 通知 | 唯一持久写入者、旧状态兼容、`unknown` 不重放 |
| **6 Commands** | 命令准入、解析、分发与 Host 动作 | QQTK slash middleware、Remote Ops `/ops` | 是否作为通信内部模块；业务动作须经过 Host 授权 |
| **7 Media** | 图片/音频/视频/文件内容与发送 | QQTK 附件、视觉工具、`qqbot_send_file` | 通用媒体消息契约与平台传输/路径权限分层 |
| **8 Diagnostics** | 事件、响应关联、性能与投递诊断 | Interaction trace、QQTK 脱敏日志 | 横向事件约定，避免新增不必要的运行服务 |

Conversation Manager 是**已独立的基础设施**，不需要为了凑八类重新实现。Memory Core、Worker/Long Tasks、Remote Ops、Inspector 也是既有能力；是否迁仓另议，不应在架构讨论阶段默认重写。

## 4. 关键边界与不变量

- **平台负责真实来源及协议限制**：OpenID/QQ 消息 ID、被动配额、按钮、Typing、流式编辑/撤回、限速及文件上传归平台实现；通用层只接受经可信入口证明的消息与能力声明。不以模型生成的字段作为身份授权凭据。
- **Conversation Manager 负责路由，不发权限**：唯一当前 Session、原生持久恢复/轮换、模型与 Preset 偏好继续由其负责；Character Identity 掌握 Owner、Memory ACL 与历史根门禁。一个 Session ID 不足以证明可重新授权。
- **Interaction 负责响应策略，不假定所有平台支持更新消息**：`openStream` 必须是能力可选项，累计 `update` 不能被简单转换成多条重复消息；真实发送回执与手机接收也不应混淆。
- **Human Input 不复制 Approval 权威**：原生 DSH 进行审批决定，外层只验证响应身份、路由到请求、展示状态。不能由每个平台任意猴子补丁共享 `userQuestions.ask()`。
- **Notification 不复制 Schedule**：原生提醒仍绑定历史 Session；通知应有持久的 Conversation 目标，不使用短期 msgId 作为长期地址；不确定发送状态 `unknown` 不自动重试。
- **旧身份及数据不可静默迁移**：保留 `principalId`、`conversationId`、`qq_bindings`、Memory Schema/ACL、原生 Session/Schedule、事件 ID 与通知账本；切换前需审核映射及数据、保留可恢复快照，生产每项状态只有一个权威写入者。
- **Character 不是 QQ 的子插件**：Persona、Memory 治理、Worker 权限和角色业务仅在上层；普通 DSH Agent 可以不加载 Character 而安装所需通用能力。
- **V1 已实现与未来社交目标分开**：当前仅单 Owner 私聊；多用户/群聊、跨平台账号关联、主动社交和其他平台均非 test.23 已交付能力。

## 5. 目前明确的代码耦合（后续设计依据）

1. QQTK `bootstrap.js` 同时构造 SDK/Gateway、Interaction Sender 接线、Approval/Question、Remote Ops 钩子、媒体工具和诊断，平台细节与部分通用职责混合。
2. `QuestionChannel.install()` 包装共享 `userQuestions.ask()`；未来多平台不能直接各自安装同类包装。
3. Character Identity 同时持有 Owner/Session 权限、QQ Gateway 绑定、原生 Schedule 历史根审查和持久 Outbox；通知拆分要先规划数据归属。
4. Character `character-qq-adapter/lifecycle.mjs` 仍通过 `qqRemoteOps.attach` 拦截/包裹 Gateway；通用平台接口不应继承这层偶然耦合。
5. QQTK 已把 `SessionManager` 缩成 `conversationManager.openAdapter()` 薄适配，这部分不应该再回退成 QQ 私有 Session 管理器。

## 6. 待讨论的中间层问题（未决，不提前写为结论）

1. 哪些属于**最小可用聊天**的必要模块，哪些按需安装？Messaging / Interaction / Human Input / Notification / Commands / Media / Diagnostics 的层级与生命周期如何划分？
2. 各模块的唯一权威、调用方向、失败隔离和接口契约是什么？是否有可移植核心，还是更适合维持 DSH Plugin？
3. 目前已独立的 Conversation Manager、Interaction 应否共仓？哪些功能因共同版本、强关联而合库，哪些因状态生命周期或可选性保持独立包？
4. 统一 Platform Adapters 仓库怎样保证**每个平台只安装自己的依赖**，以及平台鉴权/消息表示/发送能力如何做契约测试？
5. Identity 的通用身份接口与 Character 专属 Owner/Memory/旧根保护如何界定？跨平台关联须经哪些显式授权？
6. 一旦定稿，先制定数据兼容、回滚、模拟第二平台和真实 QQ 验收矩阵，再拆解成开发任务。

## 7. 文档与开发顺序

当前：**架构讨论 → 记录决定/开放问题 → 中间层正式接口定稿 → 修订路线图与验收计划 → 才开始开发**。不新建平台仓库、不改 QQ、Character 或运行数据、不部署。开发阶段逐功能迁移，完成隔离测试后受控切换，**不维持长期双轨**。

有关已确认决策见 `DECISIONS.md`，阶段与验收见 `IMPLEMENTATION_ROADMAP.md`，模块讨论契约见 `MODULE_IMPLEMENTATION_PLAN.md`。旧 `v0.7.8` 及更早版本保留为历史设计记录。
