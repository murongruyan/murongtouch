#!/system/bin/sh
# =============================================================================
# set_rate.sh —— 手动把触控采样率切到 360Hz（调试 / 测试用，v3.0）
#
# 真实机制：C 守护进程 bin/touch_rate_daemon 自动探测后端（hbp / proc_rate /
#          white_list / legacy_hidl）后下发采样率；本脚本只是守护进程 CLI 的薄封装，
#          不做任何 HIDL / HbpCtrlClient 调用。
#
# 注意：
#   - 守护进程运行期间请勿手动调用（会与守护进程的状态机/看门狗抢状态）；
#     本脚本供手动调试、临时测试、以及排查后端通路时使用。
#   - 日常使用请改 config/采样率.txt（全局+每应用），不要依赖本脚本。
#   - 守护进程平时走内置后端，不会 exec 本脚本（见 config/rate.conf 的 use_script=0）。
#   - 采样率实测映射（RMX5200）：1=360Hz(≈365) 2=120Hz(≈125，默认) 3=240Hz(≈243，游戏档)
#     4=180Hz(≈182) 5=288Hz(≈290) 9≈400Hz；8/10/12/13/15 也是 385~400Hz 隐藏档；
#     0x10 及以上会让触控停止报点，禁止写。daemon 的 --set-rate 会按
#     360→1、120→2、240→3、180→4、288→5、400→9 换算。
#
# 用法：
#   sh config/set_rate.sh [模块目录]
#   模块目录优先取参数 $1，其次环境变量 MODDIR，最后从本脚本路径推导。
# =============================================================================

case "$0" in
    */*) SELF_DIR=${0%/*} ;;
    *)   SELF_DIR=$(pwd) ;;
esac
MODDIR=${1:-${MODDIR:-$(cd "$SELF_DIR/.." 2>/dev/null && pwd)}}
[ -d "$MODDIR" ] || MODDIR=/data/adb/modules/gt8pro_touch

BIN="$MODDIR/bin/touch_rate_daemon"
TARGET_HZ=360

if [ ! -x "$BIN" ]; then
    echo "set_rate.sh: 错误：找不到可执行守护进程 $BIN（守护进程二进制未安装）" >&2
    exit 1
fi

echo "set_rate.sh: 下发 --set-rate ${TARGET_HZ}（v3 守护进程自动探测后端）..."
if ! "$BIN" --set-rate "$TARGET_HZ" "$MODDIR"; then
    echo "set_rate.sh: 错误：--set-rate ${TARGET_HZ} 执行失败" >&2
    exit 1
fi

echo "set_rate.sh: 完成，当前采样率：$("$BIN" --get-rate "$MODDIR" 2>/dev/null)"
exit 0
