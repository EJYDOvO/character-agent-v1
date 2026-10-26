# 在其他 DSH 项目中使用

实例版本统一见 [当前状态](STATUS.md)；源码默认与实例启用状态分开记录。

原通用化验收宿主：DSH 0.2.0-rc.2 / Node 24 / Windows。test.9 在 0.2.1-rc.2 上重新验证通用 Memory 独立身份接入及完整 Character，见 [最新记录](RELEASE-test9.md)；纯 QQ 无 Remote Ops 的独立连接组合本次未重跑。本文件不是跨版本安装保证。不要向 Profile 安装第二套 DSH 核心，保留 `autoInstallPeers: false`。所有示例路径与身份都是占位值。

## 普通 Agent + QQ

只安装 `@tencent-connect/dsh-qqbot@0.5.2`，应用 [QQTK](https://github.com/EJYDOvO/harness-qq-toolkit-public) 的版本化补丁。Profile 加载原生 base/web-app；无需 Character、Remote Ops、项目记忆包。

```yaml
# Profile pnpm-workspace.yaml 的相关部分
nodeLinker: hoisted
autoInstallPeers: false
patchedDependencies:
  '@tencent-connect/dsh-qqbot@0.5.2': patches/dsh-qqbot@0.5.2.patch
```

```yaml
# Profile cordis.patch.yml；由 Host 安全配置提供凭据
- insert:
    - id: ordinary-qq
      name: '@tencent-connect/dsh-qqbot'
      config:
        appId: '<LOCAL_APP_ID>'
        appSecret: '<LOCAL_APP_SECRET>'
        preset: cordis
        cwd: '<ABSOLUTE_PROJECT_PATH>'
        access:
          c2cMode: allowlist
          c2cAllow: ['<LOCAL_OWNER_OPENID>']
          groupMode: disabled
          groupAllow: []
```

不要同时加载 QQ Bundle 又 insert 第二个 QQ 插件。审批/问答由 QQ 自身处理；`/ops` 是可选 Remote Ops 的命令，不影响基本收发。跨进程只启动一套使用该 QQ 应用凭据的 Profile。

补丁把 QQ 偏好放在 `$DSH_HOME/qqbot/model-prefs.json`；请为每个独立项目配置独立 DSH_HOME。不设置 DSH_HOME 时保留上游用户目录以兼容旧安装，可能跨项目共用，不能宣称隔离。升级前核对旧偏好文件是否需要显式迁移；本机旧目录已指向相同 data/qqbot，未搬迁数据。

## 普通 Agent + Memory

用包管理器从本仓库的 `packages/character-memory-core` 和 `packages/character-memory-tools` 安装到自己的 Profile（可先 pack 成固定 tgz）。历史包名保留以方便升级；它们的默认入口已经是通用实现，不需要 Character Identity。

Host 层：

```yaml
- insert:
    - id: local-memory-identity
      name: '<ABSOLUTE_PATH>/examples/local-agent/identity.mjs'
      config:
        principalId: local-owner
        namespaceId: research-assistant
        projectId: research-project-a
        allowedPresetId: research-agent
        agentId: research-agent
        memoryMode: off  # off / assistant / character；由 Host 管理
        l3Tokens: 1200
    - id: generic-memory
      name: dsh-character-memory-core
      config:
        database: '<ABSOLUTE_PROJECT_DATA>/memory.sqlite'
        autoCapture: true
```

在 `research-agent` 的 `config.plugins` 中加入：

```yaml
- id: memory-tools
  name: dsh-character-memory-tools
```

该 Preset 须由原生 DSH 注册/挂载。默认工具名为 `memory_remember`、`memory_recall`、`memory_correct`、`memory_forget`、`memory_inspect`、`memory_confirm`、`memory_merge`、`memory_status`、`memory_retry`。test.8 增加 `memory_trace`、`memory_projection`、`memory_layers_status`。工具参数不接受 principal、namespace、project、Agent ID 或授权标记。升级前阅读 [分层记忆和 Schema 3 迁移](MEMORY-LAYERS.md)，不要把旧版直接指向迁移后的库。

`examples/local-agent/identity.mjs` 是可直接审查的 Host 适配示例。可信入口验证登录/用户之后调用 `localMemoryIngress.admit(actualAgent, evidence)`，不要把它注册为模型工具，也不要把所有 `user/message` 历史事件无差别认定为真人输入。示例确认格式为完整 `confirm:<memory-id>`，必须先由这个可信入口接收。

仅安装 Core/Tools 不会自动找到用户来源。实际 IM/Web/终端入口需要自己的身份适配；真实用户消息、插件注入与工具输出由该入口区分。提取使用 DSH 当前配置的模型，未配置模型不会变成规则提取器冒充成功。

每个项目使用自己的 DSH_HOME、绝对数据库路径和三元作用域。没有默认共用数据库；显式重复指定相同数据库及作用域才会共享，这是管理员配置行为。

test.9 审计修复保留契约 v1、Schema 3 和现有工具参数。Host 的 `onEvidence` 同步更新短期话题，短消息不必永久入库；不要由模型调用这一入口。人格化新记录由 Core 标记形成策略，Assistant 不自动继承 Character/未知模式的旧条目，Character 仍可管理它们。详细模式与确认兼容行为见 [AUDIT-FIXES.md](AUDIT-FIXES.md)，此改动已部署于本机 test.9。

## Character 兼容配置

保持四插件与 Core/Extras。Core 构建将 Tools 挂载为 `dsh-character-memory-tools/character.mjs`，继续提供原有九个 `character_*` 记忆/队列工具及 `character_notifications`。Character Identity 同时提供标准契约和旧服务名。直接引用旧 Tools 默认入口的外部 Profile，应改用这个专用入口；纯通用项目可设置 `toolPrefix: character, legacyQueueNames: true` 保留记忆工具名，但不会获得 QQ 通知或角色提示。

私有 `private/build-config.json` 可配置 `definitionPath`、`presetId`、`dataDirectory`；环境变量 `DSH_CHARACTER_DEFINITION`、`DSH_CHARACTER_PRESET_ID`、`DSH_CHARACTER_DATA_DIR` 可覆盖。先阅读 `scripts/definition-source.cjs` 的解析规则。官方 Creator 内容或构建配置变化后 `ensure-build.cjs` 会重建；重建不是自动上线，必须复验。

本机 `prepare-deploy.cjs` 是现有生产实例的维护适配器，只允许原有 Character ID、qq-character 路由与数据目录。其他项目自行装配 Profile；不要把这个适配器当成通用迁移器。

## 管理、卸载、更新

| 功能 | 开关/管理入口 | 数据处理 |
|---|---|---|
| 自动提取 | Core `autoCapture` | 关闭后保留队列和库；Tools 可继续使用 |
| 通用工具 | Agent Preset 中启停 Tools | 不删除记忆；正在使用的 Session 应安全结束后重载 |
| 授权 | Host Provider 配置 | 更换 scope 不自动迁移/共享旧数据；停用 Provider 不能降级成免授权 |
| QQ | 单个 Profile 插件条目 | 停用先断开，再启动替代实例；保留 Session 和偏好文件 |
| Remote Ops | 独立插件及其 features | 见 QQTK 通用后端文档；维护脚本不是基础 QQ 的安装前提 |
| Character | 构建参数 + Core；Extras 可选 | 角色、代码和运行数据库分开备份；旧运行时兼容验证后保留当前数据库，恢复配置/Profile |

新版本先固定包与补丁哈希、隔离安装/验证，再在空闲和维护锁下切换。test.8 已使用 Schema 3；test.9 审计修复不再升级 Schema。回滚的数据影响以 [实际恢复流程](INTEGRATION.md#回滚) 为准，必须先验证旧运行时兼容当前库；兼容时保留新记录，不自动恢复旧快照。未来 Schema 变化必须单独设计数据兼容策略。

## 可选通用 Interaction

`packages/interaction-policy` 可独立安装到普通 DSH Preset，不需要 Character、QQTK 或 Memory。它使用原生作用域服务、Session/流式事件与 Inbox，平台通过小型 Sender 接口接入。声明必须提供服务隔离域；详见 [安装及契约](../packages/interaction-policy/README.md)。已完成隔离与本机部署检查，Web 额外气泡/状态 UI 未实现。

## 可选组件与 Session（test.13）

四个核心插件保持。通用 QQ 的可选 Session 生命周期仅依赖原生 Host，默认关闭；没有 Character 的稳定会话桥接时，已有 Schedule 会阻止自动轮换以保护提醒。Character Identity 负责保留旧 QQ 根的可信绑定和稳定通知目标。Extras 的 [Long Tasks](../packages/long-tasks/README.md) 是 Character 专用可选集成，不是 Memory/Interaction/QQ 的依赖；默认停用且无工具权限。原生分析 Worker 与 Inspector 的边界分别见 [Worker](WORKERS.md)、[Inspector](MEMORY-INSPECTOR.md)。

test.14 要求 QQTK 的 `isCurrentSession(record)` Host 契约：历史根只有提醒绑定，无完整 Identity/Memory/普通工具，不能以冷恢复或手填 Session 参数提升权限。通用 QQTK 不因此依赖 Character，也不自行提供身份授权。只读存量审计见 [管理说明](MANAGEMENT.md)，当前是否部署见 STATUS。

Worker V2 是 Character 集成层的构建策略：`worker-policy.mjs` 仅含无状态角色/契约文本，`worker.mjs` 只依赖原生 tools 服务。它们不让通用 Memory/QQ/Interaction 依赖 Worker。第三方安全 Preset 可复用该守卫并经 Host 白名单接入；不会自动获得 Character Identity、Memory 或管理权限。Core 声明七个基础角色及可选 review，Extras 仍独立；实际装配与验收边界见 STATUS。

社区 ID 限制修复目前仅在本地源码：支持真实 Preset ID 和可选展示别名，构建保留声明但只将真实 ID 交给原生 Spawn。不会复制外部声明或自动安装；身份、工具和权限审查边界不变，详见 [Worker](WORKERS.md)。
