# 公开源码审计与选择（0.1.0-test.5）

> 历史记录；当前状态统一见 [STATUS.md](STATUS.md)，部署与回滚按 [INTEGRATION.md](INTEGRATION.md) 执行。

审计日期：2026-10-17。以下是固定提交的静态源码审阅；没有运行这些项目的测试套件，也不以项目热度或测试文件存在证明生产可靠性。

| 项目 / 固定版本 | 实际查看的源码 | 能力与兼容性判断 | 许可证 / 选择 |
|---|---|---|---|
| [dsh-ltm](https://github.com/tr1v3r/dsh-ltm/tree/bdc5de489d1f60811232548a5aa3cfd11f20ae49) | `src/tokenize.ts`, `src/schema.ts`, `src/index.ts`, `docs/adr-memory-architecture.md` | 原生 DSH、SQLite/FTS5、修订和字符排序，集成成本最低；ADR 明确其 scope 不是安全隔离，自动提示词读取也不能替代 Owner 授权。默认模型显式保存，并非后台抽取。 | MIT。仅复用中文单字/双字分词，保留完整许可证。不能整体替换本项目 Host Identity/CAS 数据层。 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent/tree/e7e839a5f4298bf98f086dde1ac49fc8de5ecad3) | `agent/memory_manager.py`, `agent/memory_provider.py`, `tools/memory_tool.py`, `tests/agent/test_background_review_memory_scope.py` | provider 生命周期、单后台工作队列、有限等待、上下文清洗、scope 回归测试值得借鉴。Python Agent 运行时和工具契约不同，整体引入将形成第二套主 Agent。 | MIT。借鉴后台任务、来源边界、有限上下文设计；不复制运行时。 |
| [Letta](https://github.com/letta-ai/letta/tree/5bcdd177d70fa2b31a754cfcd801e77b2e1ab16a) / [Letta Code](https://github.com/letta-ai/letta-code/tree/41798e097e15111825da499f939695c19926f6be) | 旧库 README；Code 的 `src/agent/memory-auth.ts`, `memory-conflict-repair.ts`, `memory-filesystem.integration.test.ts` | 当前旧仓库指向 Code。记忆 Git 同步、进程租约和修复 token 防止迟到工作覆盖新状态；有文件系统集成测试。其凭据及同步后端不是 DSH Identity，整套文件/Git 记忆会提高迁移和并发维护成本。 | Apache-2.0。借鉴过期任务不能覆盖新状态；保留 SQLite 事务与 CAS，不引入同步服务。 |
| [OpenClaw](https://github.com/openclaw/openclaw/tree/1a314b89ea9f090917310bb6c35913e093f831d2) | `extensions/memory-core/src/memory/hybrid.ts`, `hybrid.test.ts`；树中存在投递 claim/ack/reply-loss 集成测试 | 混合检索包含向量、文本、MMR、时间衰减和项目排序，功能面明显更广；不是可直接嵌入 DSH 的小库。投递队列具体行为未完整核验，不能据文件名宣称 exactly-once。 | MIT。参考分层检索及明确投递状态；不复制大模块及其 SDK 依赖。 |
| 已安装 QQ / QQTK / Schedule | QQ `dist/gateway/bootstrap.js`, `dist/session/session-manager.js`, `dist/transport/inbound.js`；QQTK `index.js`；DSH ASAR 中的官方 Schedule 和 Agent 接口 | QQ 0.5.2 保留现有补丁与唯一 SDK 连接；QQTK 独立依赖通过运行时回调连接 Identity outbox。Schedule 保持官方实现，监听明确的 schedule 来源事件。测试使用本机实际 rc.2 宿主。 | 外部组件依各自原许可证；不分发官方 ASAR、QQ 包或凭据。QQTK 变更单独提供补丁。 |

## 本版边界

- 保留四插件、Core/Extras 和完整 Creator 派生主 Agent。人格定义只影响表达，记忆只能作为非权威参考。
- 新增自行维护的薄集成：Owner 能力句柄、SDK 入站证据、SQLite 提取队列、grounded JSON 校验、通知账本。现成方案无法直接满足本项目的 Host 授权和单 Owner 限制，因此这部分自研。
- 检索为 FTS5 BM25 + 中文词项相似度 + 置信度排序；不是 embedding 语义检索。向量混合检索仍是可选后续能力，本版未安装模型或向外部 embedding 服务发送记忆。
- 后台整理按新消息增量执行，模型可以建议近重复合并；严格校验拒绝不近似或否定/数字不同的事实。并非全库自治纠错，不把相似度当事实正确性。
- 未运行任何参考项目的完整测试；许可证判断仅针对本次实际读取/复用的固定版本，未来升级需重审。
