# test.8 分层记忆交付记录

> 历史记录；当前状态统一见 [STATUS.md](STATUS.md)，部署与回滚按 [INTEGRATION.md](INTEGRATION.md) 执行。

日期：2026-10-19。源码版本 `0.1.0-test.8`。先完成本地开发、隔离测试和迁移方案；随后用户明确授权“脱敏，推 github，部署”，已完成公开源码推送与生产升级。**生产为 test.8 / Schema 3，健康及真实模型工具验收通过；人格化保持默认 Off。** 手机收件及审批按钮仍未验证。

后续说明：上段 Off 是首次发布时状态，之后经授权改为 Character，见 [当前状态](STATUS.md)。本轮审计发现模式切换、召回和测试门禁缺陷，修复已随 test.9 部署，见 [修复报告](AUDIT-FIXES.md)。下表保留历史结果，但“三模式隔离”没有覆盖同一 Agent 的历史模式切换；旧重启探针只比较 ID，不能单独证明 revision 保持。最终历史 Compaction 产物确实为 verified，门禁缺陷不等于该次压缩失败。

## 实际修改

1. `character-memory-core` 继续复用原 SQLite/FTS5/CAS/治理引擎，新增 LayeredMemory：统一 L1、按 general/user/relationship/self 用途区分 L2、按 Host Agent 投影 L3。没有引入新数据库或向量依赖。
2. 后台流程沿用当前 Host 模型，增加空闲门限、多事件逐字来源校验、输入指纹、重试上限、低频巩固和成功 Compaction 遗漏检查。L3 是本地摘录，不反复调用模型压缩摘要。
3. 人格化默认 Off；Assistant / Character 从 Host 接受稳定 agentId。隔离身份、模式和权限由 Host 决定，模型不能指定另一个 Agent 的作用域。Self 不能修改固定 Persona。
4. 纠错/遗忘/过期退休旧证据、取消其队列、使关联 L2 失效并清除 L3。原有修订与遗忘屏障保留，并增加根作用域屏障，防止已遗忘的人格化内容经手动保存或纠错写回通用 L2。冲突双方排除 L3，等待确认/纠错。
5. Memory Tools 新增 trace/projection/layers_status，旧九个通用工具及 Character 命名兼容。每轮消费改为 L3 + 当前可信话题的 L2；主动 Recall 保留。
6. Character Identity 和本地示例 Provider 只增加可选策略字段。Character QQ Adapter 无代码变更，QQTK 无变更；四插件、Core/Extras、Creator 构建时派生保留。
7. 增加 Schema 3 副本迁移脚本、分层单元测试、真实 DSH 隔离探针，以及 [架构/配置/迁移文档](MEMORY-LAYERS.md)。[SDK 审查](SDK-MEMORY-AUDIT.md) 记录本机官方代码依据。

## 验证证据与范围

环境：Windows、Node 24.21.0、本机 DSH 0.2.0-rc.2。下表为开发阶段隔离验证，使用项目 `test-data` 下的独立 DSH_HOME/数据库，未连接 QQ；后续上线验证单列于文末。原始测试产物留在忽略目录 `artifacts`，不随公开源码上传。

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
| QQ 收发/手机审批/真实通知 | **开发隔离阶段未验证** | 后续上线检查见文末；QQ ready 与 Sender 成功不等于手机收件或按钮回传 |

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

授权上线后，四个运行时插件及 Core/Extras 为 test.8，生产 Memory Schema 为 3。官方 `app.asar` SHA256 与开发前一致：`a2be73b7e34a79d4d2560698e492d9b008a3df5c3f5f099582ef818b100f6d8d`。

开发前源码副本和版本/归档摘要保存在本机 `private/layers-before-1792378081147`，没有公开上传。隔离测试库及日志留在忽略目录用于复核，不作为公开样例。

实际流程：空闲门禁 → 独占维护锁 → 停止旧宿主 → 207 文件离线快照与哈希校验 → 独立 QQ Gateway 验证 → 部署门禁 → 切换候选 Profile → 复制生成 Schema 3 新库并保留旧库 → 启动与健康检查。原记忆逐字段保持一致，QQ Session 路由未改变；单 Owner 私聊、禁群限制保留。

新增上线证据（本机私有产物，不上传正文/标识）：

- `test-results.json`：当前源码摘要重新执行 51/51 单元/确定性测试。
- `generic-memory-host.json`：实际安装本次不可变 tarball，无 Character Identity/QQ/Remote Ops；当前请求的真实 LLM 提取、跨 Session、确认/CAS/遗忘与既有持久记忆恢复通过。初次目录依赖误用旧安装缓存，检查文件哈希后改为本次 tarball 重跑；只采用重跑结果。
- `generic-qq-host.json`：生产停机、维护锁内运行独立 QQ，未装 Character/Remote Ops，Gateway、审批/问答通道、普通 Preset、Session 创建与恢复通过；结束后关闭测试宿主再启动生产。
- `test8-deployment.json`：四插件实际文件与源代码一致，Identity/Memory/QQ/Remote Ops active；新启动日志一次 QQ ready、Schema 3 完整性检查通过、原有记忆和 Session 保留、官方发行文件未变。
- 当前生产 Session 真实模型完成临时记录保存→召回→遗忘→再次召回；报告绑定本次 requestId、事件边界和标记，遗忘后无召回结果。输入来自本地维护 RPC，不作为真实 QQ 用户入站自动提取验收。
- `test8-rollback-rehearsal.json`：用真实 `rollback.cjs` 在隔离目录恢复生产快照副本，旧 test.7 MemoryStore 打开 Schema 2 成功；不是生产降级演练。

维护锁在成功健康检查后释放。收尾发现看门狗状态文件过旧、配置启用但进程未运行；已按既有配置恢复单实例看门狗，并验证状态时间刷新为当前运行，未修改自启动注册或功能配置。人格化 Off 是默认安全配置，通用分层记忆正常工作；没有自动开启 Character 模式、主动聊天或新增 QQ 连接。

回滚入口仍为 `scripts/rollback.ps1`，使用本机 `data/maintenance/character-deploy/candidate.json` 记录的旧 Profile 与 checkpoint。test.7 不支持 Schema 3；回滚必须同时恢复旧插件/配置与迁移前数据库，不能仅降级代码。回滚前先停止/确认空闲并保存新版数据；脚本保留较新记忆库用于后续人工处理，新版数据不会自动逆迁移。不要编辑 schema 版本号规避兼容检查。详见 [迁移步骤](MEMORY-LAYERS.md#schema-3-与迁移回滚)。

公开发布只包含源码、测试与文档：扫描全部 92 个可上传文件、待上传历史、凭据特征及本机真实私有值，无命中；私有角色定义/内部标记、QQ 标识、密钥、聊天、数据库、日志、快照、生成 Bundle 与运行 tarball 均未上传。该检查降低泄漏风险，不宣称能证明任意形式的秘密不存在。
