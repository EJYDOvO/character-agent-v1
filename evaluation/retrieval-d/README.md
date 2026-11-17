# Retrieval D — 长期 Memory 检索对照研究（仅评测）

基于 Character `main` @ `542738b`。本目录是独立研究代码：**不属于任何运行时包，不被打包或部署，不改动 Memory API、ACL 或 Schema**。只使用合成 SQLite 数据库；不读取生产 Memory，不启动 DSH Host、QQTK 或 QQ Gateway。

| 文件 | 内容 |
|---|---|
| [TECH_AUDIT.md](TECH_AUDIT.md) | 实验前完成的源码审计、外部技术调查与实验选型 |
| [REPORT.md](REPORT.md) | 对照实验结果、成本、一致性验证、失败案例 |
| [RECOMMENDATION.md](RECOMMENDATION.md) | 选型结论、风险与最小集成方案 |
| `dataset/` | 合成语料、标注查询、冻结哈希、词表、缓存的模型扩展输出 |
| `results/` | 机器可读的原始结果（逐查询）与生成的表格 |
| `src/` | 夹具、检索器、融合、有效性闸门、派生索引、评测与测试 |

## 环境

- Node.js ≥ 24（实测 v24.13.0，内置 SQLite 3.50.4）；Windows 11 x64 上运行，代码不含平台相关路径。
- `npm install`（在本目录内）只安装 `@huggingface/transformers@4.3.2` 及其 `onnxruntime-node`。仓库根目录的依赖不变。
- Embedding / Reranker 模型首次使用时从 Hugging Face 下载到 `RETRIEVAL_D_MODEL_CACHE`（默认 `~/.cache/dsh-retrieval-d/models`），全部约 8 GB；版本固定在 [src/embed/models.mjs](src/embed/models.mjs) 的 commit 上。CPU 推理，无需 GPU。
- 只有重新生成模型扩展时才需要本机 Ollama 与 `qwen2.5:7b`；其输出已缓存在 `dataset/expansions/`，复现实验不需要它。

## 复现

```sh
cd evaluation/retrieval-d
npm install
node --no-warnings src/validate-dataset.mjs          # 校验语料/标注并核对 dataset/FREEZE.json
node --no-warnings src/audit-probes.mjs              # TECH_AUDIT §1 的探针
# 真实 embedding（每个模型一个进程；同时记录 results/embedding-cost.*.json）
for m in qwen3-0.6b:fp32 qwen3-0.6b:q8 bge-m3:fp32 bge-m3:q8 embeddinggemma:fp32 embeddinggemma:q8 me5-small:fp32 me5-small:q8; do node --no-warnings src/embed-cache.mjs $m; done
node --no-warnings src/run.mjs --split dev --tune    # 只在开发集调参 -> results/tuning.json, results/dev.json
node --no-warnings src/run.mjs --split heldout       # 用冻结参数评保留集 -> results/heldout.json
node --no-warnings --test src/consistency.test.mjs   # 第四阶段一致性/安全测试（真实模型）
node --no-warnings --expose-gc src/perf.mjs          # 延迟、体积、规模 -> results/perf.json
node --no-warnings src/report.mjs                    # results/tables.md
```

可选：`node src/expand/generate.mjs query|doc` 用本机 Ollama 重新生成扩展（temperature 0、固定 seed；模型 digest 与提示词哈希写入输出文件，变化时自动重算）。

没有 Mock Embedding 路径：`src/lib/embed-cache.mjs` 与 `rerank-cache.mjs` 只缓存真实模型的输出，缺失时报错或现算。`.cache/` 不入库。

## 实验纪律

1. `TECH_AUDIT.md` 先于任何对照实验提交（commit `f6885e3`）。
2. 语料与开发/保留查询先冻结哈希（commit `1867f65`，`dataset/FREEZE.json`），之后才编写词表与任何调参。
3. 词表 `dataset/lexicon.json` 的每一组都标注其来源的**开发集**失败查询；没有为保留集查询写的条目。
4. 所有可调参数（RRF 的 k 与权重、扩展合并方式、相似度下限）只在开发集上选择并写入 `results/tuning.json`；冻结后提交（commit `d927ccf`），保留集只评测一次。
5. 开发集首轮结果出来后新增的对照组（扩大的 RRF 网格、仅二元组 FTS 融合、相似度下限、标识符置顶、ID 压力集）都在评保留集之前加入，原因记录在 `REPORT.md` §2。ID 压力集单独报告，不进入调参目标。
6.  由提交  之前的同一工作树生成（因此其  为 true、 指向前一提交）； 在该提交的干净工作树上生成。两个结果文件为节省体积以单行 JSON 存储。
7. 基线组直接调用未修改的 `LayeredMemory.recall`；其余各组使用的 FTS 重表达在每次运行中与基线逐查询比对（`baselineEquivalence`，本次 120/120 一致）。

## 代码结构

- `src/fixture.mjs`：经由真实 `LayeredMemory` API（remember / correct / forget / 过期）构建四个作用域的合成库。
- `src/lib/gate.mjs`：有效性闸门——候选只是 ID，可返回的行与正文一律来自 Core 对可信句柄给出的有效集合；输出预算与 `context()` 相同。
- `src/lib/fts.mjs`、`terms.mjs`：FTS5 基线镜像、查询修正、词表/模型扩展。
- `src/lib/vector-index.mjs`、`alias-index.mjs`：旁路 SQLite 中的派生索引，条目绑定 `memoryId / revision / contentHash / modelVersion`。
- `src/lib/hybrid.mjs`：保持 SQLite Core 为事实源的混合检索参考形态（含降级与索引滞后补偿）。
- `src/embed/`：transformers.js Provider 与固定版本的模型表；`src/expand/`：本机模型扩展生成。
- `src/run.mjs`、`perf.mjs`、`report.mjs`、`consistency.test.mjs`：实验、性能、报表、一致性测试。

## 已知局限

合成数据、单一作者、每类 8–12 条查询；本地 7B 模型代表不了 Host 模型的扩展质量；CPU 延迟来自一台 Ryzen 9 6900HX 笔记本；未在 Electron Host 进程内验证 onnxruntime-node。详见 `REPORT.md` §8。
