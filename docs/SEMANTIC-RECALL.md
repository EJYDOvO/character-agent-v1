# D1：可选的语义记忆检索

基于 Character main `542738b`，目标 Host DSH 0.2.2-rc.1。技术依据见研究 PR #26（`evaluation/retrieval-d/`）。本次只提交源码与测试；**没有部署、没有启用、没有访问生产数据**。未声明该插件的实例行为与此前完全相同。

## 做了什么

给 L2 已提炼记忆的检索增加一条可选的语义排序路径：本地 Dense Embedding 为主，带数字的标识符精确命中置顶，相似度下限过滤无关内容。L1（证据追溯）、L3（核心投影）、写入、提取、巩固、Schema 3 都没有改动。

| 模式 | 行为 |
|---|---|
| `off`（默认，或不声明插件） | 不加载任何东西；`recall` 逐字节走原 FTS5 路径 |
| `shadow` | 建向量并比较新旧结果，但调用方拿到的始终是 FTS5 结果；只记录 id 级统计，不记录查询或正文 |
| `active` | 每轮自动上下文与 `recall` 工具使用语义排序；任何异常回到 FTS5 |

## 架构与关键取舍

```
可信句柄 ─► Memory Core：有效集合（身份 / ACL / 状态 / 过期 / 证据 / 遗忘屏障）   权威，未改
                │ 只把 {id, revision, fingerprint} 交给排序器
                ▼
        dsh-memory-semantic（可选插件）
          排序器 ── 旁路 vectors.sqlite（memoryId, modelVersion → revision, contentHash, 向量）
             │
          Provider ── 独立子进程 worker（onnxruntime + 模型），或本机 HTTP 端点
                ▼ 只返回 id 的顺序
        Memory Core：标识符 FTS 置顶 → 待建向量的词面命中 → 相似度顺序
                     → 按 id 用原谓词重新读取行 → 冲突标注 → 去重与预算（不变）
```

**1. Core 只增加一个扩展点，不依赖任何模型。** `LayeredMemory.setSemanticRanker(ranker)`；`recall(..., {semantic:true})` 仅在挂了排序器时走新路径。排序器拿不到正文、作用域或来源；它返回的 id 若不在当前句柄的有效集合里会被丢弃（有测试用恶意排序器验证）。返回的每一行都由 Core 用原有 SQL 谓词重新读取。提取与巩固的查重调用不带该标志，保持词面路径。

**2. 推理放在独立子进程。** 审计时实测 onnxruntime-node 可以直接在 Host 的运行时（Electron 44.7 / Node 24.21）里加载，但仍选择子进程：约 0.85 GB 的模型内存、推理线程和任何原生崩溃都留在 Host 之外；空闲可卸载；Host 进程实测只增加几十 MB。子进程用 Host 自己的可执行文件以 `ELECTRON_RUN_AS_NODE=1` 启动，环境变量只传最小集合（不含凭据、代理、Home）。Provider 接口只有 `embed(texts, kind)`，另附本机 HTTP（OpenAI 兼容 `/v1/embeddings`）实现；非回环地址必须显式 `allowRemote: true`。

**3. 同步/异步边界。** Host 的系统上下文 Provider 是同步的（已读 `dsh-system-prompt` 源码确认），无法在其中等待推理。因此在可信消息入口 `noteInput` 处异步启动查询向量计算，`context()` 取用缓存；向量未就绪则本轮用 FTS5，同一轮后续的上下文刷新会用上。`recall` 工具本身是异步的，走 `recallAsync`，最多等待 `prepareTimeoutMs`（默认 250 ms）。

**4. 不用 RRF、Reranker、ANN、向量数据库。** 依据 PR #26 的实测：RRF 混合与重排不优于单独 Dense；一万条记录的精确扫描约 20 ms。扫描范围始终是 Core 给出的有效集合（先权限后相似度）。

**5. 索引一致性。**

| 事件 | 处理 |
|---|---|
| 新记忆 | 立即可经词面命中返回（“待建向量”的记录若与查询共享整词/二元组则排在相似度结果之前）；后台索引器约 5 秒内补建向量 |
| 更正 | Core 在同一调用内通知插件删除旧向量；旧向量即使残留也因 `contentHash` 不符而不参与排序；返回的只可能是新正文 |
| 遗忘 / 过期 | 同一调用内删除向量；残留向量（进程在两步之间崩溃）不可能使记录重现，并由周期性孤儿清理删除 |
| 仅修订号变化（确认、恢复元数据） | 内容哈希不变则向量按定义相同：重新绑定，不重算 |
| 模型或量化变化 | `modelVersion` 不同的向量在打开索引时删除；覆盖率低于 `minCoverage`（默认 0.9）期间自动使用 FTS5 |
| Provider 故障 | 抛错、超时、维度错误、NaN：结果与 FTS5 完全相同；连续 3 次失败后熔断 30 秒 |

向量是正文的有损副本，旁路文件应与 `memory.sqlite` 放在同一数据目录、同样的访问控制下。删除该文件不丢任何事实，索引器会重建。

**6. 相似度下限与模型绑定。** `bge-m3 q8` 的默认值 0.469 来自 PR #26 开发集标定；换模型必须重新标定（自定义模型时 `minScore` 为必填）。

## 改动范围

- `packages/character-memory-core`：`tokenize.mjs` 增加选择性词元；`store.mjs` 增加两个词元辅助函数；`layered.mjs` 增加扩展点（`setSemanticRanker`、`recallAsync`、`semanticCandidates`、`semanticOrphans`）、有效集合缓存、`recall` 的可选分支、入口处的预计算调用、失效通知；`layersStatus` 增加 `semantic` 字段。
- `packages/character-memory-tools`：`recall` 工具改调 `recallAsync`（无排序器时等价于原调用）。
- 新包 `packages/memory-semantic`（`dsh-memory-semantic`，独立版本 0.1.0-test.1）；打包/部署计划把它列为可选包，任何 Bundle 都不声明它。
- 无 Schema 变更、无迁移、无新的运行时 npm 依赖进入现有包。

## 配置与使用

1. **准备运行时与模型**（操作者手动执行一次；插件自身从不下载或安装）：

   ```sh
   node packages/memory-semantic/provision.mjs --runtime-dir <ABS>/semantic-runtime --model-dir <ABS>/semantic-models
   ```

   安装固定版本的 `@huggingface/transformers@4.3.2`（约 300 MB），下载 `Xenova/bge-m3` 固定 commit 的 4 个文件（约 590 MB）并逐个校验 sha256。离线环境用 `--from <已下载目录>`。

2. **在 Profile 中声明**（建议先 `shadow`）：

   ```yaml
   - id: memory-semantic
     name: dsh-memory-semantic
     config:
       mode: shadow            # off / shadow / active
       indexFile: '<ABSOLUTE_PROJECT_DATA>/memory-vectors.sqlite'
       provider:
         kind: subprocess
         runtimeDir: '<ABS>/semantic-runtime'
         modelDir: '<ABS>/semantic-models'
         threads: 2            # 推理线程数
         idleUnloadMs: 1800000 # 空闲 30 分钟后结束子进程释放内存；0 = 常驻
       # 可选：model: {model: bge-m3-q8}、topK、minCoverage、prepareTimeoutMs、indexBatch、indexIntervalMs
   ```

   改用本机 HTTP 端点：`provider: {kind: http, baseUrl: 'http://127.0.0.1:11434', modelName: '<name>'}`，并在 `model` 中给出 `repo/revision/dtype/dim/pooling/minScore`。

3. **观察**：`*_layers_status` 工具的 `semantic` 字段给出模式、模型版本、向量数、Provider 状态、计数器（`ranked` / `notReady` / `lowCoverage` / `prepareTimeouts` / `prepareErrors` / `breakerSkips` / `empty`），Shadow 模式下另有 `compared`、`meanOverlapAt5`、`sameTop1`、`semanticEmpty`、新旧平均返回条数。

4. **回退**：把 `mode` 改为 `off` 或移除该行并按正常插件生命周期重载。`memory-vectors.sqlite` 可以直接删除。不需要回滚数据库。

## 测试结果

自动化（CI 可运行，无需模型）：`npm test` 419/419，`npm run test:audit` 35/35；其中 `tests/semantic-recall.test.mjs` 13 项。该文件里的 embedder 是确定性的测试替身，只验证接线、安全与降级，不代表检索质量。覆盖：关闭时与原结果逐条相等；同义/跨语言经工具与每轮上下文两条路径召回；近似重复标识符置顶；相似度下限；索引滞后（新写入、更正、仅修订变化）；遗忘与过期（含残留向量与孤儿清理）；跨主体隔离、伪造句柄、恶意排序器；五种 Provider 故障降级与熔断；Shadow 结果不变且统计不含文本；部分建索引与换模型时停留在 FTS5；提取/巩固不触发排序器、L3 排除与冲突标注不变；配置校验。

真实模型端到端（`tests/semantic-real-model.mjs`，bge-m3 q8，真实子进程 worker + 真实 `LayeredMemory`，PR #26 的冻结合成数据集，S0 有效记录 473 条；原始输出见 `docs/evidence/semantic-recall-d1-*.json`）：

| | FTS5 | 语义（active） |
|---|---|---|
| 保留集 R@1 / R@5（83 条可回答） | 0.534 / 0.633 | 0.845 / 0.954 |
| 开发集 R@1 / R@5 | 0.440 / 0.576 | 0.735 / 0.926 |
| 保留集跨语言 / 中文同义 / 英文同义 R@5 | 0.00 / 0.50 / 0.25 | 1.00 / 0.97 / 0.88 |
| 近似重复标识符 R@1 / R@5（保留） | 0.25 / 1.00 | 1.00 / 1.00 |
| 无相关记忆时返回条数（保留） | 14.7 | 4.0 |
| 越权 / 遗忘 / 过期 / 旧修订正文返回 | 0 | 0 |
| `recall` 工具延迟 p50 / p95（含查询 embedding） | 14.0 / 66.4 ms | 32.3 / 52.6 ms |
| 每轮 `context()` 同步耗时 p50 / p95 | 19.8 / 71.4 ms | 4.7 / 12.1 ms |
| 入口到查询向量就绪 p50 / p95 | – | 33.9 / 62.0 ms |

- 生命周期（真实索引）：新记录在建向量前即可检索、建后可语义检索；更正后只返回新正文；遗忘后立即不可检索且向量已删；其他主体的原文查询不返回其记录。
- 故障：运行中杀掉 worker，该次查询返回 FTS5 结果，下一次查询自动重启恢复。
- 成本：worker 加载约 3 秒；建索引 111 ms/条（2 线程，含 6 条千字长记录），523 条约 58 秒；旁路索引约 12 KB/条（含 WAL）；Host 进程 RSS 约 70 MB（Node）/ 150 MB（Host 运行时），模型内存在 worker 内（审计时进程内实测约 0.85 GB）。
- **Host 运行时兼容性**：同一脚本用 DSH 0.2.2-rc.1 的可执行文件以 `ELECTRON_RUN_AS_NODE=1` 运行（Node 24.21 / Electron 44.7），结果一致（保留集 R@5 0.954，0 违规，全部生命周期与故障检查通过）。

每轮上下文的同步耗时反而下降，是因为语义路径不再对整句做单字 OR 匹配并物化大量候选。

## 剩余风险与未做的事

- **没有在完整的 Host 插件加载链路里验证。** 已验证的是 Host 运行时二进制上的 Core + 插件 + 子进程；没有跑带 cordis 加载器、真实 QQ 入口和真实模型回合的原生门禁。入口到首次组装上下文之间的间隔在真实 Host 里是否足够让向量就绪（约 35–60 ms）未实测；不够时首轮上下文用 FTS5，计数器 `notReady` 会反映出来。
- **评测数据是合成的**，且与 PR #26 同源；真实对话上的收益与相似度下限需要用 Shadow 模式观察后再决定是否切到 `active`。
- **相似度下限可能清空上下文**：保留集里有 1 条语义类查询因此拿不到任何 L2。L3 与主动 `recall`（可换词重试）不受影响。
- **冷启动与空闲卸载**：worker 未加载时的第一条消息（约 3 秒加载）走 FTS5。
- **内存**：worker 常驻约 0.85–1.3 GB；低配机器应保持 `off` 或缩短 `idleUnloadMs`。
- **首次启用**：存量记忆按每 5 秒一批（默认 16 条）建向量，期间按覆盖率规则使用 FTS5；一万条约需一小时量级的后台时间。
- **索引器只覆盖本次运行中出现过的作用域**（`activeContexts`）；从未活跃的作用域在其首次查询时才开始建向量。
- **多实例**：与 Core 一样假设同一数据库只有一个 Host 实例；多实例共享旁路文件未测试。
- **模型许可与供应链**：bge-m3 为 MIT；运行时与模型文件由 `provision.mjs` 固定版本并校验哈希，但 npm 依赖树本身未逐包审计。
- 未实现：L1 全历史语义检索、Inspector 界面、macOS/Linux 实机验证（代码无平台相关路径，依赖提供三平台预编译二进制）。
