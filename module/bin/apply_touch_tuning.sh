#!/system/bin/sh
# 触控手感优化参数应用（参考社区模块可选功能，默认不修改任何系统设置）
# 配置：/data/adb/murong_touch/touch_tuning.conf（或 <MOD>/config/touch_tuning.conf），格式 KEY=VALUE，# 注释
# 支持键：
#   touch_slop              -> setprop view.touch_slop
#   scroll_friction         -> setprop view.scroll_friction
#   fling_velocity          -> setprop view.minimum_fling_velocity
#   multi_press_timeout     -> settings put secure multi_press_timeout
#   long_press_timeout      -> settings put secure long_press_timeout
#   touch_priority          -> renice 触控 HAL / touchDaemon（如 -5）
#   vtouch_switch           -> settings put system vtouch_switch
# usage: apply_touch_tuning.sh apply|restore
MOD=${MOD_PATH:-/data/adb/modules/gt8pro_touch}
STATE_DIR="${DATA_DIR:-/data/adb/murong_touch}"
CONF="${STATE_DIR}/touch_tuning.conf"
[ -f "$CONF" ] || CONF="$MOD/config/touch_tuning.conf"
DEFAULTS="${STATE_DIR}/touch_tuning.defaults"

log_msg() { echo "$(date '+%Y-%m-%d %H:%M:%S') touch_tuning: $1" >> "$MOD/config/daemon.log" 2>/dev/null; }

renice_touch() {
    PRIO="$1"
    for name in vendor-oplus-hardware-touch-V2-service vendor-oplus-hardware-touch-V2-hbp5-service vendor.touch-aidl-2; do
        PID=$(pidof "$name" 2>/dev/null | awk '{print $1}')
        [ -n "$PID" ] && renice -n "$PRIO" -p "$PID" >/dev/null 2>&1 && log_msg "renice $name=$PRIO pid=$PID"
    done
    PID=$(pidof touchDaemon 2>/dev/null | awk '{print $1}')
    [ -n "$PID" ] && renice -n "$PRIO" -p "$PID" >/dev/null 2>&1 && log_msg "renice touchDaemon=$PRIO pid=$PID"
}

apply_conf() {
    [ -f "$CONF" ] || { log_msg "无配置文件，不修改"; return 0; }
    mkdir -p "$STATE_DIR" 2>/dev/null
    [ -f "$DEFAULTS" ] || : > "$DEFAULTS"
    while IFS='=' read -r key value; do
        key=$(printf '%s' "$key" | tr -d ' \t\r')
        value=$(printf '%s' "$value" | tr -d ' \t\r')
        case "$key" in ''|'#'*) continue ;; esac
        case "$key" in
            touch_slop)
                [ -n "$value" ] && setprop view.touch_slop "$value" && log_msg "touch_slop=$value" ;;
            scroll_friction)
                [ -n "$value" ] && setprop view.scroll_friction "$value" && log_msg "scroll_friction=$value" ;;
            fling_velocity)
                [ -n "$value" ] && setprop view.minimum_fling_velocity "$value" && log_msg "fling_velocity=$value" ;;
            multi_press_timeout)
                [ -n "$value" ] && settings put secure multi_press_timeout "$value" 2>/dev/null && log_msg "multi_press_timeout=$value" ;;
            long_press_timeout)
                [ -n "$value" ] && settings put secure long_press_timeout "$value" 2>/dev/null && log_msg "long_press_timeout=$value" ;;
            touch_priority)
                [ -n "$value" ] && renice_touch "$value" ;;
            vtouch_switch)
                [ -n "$value" ] && settings put system vtouch_switch "$value" 2>/dev/null && log_msg "vtouch_switch=$value" ;;
        esac
    done < "$CONF"
}

restore_defaults() {
    # 只清理由我们设置过的属性/配置；settings 值尽量恢复 Android 默认
    for p in view.touch_slop view.scroll_friction view.minimum_fling_velocity; do
        setprop "$p" "" 2>/dev/null
    done
    settings delete secure multi_press_timeout 2>/dev/null
    settings delete secure long_press_timeout 2>/dev/null
    settings put system vtouch_switch 0 2>/dev/null
    for name in vendor-oplus-hardware-touch-V2-service vendor-oplus-hardware-touch-V2-hbp5-service vendor.touch-aidl-2 touchDaemon; do
        PID=$(pidof "$name" 2>/dev/null | awk '{print $1}')
        [ -n "$PID" ] && renice -n 0 -p "$PID" >/dev/null 2>&1
    done
    log_msg "已恢复触控优化默认值"
}

case "${1:-apply}" in
    apply) apply_conf ;;
    restore) restore_defaults ;;
    *) echo "usage: apply_touch_tuning.sh apply|restore"; exit 2 ;;
esac
