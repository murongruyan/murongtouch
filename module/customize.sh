#!/system/bin/sh
# KernelSU / Magisk 安装时执行（可选脚本；KernelSU 会在解压并设置默认权限后 source 本文件）
# 作用：修复 zip 解压后丢失的可执行位、把持久化的登录/授权/配置恢复到新模块目录、记录安装日志。
# 失败不阻断安装。
SKIPUNZIP=0

MODULE_ID="gt8pro_touch"
MODPATH="${MODPATH:-$PWD}"
LOGDIR="/data/adb/murong_touch"
LOG="$LOGDIR/install.log"
mkdir -p "$LOGDIR" 2>/dev/null

logi() {
    echo "$1"
    echo "$(date '+%Y-%m-%d %H:%M:%S') [install] $1" >> "$LOG" 2>/dev/null
}

logi "慕容触控采样率：安装/更新 ${MODULE_ID}"

# 1) 修复关键二进制/脚本执行权限（KernelSU 解压默认 0644）
for f in \
    bin/touch_rate_daemon bin/verify_lease_sig bin/curl bin/rate_ctl \
    bin/api.sh bin/collect_diag.sh bin/touchconfig.sh bin/update_status.sh \
    bin/apply_touch_tuning.sh bin/cloud-rate.sh bin/sqlite3 \
    service.sh action.sh uninstall.sh common.sh; do
    [ -f "$MODPATH/$f" ] && chmod 755 "$MODPATH/$f" 2>/dev/null
done
# WebUI/配置保持 0644
for f in webroot/index.html webroot/css/style.css webroot/js/app.js module.prop; do
    [ -f "$MODPATH/$f" ] && chmod 644 "$MODPATH/$f" 2>/dev/null
done
logi "文件权限已修复"

# 2) 模块更新会重置模块目录：从持久化目录恢复登录 token/租约/用户配置
if [ -f "$MODPATH/bin/api.sh" ]; then
    if sh "$MODPATH/bin/api.sh" state_restore >/dev/null 2>&1; then
        logi "已从 /data/adb/murong_touch 恢复登录/授权/配置"
    else
        logi "持久化恢复跳过（首次安装或无备份）"
    fi
fi

# 3) 若正在使用应用增强服务兼容修复，安装后重新注入（数据库在应用私有目录，不受模块更新影响）
if [ -f "$LOGDIR/cosa_fix.conf" ] && grep -q '^enabled=1' "$LOGDIR/cosa_fix.conf" 2>/dev/null; then
    if [ -f "$MODPATH/bin/cloud-rate.sh" ]; then
        ( sleep 5; sh "$MODPATH/bin/cloud-rate.sh" inject >/dev/null 2>&1 ) &
        logi "已安排应用增强服务兼容修复重新注入"
    fi
fi

logi "安装脚本完成"
exit 0
