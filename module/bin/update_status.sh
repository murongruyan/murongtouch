#!/system/bin/sh
# 动态更新 module.prop 的 description（当前采样率/前台/授权/触显同步）
# 由 service.sh 后台 watch 运行；也可手动执行一次。
# 同时检测授权 valid<->invalid 变化并发系统通知。
MOD=${MOD_PATH:-/data/adb/modules/gt8pro_touch}
DAEMON="$MOD/bin/touch_rate_daemon"
STATE_DIR="${DATA_DIR:-/data/adb/murong_touch}"
LIC_STATE="$STATE_DIR/.license_state"
INTERVAL=${UPDATE_STATUS_INTERVAL:-10}

notify() {
    TITLE="$1"; BODY="$2"
    [ -n "$BODY" ] || return 0
    if [ -x /system/bin/cmd ]; then
        /system/bin/cmd notification post -S bigtext -t "$TITLE" murong_touch "$BODY" >/dev/null 2>&1 && return 0
    fi
    log -t MurongTouch -p i "$TITLE: $BODY" 2>/dev/null
    return 0
}

json_field() {
    printf '%s' "$1" | tr ',' '\n' | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\).*/\1/p" | head -n 1
}

apply_once() {
    [ -x "$DAEMON" ] || return 0
    mkdir -p "$STATE_DIR" 2>/dev/null
    JSON=$("$DAEMON" --json "$MOD" 2>/dev/null | tail -n 1)
    [ -n "$JSON" ] || return 0
    CURRENT=$(json_field "$JSON" current_hz)
    TARGET=$(json_field "$JSON" target_hz)
    FG=$(json_field "$JSON" foreground)
    LICENSE=$(json_field "$JSON" license_mode)
    LICENSED=$(json_field "$JSON" licensed)
    SYNC=$(json_field "$JSON" sync_enabled)
    BACKEND=$(json_field "$JSON" backend)
    [ -n "$CURRENT" ] || CURRENT="?"
    [ -n "$TARGET" ] || TARGET="?"
    [ -n "$FG" ] || FG="?"
    case "$LICENSE" in valid) LIC_TEXT="有效" ;; grace) LIC_TEXT="离线宽限" ;; expired) LIC_TEXT="已过期" ;; invalid) LIC_TEXT="无效" ;; *) LIC_TEXT="${LICENSE:-未知}" ;; esac
    [ "$SYNC" = "true" ] && SYNC_TEXT="开" || SYNC_TEXT="关"
    [ "$BACKEND" = "none" ] && BACKEND_TEXT="无通道" || BACKEND_TEXT="$BACKEND"

    OLD_DESC=$(sed -n 's/^description=//p' "$MOD/module.prop" 2>/dev/null | head -n 1)
    NEW_DESC="按前台应用自动切换触控采样率（付费授权模块）· 当前 ${CURRENT}Hz · 前台 ${FG} · 授权 ${LIC_TEXT} · 触显同步 ${SYNC_TEXT} · 后端 ${BACKEND_TEXT}"
    if [ "$OLD_DESC" != "$NEW_DESC" ] && [ -f "$MOD/module.prop" ]; then
        TMP="$MOD/module.prop.tmp.$$"
        awk -v d="$NEW_DESC" 'BEGIN{done=0} /^description=/{print "description=" d; done=1; next} {print} END{if(!done) print "description=" d}' \
            "$MOD/module.prop" > "$TMP" 2>/dev/null && mv -f "$TMP" "$MOD/module.prop" 2>/dev/null
        chmod 644 "$MOD/module.prop" 2>/dev/null
    fi

    # 授权状态变化通知（每类一次状态切换）
    PREV=$(cat "$LIC_STATE" 2>/dev/null)
    if [ "$LICENSED" = "false" ] && [ "$PREV" != "invalid" ]; then
        notify "慕容触控采样率" "授权已失效：$LIC_TEXT（${CURRENT}Hz 已停止写入，恢复系统值）。可在 WebUI 用户页查看/修复。"
        echo invalid > "$LIC_STATE" 2>/dev/null
    elif [ "$LICENSED" = "true" ] && [ "$PREV" != "valid" ]; then
        notify "慕容触控采样率" "授权已恢复：采样率功能已启用（当前 ${CURRENT}Hz，后端 ${BACKEND_TEXT}）。"
        echo valid > "$LIC_STATE" 2>/dev/null
    fi
}

case "${1:-once}" in
    once) apply_once ;;
    watch)
        while :; do
            apply_once
            sleep "$INTERVAL"
        done
        ;;
    *) apply_once ;;
esac
