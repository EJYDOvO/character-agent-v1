# D1：L2 语义记忆检索

目标 Host：DSH 0.2.2-rc.1 / Node 24 / Windows。基线：`main` 合并 PR #25（角色卡 V3）之后的 `fcaac79`。选型依据见 [研究归档](research/retrieval-d/ARCHIVE.md)（PR #26）。本文描述源码行为与实测结果；某个实例是否已部署、是否已准备模型，以该实例的 `*_layers_status` 为准。

## 概要

给 L2 已提炼记忆的检索增加语义排序：本地 Dense Embedding（bge-m3 q8）为主，带编号的标识符精确命中置顶，相似度下限过滤无关内容。L1（证据追溯）、L3（核心投影）、写入、提取、巩固、Schema 3 都没有改动。

| 模式 | 行为 |
|---|---|
| `active`（**Character 构建默认**） | 每轮自动上下文与 `recall` 工具使用语义排序；任何异常回到 FTS5 |
| `shadow` | 建向量并比较新旧结果，调用方拿到的始终是 FTS5 结果；只记录 id 级统计 |
| `off` | 不加载任何东西；`recall` 逐字节走原 FTS5 路径 |
| `unavailable`（状态，不是配置） | 请求了 `active`/`shadow`，但模型、运行时或索引无法使用：Memory 照常运行在 FTS5 上，状态给出原因 |

## 默认开启在哪些情形下生效

`scripts/build.cjs` 生成的 Character Core 总是声明 `memory-semantic` 行；`dsh-memory-semantic` 是必需包，打包、部署计划（`scripts/package-plan.cjs`、`scripts/deployment-plan.cjs`）和 portable 安装（`scripts/portable.cjs`）都会带上它。

| 情形 | 结果 |
|---|---|
| 正常 Character 构建（生产 `manage.ps1` 流程或 portable），模型已按默认路径准备 | `active` |
| 同上，模型未准备 | 状态 `unavailable`（原因：`Embedding runtime is not provisioned` 等），检索为 FTS5，Host 与 Memory 正常启动 |
| 构建配置 `semanticRecall.mode: shadow` / `off` | 对应模式 |
| Profile 中覆盖 `memory-semantic` 行 | 以覆盖为准。注意 Host 的 Profile 覆盖会**整体替换** `config`，覆盖时要写全 `indexFile` 与 `provider` |
| 不使用 Character 构建、自己组装 Profile 且没有声明该插件 | 无语义检索（与以前相同） |
| 插件声明了但没写 `mode` | `active`（插件默认值） |

默认路径：运行时 `<安装根>/data/semantic-recall/runtime`，模型 `<安装根>/data/semantic-recall/models`，索引 `<角色 dataDirectory>/memory-vectors.sqlite`。portable 安装的安装根是它的 Home。

## 架构

```
可信句柄 ─► Memory Core：有效集合（身份 / ACL / 状态 / 过期 / 证据 / 遗忘屏障）   权威
                │ 只把 {id, revision, fingerprint} 交给排序器
                ▼
        dsh-memory-semantic
          排序器 ── 旁路 memory-vectors.sqlite（memoryId, embeddingModelVersion → revision, contentHash, 向量）
             │
          Provider ── 独立子进程 worker（onnxruntime + 模型），或本机 HTTP 端点
                ▼ 只返回 id 的顺序
        Memory Core：标识符 FTS 置顶 → 待建向量的词面命中 → 相似度顺序
                     → 按 id 用原谓词重新读取行 → 冲突标注 → 去重与预算（不变）
```

1. **Core 只有一个与模型无关的扩展点**（`setSemanticRanker`）。排序器拿不到正文、作用域或来源；它返回的 id 若不在当前句柄的有效集合里会被丢弃；返回的每一行都由 Core 用原有 SQL 谓词重新读取。提取与巩固的查重保持词面路径。
2. **推理在独立子进程**，用 Host 自己的可执行文件以 `ELECTRON_RUN_AS_NODE=1` 启动、低于正常优先级运行，只传最小环境变量。worker 内查询优先于文档索引，文档逐条编码。空闲 30 分钟卸载。请求因 worker 刚刚死亡而失败时，丢弃旧 worker、在新 worker 上重试一次；启动失败指数退避；请求超时回收卡住的 worker。
3. **同步/异步边界。** 上下文 Provider 是同步的。查询向量在可信消息入口（`noteInput`）处开始计算；Memory Tools 挂在 Host 会 `await` 的 `system-prompt/assemble` waterfall 上（与 Host 自带的 `dsh-working-directory` 同一模式），向量仍在计算时在排序器上限（默认 250 ms）内等待并只重算记忆条目；worker 未加载时不等待。实测 Host 在发送首次请求前还会再解析一次上下文，见下文时序。
4. **不用 RRF、Reranker、ANN、向量数据库**（研究实测：不优于单独 Dense；一万条精确扫描约 20 ms）。扫描范围始终是 Core 给出的有效集合。
5. **后台索引让路**：Agent 运行中或刚收到查询（2 秒内）时推迟，最长推迟 120 秒。

### 索引一致性

| 事件 | 处理 |
|---|---|
| 新记忆 | 未建向量前即可经词面命中返回；后台随后补建 |
| 更正 | 同一调用内删除旧向量；残留向量因 `contentHash` 不符不参与排序；只会返回新正文 |
| 遗忘 / 过期 / 合并 | 同一调用内删除向量；旁路写入失败时内存条目已删、计入 `invalidateErrors`，孤儿清理按**磁盘上持久化的行**重试删除 |
| 仅修订号变化 | 内容哈希不变则向量相同：重新绑定，不重算 |
| 影响向量的配置变化 | `embeddingModelVersion` 覆盖 revision、量化、池化、前缀、维度、运行时版本、Provider 身份；变化后旧向量在打开时删除，覆盖率不足 90% 期间用 FTS5 |
| Provider 故障 | 抛错、超时、维度错误、NaN、崩溃：与 FTS5 完全相同；连续 3 次失败熔断 30 秒 |
| 旁路文件损坏 | 打开时检测，丢弃并重建；重建期间 FTS5 |
| `indexFile` 误配 | 指向 Memory 主库或其 `-wal`/`-shm`/`-journal`（含相对路径、硬链接、目录联接）一律拒绝；指向任何含其他表的 SQLite 文件也拒绝，绝不写入或删除；指向非 SQLite 文件（无 SQLite 文件头）同样拒绝，不当作损坏的旁路文件删除 |

旁路文件是正文的有损副本：开启 `secure_delete`，删除后截断 WAL（有测试按字节检查）；截断被其他连接挡住时保留待清理标记、下一轮重试，不占用线程等待。旁路删除失败时，孤儿清理在下一轮重试直到成功。删除该文件不丢任何事实。从备份恢复旧副本也不能让已遗忘记录重现，下次孤儿清理会删掉不匹配的条目。

HTTP Provider 只接受回环地址（除非 `allowRemote: true`），**不跟随重定向**（否则本机端点返回 307 就能把记忆正文转发到它指定的主机）。

## 配置与使用

1. **准备模型**（每个安装一次；插件自身从不下载或安装）：

   ```sh
   DSH_INSTALL_ROOT=<安装根> DSH_CHARACTER_BUILD_CONFIG=<构建配置> node scripts/provision-semantic.cjs
   ```

   按构建配置解析路径，安装固定版本的 `@huggingface/transformers@4.3.2`（含 onnxruntime-node，约 480 MB），下载 `Xenova/bge-m3` 固定 commit 的 4 个文件（约 590 MB）并逐个校验 sha256。离线用 `--from <已下载目录>`。worker 首次启动时再校验一次。

2. **构建配置**（可选，全部有默认值）：

   ```json
   "semanticRecall": {"mode": "active", "runtimeDir": "<ABS>", "modelDir": "<ABS>", "threads": 2}
   ```

   portable 配置同名键，路径相对配置文件。

3. **观察**：`*_layers_status` 的 `semantic` 字段：模式、`modelVersion`、向量数、计数器（`ranked`、`notReady`、`contextWaits`/`contextRecovered`/`contextWaitSkipped`、`prepareTimeouts`、`prepareErrors`、`breakerSkips`、`lowCoverage`、`invalidateErrors`）、`indexer`、`worker`（`state`、`pid`、`rssMB`、`cpuMs`、`starts`、`exits`、`retriedAfterExit`、`requestTimeouts`）。`unavailable` 时给出 `requested` 与 `reason`。

4. **回退**：构建配置或 Profile 设 `mode: off` 并重启 Host；`memory-vectors.sqlite*` 可直接删除。不需要回滚 Memory 数据库。

## 本次集成复审（基于 `fcaac79`）

| 项 | 是否属实 | 依据 | 处理 | 回归测试 |
|---|---|---|---|---|
| A 旁路 DELETE 失败后的持久化清理 | **属实** | 用另一连接加排他锁制造真实 `DELETE` 失败：旧实现重试后行仍在磁盘（孤儿清理只看内存缓存） | `entries()` 读持久化行 | `a sidecar DELETE that fails after the in-memory entry is gone …` |
| B 首次上下文覆盖率 60% | 部分属实，原因不是同步 API | 见下文时序；真实缺陷是 worker 被杀后的下一请求与退出事件竞争，失败后 worker 不重启 | waterfall 有界等待（worker 未加载时跳过）；死亡 worker 重试一次 | `the per-turn context can wait, with a bound …`、`a request that meets a worker which just died …`；原生门禁 active 阶段 |
| C `indexFile` 指向主库 | **属实** | 旧实现会在主库建表，遇 malformed 时删除该文件 | 路径/inode 隔离 + 拒绝外来数据库 | `indexFile can never be the Memory Core database …` |
| D HTTP 重定向 | **属实** | 本机 307 → 另一端口：旧实现发送了正文 | `redirect: 'error'` | `the HTTP provider never follows a redirect …` |
| E ACL / 命名空间 / 项目隔离 | 无新问题 | 既有隔离测试 + 原生门禁未授权句柄 | — | 既有测试 |
| E `semanticOrphans()` 作用域 | 上一轮已修 | — | — | `orphan sweep follows the root scope …` |
| E `merge` 一致性 | 无缺陷 | 合并后两侧向量都被删除，存活记录几秒内重建，期间与 FTS5 一致 | — | `merge invalidates both vectors …`（新增） |
| E 模型版本 / 回退 / 新记录 / 标识符 | 无新问题 | 既有测试 | — | 既有测试 |
| E 与 #25 角色卡 / Character Preset / Identity 组合 | 无问题 | 原生门禁改用 Character 组合与 Character 入口 | — | `scripts/run-semantic.ps1` |
| 默认开启时缺模型 | 原为只记日志、状态显示 `off` | 状态不可观测 | `unavailable` 状态 | `without a mode the plugin runs active; a missing model …` |

## 验证结果

全部为合成数据；Windows 11、Ryzen 9 6900HX、2 个推理线程。原始输出：`docs/evidence/semantic-recall-d1-*.json`。

### 自动化

`npm test` 508/508，`npm run test:audit` 35/35（其中 `tests/semantic-recall.test.mjs` 29 项，embedder 为确定性替身、进程生命周期用协议相同的替身 worker：只验证接线、安全与降级，不代表检索质量）。CI（Ubuntu、Windows）以 PR 最终提交的运行结果为准。

### 真实模型（`tests/semantic-real-model.mjs`，bge-m3 q8）

真实 worker + 真实 `LayeredMemory`，[冻结评测集](../tests/fixtures/semantic-eval/)（S0 有效记录 473 条）。Node 24.13 与 Host 运行时（Node 24.21 / Electron 44.7）结果一致：

| 保留集（83 条可回答） | FTS5（未修改） | 语义 |
|---|---|---|
| R@1 / R@5 | 0.534 / 0.633 | 0.888 / 0.950 |
| 跨语言 / 中文同义 / 英文同义 R@5 | 0.00 / 0.50 / 0.25 | 1.00 / 0.93 / 0.88 |
| 近似编号 R@1 | 0.25 | 1.00 |
| 无相关记忆时返回条数 | 14.7 | 4.0 |
| 越权 / 遗忘 / 过期 / 旧修订正文返回 | 0 | 0 |
| `recall` 工具 p50 / p95 | 约 14 / 70 ms | 约 34 / 63 ms |
| 每轮 `context()` 同步耗时 p50 / p95 | 约 18 / 63 ms | 约 4.6 / 12 ms |

开发集语义 R@1 / R@5 为 0.735 / 0.932。生命周期、严格故障检查（停止；编码批次中被杀，由新 worker 完成）、索引期间查询优先（12/12 在批次结束前得到回答）全部通过。

### 原生 Host 门禁（`scripts/run-semantic.ps1`，提交 `d2b2261`）

DSH 0.2.2-rc.1 原生 Host、隔离 Home，每个阶段一个 Host 进程。Character 预设（模板角色卡渲染的 Persona）、Character Identity、Memory Core、Memory Tools，语义行由与构建相同的生成器产出；消息经 Character Identity 的可信入口进入。对话模型是确定性夹具，QQ 传输是夹具。四个阶段全部通过，连续两次运行结果相同：

| 阶段 | 结果 |
|---|---|
| active（默认） | 真实 worker 7 秒建完 62 条；首次上下文语义命中 **20/20**（两次运行均如此）；工具：语义召回、标识符优先、无关查询为空；更正只返回新正文；遗忘即删向量；未授权句柄被拒；杀 worker 后计数回退并恢复 |
| shadow + 写坏的旁路文件 | 识别并重建；上下文与 `recall` 与 FTS5 完全相同 |
| off | 无排序器、无 worker；FTS5 行为；派生索引保留不动 |
| unavailable（默认行，模型目录不存在） | Host 与 Memory 正常启动；结果与 FTS5 相同；状态 `unavailable`，原因 `Embedding runtime is not provisioned` |

**入口到首次请求的时序**（active，暖机，逐事件记录）：

| 距可信入口 | 事件 |
|---|---|
| 约 60 ms | 回合开始，Host 同步解析上下文；查询向量通常还在路上（计一次 `notReady`） |
| 约 62 ms | assemble 钩子；此时向量一般已到达，无需等待 |
| 约 95 ms | Host 发送前再次解析上下文 → 语义命中 |
| 约 105 ms | 首次模型请求（p50 105 ms，p95 126 ms） |

同一 Host 中让等待钩子失效的对照实验同样是 20/20：在这台机器与这条入口上，命中来自 Host 的二次解析，钩子只在向量晚于二次解析到达时起作用（shadow 阶段观察到 1 次等待后恢复）。

**此前 60% 的真正原因**：worker 被杀后，下一请求与子进程退出事件竞争，被发往已死的 worker 而失败，之后没有请求触发重启，加载期间的消息全部回退。修复后被杀到重新启动 < 1 ms、约 1.6 秒就绪。

**冷 worker**：worker 未加载（空闲卸载后或刚崩溃）时的第一条消息回退 FTS5，首次请求约 230 ms（加载需 1.5–3 秒，不等待）。

**资源**：回合耗时 active p50 394 ms / off 390 ms / shadow 406 ms（夹具模型，主要是 Host 自身开销）；Host 进程 RSS 约 260–280 MB；worker RSS 约 1.0 GB（shadow 重建期间 1.36 GB）。

## 剩余风险与未验证项

- **未在真实 QQ 网关与真实对话模型下验证。** 门禁用 QQ 会话管理器夹具驱动 Character Identity 的真实入口代码；真实网关之前还有 Interaction 等插件，时序可能不同。上线后看 `notReady` 与首次上下文表现。
- **冷 worker 的第一条消息总是 FTS5。** 设 `idleUnloadMs: 0` 可让 worker 常驻（约 1 GB）。
- 语义门禁不在必需门禁列表中：需要预先准备约 1 GB 运行时与模型。
- 评测集为合成数据；相似度下限 0.469 来自研究开发集，真实数据上可能需要重新标定（可先用 `shadow` 观察）。下限可能清空推断类查询的 L2 上下文。
- 索引进行中到达的查询最多等待一条正在编码的记录（实测 p95 约 0.6–0.8 秒），超过上限时该回合回到 FTS5。
- 首次启用时存量记忆在后台逐批建向量；一万条约十几分钟到一小时（取决于忙闲）。索引器只覆盖本次运行中活跃过的作用域。
- 合并会让存活记录的向量也被删除并在几秒内重建（无正确性影响）。
- 多实例共享同一旁路文件未测试。npm 依赖树未逐包审计。仅在 Windows 上实测。
