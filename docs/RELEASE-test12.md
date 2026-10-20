# test.12：Worker 收尾与 Memory Inspector 候选版

> 历史记录；当前状态统一见 [STATUS.md](STATUS.md)，部署与回滚按 [INTEGRATION.md](INTEGRATION.md) 执行。

2026-10-20。**源码已开发和隔离验证，未部署。** 本轮没有修改官方 DSH、生产配置、生产数据库或生产 Session，没有重启生产，也没有连接真实 QQ。现有上线记录仍为 test.11。

## 重新核实的接口

以本机安装包 `resources/app.asar` 为准：DSH `0.2.1-rc.2`，Node `24.21.0`。读取实际 `dsh-tool-subagent`、`dsh-subagent`、`dsh-subagent-spawn-in-process`、`dsh-agent-preset`、`dsh-tools`、`dsh-host-webserver`、`dsh-client-connection`、`dsh-api-gateway` 和 `dsh-compaction-basic` 实现。未使用上游主分支替代安装版本。

- 原生独立 Preset/Spawn 已可用，旧文档的版本阻塞失效。
- `tools.restrict()` 只过滤继承工具，不能单独限制新增 scoped 工具；新增 Worker 同时使用原生 monotonic guard，并实际验证晚挂载工具执行被拒绝。
- 原生 Web route 不自动进行业务认证；Inspector 主动调用 `connection.admit()`，再验证 Host Owner、loopback、同源与 Memory ACL。不能把挂载 Web 路由视为已认证。
- Web prefix 匹配会追加 `/`；使用 `/memory-inspector` 注册，避免尾部斜线导致 API 落到静态 fallback。
- 原生 setup 回调不能直接返回 `mount()` 的结果；测试使用显式 await，正确保留 Agent 初始化提交机制。

设计对照来自现有 `ARCHITECTURE.md` 和本机归档 v0.7.8 的 `DECISIONS.md`、`IMPLEMENTATION_ROADMAP.md`、`MODULE_IMPLEMENTATION_PLAN.md`。后三份此前未在公开源码 docs 根目录内，本轮补了精简的当前实现入口，不复制旧授权或私有运行内容。

## 完成内容

1. Core `worker-general`，可选 `worker-review`，原生 Spawn/独立 Session；主 Character 保留 Creator 工具/Skills/委派。Worker 无执行与 Memory 权限，操作请求以提案交主 Agent复核。
2. 可选 `dsh-memory-inspector@0.1.0-test.1`：L1/L2/L3、关联证据、过滤/分页、修订、确认/纠错/遗忘/受限恢复、任务状态与统计。
3. Core 增加授权 Inspector API，保留 Schema 3；恢复追加 revision，不解除纠错或遗忘屏障。
4. `characterIdentity.route(handle)` 返回持久会话路由及 generation，明确报告自动轮换关闭、Schedule 仍绑定 Session。
5. 构建配置支持专业 Worker，构建指纹包含 Worker/构建代码；打包纳入可选 UI，源码摘要纳入 JS/HTML/CSS。
6. README、架构、决策、路线图、模块说明、使用示例与回滚步骤同步。

构建使用公开示例角色与独立测试数据路径，已确认官方 Creator 的 23 个顶层插件保留、Character 为 24 个，`workerSupported=true`；Extras 文件哈希未变，`ensure-build --check` 通过。Inspector 独立包已生成到忽略的 `artifacts/inspector-candidate/`，未安装到生产。当前生成的 Core 是测试路径配置，生产部署必须按其真实私有构建配置重新生成，不能直接拿本轮测试 Core 上线。

## 实际测试结果

| 验证 | 结果 | 能证明的范围 |
|---|---|---|
| Character 单元与审计回归 | **120/120**，无跳过 | ACL、模式隔离、CAS、修订红线、遗忘后重开库、HTTP 安全、既有记忆/Interaction/通知逻辑 |
| QQTK 完整轻量+SDK 适配回归 | **36/36** | 4501/5001/10001 字符、流式/静态、频控、超时、取消、Owner、Remote Ops；合成传输 |
| 安装 SDK 审批/问答/文件边界 | **10/10** | Owner/nonce、取消/超时、卸载、文件 junction 越界、问答替换；未发送 QQ |
| 原生 DSH Core-only | **8 项通过** | Creator 工具一致、独立 Worker、冷恢复、工具攻击拒绝、跨 Session Memory、真实 Schedule 到期、自动抽取和 Compaction |
| 原生 DSH Core+可选组件 | **9 项通过** | 上述能力 + 专业 Worker + 原生 Web 登录/签名 Cookie/未登录与跨来源拒绝/实际 API 写入与 CAS/遗忘红线 |
| 原生 Interaction | **9 项通过** | 原生流式事件、气泡顺序、取消/steer、Web/QQ 路由与 Host 提示隔离 |
| 浏览器预览 | **部分验证** | 登录后的页面、统计、列表与详情呈现；最终二次点击管理流程仍需浏览器验收，不能以 API 通过替代 |

原生 Host 使用真正安装的 SDK/Agent Loop/Spawn/Compaction/Web 服务，模型输出来自确定性 LLM fixture，发送器为合成 transport。自动抽取断言绑定本次 ingress message ID，不使用旧结果；Compaction 必须返回 success 并实际生成 checkpoint，失败报告不能为 ok。所有 Host 结果绑定本次 runId。

隔离结果位于项目忽略目录 `test-data/inspector-*/result.json` 和 `test-data/interaction-*/result.json`。最终 Core-only runId `10d85e5b-2b9c-4276-abee-17f7fb12ebfd`；Core+可选组件 runId `3dc3f9ef-ff9c-481c-878b-61c0d3ab8f42`；Interaction runId `f5b6bbda-0e8a-4244-a1c7-8505151be038`。不提交测试数据库、登录材料或 Session 日志。

早期失败被保留并修正：测试源模块解析/Windows file URL、setup 返回类型、Web prefix、原生登录 303、确定性模型对无 system 的 Compaction 请求处理。没有通过删除断言、关闭功能或跳过权限检查获得最终结果。QQTK SDK 套件首次缺少隔离 fixture 环境变量，重新创建代码副本并完整执行后通过。

## 运行隔离测试

Node 24 下执行 `node --test tests/*.test.mjs tests/audit/*.test.mjs`。设置 `DSH_INSTALL_ROOT` 为实际安装目录后：

```powershell
./scripts/run-inspector.ps1
./scripts/run-inspector.ps1 --extras
./scripts/run-interaction.ps1
```

新脚本每次生成随机 `DSH_HOME`，不读取生产 Profile、角色或凭据；测试模型没有外部 API 调用。运行器只停止自己启动的进程。`--preview` 仅用于合成数据临时预览，最长约三分钟，不是部署命令。

## 尚未完成 / 风险

- Worker 是分析型，不是可读写仓库的专业执行 Agent；主代审批只有提案边界与既有审批单独回归，尚未完成真实 QQ 整链路。
- Creator 工具列表一致不能证明相同模型任务成功率完全不变；真实模型 A/B、长期记忆归纳质量需要后续验收。
- 自动轮换和稳定 Schedule 目标未完成；旧 Schedule 继续绑定原 Session。本轮没有完整进程重启下的待办提醒演练，也没有迁移旧提醒。
- UI 当前是同源页面，无 DSH 侧栏/桌面 file:// 内嵌入口；最终浏览器操作验收未完成。离线未授权 Agent 不可管理。
- 大库 browse/统计仍有作用域扫描，未新增全库规模性能保证；没有向量检索、批量管理或多用户认证。
- Schema 3 兼容测试及重开库通过，不等于已执行生产回滚或生产迁移演练。

## 候选部署与回滚（须另行批准）

1. 审阅候选 diff、复跑隔离测试；补最终浏览器管理操作验收。检查目标 DSH 实际 SDK 与本轮一致。
2. 确认生产空闲、无审批/Worker/关键投递，取得维护锁；一致性备份 Profile、锁文件、插件产物、Sessions、Memory/WAL、路由与 outbox。保留 test.11 产物及校验清单。
3. 重新构建 Core，核对 Creator 指纹、`worker-general` 和允许名单；按需选择 `worker-review`。安装独立 Inspector 包后仅在 Extras/Profile 声明一次，初始只读，不新增 QQ 条目。
4. 用户批准后按既有单活 Stage/cutover 流程部署；验证基础 Agent、原生 Worker、Memory、Schedule、唯一 Gateway、审批与通知，再按授权进行手机测试。
5. 管理 UI 可单独禁用，无数据库迁移。若需回退核心，先保存部署后新增状态，停止候选并恢复已封存的 test.11 配套配置/包；避免恢复旧数据库覆盖新数据。官方 DSH 不需修改或降级。

本轮不执行上述生产步骤。当前可作为隔离候选交付；在浏览器最终操作和生产验收完成前，不应标为“生产完整验收”。

## 内嵌管理页补充验收

Inspector 已替换为 DSH 原生 **设置 → 记忆管理**，不再提供独立页面。之前关于外置页面、缺少内嵌入口和浏览器操作未完成的记录，已由 [原生 UI 验收](INSPECTOR-NATIVE-UI.md) 更新。网页实际点击已通过；桌面模块装配与官方转发代码通过隔离验证，未操作生产桌面窗口。仍未部署。
