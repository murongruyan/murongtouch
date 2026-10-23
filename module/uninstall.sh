#!/system/bin/sh
# =============================================================================
# gt8pro_touch v3.0 - 模块卸载脚本（KernelSU / Magisk 卸载模块时由框架执行）
#
# 执行时机：用户在管理器里卸载模块（或模块目录存在 remove 标记并重启）时，
#           框架会先执行本脚本，再删除模块目录。
#
# 职责（与 action.sh 的「还原」流程保持一致）：
#   1) 停止采样率守护进程（SIGTERM；守护进程会自动恢复「启动时动态捕获到的原值」）
#   2) 执行 config/restore_rate.sh 兜底恢复 120Hz 默认档（240Hz 是官方游戏档，非默认）
#   3) 按 common.sh 中与 service.sh 完全相同的清单还原 settings / 系统属性
#   4) 日志复制到 /data/local/tmp/gt8pro_touch-uninstall.log（模块目录随后会被删除，
#      留在模块目录里的日志会一起消失）
#
# 采样率下发机制：守护进程直接 ioctl /dev/tcm_hbp0 发 TCM 命令 DC_SET_REPORT_FRE(0xE6)，
# 不依赖 shell 脚本；restore_rate.sh 只是 --set-rate 120 的兜底封装。
#
# 注意：本脚本必须「尽力而为」——任何一步失败都不要 exit 非 0，避免影响框架卸载流程。
# =============================================================================

# 定位模块目录（${0%/*} 标准写法，兼容被手动 sh 调用）
case "$0" in
    */*) MODDIR=${0%/*} ;;
    *)   MODDIR=$(pwd) ;;
esac
[ -f "$MODDIR/module.prop" ] || MODDIR=/data/adb/modules/gt8pro_touch

LOG_FILE="$MODDIR/config/uninstall.log"
PERSIST_LOG="/data/local/tmp/gt8pro_touch-uninstall.log"

mkdir -p "$MODDIR/config" 2>/dev/null

if [ -f "$MODDIR/common.sh" ]; then
    . "$MODDIR/common.sh"
else
    # 极端情况：common.sh 丢失时至少保证能停守护进程
    daemon_stop() {
        rm -f "$1/config/daemon.pid" 2>/dev/null
    }
    log_line() { :; }
fi

log() {
    log_line "$LOG_FILE" "$*"
}

log "===== uninstall.sh 开始（gt8pro_touch v3.0）====="

# ---------- 1) 停止守护进程 ----------
log "停止守护进程..."
daemon_stop "$MODDIR" "$LOG_FILE" 2>/dev/null

# ---------- 2) 恢复默认采样率 ----------
if [ -f "$MODDIR/config/restore_rate.sh" ]; then
    if sh "$MODDIR/config/restore_rate.sh" >> "$LOG_FILE" 2>&1; then
        log "restore_rate.sh 执行成功（采样率已恢复默认）"
    else
        log "[WARN] restore_rate.sh 返回非 0（采样率可能未恢复；重启后 touchDaemon 会回到默认值）"
    fi
else
    log "[WARN] 缺少 config/restore_rate.sh，跳过采样率恢复"
fi

# ---------- 3) 还原 settings / 系统属性 ----------
if command -v settings >/dev/null 2>&1 && command -v tweaks_revert >/dev/null 2>&1; then
    log "还原 settings 与系统属性..."
    tweaks_revert "$LOG_FILE" 2>/dev/null
    log "设置项还原流程结束"
else
    log "[WARN] settings 命令或公共库不可用，跳过设置项还原"
fi

# ---------- 4) 保存日志 ----------
log "===== uninstall.sh 结束 ====="
cp -f "$LOG_FILE" "$PERSIST_LOG" 2>/dev/null && log "日志已另存到 $PERSIST_LOG"

exit 0
