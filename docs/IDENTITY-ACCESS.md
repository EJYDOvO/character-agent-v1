# Identity & Access 与角色 Preset（I1/I2）

可选功能，源码默认关闭（`roles.enabled` 未设置时构建结果与单 Owner 版本完全相同）。本页说明 Character 侧的 Preset、Identity 兼容和装配；授权服务本身见 QQTK [dsh-identity-access](https://github.com/EJYDOvO/harness-qq-toolkit-public/blob/main/plugin-sources/dsh-identity-access/README.md)。

## 调用链

```
QQ Gateway（SDK 去重、白名单准入）
 → Agent I/O：admit（Identity & Access 解析可信 Principal、角色、封禁）
     ├ 命令：路由闸门；Owner 可执行全部命令，其他角色只执行声明了该角色的命令；/role 仅 Owner
     ├ HITL 按钮/文本：复核该 Session 的 hitl 授权
     └ 普通消息：Conversation Manager.getOrCreate(…, {presets: 角色 Preset})
         → Character Identity 包装：Owner 走原有绑定（Memory、提醒、Outbox）；其他角色只允许角色 Preset，不绑定任何 Owner 能力
         → bind 可撤销授权 → 原生 followup
 → 原生 Agent：全局工具守卫（Owner 授权或拒绝）+ 角色 Preset 自身工具范围
 → 输出：每个分片 route 复核 reply 授权；通知仅发往 Owner
```

角色变更、封禁、过期或服务卸载会撤销授权：取消运行中的 Turn、结束 HITL、拒绝待发分片。角色变化后下一条输入进入该角色自己的新 Session，不继承旧 Session。

## 三个 Preset

| Preset | 组成 | 能力 |
|---|---|---|
| `character`（Owner） | 现有 Creator 派生组合原样保留（私有 Persona、Memory 工具、Worker、Schedule 等），仅改 id | 与原 Owner 相同，不扩大 |
| `character-contact` | 明确提供的公开 Persona + `dsh-identity-access/tool-scope.mjs`（`allow: []`） | 仅原生基础聊天 |
| `character-guest` | 同上，独立 Preset 与 Session | 仅原生基础聊天 |

contact/guest 从空组合独立装配，不从 Owner Preset 继承后靠 Prompt 限权。工具范围用原生 `tools.restrict` 隐藏继承和后注册的全局工具，并用 `tools.guard` 拒绝执行；Identity & Access 另有全局守卫。角色权限不写进 Persona。

工具范围原在 `character-memory-tools/minimal-scope.mjs`，已移到 QQTK `dsh-identity-access/tool-scope.mjs`：它与 Memory 无关，放在 Memory 包会让最小 Preset 依赖 Memory 包。

## 旧 qq-character 兼容

`roles.legacyOwnerPreset: qq-character` 生成与 Owner 完全相同的别名 Preset，并配置：

- Identity & Access：`legacyOwnerPresets`，该名只接受 Owner，任何其他角色申请即拒绝。
- Character Identity：`legacyPresetIds` 让旧 Session、`qq_bindings` 提醒绑定、Schedule 冷恢复与 Outbox 来源继续属于 Owner；身份范围指纹仅在显式配置该旧 id 时迁移到新 Preset id，否则仍拒绝启动；`memoryAgentId` 保持旧 id，Memory 命名空间不变，不修改 Memory Schema。
- Conversation Manager：已持久的 Owner 路由按原 Session 恢复（别名在 Owner 授权内）；新 Session 使用 `character`。per-peer Preset 偏好在角色模式下不生效。

## 配置（portable）

```json
"qq": { "allow": ["<OTHER_PRIVATE_OPENID>"] },
"roles": { "enabled": true, "publicPersona": "<REVIEWED_PUBLIC_PERSONA_FILE>", "legacyOwnerPreset": "qq-character" }
```

`qq.allow` 只是平台准入，准入后默认是 guest；没有 `roles.enabled` 时不允许额外准入。公开 Persona 必须是单独审阅过的文件。prepare 写入私有 `identity-owner.json`（Owner 来自同一私有配置），装配 `dsh-identity-access`，QQ 打开 `identityAccess.enabled` 且保持群聊禁用。Owner 在私聊用 `/role list|show|grant contact <principal> [30m|12h|7d]|revoke|block|unblock` 管理。

## 与角色管理一起使用

构建配置开启 `characterManager` 时（见 [MANAGEMENT](MANAGEMENT.md) 的「角色管理」）：

- 公开人设不再来自 `roles.publicPersonaFile`（同时设置会被构建拒绝），而由当前角色生成：同一张卡、同一份规则，关系段换成对其他人的关系，`{{user}}` 换成「对方」，可排除含私人关系的设定字段。Owner 在设置 → 角色管理里预览并确认后才生效；没有确认过的公开版时，Contact / Guest 得到中性回退文本，不读 Owner 版。
- Contact / Guest 的 Preset 组成不变：仍从空组合装配，只含运行时人设插件（只读公开部分）和 `tool-scope`，工具不可见、不可执行。
- `identity-access.json`、`identity-owner.json` 放在 `data/account/`，不在角色目录里：授权和封禁属于 QQ 账号与这个 bot，切换角色后仍然有效。Contact / Guest 的会话路由在角色目录的 `conversations.json` 里；切换时，任一角色记录过的会话键都会在目标里得到新的 Session ID，这些 Contact / Guest 换角色后进入新角色自己的新 Session。
- 没有记录的会话：Conversation Manager 对状态文件里没有记录的会话键按会话键推导 Session ID。开启角色管理时，每个角色的 `conversations.json` 带 `sessionNamespace`（角色 ID），推导结果按角色区分，所以一直保持同一角色身份、从没换过 Session 的 Contact / Guest 切换后也进入新角色自己的 Session（需要 Conversation Manager 0.1.0-test.6）。详见 [MANAGEMENT](MANAGEMENT.md)「角色管理」的「会话命名空间」。
- 旧位置（角色数据目录）已有这两个文件的安装，停机后把它们移到 `data/account/`。

## 验证

| 层级 | 命令 | 覆盖 |
|---|---|---|
| Node 单元（Character） | `npm test` | Preset 组成、Owner Persona 保留、别名限制、Identity 角色放行与 Owner 能力隔离、旧 Preset 迁移 |
| Node 单元（QQTK） | `npm test` | 服务、/role、并发冲突、过期、持久化失败、HMR 单写入者、工具守卫；真实 Agent I/O + Conversation Manager 上的入站/命令/HITL/出站/通知/撤销/重启/伪造身份 |
| 真实 Host（rc.3；0.2.2-rc.1 兼容分支复测通过） | `scripts/run-roles.ps1`（隔离 Home、合成 QQ 传输与 LLM） | 旧 Owner Session 恢复、Guest/Contact 独立 Preset 与 Session、工具不可见且不可执行、/role、运行中撤销、封禁、Identity & Access HMR 与卸载、进程重启后恢复 |
| 真实 Host（0.2.2-rc.1，角色管理） | `scripts/run-character-manager.ps1`（隔离 Home、合成 QQ 传输与 LLM） | 公开版（未确认时中性回退、确认后只含公开内容）、切换后封禁与 Contact 授权保留、角色不变的 Guest 切换后进入新角色预置的新 Session 且没有旧角色历史、Contact / Guest 工具为空 |
| 干净安装 | `portable prepare/install/verify`（合成配置） | 包与锁、角色 Preset 在已安装包上解析和挂载 |

未验证：真实 QQ 与手机收发、真实模型、多进程共享状态、生产迁移。群聊、跨平台账号关联与细粒度 Capability Grants 未实现。原生 Web/Desktop 窗口属本机 Owner，不经角色闸门。
