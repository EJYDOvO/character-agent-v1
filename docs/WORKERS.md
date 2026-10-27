# Worker V2：原生 Preset 权限

Character 是唯一面向用户的 Root，保留完整 Creator 工具、Skills、原生委派和模型偏好。Worker 使用 DSH 0.2.1-rc.2 / rc.3 原生 `subagent` / `spawn`、独立 Preset 和独立 Session；默认目标 `worker-general`，可信 `allowedAgentPresets` 白名单，`maxDepth:1`。Fork/workflow 是 Creator 的其他通道，不具有相同隔离语义。

## test.17 的权限变化

内置 Worker 默认只装配 Persona，**不再装配 worker-boundary，不使用 Character 的 restrict/guard 或额外工具名单**。工具、Skills、审批和 Scope 均以原生 Preset 实际装配为准。用户可以通过独立 Preset Manager 修改 Worker 的 Profile Override，添加已安装的 Plugins 和分配 Skills；不修改 Core 源定义。添加 Skill 不会自动授予终端、文件或网络工具；需要读取 Skill 时显式装配原生 `dsh-tool-skill` 等所需能力。

独立 Spawn 不复制 Root 的 Preset 工具、历史、Persona、QQ Identity 或 Memory capability。Host 全局工具可能按 DSH 原生规则对 Worker 可见；可见性不等于 QQ/Memory/Long Tasks 授权，这些服务仍验证可信身份。不要把 Root capability、凭据或身份字段传给 Worker，也不要把 Worker 结果当成审批或授权。

Root 的白名单/一级深度不变。Worker 默认没有委派插件；即使为它装配原生 subagent，仍应配置 `maxDepth:1`，由原生 Host 拒绝第二级委派。本项目没有新增管理器、Spawn Provider 或第二套 Worker 权限系统。可信 Host 插件可运行进程代码，原生 Scope 校验不是恶意插件沙箱。

## 角色与结果

| Preset | 用途 |
|---|---|
| worker-general | 默认通用分析 |
| worker-explore | 代码、索引与调用关系 |
| worker-librarian | 资料、版本、来源与许可证 |
| worker-oracle | 复杂故障与架构取舍 |
| worker-metis | 需求、约束与风险澄清 |
| worker-momus | 计划、回滚与验收评审 |
| worker-planner | 复杂任务的计划草案；不接管 Root 调度 |
| worker-review | 可选兼容审阅角色 |

前七项由 Core 构建声明。`private/build-config.json` 的 `specialistWorkers:["worker-review"]` 按需增加 review，不需要 Extras。Persona 允许使用真实装配的能力补充证据，缺材料或能力时报告 blocked/needs_input，不假装已搜索或执行。

结果契约 WorkerResult V1：`worker/status/summary/findings[{claim,evidence[{reference,quote}]}]/uncertainties/proposals`。这是提示与 Root 核验契约，不是运行时强制 JSON Schema。最终用户回复与决策由 Root 负责。

## 社区真实 ID

可信构建配置可显式声明已安装、已审查的第三方 Preset：

```json
{"communityWorkerPresets":["third-party-worker",{"id":"root-planner-worker","alias":"external-planner"}]}
```

原生白名单、`agent_preset`、持久目标和冷恢复均使用真实 `id`；alias 仅用于展示，不能作为调用目标。拒绝重复、别名冲突、内置 ID、Character 自引用和已知高权限 Root（含 cordis/creator/root/long-task）。ID 不能是路径、含空白或不可见字符；声明只接受 id/alias。名字不证明权限安全，必须审查实际工具、Scope、身份和依赖。不会自动安装插件或给第三方授予权限。

目标未安装、装配失败或冷恢复时已卸载，都安全拒绝，不回退 Creator。恢复原真实 ID 后才可继续原有子 Session。更名时需要保留旧 ID 供历史 Session 恢复，不能靠展示别名迁移目标。

## 升级与回滚

`prepare-deploy.cjs` / `prepare-host-upgrade.cjs` 仅在候选 Profile 清除精确的旧 `dsh-character-memory-tools/worker.mjs` 行（含 Group、自定义 Preset 和 Manager 合并 base）。只刷新与旧发行模板完全相同的内置 Worker Persona，保留用户改动、其他工具、排序、Skills 分配、版本和历史。状态暂存后若再变化，切换会拒绝，需重新准备候选。

旧模块地址保留为无操作兼容入口，避免历史 Override/Session 缺模块而失败。新 Core 不引用它，兼容入口不限制或授予权限。构建清单 `workerPolicyVersion:3`。回滚需要恢复匹配的旧 Core/Tools、Profile 与 Manager base；不回滚 Memory/Session 数据。回滚到 test.16 会恢复当时的强制无工具策略。

## 验证

- `npm test`、`npm run test:audit`：角色/名单、兼容入口、候选配置迁移、完整 Manager 状态、并发修改拒绝和切换失败回滚。
- `scripts/check-interaction-build.cjs`：合成构建保留 Creator/Extras、真实 ID、无 Boundary 声明。
- `scripts/run-inspector.ps1 --workers`：十个原生 Preset 实际工具调用、未装配的 Root 工具缺席、QQ/Memory/任务授权拒绝、白名单、原生深度、父子通信、冷恢复与第二次 Host 启动。
- 设置 `DSH_PRESET_MANAGER_PROJECT` 指向独立管理器仓库，再执行 `scripts/run-inspector.ps1 --workers --manager`：Manager 经 Owner API 修改真正的 Character Worker 插件/Skills，并验证 Spawn 与重启。
- Core-only/Core+Extras 另验证 Creator、Memory/Compaction、Schedule/Outbox 和 Inspector。模型和 QQ Sender 为合成替身，不证明真实模型质量、审批收件或手机送达。

当前部署与未验收事项见 [STATUS](STATUS.md)。职责划分参考 [dsh-plugin-cluster-preset](https://github.com/hu568/dsh-plugin-cluster-preset)，未复制其旧 toolFilter、委派 persona 或 Agent Loop；来源见 [第三方说明](../THIRD_PARTY_NOTICES.md)。
