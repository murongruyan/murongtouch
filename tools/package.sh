#!/usr/bin/env bash
# ============================================================================
# tools/package.sh - 构建「慕容触控采样率」免费模块 zip（Linux / macOS / CI）
#
# 用法:
#   tools/package.sh [module_dir] [version] [out_dir]
#
#   module_dir  默认 <repo>/module
#   version     默认读取 module.prop 的 version
#   out_dir     默认 <repo>/dist
#
# 产物:
#   <out_dir>/慕容触控采样率-v<version>.zip
#   <out_dir>/慕容触控采样率-v<version>.zip.sha256
#
# 说明:
#   * zip 根目录直接是 module.prop / service.sh / config/ ... （可直接刷入 KSU/Magisk）。
#   * 只打包免费模块内容；付费守护进程（bin/touch_rate_daemon）与任何源码/内核模块
#     都会在打包前被显式断言拒绝，避免误发。
#   * 文本统一转 LF + 去 BOM；脚本/二进制设置 0755，其余 0644（zip 会记录 Unix 权限）。
#   * Windows 本地打包请用 tools/package.ps1（功能等价，同样保留可执行位）。
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_DIR="$(cd "${1:-$ROOT/module}" 2>/dev/null && pwd)" || { echo "ERROR: 模块目录不存在: ${1:-$ROOT/module}" >&2; exit 1; }
VERSION="${2:-}"
OUT_DIR="${3:-$ROOT/dist}"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$MODULE_DIR/module.prop" ] || die "缺少 $MODULE_DIR/module.prop"
if [ -z "$VERSION" ]; then
    VERSION="$(sed -n 's/^version=//p' "$MODULE_DIR/module.prop" | head -n1 | tr -d '\r')"
fi
[ -n "$VERSION" ] || die "无法从 module.prop 读取 version，请显式传入"
case "$VERSION" in
    *[!0-9A-Za-z._-]*) die "version 含有非法字符: $VERSION" ;;
esac

ZIP_NAME="慕容触控采样率-v${VERSION}.zip"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
ZIP_PATH="$OUT_DIR/$ZIP_NAME"

# ---- 1. 必需文件 -----------------------------------------------------------
REQUIRED=(
    module.prop
    service.sh
    action.sh
    uninstall.sh
    common.sh
    README.md
    bin/api.sh
    bin/rate_ctl
    bin/curl
    bin/verify_lease_sig
    config/采样率.txt
    config/rate.conf
    config/legacy.conf
    config/set_rate.sh
    config/restore_rate.sh
    config/auth/lease_public_key.hex
    config/auth/lease_key_id.txt
    webroot/index.html
    webroot/css/style.css
    webroot/js/app.js
)
for f in "${REQUIRED[@]}"; do
    [ -e "$MODULE_DIR/$f" ] || die "缺少必需文件: $f"
done

# ---- 2. 付费组件泄漏断言 ---------------------------------------------------
# 公开仓/公开 Release 只能有免费模块：付费守护进程、源码、内核模块、系统库、
# 以及设备端授权运行态文件（account/lease/device_id 等）一律不得出现在 zip 里。
LEAK_PATHS=(
    "bin/touch_rate_daemon"
    "src"
    "daemon.c"
    "config/auth/account.json"
    "config/auth/lease.json"
    "config/auth/state.json"
    "config/auth/device_id.txt"
    "config/auth/device_identity.json"
)
for p in "${LEAK_PATHS[@]}"; do
    [ ! -e "$MODULE_DIR/$p" ] || die "付费/运行态内容泄漏到公开模块: $p（请从 module/ 移除后再打包）"
done
LEAK_GLOBS=("*.c" "*.h" "*.ko" "*.so" "*.dex" "*.apk")
for g in "${LEAK_GLOBS[@]}"; do
    hit="$(find "$MODULE_DIR" -type f -name "$g" -print -quit 2>/dev/null || true)"
    [ -z "$hit" ] || die "付费/私有二进制或源码泄漏到公开模块: $hit"
done

# ---- 3. staging: 复制 + LF 化 + 权限 --------------------------------------
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/murongtouch-pkg.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

cp -a "$MODULE_DIR/." "$STAGE/"

# 文本统一 LF、去 UTF-8 BOM。Android sh 不认 CRLF；Windows 记事本保存过的脚本曾导致 device 上语法错误。
TEXT_GLOBS=(sh prop txt conf json html css js md)
for ext in "${TEXT_GLOBS[@]}"; do
    while IFS= read -r -d '' f; do
        sed -i 's/\r$//' "$f" 2>/dev/null || true
        sed -i '1s/^\xEF\xBB\xBF//' "$f" 2>/dev/null || true
    done < <(find "$STAGE" -type f -name "*.$ext" -print0)
done

chmod 0644 "$STAGE/module.prop" "$STAGE/README.md"
find "$STAGE" -type f ! -name '*.sh' ! -name 'api.sh' ! -name 'rate_ctl' ! -name 'curl' ! -name 'verify_lease_sig' \
    -exec chmod 0644 {} +
chmod 0755 \
    "$STAGE/service.sh" \
    "$STAGE/action.sh" \
    "$STAGE/uninstall.sh" \
    "$STAGE/common.sh" \
    "$STAGE/bin/api.sh" \
    "$STAGE/bin/rate_ctl" \
    "$STAGE/bin/curl" \
    "$STAGE/bin/verify_lease_sig" \
    "$STAGE/config/set_rate.sh" \
    "$STAGE/config/restore_rate.sh"

# ---- 4. 打包（zip 根目录即模块根目录） --------------------------------------
rm -f "$ZIP_PATH" "$ZIP_PATH.sha256"
export LC_ALL=C.UTF-8 LANG=C.UTF-8
( cd "$STAGE" && zip -r -X -q "$ZIP_PATH" . )

# ---- 5. 结构校验 -----------------------------------------------------------
python3 - "$ZIP_PATH" <<'PY'
import sys, zipfile
zip_path = sys.argv[1]
with zipfile.ZipFile(zip_path) as z:
    names = z.namelist()
    files = [n for n in names if not n.endswith('/')]
    assert 'module.prop' in files, 'module.prop 不在 zip 根目录'
    assert 'service.sh' in files, 'service.sh 不在 zip 根目录'
    assert 'webroot/index.html' in files, 'webroot/index.html 缺失'
    assert not any(n.startswith('module/') for n in names), 'zip 里套了 module/ 目录'
    banned = [n for n in names if n.startswith('src/') or 'touch_rate_daemon' in n
              or n.endswith(('.c', '.h', '.ko', '.so'))]
    assert not banned, 'zip 内出现付费组件: %s' % banned
print('zip 结构校验通过: %d 个文件, 根目录 module.prop' % len(files))
PY

# ---- 6. 校验和与产物信息 ----------------------------------------------------
if command -v sha256sum >/dev/null 2>&1; then
    ( cd "$OUT_DIR" && sha256sum "$ZIP_NAME" > "$ZIP_NAME.sha256" )
else
    ( cd "$OUT_DIR" && shasum -a 256 "$ZIP_NAME" > "$ZIP_NAME.sha256" )
fi
SHA256="$(cut -d' ' -f1 "$ZIP_PATH.sha256")"
SIZE="$(wc -c < "$ZIP_PATH" | tr -d ' ')"

echo "== 免费模块打包完成 =="
echo "  版本    : v$VERSION"
echo "  zip     : $ZIP_PATH"
echo "  大小    : $SIZE bytes"
echo "  sha256  : $SHA256"

# ---- 7. 供 GitHub Actions 直接读取 -----------------------------------------
if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
        echo "zip_path=$ZIP_PATH"
        echo "zip_name=$ZIP_NAME"
        echo "sha256=$SHA256"
        echo "size=$SIZE"
        echo "version=$VERSION"
    } >> "$GITHUB_OUTPUT"
fi
