# test.8：本机 SDK 与接口核对

> 历史记录；当前状态统一见 [STATUS.md](STATUS.md)，部署与回滚按 [INTEGRATION.md](INTEGRATION.md) 执行。

日期：2026-10-19。以本机 DSH `0.2.0-rc.2` 的 `resources/app.asar` 为准，不以远端 master 代替已安装发行版。以下均为只读读取的归档内部路径，未修改官方发行文件。

路径前缀为 `dsh/node_modules/@deepseek-ai/`：

| 文件与位置 | 确认事实 | 实现选择 |
|---|---|---|
| `dsh-agent-loop/lib/index.js:1061` | Agent 决策中的 messages 也会追加为 user/message | 不从消息类型猜测真人身份，沿用 memoryIdentity.onEvidence |
| `dsh-agent-loop/lib/index.js:682`、`:697` | tool/call 有 callId/name，tool/result 有 sourceEventSeqs 与工具消息 | 仅从配对原生执行元信息记录返回状态，不使用工具正文推断真实任务成功 |
| `dsh-agent-loop/lib/index.js:1027` | 每轮终点追加 turn/end | 作为轻量记录/空闲整理提示 |
| `dsh-compaction-basic/lib/index.js:469`、`:486`、`:495` | 原生压缩有 start/end；失败 end 带 error | 只在成功 end 检查遗漏，不导入压缩摘要 |
| `dsh-compaction-basic/lib/index.js:596` | checkpoint 用独立来源生成 user message | 不把 checkpoint 当 L1 真人证据 |
| `dsh-session/lib/index.js:1441` | append 需为 surface 消息提供 surfaceOp；对外发 session/event | 测试通过真实 Session 与原生 /compact，不伪造“压缩已成功” |
| `dsh-token-meter/lib/index.js:61`、`:74`、`:702` | estimateMessage 是字符比例启发式 | L3 使用独立保守 Unicode 估算，明确非精确模型 tokenizer |
| `dsh-system-prompt/lib/index.js:350` | context.text 是同步取值 | 每轮本地计算 L3/L2，无同步 LLM 调用 |
| `dsh-agent-loop/lib/index.js:1851`、`:1867` | create 接受 agentOptions，并在 setup 后发布 Agent | 隔离探针使用真实 Creator 派生、Agent 注册和 Host 身份 |
| `dsh-command-compact/lib/index.js:49` | 命令经所属插件的 compaction 服务执行 | 通过原生 commands.execute('/compact') 测试，避免绕开 Preset 内服务隔离 |

代码接口以 `packages/character-memory-core/identity-contract.mjs` 的 v1 检查和现有 Provider 为基础；未加入对 Character Identity 的硬依赖。L3/后台整理不需要 QQ Gateway，也没有增加第二个 Gateway 或审批处理器。

审查发现直接从 Agent 根 context 获取 compaction 并不代表 Preset 内隔离的服务可见，测试因此改用官方命令入口。初轮探针也曾缺少原生 surfaceOp；这是测试适配问题，修正后用真实命令重新验证，未将失败当作通过。
