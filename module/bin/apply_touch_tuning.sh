#!/system/bin/sh
# 触控/系统优化参数应用（参考社区模块，默认不修改任何系统设置）
# 配置：/data/adb/murong_touch/touch_tuning.conf（或 <MOD>/config/touch_tuning.conf）
# 格式 KEY=VALUE，# 注释。支持：
#   触控防抖: touch_slop, scroll_friction, fling_velocity
#   手势/优先级: touch_priority, vtouch_switch, double_tap|multi_press_timeout, long_press_timeout
#   显示/触控延迟: vsync_enabled, refresh_mode_id
#   性能: enable_adpf, enable_hint_manager, cpufreq_limit_disabled, cpufreq_bounce_disabled
#   相位偏移: early_phase_offset_ns, early_app_phase_offset_ns, early_gl_phase_offset_ns,
#             early_gl_app_phase_offset_ns, high_fps_early_phase_offset_ns,
#             high_fps_early_gl_phase_offset_ns, high_fps_late_app_phase_offset_ns,
#             phase_offset_threshold_for_next_vsync_ns
# usage: apply_touch_tuning.sh apply|restore|status
MOD=${MOD_PATH:-/data/adb/modules/gt8pro_touch}
STATE_DIR="${DATA_DIR:-/data/adb/murong_touch}"
CONF="${STATE_DIR}/touch_tuning.conf"
[ -f "$CONF" ] || CONF="$MOD/config/touch_tuning.conf"
LOG="$MOD/config/daemon.log"

put_setting() {
    # settings 偶尔 system_server busy (Failed transaction)，重试 3 次
    NS="$1"; KEY="$2"; VAL="$3"
    i=0
    while [ "$i" -lt 3 ]; do
        if settings put "$NS" "$KEY" "$VAL" >/dev/null 2>&1; then return 0; fi
        i=$((i+1)); sleep 1
    done
    log_msg "settings put $NS/$KEY=$VAL 失败"
    return 1
}

log_msg() { echo "$(date '+%Y-%m-%d %H:%M:%S') touch_tuning: $1" >> "$LOG" 2>/dev/null; }

renice_touch() {
    PRIO="$1"
    for name in vendor-oplus-hardware-touch-V2-service vendor-oplus-hardware-touch-V2-hbp5-service vendor.touch-aidl-2 touchDaemon; do
        PID=$(pidof "$name" 2>/dev/null | awk '{print $1}')
        [ -n "$PID" ] && renice -n "$PRIO" -p "$PID" >/dev/null 2>&1 && log_msg "renice $name=$PRIO pid=$PID"
    done
}

cpufreq_limit() {
    F=/proc/game_opt/disable_cpufreq_limit
    [ -f "$F" ] || return 0
    chmod 0644 "$F" 2>/dev/null
    if [ "$1" = "1" ]; then echo 1 > "$F" 2>/dev/null; else echo 0 > "$F" 2>/dev/null; fi
    chmod 0444 "$F" 2>/dev/null
    log_msg "cpufreq_limit_disabled=$1"
}

cpufreq_bounce() {
    F=/sys/module/cpufreq_bouncing/parameters/enable
    [ -f "$F" ] || return 0
    chmod 0644 "$F" 2>/dev/null
    if [ "$1" = "1" ]; then echo 0 > "$F" 2>/dev/null; else echo 1 > "$F" 2>/dev/null; fi
    chmod 0444 "$F" 2>/dev/null
    log_msg "cpufreq_bounce_disabled=$1"
}

apply_conf() {
    [ -f "$CONF" ] || { log_msg "无配置文件，不修改"; return 0; }
    while IFS='=' read -r key value; do
        key=$(printf '%s' "$key" | tr -d ' \t\r')
        value=$(printf '%s' "$value" | tr -d ' \t\r')
        case "$key" in ''|'#'*) continue ;; esac
        case "$key" in
            touch_slop)            [ -n "$value" ] && setprop view.touch_slop "$value" && log_msg "touch_slop=$value" ;;
            scroll_friction)       [ -n "$value" ] && setprop view.scroll_friction "$value" && log_msg "scroll_friction=$value" ;;
            fling_velocity)        [ -n "$value" ] && setprop view.minimum_fling_velocity "$value" && log_msg "fling_velocity=$value" ;;
            touch_priority)        [ -n "$value" ] && renice_touch "$value" ;;
            vtouch_switch)
                if [ "$value" = "0" ]; then put_setting system vtouch_switch 0; else settings delete system vtouch_switch 2>/dev/null; fi
                log_msg "vtouch_switch=$value" ;;
            double_tap|multi_press_timeout)
                [ -n "$value" ] && put_setting secure multi_press_timeout "$value" && log_msg "multi_press_timeout=$value" ;;
            long_press_timeout)
                [ -n "$value" ] && put_setting secure long_press_timeout "$value" && log_msg "long_press_timeout=$value" ;;
            vsync_enabled)
                if [ "$value" = "1" ]; then put_setting global hwui.disable_vsync false; else put_setting global hwui.disable_vsync true; fi
                log_msg "vsync_enabled=$value" ;;
            refresh_mode_id)
                [ -n "$value" ] && service call SurfaceFlinger 1035 i32 "$value" >/dev/null 2>&1 && log_msg "refresh_mode_id=$value" ;;
            enable_adpf)
                [ -n "$value" ] && setprop debug.sf.enable_adpf_cpu_hint "$value" && log_msg "enable_adpf=$value" ;;
            enable_hint_manager)
                [ -n "$value" ] && setprop debug.hwui.use_hint_manager "$value" && log_msg "enable_hint_manager=$value" ;;
            cpufreq_limit_disabled)  cpufreq_limit "$value" ;;
            cpufreq_bounce_disabled) cpufreq_bounce "$value" ;;
            early_phase_offset_ns|early_app_phase_offset_ns|early_gl_phase_offset_ns|early_gl_app_phase_offset_ns|high_fps_early_phase_offset_ns|high_fps_early_gl_phase_offset_ns|high_fps_late_app_phase_offset_ns|phase_offset_threshold_for_next_vsync_ns)
                [ -n "$value" ] && setprop "debug.sf.$key" "$value" && log_msg "debug.sf.$key=$value" ;;
            *)
                [ -n "$value" ] && setprop "debug.sf.$key" "$value" 2>/dev/null ;;
        esac
    done < "$CONF"
}

restore_defaults() {
    for p in view.touch_slop view.scroll_friction view.minimum_fling_velocity; do
        setprop "$p" "" 2>/dev/null
    done
    settings delete secure multi_press_timeout 2>/dev/null
    settings delete secure long_press_timeout 2>/dev/null
    settings delete system vtouch_switch 2>/dev/null
    settings delete global hwui.disable_vsync 2>/dev/null
    setprop debug.sf.enable_adpf_cpu_hint "" 2>/dev/null
    setprop debug.hwui.use_hint_manager "" 2>/dev/null
    for k in early_phase_offset_ns early_app_phase_offset_ns early_gl_phase_offset_ns early_gl_app_phase_offset_ns high_fps_early_phase_offset_ns high_fps_early_gl_phase_offset_ns high_fps_late_app_phase_offset_ns phase_offset_threshold_for_next_vsync_ns; do
        setprop "debug.sf.$k" "" 2>/dev/null
    done
    cpufreq_limit 0
    cpufreq_bounce 0
    for name in vendor-oplus-hardware-touch-V2-service vendor-oplus-hardware-touch-V2-hbp5-service vendor.touch-aidl-2 touchDaemon; do
        PID=$(pidof "$name" 2>/dev/null | awk '{print $1}')
        [ -n "$PID" ] && renice -n 0 -p "$PID" >/dev/null 2>&1
    done
    log_msg "已恢复触控优化默认值"
}

status() {
    echo "conf=$CONF"
    [ -f "$CONF" ] && { echo "---"; cat "$CONF"; } || echo "not_enabled"
    echo "touch_slop=$(getprop view.touch_slop)"
    echo "scroll_friction=$(getprop view.scroll_friction)"
    echo "fling_velocity=$(getprop view.minimum_fling_velocity)"
    echo "multi_press_timeout=$(settings get secure multi_press_timeout 2>/dev/null)"
    echo "long_press_timeout=$(settings get secure long_press_timeout 2>/dev/null)"
    echo "hwui.disable_vsync=$(settings get global hwui.disable_vsync 2>/dev/null)"
    echo "vtouch_switch=$(settings get system vtouch_switch 2>/dev/null)"
}

case "${1:-apply}" in
    apply) apply_conf ;;
    restore) restore_defaults ;;
    status) status ;;
    *) echo "usage: apply_touch_tuning.sh apply|restore|status"; exit 2 ;;
esac
