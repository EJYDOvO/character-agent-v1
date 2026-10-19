# test.11：Interaction 审计修复部署

2026-10-20，本机已从 test.10 切换到 **Character 0.1.0-test.11 / Interaction 0.1.0-test.2**。DSH 保持官方 **0.2.1-rc.2**，QQ Bot **0.5.2**、SDK **1.0.5** 使用配套的两份版本化补丁。Remote Ops 仍为 **1.1.1-test.1**。未修改官方 DSH 文件。

修复范围和仍有限制的行为见 [审计修复报告](INTERACTION-AUDIT-FIXES.md)。本次部署前额外处理了 Creator 的 `skill-catalog` 原生上下文注入：它和 `runtime-context` 一样不改变真实 QQ 输入登记，也不能凭自身开启 QQ 输出。

## 已验证

- 部署前原宿主可访问且 idle；在维护锁内停止旧实例，离线备份 Profile、Sessions、存储、Character SQLite/WAL、QQ 状态、桌面配置和配套维护代码，逐文件校验 **1838 个文件**。
- 使用新版本不可变产物；候选 **44 个文件**与源码/包核对，QQ 与 SDK 补丁覆盖 **16 个文件**。候选配置和锁文件均在切换前核对封存哈希。
- 实际打包产物的隔离宿主 **10 项检查通过**：Creator 工具、跨 Session 记忆、L3、CAS/遗忘、授权隔离、原生 Schedule 与通知去重。隔离环境禁用 QQ，身份及数据为合成内容。
- 新启动的 DSH 健康、版本、启动进程归属及一次 QQ ready 通过。最终 QQ 健康状态为 `connected=true`，Agent idle。
- `ops verify` 最终通过，实际安装的 16 个补丁文件与维护源码匹配；旧 Session 路由映射保持，官方 ASAR 哈希未变。
- 原角色、Character 人格化模式、单 Owner 私聊、禁用群聊和原数据路径保持；没有数据库 schema 迁移。

后置维护校验最初因源码版 `ops.cjs` 缺少已部署版的 Character 分支，将 `qq-character` 误判为应为 `cordis`。已把原有单 Owner、唯一 Gateway 和产物哈希检查合并回源码，并在维护锁下同步自有维护脚本；最终校验通过。没有删除这项断言，也没有修改 Agent Preset 来迁就校验。

## 回滚与验收边界

本机离线快照位于安装根目录下 `data/maintenance/interaction-deploy/20261020-064431`，包含已校验快照清单及旧 Profile。部署脚本的失败恢复目标已改为 test.10，并覆盖本次新增 SDK 补丁和维护源码。此次切换成功，**没有执行生产回滚演练**。

手动恢复必须先确认空闲、取得维护锁、停止当前宿主并保存当前状态，再配套恢复 test.10 的 Profile、数据和维护文件；不能只替换插件版本。快照恢复会回到快照时间点，需保留切换后新增数据。官方 DSH 不需要回退。

本次未主动发送 QQ 消息、未调用生产模型做回复测试，也未进行手机收件、审批按钮、真实异常网络或完整热重载验收。Session 路由保持不等同于已完成一次真实 QQ 入站恢复。大库扫描及长 Markdown 渲染等剩余限制仍有效。代码未推送 GitHub。
