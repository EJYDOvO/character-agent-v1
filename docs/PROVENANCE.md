# 来源与实现方式

- Identity、Memory Core、Memory Tools 和 Definition loader 为项目自有实现。
- QQ Adapter 直接复用 `@tencent-connect/dsh-qqbot` 与既有 QQTK 的运行时接口；没有复制 QQ SDK，也不创建第二个 Sender。
- 主 Preset 构建时读取用户合法安装的官方 Creator 配置；官方 ASAR、提取的官方源码和生成的 Core 配置均不分发。
- DSH 工具注册、插件服务、事件和 Schedule 使用宿主官方接口；宿主依赖由既有 Profile 提供，不在包中引入第二份核心。
- 数据库使用 Node 内置 `node:sqlite`。
- 只读审阅过 [dsh-ltm 固定提交](https://github.com/tr1v3r/dsh-ltm/tree/bdc5de489d1f60811232548a5aa3cfd11f20ae49) 的 scope、tokenize 和 schema。未安装、未复制源码；cwd/Git 项目范围不能替代 QQ Owner 身份授权。
- 搜索、Bilibili、QQTK、DSH 为外部依赖，仍受各自许可证约束；本仓库不重新打包其发行产物。

本次发布未擅自为项目选择新的开源许可证。公开可见不等于授予额外许可；后续可由项目所有者确定自有代码的许可证。
