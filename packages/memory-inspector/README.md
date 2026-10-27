# DSH Memory Inspector

可选的原生 DSH 设置页：网页端和桌面端统一从 **设置 → 记忆管理** 进入。复用宿主客户端模块图、React、设置导航、组件、主题和 Connection 认证。没有独立网页、iframe、数据库或管理服务。

需要已验证的 DSH 0.2.1-rc.2 / rc.3 的 `dsh.client`、`settings.section`、Connection RPC、loopback Web Host，以及 `memoryIdentity` / `dshMemory` 服务。默认只读，不依赖 QQ 或 Persona。

安装普通插件包后，在 Profile 或 Extras 声明一次 `dsh-memory-inspector`，配置 `enabled: true`；只有 `writable: true` 才允许人工修改。关闭插件不影响 Core 和后台整理。

所有业务请求仍由 Host 验证身份、作用域、CAS、来源及遗忘屏障。只能恢复仍有效的同内容元数据，不能撤销遗忘或恢复退休正文。

test.3 区分授权上下文加载、请求失败、无活动上下文和当前层级零记录；错误提供重试，渲染失败由本设置分区单独处理。Host 重启或 Session 轮换后，需要接入端重新建立可信当前身份，再刷新。数据库有记录或打开旧 Session 不会自动扩大授权；`writable:false` 仍允许合法只读浏览。无 Memory Schema 变化。

完整接口、安装和限制见仓库 docs/MEMORY-INSPECTOR.md；内嵌验收见 docs/INSPECTOR-NATIVE-UI.md。
