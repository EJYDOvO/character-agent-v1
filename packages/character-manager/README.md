# DSH Character Manager

原生 DSH 设置页（设置 → 角色管理）加 Host 插件。管理角色目录、导入 / 导出角色卡、编辑规则与关系、确认公开版人设，并请求 watchdog 切换当前角色。只管角色（人设 + 数据），不涉及 Preset 组成、工具权限或 `/role`。

- `runtime-persona.mjs`：Preset 插件，每次组装提示时读 `data/character-current/compiled.json`。
- `index.mjs`：Host 插件。注册 `/character-manager/api`（只接受 loopback 上原生认证的 Owner），启动时写 `data/character-current/runtime-health.json`。
- `registry.mjs`、`compile.mjs`、`switch.mjs`：角色清单与导入、编译、切换请求。`controller.mjs` 分发 RPC，`http.mjs` 只做传输与认证，`client.js` 是设置页。

RPC 请求体上限 256 KiB；角色卡通过 `uploadBegin` / `uploadChunk` 分块上传（上限 20 MB）。浏览器只传角色 `id`，从不传路径。

## 接入与运维

- 构建选项 `characterManager: {enabled: true}`；目录结构、切换前提（watchdog 在运行）、生产接入步骤与回退见 [MANAGEMENT](../../docs/MANAGEMENT.md) 的「角色管理」。
- 第一个角色用 `node scripts/adopt-character.cjs … --link` 接入：收编已有的 `data/character-<id>`（只新增卡、规则、提醒、`character.json`、`compiled.json`，不改 `binding.json` 和数据库），登记并建联接 `data/character-current`。之后导入的角色从当前角色继承 appId / ownerId / projectId；没有当前角色时导入的角色不能被切换到。
- `binding.json` 只由导入和接入写入；切换只在目标目录里补 `conversations.json`：Owner 和任一已登记角色记录过的会话键，目标还没有 Session ID 的，各得到一个新的随机 Session ID，已有的不改。Conversation Manager 从未记录过的会话键无法预置，见 MANAGEMENT「已知限制」。
- 切换由 QQTK watchdog 执行（`maintenance/character-switch.cjs`）；本插件只写请求、读结果。
