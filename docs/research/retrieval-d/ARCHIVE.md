# D 阶段检索研究归档（PR #26）

本目录是检索选型研究（PR #26，研究分支 `research/retrieval-d`）的长期归档。研究 PR 没有整体合并；它的结论由 D1 语义检索（PR #27）吸收。

| 文件 | 内容 |
|---|---|
| [TECH_AUDIT.md](TECH_AUDIT.md) | 实验前完成的源码审计、外部技术调查与实验选型（核查日期 2026-11-17） |
| [REPORT.md](REPORT.md) | 对照实验：FTS5、查询扩展、Dense、RRF 混合、Reranker 等各组的质量、成本与失败案例 |
| [RECOMMENDATION.md](RECOMMENDATION.md) | 选型结论与最小集成方案（D1 的设计依据） |
| [tables.md](tables.md) | 由原始结果自动生成的全部表格 |
| [perf.json](perf.json) | 延迟、规模与存储测量 |

## 可核验的出处

- 研究代码、原始逐查询结果（`results/dev.json`、`results/heldout.json`，约 12 MB）、调参记录（`results/tuning.json`）与模型扩展缓存，均保存在提交 `463c2aeb0eb89d4ad6a44778ef8f9b162bf206ca`（GitHub 保留的 `refs/pull/26/head`）的 `evaluation/retrieval-d/` 下。研究分支删除后仍可通过 PR #26 页面或 `git fetch origin pull/26/head` 取回。
- 上述文档中的相对链接（`results/…`、`src/…`、`dataset/…`）指的是该提交的目录结构。
- 冻结的评测集已原样复制到 [tests/fixtures/semantic-eval/](../../../tests/fixtures/semantic-eval/)，`MANIFEST.json` 记录每个文件的 sha256，`tests/semantic-recall.test.mjs` 校验它们未被修改。`FREEZE.json` 是研究时对语料与开发/保留查询内容计算的哈希（冻结于 2026-11-17T00:20:13Z，研究提交 `1867f65`）。
- 研究使用的模型版本：Qwen3-Embedding-0.6B `c25a394d`，bge-m3 `4de13258`，EmbeddingGemma-300m `5090578d`，multilingual-e5-small `761b726d`，bge-reranker-v2-m3 `6f5ff652`（均为 Hugging Face commit 前缀）；查询/文档扩展用本机 Ollama `qwen2.5:7b`（digest `845dbda0ea48`）。

## 与 D1 实现的关系

D1 采用研究结论中的"Dense 为主 + 标识符精确命中置顶 + 相似度下限"，模型选 bge-m3 q8（MIT）。D1 的真实模型回归（`tests/semantic-real-model.mjs`）在同一冻结评测集上运行，结果记录在 [docs/SEMANTIC-RECALL.md](../../SEMANTIC-RECALL.md)。
