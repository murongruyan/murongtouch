# 慕容触控采样率（免费模块公开仓）

按前台应用自动切换触控采样率的 **KernelSU / Magisk 模块**（Android / ColorOS 17+）。
本仓库只包含**免费模块**源码与打包脚本；自动切档的付费守护进程不在这里，
由模块 WebUI 在购买授权后按需下载安装。

- 模块 ID：`gt8pro_touch`
- 当前版本：见 [`module/module.prop`](module/module.prop)
- 在线更新：刷入模块后 KernelSU / Magisk 通过
  `https://raw.githubusercontent.com/murongruyan/murongtouch/main/update.json` 检查新版本
- 支持机型：真我 GT8 Pro（RMX5200，ColorOS 17）实测通过；ColorOS 17 多机型自动探测，
  ColorOS 12~16 走 legacy 通道（需按机型配置 `config/legacy.conf`）

## 功能

- **自动切换采样率**：命中白名单/规则的应用在前台 → 切到配置的档位；退出 → 恢复进入前的系统原值。
- **全局 + 每应用自定义**：`config/采样率.txt` 第一行全局 Hz，其余行 `包名 采样率`，改完 1~2 秒热生效。
- **档位**：120 / 180 / 240 / 288 / 360Hz；隐藏档 400Hz（非官方，谨慎使用）。≥16 的 hbp code 会停止触控报点，界面已禁止。
- **KSU WebUI（四页）**：主页（当前采样率 / 真实报点率测试 / 状态）、配置（全局 + 每应用）、
  日志（一键收集诊断）、用户（登录 / 购买授权 / 卡密激活 / 租约 / 下载付费组件 / 外观设置）。
- **多后端自动探测**：hbp（HBP 架构，如 RMX5200）/ proc_rate / white_list / legacy（ColorOS 12~16）。
- **看门狗**：被官方 touchDaemon 覆盖后自动抢回目标档位。

## 安装

1. 到 [Releases](https://github.com/murongruyan/murongtouch/releases/latest) 下载最新的
   `慕容触控采样率-v*.zip`；
2. KernelSU / Magisk 管理器 → 模块 → 从本地安装；
3. 重启手机；
4. 打开模块 WebUI → 用户页登录 / 购买授权（3 元 · 单机永久）→ 下载付费组件，
   之后守护进程会自动接管采样率切换。

> 免费模块本身不含守护进程二进制：未购买 / 未安装组件时 WebUI 可正常打开，
> 但不会自动切换采样率（模块其余触控优化设置仍生效）。

## 仓库结构

```
module/                     # 刷入手机的模块目录（zip 根目录内容）
  module.prop               # 模块元数据（版本 / versionCode / updateJson）
  service.sh action.sh uninstall.sh common.sh
  bin/                      # rate_ctl / curl / verify_lease_sig / api.sh（不含付费 daemon）
  config/                   # 采样率配置、legacy.conf、rate.conf、set_rate.sh、restore_rate.sh、auth 公钥
  webroot/                  # KSU WebUI（纯静态，无 CDN）
  README.md                 # 模块内说明（随 zip 下发）
tools/
  package.sh                # Linux / macOS / CI 打包脚本（生成 慕容触控采样率-vX.Y.Z.zip）
  package.ps1               # Windows 本地打包脚本（等价，保留 zip 内 Unix 可执行位）
  update_metadata.py        # 同步 module.prop 与仓库根 update.json
  release_notes.py          # 生成 Release 说明 / 更新 changelog.md
.github/workflows/release.yml  # 自动发版流水线
update.json                 # KSU/Magisk 在线更新清单（由工作流自动维护）
changelog.md                # 更新日志（由工作流自动在最上方插入新版本）
```

## 本地打包

```bash
# Linux / macOS / WSL
bash tools/package.sh                  # 默认打包 module/ 到 dist/
bash tools/package.sh module 5.0.0 dist
```

```powershell
# Windows
pwsh -File .\tools\package.ps1         # 输出 dist/慕容触控采样率-v<version>.zip + .sha256
```

打包脚本会校验必需文件，并断言 zip 中**不含**付费守护进程/源码/内核模块
（`bin/touch_rate_daemon`、`*.c`、`*.ko`、`*.so` 等），同时统一文本 LF 换行、设置可执行位。

## 自动发版流程（维护者）

### 1. 常规发版（推荐）

直接改代码并 push 到 `main`，工作流会自动完成：

1. `module/module.prop` 补丁版本 +1（如 `5.0.1` → `5.0.2`），`versionCode` +1；
2. 打包 `慕容触控采样率-vX.Y.Z.zip`（含 0755 权限、LF 换行）；
3. 用本次 push 的 commit 标题生成 Release 说明，并把新版本段落插入 `changelog.md` 顶部；
4. 更新仓库根 `update.json`（`version` / `versionCode` / `zipUrl` / `changelog`）；
5. 把 `module/module.prop`、`update.json`、`changelog.md` 以
   `chore(release): vX.Y.Z (CODE) [skip ci]` 提交回 `main`（不会再次触发工作流）；
6. 创建 `vX.Y.Z` tag 和 GitHub Release，上传 zip 与 `.sha256`。

> 想写更详细的更新日志：push 前先编辑 `changelog.md`，工作流只在最上方插入新版本段落，
> 不会覆盖你手写的内容。

### 2. 手动触发（workflow_dispatch）

Actions → **Release** → Run workflow：

| 输入 | 默认 | 说明 |
| --- | --- | --- |
| `skip_bump` | `true` | 跳过版本号 bump，按当前 `module.prop` 版本构建 / 更新 Release |
| `publish_release` | `true` | 关闭则只构建并上传 Actions artifact（不发 Release、不建 tag） |

### 3. 只验证构建

`workflow_dispatch` + `skip_bump=true` + `publish_release=false`：
只跑语法检查、泄漏断言和打包，产物在 Actions artifact 里。

### 4. 发布失败怎么办

工作流可重复执行：`workflow_dispatch` 保持 `skip_bump=true` 会重建当前版本并
`--clobber` 覆盖 Release 资产（已有 Release 的说明不会被覆盖）；
若版本号已经 bump 过但 Release 没建出来，重新 dispatch 一次即可补齐。

## update.json 格式

与「慕容显示增强」模块一致（KernelSU / Magisk 的 updateJson 规范）：

```json
{
  "version": "5.0.1",
  "versionCode": 501,
  "zipUrl": "https://github.com/murongruyan/murongtouch/releases/download/v5.0.1/慕容触控采样率-v5.0.1.zip",
  "changelog": "https://raw.githubusercontent.com/murongruyan/murongtouch/main/changelog.md"
}
```

`zipUrl` 中的中文文件名在工作流里会做 URL percent-encode（KSU/Magisk 可直接下载）。

## 与付费组件仓的关系

| 仓库 | 可见性 | 内容 |
| --- | --- | --- |
| `murongtouch`（本仓库） | 公开 | 免费模块、WebUI、打包/发版脚本 |
| `murongtouch-premium` | 私有 | 付费守护进程（`touch_rate_daemon`）源码、aarch64 交叉编译、premium zip（`payload/bin/touch_rate_daemon` + `manifest.json`）与私有 Release |

付费组件工作流发布 tag `premium-vX.Y.Z`，产物经管理端/后端 packages 接口下发给已授权设备，
**不会**进入本仓库或公开 Release。

## 许可

GPL-3.0，见 [LICENSE](LICENSE)。
