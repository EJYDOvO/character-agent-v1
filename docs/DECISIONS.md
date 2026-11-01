# 当前实现决策

本页接续归档 v0.7.8 设计与 ADR-050/055/058–062；目标设计不等于已部署能力。当前 Iteration 08 test.27 已于 2026-11-02 合并并授权部署；验证范围见 [STATUS](STATUS.md)。

1. 四个核心运行插件、Core/Extras、Creator 构建派生保留。QQTK 独立维护，一个 QQ Gateway 和审批处理器。
2. Worker V2 使用原生独立 Preset/Spawn，Character 是唯一 Root。Core 声明 general 与六个专业分析角色；review 仍可选；声明、白名单和 Root 策略同源构建，`maxDepth:1`，无执行/Memory/QQ 身份。Planner 只是按需计划草案角色，不引入第二套调度。社区 Preset 先由 Host 审查安装再加入显式构建白名单；不采纳上游旧 toolFilter/persona 接口。
3. Memory Inspector 是可选通用 Host 插件，复用原生 Web listener 和认证。使用原生 `dsh.client` 和 `settings.section` 内嵌到网页/桌面共用设置页，不提供外置 HTML 或 iframe；不新建管理服务。
4. GUI 不颁发身份。Host 认证 Owner 只可选择可信 Provider 已授予 Core 的上下文，所有操作再次经过授权和 CAS。
5. 版本恢复受现有屏障限制，只恢复仍有效的同内容元数据；不会恢复被纠正或遗忘的正文。
6. Schema 继续为 3；Inspector 不新增库。关闭 UI 不关闭记忆和整理。
7. Schedule 仍绑定 Session。test.13 在 QQTK 中提供默认关闭的主 Session 轮换：真实 Host 重启或 12 小时无用户输入后，下次安全交互创建空白根 Session。忙碌/审批/未完成收件箱延后处理；旧提醒保留原根 Session，Identity 持久绑定冷恢复，不能劫持当前主路由。通用 QQ 无可信桥接时因已有提醒而延后轮换。
8. 初次 test.12 和本轮审计均在隔离环境验证，未修改生产配置或连接真实 QQ。部署执行遵循有效授权及当次发布门禁；不得把默认部署授权当作已通过门禁。
9. Inspector L3 管理以有效引用条目为单位，投影元数据单列。各层类型/状态不混用，日期从用户时区转为带时区 ISO；公开脱敏不能参与内部形成模式判断。
10. 回滚首先保全当前记忆。旧代码须在一致副本上验证 Schema、内容和治理屏障；兼容则只恢复 Profile/配置，不用旧快照覆盖新记录。版本与打包摘要分别核验，不能按主版本号假定 Inspector/Interaction 同步版本。
11. Inspector 直接消费 Core 管理 API；只约束 Core 不反向依赖 UI。候选准备共用版本与补丁校验，按有效声明选择可选产物，Remote Ops 保留已验证的安装版本，不隐式降级。
12. 公开库保留运行代码、模板、维护脚本和有复现价值的回归测试。逐轮审计、原始输出及一次性调试材料只留本地忽略目录；当前状态统一在 STATUS，历史文件不作为新部署门禁。
13. 独立长期任务是 Extras 中默认停用的可选包。复用原生 Schedule/Session/Preset/storageDomain 与既有 Outbox，执行账本在 pre-step 认领 occurrence，不重放不确定副作用。任务根 Session 没有 QQ/Memory 身份，默认无工具；需要工具时必须由 Host 同时声明 taskPlugins 与 allowTools。此功能不是开放执行权限的通用 Worker 或主代审批实现。
14. Iteration 08 不重算历史身份、路由或通知 ID。Adapter 纳入进程内 I/O 范围；旧发送绑定原注册实例。Character 使用显式 Host 生命周期参数，不通过 Remote Ops 挂接，也不增加统一 Identity 服务；Manager 仍唯一当前路由权威。
15. scoped input reply 只回应已验证/认领的输入，五分钟有效并逐片复核准入；不创建 Session，不等价于稳定通知或 Memory capability。缺少可信输入时不能用旧 Sender 回退。
16. Diagnostics v1 共享 I/O 实例的脱敏关联，但不统一日志器或新增数据库。诊断开关、异常和存储失败不能影响授权/发送；原生业务异常不会被诊断吞掉。发布仍需 Iteration 09 的授权、冷切换与手机验收。
