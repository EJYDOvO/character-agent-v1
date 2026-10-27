# Memory Inspector V1

独立包 `dsh-memory-inspector@0.1.0-test.3`，Character Core 保持 test.17。可选 Host 插件，使用已有 `webServer` 和 `connection`，不新建服务、数据库或 Agent Loop，不依赖 QQ、Persona 或 Character Identity。所需服务为 `memoryIdentity@1` 和 `dshMemory`。

页面分别显示正在确认授权、请求错误（可重试）、无活动上下文及当前层级零记录。无上下文时不会查询历史 SQLite 取得额外权限。QQ Identity 在 Host 重启/Session 轮换后需经当前可信入站重新建立；单纯打开旧 Session 不会授权。只读模式不禁止合法浏览。渲染异常限制在本设置分区并提供重新加载，不输出内部异常栈；无 Schema 迁移。

## 安装与启用

安装普通插件包并不会自动产生 Bundle。将包安装到目标 Profile，使用该 Profile 的现有 DSH SDK 依赖；在项目 Extras 或 Profile 中声明一次：

```yaml
- insert:
    - id: memory-inspector
      name: dsh-memory-inspector
      config:
        enabled: true
        writable: false
```

默认只读。经管理员审阅后将 `writable` 改为 `true` 才开放管理操作。监听地址必须是 `127.0.0.1` 或 `::1`。正常打开 DSH 网页或桌面端，在账号菜单打开 **设置 → 记忆管理**。不再提供独立 HTML 页面或 iframe；旧 `/memory-inspector/` 返回 404。

`package.json` 声明原生 `dsh.client` 与 `./client` 导出；DSH 扫描插件后将客户端加入自己的模块图。页面注册 `settings.section`，直接复用宿主 React、Button、Input、SegmentedTabs、Tag、主题变量和设置导航。客户端经 `ctx.connection.rpc.call` 使用宿主连接，不读取 Cookie 或 Token。桌面端由官方 `dsh-app://app` 协议转发到同一个 Host API，不需要另装管理服务。

普通 Agent 可使用 `examples/local-agent/identity.mjs` 或自己的可信 Provider。Inspector 只枚举 Core 已授权的活动上下文与 Provider 的 `current()`；不从浏览器参数创建身份。没有已授权 Session 时显示空列表。Character Provider 的授权与 Gateway 绑定生命周期一致，断开后访问会失效。Host Owner 与 QQ Owner 的映射由部署者选择的 Identity Provider 决定，不能把 GUI 当作多租户登录系统。

## 页面能力

- L1 经历正文、来源引用、Agent 和关联 L2；L2 内容、用途、类型、来源、置信度、冲突和修订；L3 按有效引用逐条展示，空投影为 0 条，完整投影的预算另列。
- 按已授权 Agent/项目/用户作用域切换；按正文、类型、状态、时间筛选；分页上限 100。
- 可用来源 Agent ID 进一步缩小共享 L1/通用 L2 的范围，不改变 ACL。没有可追溯 Agent 证据的旧记录不匹配这个过滤条件；清空后仍可在原授权范围查看。
- 提取/巩固任务状态、失败码、次数，以及 L1/L2/L3 数量、SQLite/WAL 状态。
- Jobs 可搜索 ID、状态、类型、安全错误码和固定描述，不搜索原始私有任务输入。各层级使用自己的类型/状态菜单，切换会清空不兼容的类型/状态，保留关键词、来源 Agent 与日期。
- 日期按浏览器本地时区的日界转换为 ISO；API 的 `from/to` 必须带明确时区。L2 使用有效状态（包括 `expired/invalidated`），L3 使用 `confirmed/supported`。L3 的 Agent 条件指投影所属 Agent，L1/L2 指来源 Agent。
- 确认、纠错、遗忘，以及仍有效、内容未变化的历史元数据恢复。操作需二次点击确认，并带当前 revision。

页面使用 React 文本节点，不执行记忆里的 HTML/Markdown。L3 显示可读条目及来源按钮，修订显示时间线；底层元数据收在折叠区。API 响应禁缓存，限制请求体 16 KiB、读取超时 10 秒，并在读取请求后再次验证认证。浏览器必须同源；官方桌面代理移除 Origin/Sec-Fetch-Site 后，仍需原生 Host Cookie、Owner principal、loopback/Host 与 Core ACL 验证。Origin:null、跨来源和带跨站标记的请求均拒绝。错误不会输出数据库路径或内部异常详情。

## Host API 与治理

原生 Connection RPC 信封为 `{type:"client-request", rpcId, method:"api", payload}`，响应回传同一个 rpcId。有界 HTTP 处理器保留旧直接 JSON 调用兼容。`POST /memory-inspector/api` 的操作为 `contexts / browse / detail / stats / confirm / correct / forget / restore`。请求只能提供 Host 已枚举的 context 选择器和业务参数；`principalId`、`projectId` 等额外字段被拒绝。context 不是凭据，必须同时满足原生 Owner 认证与当前 Identity 能力验证。

Core 新增：

| 方法 | 行为 |
|---|---|
| `browse(handle, {layer, query, agent, kind, status, from, to, offset, limit})` | 按 Host scope / Agent / personality mode 过滤，返回分页；退休正文隐藏 |
| `revisionHistory(handle, id)` | 返回可见修订，已退休/遗忘来源及内容隐藏，附恢复资格 |
| `restoreRevision(handle, id, targetRevision, revision, source)` | CAS 新建修订，只恢复仍有效的同内容元数据，不解除任何屏障 |
| `inspectorStats(handle)` | 当前授权范围统计，不返回 SQLite 路径 |

L3 Browse 返回 `{items, total, offset, refs, projection}`；`items` 是当前页有效条目，`refs` 只对应当前页，`projection` 提供整个投影的 mode/tokens/budget/fingerprint。`projection(handle)` 的旧 API 保持不变。L2 总数包括可见的退休元数据，不代表所有行仍有可消费正文。

GUI 的纠错/确认是经过认证的 Host Owner 明确输入，记录 `channel: memory-inspector` 和唯一管理事件 ID，不能冒充 QQ 消息。所有操作复用 Core 的授权、CAS、来源、L1/L2/L3 失效传播。页面只读浏览可能触发已有 L3 物化/过期处理，这属于 Core 原有治理行为；`writable:false` 禁用的是人工修改入口。

**恢复不是撤销遗忘。** 纠错时被屏障退休的旧正文不能恢复；已遗忘、过期、合并、来源退休的内容也不能借修订历史复活。历史元数据恢复追加 revision，不覆盖现有 revision，不提升可信身份。想恢复已纠正的事实需要新的证据及符合治理规则的新输入，不能强制解除屏障。

失效记录的公开正文、source、claim key、正文指纹被隐藏；退休 L1/trace 不再返回原始 Session/message/source 标识，只保留治理 ID、状态、类型、时间和 redacted 标记。内部原始记录仍参与授权、冲突与防复活检查，公开脱敏结果不能反向替代内部策略字段。

## 关闭与恢复

禁用或卸载 Inspector 后原生模块生命周期移除设置入口和局部样式，中止客户端待处理请求，Host 路由释放，进行中的请求在提交前检查关闭状态。页面异步结果按作用域、层级与请求序列隔离，避免切换后展示或提交旧记录。Memory Core 与后台整理照常运行。Schema 保持 3，无 Inspector 专属数据库迁移。回退 UI 包无需回退数据库；回退 Core 前仍应做一致性备份，且不要覆盖升级期间新增的数据。

## 已知限制

活跃授权上下文枚举不等于任意离线数据库管理；不能管理未授权、未恢复的 Agent。L1 按设计在同一用户/项目作用域共享，L2 人格化与 L3 按 Agent/模式隔离。查询为词法包含匹配，统计使用 SQL，L3 复用有变更/时间失效检查的缓存；冷重建与部分冲突查询仍同步扫描。1 万条合成数据已有基线，但没有高并发或百万条数据保证。当前版本不提供导出、批量删除、向量检索或任意历史内容恢复。

最新验证、性能及发布门禁见 [当前状态与验收边界](STATUS.md)；初次功能记录见 [test.12 验收](RELEASE-test12.md)。
