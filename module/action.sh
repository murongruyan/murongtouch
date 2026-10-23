#!/system/bin/sh
# =============================================================================
# gt8pro_touch v3.0 - 模块操作按钮（KernelSU / Magisk 管理器中点「操作」执行）
#
# 功能：还原默认设置并卸载模块
#   1) 停止采样率守护进程（守护进程收到 SIGTERM 会先恢复默认采样率）
#   2) 执行 config/restore_rate.sh，把采样率恢复到默认值
#   3) 显示当前 settings / 系统属性状态
#   4) 音量键确认：音量上=确认卸载，音量下=取消；10 秒超时按取消处理
#   5) 按 common.sh 中与 service.sh 完全相同的清单还原 settings / 属性
#   6) 按 KernelSU/Magisk 规范创建模块目录下的 remove 文件（重启后由框架删除模块），
#      不再 rm -rf 模块目录
#
# 为什么不再直接 rm -rf 模块目录：
#   KernelSU/Magisk 的模块生命周期由框架管理，运行时「标记 remove 文件」才是规范做法；
#   直接删除目录会让框架状态与实际文件不同步，可能出现「模块列表还在/下次开机才清」等问题。
# =============================================================================

# 定位模块目录：优先 $0 所在目录（${0%/*}），兼容手动 `sh action.sh` 调用
case "$0" in
    */*) MODDIR=${0%/*} ;;
    *)   MODDIR=$(pwd) ;;
esac
# 路径无效时回退到标准安装路径（KernelSU/Magisk 均为 /data/adb/modules/<模块id>）
if [ ! -f "$MODDIR/module.prop" ]; then
    MODDIR=/data/adb/modules/gt8pro_touch
fi
if [ ! -f "$MODDIR/module.prop" ]; then
    echo "错误：找不到模块目录（module.prop 不存在）。请在模块目录内执行，或确认模块已正确安装。" >&2
    exit 1
fi

LOG_FILE="$MODDIR/config/action.log"
DAEMON_LOG="$MODDIR/config/daemon.log"

mkdir -p "$MODDIR/config" 2>/dev/null

if [ ! -f "$MODDIR/common.sh" ]; then
    echo "错误：缺少 $MODDIR/common.sh，无法执行操作。" >&2
    exit 1
fi
. "$MODDIR/common.sh"

log() {
    log_line "$LOG_FILE" "$*"
}

# 音量键等待函数：10 秒超时。
# 返回 0 = 音量上（确认），返回 1 = 音量下/超时（取消）。
# 旧版 bug：timeout 是全局变量、getevent -qlc 1 无按键时会一直阻塞、10 秒语义混乱。
# 新版用 `timeout 10 getevent -ql` 管道给 awk，读到音量键立刻退出，10 秒后 timeout 强杀。
volume_key_confirm() {
    local key gpid tmp i
    if command -v timeout >/dev/null 2>&1; then
        key=$(timeout 10 getevent -ql 2>/dev/null | awk '
            /KEY_VOLUMEUP[[:space:]]/   { print "up";   exit }
            /KEY_VOLUMEDOWN[[:space:]]/ { print "down"; exit }
        ')
    else
        # 兜底：没有 timeout 命令时，后台运行 getevent + 临时文件 + 10 秒后 kill
        tmp="$MODDIR/config/.action_key.$$"
        getevent -ql > "$tmp" 2>/dev/null &
        gpid=$!
        i=0
        while [ "$i" -lt 10 ]; do
            sleep 1
            i=$((i + 1))
            kill -0 "$gpid" 2>/dev/null || break
        done
        kill "$gpid" 2>/dev/null
        wait "$gpid" 2>/dev/null
        key=$(awk '
            /KEY_VOLUMEUP[[:space:]]/   { print "up";   exit }
            /KEY_VOLUMEDOWN[[:space:]]/ { print "down"; exit }
        ' "$tmp" 2>/dev/null)
        rm -f "$tmp" 2>/dev/null
    fi

    case "$key" in
        up) return 0 ;;
        *)  return 1 ;;
    esac
}

echo "=============================================="
echo "  真我GT8 Pro / 一加12 自动采样率模块 v3.0"
echo "  还原默认设置并卸载"
echo "=============================================="
echo "  （v3.0 也可在 KernelSU WebUI 中查看状态、修改采样率配置）"
echo ""

# ---------- 1) 停止守护进程 ----------
echo "[1/4] 停止采样率守护进程..."
if [ -n "$(daemon_pid "$MODDIR" 2>/dev/null)" ]; then
    daemon_stop "$MODDIR" "$LOG_FILE"
    echo "      已停止守护进程（pid 文件已清理）。"
else
    daemon_stop "$MODDIR" "$LOG_FILE"
    echo "      守护进程当前未运行。"
fi

# ---------- 2) 恢复默认采样率 ----------
# 守护进程收到 SIGTERM 时会自动恢复「启动时动态捕获到的原值」；这里再调用 restore_rate.sh
# 兜底固定恢复 120Hz 默认档（注意 240Hz 是官方游戏档，不是默认值）。
# 守护进程二进制不存在时该脚本会报错，属正常降级。
echo "[2/4] 恢复默认采样率（config/restore_rate.sh → --set-rate 120）..."
if [ -f "$MODDIR/config/restore_rate.sh" ]; then
    if sh "$MODDIR/config/restore_rate.sh"; then
        echo "      采样率已恢复默认 120Hz。"
        log "restore_rate.sh 执行成功（--set-rate 120）"
    else
        echo "      警告：restore_rate.sh 返回非 0（守护进程可能已自动恢复，继续卸载流程）。"
        log "restore_rate.sh 返回非 0"
    fi
else
    echo "      警告：缺少 config/restore_rate.sh，跳过采样率恢复。"
    log "[WARN] 缺少 config/restore_rate.sh"
fi

# ---------- 3) 显示当前状态 ----------
echo ""
echo "[3/4] 当前被模块修改的设置值："
echo "----------------------------------------------"
tweaks_show
echo "----------------------------------------------"
if [ -f "$DAEMON_LOG" ]; then
    echo ""
    echo "[最近 10 行守护进程日志：$DAEMON_LOG]"
    tail -n 10 "$DAEMON_LOG" 2>/dev/null
fi
echo ""

# ---------- 4) 音量键确认 ----------
echo "**********************************************"
echo "  是否确认卸载模块并还原以上所有设置？"
echo "    音量上：确认卸载"
echo "    音量下：取消"
echo "  等待按键（10 秒超时，超时=取消）..."
echo "**********************************************"

if volume_key_confirm; then
    echo ""
    echo "[4/4] 正在还原 Settings 数据库与系统属性..."
    if tweaks_revert "$LOG_FILE"; then
        echo "      所有设置项已还原。"
    else
        echo "      部分设置项还原失败（详见 $LOG_FILE），建议重启后再确认。"
    fi
    echo ""

    # 按 KernelSU/Magisk 规范标记卸载：创建模块目录下的 remove 文件，重启时框架删除模块
    if touch "$MODDIR/remove" 2>/dev/null; then
        log "已创建卸载标记文件 $MODDIR/remove"
        echo "模块已标记卸载（$MODDIR/remove）。"
        echo "所有设置已还原，请手动重启设备以完成卸载。"
    else
        log "[FAIL] 无法创建卸载标记 $MODDIR/remove"
        echo "错误：无法创建卸载标记 $MODDIR/remove，请检查 root 权限。" >&2
        exit 1
    fi
else
    echo ""
    echo "操作已取消，未做任何修改。"
    # 取消时把守护进程重新拉起来，保证模块继续正常工作
    if daemon_start "$MODDIR" "$LOG_FILE"; then
        echo "守护进程已重新启动，自动采样率功能继续生效。"
    else
        echo "提示：守护进程未能重新启动，可重启设备或在管理器中重新启用模块。"
    fi
    log "用户取消卸载操作，守护进程已尝试恢复"
fi

echo ""
exit 0
