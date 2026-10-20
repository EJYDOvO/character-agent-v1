# test.12 候选审计与修复：T01–T15

日期：2026-10-20。基线提交 `91d37a0b4b88173c6728763ab2362d0022624495`；本文件所在修复提交包含本轮代码。测试不是对旧提交的直接认证：运行时工作区已有修复，性能记录同时保存 Memory Core SHA-256 和 dirty 标记。

最终 npm 与原生 Extras 验证使用相同代码摘要 `94beb322a365220140273d273cba20e15a6976c85bfe3285c0b1fc03e0e9fcae`（packages/scripts/tests）；原生运行 ID `8f460780-7ca6-4bf9-baee-0b54518bd305`。证据由 `scripts/audit-evidence.cjs` 生成，原始报告和含私有设定的测试 Session 不公开。

实际安装基线：Windows、DSH `0.2.1-rc.2`、Node `24.21.0`、QQ Bot `0.5.2`、QQ SDK `1.0.5`。当前运行 Profile 的 Character/Core 仍为 `0.1.0-test.11`，没有安装 Inspector。本轮没有改动该 Profile、生产记忆或 Session，也没有连接真实 QQ；官方 DSH 文件未修改。真实模型对照仅将已有角色设定和合成任务发送到已配置模型，私有模型配置留在忽略的测试目录，不进入仓库。

**结论：确认的源码问题已修复，发布门禁未全部完成。不能标记为已部署或完整发布验收通过。** 没有在本轮覆盖范围内发现已复现 P0；这不代表完整系统无潜在问题。

## 确认问题与修复证据

下列位置为修复后的源码入口，旧行为以基线提交比较。源码路径均相对仓库根目录。

| 级别 / 项目 | 触发与影响 | 修复 / 证据 |
|---|---|---|
| P1 / T01，已复现 | Assistant 人格化记录经确认、遗忘后，内部可见性读取了已经脱敏的 `source`，丢失 `memoryPolicy`；`get/trace` 拒绝原本可见的脱敏元数据，Stats/Browse 也可能抛异常 | `packages/character-memory-core/layered.mjs:60`：在已授权精确作用域内读取原始策略字段，再统一公开脱敏。新增测试覆盖 Off→Assistant→Character、SQLite 重开、正文/来源/引用屏障 |
| P1 / T03，确认缺陷 | 过期记录的正文被隐藏，但 `trace` 只依据 evidence 自身 active 状态决定是否返回 body；未触发过期整理时可能仍有证据正文 | `layered.mjs:184`：必须同时满足当前记忆有效与证据 active。测试覆盖过期、手动退休证据、详情、旧修订恢复 |
| P1 / T01、T03，已复现 | 自由文本 `claim_key` 可以复制正文；遗忘后仍可通过该字段读回，退休经历也暴露原始 message/source 标识 | 失效记录及历史修订隐藏 claim key/正文指纹；退休 L1/trace 仅保留治理 ID、状态、类型、时间和 redacted 标记；纠错后的 claim key 若命中退休正文指纹也不再公开。内部策略和冲突分组继续使用原始记录，新增全读取路径回归 |
| P1 / T14，确认缺陷 | 旧回滚脚本无条件恢复 checkpoint 数据库；升级后新记忆虽被移到备份目录，却不再存在于当前可用数据库 | `scripts/rollback-memory.cjs`、`scripts/rollback.cjs:13`：对当前数据库做一致副本，用旧运行时验证 Schema 与记忆/修订/屏障内容不变；兼容则保留当前库，不兼容则拒绝自动回滚。实际 CLI 在合成安装根目录通过 |
| P1 / T14，已复现 | Profile 切换在绑定/路由写入后失败时，旧 catch 未恢复 binding；可能留下旧 Profile 配新身份配置 | `scripts/switch-profile.cjs:8`：备份并恢复 binding、policy、QQ prefs 和 Profile。测试明确断言到达预期写入后的故障点，不能以目录权限异常代替成功演练 |
| P2 / T04，已复现 | 把整个 L3 容器当一条记录；空投影 total=1，筛选和分页未作用到实际条目 | `layered.mjs:187`：按有效投影引用逐条展示；分页、total、筛选、引用修订和正文一致，空投影 total=0。现有 projection API 保持兼容 |
| P2 / T05，已复现 | Jobs 的可搜索正文为空，非空关键词永远不匹配 | `layered.mjs` 的 Jobs 分支：搜索 ID、状态、类型、白名单错误码及固定安全描述；Extraction/Consolidation 合并时间排序，不公开原始异常/任务输入 |
| P2 / T06，确认缺陷 | 不同层级沿用同一类型/状态条件，易错误空列表；日期是无时区字符串；过期 L2 仍显示“有效” | `packages/memory-inspector/client.js:11`：分层菜单、切层清空 kind/status、本地日界转 ISO；服务端拒绝无时区日期。L2 明确显示/筛选 expired、invalidated，与正文脱敏一致 |
| P2 / T07，静态高可信缺口并补强 | 仅使用 React busy 状态，同一渲染周期内可能重复提交；离开页面只屏蔽结果，没有主动取消请求 | `client.js:23`：同步 ref 提交锁、页面级 AbortController，沿用版本序列隔离；延迟响应、切换作用域、重复提交、卸载/HMR 测试通过 |
| P2 / T08，已测量 | Stats 复用完整 Browse、逐条可见性/有效性/支持数查询，L3 在每次读取重复扫描；1 万条合成记录明显阻塞 | SQL 授权筛选和分页、直接统计、倒排证据/作用域/过期索引、合并支持数查询；L3 缓存校验 SQLite 本连接修改数、其他连接 data_version、时间和模式。缓存不能替代每次 Host 授权 |
| P2 / T14，确认缺口 | 只按主版本匹配六个包，遗漏独立版本 Inspector/Interaction；打包结果可能不对应当前源码；停机后才检查多数证据 | `scripts/package-plan.cjs`：显式八包、各自版本、源码摘要及产物哈希；`prepare-deploy.cjs:24` 正确区分 native insert 与已有 Bundle 覆盖、初始只读；停机前预检。停机后异常补充恢复启动路径，完整真实切换仍未验收 |

T02 未复现 ACL 绕过；T03 未复现 CAS 或同内容恢复限制绕过。没有为了“修复”而替换已有授权/版本治理体系。

## T01–T15 验收状态

| 项目 | 当前结果 | 尚未证明的范围 |
|---|---|---|
| T01 | 已验证：创建、确认、遗忘；四种读取；模式切换和重开；正文及来源隐藏 | 异常损坏数据库不在本轮范围 |
| T02 | 已验证：8 个 API 的未登录/非 Owner/撤销 Cookie；伪造 context/身份字段；撤销 capability；跨 Agent/项目/用户/角色的人格化访问拒绝 | Host Owner 本就是本机管理员；合法共享的通用 L1/L2 不应误判成越权；不是多租户 GUI |
| T03 | 已验证：两个 SQLite 连接的旧 revision 冲突、纠错/遗忘/过期/退休来源、追加恢复修订及重开 | 大量并发写入压力没有覆盖 |
| T04 | 已验证：逐条 L3、关键词/类型/状态/日期、offset/limit、引用一致性、空投影 | L3 仍最多 12 条、约 1200 Tokens；GUI 每页 20 条，API 小页分页另有测试 |
| T05 | 已验证：ID/状态/错误关键词；网页 `done` 命中；安全错误码和描述 | 不搜索私有原始任务 payload |
| T06 | 已验证：各层菜单、切层清理、日期本地日界→带时区 ISO；网页当天筛选 | 不同浏览器时区的跨系统实机矩阵未跑 |
| T07 | 已验证：网页实际搜索/翻页/详情/确认/恢复/纠错/遗忘；模拟延迟、乱序、快速切 Agent/层级、重复提交、卸载和 HMR 清理 | 完整 DSH 模块热卸载过程中双端窗口操作尚未完成 |
| T08 | 已验证：100/1,000/10,000 行基线，冷投影和写后重建单独测量 | SQLite 仍同步；1 万条写后重建 P95 约 116ms，不能声称无事件循环阻塞 |
| T09 | 已验证：真实 native Spawn、独立 Session/Preset、非法 Preset、后挂载 Scoped Tool guard、Memory 伪造能力、非父 Agent 通信拒绝、冷恢复、Core-only/Extras | 工作者返回提案，主 Agent 再审批；真实 QQ 主代审批未重新点击 |
| T10 | 部分：相同实际模型、相同查询工具与执行守卫，2 个任务×2 个 Preset 均完成；实际 Token 统计如下 | 不是完整能力评测；复杂任务、真实审批和委派质量 A/B 尚缺 |
| T11 | 原测试全部保留通过；原生提取/Compaction/Interaction/通知通过；新增两个独立 Host 进程的 Schedule 创建/取消/到期/原 Session 恢复通过 | 真实 QQ 网络及手机按钮未测；后台 LLM 巩固质量仍需长期样本 |
| T12 | GitHub Actions 已加入 Linux/Windows Node 24 的 npm test、test:audit，记录 GitHub SHA/Node；本地两个入口通过 | 工作流尚未在 GitHub runner 执行，不能视作远端 CI 已绿 |
| T13 | Web 设置内真实操作通过；真实安装包的 Desktop relay 对隔离 Host 执行成功，Cookie/Origin/未授权边界通过 | 当前自动化接口不能操作原生 Desktop 窗口；完整 Desktop UI 与真实 Host HMR 卸载仍待验收 |
| T14 | 八包清单/防旧产物、失败 Profile 复原、实际回滚 CLI、原 test.11 Memory 运行时前向/回退数据兼容通过 | 未执行完整新 Profile 的 pnpm 安装/锁文件/QQ 单实例切换；停机异常恢复启动分支仅语法检查，不能等同实机演练 |
| T15 | 未进入：当前仍 test.11，Inspector 未装；未开启 GUI 写入 | 发布门禁尚未齐备；真实 Desktop/QQ 验收不能由 Mock 证明 |

## 测试记录

- `npm test`：110 项；`npm run test:audit`：33 项，合计 **143 项**，无删除、无跳过。所有最终断言通过。早期失败保留在本机隔离记录，不能混入最终通过数量。
- QQTK 基础及 SDK 审计：**36/36**；实际 Electron/DSH SDK 加载的审批、问答、白名单与文件边界：**10/10**。没有创建 QQ Gateway。
- 原生 Core-only：8 项；Core+Extras：11 项。Worker/权限、提取、Compaction 与 outbox 使用真实 Host，模型/发送器为测试替身。
- 原生 Interaction：9 项通过；另外原生重试探针确认一次最终交付，没有把 abandoned attempt 当正式结果。
- Schedule 两进程：创建和取消通过，进程停止后恢复同一 Session；持久提醒只向同一合成 Owner 投递一次。
- 原 test.11 Memory 来源提交 `60393083cdd1c15e8f504cbfcef06f34e4498bfe`：升级前记录、升级后新增记录、遗忘后回退旧代码均验证。
- JS 语法、PowerShell parser 和 Git diff 空白检查通过。没有在真实安装上执行 `deploy.ps1` 或回滚脚本。

可复跑入口：

```powershell
npm test
npm run test:audit
node tests/inspector-benchmark.mjs
$env:DSH_INSTALL_ROOT = '<absolute-install-root>'
./scripts/run-inspector.ps1
./scripts/run-inspector.ps1 --extras
./scripts/run-inspector.ps1 --extras --preview
./scripts/run-schedule-restart.ps1
./scripts/run-interaction.ps1
./tests/audit/run-host.ps1
# 明确使用已配置模型；当前辅助脚本支持该实例的 Navigator 凭据名。
./scripts/run-inspector.ps1 --real-model-ab
```

预览、实时模型与原生宿主探针不是 npm 单元测试。`--real-model-ab` 会私下复用模型路由/凭据和已有角色设定，仅允许合成查询工具执行，不授予 Worker 或 GUI 新权限。其测试 Session 及可能包含设定的日志不能发布。

## 性能基线

合成记录由直接 SQL 生成，有 scope/evidence link，没有实际用户数据；普通语义记忆，无高密度冲突或大 tombstone 历史。最终基线单独运行，避免同时执行原生宿主和全套测试的负载干扰。每个常规测项 25 次；冷投影每规模 1 次。吞吐是单进程顺序执行倒数，不是并发 HTTP 吞吐。

| 行数 | Browse P50/P95 ms | Stats P50/P95 ms | 热 L3 P50/P95 ms | 写后 L3 P50/P95 ms | 冷 L3 ms |
|---|---:|---:|---:|---:|---:|
| 100 | 0.81 / 1.87 | 0.55 / 1.00 | 0.42 / 0.67 | 2.78 / 3.60 | 16.07 |
| 1,000 | 3.25 / 3.84 | 0.65 / 1.38 | 0.49 / 0.76 | 10.39 / 12.52 | 11.13 |
| 10,000 | 46.79 / 49.56 | 6.46 / 7.01 | 0.95 / 1.49 | 104.80 / 115.96 | 114.15 |

1 万条顺序吞吐：Browse 21.2/s、Stats 154.4/s、热 L3 1046.6/s、写后 L3 9.45/s。对应事件循环延迟 P95：49.61 / 7.04 / 13.95 / 116.00ms；定时器指标包含 Windows 调度粒度，低延迟场景约 15ms 不是纯 CPU 阻塞。优化前 3 次诊断样本约为 Browse 345ms、Stats 896ms、Projection 559ms；样本量不同，不用于宣称严格提升百分比。

后续性能重点是将大库冷重建移出交互热路径，而不是放宽 ACL、遗忘屏障或返回旧投影。

## 实际模型小样本对照

Navigator / `gemma-4-31b-it`；Character 使用已有真实角色设定。两组可见工具均为 `ab_lookup/subagent`，单调守卫只允许无副作用的 `ab_lookup` 执行，防止测量意外扩展到主机操作。原生完整 Creator 工具可见性对照另有真实宿主测试。

| Preset / 任务 | 完成 | 查询调用 | 时间 ms | 输入 / 输出 Tokens（各请求累计） |
|---|---|---:|---:|---:|
| Creator / 计算 | 是 | 0 | 1377 | 2407 / 15 |
| Character / 计算 | 是 | 0 | 1359 | 3901 / 7 |
| Creator / 查询 | 是 | 1 | 2481 | 4857 / 31 |
| Character / 查询 | 是 | 1 | 3036 | 7845 / 27 |

数据来自同次实际 `assistant/message.usage`。Persona 增加约 1494 输入 Tokens/请求；角色化未破坏这两个任务，但样本太小，不能推出复杂执行、审批、委派无退化。该门禁仍为部分完成。

## 发布、迁移与回滚

1. 本轮 Schema 仍为 3，只增加可重复创建的索引。首次打开需要数据库写入权限；先备份，不能直接拿只读副本当升级运行库。
2. 新 `package-source.json` 包含八个本项目包的版本和哈希；旧格式必须重新打包。已有不可变包若内容变化，应分配新发布版本，不覆盖旧包。
3. `prepare-deploy.cjs --inspector` 初始强制 `writable:false`。已有 Extras 声明只加覆盖，不再插入同一插件；空实例使用 native insert。不会自动开放 GUI 写权限。
4. Preflight 在停机前核验源码/产物/测试证据；后续仍需维护锁、空闲确认、一致性备份、离线检查、单实例切换和健康检查。当前新探针结果不自动冒充旧生产部署门禁文件。
5. UI 回退先禁用 Inspector；Core、自动整理、QQ 和旧提醒应继续运行。Core 回退用旧代码检查当前库副本；兼容则保留最新库、WAL 和治理屏障，不再自动替换成旧 checkpoint。兼容性验证失败应保持停止并人工制定恢复，不强行降低 Schema。
   Schema/数据兼容不表示旧 Core 拥有本次新增的脱敏修复。回退旧 Core 会重新带回旧版本的读取缺陷；需要继续保持本次隐私保证时，应优先只回退/禁用 Inspector，保留修复后的 Core。
6. 完整 Profile/锁文件安装演练、实际 Desktop 窗口、真实 QQ/审批和 GitHub CI 仍需补齐。当前不启用 GUI 写入，不宣称正式发布条件已满足。

本轮未重写 Memory 引擎、未新增 Planner/数据库、未放开 Worker 工具、未启用自动 Session 轮换或主动聊天。
