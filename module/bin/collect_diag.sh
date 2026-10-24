#!/system/bin/sh
# 慕容触控采样率 · 全量诊断信息收集脚本（一次性收集所有可能需要的资料）
# 用法（root 终端 / MT管理器 root / KSU 终端）：
#   su -c 'sh /路径/慕容触控全量诊断.sh'
# 结果：/sdcard/Download/murong_touch_full_diag_<时间>.tar.gz（自动回退其它目录）
# 环境变量：MOD_PATH 指定模块目录（默认 /data/adb/modules/gt8pro_touch）

MOD="${MOD_PATH:-/data/adb/modules/gt8pro_touch}"
DAEMON="$MOD/bin/touch_rate_daemon"
VERIFY="$MOD/bin/verify_lease_sig"
TS=$(date +%Y%m%d_%H%M%S)
NAME="murong_touch_full_diag_$TS"
TMP="/data/local/tmp/$NAME"
OUT=""
ARCHIVE=""

say() { printf '%s\n' "$*" >&2; }
sec() { mkdir -p "$TMP/$1" 2>/dev/null; }
run() { ( "$@" ) >/dev/null 2>&1; }
has() { command -v "$1" >/dev/null 2>&1; }

if [ ! -d "$MOD" ]; then
  say "__DIAG_FAIL__:module_not_found:$MOD"
  echo "__DIAG_FAIL__:module_not_found"
  exit 1
fi
mkdir -p "$TMP" 2>/dev/null || { say "__DIAG_FAIL__:tmp_not_writable"; echo "__DIAG_FAIL__:tmp_not_writable"; exit 1; }

# ============ 0. 基础信息 ============
{
  echo "===== 采集时间 ====="
  date '+%Y-%m-%d %H:%M:%S %z'
  echo
  echo "===== 设备 ====="
  echo "model=$(getprop ro.product.vendor.model 2>/dev/null)"
  echo "product=$(getprop ro.product.name 2>/dev/null)"
  echo "device=$(getprop ro.product.device 2>/dev/null)"
  echo "brand=$(getprop ro.product.brand 2>/dev/null)"
  echo "oplusrom=$(getprop ro.build.version.oplusrom 2>/dev/null)"
  echo "release=$(getprop ro.build.version.release 2>/dev/null)"
  echo "sdk=$(getprop ro.build.version.sdk 2>/dev/null)"
  echo "incremental=$(getprop ro.build.version.incremental 2>/dev/null)"
  echo "fingerprint=$(getprop ro.build.fingerprint 2>/dev/null)"
  echo "abi=$(getprop ro.product.cpu.abi 2>/dev/null)"
  echo "soc=$(getprop ro.board.platform 2>/dev/null)"
  echo "kernel=$(uname -r 2>/dev/null)"
  echo "uname=$(uname -a 2>/dev/null)"
  echo "selinux=$(getenforce 2>/dev/null)"
  echo "boot_id=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
  echo "uptime=$(uptime 2>/dev/null)"
  echo "uid=$(id 2>/dev/null)"
  echo "ksu_version=$(getprop ro.kernelsu.version 2>/dev/null)"
  echo "magisk_version=$(getprop ro.magisk.version 2>/dev/null)"
  echo "ksud=$(ksud -V 2>/dev/null || magisk -V 2>/dev/null)"
  echo
  echo "===== 模块 ====="
  echo "MOD=$MOD"
  ls -ld "$MOD" 2>/dev/null
  cat "$MOD/module.prop" 2>/dev/null
  echo
  echo "===== 进程 ====="
  ps -A 2>/dev/null | grep -E "touchDaemon|touch_rate_daemon|rate_daemon|murong" | head -20
  echo
  echo "===== 挂载/存储 ====="
  df -h /data /sdcard 2>/dev/null
  mount 2>/dev/null | grep -E "gt8pro_touch|murongchaopin" | head -20
} > "$TMP/basic.txt" 2>&1

# ============ 1. 模块完整性/权限/哈希 ============
sec module
ls -laR "$MOD/bin" > "$TMP/module/bin_ls.txt" 2>&1
ls -la "$MOD" "$MOD/config" "$MOD/config/auth" "$MOD/webroot" > "$TMP/module/root_ls.txt" 2>&1
{
  echo "=== 关键文件存在/权限 ==="
  for f in bin/touch_rate_daemon bin/verify_lease_sig bin/curl bin/rate_ctl bin/api.sh bin/collect_diag.sh \
           service.sh action.sh uninstall.sh common.sh module.prop config/采样率.txt config/rate.conf; do
    if [ -e "$MOD/$f" ]; then
      echo "$f: EXISTS $(ls -l "$MOD/$f" 2>/dev/null | awk '{print $1" "$3" "$4" "$5}') exec=$([ -x "$MOD/$f" ] && echo yes || echo no)"
    else
      echo "$f: MISSING"
    fi
  done
  echo
  echo "=== sha256 ==="
  for f in bin/touch_rate_daemon bin/verify_lease_sig bin/curl bin/rate_ctl bin/api.sh bin/collect_diag.sh service.sh action.sh uninstall.sh common.sh; do
    [ -f "$MOD/$f" ] && sha256sum "$MOD/$f" 2>/dev/null
  done
  echo
  echo "=== verify_lease_sig 试用（无参数，仅看能否执行/链接） ==="
  if [ -x "$VERIFY" ]; then
    timeout 5 "$VERIFY" > "$TMP/module/verify_lease_sig_run.txt" 2>&1
    echo "verify_rc=$?" >> "$TMP/module/verify_lease_sig_run.txt"
  else
    echo "not executable or missing" > "$TMP/module/verify_lease_sig_run.txt"
  fi
  cat "$TMP/module/verify_lease_sig_run.txt" 2>/dev/null
  echo
  echo "=== 动态依赖（如可读） ==="
  for f in bin/touch_rate_daemon bin/verify_lease_sig bin/curl; do
    [ -f "$MOD/$f" ] || continue
    if has toybox; then toybox readelf -d "$MOD/$f" 2>/dev/null | head -20; fi
  done
} > "$TMP/module/integrity.txt" 2>&1
cp -f "$MOD/module.prop" "$TMP/module/" 2>/dev/null
cp -f "$MOD/config/采样率.txt" "$TMP/module/" 2>/dev/null
cp -f "$MOD/config/rate.conf" "$TMP/module/" 2>/dev/null
cp -f "$MOD/config/legacy.conf" "$TMP/module/" 2>/dev/null
cp -f "$MOD/config/触显同步.txt" "$TMP/module/" 2>/dev/null
cp -f "$MOD/config/set_rate.sh" "$MOD/config/restore_rate.sh" "$TMP/module/" 2>/dev/null

# ============ 2. 授权/网络 ============
sec license
{
  echo "=== license-status ==="
  [ -x "$DAEMON" ] && "$DAEMON" --license-status "$MOD" 2>&1
  echo
  echo "=== auth_state（不含 token） ==="
  [ -f "$MOD/bin/api.sh" ] && sh "$MOD/bin/api.sh" auth_state 2>&1
  echo
  echo "=== auth 文件 ==="
  ls -la "$MOD/config/auth" 2>&1
  echo
  echo "=== lease.json ==="
  cat "$MOD/config/auth/lease.json" 2>/dev/null
  echo
  echo "=== state.json ==="
  cat "$MOD/config/auth/state.json" 2>/dev/null
  echo
  echo "=== device_identity.json ==="
  cat "$MOD/config/auth/device_identity.json" 2>/dev/null
  echo
  echo "=== account 脱敏 ==="
  sed -n 's/"token"[[:space:]]*:[[:space:]]*"[^"]*"/"token":"<redacted>"/gp' "$MOD/config/auth/account.json" 2>/dev/null
  echo
  echo "=== API 连通性（不带 token） ==="
  "$MOD/bin/curl" -sS -m 10 -o /dev/null -w "health_http=%{http_code}\n" "https://murongdiaodu.rl1.cc/api/healthz" 2>&1
} > "$TMP/license/license.txt" 2>&1

# ============ 3. daemon 状态/日志 ============
sec daemon
cp -f "$MOD/config/daemon.log" "$TMP/daemon/daemon.log" 2>/dev/null
cp -f "$MOD/config/daemon.log.1" "$TMP/daemon/daemon.log.1" 2>/dev/null
cp -f "$MOD/config/service.log" "$TMP/daemon/service.log" 2>/dev/null
[ -f "$MOD/daemon.log" ] && cp -f "$MOD/daemon.log" "$TMP/daemon/daemon_root.log" 2>/dev/null
{
  echo "=== daemon --json ==="
  [ -x "$DAEMON" ] && "$DAEMON" --json "$MOD" 2>&1
  echo
  echo "=== daemon --probe ==="
  [ -x "$DAEMON" ] && "$DAEMON" --probe "$MOD" 2>&1
  echo
  echo "=== daemon --sync-status ==="
  [ -x "$DAEMON" ] && "$DAEMON" --sync-status "$MOD" 2>&1
  echo
  echo "=== daemon --get-rate ==="
  [ -x "$DAEMON" ] && "$DAEMON" --get-rate 2>&1
  echo
  echo "=== pid/state ==="
  cat "$MOD/config/daemon.pid" 2>/dev/null; echo
  cat "$MOD/config/daemon.state" 2>/dev/null
} > "$TMP/daemon/daemon_status.txt" 2>&1

# ============ 4. 触控栈/节点 ============
sec touch
ls -la /dev/tcm_hbp* /dev/input 2>/dev/null > "$TMP/touch/dev_ls.txt"
ls -la /proc/touchpanel 2>/dev/null >> "$TMP/touch/dev_ls.txt"
timeout 10 sh -c 'find /proc/touchpanel -maxdepth 2 -type f 2>/dev/null' | while read -r f; do
  echo "===== $f ====="
  cat "$f" 2>/dev/null | head -120
done > "$TMP/touch/proc_touchpanel.txt" 2>&1
cat /proc/touchpanel/debug_info/main_register > "$TMP/touch/main_register.txt" 2>/dev/null
cat /proc/touchpanel/report_rate > "$TMP/touch/report_rate.txt" 2>/dev/null
cat /proc/touchpanel/rate_white_list > "$TMP/touch/rate_white_list.txt" 2>/dev/null
cat /sys/kernel/oplus_display/dump_info > "$TMP/touch/dump_info.txt" 2>/dev/null
ls -la /sys/kernel/oplus_display > "$TMP/touch/oplus_display_nodes.txt" 2>/dev/null
for n in adfr_config min_fps max_fps test_te dynamic_float_te panel_id esd_status power_status; do
  echo "== $n"; cat "/sys/kernel/oplus_display/$n" 2>/dev/null
done > "$TMP/touch/oplus_display_values.txt" 2>&1
{
  echo "=== touchDaemon ==="
  TD=$(pgrep -f "/odm/bin/touchDaemon" 2>/dev/null | head -1)
  echo "pid=$TD"
  [ -n "$TD" ] && ls -l "/proc/$TD/fd" 2>/dev/null | grep -E "tcm|hbp|touch" | head -20
  echo
  echo "=== 输入设备 ==="
  getevent -lp 2>/dev/null | head -120
} > "$TMP/touch/touchdaemon.txt" 2>&1
dmesg 2>/dev/null | tail -600 > "$TMP/touch/dmesg_tail.txt"
dmesg 2>/dev/null | grep -iE "synaptics|syna|tcm|hbp|touch|panel" | tail -400 > "$TMP/touch/dmesg_touch.txt"

# ============ 5. 显示模块（刷新率来源） ============
sec display
DM=/data/adb/modules/murongchaopin
if [ -d "$DM" ]; then
  cp -f "$DM/module.prop" "$TMP/display/" 2>/dev/null
  cp -f "$DM/config/mode.txt" "$TMP/display/mode.txt" 2>/dev/null
  cp -f "$DM/config/rmx5200_display_policy.txt" "$TMP/display/" 2>/dev/null
  cp -f "$DM/config/rmx5200_adfr_mode.txt" "$TMP/display/" 2>/dev/null
  cp -f "$DM/config/custom_refresh_rates.txt" "$TMP/display/" 2>/dev/null
  cp -f "$DM/daemon.log" "$TMP/display/daemon.log" 2>/dev/null
  tail -n 300 "$DM/daemon.log" > "$TMP/display/daemon_tail.txt" 2>/dev/null
else
  echo "display module not installed" > "$TMP/display/not_installed.txt"
fi

# ============ 6. 系统/刷新率/日志 ============
sec system
{
  echo "=== 刷新率设置 ==="
  for k in system/peak_refresh_rate system/min_refresh_rate system/user_refresh_rate system/default_refresh_rate secure/user_preferred_screen_index; do
    echo "$k=$(settings get $k 2>/dev/null)"
  done
  echo
  echo "=== SurfaceFlinger/display 关键行 ==="
  dumpsys SurfaceFlinger 2>/dev/null | grep -E "RefreshRateSelector|activeMode=|DisplayMode" | tail -40
  dumpsys display 2>/dev/null | grep -iE "mActiveModeId|renderFrameRate|DisplayDeviceInfo" | head -20
} > "$TMP/system/refresh.txt" 2>&1
getprop > "$TMP/system/all_props.txt" 2>/dev/null
{
  logcat -d -v threadtime -t 3000 2>/dev/null | grep -iE "touch|tcm|hbp|syna|murong|gt8pro|Touch" | tail -1500 > "$TMP/system/logcat_touch.txt"
logcat -d -v threadtime -t 3000 2>/dev/null > "$TMP/system/logcat_touch_full.txt"
} > "$TMP/system/logcat_touch.txt" 2>&1
logcat -d -b crash -t 300 2>/dev/null > "$TMP/system/logcat_crash.txt"
ls -la /data/adb/modules > "$TMP/system/modules_list.txt" 2>/dev/null

# ============ 7. 工具链 ============
sec tools
{
  echo "which zip=$(command -v zip 2>/dev/null)"
  echo "which tar=$(command -v tar 2>/dev/null)"
  echo "which unzip=$(command -v unzip 2>/dev/null)"
  echo "which sha256sum=$(command -v sha256sum 2>/dev/null)"
  for bb in /data/adb/ksu/bin/busybox /data/adb/magisk/busybox /system/bin/busybox; do
    if [ -x "$bb" ]; then
      echo "busybox=$bb"
      "$bb" --list 2>/dev/null | tr '\n' ' ' | grep -oE "zip|unzip|tar|sha256sum" | sort -u
    fi
  done
} > "$TMP/tools/tools.txt" 2>&1

# 清理过大的内容
rm -rf "$TMP/module/verify_lease_sig_run.txt" 2>/dev/null

# ============ 7.5 平台/触控控制通道发现（新机型适配用，限时执行） ============
sec platform
{
  echo "=== /proc/devices ==="; timeout 10 cat /proc/devices 2>/dev/null
  echo; echo "=== /proc/misc ==="; timeout 10 cat /proc/misc 2>/dev/null
  echo; echo "=== /dev ==="; timeout 10 ls -la /dev 2>/dev/null | head -250
  echo; echo "=== /dev name matches ==="; timeout 10 find /dev -maxdepth 2 \( -iname '*tcm*' -o -iname '*hbp*' -o -iname '*touch*' -o -iname '*syna*' \) 2>/dev/null | head -50
  echo; echo "=== binder services ==="; timeout 15 service list 2>/dev/null | grep -iE 'touch|hbp|syna|display' | head -60
  echo; echo "=== lshal ==="; timeout 15 lshal 2>/dev/null | grep -iE 'touch|hbp' | head -60
  echo; echo "=== fd -> touch devices ==="; timeout 20 sh -c 'ls -l /proc/[0-9]*/fd 2>/dev/null | grep -E "tcm|hbp|touch|syna"' | head -120
  echo; echo "=== sysfs candidates ==="; timeout 20 find /sys/class /sys/kernel /sys/module /sys/bus -maxdepth 4 \( -iname '*touch*' -o -iname '*hbp*' -o -iname '*syna*' -o -iname '*tcm*' \) 2>/dev/null | head -150
  echo; echo "=== debugfs candidates ==="; timeout 10 ls -la /sys/kernel/debug 2>/dev/null | head -30; timeout 10 find /sys/kernel/debug -maxdepth 3 \( -iname '*touch*' -o -iname '*hbp*' -o -iname '*syna*' \) 2>/dev/null | head -80
  echo; echo "=== kernel modules ==="; timeout 10 ls /sys/module 2>/dev/null | grep -iE 'touch|hbp|syna|tcm|tp_'
  echo; echo "=== kernel config touch ==="; if [ -r /proc/config.gz ]; then timeout 10 toybox zcat /proc/config.gz 2>/dev/null | grep -iE 'HBP|TOUCH|SYNA|TCM'; fi
  echo; echo "=== ps ==="; timeout 10 ps -A -o PID,PPID,USER,NAME,ARGS 2>/dev/null | head -250
  echo; echo "=== touch props ==="; timeout 10 getprop 2>/dev/null | grep -iE 'touch|hbp|tp_|syna'
  echo; echo "=== dmesg touch ==="; timeout 15 dmesg 2>/dev/null | grep -iE 'hbp|touch-krn|syna|tcm|touchpanel|goodix|novatek|focaltech' | tail -400
} > "$TMP/platform.txt" 2>&1

# ============ 8. 打包（逐级回退） ============


for D in /sdcard/Download /storage/emulated/0/Download /data/local/tmp "$MOD"; do
  [ -d "$D" ] || continue
  probe="$D/.murong_diag_write_test_$$"
  if ( : > "$probe" ) 2>/dev/null; then rm -f "$probe"; OUT="$D"; break; fi
done
[ -z "$OUT" ] && { say "__DIAG_FAIL__:no_writable_dir"; echo "__DIAG_FAIL__:no_writable_dir"; exit 1; }

BB=""
for cand in /data/adb/ksu/bin/busybox /data/adb/magisk/busybox /system/bin/busybox; do
  [ -x "$cand" ] && "$cand" tar --help >/dev/null 2>&1 && { BB="$cand"; break; }
done
if [ -n "$BB" ]; then
  ( cd "$TMP" && "$BB" tar -czf "$OUT/$NAME.tar.gz" . ) >/dev/null 2>&1
  [ -s "$OUT/$NAME.tar.gz" ] && ARCHIVE="$OUT/$NAME.tar.gz"
fi
if [ -z "$ARCHIVE" ]; then
  ( cd "$TMP" && tar -czf "$OUT/$NAME.tar.gz" . ) >/dev/null 2>&1
  [ -s "$OUT/$NAME.tar.gz" ] && ARCHIVE="$OUT/$NAME.tar.gz"
fi
if [ -z "$ARCHIVE" ] && has zip; then
  ( cd "$TMP" && zip -qr "$OUT/$NAME.zip" . ) >/dev/null 2>&1
  [ -s "$OUT/$NAME.zip" ] && ARCHIVE="$OUT/$NAME.zip"
fi
if [ -z "$ARCHIVE" ]; then
  cp -R "$TMP" "$OUT/$NAME" 2>/dev/null && ARCHIVE="$OUT/$NAME"
fi
rm -rf "$TMP" 2>/dev/null

if [ -n "$ARCHIVE" ] && { [ -d "$ARCHIVE" ] || [ -s "$ARCHIVE" ]; }; then
  SIZE=""; [ -f "$ARCHIVE" ] && SIZE=$(wc -c < "$ARCHIVE" 2>/dev/null | tr -d ' \n')
  say "__DIAG_OK__:$ARCHIVE ${SIZE:+size=$SIZE}"
  echo "__DIAG_OK__:$ARCHIVE"
  exit 0
fi
say "__DIAG_FAIL__:archive_failed"
echo "__DIAG_FAIL__:archive_failed"
exit 1
