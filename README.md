# Character Agent V1

面向 DeepSeek Harness 与私人 QQ 助手的 Character Agent 核心测试版。当前源码 `0.1.0-test.8` 在通用 Memory Core/Tools 上增加 L1 经历、跨事件 L2 巩固、L3 投影及 Off / Assistant / Character 模式，仍保留四插件和 Core/Extras。**本轮仅隔离验证，未部署生产。** 见 [分层记忆与迁移](docs/MEMORY-LAYERS.md)、[test.8 验证记录](docs/RELEASE-test8.md)。私有角色配置方式见 [功能管理](docs/MANAGEMENT.md)，跨项目使用见 [复用指南](docs/REUSE.md)，依赖与可信接口见 [架构说明](docs/ARCHITECTURE.md)。

这是经过本机部署验证的部分实现的脱敏源码导出，不是完整 V1，也不是跨版本一键安装器。公开仓库不包含生产配置、QQ 身份、凭据、聊天、记忆数据库、备份、原始执行附件或官方发行文件。

## 组件

| 目录 | 职责 |
|---|---|
| `packages/character-identity` | Owner 私聊身份绑定、可信 Session 上下文、会话映射、持久通知账本与生命周期撤销 |
| `packages/character-memory-core` | 同一 SQLite 中的 L1/L2/L3、FTS5/CAS、可信来源、可选人格化与后台巩固 |
| `packages/character-memory-tools` | 默认入口提供通用记忆工具；character.mjs 保留旧名称、角色提示和 QQ 通知查询 |
| `packages/character-qq-adapter` | 复用原 QQ Gateway、Sender、QQTK，并接入身份服务 |
| `packages/character-definition` | 构建时校验角色 YAML；不是运行时插件 |
| `bundles` | Core/Extras 的包清单；Extras 装配搜索和 Bilibili |
| `characters` | 通用测试角色“澄”，不包含用户个人设定 |
| `scripts` | 构建、隔离验证及原部署流程的脚本 |
| `tests` | 可独立执行的单元测试，以及需要 DSH 的宿主探针 |

## 本地测试

需要 Node.js 24 或以上；单元测试只使用 Node 内置模块，不需要安装依赖，也不连接 QQ。

```sh
npm test
```

`tests/host-probe.mjs` 是 DSH 插件式集成探针，不能当普通 Node 单元测试运行。

## 构建与集成前提

已验证的历史基线为 Windows、DSH `0.2.0-rc.2`、QQ Bot `0.5.2` 及既有版本化 QQTK 补丁；这不是对当前最新版本的声明。适配层依赖 QQTK 的 `qqRemoteOps.attach(runtime)` 接口，单独安装未打补丁的上游 QQ Bot 不保证兼容。

完整 Character 的构建/部署需要已安装的 DSH、Profile 中的 `js-yaml`、QQTK maintenance 工具（包括 `read-asar.cjs`、`ops.cjs`、`local-client.cjs`）、Remote Ops 及兼容补丁。通用 Memory 独立安装不需要这些 Character 构建脚本或 QQ 组件；基本 QQ 接入不需要 Remote Ops。参考 [Harness QQ Toolkit](https://github.com/EJYDOvO/harness-qq-toolkit-public)。历史维护增量仅供比对，不能在当前文件上重复套用。

在 PowerShell 中显式设置本机路径，示例占位符必须替换：

```powershell
$env:DSH_INSTALL_ROOT = '<absolute-installation-path>'
$env:DSH_CHARACTER_PROJECT = (Get-Location).Path
node scripts/build.cjs
```

构建脚本只读提取本机官方 Creator 配置，生成 Core Bundle 和带角色的 Preset。生成的 `bundles/character-core/cordis.patch.yml` 含官方配置，故不随公开仓库分发。构建不会自行下载或安装第二份 DSH 核心。

部署脚本保留原实例的目录约定和门禁，不是通用安装器。它们依赖固定 tgz、候选 Profile、补丁和私有状态。先阅读 [集成与恢复边界](docs/INTEGRATION.md)，为目标机器审阅并适配后才能使用。不要直接重复运行 prepare/deploy 覆盖已存在的同版本产物；本版验证与回滚状态见 [test.7 交付记录](docs/RELEASE-test7.md)。

## 实现边界

- 仅支持单 Owner 私聊，群聊关闭；没有主动闲聊插件。
- 主 Preset 保留 Creator 工具配置，但复杂任务质量与 Token A/B 未完成。
- 当前没有官方独立 Worker Preset，也没有完整的文件/网络沙箱隔离。
- 中文 FTS5 BM25 + 词项相似度/置信度排序，最多返回 20 条；没有 embedding 语义向量检索。
- L3 默认约 1200、上限 1500 个估算 Token；以有效 L2 原文生成投影。人格化默认 Off，由 Host 配置开启，按稳定 Agent ID 隔离；未接入自动任务结果桥接时不会凭空形成 self 经历。
- 自动捕获消费 Identity Provider 的可信入口事件；Character Provider 提供 QQ 原始正文，其他项目可接自己的 Host。使用当前宿主模型后台提取和近重复整理，不扫描历史会话，不把注入上下文或工具输出当用户原话。
- 遗忘阻止相同指纹、同来源及高相似内容复活；修订、备份和原会话仍可能保留内容，低相似改写不能保证全部识别。
- 官方 Schedule 到期与 QQTK 明确事件接入同一账本。sent 仅表示发送 API 返回成功，unknown 不盲目重发；真实收件和异常网络验收见发布报告。
- 角色修改需要重新构建。当前生产仍使用 `personal`；通用 Provider 可配置独立项目与 namespace。没有 Inspector、自动 Session 轮换或跨机迁移。

详见 [实现与测试状态](docs/STATUS.md)、[公开导出检查](docs/PUBLICATION.md) 和 [来源说明](docs/PROVENANCE.md)。
