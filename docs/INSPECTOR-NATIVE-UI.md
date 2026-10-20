# Memory Inspector 原生内嵌验收

以下是初次内嵌实现的历史记录；后续缺陷修复、实际页面复测、性能基线和未完成门禁见 [T01–T15](AUDIT-T01-T15.md)，不能沿用下表旧测试数证明最新提交。

本轮在 test.12 候选上将 Inspector 包升级为 `0.1.0-test.2`。未部署；生产配置、DSH 官方发行文件、QQ 和生产记忆未修改。

## 架构变化

- 移除原 `public/index.html / app.js / style.css` 外置页面；`GET /memory-inspector/` 返回 404。
- `package.json` 声明 `dsh.client.platform: web`、原生依赖及 `./client` 导出。网页与桌面共用 DSH 客户端模块图，无第二份 React、路由器或管理服务。
- `client.js` 注册 `settings.section` 的“记忆管理”，复用官方设置导航、Button、Input、SegmentedTabs、Tag 和明暗主题变量。L3 正文、来源追溯与修订时间线可直接阅读，底层元数据折叠显示。
- 前端通过 `ctx.connection.rpc.call('/memory-inspector','api',payload)`；Host 有界 HTTP 入口接受原生关联信封，并保留原直接 JSON API 兼容。所有身份、作用域和权限由 Host 决定。
- HTTP 保持 loopback、Host、原生 Owner 认证、16 KiB 限制、10 秒读取超时、读取后重新认证，以及 Core ACL/CAS/来源/遗忘屏障。
- 原生桌面 `forwardWebRequest()` 去掉 Origin 和 Sec-Fetch-Site 并由主进程附加 Host Cookie。接口允许这一路径，但拒绝 `Origin:null`、外站 Origin、跨站 Fetch 标记或无认证请求。没有给浏览器新的信任字段或凭据。
- 插件销毁移除设置入口、局部样式并中止客户端请求。异步数据按层级、上下文及请求序列隔离；测试发现并修复了 L2→L3 切换时旧列表被新视图读取的崩溃。

## 依据与测试

实际 SDK 来自安装的 DSH `0.2.1-rc.2`：

- `dsh-client-modules/lib/index.js`：扫描 `dsh.client`，装配客户端模块图。
- `dsh-client-ui-settings-general/lib/client.js`：原生 `settings.section` 注册契约。
- `dsh-client-connection/lib/client.browser.js`：客户端 Connection RPC 信封及关联校验。
- 官方 `lib/main.js` 的 `web-document` 区域：桌面 `dsh-app://app` 静态资源与认证转发。
- `dsh-desktop-host/lib/index.js`：向桌面传递 `collectIndexInjections()`。

| 验证 | 结果 / 边界 |
|---|---|
| Character 单元/审计回归 | 124/124，无跳过；包括新增客户端注册/停用/HMR、RPC/桌面来源边界及层级竞态 |
| 原生 DSH + Extras | 11 项通过；运行 ID `fdd9bb32-b3b1-4b85-9816-a0336b674aeb` |
| 网页实际 UI | 已在原生设置内点击确认、纠错、L3 追溯、遗忘、L1、L2、L3 和任务页；遗忘后 L3 为零，历史正文及来源隐藏 |
| 桌面传输 | 在同一隔离 Host 上执行当前安装包原样读取的 `forwardWebRequest()`；认证 RPC 成功，外站 renderer 被拒绝，Cookie 不回传。不是 Mock 转发函数 |
| 客户端生命周期 | 单元验证停用不注册，销毁移除入口/样式并 abort 请求；未模拟完整桌面 HMR |
| 现有功能 | 原生 Creator 工具、独立 Worker/冷恢复/越权、Memory 提取、Compaction、Schedule 与通知账本继续通过；模型和 QQ Sender 仍是合成测试 |

桌面代码入口和实际转发协议已验证，但未启动或点击生产 Electron 窗口，不能写成桌面实机验收。没有实际 QQ、生产数据库或生产重启测试。浏览器验收截图只包含合成测试数据，保存在忽略的 test-data 下。

## 修改与部署

主要文件：`packages/memory-inspector/{package.json,index.mjs,http.mjs,client.js,README.md}`，`tests/{inspector-client.test.mjs,inspector.test.mjs,inspector-host.mjs}`，相关 README、架构、决策、路线图及管理文档。

部署仍需授权：先备份、确认空闲、打包 Inspector，目标 Profile 安装且只声明一次，默认只读，再分别在网页和桌面设置中验收。当前生成 Core 仍为上一轮测试路径配置，必须按真实私有配置重新构建后才能部署。UI 回滚可直接禁用 Inspector 声明；没有 Schema 迁移，不恢复或覆盖记忆库。

当前限制：仅管理已授权活动上下文；不实现离线任意库管理。高级来源/冲突细节仍以折叠元数据显示。没有百万条数据压力验证。独立外置管理入口不在本轮范围。
