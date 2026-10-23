# 更新日志

> 本文件由发布工作流在每次发版时自动在最上方插入新版本段落；也可以手动编辑。
> 模块内的在线更新（`update.json`）与 Release 说明都会引用本文件。

## v5.10.1 (601) - 2026-10-23

1. sync: touch module v5.10 (WebUI 检查更新弹窗/去更新, 修复重复小标题/版本读取)

## v5.9.1 (591) - 2026-10-23

1. sync: touch module v5.9 (关于页改为开源仓库/使用说明/更新日志三行，移除调度官网与教程链接)

## v5.8.2 (582) - 2026-10-23

1. fix(webui): 关于页/检查更新 URL 用户名拼写错误（mongruyan → murongruyan）

## v5.8.1 (581) - 2026-10-23

1. sync: touch module v5.8 (WebUI 5.8, 关于页, 支付/授权功能)

## v5.0.3 (503) - 2026-10-23

1. docs: 安装说明改为 Release 资产名 murongtouch-vX.Y.Z.zip（同时保留本地打包产物名）

## v5.0.2 (502) - 2026-10-23

1. fix: Release 资产名改为 ASCII（GitHub 会丢弃中文资产名），update.json zipUrl 与 Release 资产保持一致
2. docs: 仓库说明、发版流程、update.json 与更新日志
3. feat: 自动发版流水线（push main 自动 bump + tag/Release + update.json 同步）
4. feat: 慕容触控采样率 v5.0 免费模块（WebUI / 多后端探测 / 租约门禁）

## v5.0.1 (501) - 2026-10-23

1. docs: 仓库说明、发版流程、update.json 与更新日志
2. feat: 自动发版流水线（push main 自动 bump + tag/Release + update.json 同步）
3. feat: 慕容触控采样率 v5.0 免费模块（WebUI / 多后端探测 / 租约门禁）

## v5.0.0

1. 付费模式上线（v5.0）：模块 zip 只包含免费模块，付费守护进程由 WebUI 在购买授权后按需下载安装；
   服务端签发 Ed25519 租约（3 天有效 + 3 天离线宽限），设备端校验签名 / scope / 设备绑定 / 有效期。
2. WebUI 用户页：登录 / 注册、购买授权（3 元 · 单机永久）、卡密激活、租约状态与续租、
   下载付费组件、我的卡密 / 订单；主页 / 配置 / 日志页保留。
3. 自动采样率：全局档位 + 每应用自定义档位（`config/采样率.txt` 热更新），
   多后端自动探测（hbp / proc_rate / white_list / legacy_hidl），看门狗防官方覆盖。
4. 支持真我 GT8 Pro（RMX5200，ColorOS 17）；ColorOS 17 多机型自动探测，ColorOS 12~16 走 legacy 通道。
