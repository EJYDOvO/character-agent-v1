# Character Agent V1

面向 DeepSeek Harness 与私人 QQ 助手的 Character Agent 核心测试版。版本 `0.1.0-test.5`。

这是经过本机部署验证的部分实现的脱敏源码导出，不是完整 V1，也不是跨版本一键安装器。公开仓库不包含生产配置、QQ 身份、凭据、聊天、记忆数据库、备份、原始执行附件或官方发行文件。

## 组件

| 目录 | 职责 |
|---|---|
| `packages/character-identity` | Owner 私聊身份绑定、可信 Session 上下文、会话映射、持久通知账本与生命周期撤销 |
| `packages/character-memory-core` | SQLite 长期记忆、作用域过滤、修订/CAS、遗忘、中文 FTS5 和 LLM 后台增量整理 |
| `packages/character-memory-tools` | 保存、检索、纠错、遗忘、检查、确认、合并及队列/通知管理工具 |
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

宿主需要已安装的 DSH、Profile 中的 `js-yaml`、QQTK maintenance 工具（包括 `read-asar.cjs`、`ops.cjs`、`local-client.cjs`）、Remote Ops 插件及其兼容补丁。参考 [Harness QQ Toolkit](https://github.com/EJYDOvO/harness-qq-toolkit-public)，同时审阅本仓库 [Character 维护增量](docs/maintenance-character.patch)；不要在未核对基线时自动应用补丁。

在 PowerShell 中显式设置本机路径，示例占位符必须替换：

```powershell
$env:DSH_INSTALL_ROOT = '<absolute-installation-path>'
$env:DSH_CHARACTER_PROJECT = (Get-Location).Path
node scripts/build.cjs
```

构建脚本只读提取本机官方 Creator 配置，生成 Core Bundle 和带角色的 Preset。生成的 `bundles/character-core/cordis.patch.yml` 含官方配置，故不随公开仓库分发。构建不会自行下载或安装第二份 DSH 核心。

部署脚本保留原版本的固定目录约定、产物版本和门禁，不是通用安装器。它们依赖此前已准备的固定 tgz、候选 Profile、旧补丁和私有状态。先阅读 [集成与恢复边界](docs/INTEGRATION.md)，为目标机器审阅并适配后才能使用。不要直接重复运行 prepare/deploy 覆盖已存在的同版本产物；本版部署与验证状态见 `docs/RELEASE-test5.md`。

## 实现边界

- 仅支持单 Owner 私聊，群聊关闭；没有主动闲聊插件。
- 主 Preset 保留 Creator 工具配置，但复杂任务质量与 Token A/B 未完成。
- 当前没有官方独立 Worker Preset，也没有完整的文件/网络沙箱隔离。
- 中文 FTS5 BM25 + 词项相似度/置信度排序，最多返回 20 条；没有 embedding 语义向量检索。
- 自动捕获只消费可信 QQ 原始正文，使用当前宿主模型后台提取和近重复整理；不扫描历史会话，不把注入上下文或工具输出当用户原话。
- 遗忘阻止相同指纹、同来源及高相似内容复活；修订、备份和原会话仍可能保留内容，低相似改写不能保证全部识别。
- 官方 Schedule 到期与 QQTK 明确事件接入同一账本。sent 仅表示发送 API 返回成功，unknown 不盲目重发；真实收件和异常网络验收见发布报告。
- 角色修改需要重新构建。项目固定 `personal`；没有 Inspector、自动 Session 轮换或跨机迁移。

详见 [实现与测试状态](docs/STATUS.md)、[公开导出检查](docs/PUBLICATION.md) 和 [来源说明](docs/PROVENANCE.md)。
