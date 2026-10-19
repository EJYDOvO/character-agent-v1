# test.8 分层记忆交付记录

日期：2026-10-19。源码版本 `0.1.0-test.8`。**完成本地开发、隔离测试和迁移方案；没有生产部署、生产数据库迁移或真实 QQ 操作。** 生产安装包仍为 `0.1.0-test.7`。

## 实际修改

1. `character-memory-core` 继续复用原 SQLite/FTS5/CAS/治理引擎，新增 LayeredMemory：统一 L1、按 general/user/relationship/self 用途区分 L2、按 Host Agent 投影 L3。没有引入新数据库或向量依赖。
2. 后台流程沿用当前 Host 模型，增加空闲门限、多事件逐字来源校验、输入指纹、重试上限、低频巩固和成功 Compaction 遗漏检查。L3 是本地摘录，不反复调用模型压缩摘要。
3. 人格化默认 Off；Assistant / Character 从 Host 接受稳定 agentId。隔离身份、模式和权限由 Host 决定，模型不能指定另一个 Agent 的作用域。Self 不能修改固定 Persona。
4. 纠错/遗忘/过期退休旧证据、取消其队列、使关联 L2 失效并清除 L3。原有修订与遗忘屏障保留，并增加根作用域屏障，防止已遗忘的人格化内容经手动保存或纠错写回通用 L2。冲突双方排除 L3，等待确认/纠错。
5. Memory Tools 新增 trace/projection/layers_status，旧九个通用工具及 Character 命名兼容。每轮消费改为 L3 + 当前可信话题的 L2；主动 Recall 保留。
6. Character Identity 和本地示例 Provider 只增加可选策略字段。Character QQ Adapter 无代码变更，QQTK 无变更；四插件、Core/Extras、Creator 构建时派生保留。
7. 增加 Schema 3 副本迁移脚本、分层单元测试、真实 DSH 隔离探针，以及 [架构/配置/迁移文档](MEMORY-LAYERS.md)。[SDK 审查](SDK-MEMORY-AUDIT.md) 记录本机官方代码依据。

## 验证证据与范围

环境：Windows、Node 24.21.0、本机 DSH 0.2.0-rc.2。测试使用项目 `test-data` 下的独立 DSH_HOME/数据库；未连接 QQ。原始测试产物留在忽略目录 `artifacts`，不随公开源码上传。

| 验证 | 结果 | 证据/限定 |
|---|---|---|
| 全部单元/确定性测试 | **51/51 通过** | 原有 32 项 + 分层 19 项；运行 `node --test tests/*.test.mjs` |
| L1 可信入口、去重、来源冲突 | 已验证 | 真宿主的 localMemoryIngress；另有伪造句柄、错误 origin、错误 Session、ID 碰撞测试 |
| 真实模型提取 | 已验证 | 最终模型运行收到本次两条输入，各完成 1 次提取，各保存 1 项；不是只看 API 返回成功 |
| 多事件 L2 | 已验证（样例） | 同一运行产生 1 项巩固记忆，关联本次 Session 的两份不同 L1；引文、状态与来源关联检查通过 |
| L3 与跨 Session 上下文 | 已验证 | 原生 systemPrompt 组装确实包含可信 L3；预算、中文/Emoji、无切断、修订/遗忘刷新有确定性测试 |
| 三种模式 | 已验证接口和隔离 | Off/Assistant/Character 均实际加载原生宿主与 12 工具；人格化 lane 和策略用确定性测试覆盖；Assistant 的真实模型归纳质量未单独评测 |
| 身份/用户/角色/项目/Agent 隔离 | 已验证接口防护 | 独立 scope、克隆句柄、变更模式、跨 Agent get/trace/recall/projection 拒绝/隔离；不代表恶意同进程 Host 插件沙箱 |
| 实际 Host 重启 | 已验证 | 同一 SQLite 重开后原 L2 ID 和修订保持，工具及上下文重新可用；不是只重建内存 mock |
| 原生 Compaction | **已验证** | 真 `/compact` 命令、真模型摘要、原生成功 end、L1 遗漏 checkpoint；摘要/测试注入文本没有被当作新 L1 |
| 纠错/遗忘/过期 | 已验证 | CAS、旧来源拒绝、退休证据、取消队列、L2/L3 失效、等待模型时发生变更拒绝提交 |
| Schema 2→3 和回滚材料 | 已验证隔离副本 | backup API 复制后迁移，源文件字节不变、完整性/条数一致、拒绝覆盖，原 Schema 2 可继续打开 |
| Character Core-only | **10/10 通过** | 真 Creator 派生、原生工具/Scope/Context/Schedule；Sender 是隔离模拟，不是手机投递 |
| Character Core+Extras | **10/10 通过** | 同上，Extras 实际加载；QQ/Remote Ops 禁用，没有新增 QQ 连接 |
| QQ 收发/手机审批/真实通知 | **本轮未验证** | 本轮禁止生产部署，未用真实 QQ 测试替代隔离验证；沿用 test.7 已部署版本 |

最终核心运行时与验证源摘要：`221b9ac5b9b90f6c59d56c5eba26eaf3abe5bc83a38a68c0e570af76350825fe`。该摘要包含脚本、测试、包和本机有效定义，不含普通 docs 编辑；不公开私有定义内容。

最终实际模型/压缩运行：`82cb66a9-92a7-49e5-aa91-f1727ba63f1c`，保存为 `artifacts/layered-host-character-model.json`。同库实际重启运行：`b41c1e4f-1935-49f4-a286-c69ebb9cc0a4`，保存为 `artifacts/layered-host-character-restart.json`。Character 报告为 `artifacts/host-probe-core-layered.json`、`artifacts/host-probe-extras-layered.json`。探针用本次 runId、Session、来源和时间约束，不能用上一轮结果通过当前提取验收。

初轮探针曾因安装缓存缺少新文件、SDK 模块解析路径、缺少 surfaceOp 和 Preset 内 compaction 服务隔离失败。均修正测试适配后重跑；本表采用最终真实宿主成功结果，未将早期 BLOCKED 当成功。

## 已知限制、部分完成与未验证

- **自我认知链路部分验证**：原生 tool/call→tool/result→turn/end 的配对元信息入口与 self 策略已实现并做确定性测试；真实模型连续执行任务并从用户反馈形成 self 认知尚未端到端验证。只记录调用返回状态，不承诺任务成败语义；QQTK/Schedule 的专用语义事件桥接未新增。
- L3 预算是保守估算，不是当前模型 tokenizer 的精确计数；默认 1200、上限 1500 约束估算值。
- 多事件逐字引文不等于语义蕴含证明。0.8 是支持等级而非概率；LLM 仍可能归纳错误，需使用 inspect/trace/correct/confirm/forget 治理。
- 跨事件整理窗口为最近 40 条有效 L1；压缩遗漏检查的工具元信息回看 400 个事件。没有全库多年聚类或历史聊天回扫。
- 同一经历被纠错/遗忘/过期时，其他依赖它的推断也会保守失效。未做句子级证据切分；修订、原 Session 和备份可能仍留有内容。
- 实际重启验证是空闲重启；提取/巩固中断恢复由数据库状态测试覆盖，未做真实提供方请求中的断电/强杀网络测试。
- 尚未做长期高并发、多进程共享同库、跨平台、跨机器或大量历史数据压力验证。每个库应只有一个 Core Host 实例。
- 未实现新的 UI、向量索引、独立 Worker、主动聊天或自动 Skills。

## 部署与回滚状态

本轮未运行生产部署/重启/迁移；本机生产 Memory 包核对仍为 test.7。官方 `app.asar` SHA256 与开发前一致：`a2be73b7e34a79d4d2560698e492d9b008a3df5c3f5f099582ef818b100f6d8d`。

开发前源码副本和版本/归档摘要保存在本机 `private/layers-before-1792378081147`，没有公开上传。隔离测试库及日志留在忽略目录用于复核，不作为公开样例。

未来上线必须另行授权。先空闲与备份，再用 `scripts/migrate-memory.mjs` 生成新库，验证后切换。test.7 不支持 Schema 3；回滚必须同时恢复旧插件/配置与迁移前数据库，不能仅降级代码。新版切换后产生的数据不会自动逆迁移，不能以删版本号方式规避。详见 [迁移步骤](MEMORY-LAYERS.md#schema-3-与迁移回滚)。
