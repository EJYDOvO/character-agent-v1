# D 阶段检索技术审计（TECH_AUDIT）

- 审计对象：`EJYDOvO/character-agent-v1` `main` @ `542738b`（Character 0.1.0-test.36，Memory Schema 3）
- 审计日期 / 外部资料核查日期：2026-11-17（下文所有链接均在该日核查）
- 运行环境：Windows 11、Node.js v24.13.0（内置 SQLite 3.50.4，含 FTS5）
- 本文件在任何对照实验运行**之前**完成。第 4、5 节的判断是待验证的假设，实验结论见 `REPORT.md` 与 `RECOMMENDATION.md`；两者不一致时以实验为准。
- 研究边界：只读源码与合成数据；未读取生产 Memory，未启动生产 Host / QQTK / QQ Gateway，未改动运行时代码。

---

## 1. 当前实现审计

### 1.1 检索入口与数据流

L2 检索只有一个实现（`LayeredMemory.recall`，`packages/character-memory-core/layered.mjs:207`），但有四个调用方，查询形态差别很大：

| 调用方 | 位置 | 查询来源 | 预算 |
|---|---|---|---|
| 每轮自动上下文 `context()` | `layered.mjs:383` | **用户原始消息**前 200 字符（`noteInput`，`layered.mjs:109`）；少量追问会拼接 5 分钟内的上一话题 | 渲染后约 5000 字符，最多 20 条，先排除 L3 已含条目 |
| 主动工具 `*_recall` | `character-memory-tools/index.mjs:19` | 模型自己写的查询（通常是短关键词/短语） | 默认 2400 字符，最多 20 条 |
| 自动提取的已有记忆查重 | `extraction.mjs:16` | 证据正文前 200 字符 | 8000 字符 |
| 跨事件巩固查重 | `layered.mjs:328` | 候选陈述前 200 字符 | 16000 字符 |

要点：**最频繁的调用（每轮自动上下文）使用的是口语化整句，而不是关键词查询**。现有 `tests/fixtures/recall-corpus.mjs` 的 14 条查询全部是关键词式（如 `隔离环境 回滚点`），没有覆盖这一主路径。

### 1.2 切词与索引

- `tokenize.mjs`：拉丁/数字/下划线连续串整体小写成一个词；CJK（汉字、平假名、片假名）连续串输出**全部单字 + 全部相邻二元组**；其余字符是分隔符。无停用词、无词干化、无词典分词。
- `store.mjs:6-7`：文本先 NFKC + 小写，再 `new Set(...)` **去重**。
- `store.mjs:42,50`：`memory_fts(id UNINDEXED, tokens)`，默认 `unicode61` tokenizer；写入的是去重后空格拼接的 token 串。`snapshot()` 在同一事务里重建该行，所以 FTS 是**同步、事务一致**的派生索引；`forgotten`/`merged` 行从索引删除，过期行仍在索引中、由 SQL 谓词过滤。
- 全库共用一张 FTS 表：BM25 的 N、df、avgdl 统计覆盖数据库内所有主体/命名空间/用途（不泄露内容，但排序统计不是按作用域计算的）。

探针 P1（`src/audit-probes.mjs`，真实 `LayeredMemory`）：正文中出现 5 次的“回滚”在索引里只有 1 个 token ⇒ **词频恒为 1**，BM25 实际退化为“IDF 求和 × 文档长度归一”。对短事实这是合理的，但长记录没有任何词频优势，只有长度惩罚。

### 1.3 查询构造

`recallTerms`（`store.mjs:8`）：查询 ≤200 字符 → 同样切词去重 → **只取前 64 个 token** → 每个 token 加引号后用 `OR` 连接（`layered.mjs:87-89`）。

- 全 OR 语义：与查询共享**任意一个** token（包括单个汉字“我/的/是”）的记忆都成为候选。
- 探针 P2：一条 54 字的中文整句产生 100 个唯一 token，保留的 64 个是 **48 个单字 + 16 个二元组**；句子后半部分的关键二元组（“回滚”“隔离”）被截掉。原因是每个 CJK 连续串先输出全部单字、再输出二元组，截断优先保留了区分度最低的单字。**这是一个与 FTS5 本身无关、可以零依赖修复的缺陷。**
- 无词干化：`bicycles` 找不到 `bicycle`（探针 P4）。
- 无同义/跨语言桥：`远足`→`徒步`、`cycling`→`bicycle`、`rollback snapshot`→`回滚点` 均为空或只命中同语言记录（探针 P4）。单字重叠偶尔能充当“穷人的同义词”（`黑咖啡` 命中 `美式咖啡`），这是保留单字的真实收益。

### 1.4 排序

`relevance`（`store.mjs:10`）= `整句子串命中 ? +2 : 0` + `Jaccard(query, statement)` + `confidence × 0.1` − `bm25`，按此在 JS 中对**全部候选**排序（`layered.mjs:210`），同分按 id。

- 三个量纲不同的分数直接相加：BM25 无上界（探针 P5 中为 2.99–4.87，语料越大越高），子串加分固定 2，Jaccard ≤ 1。子串加分只对很短的关键词查询生效，对整句查询几乎从不触发。
- 没有时间/新近度、没有来源种类、没有“相关性下限”：只要是候选且预算允许就返回。
- SQLite FTS5 的 bm25 对出现在半数以上文档中的词把 IDF 钳到 1e-6（k1=1.2、b=0.75 硬编码，见 [FTS5 文档](https://www.sqlite.org/fts5.html)），所以常见单字基本不贡献分数——但它们仍然把无关记忆**拉进候选集**。

### 1.5 上下文预算

`recall`（`layered.mjs:207-215`）：按排序依次取，单条 `JSON.stringify(render(row)).length` 累加不超过 `min(16000, budget)`，超预算的条目被跳过（继续尝试更短的），最多 20 条；同文去重。自动上下文预算 5000 字符。

- 短事实（几十字 + 约 120 字符 JSON 外壳）下，5000 字符通常能装 20–30 条，**实际生效的上限是 20 条**，不是字符预算。
- 单条上限 2000 字符的长记录会占掉 40% 预算，但不会被截断正文。
- 没有相关性阈值意味着：只要有候选，上下文总会被填到 20 条或预算上限——**对“库里根本没有相关记忆”的问题，系统仍会注入一批弱相关条目**。这是噪声问题，不是召回问题。

### 1.6 ACL、来源、冲突、修订、遗忘、过期

这些全部在 SQL 谓词或读取路径中强制，检索只是其上的一个筛选：

| 机制 | 实现 | 对新检索方案的约束 |
|---|---|---|
| 可信身份 / ACL | `scope()`（`store.mjs:60`）由 Host `authorize(handle, action)` 给出 `{principal, namespace, project}`；`#selection`（`layered.mjs:74`）把可见用途 lane 展开为 SQL 条件 | 任何候选源都只能产出 ID，必须回到这组谓词复核；相似度不能参与授权 |
| 人格化用途隔离 | `@layer3:<hash>` 命名空间 + WeakMap 能力句柄（`layered.mjs:47-53`）；assistant 模式还要求 `memoryPolicy` 标记与内容规则 | 向量索引不能按“全库最近邻”返回；必须先限定到当前可见集合 |
| 来源 / 证据 | `memory_evidence` 关联 L1；任一关联 L1 退休则该 L2 失效（`#valid`，`layered.mjs:201`；SQL 中的 `retired` 子句） | 派生索引里的条目可能在事实源中已失效，必须按查询时刻复核 |
| 修订 / CAS | `revision` 递增 + `revisions` 快照；`correct` 原位改写并把旧指纹写入 `blocked` | 派生索引必须绑定 `revision` 与内容哈希，否则会按旧正文排序 |
| 冲突 | `claim_key` 相同的不同事实互标 `conflict_with`，不进 L3（`#conflicts`，`layered.mjs:93`） | 检索不负责判定真伪；冲突条目照常返回并带标记 |
| 遗忘 | 正文清空、FTS 行删除、指纹 `blocked`、近似词项 `tombstones`、来源 `forgotten_sources`、关联 L1 退休清空（`store.mjs:96`，`layered.mjs:174`） | 向量是正文的有损副本，遗忘时必须删除；且不得从向量或缓存重建 |
| 过期 | `expires_at` 谓词 + `expire()` 主动退休（`layered.mjs:216`） | 同上，按查询时刻复核 |

**结论：现有架构天然支持“任意候选源 → 统一有效性闸门 → 排序 → 预算”这一形态**，闸门就是 `#rows` 的那组谓词。新增候选源不需要、也不应该改动这组谓词。

### 1.7 瓶颈分类

把“召回不好”拆成四类，逐一对照源码与探针：

| 类别 | 是否存在 | 证据 | 归因 |
|---|---|---|---|
| ① 候选召回不足 | **是，且是主因** | 探针 P4：无共同词面的同义表达、形态变化、跨语言查询得到空集或错语言结果；现有评测里两条 `disjoint-synonym` 是唯二的失败 | 词面匹配的固有限制，**不是 FTS5 或 BM25 的缺陷**，换任何纯词面引擎都一样 |
| ② 候选在、排序错 | 部分存在 | 探针 P2（长句截断丢失关键二元组）；现有文档记录“背景语料下 R@1 0.714→0.571” | 截断顺序缺陷 + 整句查询里的功能词噪声 + 三种量纲相加 |
| ③ 预算截断 | 基本不存在 | 20 条上限对短事实足够宽；现有评测 R@5 与无上限召回相同 | 不是当前瓶颈；但“无阈值填满”带来噪声 |
| ④ 记忆本身缺失 | 存在但不属检索 | 自动提取只保留模型判定“值得跨会话保留”的事实，且短于 8 字符的输入不入 L1 | 属于形成（formation）质量，`evaluation/memory-v1` 的范畴；本研究用“无相关结果”查询单独度量检索侧的误召回，不把它算作检索失败 |

另外两个不属于“召回率”但会被检索方案影响的问题：

- **噪声**：整句中文查询的候选集≈所有共享任一单字的记忆，全部物化到 JS 排序（test.32 的“选择性物化”优化对口语化中文查询不成立），延迟随库规模线性增长，且上下文被弱相关条目填满。
- **评测覆盖**：现有 14 条查询没有整句查询、跨语言、否定/困难负例、权限隔离内的近似重复等类别，0.857 的 R@5 不能代表主路径。

---

## 2. 外部技术调查

标注说明：**[宣称]** = 项目/厂商自述；**[论文]** = 作者在论文中报告的基准；**[独立]** = 非利益相关方的复现或评测；**[文档]** = 官方文档描述的机制（非效果声明）。

### 2.1 Agent Memory 项目

| 项目 | 检索机制 | 效果证据 | 对本项目的启示 |
|---|---|---|---|
| **Mem0**（OSS v3） | [文档] 语义向量为唯一候选源，BM25 与实体匹配只做重排加分（“BM25 is a boost signal, not a recall expander”）；三路分数归一后合成；rerank 默认关闭；**OSS 版移除了图存储**（约 4000 行）。依赖：向量库（15 种之一）+ embedder + spaCy（实体/词形还原，仅 Python 3.10–3.12）。来源：[Mem0 v2→v3 迁移文档](https://docs.mem0.ai/migration/oss-v2-to-v3.md) | [宣称] LoCoMo 71.4→91.6、LongMemEval 67.8→93.4（同一页面）。与 Zep 互相质疑对方的基准实现（[Zep 的反驳](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)、[Mem0 的基准文章](https://mem0.ai/blog/ai-memory-benchmarks)），数字不可直接比较 | 成熟项目自己把图检索从开源版里拿掉了；它的“向量为主、词面加分”与本项目“词面为主”正好相反，说明哪一路做主候选取决于数据形态，不是定论 |
| **Zep / Graphiti** | [论文] 余弦相似 + BM25 + 图广度优先三路检索；重排器可选 RRF、MMR、episode-mentions、节点距离、cross-encoder；双时间线（`t_valid`/`t_invalid` 与事务时间），新事实通过 LLM 判定使旧边失效；embedding 与 rerank 用 BGE-m3。来源：[arXiv 2501.13956](https://arxiv.org/abs/2501.13956) | [论文] LongMemEval gpt-4o 60.2%→71.2%；**但 single-session-assistant 94.6%→80.4%、gpt-4o-mini 下 knowledge-update 76.9%→74.4% 变差** | 时间有效性靠写入期的失效标记解决，不靠检索期排序。本项目已有 `correct`/`expires_at`/`claim_key`，属于同一思路的轻量版；图遍历需要图数据库和写入期实体抽取，成本与现有 SQLite 单文件形态不匹配 |
| **Letta（MemGPT）** | [文档] archival memory 为语义检索，支持标签过滤（[archival search 文档](https://docs.letta.com/guides/agents/archival-search)）；搜索结果摘要称其混合检索用 RRF 融合，本次未能在官方页面逐字核实该点 | [宣称] 把 LoCoMo 对话直接放进文件、只给文件工具的 agent 得 74.0%（GPT-4o mini），高于 Mem0 论文报告的最佳图变体 68.5%（[Letta 博客，2025-08-12](https://www.letta.com/blog/benchmarking-ai-agent-memory)） | Letta 自己的结论是：agent 能否迭代地发起检索，比底层是图还是向量更重要。本项目已有主动 `recall` 工具，可多次改写查询——这本身就是一种零成本的“查询改写” |
| **LongMemEval**（基准） | [论文] 把长期记忆拆成索引—检索—阅读三段；提出**事实增强键扩展**（索引时把抽取出的事实并入检索键）与**时间感知查询扩展**。来源：[arXiv 2410.10813](https://arxiv.org/abs/2410.10813) | [论文] 事实增强键扩展：recall@k 平均 +9.4%、最终准确率 +5.4%；时间感知查询扩展对时间推理题 recall +6.8%～11.3%，但用弱模型（Llama 8B）抽取时间范围时反而下降 | **索引侧扩展**被独立基准验证有效，而且本项目写入期本来就有一次 LLM 提取调用，可以顺带产出别名/译名。查询侧模型扩展的质量强依赖模型能力 |

对基准的总体判断：LoCoMo 上“全上下文”基线约 73%，高于若干记忆系统的自报成绩（见上文 Letta 与多篇二手评述），各家数字使用不同模型和评分脚本，**不能作为选型依据**。本研究只采信机制描述，效果以自建对照实验为准。

### 2.2 检索系统

| 系统 | 相关机制 | 对本项目的适配性 |
|---|---|---|
| **Qdrant** | [文档] Query API 的 prefetch 多路候选 + 融合：RRF（默认；k 自 v1.16 可配，加权 RRF 自 v1.17）与 DBSF；官方建议“有评测集就在训练/验证划分上调加权 RRF，没有就用默认 RRF”，并警告未归一化的线性加权不可靠（[hybrid queries](https://qdrant.tech/documentation/concepts/hybrid-queries/)） | 需要独立服务进程或嵌入式 Rust 库；为几千条短记忆引入不划算。其融合建议可直接借鉴 |
| **Weaviate** | [文档] 混合检索两种融合：`rankedFusion`（基于名次）与 `relativeScoreFusion`（min-max 归一后加权，v1.24 起默认）；alpha 默认 0.75 偏向向量（[hybrid search](https://docs.weaviate.io/weaviate/concepts/search/hybrid-search)） | 同样是独立服务。说明业界对“名次融合 vs 归一化分数融合”没有统一答案 |
| **LanceDB** | [文档] 嵌入式；混合检索默认 `RRFReranker`，另有 `LinearCombinationReranker`（默认权重 0.7 偏向向量）（[hybrid search](https://docs.lancedb.com/search/hybrid-search)、[RRF](https://docs.lancedb.com/reranking/rrf)） | 嵌入式、有 Node 绑定，但会成为第二个存储引擎与第二份事实副本，违背“SQLite 是唯一事实源” |
| **sqlite-vec** | [文档] SQLite 扩展，`vec0` 虚表做 KNN；当前 npm 稳定版 0.1.9（2026-03-31），文档站标注 0.1.10-alpha.4，仍是 pre-1.0（[项目文档](https://alexgarcia.xyz/sqlite-vec/)、[npm 元数据](https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/sqlite-vec)） | Node 24 的 `node:sqlite` 支持 `loadExtension`，但必须在构造时 `allowExtension:true`（[Node 文档](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)），即要改 Memory Core 打开数据库的方式并随包分发三平台原生库。对几千条向量没有必要 |
| **SQLite 官方 vec1** | [文档] sqlite.org 自己的 ANN 扩展（IVFADC + OPQ），2026-07 论坛帖称 0.7 版、“测试不足”（[vec1 文档](https://sqlite.org/vec1/doc/trunk/doc/vec1.md)、[论坛](https://sqlite.org/forum/forumpost/9fea7e0fbb6ddd2f)）；有二手报道称 2026-09-30 并入主干，未能在 sqlite.org 核实 | 面向需要训练的大规模静态数据集；与小型、频繁更正的记忆库不匹配。未来若随 Node 内置 SQLite 提供，可重新评估 |

规模判断：单个作用域的长期记忆是 10²–10⁴ 条短文本。1 万条 × 1024 维 float32 = 41 MB，纯 JS 点积全扫描是毫秒级（实验中实测）。**ANN、向量数据库、SQLite 向量扩展解决的是百万级问题，这里不存在。** 精确搜索还顺带消除了 ANN 的召回损失与“先 ANN 后过滤”的权限隐患。

### 2.3 FTS5 / BM25 优化与 Query Expansion

- **中文切词**：FTS5 内置 `trigram` 要求查询至少 3 个字符，而中文词多为 2 字（[FTS5 文档](https://www.sqlite.org/fts5.html)）；词典分词（如 [wangfenjin/simple](https://gitee.com/gpress/simple)、jieba、lindera）需要原生扩展和词典。现有的“单字 + 二元组预切词”是无依赖方案里合理的一种，[社区实践](https://dev.to/foxck016077/sqlite-fts5-wont-tokenize-chinese-heres-the-7-line-bigram-fix-that-did-4fcc)也采用同样做法。本次未找到这几种切词在短中文文本上的公开对照评测。
  - 审计新发现的零依赖选项：Node 24 自带 ICU，`Intl.Segmenter('zh', {granularity:'word'})` 可做词典级分词，无需任何原生扩展。列入实验。
- **查询扩展（查询侧）**：query2doc 报告在 MS MARCO / TREC DL 上使 BM25 提升 3%–15% [论文]（[arXiv 2303.07678](https://arxiv.org/abs/2303.07678)）；HyDE 用假想文档的向量替代查询。代价是每次查询多一次 LLM 调用（延迟、费用），且效果随模型能力下降；另有研究质疑其收益部分来自 LLM 记忆中的知识泄漏（[arXiv 2504.14175](https://arxiv.org/abs/2504.14175)）。对个人记忆库，LLM 并不知道用户的私有事实，“假想答案”帮不上忙，能帮上的只有同义词与译名。
- **文档扩展（索引侧）**：doc2query 系列与 LongMemEval 的事实增强键扩展属同类；Anthropic 的 Contextual Retrieval 在索引前给每个片段加 LLM 生成的上下文，top-20 检索失败率 5.7%→3.7%（仅 embedding）→2.9%（加 contextual BM25）→1.9%（加 rerank）[宣称，厂商自测]（[Anthropic，2024-09-19](https://www.anthropic.com/news/contextual-retrieval)）。同一篇文章还指出：**知识库小于约 20 万 token 时可以直接全部放进提示词、不做检索**。
- **词表扩展**：人工同义词表可完全复现、零延迟，但覆盖面取决于维护，对未见过的说法无效——需要在保留集上验证其泛化。

### 2.4 Dense / Sparse Embedding

| 模型 | 规格（模型卡） | 备注 |
|---|---|---|
| **Qwen3-Embedding-0.6B** | 0.6B 参数、1024 维（MRL 32–1024）、32K 上下文、末 token 池化、查询需指令前缀 `Instruct: …\nQuery:…`；[宣称] MTEB 多语言 64.33、C-MTEB 66.33；Apache-2.0（[模型卡](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)） | 有官方社区 ONNX 导出，transformers.js 自 v3.6 支持；fp32 约 2.4 GB、q8 约 614 MB |
| **BAAI/bge-m3** | XLM-R large 底座、1024 维、8192 token、查询不需指令；同时输出 dense / 稀疏词权重 / ColBERT 多向量；模型卡建议“混合检索 + 重排”，并承认 BM25 仍是有竞争力的基线；MIT（[模型卡](https://huggingface.co/BAAI/bge-m3)） | ONNX fp32 约 2.3 GB、q8 约 570 MB；稀疏头权重在 `sparse_linear.pt` |
| **multilingual-e5-small**（审计新增） | 118M 参数、384 维、需 `query:`/`passage:` 前缀 | q8 仅 118 MB，CPU 推理快一个量级；用来回答“小模型够不够” |
| **EmbeddingGemma-300m**（审计新增） | 308M 参数、768 维；[宣称] MTEB 多语言 v2 61.15，500M 以下最高（[HF 博客](https://huggingface.co/blog/embeddinggemma)、[arXiv 2509.20354](https://arxiv.org/abs/2509.20354)） | 介于两者之间的折中点 |

- MTEB 分数是模型方自报、任务分布以文档检索为主，**与“口语化短查询 → 一句话事实”的场景不同**，不能直接推断排序。
- **学习型稀疏**：bge-m3 的稀疏输出是对输入里出现的子词学习权重，不做词表外扩展（不是 SPLADE 式扩展），因此理论上解决不了“无共同词面”问题，只能改善词项权重。列入实验验证这一推断。
- **与 Memory 记录结构的适配**：L2 记录是单句事实（几十字），整条记录即一个语义单元，不需要分块；这是 dense 检索最舒服的形态。风险在另一面：短事实之间语义密度高，“同主题不同取值”（端口 7801/7802、周三/周四）在向量空间里几乎重合，dense 对数字、ID、专有名词和否定不敏感——这正是词面检索的强项，二者互补的假设成立与否由实验判断。
- **部署**：transformers.js（`@huggingface/transformers` 4.3.2）+ onnxruntime-node 提供 Windows/macOS/Linux x64/arm64 预编译二进制，纯 npm 安装；但 Host 是 Electron，原生模块需要与其 ABI 匹配或放在独立进程。替代路径是本机 Ollama / llama.cpp 的 HTTP 接口，或远程 embedding API（引入网络依赖与数据出境问题）。

### 2.5 融合与重排

- **RRF**：Cormack、Clarke、Büttcher（SIGIR 2009）提出，`score = Σ 1/(k + rank)`，原文取 k=60；只用名次、不需要分数归一，是 Qdrant、LanceDB、Graphiti 的默认或可选融合。
- **加权 / 归一化分数融合**：Bruch 等（[arXiv 2210.11934](https://arxiv.org/abs/2210.11934)，ACM TOIS）[论文] 认为归一化后的凸组合在域内外都优于 RRF，且只需少量样本调一个参数；RRF 对 k 敏感、调过的 RRF 域外泛化差。Weaviate 默认用归一化分数融合，Qdrant 默认用 RRF——**没有共识**。本研究按任务要求以 RRF 为主，另设归一化凸组合作为信息性对照（不是直接相加原始 BM25 与余弦）。
- **Cross-Encoder 重排**：bge-reranker-v2-m3（约 568M 参数，基于 bge-m3）与 Qwen3-Reranker-0.6B 是同量级多语言选项；公开对比互有胜负，未找到可靠的 CPU 延迟数据。Mem0 自述托管 reranker 增加 150–200 ms 并在 v3 把 rerank 改为默认关闭。对 20 条候选做本地 CPU 重排的延迟需要实测。

### 2.6 更适合小型长期记忆库的简化方案

1. **不检索，全量注入**：Anthropic 的 20 万 token 建议在这里对应“记忆很少时把全部 L2 放进上下文”。本项目的 L3 投影（≤12 条、约 1200 token）已经是这个思路的受控版本；全量注入会破坏用途隔离后的预算与提示缓存，不作为检索方案，但它说明**库很小时任何检索优化的绝对收益都有限**。
2. **写入期扩展**：提取 LLM 在生成 `statement` 时顺带生成中英文别名/关键词，存入派生的 FTS 列。查询期零额外成本、无新运行时依赖。
3. **agent 自行改写重查**：主动 `recall` 工具已存在；模型可以换词重试。成本是多一轮工具调用，且不覆盖每轮自动上下文。
4. **精确向量全扫描**：见 2.2 的规模判断，不需要任何向量数据库。

---

## 3. 候选方案对比（实验前评估）

延迟与成本为量级估计，实测值见 `REPORT.md`。“安全一致性”指：是否引入需要与事实源保持同步的派生状态，以及失步时的后果。

| 方案 | 预期解决的问题 | 查询期成本 | 写入期成本 | 新依赖 | 跨平台 | 可维护性 | 安全一致性 |
|---|---|---|---|---|---|---|---|
| A 现有 FTS5 | 精确词、数字、ID | <1 ms | 无 | 无 | ✔ | 最简单 | 事务一致 |
| A+ FTS5 查询/切词修正 | 长句截断、功能词噪声、英文形态 | <1 ms | 无或重建 FTS | 无 | ✔ | 简单 | 事务一致 |
| B1 词表扩展 | 词表内的同义/译名 | <1 ms | 无 | 词表文件 | ✔ | 词表需人工维护，覆盖面不可知 | 无派生状态 |
| B2 模型查询扩展 | 同义、译名 | 一次 LLM 调用（数百 ms–数秒，计费） | 无 | Host LLM | ✔ | 提示词维护；不可完全复现 | 查询文本经过模型；无派生状态 |
| C Dense | 同义、跨语言、无共同词 | 查询 embedding（CPU 数十–数百 ms）+ 全扫描 | 每条记忆一次 embedding | 模型文件 0.1–2.4 GB + onnxruntime | 预编译二进制覆盖三平台；Electron ABI 待验证 | 模型版本迁移需重建 | **新增派生索引**，需绑定 revision/哈希并处理遗忘 |
| D FTS5 + Dense + RRF | A 与 C 互补 | 同 C | 同 C | 同 C | 同 C | 多一个融合参数 | 同 C；FTS 可作为降级路径 |
| E D + 查询扩展 | 在 D 上再补词面 | C + B | 同 C | C + B | 同 C | 最复杂 | 同 C |
| F1 写入期文档扩展 + FTS5 | 同义、译名（由写入期 LLM 预先生成） | <1 ms | 提取调用里多输出一个字段（近零边际成本）；存量需回填 | 无运行时依赖 | ✔ | 扩展文本是派生数据，需随修订重建 | **新增派生文本**，同样要绑定 revision 并在遗忘时删除；但与 FTS 同库同事务即可 |
| F2 F1 + Dense + RRF | F1 与 C 互补 | 同 C | F1 + C | 同 C | 同 C | 复杂 | 同 C |
| F3 D + Cross-Encoder | 排序精度 | D + 20 次交叉编码（CPU 预计秒级） | 同 C | 再加约 570 MB 模型 | 同 C | 复杂 | 同 C |
| F4 学习型稀疏（bge-m3） | 词项权重 | 一次编码 | 每条一次编码 | 同 bge-m3 | 同 C | 需自管倒排或全扫描 | 同 C |
| 向量数据库 / 图检索 | 大规模、多跳关系 | 服务进程 | 实体抽取 LLM | 独立服务或图库 | 部署重 | 第二事实副本 | 需要另建一套 ACL 与遗忘同步 |

---

## 4. 对八个问题的审计阶段判断（待实验验证）

1. **当前 FTS5 是否足够？能否靠改切词/排序/查询解决主要问题？** 对精确词、数字、ID 足够。截断顺序与功能词噪声可以零依赖修复，预计改善整句查询的排序；但主因①（无共同词面）是词面检索的定义性限制，改切词和排序**不能**解决。
2. **Query Expansion 是否比 Embedding 更经济？** 词表扩展最便宜但泛化存疑；模型查询扩展每次查询都要一次 LLM 调用，在“每轮自动检索”这条主路径上，其延迟与费用**未必低于**一次本地小模型 embedding。更经济的可能是把扩展挪到写入期（F1）。
3. **Dense 是否适合当前记录结构？** 单句事实无需分块，结构上适合；风险是对数字/ID/否定不敏感，以及对“无相关结果”的查询总会返回最近邻。预计单独使用不如混合。
4. **Sparse / Hybrid / Reranker 是否更有效？** 预计 Hybrid 是召回最稳的；学习型稀疏（非扩展式）预计与 BM25 同病；Reranker 预计提升排序但 CPU 延迟可能不可接受。
5. **是否存在明显优于预设五组的组合？** 候选：F1 写入期扩展（把查询期成本变为零）、A+（先修掉不需要新技术的缺陷）。是否“明显优于”由实验回答。
6. **是否有必要引入向量数据库或图检索？** 实验前判断为否：规模不需要 ANN；时间有效性已由写入期机制处理；Mem0 开源版自行移除图存储是一个反向信号。实验中用精确全扫描实测延迟来验证规模论断。
7. **L1–L3、ACL、遗忘会限制哪些方案？** 排除“全库最近邻后过滤”和任何独立持有正文副本且无法同事务清除的存储；要求派生索引绑定 `memoryId/revision/contentHash/embeddingModelVersion`、遗忘时删除、查询时以事实源复核。查询扩展若经过外部模型，查询文本会离开本机，需与现有 Host LLM 的数据边界一致。
8. **最适合 Node 24 + SQLite + Windows、未来迁移 Mac/Linux 的方案？** 约束指向：纯 JS 或带三平台预编译二进制的 npm 包、单文件 SQLite、可降级到 FTS5。候选排序留待实验后在 `RECOMMENDATION.md` 给出。

---

## 5. 实验选型

保留任务给定的 A–E，并按审计结果增加对照组。每一项新增都对应第 1 节的一个具体发现或第 4 节的一个待验证判断。

| 组 | 方案 | 设立理由 |
|---|---|---|
| **A** | 现有 FTS5：直接调用未修改的 `LayeredMemory.recall` | 真实基线 |
| **A+** | FTS5 修正：(a) 截断时二元组优先、去除高频功能单字；(b) `Intl.Segmenter` 词级切词；(c) 英文轻量词干 | 回答问题 1：把“不需要新技术就能修的”与“词面检索修不了的”分开。若不设此组，后续各组的收益会混入对基线缺陷的修复 |
| **B1** | FTS5 + 词表扩展（只用开发集与通用知识构建，冻结后评保留集） | 任务要求；度量词表泛化 |
| **B2** | FTS5 + 模型查询扩展（本地 `qwen2.5:7b`，temperature 0，输出缓存入库以便复现） | 任务要求；独立于数据集作者的模型 |
| **C** | Dense：Qwen3-Embedding-0.6B、bge-m3；另加 multilingual-e5-small 与 EmbeddingGemma-300m | 任务要求 + 回答“小模型够不够” |
| **D** | FTS5 + Dense + RRF | 任务要求 |
| **E** | FTS5 + 查询扩展 + Dense + RRF | 任务要求 |
| **F1** | FTS5 + 写入期文档扩展（同一本地模型为每条记忆生成中英文别名/关键词，存入派生影子 FTS 表） | 审计 2.1/2.3/2.6：独立基准支持索引侧扩展；查询期零成本 |
| **F2** | F1 + Dense + RRF | 检验 F1 与 Dense 是否互补 |
| **F3** | D + Cross-Encoder（bge-reranker-v2-m3）重排前 20 | 回答问题 4 的 Reranker 部分，并实测 CPU 延迟 |
| **F4** | bge-m3 学习型稀疏（单独与 + dense） | 回答问题 4 的 Sparse 部分；验证“非扩展式稀疏解决不了词面缺口”的推断。实现上需从 `sparse_linear.pt` 取线性头权重，若无法在不引入 PyTorch 的前提下完成则记录为阻塞 |
| **对照** | 归一化凸组合融合（min-max 后加权） | 2.5 节：文献对 RRF 是否最优存在分歧；仅作信息性对照，主结论仍基于 RRF |

独立可比性：B 相对 A 隔离查询扩展的效果；C 隔离 dense；D 相对 A、C 隔离融合的效果；E 相对 D 隔离“在混合之上再加扩展”的边际效果。A+ 的修正**不**混入 B–E（它们都建立在未修改的基线 FTS 路径上），以保证与 A 可比；A+ 与最优方案的叠加另列。

明确不做的：

- **Qdrant / FAISS / LanceDB / sqlite-vec / GraphRAG**：依据 2.2 的规模判断，第一轮用精确全扫描；只有当实测延迟不可接受时才回头引入。
- **HyDE / query2doc 式假想文档**：LLM 不掌握用户私有事实，假想答案对个人记忆无信息量；查询侧只测同义词与译名扩展。
- **时间衰减排序**：时间有效性由 `correct`/`expires_at`/`claim_key` 在写入期处理；在检索排序里加衰减会让长期偏好被新近闲谈挤掉，与 L3“同分优先较早建立的事实”的既有取向冲突。数据集仍覆盖时间变化类查询，用来验证现有机制在各方案下是否保持。

公平性约束（适用于所有组）：同一合成库、同一查询与标注、同一可信句柄；所有候选经由同一个有效性闸门（事实源复核）；同一候选预算（每路 top-50）与同一输出预算（≤20 条、渲染后 ≤5000 字符，与 `context()` 一致）。可调参数只在开发集上选，保留集只跑一次。

---

## 6. 主要风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 数据集作者偏差 | 语料、查询、词表出自同一作者，词表扩展在开发集上的成绩必然偏高 | 保留集在构建词表前冻结并记录哈希；词表只依据开发集失败案例与通用同义关系；报告词表在保留集上的覆盖率；模型扩展使用独立模型 |
| 合成数据不代表真实分布 | 真实对话的查询更散、记忆更脏 | 所有结论限定为“此合成集”；不外推绝对数值，只比较方案间的相对差异与失败类型 |
| 小样本方差 | 每类查询 10–20 条 | 报告分类别结果与 bootstrap 置信区间；差异小于区间宽度时不下结论 |
| 本地 7B 模型不代表 Host 模型 | 生产 Host 用更强的模型，B2/F1 的实测可能偏保守 | 在报告中标明这是下界估计；同时人工抽查扩展质量 |
| CPU 延迟不代表目标部署 | 实验机有独显但 onnxruntime-node 默认走 CPU | 报告 CPU 数字作为保守上界；量化（q8）单独测 |
| 派生索引的一致性 | 向量/扩展文本可能滞后于事实源 | 第四阶段专门测试：更正、遗忘、过期、延迟更新、崩溃、模型不可用 |
| Electron 原生模块 | onnxruntime-node 能否在 Host 进程内加载未验证，且研究阶段不得启动生产 Host | 记录为集成前置条件，不在本研究内验证 |

---

## 7. 来源清单（核查日期 2026-11-17）

项目与基准
- Mem0 OSS v2→v3 迁移文档：https://docs.mem0.ai/migration/oss-v2-to-v3.md
- Mem0 基准文章（厂商）：https://mem0.ai/blog/ai-memory-benchmarks
- Zep 对 Mem0 基准的反驳（厂商）：https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/
- Zep 论文：https://arxiv.org/abs/2501.13956
- Letta archival search 文档：https://docs.letta.com/guides/agents/archival-search
- Letta “Benchmarking AI Agent Memory”（2025-08-12）：https://www.letta.com/blog/benchmarking-ai-agent-memory
- LongMemEval：https://arxiv.org/abs/2410.10813

检索系统
- Qdrant hybrid queries：https://qdrant.tech/documentation/concepts/hybrid-queries/
- Weaviate hybrid search：https://docs.weaviate.io/weaviate/concepts/search/hybrid-search
- LanceDB hybrid search / RRF：https://docs.lancedb.com/search/hybrid-search 、https://docs.lancedb.com/reranking/rrf
- sqlite-vec：https://alexgarcia.xyz/sqlite-vec/ 、https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/sqlite-vec
- SQLite vec1：https://sqlite.org/vec1/doc/trunk/doc/vec1.md 、https://sqlite.org/forum/forumpost/9fea7e0fbb6ddd2f
- SQLite FTS5：https://www.sqlite.org/fts5.html
- Node.js v24 `node:sqlite`：https://nodejs.org/docs/latest-v24.x/api/sqlite.html

模型与方法
- Qwen3-Embedding-0.6B：https://huggingface.co/Qwen/Qwen3-Embedding-0.6B （ONNX：https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX ）
- BAAI/bge-m3：https://huggingface.co/BAAI/bge-m3 （ONNX：https://huggingface.co/Xenova/bge-m3 ）
- multilingual-e5-small（ONNX）：https://huggingface.co/Xenova/multilingual-e5-small
- EmbeddingGemma：https://huggingface.co/blog/embeddinggemma 、https://arxiv.org/abs/2509.20354
- bge-reranker-v2-m3（ONNX）：https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX
- query2doc：https://arxiv.org/abs/2303.07678
- “Hypothetical Documents or Knowledge Leakage?”：https://arxiv.org/abs/2504.14175
- Bruch 等，融合函数分析：https://arxiv.org/abs/2210.11934
- Anthropic Contextual Retrieval（2024-09-19）：https://www.anthropic.com/news/contextual-retrieval
- 中文 FTS5 切词实践：https://dev.to/foxck016077/sqlite-fts5-wont-tokenize-chinese-heres-the-7-line-bigram-fix-that-did-4fcc 、https://gitee.com/gpress/simple

未能核实、未采信的内容：Letta 混合检索使用 RRF 的具体实现（仅见于搜索摘要）；vec1 并入 SQLite 主干的日期（仅见于二手报道）；各记忆项目 2026 年的最新自报基准分数（互不可比）。RRF 原始论文（Cormack 等，SIGIR 2009）的 k=60 依据通行引用，本次未重新打开原文。
