#!/system/bin/sh
# 慕容触控采样率 · 一键诊断信息收集脚本
# 用法（root 终端 / MT管理器 root 执行 / KSU 终端）：
#   su -c 'sh /路径/慕容触控诊断.sh'
# 结果默认保存到 /sdcard/Download/murong_touch_diag_<时间>.tar.gz（自动回退其它目录）
# 也可通过环境变量 MOD_PATH 指定模块目录（默认 /data/adb/modules/gt8pro_touch）

MOD="${MOD_PATH:-/data/adb/modules/gt8pro_touch}"
DAEMON="$MOD/bin/touch_rate_daemon"
TS=$(date +%Y%m%d_%H%M%S)
NAME="murong_touch_diag_$TS"
TMP="/data/local/tmp/$NAME"
OUT=""
ZIP=""

say() { printf '%s\n' "$*" >&2; }

if [ ! -d "$MOD" ]; then
  say "__DIAG_FAIL__:module_not_found:$MOD"
  echo "__DIAG_FAIL__:module_not_found"
  exit 1
fi

mkdir -p "$TMP" 2>/dev/null || { say "__DIAG_FAIL__:tmp_not_writable"; echo "__DIAG_FAIL__:tmp_not_writable"; exit 1; }

# ---------- 收集 ----------
tail -n 300 "$MOD/config/daemon.log" > "$TMP/daemon.log" 2>/dev/null
tail -n 300 "$MOD/config/service.log" > "$TMP/service.log" 2>/dev/null
tail -n 120 "$MOD/config/daemon.log.1" > "$TMP/daemon.log.1" 2>/dev/null
cp "$MOD/module.prop" "$TMP/module.prop" 2>/dev/null
cp "$MOD/config/采样率.txt" "$TMP/采样率.txt" 2>/dev/null
cp "$MOD/config/rate.conf" "$TMP/rate.conf" 2>/dev/null
cp "$MOD/config/legacy.conf" "$TMP/legacy.conf" 2>/dev/null
cp "$MOD/config/触显同步.txt" "$TMP/触显同步.txt" 2>/dev/null

[ -x "$DAEMON" ] && "$DAEMON" --json "$MOD" > "$TMP/status.json" 2>/dev/null
[ -x "$DAEMON" ] && "$DAEMON" --probe "$MOD" > "$TMP/probe.txt" 2>/dev/null
[ -x "$DAEMON" ] && "$DAEMON" --license-status "$MOD" > "$TMP/license_status.json" 2>/dev/null
[ -x "$DAEMON" ] && "$DAEMON" --sync-status "$MOD" > "$TMP/sync_status.json" 2>/dev/null
[ -x "$DAEMON" ] && "$DAEMON" --get-rate > "$TMP/current_rate.txt" 2>/dev/null
[ -x "$MOD/bin/api.sh" ] && sh "$MOD/bin/api.sh" auth_state > "$TMP/auth_state.json" 2>/dev/null
cp "$MOD/config/auth/state.json" "$TMP/auth_state_local.json" 2>/dev/null
cp "$MOD/config/auth/device_identity.json" "$TMP/device_identity.json" 2>/dev/null

cat /proc/touchpanel/debug_info/main_register > "$TMP/main_register.txt" 2>/dev/null
cat /proc/touchpanel/report_rate > "$TMP/report_rate.txt" 2>/dev/null
cat /sys/kernel/oplus_display/dump_info > "$TMP/dump_info.txt" 2>/dev/null

{
  echo "时间: $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "模块: $MOD"
  echo "模块版本: $(grep -m1 '^version=' "$MOD/module.prop" 2>/dev/null | cut -d= -f2)"
  echo "机型: $(getprop ro.product.vendor.model 2>/dev/null)"
  echo "产品: $(getprop ro.product.name 2>/dev/null)"
  echo "系统: $(getprop ro.build.version.oplusrom 2>/dev/null)"
  echo "SDK: $(getprop ro.build.version.sdk 2>/dev/null)"
  echo "内核: $(uname -r 2>/dev/null)"
  echo "uname: $(uname -a 2>/dev/null)"
  echo "boot_id: $(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
  echo "root: uid=$(id -u 2>/dev/null)"
  echo "KSU: $(getprop ro.kernelsu.version 2>/dev/null) / $(getprop ro.magisk.version 2>/dev/null)"
  echo "守护进程: $(pgrep -f 'gt8pro_touch/bin/touch_rate_daemon' 2>/dev/null | head -n 1)"
  echo "前台: $("$DAEMON" --once "$MOD" 2>/dev/null)"
} > "$TMP/device.txt" 2>/dev/null

# 显示增强模块日志/配置（存在则收集尾巴）
DM=/data/adb/modules/murongchaopin
if [ -d "$DM" ]; then
  mkdir -p "$TMP/display_module" 2>/dev/null
  cp "$DM/module.prop" "$TMP/display_module/module.prop" 2>/dev/null
  cp "$DM/config/mode.txt" "$TMP/display_module/mode.txt" 2>/dev/null
  tail -n 200 "$DM/daemon.log" > "$TMP/display_module/daemon.log" 2>/dev/null
fi

# ---------- 打包（逐级回退，不能依赖 busybox zip） ----------
for D in /sdcard/Download /storage/emulated/0/Download /data/local/tmp "$MOD"; do
  [ -d "$D" ] || continue
  probe="$D/.murong_diag_write_test_$$"
  if ( : > "$probe" ) 2>/dev/null; then
    rm -f "$probe" 2>/dev/null
    OUT="$D"
    break
  fi
done

if [ -z "$OUT" ]; then
  say "__DIAG_FAIL__:no_writable_dir"
  echo "__DIAG_FAIL__:no_writable_dir"
  exit 1
fi

BB=""
for cand in /data/adb/ksu/bin/busybox /data/adb/magisk/busybox /system/bin/busybox; do
  [ -x "$cand" ] && { "$cand" tar --help >/dev/null 2>&1 && BB="$cand"; } 2>/dev/null
  [ -n "$BB" ] && break
done

# 1) busybox tar.gz
if [ -n "$BB" ]; then
  ( cd "$TMP" && "$BB" tar -czf "$OUT/$NAME.tar.gz" . ) >/dev/null 2>&1
  [ -s "$OUT/$NAME.tar.gz" ] && ZIP="$OUT/$NAME.tar.gz"
fi
# 2) toybox/系统 tar.gz
if [ -z "$ZIP" ]; then
  ( cd "$TMP" && tar -czf "$OUT/$NAME.tar.gz" . ) >/dev/null 2>&1
  [ -s "$OUT/$NAME.tar.gz" ] && ZIP="$OUT/$NAME.tar.gz"
fi
# 3) 系统 zip（部分机型有）
if [ -z "$ZIP" ] && command -v zip >/dev/null 2>&1; then
  ( cd "$TMP" && zip -qr "$OUT/$NAME.zip" . ) >/dev/null 2>&1
  [ -s "$OUT/$NAME.zip" ] && ZIP="$OUT/$NAME.zip"
fi
# 4) 实在不行保留目录
if [ -z "$ZIP" ]; then
  FINAL="$OUT/$NAME"
  rm -rf "$FINAL" 2>/dev/null
  if cp -R "$TMP" "$FINAL" 2>/dev/null; then
    ZIP="$FINAL"
  fi
fi

rm -rf "$TMP" 2>/dev/null

if [ -n "$ZIP" ] && { [ -d "$ZIP" ] || [ -s "$ZIP" ]; }; then
  SIZE=""
  [ -f "$ZIP" ] && SIZE=$(wc -c < "$ZIP" 2>/dev/null | tr -d ' \n')
  say "__DIAG_OK__:$ZIP ${SIZE:+size=$SIZE}"
  echo "__DIAG_OK__:$ZIP"
  exit 0
fi

say "__DIAG_FAIL__:archive_failed"
echo "__DIAG_FAIL__:archive_failed"
exit 1
