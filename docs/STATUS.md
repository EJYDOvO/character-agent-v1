# 当前增量

test.8 已经授权部署，四插件与 Core/Extras 升级，SQLite Schema 2→3、旧记忆与 Session 保留检查、生产真实模型记忆工具验收通过。初次上线使用 Off，随后经授权开启 Character 模式；同一生产 Session 的 `character_layers_status` 实际返回 `character`，QQ 与健康检查通过。源码默认值仍是 Off。手机收件/审批未验证；本次回滚是在隔离副本执行真实脚本和旧运行时，未降级生产。见 [test.8 交付记录](RELEASE-test8.md) 和 [分层记忆](MEMORY-LAYERS.md)。

后续源码变更：Extras 已改为空模板，构建保留其声明；这是尚未替换生产包的变更。空 YAML 与实际构建检查通过，补充原生加载器复核未执行；不将其计入上线验收。原生 Creator 插件安装仍写入 Profile，不自动写入 Extras。

test.7 的历史通用化验收见 [RELEASE-test7.md](RELEASE-test7.md)；下文原始功能清单保留为历史基线。

---

> 本文保留 test.2 的历史边界。当前 test.5 的已验证状态、部署与回滚说明以 [RELEASE-test5.md](RELEASE-test5.md) 和 [MANAGEMENT.md](MANAGEMENT.md) 为准。

# 实现与测试状态

## 历史部署记录：2026-10-16

自有组件 `0.1.0-test.2` 已在原部署完成启动与健康检查，官方 DSH 保持 `0.2.0-rc.2`，QQ Bot 保持 `0.5.2` 和既有补丁。这里只公布技术结论；原始生产日志、会话与请求 ID、数据库及配置留在本机，不上传。

| 模块 | 状态 |
|---|---|
| Core/Extras | 最小装配完成，Core-only 与 Extras-on 宿主验证通过 |
| QQ/审批 | 唯一 Gateway、Owner-only 与原审批复用；手机按钮未验 |
| Identity | Host 可信上下文完成；固定 personal，无项目管理/Worker grants |
| Definition | 静态 YAML 校验和构建完成，无热更新 |
| 主 Preset | 原 Creator 33 工具保留，Character 37 工具；任务质量 A/B 未做 |
| 独立 Worker | 当前安装版本不支持目标独立 Preset 接口，未实现 |
| Memory | CRUD、CAS、来源、状态、遗忘、跨 Session 已验证；高级检索未做 |
| 自动整理 | 仅有限自动捕获，无后台 LLM 巩固/合并/压缩回补 |
| Coordinator | 路由镜像与 generation；权威路由仍为原 QQ prefs |
| 提醒/通知 | 原 Schedule 创建/取消验证；新账本尚未统一接线 |
| Extras | 搜索/Bilibili；浏览器和市场尚未统一管理 |
| Inspector | 未实现 |
| 回滚/迁移 | 离线快照哈希验证通过；生产回滚演练、跨机迁移未做 |

## 历史验证的证据强度

- 自有单元测试 10/10；原 QQ/审批/维护回归 16/16，后者需要外部 QQTK 环境，不包含在本仓库独立测试中。
- 官方隔离宿主验证工具装配、记忆读写、跨会话、未绑定 Session 拒绝与原生 Schedule 创建/取消。
- `test.1` 单次真实模型完成记忆写入、读取、遗忘、再次读取。`test.2` 修复后完成隔离回归与生产启动验证，没有再次发送真实 QQ 测试消息。
- QQ ready 与发送无错误已观察；没有独立手机送达确认，也没有真实审批按钮点击验收。
- 官方 ASAR 未修改。两次停机快照均逐文件校验，旧数据保留，没有把备份内容放入源码仓库。

## 公开导出验证：2026-10-17

公开副本重新运行 Node 单元测试；实际结果见 `PUBLICATION.md`。该检查不连接生产、不发送 QQ、不修改原部署。运行包源码和单元测试保持原样；脚本中的固定安装位置改为显式环境变量。集成/部署脚本仅做语法检查，没有在公开副本重新执行真实升级。
