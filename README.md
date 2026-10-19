# Character Agent V1

在 DeepSeek Harness 上运行的角色 Agent 扩展，提供私人 QQ 接入、可配置角色和带来源的长期记忆。Character 从官方 Creator Preset 构建派生，保留其工具能力；角色设定不会增加系统权限。

这是测试版源码仓库，不包含 DSH 本体，也不是一键安装器。当前 test.10 已部署于 **Windows、Node.js 24.21.0、DSH 0.2.1-rc.2、QQ Bot 0.5.2 及配套 QQTK 补丁**。部署检查和隔离验证通过；真实消息验收范围见 [发布记录](docs/RELEASE-test10.md)。其他版本和平台需要重新验证。

test.10 新增可选 [Interaction Policy V1](docs/INTERACTION-POLICY.md)：自然表达、等待提示、流式气泡与安全修正。源码默认构建不启用；当前实例已显式开启。该通用插件不要求安装 Character 或 QQ。

## 能做什么

- **角色配置**：通过 YAML 定义身份、表达方式、背景和边界，构建为完整 Character Preset。
- **私人 QQ 助手**：复用 QQTK 的 Gateway、Session、问答和审批；仅允许单 Owner 私聊，群聊关闭。
- **长期记忆**：SQLite + 中文 FTS5，支持保存、召回、检查、纠错、确认、合并、遗忘和来源追溯。
- **分层整理**：L1 保存可信经历，L2 提取和巩固长期记忆，L3 为每轮对话提供少量核心记忆；L0 沿用 DSH Session 与 Compaction。
- **可选人格化**：Off / Assistant / Character 三种模式，与通用记忆共用数据库，按 Agent 隔离；模式切换同时约束历史记录读取。形成带引用的用户画像、互动约定和自身经验，不修改固定角色设定；引用存在不代表推断一定正确。
- **提醒与维护集成**：复用官方 Schedule 和独立 QQTK，记录明确任务通知的投递状态。

## 仓库结构

```text
bundles/
  character-core/           # 身份、记忆、QQ 和 Character Preset 的核心装配
  character-extras/         # 空的可选装配模板，留给项目自己的额外集成
packages/
  character-identity/       # Host 身份授权、来源认证、Session 与通知衔接
  character-memory-core/    # 通用记忆引擎及可选人格化策略
  character-memory-tools/   # 通用工具入口，以及 Character 兼容入口
  character-qq-adapter/     # Character 专用 QQ 集成
  character-definition/    # 构建时角色加载器，不是运行时插件
  interaction-policy/      # 可选通用 Agent 交互策略，独立安装和关闭
characters/                # 可公开使用的示例角色
examples/local-agent/      # 不依赖 Character Identity 的接入示例
scripts/                   # 构建、验证、迁移与部署辅助脚本
tests/                     # 单元测试及 DSH 宿主集成探针
docs/                      # 架构、配置、复用与发布记录
```

Core 和 Extras 在同一仓库，分别打包。核心仍为四个 Character 运行插件；Interaction 是额外可选的通用插件，人格化没有新增插件或第二个数据库。[QQTK](https://github.com/EJYDOvO/harness-qq-toolkit-public) 独立维护，搜索、Bilibili 等第三方插件也不在本仓库内。

## 从哪里开始

| 你的目标 | 阅读入口 |
|---|---|
| 只在普通 DSH Agent 中使用记忆或 QQ | [跨项目复用](docs/REUSE.md) |
| 配置完整 Character、私有角色或功能开关 | [功能管理](docs/MANAGEMENT.md) |
| 理解分层记忆、人格化、预算与遗忘 | [记忆设计与配置](docs/MEMORY-LAYERS.md) |
| 配置自然交互、等待提示、Streaming 与明确修正 | [Interaction Policy V1](docs/INTERACTION-POLICY.md) |
| 理解依赖、可信接口和数据流 | [架构说明](docs/ARCHITECTURE.md) |
| 准备部署、迁移或回滚 | [集成与恢复](docs/INTEGRATION.md) |
| 判断哪些能力实际验证过 | [当前状态](docs/STATUS.md) · [test.9 验证记录](docs/RELEASE-test9.md) |

test.9 包含 [test.8 审计修复](docs/AUDIT-FIXES.md)：修正模式读取、跨用途召回/冲突、短消息话题、L3 选择与测试门禁。DSH 升级适配、真实宿主测试和回滚边界见 [test.9 记录](docs/RELEASE-test9.md)。

## 本地开发

**先运行独立测试。** 使用 Node.js 24 或以上，无需安装 npm 依赖，也不会连接 QQ：

```sh
npm test
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
- **普通插件包或自有可选集成**：安装对应依赖后，在 `bundles/character-extras/cordis.patch.yml` 维护装配声明。当前模板为 `[]`，不预装搜索或 Bilibili。
- **角色基础能力**：仍由 Core 管理，不在 Extras 创建第二个 QQ Gateway 或替换身份授权。

Character 保留 Creator 的插件管理工具，但安装仍受权限或审批控制。原生安装器没有“写入 Extras”的选项；Extras 是项目维护约定，不是自动转存机制。一个插件只应有一个装配来源。

密钥、Owner 标识和本机参数放私有 Profile。仓库不包含生产配置、聊天、记忆库、备份或运行日志；源码模板与某台机器当前部署状态可能不同，以部署验收记录为准。

## 当前边界

- 人格化默认 Off，启用由可信 Host 配置决定。记忆内容不能改变角色基础设定、ACL 或审批规则。
- L3 默认约 1200、上限约 1500 个**估算 Token**；它是有效 L2 的摘录，不是整轮上下文预算。
- 自动提取依赖可信入口，不扫描全部历史聊天；没有向量检索、管理 UI、独立 Worker Preset、自动 Session 轮换或主动闲聊。
- Self Model 的存储和策略已实现，真实多轮任务形成自身认知的端到端验收仍未完成。工具正常返回不等于任务目标成功。
- 遗忘有来源和近似内容屏障，但原会话、修订和备份可能保留旧内容；不能承诺识别所有改写。
- QQ ready 或发送 API 成功不代表手机实际收件；单元测试通过也不代表生产功能已经验证。

第三方参考与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。修改功能、配置、组件或操作方式时，应在同一改动中同步更新 README 和对应专题文档；区分源码默认、实例配置与实际验证结果。
