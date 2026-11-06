# 当前状态

| 范围 | 状态 |
|---|---|
| 当前源码 | Character 0.1.0-test.30（含可选角色模式，Long Tasks 0.1.0-test.2），Interaction 0.1.0-test.9 |
| 配套 QQTK | I/O test.9、Manager test.5、Remote Ops 1.1.1-test.3、QQ0.5.2 / SDK1.0.5 |
| 官方宿主目标 | DSH0.2.2-rc.1 / Node24 / Windows（仅隔离验证；源码不再支持 0.2.1 Schedule API） |
| 本次清理 | 专用分支；不部署、不重启、不访问生产数据 |
| 原实例 | 之前记录为 test.28；本轮没有实时核验，不把源码 HEAD 当部署 SHA |

源码已实现：四核心插件、Creator 构建派生、通用 Memory L1–L3/FTS5/CAS/遗忘屏障、可信 Identity、原生独立 Worker、可选 Interaction、原生内嵌 Inspector 与 Long Tasks。QQTK 独立维护唯一 I/O/Manager/QQ Gateway，通知为 at-most-once handoff。

清理保留单元、安全、权限、通知、生命周期、重启和补丁一致性测试。原生隔离测试使用合成账号/模型和新 Profile；不能据此宣称手机送达、真实 QQ 审批、真实模型 Worker 质量或 Desktop 视觉验收通过。各次临时输出只留仓库外本地私有目录。

新 portable 入口显式指定发行目录、新 Home、模型、账号、Owner、Persona 与可选插件；根依赖锁和版本清单进入 Git，生成 Core/包/Profile 与数据不进入 Git。旧布局脚本仍用于现有兼容回归，不代表新设备配置默认值。

限制：Mac/Linux 原生环境未验收；历史 Session 的 cwd/附件绝对路径可能需要人工审阅；旧非标准数据布局无自动导入保证。真实 QQ、已有提醒/通知以及私有业务数据迁移须在另行授权的停机流程验证。

尚未实现/本轮不扩展：跨平台账号关联、多用户/群聊、完整 Approval Router、向量检索、细粒度任务 grants、旧 Task Memory 正式导入。后续工作优先现有安全回归及实机验收，然后真实 Worker/Memory/Long Tasks 质量评估；不把路线图视为已交付。

本轮迁移门禁：全新 Git 工作树执行 Character 单元 262/262、安全 35/35；QQTK 单元/边界 223/223、SDK 36/36，均无跳过；两份补丁重建并精确应用上游快照。三套新 Profile（普通 QQ、Core-only、完整可选组合）完成固定版本安装、哈希校验和真实 rc.3 启动装配，QQ 连接禁用。原生 Worker 冷恢复、Inspector/Memory/Compaction、通用模块、通信、Interaction/HITL/Media、双进程生命周期与 Schedule 重启回归使用合成数据。首次 Schedule 探针仍使用旧 Sender 的失败已保留在本地，夹具对齐当前通知接口后通过；运行时发送路径没有改变。

DSH 0.2.2-rc.1 兼容（分支 `compat/dsh-0.2.2-rc.1`，未部署）：Long Tasks 改用 `create/edit/view/catalog`，保留原生时间规则类型并修正 daily/weekly/cron 的 `time_zone` 映射（此前三类规则在 0.2.1 也会被原生拒绝）；去掉逾期 `[HOST BINDING]` 重新绑定，改用原生 latest-only 恢复。Character Identity 按 `target` 判定提醒归属，`new_once`/`new` 不可信；Owner 根可管理自己的提醒，包括轮换前旧 Owner Session 上持有持久绑定的提醒，任务根、其他主体与未证明归属的任务拒绝；归属在执行时用新鲜原生视图判定并钉住 CAS，不依赖缓存。QQTK Conversation Manager 的 Schedule 阻断改读 catalog `target`（原 `list({sessionId})` 在 0.2.2 静默失效）。验证（官方签名安装包仅解包、不安装，隔离 Home、合成数据）：Character 单元 281/281、安全 35/35；QQTK 单元 235/235、SDK 36/36、补丁重建通过；真实 0.2.2 Host 上 lifecycle 双进程冷恢复、Schedule 重启与工具守卫、roles、interaction、communication、inspector（含 extras、modules、workers、workers+Preset Manager）通过；Preset Manager 单元与双阶段宿主测试通过。v1→v2 四进程演练：0.2.1 写 v1；0.2.2 启动/读取不写盘、字段一致、首次写入升级 v2；0.2.2 重启读取 v2；0.2.1 无法加载 v2。真实 QQ Gateway/补丁 SDK 在 0.2.2 的联网装配、手机送达、真实模型与生产迁移未验证。

I1/I2（分支 `feat/identity-access-i1-i2`，未部署、默认关闭）：Identity & Access 已接入 QQ 入站、命令、HITL、Conversation Manager 的 Session 选择、工具守卫与出站；三个角色 Preset 进入构建与 portable 安装，旧 `qq-character` 作为 Owner 别名兼容。验证：Character 单元 268/268、安全 35/35；QQTK 单元 235/235、SDK 36/36；真实 rc.3 隔离 Host 两阶段角色探针（含 HMR 与进程重启）及合成配置的干净安装与装配通过。真实 QQ/手机、真实模型与生产迁移未验证。详见 [IDENTITY-ACCESS](IDENTITY-ACCESS.md)。
