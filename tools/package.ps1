<#
.SYNOPSIS
    构建「慕容触控采样率」免费模块 zip（Windows 本地打包；CI 用 tools/package.sh）。

.DESCRIPTION
    与 tools/package.sh 功能等价：
      1. 校验 module/ 必需文件与付费组件泄漏断言（bin/touch_rate_daemon、*.c、*.ko、*.so 等一律拒绝）；
      2. 复制到临时 staging，文本文件统一 LF + 去 BOM（Android sh 不认 CRLF）；
      3. 用 .NET ZipArchive 打包，并给脚本/二进制写入 Unix 0755 权限（zip 外部属性），
         保证解压后 service.sh、bin/curl 等仍可执行；
      4. 输出 慕容触控采样率-v<version>.zip 与 .sha256。

.PARAMETER ModuleDir
    模块目录，默认 <repo>/module。

.PARAMETER Version
    版本号，默认读取 module/module.prop 的 version。

.PARAMETER OutDir
    输出目录，默认 <repo>/dist。

.EXAMPLE
    pwsh -File .\tools\package.ps1
#>
[CmdletBinding()]
param(
    [string]$ModuleDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'module'),
    [string]$Version,
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
if (-not $Version) {
    $Version = (Get-Content -LiteralPath (Join-Path $ModuleDir 'module.prop') |
        Where-Object { $_ -like 'version=*' } |
        Select-Object -First 1).Substring('version='.Length).Trim()
}
if (-not $Version) { throw '无法读取 module.prop 的 version' }
$zipName = "慕容触控采样率-v$Version.zip"
$zipPath = Join-Path $OutDir $zipName
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$required = @(
    'module.prop', 'service.sh', 'action.sh', 'uninstall.sh', 'common.sh', 'README.md',
    'bin/api.sh', 'bin/rate_ctl', 'bin/curl', 'bin/verify_lease_sig',
    'config/采样率.txt', 'config/rate.conf', 'config/legacy.conf',
    'config/set_rate.sh', 'config/restore_rate.sh',
    'config/auth/lease_public_key.hex', 'config/auth/lease_key_id.txt',
    'webroot/index.html', 'webroot/css/style.css', 'webroot/js/app.js'
)
foreach ($rel in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $ModuleDir $rel))) { throw "缺少必需文件: $rel" }
}

# 付费组件泄漏断言：公开仓/公开 Release 只能有免费模块
$leakExact = @(
    'bin/touch_rate_daemon', 'src', 'daemon.c',
    'config/auth/account.json', 'config/auth/lease.json',
    'config/auth/state.json', 'config/auth/device_id.txt', 'config/auth/device_identity.json'
)
foreach ($rel in $leakExact) {
    if (Test-Path -LiteralPath (Join-Path $ModuleDir $rel)) {
        throw "付费/运行态内容泄漏到公开模块: $rel"
    }
}
$leakFiles = Get-ChildItem -LiteralPath $ModuleDir -Recurse -File -Include '*.c', '*.h', '*.ko', '*.so', '*.dex', '*.apk' -ErrorAction SilentlyContinue
if ($leakFiles) { throw "付费/私有二进制或源码泄漏到公开模块: $($leakFiles[0].FullName)" }

# ---- staging ----
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("murongtouch-pkg-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
try {
    Copy-Item -Path (Join-Path $ModuleDir '*') -Destination $stage -Recurse -Force

    $textExt = @('.sh', '.prop', '.txt', '.conf', '.json', '.html', '.css', '.js', '.md')
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
        if ($textExt -contains $_.Extension.ToLowerInvariant()) {
            $text = [System.IO.File]::ReadAllText($_.FullName)
            $text = $text.TrimStart([char]0xFEFF)
            $text = $text -replace "`r`n", "`n" -replace "`r", "`n"
            [System.IO.File]::WriteAllText($_.FullName, $text, $utf8NoBom)
        }
    }

    $executables = @(
        'service.sh', 'action.sh', 'uninstall.sh', 'common.sh',
        'bin/api.sh', 'bin/rate_ctl', 'bin/curl', 'bin/verify_lease_sig',
        'config/set_rate.sh', 'config/restore_rate.sh'
    )

    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    $archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files = Get-ChildItem -LiteralPath $stage -Recurse -File |
            ForEach-Object { $_.FullName.Substring($stage.Length + 1).Replace('\', '/') } |
            Sort-Object
        foreach ($rel in $files) {
            $srcPath = Join-Path $stage ($rel.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
            $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
            # zip 外部属性高 16 位 = Unix mode => 解压后保留可执行位
            $mode = if ($executables -contains $rel) { 0x81ED } else { 0x81A4 }  # 0100755 / 0100644
            $entry.ExternalAttributes = $mode -shl 16
            $inStream = [System.IO.File]::OpenRead($srcPath)
            try {
                $outStream = $entry.Open()
                try { $inStream.CopyTo($outStream) } finally { $outStream.Dispose() }
            } finally { $inStream.Dispose() }
        }
    } finally {
        $archive.Dispose()
    }
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 结构校验 ----
$zipArchive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $names = $zipArchive.Entries | ForEach-Object { $_.FullName }
    if ($names -notcontains 'module.prop') { throw 'zip 根目录缺少 module.prop' }
    if ($names -notcontains 'service.sh') { throw 'zip 根目录缺少 service.sh' }
    if ($names -notcontains 'webroot/index.html') { throw 'zip 缺少 webroot/index.html' }
    if ($names | Where-Object { $_ -like 'module/*' }) { throw 'zip 里套了 module/ 目录' }
    $banned = $names | Where-Object {
        $_ -like 'src/*' -or $_ -like '*touch_rate_daemon*' -or
        $_ -like '*.c' -or $_ -like '*.h' -or $_ -like '*.ko' -or $_ -like '*.so'
    }
    if ($banned) { throw "zip 内出现付费组件: $($banned -join ', ')" }
} finally {
    $zipArchive.Dispose()
}

# ---- sha256 ----
$sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$shaPath = "$zipPath.sha256"
[System.IO.File]::WriteAllText($shaPath, "$sha256  $zipName`n", (New-Object System.Text.UTF8Encoding($false)))
$size = (Get-Item -LiteralPath $zipPath).Length

Write-Host '== 免费模块打包完成 =='
Write-Host "  版本    : v$Version"
Write-Host "  zip     : $zipPath"
Write-Host "  大小    : $size bytes"
Write-Host "  sha256  : $sha256"
