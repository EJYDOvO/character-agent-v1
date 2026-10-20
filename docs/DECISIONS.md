# 当前实现决策

本页接续归档 v0.7.8 设计；目标设计不等于已部署能力。当前源码 test.12，生产部署记录仍为 test.11。

1. 四个核心运行插件、Core/Extras、Creator 构建派生保留。QQTK 独立维护，一个 QQ Gateway 和审批处理器。
2. 基础 Worker 使用 DSH 原生独立 Preset/Spawn；首版安全分析型，没有执行或 Memory 权限。专业 `worker-review` 按构建配置在自有 Core 同时声明 Preset 与 allowlist，避免 Extras 关闭产生悬空引用。
3. Memory Inspector 是可选通用 Host 插件，复用原生 Web listener 和认证。使用原生 `dsh.client` 和 `settings.section` 内嵌到网页/桌面共用设置页，不提供外置 HTML 或 iframe；不新建管理服务。
4. GUI 不颁发身份。Host 认证 Owner 只可选择可信 Provider 已授予 Core 的上下文，所有操作再次经过授权和 CAS。
5. 版本恢复受现有屏障限制，只恢复仍有效的同内容元数据；不会恢复被纠正或遗忘的正文。
6. Schema 继续为 3；Inspector 不新增库。关闭 UI 不关闭记忆和整理。
7. Schedule 仍绑定 Session，自动轮换不启用。新增只读 route 状态接口暴露代次与阻塞原因，不迁移或重定向旧提醒。
8. 初次 test.12 和本轮审计均在隔离环境验证，未修改生产配置或连接真实 QQ。部署执行遵循有效授权及当次发布门禁；不得把默认部署授权当作已通过门禁。
9. Inspector L3 管理以有效引用条目为单位，投影元数据单列。各层类型/状态不混用，日期从用户时区转为带时区 ISO；公开脱敏不能参与内部形成模式判断。
10. 回滚首先保全当前记忆。旧代码须在一致副本上验证 Schema、内容和治理屏障；兼容则只恢复 Profile/配置，不用旧快照覆盖新记录。版本与打包摘要分别核验，不能按主版本号假定 Inspector/Interaction 同步版本。
