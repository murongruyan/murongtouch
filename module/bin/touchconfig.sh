#!/system/bin/sh
# 新平台（OnePlus 15 / PLK110 等）触控采样率后端：
# 修改触控 HAL 配置文件 /data/vendor/touchconfig/vnd_custom_config_main.xml
# 的 report_rate supports 数组（17 个 value），再重启 vendor.touch-aidl-2 让 HAL 重新加载。
# 参考社区方案（肥鱼拼好控 touch-rate.sh）实现，映射表为 PLK110/S3910 实测值：
#   value 9  -> 官方默认(~173Hz)
#   value 4  -> 180Hz
#   value 3  -> 240Hz
#   value 10 -> ~298Hz
#   value 1  -> ~307Hz（本机上限）
# usage:
#   touchconfig.sh status                 # supported=yes/no + path + current value
#   touchconfig.sh get                    # 输出当前档位标签（180/240/298/307/default）
#   touchconfig.sh apply <hz|default|value-N>   # 应用档位（仅变化时重启 HAL）
#   touchconfig.sh restore                 # 恢复官方默认
#   touchconfig.sh value-list              # 输出当前 17 个 value 列表

MOD=${MOD_PATH:-/data/adb/modules/gt8pro_touch}
CFG_DIR="${MOD}/config"
STATE_DIR="${DATA_DIR:-/data/adb/murong_touch}"
TCFG="/data/vendor/touchconfig/vnd_custom_config_main.xml"
TCFG_BAK="${STATE_DIR}/vnd_custom_config_main.xml.bak"
STATE_FILE="${STATE_DIR}/touch_hz"

log_msg() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') touchconfig: $1" >> "${MOD}/config/daemon.log" 2>/dev/null
    log -t MurongTouch -p i "touchconfig: $1" 2>/dev/null
}

# 官方默认值列表（参考社区方案；ODM 文件存在时优先用 ODM 文件恢复）
DEFAULT_LIST="9,2,9,4,3,10,2,2,2,2,2,2,8,9,11,2,12"

find_odm_cfg() {
    for f in /odm/firmware/tp/infiniti/vnd_custom_config_main.xml \
             /odm/firmware/tp/*/vnd_custom_config_main.xml; do
        [ -f "$f" ] && { echo "$f"; return 0; }
    done
    return 1
}

# 读取 report_rate supports 数组（17 个数字时才认）
get_value_list() {
    [ -f "$TCFG" ] || return 1
    awk -F'[<>]' '/<value>/{n=split($3,a,","); if(n==17){print $3; exit 0}}' "$TCFG" 2>/dev/null
}

value_list_uniform() {
    # 输入 "4,4,4,..."；如果全部相同输出该值，否则空
    printf '%s' "$1" | awk -F, '{v=$1; for(i=2;i<=NF;i++){if($i!=v){exit 1}}; print v}' 2>/dev/null
}

label_for_value() {
    case "$1" in
        4) echo "180" ;;
        3) echo "240" ;;
        10) echo "298" ;;
        1) echo "307" ;;
        9) echo "default" ;;
        *) echo "value-$1" ;;
    esac
}

value_for_label() {
    case "$1" in
        default|173) echo "9" ;;
        180) echo "4" ;;
        240) echo "3" ;;
        288|298) echo "10" ;;
        360|400) echo "1" ;;
        value-*) echo "${1#value-}" ;;
        *) echo "" ;;
    esac
}

replace_value_list() {
    awk -v nl="$1" '{
        if ($0 ~ /<value>/) {
            n = split($0, a, ",");
            if (n == 17) sub(/<value>[0-9,]+<\/value>/, "<value>" nl "</value>");
        }
        print
    }' "$TCFG" > "$TCFG.tmp" 2>/dev/null && mv -f "$TCFG.tmp" "$TCFG" 2>/dev/null
}

restart_touch_hal() {
    log_msg "重启 vendor.touch-aidl-2 以加载配置"
    stop vendor.touch-aidl-2 2>/dev/null
    sleep 1
    start vendor.touch-aidl-2 2>/dev/null
    sleep 1
    # init 未拉起时兜底：杀掉进程等待 init 重启
    if ! pidof vendor.touch-aidl-2 >/dev/null 2>&1; then
        killall vendor-oplus-hardware-touch-V2-hbp5-service 2>/dev/null
        killall vendor.touch-aidl-2 2>/dev/null
    fi
    sleep 1
}

cmd_status() {
    if [ ! -f "$TCFG" ]; then
        echo "supported=no"
        echo "reason=config_missing"
        echo "path=$TCFG"
        return 1
    fi
    LIST=$(get_value_list)
    if [ -z "$LIST" ]; then
        echo "supported=no"
        echo "reason=config_format"
        echo "path=$TCFG"
        return 1
    fi
    UNI=$(value_list_uniform "$LIST")
    echo "supported=yes"
    echo "path=$TCFG"
    echo "value_list=$LIST"
    if [ -n "$UNI" ]; then echo "current_value=$UNI"; echo "current=$(label_for_value "$UNI")"; else echo "current_value=mixed"; echo "current=mixed"; fi
    [ -f "$STATE_FILE" ] && echo "selected=$(cat "$STATE_FILE" 2>/dev/null)"
    return 0
}

cmd_apply() {
    RATE="$1"
    VALUE=$(value_for_label "$RATE")
    case "$VALUE" in ''|*[!0-9]*) echo "error: unsupported_rate:$RATE"; return 2 ;; esac
    [ "$VALUE" -ge 1 ] && [ "$VALUE" -le 12 ] || { echo "error: invalid_value:$VALUE"; return 2; }
    if [ ! -f "$TCFG" ]; then echo "error: config_missing"; return 1; fi
    mkdir -p "$STATE_DIR" 2>/dev/null
    [ -f "$TCFG_BAK" ] || cp -f "$TCFG" "$TCFG_BAK" 2>/dev/null

    if [ "$RATE" = "default" ] || [ "$RATE" = "173" ]; then
        ODM=$(find_odm_cfg)
        if [ -n "$ODM" ]; then
            cp -f "$ODM" "$TCFG" 2>/dev/null || { echo "error: restore_copy_failed"; return 1; }
        elif [ -f "$TCFG_BAK" ]; then
            cp -f "$TCFG_BAK" "$TCFG" 2>/dev/null || { echo "error: restore_bak_failed"; return 1; }
        else
            replace_value_list "$DEFAULT_LIST" || { echo "error: restore_awk_failed"; return 1; }
        fi
        echo "default" > "$STATE_FILE" 2>/dev/null
        restart_touch_hal
        log_msg "恢复官方默认采样率"
        echo "ok:default"
        return 0
    fi

    NEW_LIST="$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE,$VALUE"
    replace_value_list "$NEW_LIST" || { echo "error: write_failed"; return 1; }
    CUR=$(get_value_list)
    [ "$CUR" = "$NEW_LIST" ] || { echo "error: verify_failed expect=$NEW_LIST got=$CUR"; return 1; }
    echo "$RATE" > "$STATE_FILE" 2>/dev/null
    restart_touch_hal
    log_msg "触控采样率已切换: $RATE (value=$VALUE)"
    echo "ok:$RATE value=$VALUE"
    return 0
}

cmd_restore() { cmd_apply default; }

case "${1:-status}" in
    status) cmd_status ;;
    get) [ -f "$STATE_FILE" ] && cat "$STATE_FILE" 2>/dev/null || echo "default" ;;
    apply) cmd_apply "${2:-}" ;;
    restore) cmd_restore ;;
    value-list) get_value_list ;;
    *) echo "usage: touchconfig.sh status|get|apply <hz|default|value-N>|restore|value-list"; exit 2 ;;
esac
