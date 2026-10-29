# Character Agent V1

在 DeepSeek Harness 上运行的角色 Agent 扩展，提供私人 QQ 接入、可配置角色和带来源的长期记忆。Character 从官方 Creator Preset 构建派生，保留其工具能力；角色设定不会增加系统权限。

这是测试版源码仓库，不包含 DSH 本体，也不是一键安装器。当前源码为 **test.22 / Interaction test.7**，配套 `dsh-conversation-manager@0.1.0-test.2`，已在现有 Windows 实例授权部署；修复恢复异常、资源关闭和 Identity HMR 边界，实例部署状态见 STATUS。使用独立 Conversation Manager 与最新 QQTK 补丁。历史部署状态见 [STATUS](docs/STATUS.md)，安装/旧路由保护见 [集成说明](docs/INTEGRATION.md)。本轮验证基线为 **Windows、Node.js 24.21.0、DSH 0.2.1-rc.3、QQ Bot 0.5.2 / SDK 1.0.5**；其他构建需重新验证。

可选 [Interaction Policy V1](docs/INTERACTION-POLICY.md) 提供自然表达、默认 8 秒无发送确认提示（5.5 秒起经原生模型并发生成 Persona 风格短句，未就绪则用固定文案）、短聊/长结果语义气泡（长回复边生成边分泡）、按输入归属回复与 Worker 续轮、执行期间新消息的更正/优先/补充/排队处理；工具调用不禁止分段。源码默认构建不启用；该通用插件不要求安装 Character 或 QQ。配套 QQTK 可开启限量、脱敏的本地投递诊断；真实重复气泡仍待复现。

可选 [Preset Manager](https://github.com/EJYDOvO/dsh-preset-manager) 在原生设置页管理已安装 Plugins、Skills 和 Preset Override。它独立安装到 Profile，不复制进 Core/Extras，通过原生 Override 管理 Worker 工具和 Skills，不自动扩大 Character 委派白名单；当前验收边界见 STATUS。

test.17 的原生 Worker 工具与跨仓库 Manager 配置已完成隔离验收；真实模型的任务质量与手机审批完整链路仍需实机验收。

test.14 已收紧历史 QQ Session：只有当前主路由获得完整身份；旧根仅由 Host 转发可信 Schedule 提醒，禁止模型、工具、Memory 与长期任务创建。提供[只读存量审计](docs/MANAGEMENT.md)；必须配套更新 QQTK 补丁，不能单独部署 Identity。

## 能做什么

- **角色配置**：通过 YAML 定义身份、表达方式、背景和边界，构建为完整 Character Preset。
- **私人 QQ 助手**：QQTK 负责单一 Gateway、发送和审批/问答展示；独立 Conversation Manager 负责 Session。仅允许单 Owner 私聊，群聊关闭。
- **长期记忆**：SQLite + 中文 FTS5，支持保存、召回、检查、纠错、确认、合并、遗忘和来源追溯。
- **分层整理**：L1 保存可信经历，L2 提取和巩固长期记忆，L3 为每轮对话提供少量核心记忆；L0 沿用 DSH Session 与 Compaction。
- **可选人格化**：Off / Assistant / Character 三种模式，与通用记忆共用数据库，按 Agent 隔离；模式切换同时约束历史记录读取。形成带引用的用户画像、互动约定和自身经验，不修改固定角色设定；引用存在不代表推断一定正确。
- **提醒与维护集成**：复用官方 Schedule 和独立 QQTK，记录明确任务通知的投递状态。
- **可选独立长期任务**：Extras 中默认停用的 [Long Tasks](packages/long-tasks/README.md)，使用原生 Schedule、独立任务根 Session 和既有通知账本，附带管理工具与 Skill。QQTK 可选重启/12 小时无用户输入换新主 Session，默认关闭。
- **独立分析 Worker**：Worker V2 源码新增 Explore、Librarian、Oracle、Metis、Momus 和按需 Planner；保留 general/review。Character 是唯一 Root，原生独立 Preset/Session、白名单与一级委派；工具/Skills 由原生装配决定，不继承 Root QQ/Memory 授权。能力边界见 [Worker](docs/WORKERS.md)。
- **Memory Inspector**：可选的 DSH 原生「设置 → 记忆管理」页面，网页与桌面共用客户端插件，查看分层记忆、来源、修订与后台任务，按现有治理规则确认、纠错、遗忘和恢复有效元数据。

## 仓库结构

```text
bundles/
  character-core/           # 身份、记忆、QQ 和 Character Preset 的核心装配
  character-extras/         # 自有可选装配，长期任务条目默认停用
packages/
  character-identity/       # Host 身份授权、来源认证、Session 与通知衔接
  character-memory-core/    # 通用记忆引擎及可选人格化策略
  character-memory-tools/   # 通用工具入口，以及 Character 兼容入口
  character-qq-adapter/     # Character 专用 QQ 集成
  character-definition/    # 构建时角色加载器，不是运行时插件
  interaction-policy/      # 可选通用 Agent 交互策略，独立安装和关闭
  memory-inspector/        # 可选原生设置页，复用双端客户端、主题和 Host 认证
  long-tasks/              # 可选独立长期任务、原生 Preset 与 runtime Skill
characters/                # 可公开使用的示例角色
examples/local-agent/      # 不依赖 Character Identity 的接入示例
scripts/                   # 构建、验证、迁移与部署辅助脚本
tests/                     # 单元测试及 DSH 宿主集成探针
docs/                      # 架构、配置、复用与发布记录
```

Core 和 Extras 在同一仓库，分别打包。核心仍为四个 Character 运行插件；Interaction 与 Inspector 是额外可选的通用插件，人格化没有新增插件或第二个数据库。[QQTK](https://github.com/EJYDOvO/harness-qq-toolkit-public) 独立维护，搜索、Bilibili 等第三方插件也不在本仓库内。

## 从哪里开始

| 你的目标 | 阅读入口 |
|---|---|
| 只在普通 DSH Agent 中使用记忆或 QQ | [跨项目复用](docs/REUSE.md) |
| 配置完整 Character、私有角色或功能开关 | [功能管理](docs/MANAGEMENT.md) |
| 理解分层记忆、人格化、预算与遗忘 | [记忆设计与配置](docs/MEMORY-LAYERS.md) |
| 启用本机记忆管理界面 | [Memory Inspector](docs/MEMORY-INSPECTOR.md) |
| 使用基础/专业分析 Worker | [Worker 能力与边界](docs/WORKERS.md) |
| 查看阶段完成状态及后续计划 | [路线图](docs/IMPLEMENTATION_ROADMAP.md) |
| 配置自然交互、等待提示、Streaming 与明确修正 | [Interaction Policy V1](docs/INTERACTION-POLICY.md) |
| 理解依赖、可信接口和数据流 | [架构说明](docs/ARCHITECTURE.md) |
| 准备部署、迁移或回滚 | [集成与恢复](docs/INTEGRATION.md) |
| 判断哪些能力实际验证过 | [当前状态](docs/STATUS.md) |

## 本地开发

**先运行独立测试。** 使用 Node.js 24 或以上，无需安装 npm 依赖，也不会连接 QQ：

```sh
npm test
npm run test:audit
```

宿主探针需要实际 DSH 环境，不能直接当作普通 Node 测试运行。真实模型、QQ 收发和审批验收也不包含在 `npm test` 中。

**构建完整 Character 前，准备宿主依赖。** 当前脚本需要已安装 DSH、desktop Profile 可解析的 `js-yaml`、QQTK 的维护工具及兼容补丁；完整 Core 还会使用 Remote Ops。通用 Memory 的独立接入不需要这些 Character 构建依赖。

在仓库根目录运行，替换路径占位符：

```powershell
$env:DSH_INSTALL_ROOT = '<absolute-path-to-dsh-installation>'
$env:DSH_CHARACTER_PROJECT = (Get-Location).Path
node scripts/build.cjs
```

构建读取本机官方 Creator 配置，生成 Core Bundle，不修改官方发行文件。默认角色来自 `characters/character-a/definition.yaml`；私有角色可用 `DSH_CHARACTER_DEFINITION` 或忽略目录内的 `private/build-config.json` 指定。构建会保留已有 Extras 声明。

生成的 Core 声明可能包含私有角色内容，因此不提交 Git。构建完成不等于安装或部署成功；部署脚本有原实例目录、产物和门禁约定，必须先按目标环境审阅，不能作为通用安装命令直接执行。

## 如何添加可选插件

- **第三方包自带 Bundle**：由原生 `plugin_manager` 安装到当前 Profile，使用该包自己的声明；不要再复制到 Extras。
- **普通插件包或自有可选集成**：安装对应依赖后，在 `bundles/character-extras/cordis.patch.yml` 维护装配声明。当前仅声明默认停用的自有长期任务，不预装搜索或 Bilibili；关闭 Extras 不影响 Core。
- **角色基础能力**：仍由 Core 管理，不在 Extras 创建第二个 QQ Gateway 或替换身份授权。

Character 保留 Creator 的插件管理工具，但安装仍受权限或审批控制。原生安装器没有“写入 Extras”的选项；Extras 是项目维护约定，不是自动转存机制。一个插件只应有一个装配来源。

密钥、Owner 标识和本机参数放私有 Profile。仓库不包含生产配置、聊天、记忆库、备份或运行日志；源码模板与某台机器当前部署状态可能不同，以部署验收记录为准。

## 当前边界

- 人格化默认 Off，启用由可信 Host 配置决定。记忆内容不能改变角色基础设定、ACL 或审批规则。
- L3 默认约 1200、上限约 1500 个**估算 Token**；它是有效 L2 的摘录，不是整轮上下文预算。
- 自动提取依赖可信入口，不扫描全部历史聊天；没有向量检索或主动闲聊。test.13 的 QQ 主 Session 轮换需明确启用，正在进行的任务/审批会延后轮换；既有提醒保留原 Session，不迁移或 Fork 历史。使用前阅读 [配置与恢复](packages/long-tasks/README.md) 及 QQTK 的生命周期说明。
- Self Model 的存储和策略已实现，真实多轮任务形成自身认知的端到端验收仍未完成。工具正常返回不等于任务目标成功。
- 遗忘有来源和近似内容屏障，但原会话、修订和备份可能保留旧内容；不能承诺识别所有改写。
- QQ ready 或发送 API 成功不代表手机实际收件；单元测试通过也不代表生产功能已经验证。

第三方参考与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。修改功能、配置、组件或操作方式时，应在同一改动中同步更新 README 和对应专题文档；区分源码默认、实例配置与实际验证结果。
