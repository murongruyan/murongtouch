#!/system/bin/sh
# =============================================================================
# restore_rate.sh —— 手动把触控采样率恢复到默认 120Hz（调试 / 卸载兜底用，v3.0）
#
# 真实机制：C 守护进程 bin/touch_rate_daemon 自动探测后端（hbp / proc_rate /
#          white_list / legacy_hidl）后下发采样率；本脚本只是守护进程 CLI 的薄封装，
#          不做任何 HIDL / HbpCtrlClient 调用。
#
# 重要区别（不要混淆）：
#   - 守护进程正常退出（SIGTERM/SIGINT）时，自动恢复的是「它启动时从后端节点动态捕获的
#     原值」（本机通常 120Hz / code 2），不是固定值，也不经过本脚本；
#   - 本脚本固定恢复 120Hz 默认档（code 2），只作为 action.sh 卸载/WebUI「恢复默认」的
#     兜底 / 手动调试工具；注意 240Hz 是官方游戏档（code 3），不是默认值；
#   - 本脚本写死默认值 120 并做「非空 + 纯数字 + >0」严格校验，
#     不存在旧版「读取失败回退写 0」的路径：校验不过直接拒绝执行，绝不下发 0；
#   - 守护进程平时走内置后端，不会 exec 本脚本（见 config/rate.conf 的 use_script=0）。
#
# 用法：
#   sh config/restore_rate.sh [模块目录]
#   模块目录优先取参数 $1，其次环境变量 MODDIR，最后从本脚本路径推导。
# =============================================================================

case "$0" in
    */*) SELF_DIR=${0%/*} ;;
    *)   SELF_DIR=$(pwd) ;;
esac
MODDIR=${1:-${MODDIR:-$(cd "$SELF_DIR/.." 2>/dev/null && pwd)}}
[ -d "$MODDIR" ] || MODDIR=/data/adb/modules/gt8pro_touch

BIN="$MODDIR/bin/touch_rate_daemon"
# 120Hz 默认档 = DC_SET_REPORT_FRE code 2（本机 main_register 默认 code，
# 与守护进程启动时动态捕获的值一致；240Hz 是官方游戏档 code 3，不是默认值）
DEFAULT_HZ=120

# ---------- 默认值严格校验：非空、纯数字、>0，否则拒绝下发（绝不写 0） ----------
case "$DEFAULT_HZ" in
    '')
        echo "restore_rate.sh: 错误：默认值为空，拒绝下发。历史 bug：读取失败回退 0 会写坏触控参数。" >&2
        exit 1
        ;;
    *[!0-9]*)
        echo "restore_rate.sh: 错误：默认值 '$DEFAULT_HZ' 不是纯数字，拒绝下发。" >&2
        exit 1
        ;;
esac
if [ "$DEFAULT_HZ" -le 0 ]; then
    echo "restore_rate.sh: 错误：默认值 '$DEFAULT_HZ' <= 0，拒绝下发（禁止把默认值恢复成 0）。" >&2
    exit 1
fi

if [ ! -x "$BIN" ]; then
    echo "restore_rate.sh: 错误：找不到可执行守护进程 $BIN（守护进程二进制未安装）" >&2
    exit 1
fi

echo "restore_rate.sh: 下发 --set-rate ${DEFAULT_HZ}（v3 守护进程自动探测后端，默认档 120Hz）..."
if ! "$BIN" --set-rate "$DEFAULT_HZ" "$MODDIR"; then
    echo "restore_rate.sh: 错误：--set-rate ${DEFAULT_HZ} 执行失败" >&2
    exit 1
fi

echo "restore_rate.sh: 完成，当前采样率：$("$BIN" --get-rate "$MODDIR" 2>/dev/null)"
exit 0
