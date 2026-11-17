# D1：可选的语义记忆检索

基于 Character main `542738b`，目标 Host DSH 0.2.2-rc.1。技术依据见研究 PR #26（`evaluation/retrieval-d/`）。本 PR 只提交源码与测试：**没有部署、没有启用、没有访问生产数据**。不声明该插件的实例，行为与此前完全相同。

## 做了什么

给 L2 已提炼记忆的检索增加一条可选的语义排序路径：本地 Dense Embedding 为主，带编号的标识符精确命中置顶，相似度下限过滤无关内容。L1（证据追溯）、L3（核心投影）、写入、提取、巩固、Schema 3 均未改动。

| 模式 | 行为 |
|---|---|
| `off`（默认，或不声明插件） | 不加载任何东西；`recall` 逐字节走原 FTS5 路径 |
| `shadow` | 建向量并比较新旧结果；调用方拿到的始终是 FTS5 结果；只记录 id 级统计，不记录查询或正文 |
| `active` | 每轮自动上下文与 `recall` 工具使用语义排序；任何异常回到 FTS5 |

## 架构与关键取舍

```
可信句柄 ─► Memory Core：有效集合（身份 / ACL / 状态 / 过期 / 证据 / 遗忘屏障）   权威
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

1. **Core 只增加一个与模型无关的扩展点。** `LayeredMemory.setSemanticRanker(ranker)`；`recall(..., {semantic:true})` 只在挂了排序器时走新路径。排序器拿不到正文、作用域或来源；它返回的 id 若不在当前句柄的有效集合里会被丢弃（测试中用恶意排序器验证）。返回的每一行都由 Core 用原有 SQL 谓词重新读取。提取与巩固的查重调用不带该标志，保持词面路径。
2. **推理放在独立子进程。** onnxruntime-node 也能直接在 Host 运行时（Electron 44.7 / Node 24.21）里加载，但子进程把约 0.8–1.4 GB 的模型内存、推理线程和原生崩溃留在 Host 之外，可空闲卸载，并以低于正常的优先级运行。子进程用 Host 自己的可执行文件以 `ELECTRON_RUN_AS_NODE=1` 启动，只传最小环境变量（不含凭据、代理、Home）。Provider 接口为 `embed(texts, kind)` 与 `identity()`；另附本机 HTTP（OpenAI 兼容 `/v1/embeddings`）实现，非回环地址须显式 `allowRemote: true`。
3. **同步/异步边界。** Host 的系统上下文 Provider 是同步的（已读 `dsh-system-prompt` 源码确认），无法在其中等待推理。因此在可信消息入口 `noteInput` 处异步启动查询向量计算，`context()` 取用缓存；未就绪则本轮用 FTS5（计数为 `notReady`）。`recall` 工具是异步的，走 `recallAsync`，最多等待 `prepareTimeoutMs`（默认 250 ms）。
4. **不用 RRF、Reranker、ANN、向量数据库。** 依据 PR #26 的实测：RRF 混合与重排不优于单独 Dense；一万条记录的精确扫描约 20 ms。扫描范围始终是 Core 给出的有效集合（先权限后相似度）。
5. **后台索引让路给前台。** 有 Agent 处于 running、或最近 2 秒内有查询时，索引推迟（最长推迟 120 秒，保证一直忙的 Host 最终也能建完）。worker 内查询队列优先于文档队列，文档逐条编码，查询最多等一条正在编码的记录。

### 索引一致性

| 事件 | 处理 |
|---|---|
| 新记忆 | 立即可经词面命中返回（"待建向量"的记录若与查询共享整词/二元组，排在相似度结果之前）；后台索引器随后补建向量 |
| 更正 | Core 在同一调用内通知插件删除旧向量；旧向量即使残留也因 `contentHash` 不符而不参与排序；返回的只可能是新正文 |
| 遗忘 / 过期 | 同一调用内删除向量；残留向量（进程在两步之间崩溃、或旁路写入失败）不可能使记录重现，并由孤儿清理删除 |
| 仅修订号变化（确认、恢复元数据） | 内容哈希不变则向量按定义相同：重新绑定，不重算 |
| 影响向量的任何配置变化 | `embeddingModelVersion` 不同的向量在打开索引时删除；覆盖率低于 `minCoverage`（默认 0.9）期间自动用 FTS5 |
| Provider 故障 | 抛错、超时、维度错误、NaN、进程崩溃：结果与 FTS5 完全相同；连续 3 次失败熔断 30 秒；启动失败指数退避 |
| 旁路文件损坏 | 打开时检测，丢弃并重建为空库；重建期间 FTS5 |

旁路文件是正文的有损副本：开启 `secure_delete`，删除后截断 WAL，所以被遗忘记录的向量不会残留在 `-wal` 或空闲页里（有测试按字节检查）。它应与 `memory.sqlite` 放在同一数据目录、同样的访问控制下。删除该文件不丢任何事实，索引器会重建；从备份恢复旧副本也不能让已遗忘的记录重现（Core 决定有效性），下一次孤儿清理会删掉不匹配的条目。无需单独备份它。

### 相似度下限

`bge-m3 q8` 的默认值 0.469 来自 PR #26 开发集标定；换模型必须重新标定（自定义模型时 `minScore` 为必填）。下限不参与 `embeddingModelVersion`（不改变向量）。

## 本次复审修复的问题

| # | 问题 | 是否真实存在（证据） | 修复 | 回归测试 |
|---|---|---|---|---|
| 1 | `semanticOrphans()` 只按 principal + project + fingerprint 匹配遗忘屏障，没有带 Character 命名空间 | **存在**。同一主体在 Character A 遗忘一句话后，Character B（或另一项目）里同文的有效记录被判为孤儿并删向量，随后被重建、再被删，反复抖动并降级为词面。修复前 Core 上运行回归测试：多返回了 B 的 id | 屏障按记录自身的根作用域匹配；人格化 lane 记录从 `memory_lanes` 取根作用域（`layered.mjs` `semanticOrphans`） | `orphan sweep follows the root scope of the record` |
| 2 | 模型版本只含 `repo@revision:dtype` | **存在**（读代码确认）。改 pooling、前缀、维度、运行时版本或 Provider 后会复用不同向量空间的旧向量，排序静默错误 | `modelVersion()` 对 revision、pooling、两个前缀、维度、归一化、Provider 身份（运行时版本 / HTTP 端点与模型名）做哈希（`models.mjs`） | `embeddingModelVersion covers ...`（含端到端：只改查询前缀即清空并回到 FTS5） |
| 3 | 标识符识别把任何 ≥3 字符且含数字的词元当 ID | **存在**。`2026 年有什么计划` → `['2026']`，会把所有提到 2026 的记录置顶；修复前 Core 上运行回归测试失败 | ID = 字母与数字混合且 ≥3 字符，或 ≥4 位纯数字且不是 19xx/20xx 年份；并要求该词元在有效集合中至多命中 3 条才置顶（`store.mjs` `identifierTerms`，`layered.mjs` `#semanticRows`） | `identifier detection: codes are pinned; years, dates, counts and common numbers are not`（12 条自然语言反例、近似编号 ATL-2317 / 2318 / 23170、6 条记录共享的 9090） |
| 4 | 真实模型脚本的 worker 故障断言 `equal ‖ ranked>0` 恒为真 | **存在**（读代码确认） | 改为严格：结果与 FTS5 完全相同，且 `ranked` 增量为 0、`notReady` 增量为 1；分别测"停止"和"编码批次中被 OS 杀死"，并要求自动恢复、索引最终完整 | `tests/semantic-real-model.mjs` failover 段 |
| 5 | 后台索引与前台争抢 CPU；查询排在整个索引批次之后 | **存在**。原 worker 只有一个串行队列（读代码确认）；实测 32 条长记录批次进行中，12 次查询预计算 0 次在等待上限内就绪 | worker 子进程降为低优先级；worker 内查询队列优先、文档逐条编码；Agent running 或刚有查询时推迟索引（有上限）；默认 2 线程、批次 8 | `indexing yields to foreground work, with a bound`；真实模型脚本"批次进行中查询全部在批次结束前得到回答" |
| 6 | worker 启动失败会被每个索引周期和每条消息重新拉起（每次重新校验 570 MB 模型哈希） | **存在**（读代码确认） | 启动失败指数退避（5 秒起，最长 5 分钟）；请求超时即回收卡住的 worker | `worker process lifecycle: crash, hang, failed start and recovery ...`（用协议相同的替身 worker 子进程） |
| 7 | 遗忘时旁路写入失败会让 Core 的 `forget` 抛错，或失败不可见 | **存在**（读代码：`invalidate` 内 `remove` 的异常被 Core 吞掉，无计数、无重试） | 先删内存条目（立即不可排序），失败计入 `invalidateErrors` 与 `lastError`，并触发下一周期的孤儿清理重试 | `a damaged sidecar is discarded and rebuilt; a failing sidecar write ...` |
| 8 | 删除的向量残留在 WAL 与空闲页 | **存在**（按字节检查确认） | `secure_delete=ON`，删除后 `wal_checkpoint(TRUNCATE)` | `a removed vector leaves no copy in the sidecar file or its write-ahead log` |
| 9 | 旁路文件损坏导致插件整体失败 | **存在** | 打开时 `quick_check`，损坏则丢弃重建；状态中 `indexer.recreated` 可见 | 同 #7 的测试；真实 Host 门禁第 8 段 |
| 10 | 错误信息可能带出本机绝对路径到状态工具 | 风险项（状态会被模型读取） | `lastError` 中的路径替换为 `<path>` | 无专门测试（仅读代码确认） |

另外：文档逐条编码后，同一文本的向量不再取决于和哪些文本同批（padding），建索引实测也更快（111 → 80 ms/条）。

## 改动范围

- `packages/character-memory-core`：`tokenize.mjs` 增加选择性词元；`store.mjs` 增加两个词元辅助函数；`layered.mjs` 增加扩展点（`setSemanticRanker`、`recallAsync`、`semanticCandidates`、`semanticOrphans`）、有效集合缓存、`recall` 的可选分支、入口处的预计算调用、失效通知；`layersStatus` 增加 `semantic` 字段。
- `packages/character-memory-tools`：`recall` 工具改调 `recallAsync`（无排序器时等价于原调用）。
- 新包 `packages/memory-semantic`（`dsh-memory-semantic`，独立版本 0.1.0-test.1）；打包/部署计划把它列为可选包，任何 Bundle 都不声明它。
- 新原生门禁 `scripts/stage-semantic.cjs` + `scripts/run-semantic.ps1` + `tests/semantic-host.mjs`；未加入必需门禁列表（需要预先准备模型）。
- 无 Schema 变更、无迁移、现有包没有新的运行时 npm 依赖。

## 配置与使用

1. **准备运行时与模型**（操作者手动执行一次；插件自身从不下载或安装）：

   ```sh
   node packages/memory-semantic/provision.mjs --runtime-dir <ABS>/semantic-runtime --model-dir <ABS>/semantic-models
   ```

   安装固定版本的 `@huggingface/transformers@4.3.2`（含 onnxruntime-node 预编译二进制，约 300 MB），下载 `Xenova/bge-m3` 固定 commit 的 4 个文件（约 590 MB）并逐个校验 sha256。离线环境用 `--from <已下载目录>`。已存在且哈希正确的文件不重复下载；被改动的文件会被替换。worker 首次启动时再校验一次哈希。

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
       # 可选：model、topK、minCoverage、prepareTimeoutMs、indexBatch、indexIntervalMs、
       #       maxIndexDeferMs、quietAfterQueryMs、sweepIntervalMs
   ```

   改用本机 HTTP 端点：`provider: {kind: http, baseUrl: 'http://127.0.0.1:11434', modelName: '<name>'}`，并在 `model` 中给出 `repo / revision / dtype / dim / pooling / minScore`。

3. **观察**：`*_layers_status` 工具的 `semantic` 字段给出模式、`modelVersion`、向量数、计数器（`ranked` / `notReady` / `lowCoverage` / `prepareTimeouts` / `prepareErrors` / `breakerSkips` / `empty` / `invalidateErrors`）、`indexer`（`indexed` / `removed` / `deferred` / `recreated` / `lastError`）、`worker`（`state` / `pid` / `rssMB` / `cpuMs` / `starts` / `startFailures` / `exits` / `requestTimeouts`）。Shadow 模式另有 `compared`、`meanOverlapAt5`、`sameTop1`、`semanticEmpty`、新旧平均返回条数。

4. **回退**：把 `mode` 改为 `off` 或删除该行，按正常插件生命周期重载；worker 随插件卸载结束（门禁实测）。`memory-vectors.sqlite`（及 `-wal`、`-shm`）可直接删除。不需要回滚 Memory 数据库。

## 验证结果

所有数据均为合成数据，运行于 Windows 11、Ryzen 9 6900HX、2 个推理线程。原始输出见 `docs/evidence/semantic-recall-d1-*.json`。

### 自动化（CI 可运行，无需模型）

- `npm test` 426/426，`npm run test:audit` 35/35。
- `tests/semantic-recall.test.mjs` 20 项。其中 embedder 是确定性测试替身，进程生命周期测试用协议相同的替身 worker 子进程（`tests/fixtures/semantic-worker-fixture.mjs`）。它们验证接线、安全与降级，**不代表检索质量**。
- 新增的 #1、#3 两项回归在修复前的 Core 上确实失败，在修复后通过。

### 真实模型脚本（`tests/semantic-real-model.mjs`）

真实 bge-m3 q8 worker + 真实 `LayeredMemory` + PR #26 的冻结数据集，S0 有效记录 473 条。在 Node 24.13 与 DSH 0.2.2-rc.1 可执行文件（Node 24.21 / Electron 44.7）上分别运行，检索结果完全一致，延迟差异在噪声内（下表为 Host 运行时）：

| | FTS5 | 语义（active） |
|---|---|---|
| 保留集 R@1 / R@5（83 条可回答） | 0.534 / 0.633 | 0.888 / 0.950 |
| 开发集 R@1 / R@5 | 0.440 / 0.576 | 0.735 / 0.932 |
| 保留集跨语言 / 中文同义 / 英文同义 R@5 | 0.00 / 0.50 / 0.25 | 1.00 / 0.93 / 0.88 |
| 近似重复标识符 R@1 / R@5（保留集） | 0.25 / 1.00 | 1.00 / 1.00 |
| 无相关记忆时返回条数（保留集） | 14.7 | 4.0 |
| 越权 / 遗忘 / 过期 / 旧修订正文返回 | 0 | 0 |
| `recall` 工具 p50 / p95（含查询 embedding） | 14.8 / 69.5 ms | 34.4 / 61.3 ms |
| 每轮 `context()` 同步耗时 p50 / p95 | 20.8 / 71.7 ms | 4.2 / 8.6 ms |
| 入口到查询向量就绪 p50 / p95 | – | 33.0 / 57.3 ms |

- 生命周期：新记录在建向量前可检索，建后可语义检索；更正后只返回新正文；遗忘后立即不可检索且向量已删；其他主体的原文查询不返回其记录。
- 故障（严格断言）：worker 停止、以及在编码批次中被 OS 杀死，两种情况下该次查询结果与 FTS5 完全相同（`ranked` +0、`notReady` +1），索引器报告错误，之后自动重启恢复，索引最终完整。
- 前台优先：32 条长记录的索引批次进行中（约 11 秒），12 条查询全部在批次结束前得到回答，p50 约 360 ms、p95 约 690 ms（等待正在编码的那一条）。这超过默认 250 ms 的等待上限，所以这段时间内的上下文会回到 FTS5；这正是"查询后静默期"存在的原因。
- 成本：worker 加载约 2 秒（首次另需校验哈希）；建索引约 80 ms/条，523 条约 42 秒；旁路索引约 12 KB/条（含 WAL）；Host 进程 RSS 约 80 MB（Node）/ 150 MB（Host 运行时）；worker RSS 0.8–1.0 GB。

### 真实 Host 门禁（`scripts/run-semantic.ps1`）

DSH 0.2.2-rc.1 原生 Host，隔离 Home，真实 cordis 加载器、真实 Agent 回合与系统上下文组装、真实 Memory Core 与工具、真实 embedding worker；对话模型是确定性夹具，记忆是合成的；不读生产数据、不连 QQ。62 条记录，全部 9 段通过：

1. Profile 中声明、`mode: off`：没有排序器、没有索引文件、没有 worker；`recall` 工具与 10 个真实回合走 FTS5。
2. `ctx.plugin` 加载 `shadow`：真实 worker 7.9 秒建完 62 条向量；上下文与 `recall` 结果与 FTS5 完全相同；记录 id 级比较统计。
3. 卸载：worker 进程结束、回到 FTS5；切到 `active` 复用已持久化的 62 条向量，不重算。
4. **入口到首次上下文的真实时序**：入口之后立即发出用户消息的 20 个回合里，12 个（60%）的首次上下文已使用语义检索，其余 8 个都是计数的 `notReady` 降级；入口与回合之间有 120 ms 间隔时 10/10。Host 在回合开始时立刻组装上下文，早于第一次模型请求（入口到首次模型请求 p50 约 100 ms）。
5. 原生工具：语义召回、标识符优先、无关查询返回空；更正后只出现新正文；遗忘后向量即删、不再返回。
6. 未授权 Preset 与伪造句柄在任何排序之前被拒。
7. 杀掉 worker：下一回合在 FTS5 上完成（`notReady` 计数），新 worker 自动启动后语义检索恢复。
8. 旁路文件写坏：重建为空库；重建期间回合照常（FTS5），之后恢复语义检索。
9. 最终卸载回到 FTS5。

回合耗时（夹具模型，主要是 Host 自身开销）：`off` p50 405 ms / p95 676 ms，`active` p50 404 / p95 451 ms，索引重建期间 p50 405 / p95 474 ms，即语义检索与后台索引没有拖慢回合。整个门禁 48 秒内 Host 进程 CPU 11.4 秒、RSS 223 MB；worker CPU 13.9 秒、RSS 1.36 GB。

## 剩余风险与未验证项

- **首次上下文覆盖率约 60%。** 门禁测得：入口后立即开始的回合，有 40% 的首次上下文因查询向量未就绪而用 FTS5。真实 QQ 入口到回合开始之间有多少间隔、Host 在一个回合内的后续模型请求是否刷新上下文，均未在真实 QQ 链路上测量。`notReady` 计数会如实反映，Shadow 期间应先观察它。
- **未在真实 QQ 入口和真实对话模型下验证**；Character Identity 与角色 Preset 的组合也未在门禁中出现（门禁用示例本地身份 Provider）。
- **语义门禁未加入必需门禁列表**：它需要预先准备约 900 MB 的运行时与模型，CI 中没有。
- **合成评测数据**与 PR #26 同源；真实对话上的收益与相似度下限需要 Shadow 观察后再决定是否切到 `active`。下限可能清空推断类查询的 L2 上下文（保留集 1 例）；L3 与主动 `recall` 不受影响。
- **索引期间的查询延迟**：worker 正在编码长记录时到达的查询要等它完成（实测最长约 0.7 秒）。静默期与 Agent 忙碌检测降低了发生频率，但不能消除；这时该回合回到 FTS5。
- **内存**：worker 加载时 0.8–1.4 GB；冷启动约 2 秒（期间 FTS5）。低配机器应保持 `off` 或缩短 `idleUnloadMs`。
- **首次启用**：存量记忆在后台逐批建向量，期间按覆盖率规则使用 FTS5；一万条约需十几分钟到一小时（取决于 Host 忙闲）。
- **索引器只覆盖本次运行中活跃过的作用域**（`activeContexts`）；从未活跃的作用域在其首次查询后才开始建向量。
- **多实例**：与 Core 一样假设同一数据库只由一个 Host 实例管理；多实例共享旁路文件未测试。
- **供应链**：运行时与模型文件版本固定并校验哈希，但 npm 依赖树本身未逐包审计。
- **平台**：仅在 Windows 上实测；macOS / Linux 依赖 onnxruntime-node 的预编译二进制，代码无平台相关路径，未实机验证。
- 未实现：L1 全历史语义检索、Inspector 界面。
