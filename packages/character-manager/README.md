# DSH Character Manager

原生 DSH 设置页（设置 → 角色管理）加 Host 插件。管理角色目录、导入 / 导出角色卡、编辑规则与关系、确认公开版人设，并请求 watchdog 切换当前角色。只管角色（人设 + 数据），不涉及 Preset 组成、工具权限或 `/role`。

- `runtime-persona.mjs`：Preset 插件，每次组装提示时读 `data/character-current/compiled.json`。
- `index.mjs`：Host 插件。注册 `/character-manager/api`（只接受 loopback 上原生认证的 Owner），启动时写 `data/character-current/runtime-health.json`。
- `registry.mjs`、`compile.mjs`、`switch.mjs`：角色清单与导入、编译、切换请求。`controller.mjs` 分发 RPC，`http.mjs` 只做传输与认证，`client.js` 是设置页。

RPC 请求体上限 256 KiB；角色卡通过 `uploadBegin` / `uploadChunk` 分块上传（上限 20 MB）。浏览器只传角色 `id`，从不传路径。
