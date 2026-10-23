#!/system/bin/sh
# ============================================================
# 慕容触控采样率 v5.0 · 设备端 API 桥（WebUI -> 后端）
# 用法（stdout 单行 JSON；失败返回 {"success":false,"message":"..."}）：
#   api.sh api_request <GET|POST> <path> <auth 0/1> <payload_b64> <nonce> <form 0/1>
#   api.sh auth_state
#   api.sh auth_save_account <b64>       # {"username","user_id","token"}
#   api.sh auth_save_lease <b64>         # SignedLease JSON
#   api.sh auth_save_entitlement <b64>   # {"entitlement","license_last4","device_bound"}
#   api.sh auth_clear_account
#   api.sh auth_device_info
#   api.sh premium_state
#   api.sh download_premium <pkg_id> <token> <out_zip> [download_url]
#   api.sh install_premium <zip_path>
# ============================================================
set -u
PATH="/system/bin:/system/xbin:/vendor/bin:$PATH"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd)
MOD=${MOD_PATH:-$(CDPATH= cd -- "$SCRIPT_DIR/.." 2>/dev/null && pwd)}
if [ -z "$MOD" ] || [ ! -d "$MOD" ]; then
    printf '%s\n' '{"success":false,"message":"无法定位模块目录"}'
    exit 1
fi
AUTH_DIR="$MOD/config/auth"
ACCOUNT_FILE="$AUTH_DIR/account.json"
LEASE_FILE="$AUTH_DIR/lease.json"
STATE_FILE="$AUTH_DIR/state.json"
DEVICE_ID_FILE="$AUTH_DIR/device_id.txt"
LEASE_PUBLIC_KEY="$AUTH_DIR/lease_public_key.hex"
LEASE_KEY_ID_FILE="$AUTH_DIR/lease_key_id.txt"
PREMIUM_BIN="$MOD/bin/touch_rate_daemon"
BASE_API="${BASE_API:-https://murongdiaodu.rl1.cc/api}"

mkdir -p "$AUTH_DIR" 2>/dev/null || true

CURL_BIN=""
[ -x "$MOD/bin/curl" ] && CURL_BIN="$MOD/bin/curl"
if [ -z "$CURL_BIN" ]; then CURL_BIN=$(command -v curl 2>/dev/null); fi
BUSYBOX_BIN=""
[ -x /data/adb/ksu/bin/busybox ] && BUSYBOX_BIN=/data/adb/ksu/bin/busybox
if [ -z "$BUSYBOX_BIN" ]; then BUSYBOX_BIN=$(command -v busybox 2>/dev/null); fi

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr -d '\r\n'
}

json_str() {
    # json_str <file> <key>：读取扁平 JSON 的字符串字段
    [ -f "$1" ] || { printf ''; return 0; }
    sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -n 1
}

json_num() {
    [ -f "$1" ] || { printf ''; return 0; }
    sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*\([0-9][0-9.]*\).*/\1/p' "$1" 2>/dev/null | head -n 1
}

json_bool01() {
    [ -f "$1" ] || { printf '0'; return 0; }
    if grep -Eq '"'"$2"'"[[:space:]]*:[[:space:]]*(true|1)' "$1" 2>/dev/null; then printf '1'; else printf '0'; fi
}

b64_decode() {
    # b64_decode <b64> <out_file>
    local_data="$1"
    local_out="$2"
    local_data=$(printf '%s' "$local_data" | tr '_-' '/+' | tr -d '\r\n')
    case $((${#local_data} % 4)) in
        2) local_data="${local_data}==" ;;
        3) local_data="${local_data}=" ;;
    esac
    if command -v base64 >/dev/null 2>&1; then
        printf '%s' "$local_data" | base64 -d > "$local_out" 2>/dev/null
    elif [ -n "$BUSYBOX_BIN" ]; then
        printf '%s' "$local_data" | "$BUSYBOX_BIN" base64 -d > "$local_out" 2>/dev/null
    else
        return 1
    fi
}

sha256_file() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" 2>/dev/null | awk '{print $1}'; return; fi
    if [ -n "$BUSYBOX_BIN" ]; then "$BUSYBOX_BIN" sha256sum "$1" 2>/dev/null | awk '{print $1}'; return; fi
    printf ''
}

sha256_text() {
    if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum 2>/dev/null | awk '{print $1}'; return; fi
    if [ -n "$BUSYBOX_BIN" ]; then printf '%s' "$1" | "$BUSYBOX_BIN" sha256sum 2>/dev/null | awk '{print $1}'; return; fi
    printf ''
}

iso_to_epoch() {
    ISO="$1"
    [ -n "$ISO" ] || { printf '0'; return 0; }
    case "$ISO" in *[!0-9]*) ;; *) printf '%s' "$ISO"; return 0 ;; esac
    if command -v date >/dev/null 2>&1; then
        E=$(date -u -d "$ISO" +%s 2>/dev/null)
        [ -n "$E" ] && { printf '%s' "$E"; return 0; }
        E=$(date -u -D '%Y-%m-%dT%H:%M:%SZ' -d "$ISO" +%s 2>/dev/null)
        [ -n "$E" ] && { printf '%s' "$E"; return 0; }
    fi
    printf '0'
}

err_json() { printf '{"success":false,"message":"%s"}\n' "$(json_escape "$1")"; }
ok_json() { printf '{"success":true%s}\n' "$1"; }

premium_installed() { [ -f "$PREMIUM_BIN" ] && printf '1' || printf '0'; }

premium_version() {
    [ -f "$PREMIUM_BIN" ] || { printf ''; return 0; }
    V=$("$PREMIUM_BIN" --version 2>/dev/null | head -n 1 | tr -d '\r\n')
    case "$V" in *[!A-Za-z0-9._-]*) V="" ;; esac
    printf '%s' "$V"
}

# ---------------- 设备标识 ----------------
getprop_safe() { getprop "$1" 2>/dev/null | tr -d '\r\n' | head -c 128; }

device_identity() {
    DEVICE_SERIAL=$(getprop_safe ro.serialno)
    [ -n "$DEVICE_SERIAL" ] || DEVICE_SERIAL=$(getprop_safe ro.boot.serialno)
    DEVICE_SN_ALT=$(getprop_safe ro.boot.serialno)
    [ -n "$DEVICE_SN_ALT" ] || DEVICE_SN_ALT="$DEVICE_SERIAL"
    DEVICE_IMEI1=$(getprop_safe ro.ril.oem.imei)
    [ -n "$DEVICE_IMEI1" ] || DEVICE_IMEI1=$(getprop_safe ro.telephony.imei1)
    [ -n "$DEVICE_IMEI1" ] || DEVICE_IMEI1=$(getprop_safe persist.radio.imei)
    DEVICE_IMEI2=$(getprop_safe ro.ril.oem.imei2)
    [ -n "$DEVICE_IMEI2" ] || DEVICE_IMEI2=$(getprop_safe ro.telephony.imei2)
    DEVICE_ANDROID_ID=$(settings get secure android_id 2>/dev/null | tr -d '\r\n')
    case "$DEVICE_ANDROID_ID" in null|'') DEVICE_ANDROID_ID="" ;; esac
    DEVICE_MODEL=$(getprop_safe ro.product.vendor.model)
    [ -n "$DEVICE_MODEL" ] || DEVICE_MODEL=$(getprop_safe ro.product.model)
    SOC_MODEL=$(getprop_safe ro.soc.model)
    BUILD_FINGERPRINT=$(getprop_safe ro.build.fingerprint)
    BASE_VERSION=$(sed -n 's/^version=//p' "$MOD/module.prop" 2>/dev/null | head -n 1 | tr -d '\r\n')
    KERNEL=$(uname -r 2>/dev/null | tr -d '\r\n' | cut -c1-48)

    # 与服务端 deriveDeviceIDHash 完全一致（touch/display 共用 canonical）：
    # murong-display-device-v2|id=<lower device_id>|sn=<sn>|imei1=<imei1>|imei2=<imei2>
    # 归一化：SN 去首尾引号/空白；IMEI 去空格、连字符，分号转逗号。
    DEVICE_ID_RAW=$(printf '%s' "$DEVICE_SERIAL" | tr -d '\r\n' | sed 's/^[[:space:]"'\'']*//; s/[[:space:]"'\'']*$//')
    DEVICE_SN_RAW=$(printf '%s' "$DEVICE_SN_ALT" | tr -d '\r\n' | sed 's/^[[:space:]"'\'']*//; s/[[:space:]"'\'']*$//')
    IMEI1_RAW=$(printf '%s' "$DEVICE_IMEI1" | tr -d ' \r\n-' | tr ';' ',')
    IMEI2_RAW=$(printf '%s' "$DEVICE_IMEI2" | tr -d ' \r\n-' | tr ';' ',')
    DEVICE_ID_LOWER=$(printf '%s' "$DEVICE_ID_RAW" | tr 'A-Z' 'a-z')
    CANONICAL="murong-display-device-v2|id=$DEVICE_ID_LOWER|sn=$DEVICE_SN_RAW|imei1=$IMEI1_RAW|imei2=$IMEI2_RAW"
    DEVICE_HASH=$(sha256_text "$CANONICAL")
    DEVICE_ID="$DEVICE_ID_RAW"

    # 持久化原始身份与哈希，daemon 读取后按同一 canonical 复算
    printf '%s' "$DEVICE_ID_RAW" > "$DEVICE_ID_FILE" 2>/dev/null
    printf '{"device_id":"%s","sn":"%s","imei1":"%s","imei2":"%s","device_id_hash":"%s","device_model":"%s","soc_model":"%s","build_fingerprint":"%s"}' \
        "$(json_escape "$DEVICE_ID_RAW")" "$(json_escape "$DEVICE_SN_RAW")" \
        "$(json_escape "$IMEI1_RAW")" "$(json_escape "$IMEI2_RAW")" \
        "$(json_escape "$DEVICE_HASH")" "$(json_escape "$DEVICE_MODEL")" \
        "$(json_escape "$SOC_MODEL")" "$(json_escape "$BUILD_FINGERPRINT")" \
        > "$AUTH_DIR/device_identity.json" 2>/dev/null || true
}

device_json() {
    device_identity
    printf '{"device_id":"%s","sn":"%s","imei1":"%s","imei2":"%s","device_id_hash":"%s","device_model":"%s","soc_model":"%s","build_fingerprint":"%s","base_version":"%s","kernel":"%s","channel":"stable"}' \
        "$(json_escape "$DEVICE_ID_RAW")" "$(json_escape "$DEVICE_SN_RAW")" \
        "$(json_escape "$IMEI1_RAW")" "$(json_escape "$IMEI2_RAW")" \
        "$(json_escape "$DEVICE_HASH")" "$(json_escape "$DEVICE_MODEL")" \
        "$(json_escape "$SOC_MODEL")" "$(json_escape "$BUILD_FINGERPRINT")" \
        "$(json_escape "$BASE_VERSION")" "$(json_escape "$KERNEL")"
}

# ---------------- API 请求 ----------------
api_request() {
    API_METHOD="$1"; API_PATH="$2"; API_AUTH="$3"; API_BODY_B64="$4"; API_NONCE="$5"; API_FORM="$6"
    case "$API_METHOD" in GET|POST) ;; *) err_json "非法 API 方法"; return 1 ;; esac
    printf '%s' "$API_PATH" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_./?&=%+:-]*$' || { err_json "非法 API 路径"; return 1; }
    case "$API_PATH" in *..*|*///*) err_json "非法 API 路径"; return 1 ;; esac
    if [ -z "$CURL_BIN" ]; then err_json "模块和系统均缺少 curl，无法使用网络通道"; return 1; fi
    API_URL="$BASE_API/$API_PATH"
    BODY_FILE=""
    if [ "$API_METHOD" = "POST" ]; then
        [ -n "$API_BODY_B64" ] || { err_json "POST 请求缺少正文"; return 1; }
        BODY_FILE=$(mktemp 2>/dev/null) || { err_json "无法创建正文临时文件"; return 1; }
        b64_decode "$API_BODY_B64" "$BODY_FILE" || { rm -f "$BODY_FILE"; err_json "正文解码失败"; return 1; }
    else
        if [ -n "$API_BODY_B64" ]; then
            QUERY_FILE=$(mktemp 2>/dev/null) || { err_json "无法创建查询临时文件"; return 1; }
            b64_decode "$API_BODY_B64" "$QUERY_FILE" || { rm -f "$QUERY_FILE"; err_json "查询解码失败"; return 1; }
            QUERY=$(tr -d '\r\n' < "$QUERY_FILE" | head -c 2048)
            rm -f "$QUERY_FILE"
            if ! printf '%s' "$QUERY" | grep -Eq '^[A-Za-z0-9_./?&=%+:-]*$'; then err_json "非法查询参数"; return 1; fi
            [ -n "$QUERY" ] && API_URL="$API_URL?$QUERY"
        fi
    fi
    if [ -n "$API_NONCE" ]; then
        case "$API_NONCE" in *[!A-Za-z0-9-]*|????????????????????????????????????????????????????????????????*) err_json "非法请求 nonce"; return 1 ;; esac
    fi
    RESP_FILE=$(mktemp 2>/dev/null); HEADER_FILE=$(mktemp 2>/dev/null)
    [ -n "$RESP_FILE" ] && [ -n "$HEADER_FILE" ] || { rm -f "$BODY_FILE" "$RESP_FILE" "$HEADER_FILE"; err_json "无法创建临时文件"; return 1; }
    set -- --silent --show-error --location --connect-timeout 10 --max-time 30 --retry 1 --retry-delay 1 --proto '=https' --request "$API_METHOD" -H 'Accept: application/json'
    if [ "$API_AUTH" = "1" ]; then
        TOKEN_VALUE=$(json_str "$ACCOUNT_FILE" token)
        [ -n "$TOKEN_VALUE" ] || { rm -f "$BODY_FILE" "$RESP_FILE" "$HEADER_FILE"; err_json "请先登录账号"; return 1; }
        set -- "$@" -H "Authorization: Bearer $TOKEN_VALUE"
    fi
    [ -n "$API_NONCE" ] && set -- "$@" -H "X-Display-Request-Nonce: $API_NONCE"
    if [ -n "$BODY_FILE" ]; then
        if [ "$API_FORM" = "1" ]; then
            set -- "$@" -H 'Content-Type: application/x-www-form-urlencoded;charset=UTF-8' --data-binary "@$BODY_FILE"
        else
            set -- "$@" -H 'Content-Type: application/json' --data-binary "@$BODY_FILE"
        fi
    fi
    "$CURL_BIN" "$@" -D "$HEADER_FILE" -o "$RESP_FILE" "$API_URL" 2>/dev/null
    CURL_STATUS=$?
    [ -n "$BODY_FILE" ] && rm -f "$BODY_FILE"
    if [ "$CURL_STATUS" -ne 0 ]; then
        rm -f "$RESP_FILE" "$HEADER_FILE"
        err_json "服务器网络请求失败"
        return 1
    fi
    [ -s "$RESP_FILE" ] || { rm -f "$RESP_FILE" "$HEADER_FILE"; err_json "服务器返回空响应"; return 1; }
    REFRESH_TOKEN=$(grep -i '^[[:space:]]*X-Refresh-Token:' "$HEADER_FILE" 2>/dev/null | tail -n 1 | sed 's/^[^:]*:[[:space:]]*//; s/\r$//' | tr -d '[:space:]')
    case "$REFRESH_TOKEN" in *[!A-Za-z0-9._~-]*) REFRESH_TOKEN="" ;; esac
    if [ -n "$REFRESH_TOKEN" ]; then
        # 写回 account.json（保留 username/user_id）
        USER_NAME=$(json_str "$ACCOUNT_FILE" username)
        USER_ID=$(json_str "$ACCOUNT_FILE" user_id)
        printf '{"username":"%s","user_id":"%s","token":"%s"}\n' "$(json_escape "$USER_NAME")" "$(json_escape "$USER_ID")" "$(json_escape "$REFRESH_TOKEN")" > "$ACCOUNT_FILE" 2>/dev/null
        chmod 600 "$ACCOUNT_FILE" 2>/dev/null || true
        sed -i 's/}[[:space:]]*$/,"refresh_token":"'"$REFRESH_TOKEN"'"}/' "$RESP_FILE" 2>/dev/null || true
    fi
    cat "$RESP_FILE"
    rm -f "$RESP_FILE" "$HEADER_FILE"
}

# ---------------- 授权状态 ----------------
auth_state() {
    device_identity
    USER_NAME=$(json_str "$ACCOUNT_FILE" username)
    USER_ID=$(json_str "$ACCOUNT_FILE" user_id)
    TOKEN_VALUE=$(json_str "$ACCOUNT_FILE" token)
    TOKEN_PRESENT=0; [ -n "$TOKEN_VALUE" ] && TOKEN_PRESENT=1
    ENTITLEMENT=$(json_str "$STATE_FILE" entitlement)
    [ -n "$ENTITLEMENT" ] || ENTITLEMENT="unknown"
    LICENSE_LAST4=$(json_str "$STATE_FILE" license_last4)
    DEVICE_BOUND=$(json_bool01 "$STATE_FILE" device_bound)
    LEASE_EXPIRES=$(json_str "$LEASE_FILE" expires_at)
    [ -n "$LEASE_EXPIRES" ] || LEASE_EXPIRES=$(json_num "$LEASE_FILE" expires_at)
    LEASE_EPOCH=$(iso_to_epoch "$LEASE_EXPIRES")
    NOW_EPOCH=$(date -u +%s 2>/dev/null || printf '0')
    REMAINING=0
    if [ "$LEASE_EPOCH" -gt 0 ] 2>/dev/null && [ "$NOW_EPOCH" -gt 0 ] 2>/dev/null; then
        REMAINING=$((LEASE_EPOCH - NOW_EPOCH))
        [ "$REMAINING" -lt 0 ] && REMAINING=0
    fi
    DAYS_LEFT=0
    [ "$REMAINING" -gt 0 ] 2>/dev/null && DAYS_LEFT=$(( (REMAINING + 86399) / 86400 ))
    LEASE_VALID=0; [ "$REMAINING" -gt 0 ] 2>/dev/null && LEASE_VALID=1
    FEATURES=$(sed -n 's/.*"features"[[:space:]]*:[[:space:]]*\(\[[^]]*\]\).*/\1/p' "$LEASE_FILE" 2>/dev/null | head -n 1)
    [ -n "$FEATURES" ] || FEATURES='[]'
    PREMIUM=$(premium_installed)
    PREMIUM_VERSION=$(premium_version)
    PREMIUM_SHA=$(sha256_file "$PREMIUM_BIN")
    printf '{"success":true,"account":"%s","username":"%s","user_id":"%s","token_present":%s,"entitlement":"%s","license_last4":"%s","device_bound":%s,"lease_expires_at":"%s","lease_remaining_seconds":%s,"lease_days_left":%s,"lease_valid":%s,"features":%s,"device_id":"%s","device_model":"%s","premium_installed":%s,"premium_version":"%s","premium_sha256":"%s"}\n' \
        "$([ "$TOKEN_PRESENT" = "1" ] && printf logged_in || printf none)" \
        "$(json_escape "$USER_NAME")" "$(json_escape "$USER_ID")" "$TOKEN_PRESENT" \
        "$(json_escape "$ENTITLEMENT")" "$(json_escape "$LICENSE_LAST4")" "$DEVICE_BOUND" \
        "$(json_escape "$LEASE_EXPIRES")" "$REMAINING" "$DAYS_LEFT" "$LEASE_VALID" "$FEATURES" \
        "$(json_escape "$DEVICE_SERIAL")" "$(json_escape "$DEVICE_MODEL")" \
        "$PREMIUM" "$(json_escape "$PREMIUM_VERSION")" "$(json_escape "$PREMIUM_SHA")"
}

auth_save_account() {
    DATA_FILE=$(mktemp 2>/dev/null) || { err_json "无法创建临时文件"; return 1; }
    b64_decode "${1:-}" "$DATA_FILE" || { rm -f "$DATA_FILE"; err_json "账号数据解码失败"; return 1; }
    USER_NAME=$(json_str "$DATA_FILE" username)
    USER_ID=$(json_str "$DATA_FILE" user_id)
    TOKEN_VALUE=$(json_str "$DATA_FILE" token)
    rm -f "$DATA_FILE"
    [ -n "$TOKEN_VALUE" ] || { err_json "账号数据缺少 token"; return 1; }
    printf '{"username":"%s","user_id":"%s","token":"%s"}\n' "$(json_escape "$USER_NAME")" "$(json_escape "$USER_ID")" "$(json_escape "$TOKEN_VALUE")" > "$ACCOUNT_FILE"
    chmod 600 "$ACCOUNT_FILE" 2>/dev/null || true
    printf '{"success":true,"username":"%s","user_id":"%s"}\n' "$(json_escape "$USER_NAME")" "$(json_escape "$USER_ID")"
}

auth_save_lease() {
    DATA_FILE=$(mktemp 2>/dev/null) || { err_json "无法创建临时文件"; return 1; }
    b64_decode "${1:-}" "$DATA_FILE" || { rm -f "$DATA_FILE"; err_json "租约数据解码失败"; return 1; }
    if ! head -c 1 "$DATA_FILE" | grep -q '{'; then rm -f "$DATA_FILE"; err_json "租约格式错误"; return 1; fi
    mv "$DATA_FILE" "$LEASE_FILE" 2>/dev/null || { cp "$DATA_FILE" "$LEASE_FILE"; rm -f "$DATA_FILE"; }
    chmod 600 "$LEASE_FILE" 2>/dev/null || true
    printf '{"success":true,"path":"%s"}\n' "$(json_escape "$LEASE_FILE")"
}

auth_save_entitlement() {
    DATA_FILE=$(mktemp 2>/dev/null) || { err_json "无法创建临时文件"; return 1; }
    b64_decode "${1:-}" "$DATA_FILE" || { rm -f "$DATA_FILE"; err_json "授权数据解码失败"; return 1; }
    ENT=$(json_str "$DATA_FILE" entitlement)
    LAST4=$(json_str "$DATA_FILE" license_last4)
    BOUND=$(json_bool01 "$DATA_FILE" device_bound)
    rm -f "$DATA_FILE"
    [ -n "$ENT" ] || ENT="unknown"
    printf '{"entitlement":"%s","license_last4":"%s","device_bound":%s}\n' "$(json_escape "$ENT")" "$(json_escape "$LAST4")" "$BOUND" > "$STATE_FILE"
    chmod 600 "$STATE_FILE" 2>/dev/null || true
    printf '{"success":true,"entitlement":"%s"}\n' "$(json_escape "$ENT")"
}

auth_clear_account() {
    rm -f "$ACCOUNT_FILE" "$LEASE_FILE" 2>/dev/null
    printf '{"success":true}\n'
}

premium_state() {
    INSTALLED=$(premium_installed)
    VERSION=$(premium_version)
    SHA=$(sha256_file "$PREMIUM_BIN")
    SIZE=0
    [ -f "$PREMIUM_BIN" ] && SIZE=$(wc -c < "$PREMIUM_BIN" 2>/dev/null | tr -d ' \r\n')
    printf '{"success":true,"installed":%s,"path":"%s","version":"%s","sha256":"%s","size":%s}\n' \
        "$INSTALLED" "$(json_escape "$PREMIUM_BIN")" "$(json_escape "$VERSION")" "$(json_escape "$SHA")" "${SIZE:-0}"
}

download_premium() {
    PKG_ID="$1"; DL_TOKEN="$2"; OUT_ZIP="$3"; DL_URL="${4:-}"
    case "$PKG_ID" in ''|*[!0-9]*) err_json "付费组件 ID 无效"; return 1 ;; esac
    case "$DL_TOKEN" in ''|*[!A-Za-z0-9._~+/=-]*) err_json "下载令牌无效"; return 1 ;; esac
    case "$OUT_ZIP" in /data/local/tmp/*|/sdcard/*) ;; *) err_json "下载路径不受支持"; return 1 ;; esac
    [ -n "$CURL_BIN" ] || { err_json "缺少 curl"; return 1; }
    if [ -z "$DL_URL" ]; then
        DL_URL="$BASE_API/v1/touch/packages/$PKG_ID/download?token=$DL_TOKEN"
    fi
    case "$DL_URL" in https://*) ;; *) err_json "下载地址不受信任"; return 1 ;; esac
    mkdir -p "$(dirname "$OUT_ZIP")" 2>/dev/null || true
    "$CURL_BIN" --silent --show-error --location --connect-timeout 10 --max-time 300 --proto '=https' \
        -H "Authorization: Bearer $(json_str "$ACCOUNT_FILE" token)" \
        -o "$OUT_ZIP" "$DL_URL" 2>/dev/null
    [ "$?" -eq 0 ] && [ -f "$OUT_ZIP" ] && [ "$(wc -c < "$OUT_ZIP" 2>/dev/null | tr -d ' \n')" -gt 100 ] || {
        rm -f "$OUT_ZIP"; err_json "付费组件下载失败"; return 1; }
    SIZE=$(wc -c < "$OUT_ZIP" 2>/dev/null | tr -d ' \n')
    SHA=$(sha256_file "$OUT_ZIP")
    printf '{"success":true,"path":"%s","size":%s,"sha256":"%s"}\n' "$(json_escape "$OUT_ZIP")" "${SIZE:-0}" "$(json_escape "$SHA")"
}

install_premium() {
    ZIP_PATH="$1"
    case "$ZIP_PATH" in /data/local/tmp/*|/sdcard/*) ;; *) err_json "安装包路径不受支持"; return 1 ;; esac
    [ -f "$ZIP_PATH" ] || { err_json "安装包不存在"; return 1; }
    UNZIP=""
    [ -n "$BUSYBOX_BIN" ] && "$BUSYBOX_BIN" unzip -h >/dev/null 2>&1 && UNZIP="$BUSYBOX_BIN unzip"
    [ -z "$UNZIP" ] && command -v unzip >/dev/null 2>&1 && UNZIP="unzip"
    [ -n "$UNZIP" ] || { err_json "缺少 unzip（busybox）"; return 1; }
    TMP_DIR="/data/local/tmp/gt8pro_premium_$$"
    rm -rf "$TMP_DIR"; mkdir -p "$TMP_DIR" || { err_json "无法创建临时目录"; return 1; }
    $UNZIP -o "$ZIP_PATH" -d "$TMP_DIR" >/dev/null 2>&1 || { rm -rf "$TMP_DIR"; err_json "安装包解压失败"; return 1; }
    DAEMON_BIN=$(find "$TMP_DIR" -type f -name touch_rate_daemon 2>/dev/null | head -n 1)
    [ -n "$DAEMON_BIN" ] || { rm -rf "$TMP_DIR"; err_json "安装包内缺少 touch_rate_daemon"; return 1; }
    SHA=$(sha256_file "$DAEMON_BIN")
    mkdir -p "$MOD/bin" 2>/dev/null
    [ -f "$PREMIUM_BIN" ] && cp -f "$PREMIUM_BIN" "$PREMIUM_BIN.bak" 2>/dev/null || true
    cp -f "$DAEMON_BIN" "$PREMIUM_BIN.new" 2>/dev/null || { rm -rf "$TMP_DIR"; err_json "无法写入付费组件"; return 1; }
    chmod 755 "$PREMIUM_BIN.new" 2>/dev/null
    mv -f "$PREMIUM_BIN.new" "$PREMIUM_BIN" 2>/dev/null || { rm -rf "$TMP_DIR"; err_json "安装替换失败"; return 1; }
    VERSION=$(premium_version)
    rm -rf "$TMP_DIR"
    printf '{"success":true,"path":"%s","version":"%s","sha256":"%s"}\n' "$(json_escape "$PREMIUM_BIN")" "$(json_escape "$VERSION")" "$(json_escape "$SHA")"
}

ACTION="${1:-}"
case "$ACTION" in
    api_request) shift; api_request "$@" ;;
    auth_state) auth_state ;;
    auth_save_account) auth_save_account "${2:-}" ;;
    auth_save_lease) auth_save_lease "${2:-}" ;;
    auth_save_entitlement) auth_save_entitlement "${2:-}" ;;
    auth_clear_account) auth_clear_account ;;
    auth_device_info) device_json ;;
    premium_state) premium_state ;;
    download_premium) download_premium "${2:-}" "${3:-}" "${4:-}" "${5:-}" ;;
    install_premium) install_premium "${2:-}" ;;
    *)
        printf '{"success":false,"message":"未知动作：%s"}\n' "$(json_escape "$ACTION")"
        exit 1
        ;;
esac
