# scripts/version-check.ps1 — 校验版本 2.0.0 在 三处 一致
# 覆盖：frontend/src-tauri/tauri.conf.json、frontend/src-tauri/Cargo.toml、frontend/package.json
$ErrorActionPreference = "Stop"
$Root     = Split-Path -Parent $PSScriptRoot
$Expected = "2.0.0"

function Read-TomlVersion($path) {
    $inPackage = $false
    foreach ($line in Get-Content $path) {
        if ($line -match '^\s*\[package\]\s*$') { $inPackage = $true; continue }
        if ($line -match '^\s*\[' ) { if ($inPackage) { $inPackage = $false } }
        if ($inPackage -and $line -match '^\s*version\s*=\s*"([^"]+)"') { return $Matches[1] }
    }
    return $null
}

$tauriConf = Join-Path $Root "frontend\src-tauri\tauri.conf.json"
$cargoToml = Join-Path $Root "frontend\src-tauri\Cargo.toml"
$pkgJson   = Join-Path $Root "frontend\package.json"

$results = @()

if (Test-Path $tauriConf) {
    $v = (Get-Content $tauriConf -Raw | ConvertFrom-Json).version
    $results += [pscustomobject]@{ File = "tauri.conf.json"; Version = $v }
} else { $results += [pscustomobject]@{ File = "tauri.conf.json"; Version = "<缺失>" } }

if (Test-Path $cargoToml) {
    $results += [pscustomobject]@{ File = "Cargo.toml"; Version = (Read-TomlVersion $cargoToml) }
} else { $results += [pscustomobject]@{ File = "Cargo.toml"; Version = "<缺失>" } }

if (Test-Path $pkgJson) {
    $results += [pscustomobject]@{ File = "package.json"; Version = (Get-Content $pkgJson -Raw | ConvertFrom-Json).version }
} else { $results += [pscustomobject]@{ File = "package.json"; Version = "<缺失>" } }

$results | Format-Table -AutoSize
$mismatch = $results | Where-Object { $_.Version -ne $Expected }
if ($mismatch) {
    Write-Host "[version-check] 版本不一致，期望 $Expected：" -ForegroundColor Red
    foreach ($m in $mismatch) { Write-Host ("  {0} = {1}" -f $m.File, $m.Version) -ForegroundColor Red }
    exit 1
}
Write-Host "[version-check] OK — 三处版本均为 $Expected" -ForegroundColor Green
