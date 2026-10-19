# test.10 审计后的隔离修复（未发布）

> 后续状态：已获用户授权，于 2026-10-20 配套部署为 test.11，见 [部署记录](RELEASE-test11.md)。以下保留部署前修复报告的时间语境；未完成的验收仍有效。

2026-10-20。基于 DSH 0.2.1-rc.2、QQ Bot 0.5.2、qqbot-nodejs 1.0.5。
这是源码工作区修复，不是新的部署记录。未推送、未安装到生产、未连接 QQ、未读取生产记忆，也未修改官方 DSH。原审计报告保留为修复前证据。

## 已修复并隔离验证

| 原发现 | 修改 | 证据 |
|---|---|---|
| F01、F03 | 失败/abandoned attempt 丢弃未提交输出；最终正文校准；明确拒绝可更新同一 Stream，未知投递不盲目重发 | A01–03、A14、A16、A20；真实 Host 原生重试 |
| F04、F05 | 输出 token 与工具执行分开；cancel 清除缓冲及重试，steer 保留工具但撤销旧展示；迟到 settlement 等到下一 attempt 才恢复 | A08–10、A12、A17、A21；QQ Q05–07、Q16–18 |
| F06 | QQ Host 登记 native input；requireIngress 绑定只接受登记的本轮输入；普通 Web 同样为 user 也不能借用 QQ；runtime-context 不覆盖入口 | Q09、Q15；真实 Host 同 Agent 未登记 user 不发 QQ |
| F08、F14 | 排队的累计更新合并；dispose 撤销并立即释放控制器，不无限等待网络；SDK 超时覆盖响应正文 | A13、A19、Q10 |
| F10 | get/inspect/trace 不返回已遗忘 source.quote；失效 L2 公共读取也隐藏正文及来源正文 | M01，原跨层遗忘/纠错/ACL 回归 |
| F11、F12 | 重载中可重新观察原生 attempt；服务暂不可查时输出关闭、/stop 仍执行；Identity 单 Bot 可撤销委托代替堆积闭包 | A15、I01、Q14 |
| F13 | 搜索后续有效短句边界，配对中文引号；正式语义分段在 settlement 执行，未显示文本不受 Chunk 分法影响 | A04–07、A18、原分段测试 |
| F17（部分） | 无 claim_key 的检查跳过无意义的全库冲突扫描 | 10,000 条合成记录 inspect 三次均约 0–1ms |

主要实现位于 `packages/interaction-policy/policy.mjs`、`packages/character-identity/index.mjs`、`packages/character-memory-core/{store,layered}.mjs`。QQ 的长度限制、额度、合并串行及 SDK 修复位于独立 QQTK 仓库，见其 `docs/INTERACTION-AUDIT-FIXES.md`。

## 接口与行为

- `Interaction.admitInput(nativeMessage)` 只由可信 Host 调用；不注册为模型工具。平台在实际白名单/Identity 入站通过后、followup/steer 之前登记。待处理输入上限 100、有效期 5 分钟；过期输入不再授权输出，这不是 QQ 服务端 msgId 期限。
- QQ 适配绑定 `requireIngress: true`。原生 Session 的 `user/message` 数据就是 UserMessage，不能假定包在 `data.message` 中；兼容测试包装。`runtime-context` 不改变已登记的用户入口。
- Stream 适配需实现幂等 `cancel()`，取消不得调用会发送缓冲的 `complete()`。发送过程中取消不能撤回已经在途或展示的内容。
- 超过平台硬上限时，流式先更新首片，溢出内容等 durable settlement 后按序发送。静态分片之间检查取消状态。
- 明确拒绝信号为 `delivery: 'rejected'` 或 HTTP 4xx（排除 408）；未知错误保留 `stream-delivery-unknown`，不承诺已投递，不做静态兜底重发。
- 小段文本可在最终确认后形成自然气泡；已经流式展示的文本不会倒退或搬到另一个气泡。因此网络刷新时机可能影响实际气泡数量，不能承诺任意时序下气泡完全相同。
- Memory 不更改数据库 schema；原始修订及防复活屏障保留。公共接口脱敏不等于物理擦除历史 Session、修订与备份。

## 验证结果

- Character：原 89 项 + 审计及新增边界 23 项，**112/112**，无跳过。
- QQTK：原 13 项 + SDK/适配审计及补充边界 23 项，**36/36**，无跳过。实际 SDK 代码，网络为确定性替身。
- 实际 SDK 的审批/问答/文件 ACL 回归：**10/10**，隔离目录，无 QQ Gateway。
- 真实 DSH 重试探针：两次 Provider 调用，仅最终成功正文交付。runId `7245b89c-7bf4-4469-9bb9-ceb11ec7d77f`。
- 真实 DSH 集成：**9 项检查通过**，包含 Creator 工具一致性、Preset 隔离、真实流式帧、Hang-on 不入历史、Web/QQ 隔离、执行中工具 steer、cancel/followup。runId `f8f858da-a5e6-4f75-9eef-346e9190023a`。
- 两份补丁真实 `git apply --check`、应用后逐文件比对通过：QQ 13 文件、SDK 3 文件。

旧测试替身增加 SDK 已有的 cancel()，继续断言关闭及不发送尾巴；明确拒绝测试现在携带机器可判定的拒绝元数据，并新增未知投递不得重试断言。Q10 提前挂载 Promise rejection handler，避免正常超时被测试框架当作未处理拒绝。没有删除失败断言或跳过测试。

## 尚未完成 / 发布边界

- F17 全库召回和 L3 构建仍线性扫描：10,000 条合成记录 recall 约 532–539ms、context 约 458–469ms。需要后续有完整失效规则的索引/缓存优化；不能称为性能问题已全部解决。
- F18 engines.dsh 元数据、F19 整套宿主升级及回滚闭包的静态风险未在本轮完整处理。QQTK Stage 已纳入新 SDK 补丁哈希、固定版本和源码验证，但未运行生产维护脚本或整个升级/回滚流程。
- 未验证 QQ 服务端期限、主动配额、手机收件、真实断线重连以及运行中完整 HMR。恢复过程中没有重新登记的 QQ 输入按拒绝处理，不能擅自恢复旧 Sender 权限。
- 硬分片保证字符完整和上限，超长代码围栏、链接跨片时的手机 Markdown 渲染仍待实机验收。流式已显示草稿无法撤回；不能用这点声称失败草稿从未短暂出现。
- 本轮修复为**隔离候选**，不是生产发布完成。发布前需绑定两仓库的精确提交/包与两份补丁，补齐上述发布门禁并另行获准部署。生产仍保留原版本，无需生产回滚；这些修改尚未提交，回退时应只撤销本轮自有源码变更并保留审计证据。
