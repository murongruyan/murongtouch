/* ============================================================
 * 慕容触控采样率 v5.18 · KernelSU WebUI
 * 四页：主页 / 配置 / 日志 / 用户；MIUIX + 调度式液态玻璃底栏。
 * UI 主参考 murongdiaodu-apk（慕容调度）；日志“一键收集+分享”、配置平铺参考显示模块。
 * 纯静态、离线、无 CDN；命令全部经 ksu.exec 执行；浏览器预览自动 Mock。
 * ============================================================ */
'use strict';

/* ============================================================
 * 1. 常量
 * ============================================================ */
var MOD = '/data/adb/modules/gt8pro_touch';
var WEBUI_VERSION = '5.18.0';
var CONFIG_PATH = MOD + '/config/采样率.txt';
var DAEMON_PID_PATH = MOD + '/config/daemon.pid';
var DAEMON_LOG_PATH = MOD + '/config/daemon.log';
var SERVICE_LOG_PATH = MOD + '/config/service.log';
var RATE_CONF_PATH = MOD + '/config/rate.conf';
var SYNC_CONF_PATH = MOD + '/config/触显同步.txt';
var SYNC_RECHECK_DELAYS = [1200, 2500, 4000];
var SYNC_SETTLE_TIMEOUT = 6000;
var SYNC_STATUS_REFRESH_MS = 7000;
var LICENSE_PATH = MOD + '/config/license.txt';
var CONFIG_APPLY_DEBOUNCE = 200;
var API_BASE = 'https://murongdiaodu.rl1.cc/api';
var API_SCRIPT = MOD + '/bin/api.sh';
var API_TIMEOUT = 45000;
var PAID_PRODUCT_CODE = 'touch_sampling';
var PAID_REFRESH_MS = 30 * 60 * 1000;
var PAID_LEASE_RENEW_SECONDS = 24 * 3600;
var PAID_DOWNLOAD_ZIP = '/data/local/tmp/gt8pro_touch_premium.zip';
var PAYMENT_ASSET_URL = API_BASE + '/payment_asset';
var PAYMENT_ALIPAY_QRCODE = 'https://qr.alipay.com/fkx19856muvtznqt6onipea';
var PAYMENT_WECHAT_RECEIVER = 'wxp://f2f0Uk7YdwjnrBPrQ85ytbNuR1L4y1GRJz2wzm7cNgl2onU';
var WECHAT_USER_STORAGE_KEY = 'gt8pro_wechat_user_v1';
var MODULE_PROP_PATH = MOD + '/module.prop';
var DAEMON_BIN = MOD + '/bin/touch_rate_daemon';
var RATE_CTL_BIN = MOD + '/bin/rate_ctl';
var DIAG_DIR = '/sdcard/Download';

var ANY_HZ = [120, 180, 240, 288, 360, 400];
var HZ_TO_CODE = { 120: 2, 180: 4, 240: 3, 288: 5, 360: 1, 400: 9 };
var CODE_TO_HZ = { 1: 360, 2: 120, 3: 240, 4: 180, 5: 288, 9: 400 };
var BACKEND_META = { hbp: { label: 'HBP' }, proc_rate: { label: 'proc 节点' }, white_list: { label: '白名单' }, legacy: { label: 'legacy HIDL' } };
var FOREGROUND_SOURCE_LABEL = {
    binder: 'Binder ActivityManager',
    'dumpsys-top': 'dumpsys top-resumed-activity',
    'dumpsys-window': 'dumpsys window',
    'dumpsys-activities': 'dumpsys activities',
    cpuset: 'cpuset 启发式',
    none: '未获取到',
    unknown: '未知来源'
};

var THEME_ORDER = ['auto', 'light', 'dark'];
var ACCENT_PRESETS = ['#F663A6', '#3482FF', '#00C853', '#FF9500', '#AF52DE', '#FF3B30', '#1C1C1E', '#34C759'];
var APPEARANCE_KEY = 'gt8_probe_appearance_v1';
var LEGACY_THEME_KEY = 'gt8pro_theme';
var DEFAULT_APPEARANCE = {
    themeMode: 'auto',
    backgroundMode: 'color',
    backgroundColor: '#FFFFFFFF',
    accent: '#F663A6',
    textColor: ''
};

/* 运行期状态 */
var APP = {
    isMock: false,
    tab: 'home',
    state: null,
    statusLoading: false,
    lastStatusAt: 0,
    config: { global: 0, rules: [] },
    configDirty: false,
    configLoading: false,
    configLoaded: false,
    apps: [],
    appLabels: {},
    appsLoading: false,
    appsLoaded: false,
    appFilter: '',
    selectedApp: null,
    logLoading: false,
    diagPath: '',
    license: { deviceId: '', activated: false, plan: '', detail: '', activatedAt: '', supported: true },
    licenseLoading: false,
    moduleVersion: 'v5.18.0',
    appearance: null,
    theme: 'auto',
    paid: {
        auth: {},
        device: {},
        premium: {},
        entitlement: null,
        licenses: [],
        orders: [],
        packages: [],
        order: null,
        polling: false,
        pollTimer: null,
        loading: false,
        lastRefresh: 0,
        overlayBusy: false,
        orderTimer: null
    },
    bar: { index: 0 },
    modalResolver: null,
    initialized: false
};

/* ============================================================
 * 2. 通用工具
 * ============================================================ */
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function $(id) { return document.getElementById(id); }
function setText(id, text) { var node = $(id); if (node) node.textContent = text == null ? '' : String(text); }
function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function timeLine() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function toNumber(value, fallback) {
    var n = typeof value === 'number' ? value : parseInt(value, 10);
    return isFinite(n) ? n : (fallback || 0);
}
function toBool(value) { return value === true || value === 1 || value === '1' || value === 'true' || value === 'yes'; }
function str(value) { return value == null ? '' : String(value); }
function isPromiseLike(value) { return value && typeof value.then === 'function'; }

/* ============================================================
 * 3. UTF-8 ↔ base64 / 配置文本
 * ============================================================ */
function utf8ToBase64(text) {
    var value = String(text == null ? '' : text);
    try {
        return btoa(unescape(encodeURIComponent(value)));
    } catch (e1) {
        try {
            var bytes = new TextEncoder().encode(value);
            var binary = '';
            for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        } catch (e2) { return ''; }
    }
}

function base64ToUtf8(b64) {
    var value = String(b64 || '');
    try {
        var binary = atob(value);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e1) {
        try { return decodeURIComponent(escape(atob(value))); } catch (e2) { return ''; }
    }
}

function configTextEquals(a, b) {
    var normalize = function (t) {        return String(t == null ? '' : t).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/g, '');
    };
    return normalize(a) === normalize(b);
}

function stripLineComment(line) { var idx = line.indexOf('#'); return idx >= 0 ? line.slice(0, idx) : line; }

function parseConfigText(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var global = 0;
    var rules = [];
    var seenGlobal = false;
    for (var i = 0; i < lines.length; i++) {
        var content = stripLineComment(lines[i]).trim();
        if (!content) continue;
        var parts = content.split(/\s+/);
        if (!seenGlobal) {
            seenGlobal = true;
            global = /^\d+$/.test(parts[0]) ? parseInt(parts[0], 10) : 0;
            continue;
        }
        if (parts.length >= 2) rules.push({ pkg: parts[0], rate: parts[1] });
    }
    return { global: global, rules: rules };
}

function buildConfigText(global, rules) {
    var lines = [
        '# 慕容触控采样率 v5.10 config/采样率.txt',
        '# 第一行：全局采样率（0 = 不强制，恢复系统原值）；可选 120/180/240/288/360/400',
        '# 其余行：包名 采样率(Hz)；高级写法 c1~c15 表示后端 code（c16 及以上禁止）',
        String(global),
        ''
    ];
    (rules || []).forEach(function (rule) {
        var pkg = str(rule.pkg).trim();
        var rate = str(rule.rate).trim();
        if (pkg && rate) lines.push(pkg + ' ' + rate);
    });
    return lines.join('\n').replace(/\n+$/, '') + '\n';
}

function isValidPackage(pkg) {
    var value = str(pkg).trim();
    if (!value || /\s/.test(value)) return false;
    return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(value);
}

function validateRateValue(raw, options) {
    options = options || {};
    var allowZero = options.allowZero !== false;
    var allowAdvanced = options.allowAdvanced === true;
    var value = str(raw).trim();
    if (/^\d+$/.test(value)) {
        var hz = parseInt(value, 10);
        if (hz === 0) return allowZero ? { ok: true, kind: 'zero', hz: 0 } : { ok: false, error: '0 仅用于全局采样率' };
        if (ANY_HZ.indexOf(hz) >= 0) return { ok: true, kind: 'hz', hz: hz };
        return { ok: false, error: '不支持的采样率 ' + value + ' Hz（可选 120/180/240/288/360/400）' };
    }
    if (allowAdvanced) {
        var match = value.match(/^c(\d+)$/i);
        if (match) {
            var code = parseInt(match[1], 10);
            if (code < 1) return { ok: false, error: 'c0 不是合法后端 code' };
            if (code >= 16) return { ok: false, error: '后端 code ≥ 16 会导致触控停止报点，禁止保存' };
            return { ok: true, kind: 'code', code: code };
        }
    }
    return { ok: false, error: '无法识别的采样率：' + (value || '(空)') };
}

function validateConfig(config) {
    var errors = [];
    var model = config || { global: 0, rules: [] };
    var globalCheck = validateRateValue(model.global, { allowZero: true, allowAdvanced: false });
    if (!globalCheck.ok) errors.push({ field: 'global', message: '全局采样率不合法：' + globalCheck.error });
    var seen = {};
    (model.rules || []).forEach(function (rule, index) {
        var pkg = str(rule.pkg).trim();
        var rateCheck = validateRateValue(rule.rate, { allowZero: true, allowAdvanced: true });
        if (!isValidPackage(pkg)) {
            errors.push({ field: 'rule', index: index, message: '第 ' + (index + 1) + ' 行包名不合法' });
        } else if (seen[pkg]) {
            errors.push({ field: 'rule', index: index, message: '包名重复：' + pkg });
        } else { seen[pkg] = true; }
        if (!rateCheck.ok) errors.push({ field: 'rate', index: index, message: '第 ' + (index + 1) + ' 行采样率不合法：' + rateCheck.error });
    });
    return errors;
}

function rateToHz(value) {
    var v = str(value).trim();
    if (/^\d+$/.test(v)) {
        var n = parseInt(v, 10);
        if (n === 0) return 0;
        if (ANY_HZ.indexOf(n) >= 0) return n;
        if (n >= 1 && n <= 15) return CODE_TO_HZ[n] || 0;
        return 0;
    }
    var match = v.match(/^c(\d+)$/i);
    if (match) return CODE_TO_HZ[parseInt(match[1], 10)] || 0;
    return 0;
}

function parseRateText(text) {
    var value = str(text);
    var codeMatch = value.match(/(?:DC\s+0x[Ee]6\s*=\s*|0x[Ee]6\s*=\s*|code\s*=\s*)(\d+)/i);
    if (codeMatch) {
        var hz = CODE_TO_HZ[parseInt(codeMatch[1], 10)];
        if (hz) return hz;
    }
    var hzMatch = value.match(/(\d{2,4})\s*(?:Hz|HZ|hz)/);
    if (hzMatch) {
        var n = parseInt(hzMatch[1], 10);
        if (ANY_HZ.indexOf(n) >= 0) return n;
    }
    return 0;
}

/* ============================================================
 * 4. 命令定义（功能契约保留；新增 license / 应用列表 / 诊断收集）
 * ============================================================ */
var CMD = {
    status: function () { return '"' + DAEMON_BIN + '" --json "' + MOD + '"'; },
    probe: function () { return '"' + DAEMON_BIN + '" --probe "' + MOD + '"'; },
    readConfig: function () { return 'cat "' + CONFIG_PATH + '"'; },
    writeConfig: function (b64) { return "echo '" + b64 + "' | base64 -d > \"" + CONFIG_PATH + '" && echo __WRITE_OK__'; },
    readSyncConfig: function () { return "cat '" + SYNC_CONF_PATH + "' 2>/dev/null"; },
    displayModuleInstalled: function () { return '[ -d /data/adb/modules/murongchaopin ] && echo __DISPLAY_INSTALLED__ || echo __DISPLAY_MISSING__'; },
    writeSyncConfig: function (b64) { return "echo '" + b64 + "' | base64 -d > '" + SYNC_CONF_PATH + "' && echo __WRITE_OK__"; },
    writeConfigFallback: function (b64) { return "printf '%s' '" + b64 + "' | base64 -d > \"" + CONFIG_PATH + '" && echo __WRITE_OK__'; },
    reload: function () {
        return 'pid=$(cat "' + DAEMON_PID_PATH + '" 2>/dev/null); ' +
            'if [ -n "$pid" ] && kill -HUP "$pid" 2>/dev/null; then echo __HUP_OK__; else echo __HUP_FAIL__; fi';
    },
    restart: function () {
        return 'kill $(cat "' + DAEMON_PID_PATH + '") 2>/dev/null; sleep 1; ' +
            'setsid "' + DAEMON_BIN + '" "' + MOD + '" >/dev/null 2>&1 & echo __RESTARTED__';
    },
    tail: function () { return 'tail -n 200 "' + DAEMON_LOG_PATH + '" 2>/dev/null; true'; },
    clearLog: function () { return ': > "' + DAEMON_LOG_PATH + '" && echo __CLEARED__'; },
    setRate: function (hz) { return '"' + DAEMON_BIN + '" --set-rate ' + hz + ' "' + MOD + '" 2>&1 && echo __RATE_OK__ || echo __RATE_FAIL__'; },
    getRate: function () { return '"' + RATE_CTL_BIN + '" get 2>&1 || "' + DAEMON_BIN + '" --get-rate "' + MOD + '" 2>&1'; },
    measure: function () { return '"' + RATE_CTL_BIN + '" measure 3 2>&1'; },
    measureRate: function (sec) { return '"' + DAEMON_BIN + '" --measure-rate ' + sec + ' "' + MOD + '" 2>/dev/null'; },
    uninstall: function () { return 'touch "' + MOD + '/remove" && echo __REMOVE_OK__'; },
    deviceInfo: function () {
        return 'MODEL=$(getprop ro.product.vendor.model 2>/dev/null); PLATFORM=$(getprop ro.board.platform 2>/dev/null); ' +
            'SDK=$(getprop ro.build.version.sdk 2>/dev/null); ROM=$(getprop ro.build.version.oplusrom 2>/dev/null); ' +
            'PID=$(cat "' + DAEMON_PID_PATH + '" 2>/dev/null); ' +
            'if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then PID=$(pgrep -f "gt8pro_touch/bin/touch_rate_daemon" 2>/dev/null | head -n 1); fi; ' +
            'CUR=$("' + RATE_CTL_BIN + '" get 2>/dev/null | head -n 1); ' +
            'echo "MODEL=$MODEL"; echo "PLATFORM=$PLATFORM"; echo "SDK=$SDK"; echo "ROM=$ROM"; echo "PID=$PID"; echo "CURRENT=$CUR"';
    },
    listPackages: function () { return 'pm list packages -3 2>/dev/null | sed "s/^package://" | sort'; },
    /* v4.1：应用名改由 KSU 桥 ksu.getPackagesInfo() 一次性获取；
       不再逐项 fork 应用查询（串行 exec 桥会卡死配置页）。 */
    deviceId: function () { return '"' + DAEMON_BIN + '" --device-id "' + MOD + '" 2>/dev/null'; },
    licenseStatus: function () { return '"' + DAEMON_BIN + '" --license-status "' + MOD + '" 2>/dev/null'; },
    licenseVerify: function (code) { return '"' + DAEMON_BIN + '" --license-verify "' + code + '" "' + MOD + '" 2>/dev/null'; },
    readLicense: function () { return 'cat "' + LICENSE_PATH + '" 2>/dev/null'; },
    writeLicense: function (b64) { return "echo '" + b64 + "' | base64 -d > \"" + LICENSE_PATH + '" && echo __WRITE_OK__'; },
    moduleProp: function () { return 'cat "' + MODULE_PROP_PATH + '" 2>/dev/null'; },
    updateCheck: function (url) { return '"' + MOD + '/bin/curl" -fsSL --connect-timeout 4 --max-time 8 "' + String(url || '') + '" 2>/dev/null || printf "__UPDATE_FAIL__"'; },
    /* v5 付费 API 桥（module/bin/api.sh） */
    apiRequest: function (method, path, auth, payloadB64, nonce, form) {
        return 'sh "' + API_SCRIPT + '" api_request ' + method + ' "' + path + '" ' +
            (auth ? 1 : 0) + ' "' + (payloadB64 || '') + '" "' + (nonce || '') + '" ' + (form ? 1 : 0);
    },
    paidAuthState: function () { return 'sh "' + API_SCRIPT + '" auth_state'; },
    paidDeviceInfo: function () { return 'sh "' + API_SCRIPT + '" auth_device_info'; },
    paidSaveAccount: function (b64) { return 'sh "' + API_SCRIPT + '" auth_save_account "' + b64 + '"'; },
    paidClearAccount: function () { return 'sh "' + API_SCRIPT + '" auth_clear_account'; },
    paidSaveLease: function (b64) { return 'sh "' + API_SCRIPT + '" auth_save_lease "' + b64 + '"'; },
    paidSaveEntitlement: function (b64) { return 'sh "' + API_SCRIPT + '" auth_save_entitlement "' + b64 + '"'; },
    paidPremiumState: function () { return 'sh "' + API_SCRIPT + '" premium_state'; },
    paidDownloadPremium: function (pkgId, token, outZip, downloadUrl) {
        return 'sh "' + API_SCRIPT + '" download_premium ' + pkgId + ' "' + token + '" "' + outZip + '" "' + (downloadUrl || '') + '"';
    },
    paidInstallPremium: function (zipPath) { return 'sh "' + API_SCRIPT + '" install_premium "' + zipPath + '"'; },
    collectDiag: function () {
        var MOD_PATH = MOD;
        var script = 'sh "' + MOD_PATH + '/bin/collect_diag.sh"';
        var fallback = 'MOD="' + MOD_PATH + '"; D="' + DIAG_DIR + '"; TS=$(date +%Y%m%d_%H%M%S); NAME="gt8pro_touch_diag_$TS"; TMP="/data/local/tmp/$NAME"; ' +
            'mkdir -p "$TMP" 2>/dev/null; ' +
            'tail -n 200 "$MOD/config/daemon.log" > "$TMP/daemon.log" 2>/dev/null; ' +
            'tail -n 200 "$MOD/config/service.log" > "$TMP/service.log" 2>/dev/null; ' +
            '"' + DAEMON_BIN + '" --json "$MOD" > "$TMP/status.json" 2>/dev/null; ' +
            '"' + DAEMON_BIN + '" --probe "$MOD" > "$TMP/probe.txt" 2>/dev/null; ' +
            'cat /proc/touchpanel/debug_info/main_register > "$TMP/main_register.txt" 2>/dev/null; ' +
            'echo "model=$(getprop ro.product.vendor.model)" > "$TMP/device.txt"; ' +
            'echo "rom=$(getprop ro.build.version.oplusrom)" >> "$TMP/device.txt"; ' +
            'echo "sdk=$(getprop ro.build.version.sdk)" >> "$TMP/device.txt"; ' +
            'uname -a >> "$TMP/device.txt" 2>/dev/null; ' +
            'cat "$MOD/module.prop" >> "$TMP/device.txt" 2>/dev/null; ' +
            'cp "$MOD/config/采样率.txt" "$TMP/采样率.txt" 2>/dev/null; cp "' + RATE_CONF_PATH + '" "$TMP/rate.conf" 2>/dev/null; ' +
            'BB=/data/adb/ksu/bin/busybox; [ -x "$BB" ] || BB=$(command -v busybox 2>/dev/null); ZIP=""; ' +
            'if [ -n "$BB" ] && [ -x "$BB" ]; then (cd "$TMP" && "$BB" zip -r "$D/$NAME.zip" . >/dev/null 2>&1); [ -s "$D/$NAME.zip" ] && ZIP="$D/$NAME.zip"; fi; ' +
            'if [ -z "$ZIP" ]; then (cd "$TMP" && tar -czf "$D/$NAME.tar.gz" . >/dev/null 2>&1); [ -s "$D/$NAME.tar.gz" ] && ZIP="$D/$NAME.tar.gz"; fi; ' +
            'rm -rf "$TMP"; if [ -n "$ZIP" ]; then SIZE=$(wc -c < "$ZIP" 2>/dev/null | tr -d " \n"); echo "__DIAG_OK__:$ZIP size=$SIZE"; else echo "__DIAG_FAIL__:archive_failed"; fi';
        return 'if [ -f "' + MOD_PATH + '/bin/collect_diag.sh" ]; then ' + script + '; else ' + fallback + '; fi';
    },
    shareDiag: function (path) {
        return 'am start -a android.intent.action.SEND -t application/zip --eu android.intent.extra.STREAM "file://' + path + '" >/dev/null 2>&1 && echo __SHARE_OK__ || echo __SHARE_FAIL__';
    },
    openUrl: function (url) { return 'am start -a android.intent.action.VIEW -d "' + url + '" >/dev/null 2>&1 && echo __OPEN_OK__ || echo __OPEN_FAIL__'; },
    /* WebUI 内支付：root 直接拉起微信/支付宝（不经过浏览器） */
    payWechat: function (userId) {
        var uid = parseInt(userId, 10);
        if (!isFinite(uid) || uid < 0) uid = 0;
        return "am start -W --user " + uid + " -n com.tencent.mm/com.tencent.mm.plugin.remittance.ui.RemittanceAdapterUI " +
            "--es 'receiver_name' '" + PAYMENT_WECHAT_RECEIVER + "' --ei 'scene' '1' --ei 'pay_channel' '24' " +
            ">/dev/null 2>&1 && echo __OPEN_OK__ || echo __OPEN_FAIL__";
    },
    listUsers: function () { return 'pm list users 2>/dev/null'; },
    checkWechatUser: function (userId) {
        var uid = parseInt(userId, 10);
        if (!isFinite(uid) || uid < 0) uid = 0;
        return "pm list packages --user " + uid + " com.tencent.mm 2>/dev/null | grep -q '^package:com.tencent.mm$' && echo __INSTALLED__ || echo __MISSING__";
    },
    payAlipay: function () {
        return 'am start -a android.intent.action.VIEW -d "alipayqr://platformapi/startapp?saId=10000007&clientVersion=3.7.0.0718&qrcode=' +
            encodeURIComponent(PAYMENT_ALIPAY_QRCODE) + '" >/dev/null 2>&1 && echo __OPEN_OK__ || echo __OPEN_FAIL__';
    },
};

/* ============================================================
 * 5. KSU 桥
 * ============================================================ */
function ksuExec(cmd, quiet, timeoutMs) {
    if (typeof ksu === 'undefined') return Promise.resolve('');
    quiet = quiet === true;
    timeoutMs = timeoutMs || 30000;
    return new Promise(function (resolve) {
        var settled = false;
        var cbName = '';
        var timer = null;
        var finish = function (value) {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (cbName) { try { delete window[cbName]; } catch (e) { window[cbName] = undefined; } }
            resolve(value);
        };
        cbName = 'cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        window[cbName] = function (code, stdout, stderr) {
            if (code !== 0) return finish(stdout ? String(stdout).trim() : ('Error: ' + (stderr || '')));
            finish(stdout ? String(stdout).trim() : '');
        };
        timer = setTimeout(function () { finish('Error: Command timed out'); }, timeoutMs);
        try {
            var r = ksu.exec(cmd, '{}', cbName);
            if (isPromiseLike(r)) {
                r.then(function (res) {
                    var out = typeof res === 'string' ? res : (res && res.stdout ? res.stdout : '');
                    finish((out || '').trim());
                }).catch(function () { finish(''); });
            }
        } catch (e) { finish(''); }
    });
}

function isMockMode() { return typeof ksu === 'undefined' || !ksu || typeof ksu.exec !== 'function'; }
function runCommand(cmd, options) {
    options = options || {};
    if (isMockMode()) return mockExec(cmd, options);
    return ksuExec(cmd, options.quiet === true, options.timeout || 30000);
}
function hasSentinel(out, sentinel) { return typeof out === 'string' && out.indexOf(sentinel) >= 0; }
function stripSentinels(text) {
    return String(text == null ? '' : text).split(/\r?\n/)
        .filter(function (line) { return !/^__[A-Z_]+__/.test(line.trim()); })
        .join('\n').trim();
}
function parseJsonLoose(text) {
    var raw = String(text == null ? '' : text);
    var start = raw.indexOf('{');
    var end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        var obj = JSON.parse(raw.slice(start, end + 1));
        return obj && typeof obj === 'object' ? obj : null;
    } catch (e) { return null; }
}

/* ============================================================
 * 6. Mock 模式
 * ============================================================ */
var MOCK_INITIAL_CONFIG = [
    '# 慕容触控采样率 v5.10 采样率配置（浏览器预览 Mock）',
    '# 第一行：全局采样率，0 = 不强制',
    '0',
    '# 包名 采样率(Hz)',
    'com.tencent.tmgp.sgame 360',
    'com.miHoYo.Yuanshen 360',
    'com.miHoYo.hkrpg 360',
    'com.tencent.tmgp.pubgmhd 288',
    'com.x1y9.probe 400'
].join('\n') + '\n';

var MOCK_INITIAL_LOGS = [
    '10-23 08:31:02 [INFO] ===== 慕容触控采样率 v5.18.0 守护进程启动 =====',
    '10-23 08:31:02 [INFO] 模块目录: ' + MOD,
    '10-23 08:31:02 [INFO] 机型: RMX5200 (arm64-v8a) / Android 37 / ROM V17.0.0',
    '10-23 08:31:02 [INFO] 加载配置: ' + CONFIG_PATH + '（全局 0，规则 5 条）',
    '10-23 08:31:02 [INFO] 后端探测: hbp=可用 proc_rate=不可用 white_list=不可用 legacy=不可用 → 使用 hbp',
    '10-23 08:31:02 [INFO] 原始采样率: 120 Hz (DC 0xE6 = 2)',
    '10-23 08:31:03 [INFO] 前台: com.tencent.tmgp.sgame（来源 binder）',
    '10-23 08:31:03 [INFO] 命中规则: com.tencent.tmgp.sgame → 360 Hz（code 1）'
];

var MOCK = {
    configText: MOCK_INITIAL_CONFIG,
    logs: MOCK_INITIAL_LOGS.slice(),
    pid: 4812,
    removed: false,
    originalHz: 120,
    foreground: 'com.tencent.tmgp.sgame',
    licenseText: '',
    license: { activated: false, plan: '', activatedAt: '', code: '' },
    deviceId: 'A1B2-C3D4-E5F6-G7H8',
    measureHz: 359.8,
    manualHz: 0,
    syncEnabled: false,
    syncRefreshHz: 60,
    syncTargetHz: 120,
    syncPkg: 'com.tencent.tmgp.sgame',
    displayModuleInstalled: true,
    apps: [
        { pkg: 'com.tencent.tmgp.sgame', label: '王者荣耀' },
        { pkg: 'com.miHoYo.Yuanshen', label: '原神' },
        { pkg: 'com.miHoYo.hkrpg', label: '崩坏：星穹铁道' },
        { pkg: 'com.tencent.tmgp.pubgmhd', label: '和平精英' },
        { pkg: 'com.tencent.tmgp.cod', label: '使命召唤手游' },
        { pkg: 'com.tencent.lolm', label: '英雄联盟手游' },
        { pkg: 'com.tencent.tmgp.dfm', label: '三角洲行动' },
        { pkg: 'com.tencent.tmgp.cf', label: '穿越火线：枪战王者' },
        { pkg: 'com.netease.l22', label: '永劫无间手游' },
        { pkg: 'com.netease.yyslscn', label: '逆水寒手游' },
        { pkg: 'com.x1y9.probe', label: 'Probe 测试应用' },
        { pkg: 'com.tencent.mm', label: '微信' }
    ]
};

function mockRules() { return parseConfigText(MOCK.configText); }
function mockTargetHz() {
    var cfg = mockRules();
    var rule = null;
    for (var i = 0; i < cfg.rules.length; i++) {
        if (cfg.rules[i].pkg === MOCK.foreground) { rule = cfg.rules[i]; break; }
    }
    var ruleRate = rule ? rateToHz(rule.rate) : 0;
    var target = ruleRate > 0 ? ruleRate : (cfg.global > 0 ? cfg.global : 0);
    return { global: cfg.global, rules: cfg.rules, matched: ruleRate > 0, ruleRate: ruleRate, target: target };
}
function mockState() {
    var m = mockTargetHz();
    var current = MOCK.manualHz > 0 ? MOCK.manualHz : (m.target > 0 ? m.target : MOCK.originalHz);
    return {
        version: '5.18.0', model: 'RMX5200', platform: 'arm64-v8a', sdk: 37, oplusrom: 'V17.0.0',
        daemon_running: !MOCK.removed, pid: MOCK.removed ? 0 : MOCK.pid,
        foreground: MOCK.foreground, foreground_source: 'binder',
        matched: m.matched, rule_rate: m.ruleRate, global_rate: m.global, target_hz: m.target, current_hz: current,
        backend: MOCK.removed ? '' : 'hbp', backend_ok: !MOCK.removed, original_hz: MOCK.originalHz, rules: m.rules.length,
        config_path: CONFIG_PATH, daemon_log: DAEMON_LOG_PATH, licensed: !!MOCK.license.activated,
        sync_enabled: !!MOCK.syncEnabled, refresh_hz: MOCK.syncRefreshHz,
        sync_target_hz: MOCK.syncEnabled ? MOCK.syncTargetHz : 0,
        sync_source: MOCK.syncEnabled ? 'display_log' : 'fallback',
        sync_package: MOCK.syncEnabled ? MOCK.syncPkg : '',
        last_write_target_hz: MOCK.syncEnabled ? MOCK.syncTargetHz : 0,
        last_write_ok: !!MOCK.syncEnabled,
        display_module_installed: !!MOCK.displayModuleInstalled,
        probe: MOCK.removed
            ? { hbp: false, proc_rate: false, white_list: false, legacy_hidl: false, touchDaemon_pid: 0, detail: '模块已标记卸载' }
            : { hbp: true, proc_rate: false, white_list: false, legacy_hidl: false, touchDaemon_pid: 7255, detail: 'hbp: 已复制 touchDaemon fd，main_register code=1(360Hz)' }
    };
}
function mockDelay(cmd) {
    var c = String(cmd || '');
    if (c.indexOf('--json') >= 0) return 140;
    if (c.indexOf('--probe') >= 0) return 520;
    if (c.indexOf('gt8pro_touch_diag_') >= 0) return 900;
    if (c.indexOf('pm list packages') >= 0) return 320;
    if (c.indexOf('nonLocalizedLabel') >= 0) return 700;
    if (c.indexOf('--device-id') >= 0 || c.indexOf('license') >= 0) return 260;
    if (c.indexOf('--measure-rate') >= 0 || (c.indexOf('rate_ctl') >= 0 && c.indexOf('measure') >= 0)) return 800;
    if (c.indexOf('setsid') >= 0) return 700;
    if (c.indexOf('base64 -d') >= 0) return 240;
    if (c.indexOf('tail -n 200') >= 0) return 200;
    if (c.indexOf('--set-rate') >= 0) return 300;
    return 150;
}
function mockExec(cmd) {
    var c = String(cmd == null ? '' : cmd);
    if (c.indexOf('api.sh') >= 0) return mockPaidExec(c);
    return sleep(mockDelay(c)).then(function () {
        /* 分享 / 打开链接（分享路径里也含 gt8pro_touch_diag_，需先匹配） */
        if (c.indexOf('changelog.md') >= 0) {
            if (c.indexOf('cdn.jsdelivr.net') >= 0) return '__UPDATE_FAIL__';
            return '# 更新日志\n\n## v5.10.1 (5101) - 2026-10-23\n\n1. feat: 检查更新先弹窗显示版本与更新内容\n2. fix(webui): 更新源改为 raw → ghproxy → jsdelivr\n3. fix(download): 付费组件改 POST 下载并校验 SHA-256';
        }
        if (c.indexOf('update.json') >= 0) {
            if (c.indexOf('cdn.jsdelivr.net') >= 0) return '__UPDATE_FAIL__';
            if (c.indexOf('ghproxy.net') >= 0) return '__UPDATE_FAIL__';
            return JSON.stringify({ version: '5.10.1', tag_name: 'v5.10.1', html_url: 'https://github.com/murongruyan/murongtouch/releases/tag/v5.10.1', changelog: '触控采样率 v5.10.1\n· 更新检查改为先弹窗\n· 修复源缓存导致版本滞后', date: '2026-10-23' });
        }
        if (c.indexOf('pm list users') >= 0) return 'Users:\n\tUserInfo{0:机主:13} running\n\tUserInfo{999:MultiApp:13} running\n';
        if (c.indexOf('pm list packages --user') >= 0 && c.indexOf('com.tencent.mm') >= 0) {
            var mockUserMatch = c.match(/--user\s+(\d+)/);
            var mockUid = mockUserMatch ? parseInt(mockUserMatch[1], 10) : 0;
            var mockInstalled = mockUid === 0 || mockUid === 999;
            if (c.indexOf('__INSTALLED__') >= 0) return mockInstalled ? '__INSTALLED__' : '__MISSING__';
            return mockInstalled ? 'package:com.tencent.mm' : '';
        }
        if (c.indexOf('RemittanceAdapterUI') >= 0) return '__OPEN_OK__';
        if (c.indexOf('android.intent.action.SEND') >= 0) return '__SHARE_OK__';
        if (c.indexOf('android.intent.action.VIEW') >= 0) return '__OPEN_OK__';
        /* 诊断收集命令里也包含 --json/--probe，必须最先匹配 */
        if (c.indexOf('gt8pro_touch_diag_') >= 0) return '__DIAG_OK__:/sdcard/Download/murong_touch_diag_20261023_232844.tar.gz size=13403';
        /* 降级设备信息（daemon 不支持 --json 时；内部含 rate_ctl get，需先匹配） */
        if (c.indexOf('getprop ro.product.vendor.model') >= 0) {
            return ['MODEL=RMX5200', 'PLATFORM=arm64-v8a', 'SDK=37', 'ROM=V17.0.0', 'PID=' + (MOCK.removed ? '' : MOCK.pid), 'CURRENT=DC 0xE6 = 1'].join('\n');
        }
        if (c.indexOf('--json') >= 0) return JSON.stringify(mockState());
        if (c.indexOf('--probe') >= 0) {
            return ['touch_rate_daemon v5.18.0 后端探测报告',
                'model: RMX5200  sdk: 37  oplusrom: V17.0.0  platform: arm64-v8a',
                'hbp:         YES  touchDaemon pid=7255 fd=6 复制成功',
                'proc_rate:   NO   节点不存在', 'white_list:  NO   节点不存在',
                'legacy_hidl: NO   未检测到 /odm/bin/touchHidlTest',
                'selected_backend: hbp (ok=yes)', 'current_hz: 360'].join('\n');
        }
        if (c.indexOf('--device-id') >= 0) return MOCK.deviceId;
        if (c.indexOf('--license-status') >= 0) {
            return JSON.stringify({ valid: !!MOCK.license.activated, activated: !!MOCK.license.activated, plan: MOCK.license.plan || '', device_id: MOCK.deviceId, reason: MOCK.license.activated ? '' : '未激活', activated_at: MOCK.license.activatedAt || '' });
        }
        if (c.indexOf('--license-verify') >= 0) {
            var codeMatch = c.match(/--license-verify "([^"]*)"/) || c.match(/--license-verify (\S+)/);
            var code = codeMatch ? codeMatch[1] : '';
            var valid = code.replace(/-/g, '').length >= 8;
            if (valid) {
                MOCK.license = { activated: true, plan: 'pro', activatedAt: new Date().toISOString(), code: code };
                return JSON.stringify({ valid: true, reason: '', plan: 'pro', device_id: MOCK.deviceId });
            }
            return JSON.stringify({ valid: false, reason: '激活码格式错误（Mock 至少 8 位）', plan: '', device_id: MOCK.deviceId });
        }
        if (c.indexOf('--measure-rate') >= 0) return JSON.stringify({ ok: true, hz: MOCK.measureHz, events: 1083, seconds: 3.01, backend: 'hbp' });
        if (c.indexOf('nonLocalizedLabel') >= 0) return MOCK.apps.map(function (app) { return app.pkg + '|' + app.label; }).join('\n');
        if (c.indexOf('pm list packages') >= 0) return MOCK.apps.map(function (app) { return app.pkg; }).join('\n');
        if (c.indexOf('module.prop') >= 0 && c.indexOf('cat ') >= 0) return 'id=gt8pro_touch\nname=慕容触控采样率\nversion=v5.10.0\nversionCode=600\nauthor=murong';
        if (c.indexOf('android.intent.action.SEND') >= 0) return '__SHARE_OK__';
        if (c.indexOf('android.intent.action.VIEW') >= 0) return '__OPEN_OK__';
        if (c.indexOf('license.txt') >= 0 && c.indexOf('base64 -d') >= 0) {
            var lm = c.match(/'([A-Za-z0-9+/=]+)'/);
            if (lm) MOCK.licenseText = base64ToUtf8(lm[1]);
            return '__WRITE_OK__';
        }
        if (c.indexOf('license.txt') >= 0 && c.indexOf('cat ') >= 0) return MOCK.licenseText;
        if (c.indexOf('murongchaopin') >= 0) return MOCK.displayModuleInstalled ? '__DISPLAY_INSTALLED__' : '__DISPLAY_MISSING__';
        if (c.indexOf('触显同步.txt') >= 0 && c.indexOf('cat ') >= 0) return MOCK.syncEnabled ? '1' : '0';
        if (c.indexOf('触显同步.txt') >= 0 && c.indexOf('base64 -d') >= 0) {
            var syncMatch = c.match(/'([A-Za-z0-9_\-=]+)'/);
            var syncValue = '';
            try { syncValue = syncMatch ? b64urlDecode(syncMatch[1]) : ''; } catch (e) { syncValue = ''; }
            MOCK.syncEnabled = String(syncValue).trim() === '1';
            MOCK.logs.push('10-23 08:36:00 [INFO] 触显同步 -> ' + (MOCK.syncEnabled ? '开启' : '关闭'));
            return '__WRITE_OK__';
        }
        if (c.indexOf('base64 -d') >= 0 && c.indexOf('采样率.txt') >= 0) {
            var match = c.match(/'([A-Za-z0-9+/=]+)'/);
            if (!match) return 'Error: 无法解析 base64';
            var text = base64ToUtf8(match[1]);
            if (!text) return 'Error: base64 解码失败';
            MOCK.configText = text;
            MOCK.logs.push('10-23 08:35:00 [INFO] 配置写入成功，请求热重载');
            return '__WRITE_OK__';
        }
        if (c.indexOf('cat ') >= 0 && c.indexOf('采样率.txt') >= 0) return MOCK.configText;
        if (c.indexOf('kill -HUP') >= 0) { MOCK.manualHz = 0; MOCK.logs.push('10-23 08:35:01 [INFO] 收到 SIGHUP，重新加载采样率配置'); return '__HUP_OK__'; }
        if (c.indexOf('setsid') >= 0) { MOCK.pid += 37; MOCK.manualHz = 0; MOCK.logs.push('10-23 08:35:02 [INFO] 守护进程已重启'); return '__RESTARTED__'; }
        if (c.indexOf('tail -n 200') >= 0) return MOCK.logs.slice(-200).join('\n');
        if (c.indexOf(': >') >= 0 && c.indexOf('daemon.log') >= 0) { MOCK.logs = []; return '__CLEARED__'; }
        if (c.indexOf('--set-rate') >= 0) {
            var hzMatch = c.match(/--set-rate\s+(\d+)/);
            var hz = hzMatch ? parseInt(hzMatch[1], 10) : 0;
            MOCK.manualHz = hz;
            return '已设置 DC 0xE6 = ' + (HZ_TO_CODE[hz] || 0) + '（' + hz + ' Hz）\n__RATE_OK__';
        }
        if (c.indexOf('rate_ctl') >= 0 && c.indexOf(' get') >= 0) {
            var currentHz = mockState().current_hz;
            return 'DC 0xE6 = ' + (HZ_TO_CODE[currentHz] || 0) + '（' + currentHz + ' Hz）';
        }
        if (c.indexOf('rate_ctl') >= 0 && c.indexOf('measure') >= 0) return '事件采样: 1083 个 SYN_REPORT 事件 / 3.01 秒\n实测报点率: ' + MOCK.measureHz + ' Hz';
        if (c.indexOf('/remove') >= 0) { MOCK.removed = true; return '__REMOVE_OK__'; }
        if (c.indexOf('getprop') >= 0) {
            return ['MODEL=RMX5200', 'PLATFORM=arm64-v8a', 'SDK=37', 'ROM=V17.0.0', 'PID=' + (MOCK.removed ? '' : MOCK.pid), 'CURRENT=DC 0xE6 = 1'].join('\n');
        }
        return '';
    });
}

/* ============================================================
 * 7. 状态 / 应用列表 / 授权解析
 * ============================================================ */
function normalizeProbe(probe) {
    var p = probe && typeof probe === 'object' ? probe : {};
    return {
        hbp: toBool(p.hbp), proc_rate: toBool(p.proc_rate), white_list: toBool(p.white_list), legacy_hidl: toBool(p.legacy_hidl),
        touchDaemon_pid: toNumber(p.touchDaemon_pid, 0), detail: str(p.detail)
    };
}

function normalizeState(raw) {
    var s = raw || {};
    var backend = str(s.backend).trim().toLowerCase();
    if (backend === 'none' || backend === 'null') backend = '';
    return {
        version: str(s.version) || '?', model: str(s.model), platform: str(s.platform), sdk: toNumber(s.sdk, 0), oplusrom: str(s.oplusrom),
        daemon_running: toBool(s.daemon_running), pid: toNumber(s.pid, 0),
        foreground: str(s.foreground), foreground_source: str(s.foreground_source),
        matched: toBool(s.matched), rule_rate: toNumber(s.rule_rate, 0), global_rate: toNumber(s.global_rate, 0),
        target_hz: toNumber(s.target_hz, 0), current_hz: toNumber(s.current_hz, 0),
        backend: backend, backend_ok: toBool(s.backend_ok), original_hz: toNumber(s.original_hz, 0), rules: toNumber(s.rules, 0),
        licensed: toBool(s.licensed), probe: normalizeProbe(s.probe),
        sync_supported: s.sync_enabled !== undefined || s.refresh_hz !== undefined || s.sync_target_hz !== undefined,
        sync_enabled: toBool(s.sync_enabled), refresh_hz: toNumber(s.refresh_hz, 0),
        sync_target_hz: toNumber(s.sync_target_hz, 0), sync_source: str(s.sync_source),
        sync_package: str(s.sync_package || s.sync_pkg || s.sync_app),
        last_write_target_hz: toNumber(s.last_write_target_hz, 0), last_write_ok: toBool(s.last_write_ok),
        display_module_installed: toBool(s.display_module_installed),
        degraded: !!s.degraded, unavailable: !!s.unavailable
    };
}

function fallbackState(text) {
    var values = {};
    String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
        var idx = line.indexOf('=');
        if (idx > 0) values[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    var pid = parseInt(values.PID, 10);
    if (!isFinite(pid)) pid = 0;
    return normalizeState({
        version: '?', model: values.MODEL, platform: values.PLATFORM, sdk: values.SDK, oplusrom: values.ROM,
        daemon_running: pid > 0, pid: pid, current_hz: parseRateText(values.CURRENT), backend: '', backend_ok: false,
        degraded: true, unavailable: !(values.MODEL || values.PID || values.CURRENT)
    });
}

function backendLabel(backend) {
    if (!backend) return '无';
    return (BACKEND_META[backend] && BACKEND_META[backend].label) || backend;
}

function foregroundSourceLabel(source) {
    if (!source) return '未知来源';
    return FOREGROUND_SOURCE_LABEL[source] || source;
}

function parsePackagesOutput(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
        .map(function (line) { return line.replace(/^package:/, '').trim(); })
        .filter(function (pkg) { return isValidPackage(pkg); });
}

function parseAppLabelsOutput(text) {
    var labels = {};
    String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
        var idx = line.indexOf('|');
        if (idx <= 0) return;
        var pkg = line.slice(0, idx).trim();
        var label = line.slice(idx + 1).trim();
        if (!isValidPackage(pkg)) return;
        if (!label || label === 'null' || label === 'null,' || label === '{}' || label === 'none') return;
        labels[pkg] = label.slice(0, 60);
    });
    return labels;
}

function mergeAppList(packages, rules, labels) {
    var byPkg = {};
    var ensure = function (pkg) {
        if (!byPkg[pkg]) byPkg[pkg] = { pkg: pkg, label: labels[pkg] || '', rate: 0, installed: false };
        return byPkg[pkg];
    };
    (packages || []).forEach(function (pkg) { ensure(pkg).installed = true; });
    (rules || []).forEach(function (rule) {
        var pkg = str(rule.pkg).trim();
        if (!pkg) return;
        ensure(pkg).rate = rateToHz(rule.rate);
    });
    var list = Object.keys(byPkg).map(function (pkg) { return byPkg[pkg]; });
    list.sort(function (a, b) {
        var aRuled = a.rate > 0 ? 1 : 0;
        var bRuled = b.rate > 0 ? 1 : 0;
        if (aRuled !== bRuled) return bRuled - aRuled;
        var aName = (a.label || a.pkg).toLowerCase();
        var bName = (b.label || b.pkg).toLowerCase();
        return aName < bName ? -1 : (aName > bName ? 1 : 0);
    });
    return list;
}

function filterApps(list, filter) {
    var keyword = str(filter).trim().toLowerCase();
    if (!keyword) return list || [];
    return (list || []).filter(function (app) {
        return (app.label || '').toLowerCase().indexOf(keyword) >= 0 || app.pkg.toLowerCase().indexOf(keyword) >= 0;
    });
}

function parseMeasureResult(jsonText, rawText) {
    var parsed = parseJsonLoose(jsonText);
    if (parsed) {
        var hz = toNumber(parsed.hz != null ? parsed.hz : parsed.rate_hz, 0);
        if (hz) {
            return { ok: parsed.ok !== false, hz: hz, events: toNumber(parsed.events, 0), seconds: parsed.seconds != null ? parseFloat(parsed.seconds) : 0, raw: str(jsonText) };
        }
    }
    var textHz = parseRateText(rawText);
    return { ok: textHz > 0, hz: textHz, events: 0, seconds: 0, raw: str(rawText) };
}

function parseLicenseStatus(text) {
    var parsed = parseJsonLoose(text);
    if (parsed) {
        return {
            supported: true,
            activated: toBool(parsed.valid) || toBool(parsed.activated),
            plan: str(parsed.plan),
            deviceId: str(parsed.device_id),
            reason: str(parsed.reason),
            activatedAt: str(parsed.activated_at)
        };
    }
    var value = str(text).trim();
    if (!value || value.indexOf('Error:') === 0 || value.indexOf('unknown option') >= 0 || value.indexOf('未知选项') >= 0 || value.indexOf('错误') >= 0) {
        return { supported: false, activated: false, plan: '', deviceId: '', reason: '', activatedAt: '' };
    }
    return { supported: true, activated: false, plan: '', deviceId: '', reason: value.slice(0, 120), activatedAt: '' };
}

function sanitizeLicenseCode(code) { return str(code).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 64); }

/* ============================================================
 * 8. 外观（MIUIX + 调度式玻璃；localStorage 持久化）
 * ============================================================ */
/* ============================================================
 * 8. 外观 / 主题界面（v4.2：纯白默认、动态背景、玻璃参数、二级页）
 * ============================================================ */
/* ============================================================
 * 8. 外观 / 主题界面（v5.18：纯色背景 白/黑/跟随系统/自定义 + 主题色）
 * ============================================================ */
function cloneDefaultAppearance() {
    var d = DEFAULT_APPEARANCE;
    return {
        themeMode: d.themeMode,
        backgroundMode: d.backgroundMode,
        backgroundColor: d.backgroundColor,
        accent: d.accent,
        textColor: d.textColor
    };
}

function normalizeHexColor(value, fallback) {
    var v = String(value == null ? '' : value).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(v)) return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toUpperCase();
    return fallback || '#F663A6';
}

function normalizeColorHex(value, fallback) {
    var v = String(value == null ? '' : value).trim();
    if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.toUpperCase();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return ('#FF' + v.slice(1)).toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(v)) return normalizeHexColor(v, '#FFFFFF');
    return String(fallback || '#FFFFFFFF').toUpperCase();
}

function cssColorFromHex(value, fallback) {
    var v = String(value == null ? '' : value).trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(v)) return v;
    if (/^#[0-9A-F]{3}$/.test(v)) return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    if (/^#[0-9A-F]{8}$/.test(v)) {
        var alpha = v.slice(1, 3);
        var rgb = v.slice(3);
        return alpha === 'FF' ? ('#' + rgb) : ('#' + rgb + alpha);
    }
    return fallback || '#FFFFFF';
}

function isHexColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value == null ? '' : value).trim());
}

function hexToRgb(hex) {
    var h = normalizeHexColor(hex, '#000000').slice(1);
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function rgbToHex(r, g, b) {
    var clamp = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
    var hex = function (v) { var s = clamp(v).toString(16); return s.length < 2 ? '0' + s : s; };
    return ('#' + hex(r) + hex(g) + hex(b)).toUpperCase();
}

function rgbLuminance(rgb) {
    var channel = function (v) {
        var c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function deriveDarkAccent(hex) {
    var rgb = hexToRgb(normalizeHexColor(hex, '#F663A6'));
    var luminance = rgbLuminance(rgb);
    if (luminance >= 0.45) return normalizeHexColor(hex, '#F663A6');
    var ratio = ((0.45 - luminance) / 0.45) * 0.45;
    return rgbToHex(rgb.r + (255 - rgb.r) * ratio, rgb.g + (255 - rgb.g) * ratio, rgb.b + (255 - rgb.b) * ratio);
}

function simpleHash(value) {
    var h = 0x811c9dc5;
    var s = String(value == null ? '' : value);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
}

/* 背景选项：white / black / auto / custom；存储为 backgroundColor：
   '#FFFFFFFF'（白）、'#FF000000'（黑）、'auto'（跟随主题/系统）、自定义 #AARRGGBB */
var BACKGROUND_CHOICES = ['white', 'black', 'auto', 'custom'];

function normalizeBackgroundChoice(value, fallback) {
    var v = String(value == null ? '' : value).trim();
    if (v === 'auto' || v === 'white' || v === 'black') return v;
    if (v === '#FFFFFFFF' || v === '#FFFFFF') return 'white';
    if (v === '#FF000000' || v === '#000000') return 'black';
    if (/^#[0-9a-fA-F]{6,8}$/.test(v)) return 'custom';
    return fallback || 'white';
}

function validateAppearance(raw) {
    var base = cloneDefaultAppearance();
    var src = raw && typeof raw === 'object' ? raw : {};
    var out = cloneDefaultAppearance();
    out.themeMode = THEME_ORDER.indexOf(src.themeMode) >= 0 ? src.themeMode : base.themeMode;
    out.backgroundMode = 'color'; /* 旧版本 backgroundMode 非 color（wallpaper/custom/live/none）一律回落纯色 */
    var choice = normalizeBackgroundChoice(src.backgroundColor, base.backgroundColor);
    if (choice === 'white') out.backgroundColor = '#FFFFFFFF';
    else if (choice === 'black') out.backgroundColor = '#FF000000';
    else if (choice === 'auto') out.backgroundColor = 'auto';
    else out.backgroundColor = normalizeColorHex(src.backgroundColor, '#FFFFFFFF');
    out.accent = normalizeHexColor(src.accent, base.accent);
    out.textColor = isHexColor(src.textColor) ? normalizeHexColor(src.textColor, '') : '';
    return out;
}

function loadAppearance() {
    var stored = null;
    try {
        var raw = localStorage.getItem(APPEARANCE_KEY);
        if (raw) stored = JSON.parse(raw);
    } catch (e) { stored = null; }
    if (stored && typeof stored === 'object') {
        /* 旧版本（图片/动态/玻璃/字体）迁移：忽略所有旧参数，背景回落纯色 */
        var migrated = validateAppearance(stored);
        if (stored.backgroundMode && stored.backgroundMode !== 'color') {
            migrated.backgroundColor = '#FFFFFFFF';
        }
        var old = String(stored.backgroundColor || '').toUpperCase();
        if (old === '#FFFFECF7' || old === '#FFECF7') migrated.backgroundColor = '#FFFFFFFF';
        return migrated;
    }
    var legacy = null;
    try { legacy = localStorage.getItem(LEGACY_THEME_KEY); } catch (e) { legacy = null; }
    var fallback = cloneDefaultAppearance();
    if (THEME_ORDER.indexOf(legacy) >= 0) fallback.themeMode = legacy;
    return fallback;
}

function saveAppearance() {
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(APP.appearance)); } catch (e) { /* ignore */ }
}

var appearanceSaveTimer = null;
function scheduleAppearancePersist() {
    if (appearanceSaveTimer) clearTimeout(appearanceSaveTimer);
    appearanceSaveTimer = setTimeout(function () {
        appearanceSaveTimer = null;
        saveAppearance();
    }, 200);
}

function effectiveDark() {
    var mode = APP.appearance ? APP.appearance.themeMode : APP.theme;
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
}

function themeModeLabel(mode) {
    if (mode === 'light') return '浅色';
    if (mode === 'dark') return '深色';
    return '跟随系统';
}

function backgroundChoiceLabel(choice) {
    if (choice === 'black') return '黑色 #000000';
    if (choice === 'auto') return '跟随系统';
    if (choice === 'custom') return cssColorFromHex(APP.appearance.backgroundColor);
    return '白色 #FFFFFF';
}

function computedBackgroundColor(appearance) {
    var a = appearance || APP.appearance || DEFAULT_APPEARANCE;
    var choice = normalizeBackgroundChoice(a.backgroundColor, 'white');
    if (choice === 'white') return '#FFFFFF';
    if (choice === 'black') return '#000000';
    if (choice === 'auto') return effectiveDark() ? '#141416' : '#FFFFFF';
    return cssColorFromHex(a.backgroundColor);
}

function backgroundTone(appearance) {
    var a = appearance || APP.appearance || DEFAULT_APPEARANCE;
    var choice = normalizeBackgroundChoice(a.backgroundColor, 'white');
    if (choice === 'auto') return '';
    var bg = computedBackgroundColor(a);
    return rgbLuminance(hexToRgb(bg)) >= 0.45 ? 'light' : 'dark';
}

function updateThemeColorMeta() {
    var bg = computedBackgroundColor();
    try {
        var metas = document.querySelectorAll('meta[name="theme-color"]');
        for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', bg);
    } catch (e) { /* ignore */ }
}

function applyTheme(mode) {
    if (THEME_ORDER.indexOf(mode) < 0) mode = 'auto';
    APP.theme = mode;
    if (APP.appearance) APP.appearance.themeMode = mode;
    try {
        if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', mode);
    } catch (e) { /* ignore */ }
}

function applyAppearanceVars() {
    var a = APP.appearance || (APP.appearance = loadAppearance());
    var root = document.documentElement;
    var accent = normalizeHexColor(a.accent, DEFAULT_APPEARANCE.accent);
    root.style.setProperty('--accent-light', accent);
    root.style.setProperty('--accent-dark', deriveDarkAccent(accent));
    if (a.textColor) root.style.setProperty('--text-user', a.textColor);
    else root.style.removeProperty('--text-user');
    var bg = computedBackgroundColor(a);
    root.style.setProperty('--bg-user', bg);
    root.style.setProperty('--bg', bg);
    var tone = backgroundTone(a);
    try {
        if (tone) root.setAttribute('data-bg-tone', tone);
        else root.removeAttribute('data-bg-tone');
    } catch (e) { /* ignore */ }
    if (document.body) {
        document.body.classList.toggle('bg-dark', tone === 'dark' || (tone === '' && effectiveDark()));
        document.body.classList.toggle('bg-color-mode', true);
    }
    updateThemeColorMeta();
}

function applyAppearance() {
    if (!APP.appearance) APP.appearance = loadAppearance();
    applyTheme(APP.appearance.themeMode);
    applyAppearanceVars();
    updateAppearanceControls();
}

function updateAppearanceControls() {
    var a = APP.appearance;
    if (!a) return;
    setText('theme-mode-value', themeModeLabel(a.themeMode));
    var choice = normalizeBackgroundChoice(a.backgroundColor, 'white');
    setText('bg-color-value', backgroundChoiceLabel(choice));
    var bgColor = $('bg-color');
    if (bgColor) bgColor.value = choice === 'custom' ? cssColorFromHex(a.backgroundColor).slice(0, 7) : computedBackgroundColor(a).slice(0, 7);
    document.querySelectorAll('#accent-swatches [data-accent]').forEach(function (btn) {
        btn.classList.toggle('is-active', normalizeHexColor(btn.dataset.accent) === normalizeHexColor(a.accent));
    });
    setText('text-color-value', a.textColor || '自动（跟随主题色）');
    var textColor = $('text-color');
    if (textColor) textColor.value = a.textColor || normalizeHexColor(a.accent, '#F663A6');
}

function setThemeMode(mode) {
    if (THEME_ORDER.indexOf(mode) < 0) return;
    APP.appearance.themeMode = mode;
    saveAppearance();
    applyTheme(mode);
    applyAppearanceVars();
    updateAppearanceControls();
}

function setBackgroundChoice(choice, customHex) {
    var normalized = normalizeBackgroundChoice(choice, 'white');
    if (normalized === 'white') APP.appearance.backgroundColor = '#FFFFFFFF';
    else if (normalized === 'black') APP.appearance.backgroundColor = '#FF000000';
    else if (normalized === 'auto') APP.appearance.backgroundColor = 'auto';
    else APP.appearance.backgroundColor = normalizeColorHex(customHex || APP.appearance.backgroundColor, '#FFFFECF7');
    APP.appearance.backgroundMode = 'color';
    saveAppearance();
    applyAppearanceVars();
    updateAppearanceControls();
}

function setAccentColor(hex) {
    APP.appearance.accent = normalizeHexColor(hex, DEFAULT_APPEARANCE.accent);
    scheduleAppearancePersist();
    applyAppearanceVars();
    updateAppearanceControls();
}

function setTextColor(hex) {
    APP.appearance.textColor = isHexColor(hex) ? normalizeHexColor(hex, '') : '';
    scheduleAppearancePersist();
    applyAppearanceVars();
    updateAppearanceControls();
}

function resetAppearance() {
    APP.appearance = cloneDefaultAppearance();
    saveAppearance();
    applyAppearance();
    toast('已恢复默认：白色背景 / 跟随系统 / 默认粉', 'ok');
}

function openDrawer(id) { var drawer = $(id); if (!drawer) return; drawer.hidden = false; }
function closeDrawer(id) { var drawer = $(id); if (drawer) drawer.hidden = true; }

var optionPickHandler = null;
function openOptionSheet(title, options, onPick) {
    var sheet = $('option-sheet');
    var list = $('option-sheet-list');
    if (!sheet || !list) { if (onPick) onPick(options && options[0] ? options[0].value : ''); return; }
    setText('option-sheet-title', title || '选择');
    var html = '';
    (options || []).forEach(function (opt) {
        html += '<button type="button" class="option-item' + (opt.active ? ' is-active' : '') + '" data-option-value="' + escapeHtml(opt.value) + '">' + escapeHtml(opt.label) + '</button>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.option-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var value = btn.dataset.optionValue;
            var handler = optionPickHandler;
            optionPickHandler = null;
            closeDrawer('option-sheet');
            if (handler) handler(value);
        });
    });
    optionPickHandler = onPick || null;
    sheet.hidden = false;
}
function closeOptionSheet() { optionPickHandler = null; closeDrawer('option-sheet'); }

function openThemePage() {
    var page = $('theme-page');
    if (!page) return;
    var model = APP.state && APP.state.model ? APP.state.model : 'RMX5200';
    setText('theme-device', model);
    updateAppearanceControls();
    page.hidden = false;
    page.scrollTop = 0;
    if (document.body) document.body.classList.add('subpage-open');
}

function closeThemePage() {
    var page = $('theme-page');
    if (page) page.hidden = true;
    if (document.body) document.body.classList.remove('subpage-open');
}

function bindAppearance() {
    var openBtn = $('btn-appearance');
    if (openBtn) openBtn.addEventListener('click', openThemePage);
    var backBtn = $('btn-theme-back');
    if (backBtn) backBtn.addEventListener('click', closeThemePage);

    async function askReset() {
        var ok = await confirmDialog({ title: '恢复默认外观', message: '将重置为白色背景、跟随系统主题模式、默认粉色与自动文字颜色。', confirmText: '恢复默认' });
        if (ok) resetAppearance();
    }
    var resetHeader = $('btn-theme-reset');
    if (resetHeader) resetHeader.addEventListener('click', askReset);
    var resetRow = $('btn-theme-reset-row');
    if (resetRow) resetRow.addEventListener('click', askReset);

    var bgColorInput = $('bg-color');
    var bgRow = $('btn-bg-color');
    if (bgRow) bgRow.addEventListener('click', function () {
        var choice = normalizeBackgroundChoice(APP.appearance.backgroundColor, 'white');
        openOptionSheet('背景颜色', [
            { value: 'white', label: '白色 #FFFFFF', active: choice === 'white' },
            { value: 'black', label: '黑色 #000000', active: choice === 'black' },
            { value: 'auto', label: '跟随系统', active: choice === 'auto' },
            { value: 'custom', label: '自定义颜色…', active: choice === 'custom' }
        ], function (value) {
            if (value === 'custom') {
                if (bgColorInput) bgColorInput.click();
                return;
            }
            setBackgroundChoice(value);
        });
    });
    if (bgColorInput) bgColorInput.addEventListener('input', function () {
        setBackgroundChoice('custom', bgColorInput.value);
    });

    var themeModeRow = $('btn-theme-mode');
    if (themeModeRow) themeModeRow.addEventListener('click', function () {
        openOptionSheet('主题模式', [
            { value: 'auto', label: '跟随系统', active: APP.appearance.themeMode === 'auto' },
            { value: 'light', label: '浅色', active: APP.appearance.themeMode === 'light' },
            { value: 'dark', label: '深色', active: APP.appearance.themeMode === 'dark' }
        ], setThemeMode);
    });

    document.querySelectorAll('#accent-swatches [data-accent]').forEach(function (btn) {
        btn.addEventListener('click', function () { setAccentColor(btn.dataset.accent); });
    });
    var textColor = $('text-color');
    if (textColor) textColor.addEventListener('input', function () { setTextColor(textColor.value); });

    document.querySelectorAll('[data-option-close]').forEach(function (node) {
        node.addEventListener('click', closeOptionSheet);
    });
    document.querySelectorAll('[data-sheet-close]').forEach(function (node) {
        node.addEventListener('click', function () { closeDrawer('app-rate-sheet'); });
    });
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        ['option-sheet', 'app-rate-sheet'].forEach(function (id) {
            var node = $(id);
            if (node && !node.hidden) closeDrawer(id);
        });
    });

    try {
        var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        if (mq) {
            var onChange = function () {
                if (APP.appearance && APP.appearance.themeMode === 'auto') {
                    applyAppearanceVars();
                    updateAppearanceControls();
                }
            };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        }
    } catch (e) { /* ignore */ }
}

/* ============================================================
 * 9. UI 基础：toast / modal / busy
 * ============================================================ */
var toastTimer = null;
function toast(message, kind, duration) {
    var node = $('toast');
    if (!node) return;
    kind = kind || 'info';
    node.textContent = message;
    node.className = 'toast';
    node.hidden = false;
    void node.offsetWidth;
    node.className = 'toast is-show' + (kind === 'ok' ? ' is-ok' : kind === 'err' ? ' is-err' : kind === 'warn' ? ' is-warn' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
        node.classList.remove('is-show');
        setTimeout(function () { node.hidden = true; }, 240);
    }, duration || 2600);
}

function confirmDialog(options) {
    options = options || {};
    return new Promise(function (resolve) {
        var modal = $('modal');
        if (!modal) { resolve(false); return; }
        APP.modalResolver = resolve;
        setText('modal-title', options.title || '确认操作');
        setText('modal-body', options.message || '');
        var okBtn = $('modal-ok');
        if (okBtn) okBtn.textContent = options.confirmText || '确定';
        var cancelBtn = $('modal-cancel');
        if (cancelBtn) cancelBtn.textContent = options.cancelText || '取消';
        modal.classList.toggle('is-danger', !!options.danger);
        modal.hidden = false;
        if (okBtn) okBtn.focus();
    });
}

function closeModal(result) {
    var modal = $('modal');
    var resolver = APP.modalResolver;
    APP.modalResolver = null;
    if (modal) { modal.hidden = true; modal.classList.remove('is-danger'); }
    if (resolver) resolver(!!result);
}

function withBusy(button, label, task) {
    if (!button) return Promise.resolve().then(task);
    if (button.disabled) return Promise.resolve();
    var originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = label;
    return Promise.resolve().then(task).catch(function (e) {
        toast('操作失败：' + (e && e.message ? e.message : e), 'err');
    }).then(function () {
        button.classList.remove('is-busy');
        button.disabled = false;
        button.innerHTML = originalHtml;
    });
}

/* ============================================================
 * 10. 三栏 Header / 主页
 * ============================================================ */
var TAB_META = {
    home: { title: '主页', primary: '刷新', secondary: '' },
    config: { title: '配置', primary: '', secondary: '' },
    logs: { title: '日志', primary: '刷新', secondary: '' },
    user: { title: '用户', primary: '刷新', secondary: '' }
};

function updateHeaderForTab(name) {
    var meta = TAB_META[name] || TAB_META.home;
    setText('page-title', meta.title);
    var primary = $('btn-header-primary');
    if (primary) {
        primary.textContent = meta.primary || '';
        primary.hidden = !meta.primary;
    }
    var secondary = $('btn-header-secondary');
    if (secondary) {
        secondary.textContent = meta.secondary || '';
        secondary.hidden = !meta.secondary;
    }
}

function renderHeader() {
    var s = APP.state;
    var dot = $('daemon-dot');
    if (dot) dot.className = 'status-dot daemon-dot ' + (!s ? 'is-unknown' : (s.unavailable ? 'is-unknown' : (s.daemon_running ? 'is-ok' : 'is-bad')));
    setText('daemon-text', !s ? '检测中' : (s.unavailable ? '检测失败' : (s.daemon_running ? '运行中' : '已停止')));
    var backend = s && s.backend ? backendLabel(s.backend) : '无';
    setText('header-backend', backend);
    setText('module-version', APP.moduleVersion + (s && s.version ? ' · daemon ' + s.version : ''));
    var heroLicense = $('hero-license');
    if (heroLicense) {
        var paidAuth = APP.paid.auth || {};
        if (APP.paid.premium && APP.paid.premium.installed !== 1) {
            heroLicense.textContent = '付费组件未安装';
        } else if (paidAuth.entitlement === 'active' || paidAuth.entitlement === 'grace') {
            heroLicense.textContent = paidAuth.entitlement === 'grace' ? '离线授权' : ('已授权' + (paidAuth.license_last4 ? ' · ' + paidAuth.license_last4 : ''));
        } else {
            heroLicense.textContent = '未授权';
        }
    }
}

function effectiveSourceInfo(state) {
    var s = state || {};
    if (s.sync_enabled) {
        return {
            label: '触显同步',
            detail: '（' + (s.refresh_hz || '—') + '→' + (s.sync_target_hz || '—') + ' Hz）',
            toastLabel: '触显同步'
        };
    }
    if (s.matched && Number(s.rule_rate) > 0) {
        var ruleHz = rateToHz(s.rule_rate) || s.rule_rate;
        return {
            label: '应用规则',
            detail: ((s.foreground || '当前应用') + ' ' + ruleHz + ' Hz'),
            toastLabel: '应用规则'
        };
    }
    if (Number(s.global_rate) > 0) {
        return { label: '全局', detail: (Number(s.global_rate) + ' Hz'), toastLabel: '全局' };
    }
    return { label: '系统默认', detail: '', toastLabel: '系统默认' };
}

function formatConfigEffective(state) {
    var s = state || {};
    if (s.sync_enabled) {
        return '当前生效：触显同步（' + (s.refresh_hz || '—') + 'Hz→' + (s.sync_target_hz || '—') + 'Hz）';
    }
    if (s.matched && Number(s.rule_rate) > 0) {
        var ruleHz = rateToHz(s.rule_rate) || s.rule_rate;
        return '当前应用规则：' + (s.foreground || '当前应用') + ' ' + ruleHz + 'Hz（优先级最高）';
    }
    if (Number(s.global_rate) > 0) {
        return '当前生效：全局 ' + Number(s.global_rate) + 'Hz（仅对无单独规则应用生效）';
    }
    return '当前生效：系统默认';
}

function renderConfigStatus(state) {
    var s = state || APP.state || {};
    var info = effectiveSourceInfo(s);
    setText('config-effective', formatConfigEffective(s));
    setText('effective-source', info.label + (info.detail ? ' · ' + info.detail : ''));
    var warn = $('config-sync-warning');
    if (warn) warn.hidden = !s.sync_enabled;
    setText('config-sync-state', s.sync_supported ? ('触显同步：' + (s.sync_enabled ? '已开启（daemon）' : '已关闭（daemon）')) : '触显同步：旧 daemon 不支持');
    var hint = $('config-global-hint');
    if (hint) {
        var ruled = !!(s.matched && Number(s.rule_rate) > 0);
        hint.hidden = !ruled;
        if (ruled) {
            hint.textContent = '当前前台应用 ' + (s.foreground || '') + ' 有单独规则 ' +
                (rateToHz(s.rule_rate) || s.rule_rate) + ' Hz，全局值只对无规则应用生效。';
        }
    }
}

async function writeSyncConfigVerified(value) {
    var expected = String(value).trim() === '1' ? '1' : '0';
    var writeOut = await runCommand(CMD.writeSyncConfig(b64urlEncode(expected)), { timeout: 15000 });
    if (!hasSentinel(writeOut, '__WRITE_OK__')) throw new Error('写入命令失败');
    var readBack = String(await runCommand(CMD.readSyncConfig(), { timeout: 10000 }) || '').trim();
    if (readBack !== expected) throw new Error('回读不一致：' + (readBack || '(空)'));
    return true;
}

function setGlobalRate(hz) {
    APP.config.global = parseInt(hz, 10) || 0;
    markDirty();
    updateGlobalDefault();
    updateConfigWarnings();
    scheduleConfigApply();
}

function showGlobalRuleConflictDialog(hz) {
    var s = APP.state || {};
    var fg = s.foreground || '当前应用';
    var ruleHz = rateToHz(s.rule_rate) || s.rule_rate;
    showPaidOverlay('全局采样率不会覆盖应用规则', '<p class="paid-hint">当前应用 <b>' + escapeHtml(fg) + '</b> 有单独规则 ' +
        ruleHz + 'Hz，全局值只对无规则应用生效。是否同时把该应用规则改成 ' + hz + 'Hz？</p>', [
        { label: '取消', className: 'btn-secondary', onClick: closePaidOverlay },
        { label: '只改全局', className: 'btn-secondary', onClick: function () {
            closePaidOverlay();
            setGlobalRate(hz);
            toast('已保存全局 ' + hz + 'Hz；当前应用 ' + fg + ' 仍为 ' + ruleHz + 'Hz', 'warn', 4200);
        } },
        { label: '同时改应用规则', className: 'btn-primary', onClick: function () {
            closePaidOverlay();
            setGlobalRate(hz);
            setRuleRate(fg, hz);
            toast('已同时修改全局与当前应用规则为 ' + hz + 'Hz', 'ok', 3200);
        } }
    ]);
}

async function changeGlobalRate(hz) {
    var s = APP.state || {};
    var ruleHz = rateToHz(s.rule_rate) || s.rule_rate;
    if (Object.prototype.hasOwnProperty.call(s, 'rule_rate') && s.matched && s.foreground && hz > 0 && ruleHz > 0 && Number(ruleHz) !== Number(hz)) {
        showGlobalRuleConflictDialog(hz);
        return;
    }
    setGlobalRate(hz);
}

async function guardConfigChange(changeFn) {
    if (APP.configGuardBusy) return;
    if (!APP.state || !APP.state.sync_enabled) {
        await changeFn();
        return;
    }
    APP.configGuardBusy = true;
    try {
        var ok = await confirmDialog({
            title: '关闭触显同步并应用？',
            message: '触显同步已开启，采样率配置（全局/应用规则）暂不生效。需要关闭触显同步才能应用该配置，关闭并应用？',
            confirmText: '关闭并应用',
            danger: true
        });
        if (!ok) return;
        await writeSyncConfigVerified('0');
        await runCommand(CMD.reload(), { timeout: 20000 });
        toast('已关闭触显同步，正在应用配置', 'ok');
        await changeFn();
        await sleep(250);
        await refreshStatus();
    } catch (e) {
        toast('关闭触显同步失败：' + (e && e.message ? e.message : e), 'err', 3600);
    } finally {
        APP.configGuardBusy = false;
    }
}

function notifyConfigApplied(state) {
    var s = state || APP.state || {};
    var info = effectiveSourceInfo(s);
    toast('已应用，当前 ' + (s.current_hz || '—') + 'Hz（来源：' + info.toastLabel + '）', 'ok', 3400);
}

async function pollConfigApplied() {
    var start = Date.now();
    var lastState = APP.state || {};
    for (var i = 0; i < SYNC_RECHECK_DELAYS.length; i++) {
        var wait = SYNC_RECHECK_DELAYS[i] - (Date.now() - start);
        if (wait > 0) await sleep(wait);
        await refreshStatus();
        lastState = APP.state || {};
        if (lastState.target_hz > 0 && lastState.current_hz === lastState.target_hz) {
            notifyConfigApplied(lastState);
            return;
        }
    }
    toast('配置已保存，但暂未一致：目标 ' + (lastState.target_hz || '—') + ' Hz，当前 ' +
        (lastState.current_hz || '—') + ' Hz（可能被触显同步/规则覆盖）', 'warn', 4200);
}

function syncSourceLabel(source) {
    var value = String(source || '');
    if (value === 'display_log') return '慕容显示增强日志（实际刷新率）';
    if (value === 'display_module') return '慕容显示增强配置';
    if (value === 'dump_info' || value === 'dumpsys') return '系统节点检测';
    if (value === 'fallback') return '回退采样率规则';
    return value || '—';
}

function syncSourceShortLabel(source) {
    var value = String(source || '');
    if (value === 'display_log') return '显示增强日志';
    if (value === 'display_module') return '显示增强配置';
    if (value === 'dump_info' || value === 'dumpsys') return '系统节点检测';
    if (value === 'fallback') return '回退规则';
    return value || '—';
}

function syncLastWriteText(s) {
    if (!s || s.last_write_target_hz <= 0) return '';
    return ' · 最后写入 ' + s.last_write_target_hz + ' Hz' + (s.last_write_ok ? '（成功）' : '（失败）');
}

function renderSyncCard(s) {
    var toggle = $('sync-toggle');
    var supported = !!(s && s.sync_supported);
    if (toggle) {
        toggle.disabled = !supported || !!APP.syncSwitching;
        toggle.checked = supported ? !!s.sync_enabled : false;
    }
    if (!supported) {
        setText('sync-refresh', '—');
        setText('sync-target', '—');
        setText('sync-source', '—');
        setText('sync-hint', '需更新付费组件后可用');
        return;
    }
    var sourceLabel = syncSourceLabel(s.sync_source);
    var sourceShort = syncSourceShortLabel(s.sync_source);
    setText('sync-state', APP.syncSwitching ? '切换中…' : (s.sync_enabled ? '已开启（daemon）' : '已关闭（daemon）'));
    setText('sync-refresh', s.refresh_hz > 0 ? (s.refresh_hz + ' Hz') : '—');
    setText('sync-target', s.sync_target_hz > 0 ? (s.sync_target_hz + ' Hz') : '—');
    setText('sync-source', sourceLabel);
    var lastWrite = syncLastWriteText(s);
    if (APP.syncSwitching) {
        setText('sync-hint', '触显同步 · 切换中…（目标 ' + (s.sync_target_hz || '—') + ' Hz）');
        return;
    }
    if (s.sync_enabled) {
        var settled = s.sync_target_hz > 0 && s.current_hz > 0 && s.current_hz === s.sync_target_hz;
        if (APP.syncTimeout && !settled) {
            setText('sync-hint', '触显同步 · 切换超时，请稍后刷新状态（目标 ' + (s.sync_target_hz || '—') + ' Hz）' + lastWrite);
        } else if (settled) {
            setText('sync-hint', '触显同步 · 已生效：当前刷新率 ' + s.refresh_hz + ' Hz（来源：' + sourceShort + '）→ 目标采样率 ' + s.sync_target_hz + ' Hz' +
                (s.sync_package ? ' · 命中 ' + s.sync_package : '') + lastWrite);
        } else {
            setText('sync-hint', '触显同步 · 切换中…（当前 ' + (s.current_hz || '—') + ' Hz → 目标 ' + (s.sync_target_hz || '—') + ' Hz）' + lastWrite);
        }
    } else if (s.display_module_installed) {
        setText('sync-hint', '开启后跟随显示模块刷新率自动切换');
    } else {
        setText('sync-hint', '已关闭：按「采样率」页规则执行。');
    }
}

async function toggleTouchSync(enabled) {
    var toggle = $('sync-toggle');
    if (!APP.state || !APP.state.sync_supported) {
        toast('需更新付费组件后可用', 'warn', 3000);
        renderSyncCard(APP.state);
        return;
    }
    if (toggle) toggle.disabled = true;
    APP.syncSwitching = true;
    APP.syncTimeout = false;
    renderSyncCard(APP.state);
    if (APP.syncPollTimers && APP.syncPollTimers.length) {
        APP.syncPollTimers.forEach(function (timer) { clearTimeout(timer); });
    }
    APP.syncPollTimers = [];
    var finish = function () {
        if (APP.syncPollTimers && APP.syncPollTimers.length) {
            APP.syncPollTimers.forEach(function (timer) { clearTimeout(timer); });
        }
        APP.syncPollTimers = [];
    };
    var checkSettled = async function () {
        if (!APP.syncSwitching) return;
        if (!APP.statusLoading) {
            await refreshStatus();
        }
        var state = APP.state;
        if (!state) return;
        var settled = enabled
            ? (state.sync_enabled && state.sync_target_hz > 0 && state.current_hz > 0 && state.current_hz === state.sync_target_hz)
            : !state.sync_enabled;
        if (settled) {
            APP.syncSwitching = false;
            APP.syncTimeout = false;
            finish();
            renderSyncCard(state);
        }
    };
    try {
        await writeSyncConfigVerified(enabled ? '1' : '0');
        await runCommand(CMD.reload(), { timeout: 20000 });
        toast(enabled ? '触显同步已开启，正在切换…' : '触显同步已关闭', 'ok');
    } catch (e) {
        APP.syncSwitching = false;
        APP.syncTimeout = false;
        finish();
        var currentToggle = $('sync-toggle');
        if (currentToggle) currentToggle.checked = !!(APP.state && APP.state.sync_enabled);
        renderSyncCard(APP.state);
        toast('保存失败：触显同步配置未生效（' + (e && e.message ? e.message : e) + '）', 'err', 3800);
        return;
    }
    SYNC_RECHECK_DELAYS.forEach(function (delay) {
        APP.syncPollTimers.push(setTimeout(checkSettled, delay));
    });
    APP.syncPollTimers.push(setTimeout(function () {
        if (!APP.syncSwitching) return;
        APP.syncSwitching = false;
        APP.syncTimeout = true;
        finish();
        renderSyncCard(APP.state);
    }, SYNC_SETTLE_TIMEOUT));
    await sleep(300);
    await checkSettled();
}

function renderHome() {
    var s = APP.state;
    if (!s) return;
    renderSyncCard(s);
    renderConfigStatus(s);
    setText('cur-hz', s.current_hz > 0 ? String(s.current_hz) : '--');
    var hero = $('hero-rate');
    if (hero) hero.className = 'hero-num ' + (!s.current_hz ? 'tier-unknown' : (s.current_hz >= 360 ? 'tier-high' : (s.current_hz >= 240 ? 'tier-mid' : 'tier-low')));
    setText('target-hz', s.target_hz > 0 ? String(s.target_hz) : '原值');
    setText('global-rate-val', s.global_rate > 0 ? (s.global_rate + ' Hz') : '0 · 不强制');
    setText('original-hz', s.original_hz > 0 ? String(s.original_hz) : '--');
    if (s.degraded) {
        setText('fg-pkg', '—'); setText('fg-src', '降级模式（daemon 不支持 --json）');
        setText('matched-state', '未知'); setText('matched-rule', '无法判断命中');
        setText('daemon-pid', s.daemon_running ? '运行中' : '已停止');
        setText('daemon-ver', 'daemon 版本未知');
    } else {
        setText('fg-pkg', s.foreground || '—');
        setText('fg-src', '来源 ' + foregroundSourceLabel(s.foreground_source));
        setText('matched-state', s.matched ? '已命中' : '未命中');
        setText('matched-rule', s.matched ? ((s.foreground || '前台应用') + ' → ' + (rateToHz(s.rule_rate) || s.rule_rate) + ' Hz') : (s.global_rate > 0 ? ('未命中规则，使用全局 ' + s.global_rate + ' Hz') : '未命中规则，恢复系统原值'));
        setText('daemon-pid', s.daemon_running && s.pid > 0 ? ('PID ' + s.pid) : (s.daemon_running ? '运行中' : '已停止'));
        setText('daemon-ver', 'daemon ' + s.version + ' · 规则 ' + s.rules + ' 条');
    }
    setText('backend-val', s.backend ? (backendLabel(s.backend) + (s.backend_ok ? ' · 正常' : ' · 异常')) : '无');
    var flag = $('hero-flag');
    if (flag) {
        if (s.degraded) { flag.textContent = '降级模式'; flag.className = 'badge badge-warn'; }
        else if (s.matched) { flag.textContent = '规则生效'; flag.className = 'badge badge-accent'; }
        else if (s.global_rate > 0) { flag.textContent = '全局生效'; flag.className = 'badge badge-ok'; }
        else { flag.textContent = '系统原值'; flag.className = 'badge badge-muted'; }
    }
    var mismatch = $('rate-mismatch');
    if (mismatch) {
        var show = !APP.syncSwitching && !s.sync_enabled && !s.degraded && !s.unavailable && s.target_hz > 0 && s.current_hz > 0 && s.current_hz !== s.target_hz;
        mismatch.hidden = !show;
        if (show) mismatch.textContent = '目标 ' + s.target_hz + ' Hz，当前 ' + s.current_hz + ' Hz：守护进程会在约 1.5 秒后自动纠正。';
    }
    var alert = $('status-alert');
    if (alert) {
        if (s.degraded) alert.hidden = false;
        else alert.hidden = true;
        if (s.degraded) alert.textContent = '当前 daemon 不支持 --json 接口（可能未升级到 v5.10），已降级读取基础状态。';
    }
    setText('last-update', '更新于 ' + timeLine());
    renderHeader();
}

function renderAuthBadge() {
    renderHeader();
}

async function refreshStatus(options) {
    options = options || {};
    if (APP.statusLoading) return;
    APP.statusLoading = true;
    try {
        var out = await runCommand(CMD.status(), { timeout: 20000 });
        var parsed = parseJsonLoose(out);
        if (parsed) {
            APP.state = normalizeState(parsed);
            APP.license.activated = APP.license.activated || !!APP.state.licensed;
        } else {
            var fallback = await runCommand(CMD.deviceInfo(), { timeout: 20000 });
            APP.state = fallbackState(fallback);
        }
        try {
            var displayOut = await runCommand(CMD.displayModuleInstalled(), { timeout: 8000 });
            if (hasSentinel(displayOut, '__DISPLAY_INSTALLED__')) APP.state.display_module_installed = true;
        } catch (eDisplay) { /* 忽略检测失败 */ }
        APP.lastStatusAt = Date.now();
        renderHome();
        renderAuthBadge();
        if (options.after && typeof options.after === 'function') options.after();
    } catch (e) {
        var alert = $('status-alert');
        if (alert) { alert.hidden = false; alert.textContent = '读取状态失败：' + (e && e.message ? e.message : e); }
    } finally {
        APP.statusLoading = false;
    }
}

async function readCurrentRate() {
    var btn = $('btn-read-rate');
    await withBusy(btn, '读取中…', async function () {
        await refreshStatus();
        toast('已刷新当前采样率' + (APP.state && APP.state.current_hz ? '：' + APP.state.current_hz + ' Hz' : ''), 'ok');
    });
}

async function measureRate() {
    var ok = await confirmDialog({
        title: '真实报点率测试',
        message: '将测量 3 秒真实报点率。\n请先用手指按住屏幕持续滑动，再点「开始测量」，测量期间保持滑动。',
        confirmText: '开始测量'
    });
    if (!ok) return;
    var btn = $('btn-measure');
    await withBusy(btn, '测量中…（保持滑动）', async function () {
        var jsonText = await runCommand(CMD.measureRate(3), { timeout: 60000 });
        var result = parseMeasureResult(jsonText, '');
        if (!result.hz) {
            var raw = await runCommand(CMD.measure(), { timeout: 60000 });
            result = parseMeasureResult('', raw);
        }
        var node = $('measure-out');
        if (node) {
            node.hidden = false;
            node.textContent = result.raw || ('实测报点率: ' + result.hz + ' Hz');
        }
        if (result.hz) toast('实测报点率：' + result.hz + ' Hz', 'ok');
        else toast('未测到有效报点率（daemon 未就绪或未滑动）', 'warn');
    });
}

/* ============================================================
 * 11. 主页操作
 * ============================================================ */
async function actionReload() {
    var btn = $('btn-reload');
    await withBusy(btn, '发送中…', async function () {
        var out = await runCommand(CMD.reload(), { timeout: 20000 });
        toast(hasSentinel(out, '__HUP_OK__') ? '已发送 SIGHUP，配置已重载' : '重载失败：守护进程可能未运行', hasSentinel(out, '__HUP_OK__') ? 'ok' : 'err');
        await sleep(350);
        await refreshStatus();
    });
}

async function actionRestart() {
    var ok = await confirmDialog({ title: '重启守护进程', message: '将结束并重新启动守护进程，采样率会短暂恢复原值。', confirmText: '重启' });
    if (!ok) return;
    var btn = $('btn-restart');
    await withBusy(btn, '重启中…', async function () {
        await runCommand(CMD.restart(), { timeout: 30000 });
        await sleep(1600);
        await refreshStatus();
        toast(APP.state && APP.state.daemon_running ? '守护进程已重启' : '守护进程似乎仍未运行，请到日志页收集诊断', APP.state && APP.state.daemon_running ? 'ok' : 'warn');
    });
}

async function actionRestore120() {
    var ok = await confirmDialog({ title: '恢复默认 120 Hz', message: '直接调用 --set-rate 120 切回 120Hz。\n若命中规则/全局值，守护进程会重新应用目标值。', confirmText: '恢复 120Hz' });
    if (!ok) return;
    var btn = $('btn-restore120');
    await withBusy(btn, '设置中…', async function () {
        var out = await runCommand(CMD.setRate(120), { timeout: 20000 });
        toast(hasSentinel(out, '__RATE_OK__') ? '已请求恢复 120Hz' : '恢复失败：' + stripSentinels(out), hasSentinel(out, '__RATE_OK__') ? 'ok' : 'err');
        await refreshStatus();
    });
}

async function actionRestoreOriginal() {
    var hz = APP.state && APP.state.original_hz > 0 ? APP.state.original_hz : 120;
    var ok = await confirmDialog({ title: '恢复系统原值', message: '将把采样率恢复到守护进程启动时捕获的系统原值（约 ' + hz + ' Hz）。', confirmText: '恢复原值' });
    if (!ok) return;
    var btn = $('btn-restore-original');
    await withBusy(btn, '设置中…', async function () {
        var out = await runCommand(CMD.setRate(hz), { timeout: 20000 });
        toast(hasSentinel(out, '__RATE_OK__') ? ('已请求恢复系统原值 ' + hz + 'Hz') : '恢复失败：' + stripSentinels(out), hasSentinel(out, '__RATE_OK__') ? 'ok' : 'err');
        await refreshStatus();
    });
}

async function actionUninstall() {
    var first = await confirmDialog({ title: '卸载模块（1/2）', message: '将写入 remove 标记并恢复默认采样率。', confirmText: '继续', danger: true });
    if (!first) return;
    var second = await confirmDialog({ title: '再次确认卸载', message: '卸载后需要重新刷入模块才能恢复采样率控制。确定卸载？', confirmText: '确认卸载', danger: true });
    if (!second) return;
    var btn = $('btn-uninstall');
    await withBusy(btn, '处理中…', async function () {
        var out = await runCommand(CMD.uninstall(), { timeout: 15000 });
        if (hasSentinel(out, '__REMOVE_OK__')) toast('已标记卸载，请重启手机完成移除', 'ok', 4200);
        else toast('卸载标记写入失败：' + stripSentinels(out), 'err');
    });
}

/* ============================================================
 * 12. 配置页：全局平铺 + 应用平铺 + 保存
 * ============================================================ */
function setConfigNotice(message, kind) {
    var node = $('config-notice');
    if (!node) return;
    if (!message) { node.hidden = true; return; }
    node.textContent = message;
    node.className = 'alert alert-' + (kind || 'info');
    node.hidden = false;
}

function updateRulesCount() {
    var count = APP.config.rules.length;
    setText('rules-count-tag', count + ' 条规则');
}

function updateGlobalDefault() {
    var value = APP.config.global > 0 ? (APP.config.global + ' Hz') : '0 · 不强制';
    setText('global-default-value', value);
    document.querySelectorAll('#global-rate-pills [data-global-rate]').forEach(function (btn) {
        btn.classList.toggle('is-active', parseInt(btn.dataset.globalRate, 10) === APP.config.global);
    });
}

function updateConfigWarnings() {
    var has400 = APP.config.global === 400 || APP.config.rules.some(function (rule) { return rateToHz(rule.rate) === 400; });
    var node = $('config-400-warn');
    if (node) node.hidden = !has400;
}

function markDirty() {
    APP.configDirty = true;
    var tag = $('rules-count-tag');
    if (tag && tag.textContent.indexOf('未保存') < 0) tag.textContent = APP.config.rules.length + ' 条规则 · 未保存';
}

function findRuleIndex(pkg) {
    for (var i = 0; i < APP.config.rules.length; i++) {
        if (APP.config.rules[i].pkg === pkg) return i;
    }
    return -1;
}

function setRuleRate(pkg, hz) {
    var index = findRuleIndex(pkg);
    var rate = parseInt(hz, 10) || 0;
    if (rate > 0) {
        if (index >= 0) APP.config.rules[index].rate = String(rate);
        else APP.config.rules.push({ pkg: pkg, rate: String(rate) });
    } else if (index >= 0) {
        APP.config.rules.splice(index, 1);
    }
    markDirty();
    renderAppList();
    updateRulesCount();
    updateConfigWarnings();
    scheduleConfigApply();
}

function renderAppList() {
    var node = $('app-list');
    var meta = $('app-list-meta');
    if (!node) return;
    var list = filterApps(APP.apps, APP.appFilter);
    var foreground = (APP.state && APP.state.foreground) || '';
    if (foreground) {
        list = list.slice().sort(function (a, b) {
            return (a.pkg === foreground ? -1 : 0) - (b.pkg === foreground ? -1 : 0);
        });
    }
    setText('app-list-meta', APP.appsLoading ? '检测中…' : ('共 ' + APP.apps.length + ' 个应用 · ' + APP.config.rules.length + ' 条规则'));
    if (!list.length) {
        node.innerHTML = '<div class="app-row-empty">' + (APP.appFilter ? '没有匹配的应用' : '点击「刷新列表」检测已安装应用') + '</div>';
        return;
    }
    var html = '';
    list.forEach(function (app) {
        var ruled = app.rate > 0;
        var label = app.label || app.pkg;
        var initial = label.slice(0, 1).toUpperCase();
        var chip = ruled ? (app.rate + ' Hz') : '默认';
        html += '<button type="button" class="app-row' + (ruled ? ' is-ruled' : '') + '" data-pkg="' + escapeHtml(app.pkg) + '">' +
            '<span class="app-avatar">' + escapeHtml(initial) + '</span>' +
            '<span class="app-row-main">' +
            '<span class="app-row-name">' + escapeHtml(label) + (app.pkg === foreground ? '<span class="app-current-badge">当前应用</span>' : '') + '</span>' +
            '<span class="app-row-pkg">' + escapeHtml(app.pkg) + (app.installed === false ? ' · 未安装（保留规则）' : '') + '</span>' +
            '</span>' +
            '<span class="app-row-chip ' + (ruled ? 'is-ruled' : 'is-default') + '">' + escapeHtml(chip) + '</span>' +
            '<span class="chevron">›</span>' +
            '</button>';
    });
    node.innerHTML = html;
    node.querySelectorAll('.app-row').forEach(function (row) {
        row.addEventListener('click', function () {
            var pkg = row.dataset.pkg;
            for (var i = 0; i < APP.apps.length; i++) {
                if (APP.apps[i].pkg === pkg) { openAppRateSheet(APP.apps[i]); return; }
            }
        });
    });
}

function openAppRateSheet(app) {
    APP.selectedApp = app;
    setText('app-sheet-title', app.label || app.pkg);
    setText('app-sheet-pkg', app.pkg + (app.installed === false ? ' · 未安装' : '') + ' · 修改后实时生效');
    document.querySelectorAll('#app-rate-options [data-app-rate]').forEach(function (btn) {
        var value = btn.dataset.appRate;
        var rate = parseInt(value, 10) || 0;
        var active = value === 'remove' ? (app.rate || 0) === 0 : rate === (app.rate || 0);
        btn.classList.toggle('is-active', active);
    });
    openDrawer('app-rate-sheet');
}

function bindAppRateSheet() {
    document.querySelectorAll('#app-rate-options [data-app-rate]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            guardConfigChange(async function () {
                if (!APP.selectedApp) return;
                var value = btn.dataset.appRate;
                if (value === 'remove') {
                    var ok = await confirmDialog({ title: '跟随全局默认', message: '将删除该应用规则，改为跟随全局默认采样率。', confirmText: '删除规则', danger: true });
                    if (!ok) return;
                    setRuleRate(APP.selectedApp.pkg, 0);
                    closeDrawer('app-rate-sheet');
                    toast('已改为跟随全局默认，实时生效', 'ok');
                    return;
                }
                setRuleRate(APP.selectedApp.pkg, value);
                closeDrawer('app-rate-sheet');
                toast('已更新规则，实时生效', 'ok');
            });
        });
    });
}

function mergeAppsWithRules() {
    var packages = APP.apps.filter(function (app) { return app.installed !== false; }).map(function (app) { return app.pkg; });
    APP.apps = mergeAppList(packages, APP.config.rules, APP.appLabels);
    renderAppList();
}

async function loadInstalledApps() {
    if (APP.appsLoading) return;
    APP.appsLoading = true;
    renderAppList();
    try {
        var out = await runCommand(CMD.listPackages(), { timeout: 20000 });
        var packages = parsePackagesOutput(out);
        if (!packages.length && out.indexOf('Error:') === 0) throw new Error(stripSentinels(out));
        APP.apps = mergeAppList(packages, APP.config.rules, APP.appLabels);
        APP.appsLoaded = true;
        APP.appsLoading = false;
        renderAppList();
        if (isMockMode()) {
            /* Mock：直接用内置标签，方便预览 */
            MOCK.apps.forEach(function (app) { APP.appLabels[app.pkg] = app.label; });
            APP.apps = mergeAppList(packages, APP.config.rules, APP.appLabels);
            renderAppList();
        } else {
            /* 真机：一次 ksu.getPackagesInfo 取全部标签；无该桥则只显示包名（禁止逐项 fork 应用查询） */
            scheduleAppLabelEnrichment(packages);
        }
    } catch (e) {
        APP.appsLoading = false;
        APP.apps = mergeAppList([], APP.config.rules, APP.appLabels);
        renderAppList();
        toast('检测应用列表失败：' + (e && e.message ? e.message : e), 'warn', 3000);
    }
}

/* ============================================================
 * 12.5 应用名：KSU WebView 桥 ksu.getPackagesInfo（一次性）
 *   - 特性检测，不存在时只显示包名
 *   - requestIdleCallback + generation 守卫，切页可取消
 *   - 绝不逐项 fork pm 查询（会卡死配置页）
 * ============================================================ */
var appLabelGeneration = 0;

function normalizePackageInfoResult(raw) {
    var list = raw;
    if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch (e) { list = null; }
    }
    if (list && !Array.isArray(list) && Array.isArray(list.packages)) list = list.packages;
    if (list && !Array.isArray(list) && Array.isArray(list.data)) list = list.data;
    if (!Array.isArray(list)) return {};
    var labels = {};
    list.forEach(function (item) {
        if (!item) return;
        if (typeof item === 'string') { if (isValidPackage(item)) labels[item] = ''; return; }
        var pkg = str(item.packageName || item.package || item.pkg || item.name);
        var label = str(item.appLabel || item.label || item.appName || item.nonLocalizedLabel);
        if (!pkg || !isValidPackage(pkg)) return;
        if (label) labels[pkg] = label.slice(0, 60);
        else if (!(pkg in labels)) labels[pkg] = '';
    });
    return labels;
}

function supportsPackageInfoBridge() {
    return typeof ksu !== 'undefined' && ksu && typeof ksu.getPackagesInfo === 'function';
}

function scheduleAppLabelEnrichment(packages) {
    appLabelGeneration += 1;
    var generation = appLabelGeneration;
    var pending = (packages || []).filter(function (pkg) { return !APP.appLabels[pkg]; });
    if (!pending.length) return;
    var start = function () {
        if (generation !== appLabelGeneration) return; /* 刷新/切页后取消 */
        if (APP.tab !== 'config') return;
        if (!supportsPackageInfoBridge()) return;      /* 无桥：只显示包名 */
        enrichAppLabelsViaBridge(pending, generation);
    };
    setTimeout(start, 600);
}

function enrichAppLabelsViaBridge(packages, generation) {
    var labelPromise;
    try {
        labelPromise = ksu.getPackagesInfo(JSON.stringify(packages));
    } catch (e) {
        return;
    }
    Promise.resolve(labelPromise).then(function (raw) {
        if (generation !== appLabelGeneration || APP.tab !== 'config') return;
        var labels = normalizePackageInfoResult(raw);
        var changed = false;
        Object.keys(labels).forEach(function (pkg) {
            if (labels[pkg] && APP.appLabels[pkg] !== labels[pkg]) {
                APP.appLabels[pkg] = labels[pkg];
                changed = true;
            }
        });
        if (!changed) return;
        var installed = APP.apps.filter(function (app) { return app.installed !== false; }).map(function (app) { return app.pkg; });
        APP.apps = mergeAppList(installed, APP.config.rules, APP.appLabels);
        renderAppList();
    }).catch(function () { /* 桥调用失败：保留包名 */ });
}

async function loadConfig(options) {
    options = options || {};
    if (APP.configLoading) return;
    APP.configLoading = true;
    try {
        var out = await runCommand(CMD.readConfig(), { timeout: 15000 });
        if (out.indexOf('Error:') === 0) {
            APP.config = { global: 0, rules: [] };
            setConfigNotice('未能读取 config/采样率.txt（可能尚未创建），已载入默认模板，保存后会创建。', 'warn');
        } else {
            APP.config = parseConfigText(out);
            setConfigNotice('');
        }
        APP.configDirty = false;
        APP.configLoaded = true;
        updateGlobalDefault();
        updateRulesCount();
        updateConfigWarnings();
        if (!APP.appsLoaded) await loadInstalledApps();
        else mergeAppsWithRules();
        if (options.after && typeof options.after === 'function') options.after();
    } finally {
        APP.configLoading = false;
    }
}

/* v4.2：配置页没有保存按钮，所有修改防抖 200ms 后实时生效 */
var configApplyTimer = null;
var configApplying = false;
var configApplyQueued = false;

function scheduleConfigApply() {
    if (configApplyTimer) clearTimeout(configApplyTimer);
    configApplyTimer = setTimeout(function () {
        configApplyTimer = null;
        applyConfigNow();
    }, CONFIG_APPLY_DEBOUNCE);
}

function setConfigResult(message, kind) {
    var result = $('save-result');
    if (!result) return;
    if (!message) { result.hidden = true; return; }
    result.hidden = false;
    result.textContent = message;
    result.className = 'inline-result' + (kind === 'err' ? ' is-err' : (kind === 'ok' ? ' is-ok' : ''));
}

async function applyConfigNow() {
    if (configApplying) { configApplyQueued = true; return; }
    configApplying = true;
    try {
        var errors = validateConfig(APP.config);
        if (errors.length) {
            setConfigResult('配置有误：' + errors[0].message, 'err');
            toast('配置有误，未写入', 'err');
            return;
        }
        var text = buildConfigText(APP.config.global, APP.config.rules);
        var b64 = utf8ToBase64(text);
        if (!b64) { toast('配置编码失败', 'err'); return; }
        await runCommand(CMD.writeConfig(b64), { timeout: 25000 });
        var readBack = await runCommand(CMD.readConfig(), { timeout: 15000 });
        var ok = String(readBack).indexOf('Error:') !== 0 && configTextEquals(readBack, text);
        if (!ok) {
            await runCommand(CMD.writeConfigFallback(b64), { timeout: 25000 });
            readBack = await runCommand(CMD.readConfig(), { timeout: 15000 });
            ok = configTextEquals(readBack, text);
        }
        if (!ok) {
            setConfigResult('写入校验失败，请到日志页收集诊断。', 'err');
            toast('保存失败：写入校验不一致', 'err', 3600);
            return;
        }
        var reload = await runCommand(CMD.reload(), { timeout: 20000 });
        APP.configDirty = false;
        updateRulesCount();
        if (hasSentinel(reload, '__HUP_OK__')) {
            setConfigResult('已生效 ✓ 配置已写入并热重载', 'ok');
            await sleep(150);
            await refreshStatus();
            await pollConfigApplied();
        } else {
            setConfigResult('配置已写入，但热重载失败（守护进程可能未运行）', 'err');
            toast('已写入，但热重载失败', 'warn', 3200);
        }
        await sleep(200);
        await refreshStatus();
    } catch (e) {
        toast('配置保存失败：' + (e && e.message ? e.message : e), 'err', 3600);
    } finally {
        configApplying = false;
        if (configApplyQueued) {
            configApplyQueued = false;
            scheduleConfigApply();
        }
    }
}

/* ============================================================
 * 13. 日志页：一键收集诊断 + 分享 + 清空 + 原始日志（开发者）
 * ============================================================ */
function diagFailReason(reason) {
    var value = String(reason || '').trim();
    if (!value || value === 'archive_failed') return '打包失败（zip/tar 均不可用）';
    if (/dir|write|unwritable|permission|denied/i.test(value)) return '输出目录不可写';
    if (/script|missing|not_found/i.test(value)) return '诊断脚本缺失';
    if (/tmp/i.test(value)) return '临时目录不可写';
    return value;
}

async function collectDiag() {
    var btn = $('btn-collect-diag');
    await withBusy(btn, '收集打包中…（约数十秒）', async function () {
        var out = String(await runCommand(CMD.collectDiag(), { timeout: 180000 }) || '');
        var okMatch = out.match(/__DIAG_OK__:(\S+)(?:\s+size=(\d+))?/);
        var failMatch = out.match(/__DIAG_FAIL__:([^\r\n]*)/);
        var result = $('diag-result');
        if (okMatch) {
            APP.diagPath = okMatch[1];
            var size = Number(okMatch[2] || 0);
            if (result) result.hidden = false;
            setText('diag-path', APP.diagPath);
            setText('diag-hint', '已生成：' + APP.diagPath + (size > 0 ? ' · ' + formatPaidBytes(size) : ''));
            toast('诊断包已生成', 'ok');
            var share = await confirmDialog({
                title: '诊断包已生成',
                message: '路径：\n' + APP.diagPath + (size > 0 ? '\n大小：' + formatPaidBytes(size) : '') + '\n\n是否立即分享给开发者？',
                confirmText: '分享', cancelText: '关闭'
            });
            if (share) await shareDiag(APP.diagPath);
            return;
        }
        var reason = failMatch ? diagFailReason(failMatch[1]) : '未识别到诊断脚本输出';
        if (result) result.hidden = true;
        setText('diag-path', '—');
        setText('diag-hint', '生成失败：' + reason + '。可手动运行：su -c "sh /data/adb/modules/gt8pro_touch/bin/collect_diag.sh"');
        toast('诊断包生成失败：' + reason, 'err', 4600);
    });
}

async function shareDiag(path) {
    var target = path || APP.diagPath;
    if (!target) { toast('请先生成诊断包', 'warn'); return; }
    var out = await runCommand(CMD.shareDiag(target), { timeout: 15000 });
    toast(hasSentinel(out, '__SHARE_OK__') ? '已打开分享面板' : '分享失败（文件管理器可能不可用）', hasSentinel(out, '__SHARE_OK__') ? 'ok' : 'err');
}

async function actionClearLog() {
    var ok = await confirmDialog({ title: '清空日志', message: '将清空 config/daemon.log 全部内容，用于重新开始记录。', confirmText: '清空', danger: true });
    if (!ok) return;
    var btn = $('btn-clear-log');
    await withBusy(btn, '清空中…', async function () {
        var out = await runCommand(CMD.clearLog(), { timeout: 15000 });
        toast(hasSentinel(out, '__CLEARED__') ? '日志已清空' : '清空失败', hasSentinel(out, '__CLEARED__') ? 'ok' : 'err');
        await loadRawLog();
    });
}

async function loadRawLog() {
    if (APP.logLoading) return;
    APP.logLoading = true;
    try {
        var out = await runCommand(CMD.tail(), { timeout: 20000 });
        var node = $('raw-log-pre');
        if (node) node.textContent = stripSentinels(out) || '（日志为空）';
        var lines = String(out || '').replace(/\r\n?/g, '\n').split('\n').filter(function (line) { return line.trim() !== ''; });
        setText('raw-log-meta', '共 ' + lines.length + ' 行 · 加载于 ' + timeLine());
    } finally {
        APP.logLoading = false;
    }
}

/* ============================================================
 * 14. 付费用户页 v5（api.sh 桥：账号 / 授权 / 购买 / 卡密 / 租约 / 组件下载）
 * ============================================================ */
function b64urlEncode(text) {
    return utf8ToBase64(String(text == null ? '' : text)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomRequestNonce() {
    var rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    return ('nonce-' + rand + '-' + Math.random().toString(36).slice(2, 8)).slice(0, 60);
}

function paidParseJson(raw, label) {
    var text = String(raw == null ? '' : raw).trim();
    if (text.indexOf('Error:') === 0) throw new Error(text.replace(/^Error:\s*/, ''));
    if (!text) throw new Error((label || '接口') + '无响应');
    try {
        var obj = JSON.parse(text);
        if (!obj || typeof obj !== 'object') throw new Error('bad json');
        return obj;
    } catch (e) {
        throw new Error((label || '接口') + '响应格式错误');
    }
}

async function paidRunJson(cmd, label) {
    var raw = await runCommand(cmd, { timeout: API_TIMEOUT });
    var obj = paidParseJson(raw, label);
    if (obj.success === false || obj.error) throw new Error(obj.message || obj.error || (label || '请求') + '失败');
    return obj;
}

async function persistPaidRefreshToken(token) {
    var next = String(token || '').trim();
    if (!next) return;
    var auth = APP.paid.auth || {};
    if (auth.token_present === 1 && !auth.username && !auth.user_id) return;
    try {
        await paidRunJson(CMD.paidSaveAccount(b64urlEncode(JSON.stringify({
            username: auth.username || '',
            user_id: String(auth.user_id || ''),
            token: next
        }))), '保存登录令牌');
        APP.paid.auth.token_present = 1;
    } catch (e) { /* silent：refresh token 保存失败不打断 */ }
}

async function paidApi(method, path, options) {
    options = options || {};
    var payload = '';
    if (method === 'POST') {
        payload = options.form
            ? String(options.formBody == null ? '' : options.formBody)
            : JSON.stringify(options.json || {});
    }
    var raw = await runCommand(CMD.apiRequest(
        method, path, options.auth === true, payload ? b64urlEncode(payload) : '',
        options.nonce ? randomRequestNonce() : '', options.form === true
    ), { timeout: API_TIMEOUT });
    var resp = paidParseJson(raw, '授权服务');
    if (resp.refresh_token) await persistPaidRefreshToken(resp.refresh_token);
    if (resp.success === false || resp.error) {
        var message = String(resp.message || resp.error || '请求失败');
        if (/访问令牌无效|令牌无效|未登录|请先登录/.test(message)) await clearPaidSession(true);
        throw new Error(message);
    }
    return resp;
}

function paidData(resp) {
    if (resp && resp.data != null) return resp.data;
    return resp || {};
}

function paidArray(data, key) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data[key])) return data[key];
    return [];
}

function paidLoggedIn() {
    var a = APP.paid.auth || {};
    return a.account === 'logged_in' || a.token_present === 1;
}

function paidDevicePayload() {
    var d = APP.paid.device || {};
    return {
        device_id: d.device_id || '',
        sn: d.sn || d.device_id || '',
        imei1: d.imei1 || '',
        imei2: d.imei2 || '',
        device_id_hash: d.device_id_hash || '',
        device_model: d.device_model || '',
        soc_model: d.soc_model || '',
        build_fingerprint: d.build_fingerprint || '',
        base_version: String(d.base_version || ABOUT_VERSION || WEBUI_VERSION || '').replace(/^v/i, ''),
        kernel: String(d.kernel || ''),
        backend: 'hbp',
        channel: 'stable'
    };
}

function paidDeviceQuery() {
    var p = paidDevicePayload();
    return 'device_id=' + encodeURIComponent(p.device_id) +
        '&sn=' + encodeURIComponent(p.sn) +
        '&imei1=' + encodeURIComponent(p.imei1) +
        '&imei2=' + encodeURIComponent(p.imei2) +
        '&device_id_hash=' + encodeURIComponent(p.device_id_hash) +
        '&device_model=' + encodeURIComponent(p.device_model) +
        '&soc_model=' + encodeURIComponent(p.soc_model) +
        '&build_fingerprint=' + encodeURIComponent(p.build_fingerprint) +
        '&base_version=' + encodeURIComponent(p.base_version) +
        '&kernel=' + encodeURIComponent(p.kernel) +
        '&backend=' + encodeURIComponent(p.backend) +
        '&channel=' + encodeURIComponent(p.channel);
}

async function refreshPaidState(options) {
    options = options || {};
    try {
        var auth = paidParseJson(await runCommand(CMD.paidAuthState(), { timeout: 30000 }), '授权状态');
        var device = paidParseJson(await runCommand(CMD.paidDeviceInfo(), { timeout: 30000 }), '设备信息');
        var premium = paidParseJson(await runCommand(CMD.paidPremiumState(), { timeout: 30000 }), '付费组件状态');
        APP.paid.auth = auth;
        APP.paid.device = device;
        APP.paid.premium = premium;
        if (auth.entitlement) {
            APP.paid.entitlement = {
                status: auth.entitlement,
                license_last4: auth.license_last4 || '',
                device_bound: auth.device_bound === 1,
                features: Array.isArray(auth.features) ? auth.features : []
            };
        }
        APP.paid.lastRefresh = Date.now();
        renderPaidPage();
        updatePaidNotice();
        return true;
    } catch (e) {
        if (!options.silent) setText('paid-premium-status', '检测失败：' + (e && e.message ? e.message : e));
        return false;
    }
}

async function clearPaidSession(silent) {
    try { await runCommand(CMD.paidClearAccount(), { timeout: 20000 }); } catch (e) { /* ignore */ }
    APP.paid.auth = { account: 'none', token_present: 0, entitlement: 'unknown' };
    APP.paid.entitlement = null;
    APP.paid.licenses = [];
    APP.paid.orders = [];
    APP.paid.order = null;
    if (!silent) toast('已退出登录', 'ok');
    renderPaidPage();
    updatePaidNotice();
}

async function paidValidateToken() {
    if (!paidLoggedIn()) return false;
    try {
        await paidApi('GET', 'user.php?action=validate_token', { auth: true });
        return true;
    } catch (e) {
        return false;
    }
}

/* ---------- 授权同步（v5.18：SignedLease claims.expires_at + 顺序重试） ---------- */
function normalizeSignedLease(data, localDeviceHash) {
    var lease = data && typeof data === 'object' ? data : {};
    if (lease && lease.lease && typeof lease.lease === 'object') lease = lease.lease;
    var claims = lease.claims && typeof lease.claims === 'object' ? lease.claims : null;
    var expiresAt = '';
    if (claims) expiresAt = String(claims.expires_at || claims.expiresAt || '');
    if (!expiresAt) expiresAt = String(lease.expires_at || lease.expiresAt || '');
    if (!expiresAt) throw new Error('租约响应缺少 claims.expires_at');
    var algorithm = String(lease.algorithm || lease.alg || '');
    if (!algorithm) throw new Error('租约响应缺少 algorithm');
    if (!lease.payload) throw new Error('租约响应缺少 payload');
    if (!lease.signature) throw new Error('租约响应缺少 signature');
    if (!claims) claims = { expires_at: expiresAt };
    var deviceHash = String(claims.device_id_hash || lease.device_id_hash || '');
    if (!deviceHash) throw new Error('租约响应缺少 device_id_hash');
    var expected = localDeviceHash != null ? String(localDeviceHash) : String((APP.paid.device && APP.paid.device.device_id_hash) || '');
    if (expected && deviceHash !== expected) throw new Error('租约设备哈希不匹配');
    return { lease: lease, claims: claims, expiresAt: expiresAt };
}

/* 时间解析：兼容 epoch（秒/毫秒）、ISO、`YYYY-MM-DD HH:mm:ss`、带时区字符串 */
function dateTimeToMillis(value) {
    if (typeof value === 'number' && isFinite(value)) return value < 1e12 ? value * 1000 : value;
    var text = String(value == null ? '' : value).trim();
    if (!text) return 0;
    if (/^\d+$/.test(text)) {
        var numeric = Number(text);
        return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    var parsed = Date.parse(text);
    if (!isNaN(parsed)) return parsed;
    var match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
        return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10),
            parseInt(match[4] || '0', 10), parseInt(match[5] || '0', 10), parseInt(match[6] || '0', 10)).getTime();
    }
    return 0;
}

function formatLeaseExpiry(value) {
    var ms = dateTimeToMillis(value);
    if (!ms) return '—';
    var date = new Date(ms);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
        ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function latestLicenseMeta(licenses, localDeviceHash) {
    var list = (licenses || []).filter(function (item) { return item && typeof item === 'object'; });
    if (!list.length) return null;
    var expected = localDeviceHash != null ? String(localDeviceHash) : String((APP.paid.device && APP.paid.device.device_id_hash) || '');
    var active = list.filter(function (item) {
        var status = String(item.status || '').toLowerCase();
        if (status === 'revoked' || status === 'disabled') return false;
        if (item.can_use_premium === false) return false;
        return status === 'active';
    });
    if (!active.length) return null;
    var hashOf = function (item) {
        return String(item.device_id_hash || (item.device && item.device.device_id_hash) || '');
    };
    var matched = expected ? active.filter(function (item) { return hashOf(item) === expected; }) : [];
    var pool = matched.length ? matched : active;
    pool = pool.slice().sort(function (a, b) {
        var timeA = Number(a.bound_at_ms || 0) || dateTimeToMillis(a.bound_at || a.activated_at || a.created_at || a.issued_at || '');
        var timeB = Number(b.bound_at_ms || 0) || dateTimeToMillis(b.bound_at || b.activated_at || b.created_at || b.issued_at || '');
        if (timeA !== timeB) return timeB - timeA;
        return Number(b.id || b.license_id || 0) - Number(a.id || a.license_id || 0);
    });
    var latest = pool[0];
    var cardKey = String(latest.card_key || latest.key || '');
    return {
        key_last4: String(latest.key_last4 || latest.license_last4 || (cardKey ? cardKey.slice(-4) : '')),
        license_id: latest.id != null ? latest.id : (latest.license_id != null ? latest.license_id : ''),
        binding_id: latest.binding_id != null ? latest.binding_id : '',
        status: String(latest.status || ''),
        device_model: String(latest.device_model || ''),
        device_id_hash: hashOf(latest),
        bound_at: String(latest.bound_at || '')
    };
}

async function refreshLicensesMeta() {
    if (!paidLoggedIn()) return null;
    try {
        var resp = await paidApi('GET', 'v1/touch/licenses', { auth: true });
        var list = paidArray(paidData(resp), 'licenses');
        APP.paid.licenses = list;
        var meta = latestLicenseMeta(list);
        APP.paid.licenseMetaLoaded = true;
        APP.paid.licenseMeta = meta;
        return meta;
    } catch (e) {
        return null;
    }
}

async function saveEntitlementCache() {
    var ent = APP.paid.entitlement || {};
    var meta = APP.paid.licenseMeta;
    var auth = APP.paid.auth || {};
    var status = String(ent.status || auth.entitlement || 'unknown');
    var loaded = !!APP.paid.licenseMetaLoaded;
    /* 只用选中的 active license；确实加载过 licenses 且没有 active 时清空尾号 */
    var last4 = meta ? String(meta.key_last4 || '') : (loaded ? '' : String(ent.license_last4 || auth.license_last4 || ''));
    var licenseId = meta ? (meta.license_id != null ? meta.license_id : '') : (loaded ? '' : (auth.license_id != null ? auth.license_id : ''));
    var bindingId = meta ? (meta.binding_id != null ? meta.binding_id : '') : (loaded ? '' : (auth.binding_id != null ? auth.binding_id : ''));
    var bound = !!((meta && meta.binding_id) || ent.device_bound || auth.device_bound === 1 || status === 'active' || status === 'grace');
    var cache = {
        entitlement: status,
        license_last4: last4,
        device_bound: bound ? 1 : 0,
        license_id: licenseId,
        binding_id: bindingId
    };
    try {
        await runCommand(CMD.paidSaveEntitlement(b64urlEncode(JSON.stringify(cache))), { timeout: 20000 });
    } catch (e) { /* ignore */ }
    return cache;
}

async function refreshServerEntitlement(options) {
    options = options || {};
    if (!paidLoggedIn()) return null;
    try {
        var resp = await paidApi('GET', 'v1/touch/entitlement?' + paidDeviceQuery(), { auth: true });
        var data = paidData(resp);
        var status = String(data.status || data.entitlement || 'unknown');
        var meta = APP.paid.licenseMeta || {};
        var last4 = String(data.license_last4 || (data.license && data.license.key_last4) || meta.key_last4 || (APP.paid.auth && APP.paid.auth.license_last4) || '');
        APP.paid.entitlement = {
            status: status,
            license_last4: last4,
            device_bound: !!(data.device_bound || (data.license && data.license.bound) || status === 'active' || status === 'grace'),
            features: paidArray(data.features)
        };
        if (!options.skipSave) await saveEntitlementCache();
        return APP.paid.entitlement;
    } catch (e) {
        return null;
    }
}

async function refreshLease(silent) {
    if (!paidLoggedIn()) return null;
    try {
        var resp = await paidApi('POST', 'v1/touch/licenses/lease', {
            auth: true, nonce: true, json: paidDevicePayload()
        });
        var data = paidData(resp);
        var normalized = normalizeSignedLease(data);
        await runCommand(CMD.paidSaveLease(b64urlEncode(JSON.stringify(normalized.lease))), { timeout: 20000 });
        await refreshPaidState({ silent: true });
        if (!silent) toast('租约已续期', 'ok');
        return normalized;
    } catch (e) {
        if (!silent) toast('续租失败：' + (e && e.message ? e.message : e), 'err', 3600);
        return null;
    }
}

function setPaymentSyncStatus(message) {
    var overlay = $('payment-overlay');
    if (overlay && !overlay.hidden) setPaymentLiveStatus(message);
}

async function syncPaidAuthorization(options) {
    options = options || {};
    if (!paidLoggedIn()) return { ok: false, error: '未登录' };
    APP.paid.syncing = true;
    APP.paid.syncError = '';
    if (options.payment) setPaymentSyncStatus('支付成功，授权已到账，正在获取租约…');
    renderPaidPage();
    try {
        /* 1) entitlement */
        APP.paid.licenseMeta = null;
        APP.paid.licenseMetaLoaded = false;
        await refreshServerEntitlement({ skipSave: true });
        /* 2) licenses（最新 key_last4 / license_id / binding_id） */
        await refreshLicensesMeta();
        /* 3) lease（失败最多重试 3 次，间隔 1.5s） */
        var leaseResult = null;
        var lastErr = null;
        for (var attempt = 1; attempt <= 3; attempt++) {
            var result = await refreshLease(true);
            if (result) { leaseResult = result; break; }
            lastErr = new Error('租约尚未生效');
            if (attempt < 3) await sleep(1500);
        }
        /* 4) auth_state 读取 + 写 state + 再刷新一次展示 */
        await refreshPaidState({ silent: true });
        await saveEntitlementCache();
        await refreshPaidState({ silent: true });
        var auth = APP.paid.auth || {};
        var entitled = auth.entitlement === 'active' || auth.entitlement === 'grace';
        var ok = entitled && Number(auth.lease_valid) === 1;
        if (!APP.paid.entitlement || !APP.paid.entitlement.license_last4) {
            APP.paid.entitlement = Object.assign({}, APP.paid.entitlement || {}, {
                license_last4: auth.license_last4 || (APP.paid.licenseMeta && APP.paid.licenseMeta.key_last4) || ''
            });
        }
        APP.paid.syncError = ok ? '' : (lastErr ? (lastErr.message || String(lastErr)) : (auth.entitlement === 'active' ? '租约待同步' : '授权状态未同步'));
        return { ok: ok, auth: auth, lease: leaseResult, error: APP.paid.syncError };
    } catch (e) {
        APP.paid.syncError = e && e.message ? e.message : String(e);
        return { ok: false, error: APP.paid.syncError };
    } finally {
        APP.paid.syncing = false;
        renderPaidPage();
        updatePaidNotice();
    }
}

async function ensureLeaseFresh(silent) {
    if (!paidLoggedIn()) return;
    var a = APP.paid.auth || {};
    var status = a.entitlement;
    if (status !== 'active' && status !== 'grace') return;
    var remaining = Number(a.lease_remaining_seconds || 0);
    if (a.lease_valid !== 1 || remaining < PAID_LEASE_RENEW_SECONDS) {
        await refreshLease(silent !== false);
    }
}

async function loadPaidTab() {
    await refreshPaidState({ silent: true });
    await paidValidateToken();
    await syncPaidAuthorization({ silent: true });
}

/* ---------- 页面渲染 ---------- */
function paidEntitled() {
    var a = APP.paid.auth || {};
    return (a.entitlement === 'active' || a.entitlement === 'grace') && a.lease_valid === 1;
}

function paidEntitlementLabel(ent) {
    if (ent === 'active') return '已授权';
    if (ent === 'grace') return '离线授权（宽限期）';
    if (ent === 'expired') return '已过期';
    if (ent === 'binding_required') return '待绑定';
    if (ent === 'not_purchased') return '未购买';
    return '未授权';
}

/* 购买入口可见性：仅明确未购买/被撤销时显示；已授权（含租约过期但 entitlement active）隐藏 */
function paidPurchaseVisible(auth) {
    var a = auth || APP.paid.auth || {};
    var status = String(a.entitlement || '');
    if (status === 'active' || status === 'grace') return false;
    if (Number(a.lease_valid) === 1) return false;
    return status === 'not_purchased' || status === 'revoked' || status === 'unknown' || status === '' || status === 'none';
}

function paidStatusSummary(auth) {
    var a = auth || APP.paid.auth || {};
    var status = String(a.entitlement || 'unknown');
    var days = Number(a.lease_days_left || 0);
    var leaseValid = Number(a.lease_valid) === 1;
    if (status === 'active') {
        if (leaseValid && days > 0) return '已授权 · 单机永久 · 租约剩余 ' + days + ' 天';
        if (String(a.lease_expires_at || '')) return '已授权 · 单机永久 · 租约已过期，请续租';
        if (APP.paid.syncing) return '已授权 · 单机永久 · 正在获取租约…';
        if (APP.paid.syncError) return '已授权 · 单机永久 · 租约待同步，点「刷新授权」重试';
        return '已授权 · 单机永久 · 租约待同步，点「刷新授权」重试';
    }
    if (status === 'grace') return '离线授权（宽限期）' + (days > 0 ? ' · 剩余 ' + days + ' 天' : '') + (leaseValid ? '' : ' · 租约待同步');
    if (status === 'expired') return '授权已过期，请续租';
    if (status === 'revoked') return '授权已被撤销';
    if (status === 'not_purchased') return '未购买授权';
    if (status === 'binding_required') return '需要绑定设备';
    return '未授权';
}

function applyPurchaseVisibility() {
    var visible = paidPurchaseVisible();
    ['paid-purchase-section', 'paid-purchase-label'].forEach(function (id) {
        var node = $(id);
        if (node) node.hidden = !visible;
    });
    var buy = $('btn-paid-buy');
    if (buy) buy.hidden = !visible;
    var checkBtn = $('btn-paid-check-order');
    if (checkBtn) checkBtn.hidden = !(APP.paid.order && APP.paid.order.status !== 'paid');
}

function renderPaidAccount() {
    var node = $('paid-account-card');
    if (!node) return;
    var a = APP.paid.auth || {};
    var logged = paidLoggedIn();
    var html = '<div class="paid-card-title"><strong>' + (logged ? '已登录' : '账号') + '</strong>' +
        '<span class="paid-tag ' + (logged ? 'ok' : '') + '">' + (logged ? '已登录' : '未登录') + '</span></div>';
    if (logged) {
        html += '<div class="paid-kv"><span>用户名</span><b>' + escapeHtml(a.username || '—') + '</b></div>';
        html += '<div class="paid-kv"><span>UID</span><b>' + escapeHtml(String(a.user_id || '—')) + '</b></div>';
        html += '<div class="paid-actions"><button type="button" class="btn btn-secondary" data-paid-action="logout">退出登录</button></div>';
    } else {
        html += '<p class="paid-hint">登录慕容调度账号后购买授权、找回卡密与下载付费组件。</p>';
        html += '<div class="paid-actions"><button type="button" class="btn btn-primary" data-paid-action="login">登录</button>' +
            '<button type="button" class="btn btn-secondary" data-paid-action="register">注册</button></div>';
    }
    node.innerHTML = html;
}

function renderPaidEntitlement() {
    var node = $('paid-entitlement-card');
    if (!node) return;
    var a = APP.paid.auth || {};
    var ent = a.entitlement || 'unknown';
    var logged = paidLoggedIn();
    var html = '<div class="paid-card-title"><strong>授权状态</strong><span class="paid-tag ' +
        (ent === 'active' || ent === 'grace' ? 'ok' : (ent === 'expired' || ent === 'revoked' ? 'err' : '')) + '">' +
        escapeHtml(paidEntitlementLabel(ent)) + '</span></div>';
    html += '<div class="paid-kv"><span>状态说明</span><b>' + escapeHtml(paidStatusSummary(a)) + '</b></div>';
    if (ent === 'active' || ent === 'grace') {
        var leaseValid = a.lease_valid === 1;
        var days = Number(a.lease_days_left || 0);
        var meta = APP.paid.licenseMeta || {};
        var last4 = a.license_last4 || meta.key_last4 || '';
        var syncing = !!APP.paid.syncing;
        html += '<div class="paid-kv"><span>卡密尾号</span><b>' + escapeHtml(last4 || '—') + '</b></div>';
        html += '<div class="paid-kv"><span>绑定设备</span><b>' + escapeHtml(a.device_model || '本机') + '</b></div>';
        html += '<div class="paid-kv"><span>租约到期</span><b>' + escapeHtml(formatLeaseExpiry(a.lease_expires_at) || (syncing ? '正在获取…' : '—')) + '</b></div>';
        html += '<div class="paid-kv"><span>剩余天数</span><b>' + (leaseValid ? (days + ' 天') : (syncing ? '正在获取…' : '待同步')) + '</b></div>';
        if (Array.isArray(a.features) && a.features.length) {
            html += '<div class="paid-kv"><span>功能</span><b>' + escapeHtml(a.features.join('、')) + '</b></div>';
        }
        if (!leaseValid) {
            html += '<p class="paid-hint">授权已到账，正在自动获取租约；若长时间未更新，点「刷新授权」重试。</p>';
        }
        html += '<div class="paid-actions"><button type="button" class="btn btn-primary" data-paid-action="renew-lease">续租</button>' +
            '<button type="button" class="btn btn-secondary" data-paid-action="refresh-auth">刷新授权</button></div>';
    } else if (logged) {
        if (ent === 'expired') {
            html += '<p class="paid-hint">租约已过期：点「续租」恢复；也可输入新卡密激活。</p>';
            html += '<div class="paid-actions"><button type="button" class="btn btn-primary" data-paid-action="renew-lease">续租</button></div>';
        } else {
            html += '<p class="paid-hint">已有卡密可直接激活；未购买可点下方「购买授权」。</p>';
        }
        html += '<div class="paid-input-row"><input id="paid-card-key" class="input" type="text" placeholder="输入卡密（如 SPK-XXXX-XXXX-XXXX）" autocomplete="off" spellcheck="false"><button type="button" class="btn btn-primary" data-paid-action="activate">激活</button></div>';
        html += '<div class="paid-actions"><button type="button" class="btn btn-secondary" data-paid-action="refresh-auth">刷新授权</button></div>';
    } else {
        html += '<p class="paid-hint">请先登录账号，再购买授权或输入卡密激活。</p>';
        html += '<div class="paid-actions"><button type="button" class="btn btn-primary" data-paid-action="login">登录</button></div>';
    }
    if (APP.isMock) {
        html += '<div class="paid-actions"><button type="button" class="btn btn-secondary" data-paid-action="mock-expire">模拟过期</button>' +
            '<button type="button" class="btn btn-secondary" data-paid-action="mock-restore">模拟恢复</button></div>';
    }
    node.innerHTML = html;
}

function paidPremiumText() {
    var p = APP.paid.premium || {};
    if (p.installed === 1) {
        return '已安装' + (p.version ? ' ' + p.version : '') + (p.sha256 ? ' · ' + String(p.sha256).slice(0, 8) : '');
    }
    return '未安装（购买授权后可下载）';
}

function renderPaidPage() {
    renderPaidAccount();
    renderPaidEntitlement();
    applyPurchaseVisibility();
    var premiumText = paidPremiumText();
    setText('paid-premium-status', premiumText);
    var premiumRow = $('paid-premium-status');
    if (premiumRow) premiumRow.style.color = (APP.paid.premium && APP.paid.premium.installed === 1) ? 'var(--ok)' : '';
    var checkBtn = $('btn-paid-check-order');
    if (checkBtn) checkBtn.hidden = !(APP.paid.order && APP.paid.order.status !== 'paid');
    setText('paid-order-hint', APP.paid.order && APP.paid.order.order_no ? ('订单号 ' + APP.paid.order.order_no + ' · 支付后自动确认') : '支付完成后会自动确认');
    renderHeader();
}

function updatePaidNotice() {
    var node = $('paid-notice');
    if (!node) return;
    var p = APP.paid.premium || {};
    var a = APP.paid.auth || {};
    var message = '';
    if (p.installed !== 1) {
        message = '未安装付费组件：请到用户页登录、购买授权并下载付费组件。';
    } else if (!paidEntitled()) {
        if (a.entitlement === 'expired' || a.entitlement === 'revoked') {
            message = '授权已过期：请到用户页续租以恢复采样率切换。';
        } else if (a.entitlement === 'active' || a.entitlement === 'grace') {
            message = '授权已到账：正在同步租约，可到用户页点「刷新授权」。';
        } else {
            message = '未授权：请到用户页购买/激活卡密并续租。';
        }
    }
    if (!message) { node.hidden = true; return; }
    node.hidden = false;
    node.innerHTML = '<b>付费组件提示：</b>' + escapeHtml(message) +
        ' <span class="paid-tag">去用户页</span>';
}

/* ---------- 弹层 ---------- */
function closePaidOverlay() {
    var overlay = $('paid-overlay');
    if (overlay) overlay.hidden = true;
    APP.paid.overlayBusy = false;
    closePaidOverlayActions = null;
}

var closePaidOverlayActions = null;

function showPaidOverlay(title, bodyHtml, actions) {
    var overlay = $('paid-overlay');
    if (!overlay) return;
    setText('paid-overlay-title', title || '提示');
    var body = $('paid-overlay-body');
    if (body) body.innerHTML = bodyHtml || '';
    var actionsNode = $('paid-overlay-actions');
    if (actionsNode) {
        actionsNode.innerHTML = '';
        (actions || []).forEach(function (action) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn ' + (action.className || 'btn-primary');
            btn.textContent = action.label || '确定';
            if (action.disabled) btn.disabled = true;
            btn.addEventListener('click', function () { if (action.onClick) action.onClick(); });
            actionsNode.appendChild(btn);
        });
    }
    overlay.hidden = false;
}

function setPaidOverlayBody(html) {
    var body = $('paid-overlay-body');
    if (body) body.innerHTML = html;
}

function showPaidForm(title, fields, submitLabel, onSubmit, extraActions) {
    var body = '<div class="paid-form">';
    fields.forEach(function (field) {
        body += '<label>' + escapeHtml(field.label) +
            '<input id="' + field.id + '" class="input" type="' + (field.type || 'text') + '" placeholder="' +
            escapeHtml(field.placeholder || '') + '" autocomplete="off" spellcheck="false"></label>';
    });
    body += '</div><p class="paid-hint" id="paid-form-hint"></p>';
    var actions = [{ label: '取消', className: 'btn-secondary', onClick: closePaidOverlay }];
    actions.push({
        label: submitLabel || '确定',
        className: 'btn-primary',
        onClick: function () {
            var values = {};
            fields.forEach(function (field) {
                var node = $(field.id);
                values[field.id] = node ? node.value.trim() : '';
            });
            var missing = fields.filter(function (field) { return field.required && !values[field.id]; });
            if (missing.length) {
                setText('paid-form-hint', '请填写：' + missing.map(function (f) { return f.label; }).join('、'));
                return;
            }
            onSubmit(values);
        }
    });
    if (extraActions) actions = extraActions.concat(actions);
    showPaidOverlay(title, body, actions);
}

function showPaidPrompt(title, message, placeholder, onSubmit) {
    var body = '<p class="paid-hint">' + escapeHtml(message) + '</p>' +
        '<div class="paid-form"><label>' + escapeHtml(placeholder || '输入') +
        '<input id="paid-prompt-input" class="input" type="text" autocomplete="off"></label></div>';
    showPaidOverlay(title, body, [
        { label: '取消', className: 'btn-secondary', onClick: closePaidOverlay },
        { label: '确定', className: 'btn-primary', onClick: function () {
            var node = $('paid-prompt-input');
            var value = node ? node.value.trim() : '';
            if (!value) { toast('请输入内容', 'warn'); return; }
            onSubmit(value);
        } }
    ]);
}

/* ---------- 登录 / 注册 ---------- */
function showLoginOverlay() {
    showPaidForm('登录', [
        { id: 'paid-login-username', label: '用户名', required: true },
        { id: 'paid-login-password', label: '密码', type: 'password', required: true }
    ], '登录', function (values) {
        doPaidLogin(values['paid-login-username'], values['paid-login-password']);
    }, [{ label: '注册账号', className: 'btn-secondary', onClick: showRegisterOverlay }]);
}

async function doPaidLogin(username, password) {
    if (APP.paid.overlayBusy) return;
    APP.paid.overlayBusy = true;
    setText('paid-form-hint', '正在登录…');
    try {
        var resp = await paidApi('POST', 'user.php?action=login', {
            form: true, formBody: 'username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password)
        });
        var data = paidData(resp);
        if (!data.token) throw new Error(resp.message || '登录失败');
        await paidRunJson(CMD.paidSaveAccount(b64urlEncode(JSON.stringify({
            username: data.username || username,
            user_id: String(data.user_id || ''),
            token: data.token
        }))), '保存登录状态');
        closePaidOverlay();
        toast('登录成功', 'ok');
        await loadPaidTab();
    } catch (e) {
        setText('paid-form-hint', '登录失败：' + (e && e.message ? e.message : e));
        toast('登录失败：' + (e && e.message ? e.message : e), 'err', 3600);
    } finally {
        APP.paid.overlayBusy = false;
    }
}

function showRegisterOverlay() {
    showPaidForm('注册', [
        { id: 'paid-reg-username', label: '用户名', required: true },
        { id: 'paid-reg-password', label: '密码', type: 'password', required: true },
        { id: 'paid-reg-email', label: '邮箱', type: 'email', required: true }
    ], '注册', function (values) {
        doPaidRegister(values['paid-reg-username'], values['paid-reg-password'], values['paid-reg-email']);
    }, [{ label: '返回登录', className: 'btn-secondary', onClick: showLoginOverlay }]);
}

async function doPaidRegister(username, password, email) {
    if (APP.paid.overlayBusy) return;
    APP.paid.overlayBusy = true;
    setText('paid-form-hint', '正在注册…');
    try {
        var resp = await paidApi('POST', 'user.php?action=register', {
            form: true,
            formBody: 'username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password) + '&email=' + encodeURIComponent(email)
        });
        var data = paidData(resp);
        var userId = data.user_id || '';
        APP.paid.overlayBusy = false;
        showPaidPrompt('邮箱验证', '验证码已发送至 ' + email + '，请输入验证码完成注册。', '验证码', async function (code) {
            try {
                var body = userId
                    ? 'user_id=' + encodeURIComponent(String(userId)) + '&verification_code=' + encodeURIComponent(code)
                    : 'email=' + encodeURIComponent(email) + '&verification_code=' + encodeURIComponent(code);
                await paidApi('POST', 'user.php?action=verify_email', { form: true, formBody: body });
                toast('注册成功，请登录', 'ok');
                showLoginOverlay();
            } catch (e) {
                toast('验证失败：' + (e && e.message ? e.message : e), 'err', 3600);
            }
        });
    } catch (e) {
        APP.paid.overlayBusy = false;
        setText('paid-form-hint', '注册失败：' + (e && e.message ? e.message : e));
        toast('注册失败：' + (e && e.message ? e.message : e), 'err', 3600);
    }
}

async function paidLogout() {
    var ok = await confirmDialog({ title: '退出登录', message: '退出后需重新登录才能购买/找回授权；已下载的付费组件不受影响。', confirmText: '退出登录', danger: true });
    if (!ok) return;
    await clearPaidSession(false);
    await refreshPaidState({ silent: true });
    toast('已退出登录', 'ok');
}

/* ---------- 卡密激活 / 续租 ---------- */
async function activatePaidCard(code) {
    code = String(code || '').trim();
    if (!code) { toast('请输入卡密', 'warn'); return; }
    if (!paidLoggedIn()) { showLoginOverlay(); return; }
    try {
        var resp = await paidApi('POST', 'v1/touch/licenses/activate', {
            auth: true, nonce: true, json: Object.assign({ card_key: code }, paidDevicePayload())
        });
        var data = paidData(resp);
        var last4 = String(data.key_last4 || data.license_last4 || code.slice(-4));
        APP.paid.entitlement = { status: 'active', license_last4: last4, device_bound: true, features: ['touch_sampling'] };
        await saveEntitlementCache();
        closePaidOverlay();
        toast('激活成功', 'ok');
        await syncPaidAuthorization({});
    } catch (e) {
        toast('激活失败：' + (e && e.message ? e.message : e), 'err', 4200);
    }
}

async function renewPaidLease() {
    if (!paidLoggedIn()) { showLoginOverlay(); return; }
    var result = await syncPaidAuthorization({});
    if (result.ok) {
        var days = Number((APP.paid.auth || {}).lease_days_left || 0);
        toast('租约已续期 · 剩余 ' + days + ' 天', 'ok');
    } else {
        toast('续租失败：' + (result.error || '租约尚未生效'), 'err', 4200);
    }
}

/* ---------- 购买 ---------- */
function paymentMethodName(code) {
    var value = String(code || '').toLowerCase();
    if (value.indexOf('ali') >= 0 || value === 'zfb') return '支付宝';
    return '微信支付';
}

async function showPurchaseOverlay() {
    if (!paidLoggedIn()) {
        showPaidOverlay('登录后购买', '<p class="paid-hint">购买授权需要先登录慕容调度账号；支付成功后会为本机自动发放卡密。</p>', [
            { label: '取消', className: 'btn-secondary', onClick: closePaidOverlay },
            { label: '登录', className: 'btn-primary', onClick: showLoginOverlay }
        ]);
        return;
    }
    showPaidOverlay('购买授权', '<p class="paid-hint">正在读取商品与支付方式…</p>', [{ label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }]);
    try {
        var productResp = await paidApi('GET', 'payment.php?action=products', {});
        var methodResp = await paidApi('GET', 'payment.php?action=payment_methods', {});
        var products = paidArray(paidData(productResp), 'products');
        var methods = paidArray(paidData(methodResp), 'methods').filter(function (m) { return m && m.code; });
        var product = null;
        for (var i = 0; i < products.length; i++) {
            var item = products[i];
            if (String(item.product_code || '') === PAID_PRODUCT_CODE ||
                /触控采样率/.test(String(item.name || '')) ||
                String(item.delivery_type || '').indexOf('touch') === 0) { product = item; break; }
        }
        if (!product) throw new Error('触控采样率商品未上架');
        if (!methods.length) methods = [{ code: 'wechat', name: '微信支付' }, { code: 'alipay', name: '支付宝' }];
        APP.paid.purchase = { product: product, methods: methods, selectedMethod: methods[0].code };
        renderPurchaseOverlay();
    } catch (e) {
        setPaidOverlayBody('<p class="paid-hint">读取商品失败：' + escapeHtml(e && e.message ? e.message : e) + '</p>');
        showPaidOverlay('购买授权', '<p class="paid-hint">读取商品失败：' + escapeHtml(e && e.message ? e.message : e) + '</p>', [
            { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay },
            { label: '重试', className: 'btn-primary', onClick: showPurchaseOverlay }
        ]);
    }
}

function paymentMethodKind(code) {
    var value = String(code || '').toLowerCase();
    return value.indexOf('ali') >= 0 || value === 'zfb' ? 'alipay' : 'wechat';
}

function paymentMethodLabel(code) {
    return paymentMethodKind(code) === 'alipay' ? '支付宝' : '微信支付';
}

function formatPayAmount(value) {
    var n = Number(value);
    return isFinite(n) ? n.toFixed(2) : '0.00';
}

function paymentQrDataUri() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">' +
        '<rect width="220" height="220" fill="#FFFFFF"/>' +
        '<g fill="#111111">' +
        '<rect x="18" y="18" width="46" height="46"/><rect x="156" y="18" width="46" height="46"/>' +
        '<rect x="18" y="156" width="46" height="46"/>' +
        '<rect x="28" y="28" width="26" height="26" fill="#FFFFFF"/>' +
        '<rect x="166" y="28" width="26" height="26" fill="#FFFFFF"/>' +
        '<rect x="28" y="166" width="26" height="26" fill="#FFFFFF"/>' +
        '<rect x="78" y="18" width="12" height="12"/><rect x="100" y="18" width="12" height="12"/>' +
        '<rect x="122" y="18" width="12" height="12"/><rect x="78" y="40" width="12" height="12"/>' +
        '<rect x="112" y="40" width="12" height="12"/><rect x="134" y="52" width="12" height="12"/>' +
        '<rect x="78" y="62" width="12" height="12"/><rect x="100" y="62" width="12" height="12"/>' +
        '<rect x="18" y="78" width="12" height="12"/><rect x="40" y="78" width="12" height="12"/>' +
        '<rect x="62" y="78" width="12" height="12"/><rect x="84" y="78" width="12" height="12"/>' +
        '<rect x="106" y="78" width="12" height="12"/><rect x="128" y="78" width="12" height="12"/>' +
        '<rect x="150" y="78" width="12" height="12"/><rect x="172" y="78" width="12" height="12"/>' +
        '<rect x="194" y="78" width="12" height="12"/><rect x="18" y="100" width="12" height="12"/>' +
        '<rect x="52" y="100" width="12" height="12"/><rect x="84" y="100" width="12" height="12"/>' +
        '<rect x="116" y="100" width="12" height="12"/><rect x="148" y="100" width="12" height="12"/>' +
        '<rect x="180" y="100" width="12" height="12"/><rect x="30" y="122" width="12" height="12"/>' +
        '<rect x="62" y="122" width="12" height="12"/><rect x="94" y="122" width="12" height="12"/>' +
        '<rect x="126" y="122" width="12" height="12"/><rect x="158" y="122" width="12" height="12"/>' +
        '<rect x="190" y="122" width="12" height="12"/><rect x="18" y="144" width="12" height="12"/>' +
        '<rect x="50" y="144" width="12" height="12"/><rect x="82" y="144" width="12" height="12"/>' +
        '<rect x="114" y="144" width="12" height="12"/><rect x="146" y="144" width="12" height="12"/>' +
        '<rect x="178" y="144" width="12" height="12"/><rect x="78" y="166" width="12" height="12"/>' +
        '<rect x="110" y="166" width="12" height="12"/><rect x="142" y="166" width="12" height="12"/>' +
        '<rect x="174" y="166" width="12" height="12"/><rect x="78" y="188" width="12" height="12"/>' +
        '<rect x="122" y="188" width="12" height="12"/><rect x="166" y="188" width="12" height="12"/>' +
        '</g></svg>';
    return 'data:image/svg+xml;base64,' + utf8ToBase64(svg);
}

function paymentQrSrc(method) {
    if (isMockMode()) return paymentQrDataUri();
    return PAYMENT_ASSET_URL + '?type=' + paymentMethodKind(method);
}

function renderPurchaseOverlay() {
    var p = APP.paid.purchase || {};
    var product = p.product || {};
    var methods = p.methods || [];
    var selected = p.selectedMethod || (methods[0] && methods[0].code) || 'wechat';
    var html = '<div class="paid-kv"><span>商品</span><b>' + escapeHtml(product.name || '慕容触控采样率 授权（单机永久）') + '</b></div>';
    html += '<div class="paid-kv"><span>价格</span><b>3 元起 · 单机永久</b></div>';
    html += '<p class="paid-hint">实际支付金额以下单后的支付弹层为准，请在弹层内核对大字金额。支付成功后卡密自动绑定本机，无需手动输入。</p>';
    html += '<div class="paid-method" id="paid-methods">';
    methods.forEach(function (m) {
        html += '<button type="button" data-paid-method="' + escapeHtml(m.code) + '"' +
            (m.code === selected ? ' class="active"' : '') + '>' + escapeHtml(m.name || paymentMethodLabel(m.code)) + '</button>';
    });
    html += '</div>';
    showPaidOverlay('购买授权', html, [
        { label: '取消', className: 'btn-secondary', onClick: closePaidOverlay },
        { label: '创建订单并支付', className: 'btn-primary', onClick: function () { createPaidOrder(); } }
    ]);
    document.querySelectorAll('#paid-methods [data-paid-method]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            APP.paid.purchase.selectedMethod = btn.dataset.paidMethod;
            document.querySelectorAll('#paid-methods [data-paid-method]').forEach(function (b) {
                b.classList.toggle('active', b === btn);
            });
        });
    });
}

function rememberPaidOrder(order) {
    try { sessionStorage.setItem('gt8_paid_order_v1', JSON.stringify(order)); } catch (e) { /* ignore */ }
}

async function createPaidOrder() {
    var p = APP.paid.purchase || {};
    var product = p.product || {};
    if (!product.id) { toast('商品信息缺失', 'err'); return; }
    showPaidOverlay('正在创建订单', '<p class="paid-hint">正在创建订单并锁定应付金额，请稍候…</p>', [{ label: '取消', className: 'btn-secondary', onClick: closePaidOverlay }]);
    try {
        var contact = (APP.paid.auth && (APP.paid.auth.username || APP.paid.auth.user_id)) || 'module-webui';
        var body = 'product_id=' + encodeURIComponent(String(product.id)) +
            '&payment_method=' + encodeURIComponent(p.selectedMethod || 'wechat') +
            '&contact_info=' + encodeURIComponent(String(contact)) +
            '&order_kind=' + encodeURIComponent('touch') +
            '&device_info=' + encodeURIComponent(JSON.stringify(Object.assign({ client: 'module-webui', order_kind: 'touch' }, paidDevicePayload())));
        var resp = await paidApi('POST', 'payment.php?action=create_order', { auth: true, form: true, formBody: body });
        var data = paidData(resp);
        if (!data.order_no) throw new Error(resp.message || '订单响应缺少订单号');
        var payAmount = data.pay_amount != null ? Number(data.pay_amount) : Number(product.price || 3);
        APP.paid.order = {
            order_no: String(data.order_no),
            order_access_token: String(data.order_access_token || data.order_token || data.access_token || ''),
            pay_amount: isFinite(payAmount) ? payAmount : Number(product.price || 3),
            expired_at: String(data.expired_at || ''),
            status: 'pending',
            product_name: String(product.name || '慕容触控采样率 授权'),
            payment_method: p.selectedMethod || 'wechat'
        };
        rememberPaidOrder(APP.paid.order);
        closePaidOverlay();
        openPaymentOverlay();
        renderPaymentOrder(APP.paid.order);
        startPaymentPolling();
    } catch (e) {
        showPaidOverlay('创建订单失败', '<p class="paid-hint">' + escapeHtml(e && e.message ? e.message : e) + '</p>', [
            { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay },
            { label: '重试', className: 'btn-primary', onClick: showPurchaseOverlay }
        ]);
    }
}

/* ---------- WebUI 内支付弹层（照显示模块 payment-sheet） ---------- */
function openPaymentOverlay() {
    var overlay = $('payment-overlay');
    if (overlay) overlay.hidden = false;
}

function closePaymentOverlay() {
    var overlay = $('payment-overlay');
    if (overlay) overlay.hidden = true;
    stopPaymentPolling();
}

function setPaymentLiveStatus(message, state) {
    var node = $('payment-live-status');
    if (!node) return;
    node.className = 'payment-live-status' + (state === 'success' ? ' success' : state === 'error' ? ' error' : '');
    var text = $('payment-live-text');
    if (text) text.textContent = message;
}

/* ---------- 微信支付实例发现（照慕容调度 parseWeChatPayTargets / discoverWeChatPayTargets） ---------- */
function parseUserIdsFromOutput(text) {
    var ids = [];
    var source = String(text == null ? '' : text);
    var re = /UserInfo\{(\d+):/g;
    var match;
    while ((match = re.exec(source)) !== null) {
        var id = parseInt(match[1], 10);
        if (isFinite(id) && id >= 0 && ids.indexOf(id) < 0) ids.push(id);
    }
    ids.sort(function (a, b) { return a - b; });
    return ids;
}

function wechatTargetLabel(userId, cloneCount) {
    if (userId === 0) return '微信';
    if (cloneCount === 1) return '微信（分身）';
    return '微信（分身 ' + userId + '）';
}

function parseWechatTargets(userListOutput, installedUserIds) {
    var installed = (installedUserIds || []).map(function (id) { return parseInt(id, 10); });
    var ids = parseUserIdsFromOutput(userListOutput).filter(function (id) {
        return installed.indexOf(id) >= 0;
    });
    var cloneCount = ids.filter(function (id) { return id !== 0; }).length;
    return ids.map(function (id) {
        return { userId: id, id: id, label: wechatTargetLabel(id, cloneCount) };
    });
}

function shouldShowWechatSelector(targets) {
    return (targets || []).length > 1;
}

function rememberedWechatUser() {
    try {
        var raw = localStorage.getItem(WECHAT_USER_STORAGE_KEY);
        var id = parseInt(raw, 10);
        return isFinite(id) && id >= 0 ? id : null;
    } catch (e) { return null; }
}

function rememberWechatUser(userId) {
    try { localStorage.setItem(WECHAT_USER_STORAGE_KEY, String(parseInt(userId, 10))); } catch (e) { /* ignore */ }
}

async function checkWechatUserInstalled(userId) {
    try {
        var out = await runCommand(CMD.checkWechatUser(userId), { timeout: 8000 });
        return hasSentinel(out, '__INSTALLED__');
    } catch (e) {
        return false;
    }
}

async function loadWechatTargets() {
    var usersOut = '';
    try {
        usersOut = await runCommand(CMD.listUsers(), { timeout: 12000 });
    } catch (e) {
        return { ok: false, targets: [], error: e && e.message ? e.message : '读取用户失败' };
    }
    if (!usersOut || String(usersOut).indexOf('Error:') === 0) {
        return { ok: false, targets: [], error: '读取用户失败' };
    }
    var userIds = parseUserIdsFromOutput(usersOut);
    if (!userIds.length) return { ok: false, targets: [], error: '未解析到用户' };
    var installed = [];
    for (var i = 0; i < userIds.length; i++) {
        if (await checkWechatUserInstalled(userIds[i])) installed.push(userIds[i]);
    }
    return { ok: true, targets: parseWechatTargets(usersOut, installed) };
}

function selectedWechatTarget() {
    var targets = APP.paid.wechatTargets || [];
    if (!targets.length) return null;
    var selected = APP.paid.wechatSelected;
    for (var i = 0; i < targets.length; i++) {
        if (targets[i].userId === selected) return targets[i];
    }
    return targets[0];
}

function renderWechatSelector() {
    var node = $('payment-wechat-selector');
    if (!node) return;
    var targets = APP.paid.wechatTargets || [];
    if (!shouldShowWechatSelector(targets)) {
        node.hidden = true;
        node.innerHTML = '';
        return;
    }
    var selected = selectedWechatTarget();
    var selectedId = selected ? selected.userId : null;
    node.hidden = false;
    var html = '<div class="payment-wechat-title">支付微信</div><div class="payment-wechat-users" role="group" aria-label="支付微信实例">';
    targets.forEach(function (target) {
        html += '<button type="button" class="payment-wechat-user' + (target.userId === selectedId ? ' active' : '') +
            '" data-wechat-user="' + target.userId + '">' +
            '<span class="payment-wechat-name">' + escapeHtml(target.label) + '</span>' +
            '<span class="payment-wechat-uid">用户 ' + target.userId + '</span></button>';
    });
    html += '</div>';
    node.innerHTML = html;
    node.querySelectorAll('[data-wechat-user]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = parseInt(btn.dataset.wechatUser, 10);
            if (!isFinite(id)) return;
            APP.paid.wechatSelected = id;
            rememberWechatUser(id);
            renderWechatSelector();
            updatePaymentActionsForOrder(APP.paid.order);
        });
    });
}

function updatePaymentActionsForOrder(order) {
    order = order || APP.paid.order || {};
    var kind = paymentMethodKind(order.payment_method);
    var amount = formatPayAmount(order.pay_amount);
    var actions = [{ label: '关闭', className: 'btn-secondary', onClick: closePaymentOverlay }];
    if (kind === 'alipay') {
        actions.push({ label: '打开支付宝 · ¥' + amount, className: 'btn-primary', onClick: function () { launchPaymentApp('alipay'); } });
    } else {
        var targets = APP.paid.wechatTargets || [];
        var target = selectedWechatTarget();
        if (!targets.length) {
            actions.push({ label: '未检测到微信，请扫码支付', className: 'btn-secondary', disabled: true });
        } else {
            actions.push({
                label: '打开' + (target ? target.label : '微信支付') + ' · ¥' + amount,
                className: 'btn-primary',
                onClick: function () { launchPaymentApp('wechat'); }
            });
        }
    }
    if (APP.isMock) {
        actions.push({ label: '模拟支付成功', className: 'btn-secondary', onClick: function () { mockForcePaymentSuccess(); } });
    }
    renderPaymentActions(actions);
}

async function discoverWechatForPayment(order) {
    APP.paid.wechatGeneration = (APP.paid.wechatGeneration || 0) + 1;
    var generation = APP.paid.wechatGeneration;
    renderPaymentActions([{ label: '关闭', className: 'btn-secondary', onClick: closePaymentOverlay },
        { label: '检测微信实例…', className: 'btn-primary', disabled: true }]);
    var result = await loadWechatTargets();
    if (generation !== APP.paid.wechatGeneration) return;
    if (!APP.paid.order || !order || APP.paid.order.order_no !== order.order_no) return;
    APP.paid.wechatTargets = result.targets || [];
    var remembered = rememberedWechatUser();
    var selected = null;
    APP.paid.wechatTargets.forEach(function (target) {
        if (remembered !== null && target.userId === remembered) selected = target.userId;
    });
    if (selected === null && APP.paid.wechatTargets.length) selected = APP.paid.wechatTargets[0].userId;
    APP.paid.wechatSelected = selected;
    renderWechatSelector();
    updatePaymentActionsForOrder(order);
}

function renderPaymentOrder(order) {
    order = order || APP.paid.order || {};
    var kind = paymentMethodKind(order.payment_method || (APP.paid.purchase && APP.paid.purchase.selectedMethod));
    var methodText = paymentMethodLabel(order.payment_method);
    var amount = formatPayAmount(order.pay_amount);
    APP.paid.wechatTargets = [];
    APP.paid.wechatSelected = null;
    var html = '<div class="payment-price-row">' +
        '<span class="payment-price" id="payment-amount"><small>¥</small>' + escapeHtml(amount) + '</span>' +
        '<span class="payment-permanent">单机永久 · 一机一码</span></div>';
    html += '<p class="payment-amount-warn">系统唯一金额，请按此金额支付，多付/少付无法自动发卡</p>';
    html += '<div class="payment-order-meta">' +
        '<div class="payment-order-line"><span>支付方式</span><strong>' + escapeHtml(methodText) + '</strong></div>' +
        '<div class="payment-order-line"><span>订单号</span><strong>' + escapeHtml(order.order_no || '—') + '</strong></div>' +
        '<div class="payment-order-line"><span>有效期</span><strong>' + escapeHtml(order.expired_at || '以服务端为准') + '</strong></div>' +
        '</div>';
    if (kind === 'wechat') {
        html += '<div id="payment-wechat-selector" class="payment-wechat-selector" hidden></div>';
    }
    html += '<div class="payment-qr-wrap"><img class="payment-qr" id="payment-qr" src="' + escapeHtml(paymentQrSrc(kind)) + '" alt="' + escapeHtml(methodText) + '收款码"></div>';
    html += '<div id="payment-live-status" class="payment-live-status"><span class="payment-spinner"></span><span id="payment-live-text">等待到账，页面会自动确认并发放卡密</span></div>';
    var body = $('payment-body');
    if (body) body.innerHTML = html;
    setText('payment-title', '等待支付');
    if (kind === 'wechat') {
        discoverWechatForPayment(order);
    } else {
        updatePaymentActionsForOrder(order);
    }
}

function renderPaymentActions(actions) {
    var node = $('payment-actions');
    if (!node) return;
    node.innerHTML = '';
    (actions || []).forEach(function (action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn ' + (action.className || 'btn-secondary');
        btn.textContent = action.label || '确定';
        if (action.disabled) btn.disabled = true;
        btn.addEventListener('click', function () { if (action.onClick && !action.disabled) action.onClick(); });
        node.appendChild(btn);
    });
}

function launchPaymentApp(kind) {
    var normalized = kind === 'alipay' ? 'alipay' : 'wechat';
    var cmd;
    var label;
    if (normalized === 'alipay') {
        cmd = CMD.payAlipay();
        label = '支付宝';
    } else {
        var target = selectedWechatTarget();
        if (!target) {
            toast('未检测到微信实例，请扫描上方二维码支付', 'warn', 3200);
            return;
        }
        cmd = CMD.payWechat(target.userId);
        label = target.label;
    }
    runCommand(cmd, { timeout: 20000 }).then(function (out) {
        if (hasSentinel(out, '__OPEN_OK__')) toast('已尝试拉起' + label, 'ok', 2200);
        else toast('无法启动' + label + '付款，请扫描上方二维码', 'warn', 3200);
    }).catch(function () {
        toast('拉起支付 App 失败，请扫描上方二维码', 'warn', 3200);
    });
}

function mockForcePaymentSuccess() {
    if (!APP.isMock) return;
    var st = mockPaidState();
    st.orderPolls = 9;
    checkPaidOrder();
}

function startPaymentPolling() {
    stopPaymentPolling();
    APP.paid.polling = true;
    APP.paid.pollCount = 0;
    checkPaidOrder();
    APP.paid.pollTimer = setInterval(function () {
        if (!APP.paid.polling) return;
        APP.paid.pollCount = (APP.paid.pollCount || 0) + 1;
        if (APP.paid.pollCount > 60) {
            stopPaymentPolling();
            setPaymentLiveStatus('订单长时间未到账，请检查后重新购买', 'error');
            return;
        }
        checkPaidOrder();
    }, 3000);
}

function stopPaymentPolling() {
    APP.paid.polling = false;
    if (APP.paid.pollTimer) { clearInterval(APP.paid.pollTimer); APP.paid.pollTimer = null; }
}

async function checkPaidOrder() {
    var order = APP.paid.order;
    if (!order || !order.order_no) { toast('没有待确认的订单', 'warn'); return; }
    if (APP.paid.orderChecking) return;
    APP.paid.orderChecking = true;
    try {
        var query = 'order_no=' + encodeURIComponent(order.order_no) +
            '&order_access_token=' + encodeURIComponent(order.order_access_token || '');
        var resp = await paidApi('GET', 'payment.php?action=order_status&' + query, {});
        var data = paidData(resp);
        var status = String(data.status || 'pending').toLowerCase();
        order.status = status;
        if (status === 'paid') {
            stopPaymentPolling();
            var cardKey = String((data.payment_data && data.payment_data.card_key) || data.card_key || '');
            try { sessionStorage.removeItem('gt8_paid_order_v1'); } catch (e) { /* ignore */ }
            setPaymentSyncStatus('支付成功，授权已到账，正在获取租约…');
            var syncResult = await syncPaidAuthorization({ payment: true });
            try { await refreshStatus(); } catch (e2) { /* 静默 */ }
            renderPaymentSuccess(cardKey, syncResult);
            renderPaidPage();
        } else if (status === 'expired' || status === 'cancelled' || status === 'delivery_failed') {
            stopPaymentPolling();
            renderPaymentFailure(status);
            toast('支付未完成', 'err', 3200);
        } else {
            setPaymentLiveStatus('等待到账，页面会自动确认并发放卡密');
        }
    } catch (e) {
        setPaymentLiveStatus('网络暂时不可用，正在自动重试');
    } finally {
        APP.paid.orderChecking = false;
    }
}

function copyTextToClipboard(text) {
    var value = String(text || '');
    if (!value) return;
    var fallback = function () {
        try {
            var area = document.createElement('textarea');
            area.value = value;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            document.body.removeChild(area);
            toast('卡密已复制', 'ok', 2200);
        } catch (e) {
            toast('复制失败，请长按卡密手动复制', 'warn', 3000);
        }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(function () { toast('卡密已复制', 'ok', 2200); }, fallback);
    } else {
        fallback();
    }
}

function renderPaymentSuccess(cardKey, syncResult) {
    syncResult = syncResult || {};
    setText('payment-title', '支付成功');
    var auth = APP.paid.auth || {};
    var days = Number(auth.lease_days_left || 0);
    var last4 = auth.license_last4 || (APP.paid.licenseMeta && APP.paid.licenseMeta.key_last4) || '';
    var statusText = syncResult.ok
        ? ('已绑定本机 · 租约剩余 ' + days + ' 天' + (last4 ? ' · 卡密尾号 ' + last4 : ''))
        : '授权已到账，正在获取租约…（会自动重试，也可点「刷新授权」）';
    var keyHtml = '<div class="payment-license-row"><code id="payment-card-key" class="payment-license-key">' +
        escapeHtml(cardKey || '卡密已绑定到当前账号') + '</code>' +
        (cardKey ? '<button type="button" class="btn btn-small btn-secondary" data-copy-card>复制</button>' : '') +
        '</div>';
    var html = '<div class="payment-success-hero"><span class="payment-check">✓</span>' +
        '<span class="payment-success-title">授权已发放并绑定本机</span></div>' +
        keyHtml + '<p class="payment-hint">' + escapeHtml(statusText) + '；购买入口已隐藏，可在「我的」中下载付费组件。</p>';
    var body = $('payment-body');
    if (body) body.innerHTML = html;
    var copyBtn = body && body.querySelector('[data-copy-card]');
    if (copyBtn) copyBtn.addEventListener('click', function () { copyTextToClipboard(cardKey); });
    var actions = [];
    if (cardKey) actions.push({ label: '复制卡密', className: 'btn-secondary', onClick: function () { copyTextToClipboard(cardKey); } });
    if (!syncResult.ok) actions.push({ label: '刷新授权', className: 'btn-secondary', onClick: function () {
        syncPaidAuthorization({ payment: true }).then(function (next) { renderPaymentSuccess(cardKey, next); });
    } });
    actions.push({ label: '完成', className: 'btn-primary', onClick: function () {
        closePaymentOverlay();
        renderPaidPage();
    } });
    renderPaymentActions(actions);
}

function renderPaymentFailure(status) {
    setText('payment-title', '支付未完成');
    var reason = status === 'expired' ? '订单已超时' : status === 'cancelled' ? '订单已取消' : '支付已确认，但卡密交付失败';
    var html = '<p class="payment-hint">' + escapeHtml(reason) + '，未发放授权。</p>';
    var body = $('payment-body');
    if (body) body.innerHTML = html;
    renderPaymentActions([
        { label: '关闭', className: 'btn-secondary', onClick: closePaymentOverlay },
        { label: '重新购买', className: 'btn-primary', onClick: function () {
            closePaymentOverlay();
            APP.paid.order = null;
            showPurchaseOverlay();
        } }
    ]);
}

/* ---------- 我的卡密 / 订单 / 下载组件 ---------- */
function paidListOverlay(title, items, renderItem, emptyText) {
    var html = '<div class="paid-list">';
    if (!items.length) html += '<p class="paid-hint">' + escapeHtml(emptyText || '暂无数据') + '</p>';
    items.forEach(function (item) {
        html += '<div class="paid-list-item">' + renderItem(item) + '</div>';
    });
    html += '</div>';
    showPaidOverlay(title, html, [{ label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }]);
}

/* ---------- 我的卡密（v5.18：仅展示，无解绑/删除按钮） ---------- */
function licenseStatusLabel(status) {
    var value = String(status || '').toLowerCase();
    if (value === 'active') return '已激活';
    if (value === 'unused' || value === 'not_used' || value === 'available' || value === 'unbound') return '未使用';
    if (value === 'revoked') return '已吊销';
    if (value === 'disabled') return '已禁用';
    if (value === 'expired') return '已过期';
    return status ? String(status) : '未知';
}

function maskCardNumber(item) {
    var full = String((item && (item.card_key || item.key || item.card)) || '');
    if (full) {
        var parts = full.split('-');
        if (parts.length >= 4) return parts.slice(0, 2).join('-') + '-****-' + parts[parts.length - 1];
        return full.length > 8 ? full.slice(0, 4) + '****' + full.slice(-4) : full;
    }
    var last4 = String((item && (item.key_last4 || item.license_last4)) || '');
    return last4 ? 'MTC-****-****-' + last4 : '—';
}

async function showMyLicenses() {
    if (!paidLoggedIn()) { showLoginOverlay(); return; }
    showPaidOverlay('我的卡密', '<p class="paid-hint">正在读取…</p>', [
        { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }
    ]);
    try {
        var resp = await paidApi('GET', 'v1/touch/licenses', { auth: true });
        APP.paid.licenses = paidArray(paidData(resp), 'licenses');
        var html = '<div class="paid-license-list">';
        if (!APP.paid.licenses.length) html += '<p class="paid-hint">暂无卡密，购买授权后会自动发放</p>';
        APP.paid.licenses.forEach(function (item) {
            var status = String(item.status || '').toLowerCase();
            var tagClass = status === 'active' ? 'ok' : (status === 'revoked' || status === 'disabled' ? 'err' : '');
            var meta = [];
            if (item.device_model || (item.device && item.device.model)) meta.push('绑定设备 ' + String(item.device_model || item.device.model));
            if (item.bound_at || item.created_at) meta.push('时间 ' + formatLeaseExpiry(item.bound_at || item.created_at));
            html += '<div class="paid-license-item">' +
                '<div class="paid-license-head"><strong>' + escapeHtml(maskCardNumber(item)) + '</strong>' +
                '<span class="paid-tag ' + tagClass + '">' + escapeHtml(licenseStatusLabel(item.status)) + '</span></div>' +
                '<div class="paid-license-meta">' + (meta.length ? escapeHtml(meta.join(' · ')) : '未绑定设备') + '</div>' +
                '</div>';
        });
        html += '</div>';
        setPaidOverlayBody(html);
        var actionsNode = $('paid-overlay-actions');
        if (actionsNode) {
            actionsNode.innerHTML = '';
            [{ label: '刷新', className: 'btn-secondary', onClick: showMyLicenses },
             { label: '关闭', className: 'btn-primary', onClick: closePaidOverlay }].forEach(function (action) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn ' + action.className;
                btn.textContent = action.label;
                btn.addEventListener('click', action.onClick);
                actionsNode.appendChild(btn);
            });
        }
    } catch (e) {
        showPaidOverlay('我的卡密', '<p class="paid-hint">读取失败：' + escapeHtml(e && e.message ? e.message : e) + '</p>', [
            { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }
        ]);
    }
}

async function showMyOrders() {
    if (!paidLoggedIn()) { showLoginOverlay(); return; }
    showPaidOverlay('我的订单', '<p class="paid-hint">正在读取…</p>', [{ label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }]);
    try {
        var resp = await paidApi('GET', 'payment.php?action=my_orders', { auth: true });
        var data = paidData(resp);
        APP.paid.orders = paidArray(data, 'orders');
        paidListOverlay('我的订单', APP.paid.orders, function (item) {
            return '<strong>' + escapeHtml(item.order_no || '—') + '</strong><small>' +
                escapeHtml(String(item.status || 'unknown') + ' · ¥' + Number(item.pay_amount || 0).toFixed(2) + (item.product_name ? ' · ' + item.product_name : '')) + '</small>';
        }, '暂无订单');
    } catch (e) {
        showPaidOverlay('我的订单', '<p class="paid-hint">读取失败：' + escapeHtml(e && e.message ? e.message : e) + '</p>', [{ label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }]);
    }
}

function paidProgressHtml(percent, text, state) {
    return '<div class="paid-progress-line ' + (state || '') + '"><b>' + percent + '%</b><span>' + escapeHtml(text) + '</span></div>';
}

async function downloadPremiumPackage() {
    if (!paidLoggedIn()) { showLoginOverlay(); return; }
    var html = '<div class="paid-progress" id="paid-download-log">' +
        paidProgressHtml(5, '读取付费组件列表…') +
        '</div>';
    showPaidOverlay('下载付费组件', html, [{ label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }]);
    var log = function (pct, text, state) {
        var node = $('paid-download-log');
        if (node) node.insertAdjacentHTML('beforeend', paidProgressHtml(pct, text, state));
    };
    try {
        var pkgResp = await paidApi('GET', 'v1/touch/packages?' + paidDeviceQuery(), { auth: true });
        var packages = paidArray(paidData(pkgResp), 'packages');
        packages = packages.filter(function (p) { return p && p.status !== 'disabled'; });
        if (!packages.length) throw new Error('当前版本/内核不满足组件兼容要求（列表为空）');
        packages.sort(function (a, b) { return Number(b.version_code || 0) - Number(a.version_code || 0); });
        var pkg = packages[0];
        var shaExpected = String(pkg.file_sha256 || pkg.sha256 || '').toLowerCase();
        log(25, '最新版本 ' + (pkg.version || '—') + ' · ' + formatPaidBytes(pkg.file_size || 0));
        var tokenResp = await paidApi('POST', 'v1/touch/packages/' + encodeURIComponent(String(pkg.id)) + '/download-token', {
            auth: true, nonce: true, json: paidDevicePayload()
        });
        var tokenData = paidData(tokenResp);
        var downloadToken = String(tokenData.download_token || tokenData.token || '');
        if (!downloadToken) throw new Error('下载令牌获取失败（可能兼容检查未通过，HTTP 403）');
        log(40, '已获取下载令牌，开始下载…');
        var downloadUrl = String(tokenData.download_url || '');
        var dl = await paidRunJson(CMD.paidDownloadPremium(String(pkg.id), downloadToken, PAID_DOWNLOAD_ZIP, downloadUrl), '下载付费组件');
        log(70, '已下载 ' + formatPaidBytes(dl.size || 0) + '，校验哈希…');
        var expectedSize = Number(pkg.file_size || 0);
        if (expectedSize > 0 && Number(dl.size || 0) !== expectedSize) {
            throw new Error('下载文件大小校验失败（manifest ' + expectedSize + ' B，实际 ' + Number(dl.size || 0) + ' B）');
        }
        var actualSha = String(dl.sha256 || dl.header_sha256 || '').toLowerCase();
        if (shaExpected && actualSha && actualSha !== shaExpected) {
            throw new Error('下载文件 SHA-256 校验不符（manifest ' + shaExpected.slice(0, 12) + '…，实际 ' + actualSha.slice(0, 12) + '…）');
        }
        log(80, '校验通过，安装到模块 bin/…');
        var installed = await paidRunJson(CMD.paidInstallPremium(dl.path || PAID_DOWNLOAD_ZIP), '安装付费组件');
        log(100, '安装成功' + (installed.version ? ' · ' + installed.version : '') + (installed.sha256 ? ' · ' + String(installed.sha256).slice(0, 8) : ''), 'ok');
        APP.paid.premium = { installed: 1, version: installed.version || '', sha256: installed.sha256 || '', path: installed.path || '' };
        try { await refreshPaidState({ silent: true }); } catch (eState) { /* ignore */ }
        try { await refreshStatus(); } catch (eStatus) { /* ignore */ }
        renderPaidPage();
        updatePaidNotice();
        showPaidOverlay('下载付费组件', '<p class="paid-success">付费组件安装成功。</p>' +
            '<div class="paid-kv"><span>版本</span><b>' + escapeHtml(installed.version || '—') + '</b></div>' +
            '<div class="paid-kv"><span>SHA-256</span><b>' + escapeHtml(String(installed.sha256 || '')) + '</b></div>' +
            '<p class="paid-hint">安装后需重启守护进程（或重启手机）生效。</p>', [
            { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay },
            { label: '重启守护进程', className: 'btn-primary', onClick: async function () {
                closePaidOverlay();
                await runCommand(CMD.restart(), { timeout: 30000 });
                toast('已请求重启守护进程', 'ok');
                await refreshStatus();
            } }
        ]);
    } catch (e) {
        log(100, '失败：' + (e && e.message ? e.message : e), 'err');
        showPaidOverlay('下载付费组件', '<p class="paid-hint">下载/安装失败：' + escapeHtml(e && e.message ? e.message : e) + '</p>' +
            '<div class="paid-progress">' + paidProgressHtml(100, '失败', 'err') + '</div>', [
            { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay },
            { label: '重试', className: 'btn-primary', onClick: downloadPremiumPackage }
        ]);
    }
}

function formatPaidBytes(value) {
    var n = Number(value) || 0;
    if (n <= 0) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

/* ---------- 自动续期 ---------- */
async function paidAutoMaintenance() {
    try {
        if (!paidLoggedIn()) return;
        await paidValidateToken();
        await refreshPaidState({ silent: true });
        var a = APP.paid.auth || {};
        var remaining = Number(a.lease_remaining_seconds || 0);
        if ((a.entitlement === 'active' || a.entitlement === 'grace') && (a.lease_valid !== 1 || remaining < PAID_LEASE_RENEW_SECONDS)) {
            await syncPaidAuthorization({ silent: true });
        } else {
            await refreshServerEntitlement();
            await refreshPaidState({ silent: true });
        }
    } catch (e) { /* 静默 */ }
}

/* ---------- 关于二级页（1:1 照慕容调度 AboutMiuix） ---------- */
var ABOUT_REPO_URL = 'https://github.com/murongruyan/murongtouch';
var ABOUT_README_URL = 'https://github.com/murongruyan/murongtouch/blob/main/README.md';
var ABOUT_CHANGELOG_URL = 'https://github.com/murongruyan/murongtouch/releases';
var ABOUT_COOLAPK_DEEPLINK = 'coolmarket://u/5037694';
var ABOUT_COOLAPK_FALLBACK = 'https://www.coolapk.com/u/5037694';
var ABOUT_QQ_URL = 'mqqapi://card/show_pslcard?src_type=internal&version=1&uin=974835379&card_type=group&source=qrcode';
var ABOUT_QQ_NUMBER = '974835379';
var ABOUT_TRAFFIC_URL = 'https://h5.lot-ml.com/ProductEn/Index/beb66e222fcdb4b6';
var ABOUT_DONATE_URL = 'https://qr.alipay.com/fkx19856muvtznqt6onipea';
var ABOUT_UPDATE_JSON_URL = 'https://raw.githubusercontent.com/murongruyan/murongtouch/main/update.json';
var ABOUT_UPDATE_SOURCES = [
    'https://raw.githubusercontent.com/murongruyan/murongtouch/main/update.json',
    'https://ghproxy.net/https://raw.githubusercontent.com/murongruyan/murongtouch/main/update.json',
    'https://cdn.jsdelivr.net/gh/murongruyan/murongtouch@main/update.json'
];

function aboutUpdateSources() {
    var stamp = Math.floor(Date.now() / 1000);
    return [
        ABOUT_UPDATE_SOURCES[0] + '?t=' + stamp,
        ABOUT_UPDATE_SOURCES[1] + '?t=' + stamp,
        ABOUT_UPDATE_SOURCES[2]
    ];
}
var ABOUT_UPDATE_CACHE_KEY = 'gt8pro_about_update_v1';
var ABOUT_UPDATE_CACHE_TTL = 10 * 60 * 1000;
var ABOUT_RELEASES_URL = 'https://github.com/murongruyan/murongtouch/releases';
var ABOUT_AUTHOR = '慕容茹艳（酷安慕容雪绒）';
var ABOUT_VERSION = 'v5.18.0';

function openExternalUrl(url) {
    return new Promise(function (resolve) {
        var target = String(url || '').trim();
        if (!target) { resolve(false); return; }
        if (isMockMode()) {
            toast('预览模式：正式版将用 root am start 打开 ' + target, 'info', 2600);
            resolve(true);
            return;
        }
        runCommand(CMD.openUrl(target), { timeout: 15000 }).then(function (out) {
            resolve(hasSentinel(out, '__OPEN_OK__'));
        }).catch(function () { resolve(false); });
    });
}

function openAboutLink(url, failMessage, fallbackUrl) {
    openExternalUrl(url).then(function (ok) {
        if (ok) return;
        if (fallbackUrl) {
            openExternalUrl(fallbackUrl).then(function (fallbackOk) {
                if (!fallbackOk) toast(failMessage || '无法打开链接', 'warn', 3200);
            });
        } else {
            toast(failMessage || '无法打开链接', 'warn', 3200);
        }
    });
}

function openAboutPage() {
    var page = $('about-page');
    if (!page) return;
    loadAboutInfo().then(function () { refreshAboutUpdateSubtitle(); });
    page.hidden = false;
    page.scrollTop = 0;
    if (document.body) document.body.classList.add('subpage-open');
}

function closeAboutPage() {
    var page = $('about-page');
    if (page) page.hidden = true;
    if (document.body) document.body.classList.remove('subpage-open');
}

async function loadAboutInfo() {
    var version = WEBUI_VERSION;
    var name = '慕容触控采样率';
    try {
        var out = await runCommand(CMD.moduleProp(), { timeout: 12000 });
        var versionMatch = String(out || '').match(/^version=(.+)$/m);
        var nameMatch = String(out || '').match(/^name=(.+)$/m);
        if (versionMatch) version = versionMatch[1].trim();
        if (nameMatch) name = nameMatch[1].trim();
    } catch (e) { /* 使用内置版本 */ }
    ABOUT_VERSION = version;
    setText('about-name', name || '慕容触控采样率');
    setText('about-version', '版本 ' + version);
    setText('about-author', '开发者：' + ABOUT_AUTHOR);
    setText('about-update-text', '当前 ' + version + ' · 点击检查更新');
}

function compareVersionStrings(a, b) {
    var pa = String(a || '').replace(/^v/i, '').split(/[.\-+]/).map(function (part) { return parseInt(part, 10) || 0; });
    var pb = String(b || '').replace(/^v/i, '').split(/[.\-+]/).map(function (part) { return parseInt(part, 10) || 0; });
    var length = Math.max(pa.length, pb.length);
    for (var i = 0; i < length; i++) {
        var left = pa[i] || 0;
        var right = pb[i] || 0;
        if (left !== right) return left > right ? 1 : -1;
    }
    return 0;
}

function aboutReleaseUrl(info) {
    info = info || {};
    var latest = String(info.latest || info.version || '').replace(/^v/i, '');
    var tag = String(info.tag_name || info.tag || (latest ? 'v' + latest : ''));
    if (!tag) return ABOUT_RELEASES_URL;
    return ABOUT_RELEASES_URL + '/tag/' + encodeURIComponent(tag);
}

function readAboutUpdateCache(currentVersion) {
    try {
        var raw = localStorage.getItem(ABOUT_UPDATE_CACHE_KEY);
        if (!raw) return null;
        var data = JSON.parse(raw);
        if (!data || !data.ts || !data.latest) return null;
        if (Date.now() - Number(data.ts) > ABOUT_UPDATE_CACHE_TTL) return null;
        var expected = String(currentVersion || ABOUT_VERSION || WEBUI_VERSION || '');
        if (data.currentVersion && expected && String(data.currentVersion) !== expected) return null;
        return data;
    } catch (e) { return null; }
}

function writeAboutUpdateCache(info) {
    info = info || {};
    try {
        localStorage.setItem(ABOUT_UPDATE_CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            latest: String(info.latest || ''),
            tag_name: String(info.tag_name || ''),
            currentVersion: String(info.currentVersion || ABOUT_VERSION || WEBUI_VERSION || '')
        }));
    } catch (e) { /* ignore */ }
}

function applyAboutUpdateText(current, latest, stale) {
    var text = '当前 ' + current + ' · ';
    if (!latest) {
        text += '点击检查更新（需联网）';
    } else if (compareVersionStrings(latest, current) > 0) {
        text += '发现 v' + latest;
    } else {
        text += '已是最新';
    }
    setText('about-update-text', text);
}

async function fetchAboutUpdate(force) {
    var current = ABOUT_VERSION || WEBUI_VERSION;
    var cached = readAboutUpdateCache(current);
    if (cached && !force) {
        applyAboutUpdateText(current, cached.latest, false);
        return {
            ok: true, latest: cached.latest, tag_name: cached.tag_name || '',
            current: current, cached: true,
            hasNewer: compareVersionStrings(cached.latest, current) > 0
        };
    }
    setText('about-update-text', '当前 ' + current + ' · 正在检查更新…');
    var latest = '';
    var tagName = '';
    var htmlUrl = '';
    var changelog = '';
    var dateText = '';
    var sources = aboutUpdateSources();
    for (var i = 0; i < sources.length; i++) {
        try {
            var raw = String(await runCommand(CMD.updateCheck(sources[i]), { timeout: 12000 }) || '').trim();
            if (!raw || raw.indexOf('__UPDATE_FAIL__') >= 0 || raw.indexOf('Error:') === 0) continue;
            var data = JSON.parse(raw);
            latest = String(data.version || data.latest_version || data.latestVersion || data.tag_name || data.tag || '').replace(/^v/i, '');
            tagName = String(data.tag_name || data.tag || '');
            htmlUrl = String(data.html_url || '');
            changelog = String(data.changelog || data.notes || data.body || data.release_notes || data.description || '');
            dateText = String(data.date || data.published_at || data.updated_at || data.release_date || '');
            if (latest) break;
        } catch (e) { /* 尝试下一个源 */ }
    }
    if (!latest) {
        applyAboutUpdateText(current, '', true);
        return { ok: false, current: current };
    }
    writeAboutUpdateCache({ latest: latest, tag_name: tagName, currentVersion: current });
    applyAboutUpdateText(current, latest, false);
    return {
        ok: true, latest: latest, tag_name: tagName, html_url: htmlUrl,
        changelog: changelog, date: dateText, current: current,
        hasNewer: compareVersionStrings(latest, current) > 0
    };
}

async function refreshAboutUpdateSubtitle() {
    try { await fetchAboutUpdate(false); } catch (e) { /* 静默 */ }
}

function aboutUpdateReleaseUrl(info) {
    info = info || {};
    if (info.html_url && /\/releases/.test(String(info.html_url))) return String(info.html_url);
    return aboutReleaseUrl(info);
}

function aboutUpdateChangelogText(info) {
    info = info || {};
    return String(info.changelog || '').replace(/\r/g, '').trim().slice(0, 1000);
}

function aboutUpdateDateText(info) {
    info = info || {};
    var raw = String(info.date || '').trim();
    if (!raw) return '';
    if (dateTimeToMillis(raw)) return formatLeaseExpiry(raw);
    return raw;
}

var ABOUT_CHANGELOG_SOURCES = [
    'https://raw.githubusercontent.com/murongruyan/murongtouch/main/changelog.md',
    'https://ghproxy.net/https://raw.githubusercontent.com/murongruyan/murongtouch/main/changelog.md',
    'https://cdn.jsdelivr.net/gh/murongruyan/murongtouch@main/changelog.md'
];

function aboutChangelogSources() {
    var stamp = Math.floor(Date.now() / 1000);
    return [
        ABOUT_CHANGELOG_SOURCES[0] + '?t=' + stamp,
        ABOUT_CHANGELOG_SOURCES[1] + '?t=' + stamp,
        ABOUT_CHANGELOG_SOURCES[2]
    ];
}

function stripChangelogMarkdown(markdown, latest) {
    var text = String(markdown || '').replace(/\r/g, '');
    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    text = text.replace(/https?:\/\/\S+/g, '');
    if (latest) {
        var version = String(latest).replace(/^v/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var section = new RegExp('^#{1,6}\\s*v?' + version + '[^\\n]*$', 'im');
        var match = section.exec(text);
        if (match) {
            var rest = text.slice(match.index);
            var next = rest.slice(1).search(/^#{1,6}\s/m);
            if (next > 0) rest = rest.slice(0, next + 1);
            text = rest;
        }
    }
    text = text.replace(/^#{1,6}\s*/gm, '');
    text = text.replace(/^\s{0,3}[-*+]\s+/gm, '· ');
    text = text.replace(/^\s{0,3}>\s?/gm, '');
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/^\s*\|.*\|\s*$/gm, '');
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text.slice(0, 1200);
}

async function fetchAboutChangelogText(latest) {
    var sources = aboutChangelogSources();
    for (var i = 0; i < sources.length; i++) {
        try {
            var raw = String(await runCommand(CMD.updateCheck(sources[i]), { timeout: 12000 }) || '').trim();
            if (!raw || raw.indexOf('__UPDATE_FAIL__') >= 0 || raw.indexOf('Error:') === 0 || raw.charAt(0) === '{') continue;
            var cleaned = stripChangelogMarkdown(raw, latest);
            if (cleaned.length > 20) return { ok: true, text: cleaned, url: sources[i] };
        } catch (e) { /* 尝试下一个源 */ }
    }
    return { ok: false, text: '', url: '' };
}

async function showAboutUpdateDialog() {
    showPaidOverlay('检查更新', '<p class="paid-hint">正在检查更新…</p>', [
        { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }
    ]);
    try { await loadAboutInfo(); } catch (e) { /* 使用内置版本 */ }
    var info = await fetchAboutUpdate(true);
    if (!info.ok) {
        showPaidOverlay('检查更新', '<p class="paid-hint">检查失败，请检查网络后重试</p>', [
            { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay },
            { label: '重试', className: 'btn-primary', onClick: showAboutUpdateDialog }
        ]);
        return;
    }
    var current = info.current || ABOUT_VERSION;
    var hasNewer = compareVersionStrings(String(info.latest || ''), current) > 0;
    var latestDisplay = hasNewer ? info.latest : (compareVersionStrings(String(info.latest || ''), current) === 0 ? info.latest : current);
    var body = '<div class="update-info">' +
        '<div class="paid-kv"><span>当前版本</span><b>v' + escapeHtml(current) + '</b></div>' +
        '<div class="paid-kv"><span>最新版本</span><b>v' + escapeHtml(latestDisplay) + '</b></div>' +
        '<div class="paid-kv"><span>状态</span><b>' + (hasNewer ? '发现新版本' : '已是最新') + '</b></div>' +
        '</div>';
    var actions = [{ label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }];
    if (hasNewer) {
        var changelog = await fetchAboutChangelogText(info.latest);
        if (changelog.text) {
            body += '<div class="update-changelog"><b>更新内容</b><p>' + escapeHtml(changelog.text) + '</p></div>';
        } else {
            var fullLogUrl = /^https?:\/\//.test(String(info.changelog || '')) ? String(info.changelog) : ABOUT_CHANGELOG_URL;
            actions.push({
                label: '查看完整更新日志', className: 'btn-secondary', onClick: function () {
                    openAboutLink(fullLogUrl, '无法打开更新日志');
                }
            });
        }
        var dateText = aboutUpdateDateText(info);
        if (dateText) body += '<p class="paid-hint">发行日期：' + escapeHtml(dateText) + '</p>';
        var updateUrl = aboutUpdateReleaseUrl(info);
        actions.push({
            label: '去更新', className: 'btn-primary', onClick: function () {
                openAboutLink(updateUrl, '无法打开更新发布页');
            }
        });
    }
    showPaidOverlay('检查更新', body, actions);
}

function bindAboutControls() {
    var back = $('btn-about-back');
    if (back) back.addEventListener('click', closeAboutPage);
    var page = $('about-page');
    if (!page) return;
    page.addEventListener('click', function (event) {
        var node = event.target;
        while (node && node !== page && !(node.dataset && node.dataset.aboutAction)) node = node.parentNode;
        if (!node || node === page || !node.dataset) return;
        var action = node.dataset.aboutAction;
        if (action === 'repo') openAboutLink(ABOUT_REPO_URL, '无法打开开源仓库');
        else if (action === 'readme') openAboutLink(ABOUT_README_URL, '无法打开使用说明');
        else if (action === 'changelog') openAboutLink(ABOUT_CHANGELOG_URL, '无法打开更新日志');
        else if (action === 'coolapk') openAboutLink(ABOUT_COOLAPK_DEEPLINK, '无法打开酷安主页', ABOUT_COOLAPK_FALLBACK);
        else if (action === 'qq') openAboutLink(ABOUT_QQ_URL, '无法打开 QQ 群，请加入 QQ 群：' + ABOUT_QQ_NUMBER);
        else if (action === 'traffic') openAboutLink(ABOUT_TRAFFIC_URL, '无法打开流量卡页面');
        else if (action === 'donate') openAboutLink(ABOUT_DONATE_URL, '无法打开打赏页面');
        else if (action === 'update') showAboutUpdateDialog();
    });
}

/* ---------- Mock 付费后端 ---------- */
/* ---------- Mock 付费后端 ---------- */
function mockPaidState() {
    if (!MOCK.paid) {
        MOCK.paid = {
            account: { username: '', user_id: '', token: '' },
            entitlement: 'unknown',
            licenseLast4: '',
            deviceBound: 0,
            licenseId: '',
            bindingId: '',
            lease: null,
            orders: [],
            orderPolls: 0,
            premium: { installed: false, version: '', sha256: '' },
            packages: [{
                id: 1, pkg: 'touch-premium', version: '1.0.0', version_code: 100,
                sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
                file_sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
                file_size: 93472, status: 'active', compatible: true
            }]
        };
    }
    return MOCK.paid;
}

function mockLeaseObject() {
    var issued = Math.floor(Date.now() / 1000);
    var expires = issued + 3 * 24 * 3600;
    var grace = issued + 6 * 24 * 3600;
    return {
        algorithm: 'Ed25519',
        key_id: 'display-lease-2026-08-prod',
        claims: {
            scope: 'touch.sampling', license_id: 2, binding_id: 2, user_id: 3,
            device_id_hash: 'mock-device-hash', features: ['touch_sampling'],
            issued_at: issued, expires_at: expires, grace_until: grace,
            key_id: 'display-lease-2026-08-prod', nonce: 'mock-nonce'
        },
        payload: 'bW9jay1sZWFzZQ',
        signature: 'bW9jay1zaWc'
    };
}

function mockPaidAccountJson() {
    var st = mockPaidState();
    var lease = st.lease || {};
    var claims = lease.claims || {};
    var leaseExpires = claims.expires_at || lease.expires_at || '';
    var leaseFeatures = claims.features || lease.features || [];
    var remaining = 0;
    var days = 0;
    var leaseExpiresMs = dateTimeToMillis(leaseExpires);
    if (leaseExpiresMs) {
        remaining = Math.max(0, Math.floor((leaseExpiresMs - Date.now()) / 1000));
        days = Math.ceil(remaining / 86400);
    }
    return {
        success: true,
        account: st.account.token ? 'logged_in' : 'none',
        username: st.account.username || '',
        user_id: st.account.user_id || '',
        token_present: st.account.token ? 1 : 0,
        entitlement: st.entitlement,
        license_last4: st.licenseLast4,
        device_bound: st.deviceBound ? 1 : 0,
        lease_expires_at: leaseExpires,
        lease_remaining_seconds: remaining,
        lease_days_left: days,
        lease_valid: remaining > 0 ? 1 : 0,
        features: leaseFeatures,
        license_id: st.licenseId || '',
        binding_id: st.bindingId || '',
        device_id: 'mock-device-id',
        device_model: 'RMX5200',
        premium_installed: st.premium.installed ? 1 : 0,
        premium_version: st.premium.version || '',
        premium_sha256: st.premium.sha256 || ''
    };
}

function mockPaidExec(cmd) {
    var c = String(cmd || '');
    var st = mockPaidState();
    var actionMatch = c.match(/api\.sh"\s+([a-z_]+)/);
    var action = actionMatch ? actionMatch[1] : '';
    if (action === 'auth_state') return Promise.resolve(JSON.stringify(mockPaidAccountJson()));
    if (action === 'auth_device_info') {
        return Promise.resolve(JSON.stringify({
            success: true, device_id: 'mock-device-id', sn: 'MOCK-SN-0001', imei1: '000000000000001',
            imei2: '000000000000002', device_id_hash: 'mock-device-hash', device_model: 'RMX5200',
            soc_model: 'SM8850', build_fingerprint: 'realme/RMX5200/mock:17', base_version: 'v5.12', kernel: '6.1.0'
        }));
    }
    if (action === 'premium_state') {
        return Promise.resolve(JSON.stringify({
            success: true, installed: st.premium.installed ? 1 : 0, path: MOD + '/bin/touch_rate_daemon',
            version: st.premium.version || '', sha256: st.premium.sha256 || '', size: st.premium.installed ? 93472 : 0
        }));
    }
    if (action === 'auth_clear_account') {
        st.account = { username: '', user_id: '', token: '' };
        st.entitlement = 'unknown';
        st.licenseLast4 = '';
        st.deviceBound = 0;
        st.lease = null;
        return Promise.resolve('{"success":true}');
    }
    if (action === 'auth_save_account' || action === 'auth_save_lease' || action === 'auth_save_entitlement') {
        var m = c.match(/'([A-Za-z0-9_\-=]+)'|"([A-Za-z0-9_\-=]+)"/g);
        var b64 = '';
        if (m && m.length) b64 = m[m.length - 1].replace(/['"]/g, '');
        var payload = {};
        try {
            var decoded = b64urlDecode(b64);
            payload = JSON.parse(decoded);
        } catch (e) { payload = {}; }
        if (action === 'auth_save_account') {
            st.account = { username: payload.username || '', user_id: String(payload.user_id || ''), token: payload.token || '' };
        } else if (action === 'auth_save_lease') {
            st.lease = payload;
        } else {
            st.entitlement = payload.entitlement || 'unknown';
            st.licenseLast4 = payload.license_last4 || '';
            st.deviceBound = payload.device_bound ? 1 : 0;
            st.licenseId = payload.license_id || st.licenseId || '';
            st.bindingId = payload.binding_id || st.bindingId || '';
        }
        return Promise.resolve('{"success":true}');
    }
    if (action === 'download_premium') {
        return Promise.resolve(JSON.stringify({
            success: true, path: PAID_DOWNLOAD_ZIP, size: 93472,
            sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
        }));
    }
    if (action === 'install_premium') {
        st.premium = { installed: true, version: '1.0.0', sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2' };
        st.entitlement = st.entitlement === 'unknown' ? st.entitlement : st.entitlement;
        return Promise.resolve(JSON.stringify({
            success: true, path: MOD + '/bin/touch_rate_daemon', version: '1.0.0',
            sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
        }));
    }
    if (action === 'api_request') {
        var methodMatch = c.match(/api_request\s+(GET|POST|DELETE)\s+"([^"]*)"/);
        var method = methodMatch ? methodMatch[1] : 'GET';
        var path = methodMatch ? methodMatch[2] : '';
        var payloadB64 = '';
        var pb = c.match(/"(GET|POST|DELETE)"\s+"[^"]*"\s+[01]\s+"([^"]*)"/);
        if (pb) payloadB64 = pb[2];
        var body = '';
        try { body = payloadB64 ? b64urlDecode(payloadB64) : ''; } catch (e) { body = ''; }
        if (path.indexOf('user.php?action=login') >= 0) {
            var username = (body.match(/(?:^|&)username=([^&]*)/) || [])[1] || 'tester';
            username = decodeURIComponent(username);
            st.account = { username: username, user_id: '1001', token: 'mock-token' };
            return Promise.resolve(JSON.stringify({ success: true, data: { username: username, user_id: 1001, token: 'mock-token' } }));
        }
        if (path.indexOf('user.php?action=validate_token') >= 0) {
            return Promise.resolve(st.account.token
                ? JSON.stringify({ success: true, data: { valid: true } })
                : JSON.stringify({ success: false, message: '访问令牌无效或已过期' }));
        }
        if (path.indexOf('user.php?action=register') >= 0) {
            return Promise.resolve(JSON.stringify({ success: true, data: { user_id: 1001 } }));
        }
        if (path.indexOf('user.php?action=verify_email') >= 0) {
            return Promise.resolve(JSON.stringify({ success: true }));
        }
        if (path.indexOf('payment.php?action=products') >= 0) {
            return Promise.resolve(JSON.stringify({ success: true, data: { products: [{
                id: 88, product_code: 'touch_sampling', name: '慕容触控采样率 授权（3元 单机永久）',
                price: 3.0, validity_days: 0, max_devices: 1, delivery_type: 'touch'
            }] } }));
        }
        if (path.indexOf('payment.php?action=payment_methods') >= 0) {
            return Promise.resolve(JSON.stringify({ success: true, data: { methods: [
                { code: 'wechat', name: '微信支付' }, { code: 'alipay', name: '支付宝' }
            ] } }));
        }
        if (path.indexOf('payment.php?action=create_order') >= 0) {
            var order = {
                order_no: 'MOCK' + Date.now().toString().slice(-8),
                order_access_token: 'mock-order-token',
                payment_url: 'https://murongdiaodu.rl1.cc/pay/mock',
                pay_amount: 3.03, expired_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), status: 'pending', product_name: '慕容触控采样率 授权'
            };
            st.orders.push(order);
            st.orderPolls = 0;
            return Promise.resolve(JSON.stringify({ success: true, data: order }));
        }
        if (path.indexOf('payment.php?action=order_status') >= 0) {
            var orderNo = (path.match(/order_no=([^&]*)/) || [])[1] || '';
            st.orderPolls = (st.orderPolls || 0) + 1;
            var existing = null;
            st.orders.forEach(function (o) { if (o.order_no === orderNo) existing = o; });
            if (st.orderPolls >= 2 && st.account.token) {
                if (existing) existing.status = 'paid';
                st.entitlement = 'active';
                st.cardKey = 'MOCK-CARD-0000-0000-3V86';
                st.licenseLast4 = '3V86';
                st.deviceBound = 1;
                st.licenseId = 2;
                st.bindingId = 2;
                st.lease = mockLeaseObject();
                return Promise.resolve(JSON.stringify({ success: true, data: {
                    status: 'paid', payment_data: { card_key: st.cardKey }
                } }));
            }
            return Promise.resolve(JSON.stringify({ success: true, data: { status: 'pending' } }));
        }
        if (path.indexOf('payment.php?action=my_orders') >= 0) {
            return Promise.resolve(JSON.stringify({ success: true, data: { orders: st.orders } }));
        }
        if (path.indexOf('v1/touch/entitlement') >= 0) {
            return Promise.resolve(JSON.stringify({ success: true, data: {
                status: st.entitlement, license_last4: st.licenseLast4,
                license_id: st.licenseId || 2, binding_id: st.bindingId || 2,
                device_bound: !!st.deviceBound, features: st.entitlement === 'active' ? ['touch_sampling'] : []
            } }));
        }
        if (path.indexOf('v1/touch/licenses/activate') >= 0) {
            st.entitlement = 'active';
            st.licenseLast4 = 'CARD';
            st.deviceBound = 1;
            st.licenseId = 2;
            st.bindingId = 2;
            st.lease = mockLeaseObject();
            return Promise.resolve(JSON.stringify({ success: true, data: {
                license_id: 1, key_last4: 'CARD', features: ['touch_sampling']
            } }));
        }
        if (path.indexOf('v1/touch/licenses/lease') >= 0) {
            st.lease = mockLeaseObject();
            return Promise.resolve(JSON.stringify({ success: true, data: st.lease }));
        }
        if (path.indexOf('v1/touch/licenses') >= 0) {
            var list = [
                { id: 1, key_last4: '4GK2', card_key: 'MTC-7UUB-ECWB-EJDT-4GK2', status: 'revoked', bound_at: '2026-10-23 11:28:55' }
            ];
            if (st.licenseLast4) {
                list.unshift({
                    id: 2, license_id: st.licenseId || 2, binding_id: st.bindingId || 2,
                    key_last4: st.licenseLast4, card_key: st.cardKey || '', status: 'active',
                    device: { device_id_hash: 'mock-device-hash' }, can_use_premium: true,
                    device_model: 'RMX5200', bound_at: '2026-10-23 12:22:57'
                });
            }
            return Promise.resolve(JSON.stringify({ success: true, data: { licenses: list } }));
        }
        if (path.indexOf('v1/touch/packages/') >= 0 && path.indexOf('download-token') >= 0) {
            return Promise.resolve(JSON.stringify({ success: true, data: {
                download_token: 'mock-download-token', sha256: st.packages[0].sha256,
                version: st.packages[0].version, file_size: st.packages[0].file_size
            } }));
        }
        if (path.indexOf('v1/touch/packages') >= 0) {
            return Promise.resolve(JSON.stringify({ success: true, data: { packages: st.packages } }));
        }
        return Promise.resolve(JSON.stringify({ success: false, message: 'Mock 未实现的接口：' + path }));
    }
    return Promise.resolve('{"success":true}');
}

function b64urlDecode(value) {
    var text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (text.length % 4) text += '=';
    return base64ToUtf8(text);
}

/* ---------- 绑定 ---------- */
var TAB_NAMES = ['home', 'config', 'logs', 'user'];

function updateBarIndicator(animate) {
    var bar = $('bar-glass');
    var bubble = $('bar-bubble');
    if (!bar || !bubble) return;
    var tabs = document.querySelectorAll('.bar-tab');
    if (!tabs.length) return;
    var active = null;
    for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].classList.contains('is-active')) { active = tabs[i]; APP.bar.index = i; break; }
    }
    if (!active) { active = tabs[0]; APP.bar.index = 0; }
    var barRect = bar.getBoundingClientRect();
    var rect = active.getBoundingClientRect();
    if (!barRect.width || !rect.width) return;
    if (animate === false) bubble.style.transition = 'none';
    var bubbleSize = bubble.offsetWidth || 64;
    /* 气泡圆心对齐当前 Tab 中心（bubble 自身 left:4px，需减去基准偏移） */
    var centerX = rect.left + rect.width / 2 - barRect.left;
    bubble.style.setProperty('--bubble-x', Math.max(0, centerX - bubbleSize / 2 - 4) + 'px');
    if (animate === false) { void bubble.offsetWidth; bubble.style.transition = ''; }
}

function bindBottomBar() {
    var bar = $('bar-glass');
    var pointerMove = function (event) {
        if (!bar) return;
        var rect = bar.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        bar.style.setProperty('--mx', Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)).toFixed(1) + '%');
        bar.style.setProperty('--my', Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)).toFixed(1) + '%');
    };
    if (bar) {
        bar.addEventListener('pointermove', pointerMove);
        bar.addEventListener('pointerdown', pointerMove);
        bar.addEventListener('pointerleave', function () {
            bar.style.setProperty('--mx', '50%');
            bar.style.setProperty('--my', '50%');
        });
    }
    var bubble = $('bar-bubble');
    document.querySelectorAll('.bar-tab').forEach(function (tab) {
        tab.addEventListener('pointerdown', function () { if (bubble) bubble.classList.add('is-pressing'); });
        var release = function () { if (bubble) bubble.classList.remove('is-pressing'); };
        ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(function (ev) { tab.addEventListener(ev, release); });
    });
    window.addEventListener('resize', function () { updateBarIndicator(false); });
    window.addEventListener('orientationchange', function () { setTimeout(function () { updateBarIndicator(false); }, 260); });
}

function switchTab(name, updateHash) {
    if (TAB_NAMES.indexOf(name) < 0) name = 'home';
    APP.tab = name;
    document.querySelectorAll('.bar-tab').forEach(function (tab) {
        var on = tab.dataset && tab.dataset.tab === name;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.pane').forEach(function (pane) {
        var on = pane.id === 'pane-' + name;
        pane.classList.toggle('is-active', on);
        pane.hidden = !on;
    });
    updateHeaderForTab(name);
    updateBarIndicator(true);
    if (updateHash !== false) {
        try { history.replaceState(null, '', '#' + name); } catch (e) { location.hash = name; }
    }
    if (name === 'home') refreshStatus();
    else if (name === 'config') {
        if (!APP.configLoaded) loadConfig();
        else { updateGlobalDefault(); updateRulesCount(); updateConfigWarnings(); if (APP.apps.length) renderAppList(); }
    }
    else if (name === 'logs') loadRawLog();
    else if (name === 'user') { loadPaidTab(); }
}

function bindTabs() {
    document.querySelectorAll('.bar-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            switchTab(tab.dataset.tab, true);
            updateBarIndicator(true);
        });
    });
    window.addEventListener('hashchange', function () {
        var name = (location.hash || '').replace(/^#/, '');
        if (name && name !== APP.tab) switchTab(name, false);
    });
}

function startStatusPolling() {
    setInterval(function () {
        if (document.hidden) return;
        if (APP.tab !== 'home') return;
        refreshStatus();
    }, 2500);
}

function initialTab() {
    var name = (location.hash || '').replace(/^#/, '');
    return TAB_NAMES.indexOf(name) >= 0 ? name : 'home';
}

function headerPrimaryAction() {
    if (APP.tab === 'home') refreshStatus();
    else if (APP.tab === 'logs') loadRawLog();
    else if (APP.tab === 'user') { loadPaidTab(); }
}

function headerSecondaryAction() {
    /* 配置页不再有右上角保存/外观按钮（v4.2 实时生效；外观入口在用户页） */
}

function bindBaseControls() {
    var reload = $('btn-reload'); if (reload) reload.addEventListener('click', actionReload);
    var restart = $('btn-restart'); if (restart) restart.addEventListener('click', actionRestart);
    var restore = $('btn-restore120'); if (restore) restore.addEventListener('click', actionRestore120);
    var restoreOriginal = $('btn-restore-original'); if (restoreOriginal) restoreOriginal.addEventListener('click', actionRestoreOriginal);
    var uninstall = $('btn-uninstall'); if (uninstall) uninstall.addEventListener('click', actionUninstall);
    var read = $('btn-read-rate'); if (read) read.addEventListener('click', readCurrentRate);
    var measure = $('btn-measure'); if (measure) measure.addEventListener('click', measureRate);
    var syncToggle = $('sync-toggle'); if (syncToggle) syncToggle.addEventListener('change', function () { toggleTouchSync(syncToggle.checked); });
    if (!APP.syncStatusTimer) {
        APP.syncStatusTimer = setInterval(function () {
            if (document.hidden || APP.tab !== 'home' || APP.statusLoading || APP.syncSwitching) return;
            refreshStatus({ silent: true });
        }, SYNC_STATUS_REFRESH_MS);
    }
    var headerPrimary = $('btn-header-primary'); if (headerPrimary) headerPrimary.addEventListener('click', headerPrimaryAction);
    var headerSecondary = $('btn-header-secondary'); if (headerSecondary) headerSecondary.addEventListener('click', headerSecondaryAction);
}

function bindConfigControls() {
    document.querySelectorAll('#global-rate-pills [data-global-rate]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            guardConfigChange(function () {
                return changeGlobalRate(parseInt(btn.dataset.globalRate, 10) || 0);
            });
        });
    });
    var search = $('app-search');
    if (search) search.addEventListener('input', function () {
        APP.appFilter = search.value || '';
        renderAppList();
    });
    var refresh = $('btn-refresh-apps');
    if (refresh) refresh.addEventListener('click', function () { loadInstalledApps(); });
}

function bindLogControls() {
    var collect = $('btn-collect-diag'); if (collect) collect.addEventListener('click', collectDiag);
    var share = $('btn-share-diag'); if (share) share.addEventListener('click', function () { shareDiag(APP.diagPath); });
    var clear = $('btn-clear-log'); if (clear) clear.addEventListener('click', actionClearLog);
    var refresh = $('btn-refresh-raw-log'); if (refresh) refresh.addEventListener('click', loadRawLog);
}

/* ---------- 绑定 ---------- */
function bindUserControls() {
    var pane = $('pane-user');
    if (pane) {
        pane.addEventListener('click', function (event) {
            var node = event.target;
            while (node && node !== pane && !(node.dataset && node.dataset.paidAction)) node = node.parentNode;
            if (!node || node === pane || !node.dataset) return;
            var action = node.dataset.paidAction;
            if (!action) return;
            if (action === 'login') showLoginOverlay();
            else if (action === 'register') showRegisterOverlay();
            else if (action === 'logout') paidLogout();
            else if (action === 'activate') {
                var input = $('paid-card-key');
                activatePaidCard(input ? input.value : '');
            } else if (action === 'renew-lease') renewPaidLease();
            else if (action === 'refresh-auth') syncPaidAuthorization({}).then(function (result) {
                if (result && result.ok) toast('授权已刷新', 'ok');
                else toast('授权已刷新，租约待同步：' + ((result && result.error) || '请稍后重试'), 'warn', 4200);
            });
            else if (action === 'buy') showPurchaseOverlay();
            else if (action === 'check-order') {
                if (APP.paid.order) {
                    openPaymentOverlay();
                    renderPaymentOrder(APP.paid.order);
                    startPaymentPolling();
                } else {
                    toast('没有待确认的订单', 'warn');
                }
            }
            else if (action === 'licenses') showMyLicenses();
            else if (action === 'orders') showMyOrders();
            else if (action === 'download') downloadPremiumPackage();
            else if (action === 'about') openAboutPage();
            else if (action === 'mock-expire') {
                var st = mockPaidState();
                st.entitlement = 'expired';
                st.lease = Object.assign({}, st.lease || mockLeaseObject(), { expires_at: new Date(Date.now() - 3600 * 1000).toISOString() });
                refreshPaidState({ silent: true });
                toast('Mock：已模拟授权过期', 'warn');
            } else if (action === 'mock-restore') {
                var st2 = mockPaidState();
                st2.entitlement = 'active';
                st2.deviceBound = 1;
                st2.licenseLast4 = st2.licenseLast4 || 'MOCK';
                st2.lease = mockLeaseObject();
                refreshPaidState({ silent: true });
                toast('Mock：已恢复授权', 'ok');
            }
        });
    }
    var notice = $('paid-notice');
    if (notice) notice.addEventListener('click', function () { switchTab('user', true); });
    var overlay = $('paid-overlay');
    if (overlay) {
        overlay.addEventListener('click', function (event) {
            var target = event.target;
            if (target && target.dataset && target.dataset.paidClose) closePaidOverlay();
        });
    }
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && APP.tab === 'user') paidAutoMaintenance();
    });
    if (APP.paid && !APP.paid.autoTimer) {
        APP.paid.autoTimer = setInterval(function () {
            if (document.hidden) return;
            paidAutoMaintenance();
        }, PAID_REFRESH_MS);
    }
}

function bindPaymentControls() {
    var overlay = $('payment-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', function (event) {
        var target = event.target;
        if (target && target.dataset && (target.dataset.paymentClose || target.id === 'btn-payment-close')) {
            closePaymentOverlay();
        }
    });
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && overlay && !overlay.hidden) closePaymentOverlay();
    });
}

function bindModal() {
    var okBtn = $('modal-ok');
    if (okBtn) okBtn.addEventListener('click', function () { closeModal(true); });
    var cancelBtn = $('modal-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { closeModal(false); });
    var modal = $('modal');
    if (modal) {
        modal.addEventListener('click', function (event) {
            var target = event.target;
            if (target && target.dataset && target.dataset.modalCancel) closeModal(false);
        });
    }
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && modal && !modal.hidden) closeModal(false);
    });
}

function init() {
    if (APP.initialized) return;
    APP.initialized = true;
    APP.isMock = isMockMode();
    APP.appearance = loadAppearance();
    applyAppearanceVars();

    if (APP.isMock) {
        var banner = $('preview-banner');
        if (banner) banner.hidden = false;
        setText('footer-mode', '浏览器预览模式');
    } else {
        setText('footer-mode', 'KernelSU 模式');
    }

    bindTabs();
    bindModal();
    bindAppearance();
    bindAboutControls();
    bindAppRateSheet();
    bindBottomBar();
    bindBaseControls();
    bindConfigControls();
    bindLogControls();
    bindUserControls();
    bindPaymentControls();

    switchTab(initialTab(), false);
    refreshStatus();
    updateBarIndicator(false);
    setTimeout(function () { updateBarIndicator(false); }, 80);
    startStatusPolling();

    if (APP.isMock) { mockPaidState(); setTimeout(function () { refreshStatus(); }, 600); }
    refreshPaidState({ silent: true });
}

function onReady(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
}

/* ============================================================
 * 16. 测试钩子（Node 单测用；浏览器运行不影响）
 * ============================================================ */
if (typeof window !== 'undefined') {
    window.__GT8PRO_WEBUI__ = {
        version: WEBUI_VERSION,
        MOD: MOD,
        CONFIG_PATH: CONFIG_PATH,
        RATE_CONF_PATH: RATE_CONF_PATH,
        DAEMON_LOG_PATH: DAEMON_LOG_PATH,
        SERVICE_LOG_PATH: SERVICE_LOG_PATH,
        LICENSE_PATH: LICENSE_PATH,
        CMD: CMD,
        isMockMode: isMockMode,
        APPEARANCE_KEY: APPEARANCE_KEY,
        DEFAULT_APPEARANCE: DEFAULT_APPEARANCE,
        THEME_ORDER: THEME_ORDER,
        ACCENT_PRESETS: ACCENT_PRESETS,
        utf8ToBase64: utf8ToBase64,
        base64ToUtf8: base64ToUtf8,        CONFIG_APPLY_DEBOUNCE: CONFIG_APPLY_DEBOUNCE,
        MODULE_PROP_PATH: MODULE_PROP_PATH,
        DIAG_DIR: DIAG_DIR,
        ANY_HZ: ANY_HZ,
        HZ_TO_CODE: HZ_TO_CODE,
        CODE_TO_HZ: CODE_TO_HZ,
        BACKGROUND_CHOICES: BACKGROUND_CHOICES,
        normalizeBackgroundChoice: normalizeBackgroundChoice,
        backgroundChoiceLabel: backgroundChoiceLabel,
        computedBackgroundColor: computedBackgroundColor,
        backgroundTone: backgroundTone,
        setBackgroundChoice: setBackgroundChoice,
        scheduleAppearancePersist: scheduleAppearancePersist,        scheduleConfigApply: scheduleConfigApply,
        applyConfigNow: applyConfigNow,
        openThemePage: openThemePage,
        closeThemePage: closeThemePage,
        updateAppearanceControls: updateAppearanceControls,
        configTextEquals: configTextEquals,
        parseConfigText: parseConfigText,
        buildConfigText: buildConfigText,
        validateConfig: validateConfig,
        validateRateValue: validateRateValue,
        isValidPackage: isValidPackage,
        rateToHz: rateToHz,
        parseRateText: parseRateText,
        parsePackagesOutput: parsePackagesOutput,
        parseAppLabelsOutput: parseAppLabelsOutput,
        normalizePackageInfoResult: normalizePackageInfoResult,
        supportsPackageInfoBridge: supportsPackageInfoBridge,
        mergeAppList: mergeAppList,
        filterApps: filterApps,
        parseMeasureResult: parseMeasureResult,
        parseLicenseStatus: parseLicenseStatus,
        sanitizeLicenseCode: sanitizeLicenseCode,
        parseJsonLoose: parseJsonLoose,
        extractJson: parseJsonLoose,
        hzToCode: function (hz) { return HZ_TO_CODE[hz] || 0; },
        codeToHz: function (code) { return CODE_TO_HZ[code] || 0; },
        normalizeState: normalizeState,
        renderSyncCard: renderSyncCard,
        syncSourceLabel: syncSourceLabel,
        syncSourceShortLabel: syncSourceShortLabel,
        effectiveSourceInfo: effectiveSourceInfo,
        formatConfigEffective: formatConfigEffective,
        changeGlobalRate: changeGlobalRate,
        showGlobalRuleConflictDialog: showGlobalRuleConflictDialog,
        renderConfigStatus: renderConfigStatus,
        guardConfigChange: guardConfigChange,
        writeSyncConfigVerified: writeSyncConfigVerified,
        pollConfigApplied: pollConfigApplied,
        notifyConfigApplied: notifyConfigApplied,
        syncLastWriteText: syncLastWriteText,
        toggleTouchSync: toggleTouchSync,
        SYNC_CONF_PATH: SYNC_CONF_PATH,
        mockState: mockState,
        fallbackState: fallbackState,
        backendLabel: backendLabel,
        cloneDefaultAppearance: cloneDefaultAppearance,
        normalizeHexColor: normalizeHexColor,
        normalizeColorHex: normalizeColorHex,
        cssColorFromHex: cssColorFromHex,
        hexToRgb: hexToRgb,
        rgbToHex: rgbToHex,
        rgbLuminance: rgbLuminance,
        deriveDarkAccent: deriveDarkAccent,
        validateAppearance: validateAppearance,
        loadAppearance: loadAppearance,
        saveAppearance: saveAppearance,
        getAppearance: function () { return JSON.parse(JSON.stringify(APP.appearance || cloneDefaultAppearance())); },
        setAppearanceState: function (value) { APP.appearance = validateAppearance(value); return APP.appearance; },
        API_BASE: API_BASE,
        API_SCRIPT: API_SCRIPT,
        PAID_PRODUCT_CODE: PAID_PRODUCT_CODE,
        PAID_LEASE_RENEW_SECONDS: PAID_LEASE_RENEW_SECONDS,
        b64urlEncode: b64urlEncode,
        b64urlDecode: b64urlDecode,
        paidParseJson: paidParseJson,
        paidData: paidData,
        paidArray: paidArray,
        paidDevicePayload: paidDevicePayload,
        paidDeviceQuery: paidDeviceQuery,
        paidLoggedIn: paidLoggedIn,
        paidEntitlementLabel: paidEntitlementLabel,
        paidPremiumText: paidPremiumText,
        paymentMethodName: paymentMethodName,
        formatPaidBytes: formatPaidBytes,
        parseUserIdsFromOutput: parseUserIdsFromOutput,
        wechatTargetLabel: wechatTargetLabel,
        parseWechatTargets: parseWechatTargets,
        shouldShowWechatSelector: shouldShowWechatSelector,
        rememberedWechatUser: rememberedWechatUser,
        rememberWechatUser: rememberWechatUser,
        selectedWechatTarget: selectedWechatTarget,
        loadWechatTargets: loadWechatTargets,
        WECHAT_USER_STORAGE_KEY: WECHAT_USER_STORAGE_KEY,        dateTimeToMillis: dateTimeToMillis,
        formatLeaseExpiry: formatLeaseExpiry,
        maskCardNumber: maskCardNumber,
        licenseStatusLabel: licenseStatusLabel,
        aboutUpdateSources: aboutUpdateSources,
        aboutChangelogSources: aboutChangelogSources,
        stripChangelogMarkdown: stripChangelogMarkdown,
        fetchAboutChangelogText: fetchAboutChangelogText,
        fetchAboutUpdate: fetchAboutUpdate,
        showAboutUpdateDialog: showAboutUpdateDialog,
        aboutUpdateReleaseUrl: aboutUpdateReleaseUrl,
        aboutReleaseUrl: aboutReleaseUrl,
        readAboutUpdateCache: readAboutUpdateCache,
        writeAboutUpdateCache: writeAboutUpdateCache,
        ABOUT_UPDATE_CACHE_KEY: ABOUT_UPDATE_CACHE_KEY,
        ABOUT_UPDATE_CACHE_TTL: ABOUT_UPDATE_CACHE_TTL,
        ABOUT_UPDATE_SOURCES: ABOUT_UPDATE_SOURCES,
        compareVersionStrings: compareVersionStrings,
        fetchAboutUpdate: fetchAboutUpdate,
        normalizeSignedLease: normalizeSignedLease,
        latestLicenseMeta: latestLicenseMeta,
        refreshLicensesMeta: refreshLicensesMeta,
        saveEntitlementCache: saveEntitlementCache,
        syncPaidAuthorization: syncPaidAuthorization,
        copyTextToClipboard: copyTextToClipboard,
        paymentMethodKind: paymentMethodKind,
        paymentMethodLabel: paymentMethodLabel,
        formatPayAmount: formatPayAmount,
        mockPaidState: mockPaidState,
        mockPaidExec: mockPaidExec,
        refreshPaidState: refreshPaidState,
        loadPaidTab: loadPaidTab,
        updatePaidNotice: updatePaidNotice,
        paidPurchaseVisible: paidPurchaseVisible,
        paidStatusSummary: paidStatusSummary,
        applyPurchaseVisibility: applyPurchaseVisibility,
        openAboutPage: openAboutPage,
        closeAboutPage: closeAboutPage,
        bindAboutControls: bindAboutControls,
        loadAboutInfo: loadAboutInfo,
        ABOUT_AUTHOR: ABOUT_AUTHOR,
        ABOUT_REPO_URL: ABOUT_REPO_URL,
        ABOUT_README_URL: ABOUT_README_URL,
        ABOUT_CHANGELOG_URL: ABOUT_CHANGELOG_URL,
        ABOUT_COOLAPK_DEEPLINK: ABOUT_COOLAPK_DEEPLINK,
        ABOUT_COOLAPK_FALLBACK: ABOUT_COOLAPK_FALLBACK,
        ABOUT_QQ_URL: ABOUT_QQ_URL,
        ABOUT_QQ_NUMBER: ABOUT_QQ_NUMBER,
        ABOUT_TRAFFIC_URL: ABOUT_TRAFFIC_URL,
        ABOUT_DONATE_URL: ABOUT_DONATE_URL,
        ABOUT_UPDATE_JSON_URL: ABOUT_UPDATE_JSON_URL,
        ABOUT_RELEASES_URL: ABOUT_RELEASES_URL,        paidAutoMaintenance: paidAutoMaintenance,        simpleHash: simpleHash,
        mockExec: mockExec,
        getMockState: function () { return mockState(); },
        getMockConfigText: function () { return MOCK.configText; },
        getMockLogs: function () { return MOCK.logs.slice(); },
        getMockLicense: function () { return JSON.parse(JSON.stringify(MOCK.license)); },
        getMockApps: function () { return MOCK.apps.map(function (app) { return { pkg: app.pkg, label: app.label }; }); },
        getMockDeviceId: function () { return MOCK.deviceId; },
        resetMock: function () {
            MOCK.configText = MOCK_INITIAL_CONFIG;
            MOCK.logs = MOCK_INITIAL_LOGS.slice();
            MOCK.pid = 4812;
            MOCK.removed = false;
            MOCK.licenseText = '';
            MOCK.license = { activated: false, plan: '', activatedAt: '', code: '' };
            MOCK.manualHz = 0;
            MOCK.paid = null;
        }
    };
}

onReady(init);
