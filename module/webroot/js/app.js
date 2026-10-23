/* ============================================================
 * 慕容触控采样率 v5.0 · KernelSU WebUI
 * 四页：主页 / 配置 / 日志 / 用户；MIUIX + 调度式液态玻璃底栏。
 * UI 主参考 murongdiaodu-apk（慕容调度）；日志“一键收集+分享”、配置平铺参考显示模块。
 * 纯静态、离线、无 CDN；命令全部经 ksu.exec 执行；浏览器预览自动 Mock。
 * ============================================================ */
'use strict';

/* ============================================================
 * 1. 常量
 * ============================================================ */
var MOD = '/data/adb/modules/gt8pro_touch';
var WEBUI_VERSION = '5.0.0';
var CONFIG_PATH = MOD + '/config/采样率.txt';
var DAEMON_PID_PATH = MOD + '/config/daemon.pid';
var DAEMON_LOG_PATH = MOD + '/config/daemon.log';
var SERVICE_LOG_PATH = MOD + '/config/service.log';
var RATE_CONF_PATH = MOD + '/config/rate.conf';
var LICENSE_PATH = MOD + '/config/license.txt';
var CONFIG_APPLY_DEBOUNCE = 200;
var API_BASE = 'https://murongdiaodu.rl1.cc/api';
var API_SCRIPT = MOD + '/bin/api.sh';
var API_TIMEOUT = 45000;
var PAID_PRODUCT_CODE = 'touch_sampling';
var PAID_REFRESH_MS = 30 * 60 * 1000;
var PAID_LEASE_RENEW_SECONDS = 24 * 3600;
var PAID_DOWNLOAD_ZIP = '/data/local/tmp/gt8pro_touch_premium.zip';
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
    moduleVersion: 'v5.0.0',
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
        '# 慕容触控采样率 v5.0 config/采样率.txt',
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
        return 'MOD="' + MOD + '"; D="' + DIAG_DIR + '"; TS=$(date +%Y%m%d_%H%M%S); NAME="gt8pro_touch_diag_$TS"; TMP="/data/local/tmp/$NAME"; ' +
            'mkdir -p "$TMP"; ' +
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
            'BB=/data/adb/ksu/bin/busybox; [ -x "$BB" ] || BB=$(command -v busybox 2>/dev/null); ' +
            'if [ -n "$BB" ] && [ -x "$BB" ]; then (cd "$TMP" && "$BB" zip -r "$D/$NAME.zip" . >/dev/null 2>&1); ZIP="$D/$NAME.zip"; ' +
            'else (cd "$TMP" && tar -czf "$D/$NAME.tar.gz" . >/dev/null 2>&1); ZIP="$D/$NAME.tar.gz"; fi; ' +
            'rm -rf "$TMP"; [ -f "$ZIP" ] && echo "__DIAG_OK__:$ZIP" || echo "__DIAG_FAIL__"';
    },
    shareDiag: function (path) {
        return 'am start -a android.intent.action.SEND -t application/zip --eu android.intent.extra.STREAM "file://' + path + '" >/dev/null 2>&1 && echo __SHARE_OK__ || echo __SHARE_FAIL__';
    },
    openUrl: function (url) { return 'am start -a android.intent.action.VIEW -d "' + url + '" >/dev/null 2>&1 && echo __OPEN_OK__ || echo __OPEN_FAIL__'; },
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
    '# 慕容触控采样率 v5.0 采样率配置（浏览器预览 Mock）',
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
    '10-23 08:31:02 [INFO] ===== 慕容触控采样率 v5.0.0 守护进程启动 =====',
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
        version: '5.0.0', model: 'RMX5200', platform: 'arm64-v8a', sdk: 37, oplusrom: 'V17.0.0',
        daemon_running: !MOCK.removed, pid: MOCK.removed ? 0 : MOCK.pid,
        foreground: MOCK.foreground, foreground_source: 'binder',
        matched: m.matched, rule_rate: m.ruleRate, global_rate: m.global, target_hz: m.target, current_hz: current,
        backend: MOCK.removed ? '' : 'hbp', backend_ok: !MOCK.removed, original_hz: MOCK.originalHz, rules: m.rules.length,
        config_path: CONFIG_PATH, daemon_log: DAEMON_LOG_PATH, licensed: !!MOCK.license.activated,
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
        if (c.indexOf('android.intent.action.SEND') >= 0) return '__SHARE_OK__';
        if (c.indexOf('android.intent.action.VIEW') >= 0) return '__OPEN_OK__';
        /* 诊断收集命令里也包含 --json/--probe，必须最先匹配 */
        if (c.indexOf('gt8pro_touch_diag_') >= 0) return '__DIAG_OK__:/sdcard/Download/gt8pro_touch_diag_20261023_090000.zip';
        /* 降级设备信息（daemon 不支持 --json 时；内部含 rate_ctl get，需先匹配） */
        if (c.indexOf('getprop ro.product.vendor.model') >= 0) {
            return ['MODEL=RMX5200', 'PLATFORM=arm64-v8a', 'SDK=37', 'ROM=V17.0.0', 'PID=' + (MOCK.removed ? '' : MOCK.pid), 'CURRENT=DC 0xE6 = 1'].join('\n');
        }
        if (c.indexOf('--json') >= 0) return JSON.stringify(mockState());
        if (c.indexOf('--probe') >= 0) {
            return ['touch_rate_daemon v5.0.0 后端探测报告',
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
        if (c.indexOf('module.prop') >= 0 && c.indexOf('cat ') >= 0) return 'id=gt8pro_touch\nname=慕容触控采样率\nversion=v5.0.0\nversionCode=500\nauthor=murong';
        if (c.indexOf('android.intent.action.SEND') >= 0) return '__SHARE_OK__';
        if (c.indexOf('android.intent.action.VIEW') >= 0) return '__OPEN_OK__';
        if (c.indexOf('license.txt') >= 0 && c.indexOf('base64 -d') >= 0) {
            var lm = c.match(/'([A-Za-z0-9+/=]+)'/);
            if (lm) MOCK.licenseText = base64ToUtf8(lm[1]);
            return '__WRITE_OK__';
        }
        if (c.indexOf('license.txt') >= 0 && c.indexOf('cat ') >= 0) return MOCK.licenseText;
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
 * 8. 外观 / 主题界面（v5.0：纯色背景 白/黑/跟随系统/自定义 + 主题色）
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

function renderHome() {
    var s = APP.state;
    if (!s) return;
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
        var show = !s.degraded && !s.unavailable && s.target_hz > 0 && s.current_hz > 0 && s.current_hz !== s.target_hz;
        mismatch.hidden = !show;
        if (show) mismatch.textContent = '目标 ' + s.target_hz + ' Hz，当前 ' + s.current_hz + ' Hz：守护进程会在约 1.5 秒后自动纠正。';
    }
    var alert = $('status-alert');
    if (alert) {
        if (s.degraded) alert.hidden = false;
        else alert.hidden = true;
        if (s.degraded) alert.textContent = '当前 daemon 不支持 --json 接口（可能未升级到 v5.0），已降级读取基础状态。';
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
            '<span class="app-row-name">' + escapeHtml(label) + '</span>' +
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
        btn.addEventListener('click', async function () {
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
            toast('已生效', 'ok');
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
async function collectDiag() {
    var btn = $('btn-collect-diag');
    await withBusy(btn, '收集打包中…（约数十秒）', async function () {
        var out = await runCommand(CMD.collectDiag(), { timeout: 180000 });
        var match = String(out).match(/__DIAG_OK__:(\S+)/);
        if (match) {
            APP.diagPath = match[1];
            var result = $('diag-result');
            if (result) result.hidden = false;
            setText('diag-path', APP.diagPath);
            setText('diag-hint', '已生成：' + APP.diagPath);
            toast('诊断包已生成', 'ok');
            var share = await confirmDialog({ title: '诊断包已生成', message: '路径：\n' + APP.diagPath + '\n\n是否立即分享给开发者？', confirmText: '分享', cancelText: '关闭' });
            if (share) await shareDiag(APP.diagPath);
        } else {
            toast('诊断包生成失败，请确认 /sdcard/Download 可写', 'err', 4000);
            setText('diag-hint', '生成失败：' + stripSentinels(out).slice(0, 200));
        }
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
        build_fingerprint: d.build_fingerprint || ''
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
        '&build_fingerprint=' + encodeURIComponent(p.build_fingerprint);
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

async function refreshServerEntitlement() {
    if (!paidLoggedIn()) return null;
    try {
        var resp = await paidApi('GET', 'v1/touch/entitlement?' + paidDeviceQuery(), { auth: true });
        var data = paidData(resp);
        var status = String(data.status || data.entitlement || 'unknown');
        APP.paid.entitlement = {
            status: status,
            license_last4: data.license_last4 || (data.license && data.license.key_last4) || '',
            device_bound: !!(data.device_bound || (data.license && data.license.bound)),
            features: paidArray(data.features)
        };
        var cache = {
            entitlement: status,
            license_last4: APP.paid.entitlement.license_last4 || '',
            device_bound: APP.paid.entitlement.device_bound ? 1 : 0
        };
        try { await runCommand(CMD.paidSaveEntitlement(b64urlEncode(JSON.stringify(cache))), { timeout: 20000 }); } catch (e2) { /* ignore */ }
        if (status === 'active' || status === 'grace') {
            var auth = APP.paid.auth || {};
            if (auth.lease_valid !== 1 || Number(auth.lease_remaining_seconds || 0) < PAID_LEASE_RENEW_SECONDS) {
                await refreshLease(true);
            }
        }
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
        var lease = paidData(resp);
        if (!lease || !lease.expires_at) throw new Error('租约响应缺少 expires_at');
        await runCommand(CMD.paidSaveLease(b64urlEncode(JSON.stringify(lease))), { timeout: 20000 });
        await refreshPaidState({ silent: true });
        if (!silent) toast('租约已续期', 'ok');
        return lease;
    } catch (e) {
        if (!silent) toast('续租失败：' + (e && e.message ? e.message : e), 'err', 3600);
        return null;
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
    await refreshServerEntitlement();
    await refreshPaidState({ silent: true });
    await ensureLeaseFresh(true);
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
        (ent === 'active' || ent === 'grace' ? 'ok' : (ent === 'expired' ? 'err' : '')) + '">' +
        escapeHtml(paidEntitlementLabel(ent)) + '</span></div>';
    if (ent === 'active' || ent === 'grace') {
        html += '<div class="paid-kv"><span>卡密尾号</span><b>' + escapeHtml(a.license_last4 || '—') + '</b></div>';
        html += '<div class="paid-kv"><span>绑定设备</span><b>' + escapeHtml(a.device_model || '本机') + '</b></div>';
        html += '<div class="paid-kv"><span>租约到期</span><b>' + escapeHtml(a.lease_expires_at || '—') + '</b></div>';
        html += '<div class="paid-kv"><span>剩余天数</span><b>' + String(a.lease_days_left || 0) + ' 天' +
            (a.lease_valid === 1 ? '' : '（已过期，需联网续租）') + '</b></div>';
        if (Array.isArray(a.features) && a.features.length) {
            html += '<div class="paid-kv"><span>功能</span><b>' + escapeHtml(a.features.join('、')) + '</b></div>';
        }
        html += '<div class="paid-actions"><button type="button" class="btn btn-primary" data-paid-action="renew-lease">续租</button>' +
            '<button type="button" class="btn btn-secondary" data-paid-action="refresh-auth">刷新授权</button></div>';
    } else {
        html += '<div class="paid-kv"><span>状态</span><b>' + escapeHtml(paidEntitlementLabel(ent)) + '</b></div>';
        if (!logged) {
            html += '<p class="paid-hint">请先登录账号，再购买授权或输入卡密激活。</p>';
            html += '<div class="paid-actions"><button type="button" class="btn btn-primary" data-paid-action="login">登录</button></div>';
        } else {
            html += '<p class="paid-hint">已有卡密可直接激活；未购买可点下方「购买授权」。</p>';
            html += '<div class="paid-input-row"><input id="paid-card-key" class="input" type="text" placeholder="输入卡密（如 SPK-XXXX-XXXX-XXXX）" autocomplete="off" spellcheck="false"><button type="button" class="btn btn-primary" data-paid-action="activate">激活</button></div>';
            html += '<div class="paid-actions"><button type="button" class="btn btn-secondary" data-paid-action="refresh-auth">刷新授权</button></div>';
        }
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
        message = (a.entitlement === 'expired' || a.lease_valid === 0 && a.entitlement === 'active' || a.entitlement === 'grace')
            ? '授权已过期：请到用户页续租以恢复采样率切换。'
            : '未授权：请到用户页购买/激活卡密并续租。';
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
        await runCommand(CMD.paidSaveEntitlement(b64urlEncode(JSON.stringify({
            entitlement: 'active', license_last4: last4, device_bound: 1
        }))), { timeout: 20000 });
        closePaidOverlay();
        toast('激活成功', 'ok');
        await refreshLease(true);
        await refreshServerEntitlement();
        await refreshPaidState({ silent: true });
    } catch (e) {
        toast('激活失败：' + (e && e.message ? e.message : e), 'err', 4200);
    }
}

async function renewPaidLease() {
    if (!paidLoggedIn()) { showLoginOverlay(); return; }
    await refreshLease(false);
    await refreshServerEntitlement();
    await refreshPaidState({ silent: true });
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

function renderPurchaseOverlay() {
    var p = APP.paid.purchase || {};
    var product = p.product || {};
    var price = Number(product.price != null ? product.price : 3).toFixed(2);
    var methods = p.methods || [];
    var selected = p.selectedMethod || (methods[0] && methods[0].code) || 'wechat';
    var html = '<div class="paid-kv"><span>商品</span><b>' + escapeHtml(product.name || '慕容触控采样率 授权（3元 单机永久）') + '</b></div>';
    html += '<div class="paid-kv"><span>价格</span><b>¥' + price + ' · 单机永久</b></div>';
    html += '<p class="paid-hint">支付成功后自动发放卡密并绑定本机，无需手动输入；支付页面将在系统浏览器中打开。</p>';
    html += '<div class="paid-method" id="paid-methods">';
    methods.forEach(function (m) {
        html += '<button type="button" data-paid-method="' + escapeHtml(m.code) + '"' +
            (m.code === selected ? ' class="active"' : '') + '>' + escapeHtml(m.name || paymentMethodName(m.code)) + '</button>';
    });
    html += '</div>';
    showPaidOverlay('购买授权', html, [
        { label: '稍后', className: 'btn-secondary', onClick: closePaidOverlay },
        { label: '支付 ¥' + price, className: 'btn-primary', onClick: function () { createPaidOrder(); } }
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
    showPaidOverlay('正在创建订单', '<p class="paid-hint">正在创建订单，请稍候…</p>', [{ label: '取消', className: 'btn-secondary', onClick: closePaidOverlay }]);
    try {
        var contact = (APP.paid.auth && (APP.paid.auth.username || APP.paid.auth.user_id)) || 'module-webui';
        var body = 'product_id=' + encodeURIComponent(String(product.id)) +
            '&payment_method=' + encodeURIComponent(p.selectedMethod || 'wechat') +
            '&contact_info=' + encodeURIComponent(String(contact)) +
            '&order_kind=' + encodeURIComponent('touch_cardkey_new') +
            '&device_info=' + encodeURIComponent(JSON.stringify(Object.assign({ client: 'module-webui', order_kind: 'touch_cardkey_new' }, paidDevicePayload())));
        var resp = await paidApi('POST', 'payment.php?action=create_order', { auth: true, form: true, formBody: body });
        var data = paidData(resp);
        if (!data.order_no) throw new Error(resp.message || '订单响应缺少订单号');
        APP.paid.order = {
            order_no: String(data.order_no),
            order_access_token: String(data.order_access_token || data.order_token || data.access_token || ''),
            payment_url: String(data.payment_url || ''),
            pay_amount: Number(data.pay_amount || product.price || 3),
            status: 'pending',
            product_name: String(product.name || '慕容触控采样率 授权')
        };
        rememberPaidOrder(APP.paid.order);
        renderPaymentWaitingOverlay();
        renderPaidPage();
        if (APP.paid.order.payment_url) {
            await runCommand(CMD.openUrl(APP.paid.order.payment_url), { timeout: 15000 });
        }
        startPaidOrderPolling();
    } catch (e) {
        showPaidOverlay('创建订单失败', '<p class="paid-hint">' + escapeHtml(e && e.message ? e.message : e) + '</p>', [
            { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay },
            { label: '重试', className: 'btn-primary', onClick: showPurchaseOverlay }
        ]);
    }
}

function renderPaymentWaitingOverlay() {
    var order = APP.paid.order || {};
    var html = '<div class="paid-kv"><span>订单号</span><b>' + escapeHtml(order.order_no || '—') + '</b></div>';
    html += '<div class="paid-kv"><span>应付金额</span><b>¥' + Number(order.pay_amount || 0).toFixed(2) + '</b></div>';
    html += '<p class="paid-hint">已打开系统浏览器支付页；支付完成后回到本页会自动确认，也可点下方按钮手动检查。</p>';
    html += '<p class="paid-hint" id="paid-pay-status">等待支付…</p>';
    showPaidOverlay('等待支付', html, [
        { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay },
        { label: '重新打开支付页', className: 'btn-secondary', onClick: function () {
            if (order.payment_url) runCommand(CMD.openUrl(order.payment_url), { timeout: 15000 });
        } },
        { label: '我已完成支付', className: 'btn-primary', onClick: function () { checkPaidOrder(); } }
    ]);
}

function startPaidOrderPolling() {
    stopPaidOrderPolling();
    APP.paid.polling = true;
    APP.paid.pollCount = 0;
    checkPaidOrder();
    APP.paid.pollTimer = setInterval(function () {
        if (!APP.paid.polling) return;
        APP.paid.pollCount = (APP.paid.pollCount || 0) + 1;
        if (APP.paid.pollCount > 40) { stopPaidOrderPolling(); return; }
        checkPaidOrder();
    }, 3000);
}

function stopPaidOrderPolling() {
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
            stopPaidOrderPolling();
            var cardKey = String((data.payment_data && data.payment_data.card_key) || data.card_key || '');
            try { sessionStorage.removeItem('gt8_paid_order_v1'); } catch (e) { /* ignore */ }
            await refreshServerEntitlement();
            await refreshLease(true);
            await refreshPaidState({ silent: true });
            showPaidOverlay('支付成功', '<div class="paid-success">授权已发放并绑定本机。</div>' +
                (cardKey ? '<div class="paid-license-key">' + escapeHtml(cardKey) + '</div>' : '') +
                '<p class="paid-hint">正在检查付费组件；可在「下载付费组件」中安装最新版本。</p>', [
                { label: '完成', className: 'btn-primary', onClick: closePaidOverlay }
            ]);
            toast('支付成功，授权已到账', 'ok', 3600);
            renderPaidPage();
        } else if (status === 'expired' || status === 'cancelled' || status === 'delivery_failed') {
            stopPaidOrderPolling();
            var msg = status === 'expired' ? '订单已超时，请重新下单' : status === 'cancelled' ? '订单已取消' : '支付已确认，但卡密交付失败';
            setText('paid-pay-status', msg);
            toast(msg, 'err', 4200);
        } else {
            setText('paid-pay-status', '等待支付到账…');
        }
    } catch (e) {
        setText('paid-pay-status', '网络暂时不可用，正在自动重试');
    } finally {
        APP.paid.orderChecking = false;
    }
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

async function showMyLicenses() {
    if (!paidLoggedIn()) { showLoginOverlay(); return; }
    showPaidOverlay('我的卡密', '<p class="paid-hint">正在读取…</p>', [{ label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }]);
    try {
        var resp = await paidApi('GET', 'v1/touch/licenses', { auth: true });
        APP.paid.licenses = paidArray(paidData(resp), 'licenses');
        paidListOverlay('我的卡密', APP.paid.licenses, function (item) {
            var last4 = item.key_last4 || (item.card_key ? String(item.card_key).slice(-4) : '—');
            return '<strong>' + escapeHtml('尾号 ' + last4) + '</strong><small>' +
                escapeHtml((item.status || 'unknown') + (item.device_model ? ' · ' + item.device_model : '')) + '</small>';
        }, '暂无卡密，购买授权后会自动发放');
    } catch (e) {
        showPaidOverlay('我的卡密', '<p class="paid-hint">读取失败：' + escapeHtml(e && e.message ? e.message : e) + '</p>', [{ label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }]);
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
        if (!packages.length) throw new Error('服务端暂无可下载付费组件');
        packages.sort(function (a, b) { return Number(b.version_code || 0) - Number(a.version_code || 0); });
        var pkg = packages[0];
        var shaExpected = String(pkg.sha256 || pkg.file_sha256 || '').toLowerCase();
        log(25, '最新版本 ' + (pkg.version || '—') + ' · ' + formatPaidBytes(pkg.file_size || 0));
        var tokenResp = await paidApi('POST', 'v1/touch/packages/' + encodeURIComponent(String(pkg.id)) + '/download-token', {
            auth: true, nonce: true, json: paidDevicePayload()
        });
        var tokenData = paidData(tokenResp);
        var downloadToken = String(tokenData.download_token || tokenData.token || '');
        if (!downloadToken) throw new Error('未获取到下载令牌');
        log(40, '已获取下载令牌，开始下载…');
        var downloadUrl = String(tokenData.download_url || '');
        var dl = await paidRunJson(CMD.paidDownloadPremium(String(pkg.id), downloadToken, PAID_DOWNLOAD_ZIP, downloadUrl), '下载付费组件');
        log(70, '已下载 ' + formatPaidBytes(dl.size || 0) + '，校验哈希…');
        var actualSha = String(dl.sha256 || '').toLowerCase();
        if (shaExpected && actualSha && actualSha !== shaExpected) throw new Error('下载文件 SHA-256 校验失败');
        log(80, '校验通过，安装到模块 bin/…');
        var installed = await paidRunJson(CMD.paidInstallPremium(dl.path || PAID_DOWNLOAD_ZIP), '安装付费组件');
        log(100, '安装成功' + (installed.version ? ' · ' + installed.version : '') + (installed.sha256 ? ' · ' + String(installed.sha256).slice(0, 8) : ''), 'ok');
        APP.paid.premium = { installed: 1, version: installed.version || '', sha256: installed.sha256 || '', path: installed.path || '' };
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
        await ensureLeaseFresh(true);
        await refreshPaidState({ silent: true });
        await refreshServerEntitlement();
        await refreshPaidState({ silent: true });
    } catch (e) { /* 静默 */ }
}

/* ---------- Mock 付费后端 ---------- */
function mockPaidState() {
    if (!MOCK.paid) {
        MOCK.paid = {
            account: { username: '', user_id: '', token: '' },
            entitlement: 'unknown',
            licenseLast4: '',
            deviceBound: 0,
            lease: null,
            orders: [],
            orderPolls: 0,
            premium: { installed: false, version: '', sha256: '' },
            packages: [{
                id: 1, pkg: 'touch-premium', version: '1.0.0', version_code: 100,
                sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
                file_size: 93472, status: 'active', compatible: true
            }]
        };
    }
    return MOCK.paid;
}

function mockLeaseObject() {
    var expires = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    return {
        scope: 'touch.sampling',
        key_id: 'display-lease-2026-08-prod',
        expires_at: expires,
        features: ['touch_sampling'],
        device_id_hash: 'mock-device-hash',
        signature: 'mock-signature'
    };
}

function mockPaidAccountJson() {
    var st = mockPaidState();
    var lease = st.lease || {};
    var remaining = 0;
    var days = 0;
    if (lease.expires_at) {
        remaining = Math.max(0, Math.floor((Date.parse(lease.expires_at) - Date.now()) / 1000));
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
        lease_expires_at: lease.expires_at || '',
        lease_remaining_seconds: remaining,
        lease_days_left: days,
        lease_valid: remaining > 0 ? 1 : 0,
        features: lease.features || [],
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
            soc_model: 'SM8850', build_fingerprint: 'realme/RMX5200/mock:17', base_version: 'v5.0', kernel: '6.1.0'
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
        var methodMatch = c.match(/api_request\s+(GET|POST)\s+"([^"]*)"/);
        var method = methodMatch ? methodMatch[1] : 'GET';
        var path = methodMatch ? methodMatch[2] : '';
        var payloadB64 = '';
        var pb = c.match(/"(GET|POST)"\s+"[^"]*"\s+[01]\s+"([^"]*)"/);
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
                pay_amount: 3, status: 'pending', product_name: '慕容触控采样率 授权'
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
                st.licenseLast4 = 'MOCK';
                st.deviceBound = 1;
                st.lease = mockLeaseObject();
                return Promise.resolve(JSON.stringify({ success: true, data: {
                    status: 'paid', payment_data: { card_key: 'MOCK-CARD-0000-0000-0000' }
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
                device_bound: !!st.deviceBound, features: st.entitlement === 'active' ? ['touch_sampling'] : []
            } }));
        }
        if (path.indexOf('v1/touch/licenses/activate') >= 0) {
            st.entitlement = 'active';
            st.licenseLast4 = 'CARD';
            st.deviceBound = 1;
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
            var list = st.licenseLast4 ? [{
                key_last4: st.licenseLast4, status: st.entitlement,
                device_model: 'RMX5200', bound_at: new Date().toISOString()
            }] : [];
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
    var headerPrimary = $('btn-header-primary'); if (headerPrimary) headerPrimary.addEventListener('click', headerPrimaryAction);
    var headerSecondary = $('btn-header-secondary'); if (headerSecondary) headerSecondary.addEventListener('click', headerSecondaryAction);
}

function bindConfigControls() {
    document.querySelectorAll('#global-rate-pills [data-global-rate]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            APP.config.global = parseInt(btn.dataset.globalRate, 10) || 0;
            markDirty();
            updateGlobalDefault();
            updateConfigWarnings();
            scheduleConfigApply();
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
            else if (action === 'refresh-auth') refreshServerEntitlement().then(function () { refreshPaidState({ silent: true }); toast('授权状态已刷新', 'ok'); });
            else if (action === 'buy') showPurchaseOverlay();
            else if (action === 'check-order') checkPaidOrder();
            else if (action === 'licenses') showMyLicenses();
            else if (action === 'orders') showMyOrders();
            else if (action === 'download') downloadPremiumPackage();
            else if (action === 'feedback') {
                showPaidOverlay('反馈', '<p class="paid-hint">反馈请在酷安 @慕容雪绒（本入口仅文字说明，不跳转）。<br>反馈时请附：机型、系统版本、问题现象与日志页诊断包。</p>', [
                    { label: '关闭', className: 'btn-secondary', onClick: closePaidOverlay }
                ]);
            } else if (action === 'mock-expire') {
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
    bindAppRateSheet();
    bindBottomBar();
    bindBaseControls();
    bindConfigControls();
    bindLogControls();
    bindUserControls();

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
        mockPaidState: mockPaidState,
        mockPaidExec: mockPaidExec,
        refreshPaidState: refreshPaidState,
        loadPaidTab: loadPaidTab,
        updatePaidNotice: updatePaidNotice,
        paidAutoMaintenance: paidAutoMaintenance,        simpleHash: simpleHash,
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
