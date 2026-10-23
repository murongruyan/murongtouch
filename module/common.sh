#!/system/bin/sh
# =============================================================================
# gt8pro_touch 公共库 v2.0
#
# 本文件只被 source，不直接执行。
#
# 作用：
#   1) 「模块设置清单」唯一数据源：
#      service.sh      按 SETTINGS_LIST / PROPS_LIST 逐项设置；
#      action.sh       按同一清单逐项还原；
#      uninstall.sh    按同一清单逐项还原。
#      —— 三个脚本共用同一份数据，从结构上杜绝历史 bug「设置的项和清理的项对不上」
#         （旧版 action.sh 会删 service.sh 从未设置过的 gaming.frame_rate_limit /
#          touch.sensitivity / debug.sf.latch_unsignaled / TapDragInterval 等）。
#   2) 守护进程控制函数 daemon_stop / daemon_start：
#      service.sh、action.sh、uninstall.sh 行为一致，避免各自实现导致的 pid 处理不一致。
# =============================================================================

# ----------------------------- 统一设置清单 ----------------------------------
# settings 项格式：<namespace>|<key>|<value>
#   namespace 取值：system / secure / global
SETTINGS_LIST='
system|vtouch_switch|0
secure|multi_press_timeout|200
secure|long_press_timeout|200
'

# 系统属性项格式：<prop>|<value>（由 service.sh 用 setprop 设置）
# 数值沿用旧版模块实际设置的值；旧版脚本注释「GL 应用 3000 纳秒」与实际值 1000 不符，
# 这里以实际值 1000 为准并修正注释，避免误导。
PROPS_LIST='
debug.sf.early_phase_offset_ns|35
debug.sf.early_app_phase_offset_ns|35
debug.sf.early_gl_phase_offset_ns|0
debug.sf.early_gl_app_phase_offset_ns|1000
debug.sf.high_fps_early_phase_offset_ns|6100
debug.sf.high_fps_early_gl_phase_offset_ns|6500
debug.sf.high_fps_late_app_phase_offset_ns|1000
debug.sf.phase_offset_threshold_for_next_vsync_ns|6100
'

# ------------------------------- 日志函数 ------------------------------------
# log_line <日志文件> <一行文本>；日志文件为空或 "-" 时静默。
log_line() {
    case "$1" in
        ''|-) return 0 ;;
    esac
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$2" >> "$1" 2>/dev/null
}

# --------------------------- 设置项：设置 / 还原 ------------------------------
# tweaks_apply <日志文件>：按 SETTINGS_LIST、PROPS_LIST 逐项设置。
# 单项失败不中断（尽量把能设的都设置上），任意一项失败返回 1。
tweaks_apply() {
    local logfile="$1" rc=0 ns key val prop
    while IFS='|' read -r ns key val; do
        case "$ns" in
            ''|'#'*) continue ;;
        esac
        if settings put "$ns" "$key" "$val" >/dev/null 2>&1; then
            log_line "$logfile" "[OK]   settings put $ns $key $val"
        else
            log_line "$logfile" "[FAIL] settings put $ns $key $val"
            rc=1
        fi
    done <<EOF
$SETTINGS_LIST
EOF

    while IFS='|' read -r prop val; do
        case "$prop" in
            ''|'#'*) continue ;;
        esac
        if setprop "$prop" "$val" >/dev/null 2>&1; then
            log_line "$logfile" "[OK]   setprop $prop $val"
        else
            log_line "$logfile" "[FAIL] setprop $prop $val"
            rc=1
        fi
    done <<EOF
$PROPS_LIST
EOF

    return "$rc"
}

# tweaks_revert <日志文件>：按与 tweaks_apply 完全相同的清单逐项删除/还原。
# 删除 settings 键 => 系统回到出厂默认；resetprop --delete => 属性回到系统默认。
tweaks_revert() {
    local logfile="$1" rc=0 ns key val prop delrc
    while IFS='|' read -r ns key val; do
        case "$ns" in
            ''|'#'*) continue ;;
        esac
        if settings delete "$ns" "$key" >/dev/null 2>&1; then
            log_line "$logfile" "[OK]   settings delete $ns $key"
        else
            log_line "$logfile" "[FAIL] settings delete $ns $key"
            rc=1
        fi
    done <<EOF
$SETTINGS_LIST
EOF

    while IFS='|' read -r prop val; do
        case "$prop" in
            ''|'#'*) continue ;;
        esac
        if command -v resetprop >/dev/null 2>&1; then
            resetprop --delete "$prop" >/dev/null 2>&1
            delrc=$?
        else
            # 兜底：Magisk/KernelSU 环境一定有 resetprop，这里只针对极端情况
            setprop "$prop" "" >/dev/null 2>&1
            delrc=$?
        fi
        if [ "$delrc" -eq 0 ]; then
            log_line "$logfile" "[OK]   resetprop --delete $prop"
        else
            log_line "$logfile" "[FAIL] resetprop --delete $prop"
            rc=1
        fi
    done <<EOF
$PROPS_LIST
EOF

    return "$rc"
}

# tweaks_show：把清单内各项「当前值」打印到标准输出（action.sh 显示当前状态用）。
tweaks_show() {
    local ns key val prop cur
    echo "[Settings 数据库]"
    while IFS='|' read -r ns key val; do
        case "$ns" in
            ''|'#'*) continue ;;
        esac
        cur=$(settings get "$ns" "$key" 2>/dev/null)
        [ -n "$cur" ] || cur="<未设置>"
        echo "  $ns $key = $cur （模块值 $val）"
    done <<EOF
$SETTINGS_LIST
EOF

    echo ""
    echo "[系统属性]"
    while IFS='|' read -r prop val; do
        case "$prop" in
            ''|'#'*) continue ;;
        esac
        cur=$(getprop "$prop" 2>/dev/null)
        [ -n "$cur" ] || cur="<未设置>"
        echo "  $prop = $cur （模块值 $val）"
    done <<EOF
$PROPS_LIST
EOF
}

# ----------------------------- 守护进程控制 ----------------------------------
# daemon_pid <模块目录>：输出守护进程 pid；pid 文件不存在/内容非法时返回 1。
daemon_pid() {
    local pidfile="$1/config/daemon.pid" pid
    [ -f "$pidfile" ] || return 1
    pid=$(cat "$pidfile" 2>/dev/null)
    case "$pid" in
        ''|*[!0-9]*) return 1 ;;
    esac
    printf '%s\n' "$pid"
}

# daemon_stop <模块目录> <日志文件>：
#   先按 config/daemon.pid 精确停止（SIGTERM，守护进程会在退出前恢复默认采样率），
#   最多等 5 秒，仍不退出则 SIGKILL；最后按进程名兜底清理并删除 pid 文件。
daemon_stop() {
    local moddir="$1" logfile="$2" pid i
    pid=$(daemon_pid "$moddir" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        log_line "$logfile" "[INFO] 停止守护进程 pid=$pid（SIGTERM）"
        kill "$pid" 2>/dev/null
        i=0
        while [ "$i" -lt 25 ] && kill -0 "$pid" 2>/dev/null; do
            i=$((i + 1))
            sleep 0.2 2>/dev/null || sleep 1
        done
        if kill -0 "$pid" 2>/dev/null; then
            log_line "$logfile" "[WARN] 守护进程 5s 内未退出，强制 SIGKILL pid=$pid"
            kill -9 "$pid" 2>/dev/null
        fi
    fi
    rm -f "$moddir/config/daemon.pid" 2>/dev/null

    # 兜底：pid 文件丢失/损坏时按进程名清理（进程名超过 15 字符会被内核截断，两个都试）
    for pid in $(pidof touch_rate_daemon 2>/dev/null) $(pidof touch_rate_daem 2>/dev/null); do
        kill "$pid" 2>/dev/null
    done
}

# daemon_start <模块目录> <日志文件>：
#   幂等：先 daemon_stop 停旧实例，再 setsid（无 setsid 时退化为 nohup）后台启动，
#   并把 pid 写入 config/daemon.pid；启动后 1 秒检查进程是否存活。
#   守护进程按约定前台运行、日志自己写 config/daemon.log，因此这里 stdout/stderr
#   重定向到 /dev/null（启动失败信息写日志文件的 [FAIL] 行）。
daemon_start() {
    local moddir="$1" logfile="$2" bin pid
    bin="$moddir/bin/touch_rate_daemon"

    if [ ! -f "$bin" ]; then
        log_line "$logfile" "[WARN] 未找到 bin/touch_rate_daemon，跳过守护进程启动（模块设置项仍生效）"
        return 1
    fi
    [ -x "$bin" ] || chmod 755 "$bin" 2>/dev/null
    chmod 755 "$moddir/bin/rate_ctl" 2>/dev/null

    daemon_stop "$moddir" "$logfile"

    # 优先 setsid：让守护进程脱离当前会话，模块服务脚本退出后仍存活
    if command -v setsid >/dev/null 2>&1; then
        setsid "$bin" "$moddir" >/dev/null 2>&1 &
    elif command -v nohup >/dev/null 2>&1; then
        nohup "$bin" "$moddir" >/dev/null 2>&1 &
    else
        "$bin" "$moddir" >/dev/null 2>&1 &
    fi
    pid=$!
    printf '%s\n' "$pid" > "$moddir/config/daemon.pid" 2>/dev/null

    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        log_line "$logfile" "[OK]   守护进程已启动 pid=$pid（setsid 后台，参数：模块目录 $moddir）"
        return 0
    fi

    # setsid 在调用进程是进程组长时会 fork 并立刻退出：$! 已退出但守护进程仍在，
    # 因此按进程名再确认一次；同时兼容守护进程自行 daemonize（double-fork）的实现。
    pid=$(pidof touch_rate_daemon 2>/dev/null | awk '{print $1}')
    [ -n "$pid" ] || pid=$(pidof touch_rate_daem 2>/dev/null | awk '{print $1}')
    if [ -n "$pid" ]; then
        printf '%s\n' "$pid" > "$moddir/config/daemon.pid" 2>/dev/null
        log_line "$logfile" "[OK]   守护进程已启动 pid=$pid（自行转入后台）"
        return 0
    fi

    log_line "$logfile" "[FAIL] 守护进程启动后立即退出（pid=$pid），请查看 config/daemon.log"
    rm -f "$moddir/config/daemon.pid" 2>/dev/null
    return 1
}
