#!/system/bin/sh
# =============================================================================
# gt8pro_touch v3.0 - 开机服务脚本（KernelSU / Magisk 通用）
#
# 流程：
#   1) 定位模块目录（Magisk 标准写法 MODDIR=${0%/*}，不依赖当前工作目录）
#   2) 等 sys.boot_completed=1（最多 60s）
#   3) 等 touchDaemon 就绪（触控栈已起来，hbp ioctl / proc 节点通路可用，最多再等 30s）
#   4) v3 一次性配置迁移：旧 config/包名.txt → 新 config/采样率.txt（全局 0 + 旧包名 360）
#   5) 按 common.sh 的统一清单设置 settings / setprop（带日志）
#   6) 幂等启动 C 守护进程 bin/touch_rate_daemon（setsid 后台，pid 写入 config/daemon.pid）
#
# v3.0 采样率机制：守护进程自动探测后端（hbp / proc_rate / white_list / legacy_hidl），
# 支持全局+每应用自定义采样率（config/采样率.txt，热更新），不再依赖 shell 轮询。
# config/ 下的 set_rate.sh / restore_rate.sh 只是手动调试封装，守护进程默认不 exec 它们。
#
# 注意：本脚本只 chmod bin/ 下的可执行文件与 config/ 下的两个采样率脚本，
#       不再 chmod -R 755 整个模块（旧版会改坏模块内文件的权限，且毫无必要）。
# =============================================================================

# Magisk/KernelSU 标准写法：$0 形如 /data/adb/modules/gt8pro_touch/service.sh，
# ${0%/*} 即模块目录；这样无论被谁、在哪个工作目录调用都能正确定位。
MODDIR=${0%/*}
# 兜底：极少数被手动 `sh service.sh` 调用且 $0 不带路径的情况
[ -d "$MODDIR" ] || MODDIR=/data/adb/modules/gt8pro_touch

LOG_FILE="$MODDIR/config/service.log"
DAEMON_LOG="$MODDIR/config/daemon.log"

mkdir -p "$MODDIR/config" 2>/dev/null

# 公共库：统一设置清单 + 守护进程控制
if [ ! -f "$MODDIR/common.sh" ]; then
    echo "gt8pro_touch: 缺少 $MODDIR/common.sh，service.sh 退出" >&2
    exit 1
fi
. "$MODDIR/common.sh"

log() {
    log_line "$LOG_FILE" "$*"
}

# 日志文件超过 128KB 时轮转一次（避免长期开机累积过大）
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 131072 ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null
fi

log "===== service.sh 启动（gt8pro_touch v3.0）====="

# 只给真正需要执行的二进制/脚本加可执行权限；不做 chmod -R 755
chmod 755 "$MODDIR/bin/touch_rate_daemon" "$MODDIR/bin/rate_ctl" 2>/dev/null
chmod 755 "$MODDIR/config/set_rate.sh" "$MODDIR/config/restore_rate.sh" 2>/dev/null

# ---------------------------------------------------------------------------
# v3 一次性配置迁移：旧版 config/包名.txt → 新版 config/采样率.txt
#   - 仅当新配置不存在且旧配置存在时执行；
#   - 生成内容：第一行全局 0，其余旧包名每行 “包名 360”；
#   - 迁移成功后旧文件改名为 包名.txt.migrated（保留备查，不参与守护进程读取）。
# ---------------------------------------------------------------------------
migrate_config() {
    local newcfg="$MODDIR/config/采样率.txt"
    local oldcfg="$MODDIR/config/包名.txt"
    local line pkg tmp

    if [ -f "$newcfg" ]; then
        log "配置文件已存在：$newcfg"
        return 0
    fi
    if [ ! -f "$oldcfg" ]; then
        log "[WARN] 缺少 $newcfg 且无旧版 $oldcfg，守护进程将使用内置默认配置"
        return 0
    fi

    log "检测到 v2 旧配置 $oldcfg，迁移为 $newcfg（全局 0 + 旧包名 360Hz）"
    tmp="$newcfg.tmp.$$"
    {
        printf '# 由 service.sh 从 v2 的 config/包名.txt 自动迁移生成（%s）\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf '# 格式：第一行有效行=全局采样率（0=不强制，恢复系统原值）；其余行=包名 采样率\n'
        printf '0\n\n'
        while IFS= read -r line || [ -n "$line" ]; do
            case "$line" in
                ''|'#'*) continue ;;
            esac
            line=${line%%#*}
            line=$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            case "$line" in
                '') continue ;;
            esac
            printf '%s 360\n' "$line"
        done < "$oldcfg"
    } > "$tmp" 2>/dev/null

    if [ -s "$tmp" ]; then
        if mv -f "$tmp" "$newcfg" 2>/dev/null && [ -f "$newcfg" ]; then
            log "配置迁移完成：$newcfg"
            mv -f "$oldcfg" "$oldcfg.migrated" 2>/dev/null && log "旧配置已重命名为 $oldcfg.migrated"
        else
            log "[WARN] 迁移写入失败，保留旧配置（守护进程仍会兼容读取 包名.txt）"
        fi
    else
        log "[WARN] 迁移生成内容为空，保留旧配置"
    fi
    rm -f "$tmp" 2>/dev/null
}

# 等 sys.boot_completed=1，最多 60 秒
wait_sys_boot_completed() {
    local i=0
    while [ "$(getprop sys.boot_completed 2>/dev/null)" != "1" ] && [ "$i" -lt 60 ]; do
        i=$((i + 1))
        sleep 1
    done
    if [ "$(getprop sys.boot_completed 2>/dev/null)" = "1" ]; then
        log "sys.boot_completed=1（等待 ${i}s）"
    else
        log "[WARN] 等待 sys.boot_completed 超时（60s），继续执行"
    fi
}

# 等 touchDaemon 就绪：hbp 后端依赖它打开的 /dev/tcm_hbp0；proc 后端依赖触控栈节点
wait_touch_daemon() {
    local i=0
    until pidof touchDaemon >/dev/null 2>&1 || [ "$i" -ge 30 ]; do
        i=$((i + 1))
        sleep 1
    done
    if pidof touchDaemon >/dev/null 2>&1; then
        log "touchDaemon 已就绪（等待 ${i}s）"
    else
        log "[WARN] touchDaemon 30s 内未就绪，继续启动（守护进程会继续探测后端并重试）"
    fi
}

wait_sys_boot_completed
wait_touch_daemon
migrate_config

# 模块更新后 KSU 可能重置模块目录：从持久备份恢复登录 token / 授权 / 用户配置
if [ -f "$MODDIR/bin/api.sh" ]; then
    chmod 755 "$MODDIR/bin/api.sh" 2>/dev/null
    sh "$MODDIR/bin/api.sh" state_restore >/dev/null 2>&1
fi

# 触控优化设置项：清单见 common.sh 的 SETTINGS_LIST / PROPS_LIST，
# action.sh / uninstall.sh 按同一清单还原，禁止在别处另写清单。
if tweaks_apply "$LOG_FILE"; then
    log "触控优化设置项已全部应用"
else
    log "[WARN] 部分触控优化设置项应用失败（详见上方 [FAIL] 行）"
fi

# 付费组件（守护进程）按需安装：免费模块 zip 不带 bin/touch_rate_daemon，
# 用户在 WebUI 购买授权并下载付费组件后才会出现。缺失时跳过启动，不算错误。
if [ ! -x "$MODDIR/bin/touch_rate_daemon" ]; then
    log "未安装付费组件（bin/touch_rate_daemon 缺失），跳过守护进程"
    log "请打开 WebUI → 用户 → 登录并下载付费组件后重启模块"
else
    # 授权/网络相关工具（随模块下发，允许缺失不影响旧版）
    chmod 755 "$MODDIR/bin/curl" "$MODDIR/bin/verify_lease_sig" "$MODDIR/bin/api.sh" "$MODDIR/bin/collect_diag.sh" "$MODDIR/bin/touchconfig.sh" "$MODDIR/bin/update_status.sh" "$MODDIR/bin/apply_touch_tuning.sh" 2>/dev/null || true
    # 幂等启动守护进程（内部会先停旧实例）
    if daemon_start "$MODDIR" "$LOG_FILE"; then
        log "守护进程日志：$DAEMON_LOG"
        log "提示：可用 WebUI 或 $MODDIR/bin/touch_rate_daemon --json $MODDIR 查看状态"
    else
        log "[WARN] 守护进程未启动，自动采样率功能暂不可用（其余设置项仍生效）"
    fi
fi

if [ -x "$MODDIR/bin/api.sh" ]; then
    (
        sleep 20
        AUTO_OUT=$(sh "$MODDIR/bin/api.sh" auto_install_premium 2>/dev/null)
        case "$AUTO_OUT" in
            *'"success":true'*|*'"error":"no_account"'*|*'"error":"locked"'*) ;;
            *) sleep 5; sh "$MODDIR/bin/api.sh" auto_install_premium >/dev/null 2>&1 ;;
        esac
    ) >/dev/null 2>&1 &
fi

# 触控手感优化（可选；配置文件不存在则不修改任何设置）
if [ -f "$MODDIR/bin/apply_touch_tuning.sh" ] && [ -f "${DATA_DIR:-/data/adb/murong_touch}/touch_tuning.conf" -o -f "$MODDIR/config/touch_tuning.conf" ]; then
    sh "$MODDIR/bin/apply_touch_tuning.sh" apply >/dev/null 2>&1 &
fi

# 动态模块描述/授权通知守护（每 10 秒更新 module.prop description）
if [ -x "$MODDIR/bin/update_status.sh" ] || [ -f "$MODDIR/bin/update_status.sh" ]; then
    chmod 755 "$MODDIR/bin/update_status.sh" 2>/dev/null
    if ! pgrep -f "update_status.sh watch" >/dev/null 2>&1; then
        ( sh "$MODDIR/bin/update_status.sh" watch ) >/dev/null 2>&1 &
    fi
fi

log "===== service.sh 结束 ====="
exit 0
