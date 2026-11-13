#!/system/bin/sh
#
# cloud-rate.sh - 云控采样率注入 (肥鱼拼好控 v6.40)
#
# 与 touch-rate.sh(改触控芯片配置) 相互独立的第二种方案:
# 直接改写"应用增强服务"(com.oplus.cosa) 游戏数据库 db_game_database,
# 把 PackageConfigBean 表中各游戏包名的 refresh_rate 字段注入高采样率 JSON,
# 并为 package.conf 中无云控配置的游戏包名新建记录。
#
# 默认不主动注入, 仅在 WebUI 手动点击"注入采样率"时执行;
# 首次注入前自动备份原始数据库, "恢复默认"时还原备份并删除注入的包名。
#
# usage: cloud-rate.sh status|inject|restore

MODDIR=$(CDPATH= cd -- "${0%/*}/.." 2>/dev/null && pwd)
DB_PATH="/data/user/0/com.oplus.cosa/databases/db_game_database"
SQLITE3="$MODDIR/bin/sqlite3"
TOUCH_CONF="$MODDIR/config/cloud-touch.conf"
PACKAGE_CONF="$MODDIR/config/cloud-package.conf"
BACKUP_DIR="/data/adb/murong_touch/backup"
BACKUP_PATH="$BACKUP_DIR/db_game_database.bak"
EXCLUDED_PACKAGES="com.ss.android.ugc.aweme com.oplus.ether oplus.cosa.default.model.config"
LOG_FILE="$MODDIR/config/daemon.log"

# 统一字段值
FEATURE_FLAG="16777216"
CREATED_AT="2026-06-14 20:01:30"
MODIFIED_AT="2026-05-07 22:45:37"
OTHER="24831_false&"
FROM_SERVER="1"
COSA_VERSION="16.0.168"

log_msg() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') cloud-rate: $1" >> "$LOG_FILE"
    log -t Pinhaokon -p i "cloud-rate: $1"
}

# ZIP 打包可能丢失执行权限，运行时自动修复
chmod 755 "$SQLITE3" 2>/dev/null
chmod 755 "$0" 2>/dev/null

# 查询设备在配置表中的支持情况与对应 JSON
get_config() {
    DEVICE_MODEL=$(getprop ro.product.model)
    [ -f "$TOUCH_CONF" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] || [[ "$line" == \#* ]] && continue
        MODEL=$(echo "$line" | cut -d: -f1)
        CONFIG=$(echo "$line" | cut -d: -f2-)
        if [ "$MODEL" = "$DEVICE_MODEL" ]; then
            echo "$CONFIG"
            return 0
        fi
    done < "$TOUCH_CONF"
    return 1
}

# ========== status: 输出 key=value 状态供 WebUI 解析 ==========
status() {
    DEVICE_MODEL=$(getprop ro.product.model)
    CPU_MODEL=$(getprop ro.board.platform)
    echo "model=$DEVICE_MODEL"
    echo "platform=$CPU_MODEL"

    SUPPORTED="no"
    if [ -f "$TOUCH_CONF" ]; then
        while IFS= read -r line || [ -n "$line" ]; do
            [ -z "$line" ] || [[ "$line" == \#* ]] && continue
            MODEL=$(echo "$line" | cut -d: -f1)
            [ "$MODEL" = "$DEVICE_MODEL" ] && { SUPPORTED="yes"; break; }
        done < "$TOUCH_CONF"
    fi
    echo "supported=$SUPPORTED"

    [ -f "$DB_PATH" ] && echo "db=yes" || echo "db=no"
    [ -f "$BACKUP_PATH" ] && echo "backup=yes" || echo "backup=no"
    [ -x "$SQLITE3" ] && echo "sqlite=yes" || echo "sqlite=no"

    INJECTED=0
    if [ -f "$DB_PATH" ] && [ -x "$SQLITE3" ]; then
        INJECTED=$("$SQLITE3" "$DB_PATH" "SELECT COUNT(*) FROM PackageConfigBean WHERE refresh_rate IS NOT NULL AND refresh_rate != '';" 2>/dev/null)
        [ -z "$INJECTED" ] && INJECTED=0
    fi
    echo "injected=$INJECTED"
}

# ========== 备份原始数据库（仅首次注入前执行一次） ==========
backup_db() {
    [ -f "$BACKUP_PATH" ] && return 0
    mkdir -p "$BACKUP_DIR"
    "$SQLITE3" "$DB_PATH" ".backup '$BACKUP_PATH'" 2>/dev/null
    if [ -f "$BACKUP_PATH" ]; then
        log_msg "原始数据库已备份"
        return 0
    fi
    log_msg "数据库备份失败"
    return 1
}

# ========== inject: 备份 + 注入包名 + 写入采样率 ==========
inject() {
    DEVICE_MODEL=$(getprop ro.product.model)
    CPU_MODEL=$(getprop ro.board.platform)
    NEW_CONFIG=$(get_config)
    if [ -z "$NEW_CONFIG" ]; then
        log_msg "设备 $DEVICE_MODEL 无配置"
        echo "error: 设备 $DEVICE_MODEL 无采样率配置"
        exit 1
    fi
    if [ ! -x "$SQLITE3" ]; then
        echo "error: sqlite3 不存在"
        exit 1
    fi
    if [ ! -f "$DB_PATH" ]; then
        log_msg "数据库不存在: $DB_PATH"
        echo "error: 应用增强服务数据库不存在"
        exit 1
    fi

    if ! backup_db; then
        echo "error: 备份失败，已中止注入"
        exit 1
    fi

    # 1. 处理器检测与包名注入
    if [ "$CPU_MODEL" = "sun" ] && [ -f "$PACKAGE_CONF" ]; then
        while IFS= read -r package_name || [ -n "$package_name" ]; do
            [ -z "$package_name" ] || [[ "$package_name" == \#* ]] && continue
            package_name=$(echo "$package_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            [ -z "$package_name" ] && continue
            existing=$("$SQLITE3" "$DB_PATH" "SELECT COUNT(*) FROM PackageConfigBean WHERE package_name = '$package_name';")
            if [ "$existing" -eq 0 ]; then
                "$SQLITE3" "$DB_PATH" "INSERT INTO PackageConfigBean (package_name, feature_flag, created_at, modified_at, other, from_server, cosa_version) VALUES ('$package_name', '$FEATURE_FLAG', '$CREATED_AT', '$MODIFIED_AT', '$OTHER', '$FROM_SERVER', '$COSA_VERSION');" 2>/dev/null
                log_msg "注入包名: $package_name"
            fi
        done < "$PACKAGE_CONF"
    fi

    # 2. 写入采样率配置
    PACKAGES=$("$SQLITE3" "$DB_PATH" "SELECT DISTINCT package_name FROM PackageConfigBean;" 2>/dev/null)
    [ -z "$PACKAGES" ] && { echo "error: 无法获取包名列表"; exit 1; }

    SUCCESS_COUNT=0
    for PACKAGE in $PACKAGES; do
        for EXCLUDE_PKG in $EXCLUDED_PACKAGES; do
            [ "$PACKAGE" = "$EXCLUDE_PKG" ] && continue 2
        done
        ESCAPED_CONFIG=$(echo "$NEW_CONFIG" | sed "s/'/''/g")
        if "$SQLITE3" "$DB_PATH" "UPDATE PackageConfigBean SET refresh_rate = '$ESCAPED_CONFIG' WHERE package_name = '$PACKAGE';" 2>/dev/null; then
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        fi
    done

    log_msg "注入完成: 设备=$DEVICE_MODEL 平台=$CPU_MODEL 修改=$SUCCESS_COUNT 个包名"
    echo "ok:$SUCCESS_COUNT"
}

# ========== restore: 停止服务 + 删除注入包名 + 还原备份 ==========
restore() {
    CPU_MODEL=$(getprop ro.board.platform)
    if [ ! -f "$DB_PATH" ]; then
        echo "ok: 数据库不存在，无需恢复"
        exit 0
    fi

    # 停止应用增强服务
    am force-stop com.oplus.cosa 2>/dev/null
    sleep 2

    # 1. 删除模块注入的包名
    if [ "$CPU_MODEL" = "sun" ] && [ -f "$PACKAGE_CONF" ]; then
        while IFS= read -r package_name || [ -n "$package_name" ]; do
            [ -z "$package_name" ] || [[ "$package_name" == \#* ]] && continue
            package_name=$(echo "$package_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            [ -z "$package_name" ] && continue
            "$SQLITE3" "$DB_PATH" "DELETE FROM PackageConfigBean WHERE package_name = '$package_name';" 2>/dev/null
        done < "$PACKAGE_CONF"
    fi

    # 2. 还原原始数据库（若有备份）
    if [ -f "$BACKUP_PATH" ]; then
        DB_OWNER=$(ls -ln "$DB_PATH" 2>/dev/null | awk '{print $3":"$4}')
        rm -f "$DB_PATH-wal" "$DB_PATH-shm"
        if cp -f "$BACKUP_PATH" "$DB_PATH" 2>/dev/null; then
            [ -n "$DB_OWNER" ] && chown "$DB_OWNER" "$DB_PATH" 2>/dev/null
            chmod 660 "$DB_PATH" 2>/dev/null
            restorecon "$DB_PATH" 2>/dev/null
            log_msg "已从备份还原数据库"
        else
            log_msg "备份还原失败，清除应用增强服务数据"
            pm clear com.oplus.cosa 2>/dev/null
        fi
    else
        log_msg "无备份，清除应用增强服务数据"
        pm clear com.oplus.cosa 2>/dev/null
    fi

    echo "ok"
}

case "$1" in
    status) status ;;
    inject) inject ;;
    restore) restore ;;
    *)
        echo "usage: cloud-rate.sh status|inject|restore"
        exit 1
        ;;
esac