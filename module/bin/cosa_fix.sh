#!/system/bin/sh
# 应用增强服务（com.oplus.cosa）接管触控采样率：兼容修复开关
# 原理：把 Cosa 游戏数据库 db_game_database 的 refresh_rate 注入最高采样率配置，
#       让它自己请求高采样率，而不是强制覆盖模块写入的值。首次注入自动备份数据库。
# usage:
#   cosa_fix.sh status      # enabled=0/1 + cloud-rate status
#   cosa_fix.sh enable      # 开启并立即注入
#   cosa_fix.sh disable     # 关闭并恢复 Cosa 数据库
#   cosa_fix.sh apply-boot  # 开机后台应用（enabled=1 时）
MOD=${MOD_PATH:-/data/adb/modules/gt8pro_touch}
DATA_DIR="${DATA_DIR:-/data/adb/murong_touch}"
CONF="$DATA_DIR/cosa_fix.conf"
CLOUD="$MOD/bin/cloud-rate.sh"
LOG="$MOD/config/daemon.log"

notify() {
    [ -x /system/bin/cmd ] && /system/bin/cmd notification post -S bigtext -t "慕容触控采样率" murong_touch "$1" >/dev/null 2>&1
}
log_msg() { echo "$(date '+%Y-%m-%d %H:%M:%S') cosa_fix: $1" >> "$LOG" 2>/dev/null; }

enabled() { [ -f "$CONF" ] && grep -q '^enabled=1' "$CONF" 2>/dev/null; }

cmd_status() {
    echo "enabled=$(enabled && echo 1 || echo 0)"
    echo "conf=$CONF"
    [ -f "$CONF" ] && { echo "---"; cat "$CONF"; }
    if [ -f "$CLOUD" ]; then sh "$CLOUD" status 2>/dev/null; else echo "supported=no"; echo "reason=cloud_script_missing"; fi
}

cmd_enable() {
    if [ ! -f "$CLOUD" ]; then echo "error: cloud-rate.sh 不存在"; return 1; fi
    SUPPORTED=$(sh "$CLOUD" status 2>/dev/null | sed -n 's/^supported=//p' | head -1)
    if [ "$SUPPORTED" != "yes" ]; then
        echo "error: 当前机型无应用增强服务兼容配置（supported=$SUPPORTED）"
        return 1
    fi
    mkdir -p "$DATA_DIR" 2>/dev/null
    printf 'enabled=1\nupdated_at=%s\n' "$(date +%s)" > "$CONF"
    OUT=$(sh "$CLOUD" inject 2>&1)
    log_msg "enable inject: $OUT"
    case "$OUT" in
        ok:*) notify "应用增强服务兼容修复已开启：$OUT"; echo "success:true"; echo "$OUT" ;;
        *) echo "error: $OUT"; return 1 ;;
    esac
}

cmd_disable() {
    if [ -f "$CLOUD" ]; then
        OUT=$(sh "$CLOUD" restore 2>&1)
        log_msg "disable restore: $OUT"
    else
        OUT="cloud_missing"
    fi
    printf 'enabled=0\nupdated_at=%s\n' "$(date +%s)" > "$CONF" 2>/dev/null
    notify "应用增强服务兼容修复已关闭，已恢复数据库"
    echo "success:true"; echo "$OUT"
}

cmd_apply_boot() {
    enabled || return 0
    SUPPORTED=$(sh "$CLOUD" status 2>/dev/null | sed -n 's/^supported=//p' | head -1)
    [ "$SUPPORTED" = "yes" ] || { log_msg "开机跳过：不支持($SUPPORTED)"; return 0; }
    OUT=$(sh "$CLOUD" inject 2>&1)
    log_msg "boot inject: $OUT"
    case "$OUT" in ok:*) notify "应用增强服务兼容修复已生效（开机自动）" ;; esac
}

case "${1:-status}" in
    status) cmd_status ;;
    enable) cmd_enable ;;
    disable) cmd_disable ;;
    apply-boot) cmd_apply_boot ;;
    *) echo "usage: cosa_fix.sh status|enable|disable|apply-boot"; exit 2 ;;
esac
