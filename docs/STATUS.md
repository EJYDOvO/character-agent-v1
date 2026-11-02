# 当前状态

| 范围 | 状态 |
|---|---|
| 当前源码 | Character 0.1.0-test.28，Interaction 0.1.0-test.9 |
| 配套 QQTK | I/O test.8、Manager test.3、Remote Ops 1.1.1-test.3、QQ0.5.2 / SDK1.0.5 |
| 官方宿主基线 | DSH0.2.1-rc.3 / Node24 / Windows |
| 本次清理 | 专用分支；不部署、不重启、不访问生产数据 |
| 原实例 | 之前记录为 test.28；本轮没有实时核验，不把源码 HEAD 当部署 SHA |

源码已实现：四核心插件、Creator 构建派生、通用 Memory L1–L3/FTS5/CAS/遗忘屏障、可信 Identity、原生独立 Worker、可选 Interaction、原生内嵌 Inspector 与 Long Tasks。QQTK 独立维护唯一 I/O/Manager/QQ Gateway，通知为 at-most-once handoff。

清理保留单元、安全、权限、通知、生命周期、重启和补丁一致性测试。原生隔离测试使用合成账号/模型和新 Profile；不能据此宣称手机送达、真实 QQ 审批、真实模型 Worker 质量或 Desktop 视觉验收通过。各次临时输出只留仓库外本地私有目录。

新 portable 入口显式指定发行目录、新 Home、模型、账号、Owner、Persona 与可选插件；根依赖锁和版本清单进入 Git，生成 Core/包/Profile 与数据不进入 Git。旧布局脚本仍用于现有兼容回归，不代表新设备配置默认值。

限制：Mac/Linux 原生环境未验收；历史 Session 的 cwd/附件绝对路径可能需要人工审阅；旧非标准数据布局无自动导入保证。真实 QQ、已有提醒/通知以及私有业务数据迁移须在另行授权的停机流程验证。

尚未实现/本轮不扩展：跨平台账号关联、多用户/群聊、完整 Approval Router、向量检索、细粒度任务 grants、旧 Task Memory 正式导入。后续工作优先现有安全回归及实机验收，然后真实 Worker/Memory/Long Tasks 质量评估；不把路线图视为已交付。
