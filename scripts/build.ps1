# scripts/build.ps1 — 打包：PyInstaller 后端 sidecar → 复制到 binaries → tauri build
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/build.ps1              # 默认：onefile + NSIS 安装包
#   powershell -ExecutionPolicy Bypass -File scripts/build.ps1 -Onedir      # 便携目录布局（首启 ~2s，不产安装包）
# -Onedir 的取舍（契约 §11）：Tauri externalBin 只收**单个文件**，onedir 的 `_internal/`
# 进不了 sidecar 位置，所以 onedir 走「便携目录」分发：外壳 exe（前端资源已内嵌）+
# backend exe + _internal 并排放在 dist-portable\ 下，双击即用、首启不再解包。
# NSIS 安装包路径不受这个开关影响，仍是 onefile。
# ⚠ 本文件必须以 **UTF-8 with BOM** 保存（契约 §11.2）：Windows PowerShell 5.1 读不到
#   BOM 时会按 GBK 解析中文注释/字符串并当场报语法错。上面第一行的不可见字符就是 BOM。
param([switch]$Onedir)
$ErrorActionPreference = "Stop"

# 需要 Windows PowerShell 5.1 或 PowerShell 7 均有；Stop-Process -Tree 需 PS7，下面有回退。
$Root     = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$VenvPy   = Join-Path $Backend "venv\Scripts\python.exe"
$Pyi      = Join-Path $Backend "venv\Scripts\pyinstaller.exe"
$TargetTriple = "x86_64-pc-windows-msvc"
$SidecarDest  = Join-Path $Frontend "src-tauri\binaries\backend-$TargetTriple.exe"
$DistExe      = Join-Path $Backend "dist\backend.exe"

function Write-Step($m) { Write-Host "[build] $m" -ForegroundColor Cyan }
function Write-Err($m)  { Write-Host "[build][ERROR] $m" -ForegroundColor Red }
function Fail($m) { Write-Err $m; exit 1 }

# ---- 预检 ----
if (-not (Test-Path $VenvPy)) { Fail "缺少后端虚拟环境 $VenvPy（请先建 venv 并 pip install -r requirements.txt）" }
if (-not (Test-Path $Pyi))    { Fail "缺少 PyInstaller：$Pyi。请执行  .\venv\Scripts\python.exe -m pip install pyinstaller" }

# ---- 只结束【本项目路径下】遗留的 backend.exe，避免锁定 sidecar 文件导致拷贝/覆盖失败 ----
# 绝不做宽泛 taskkill：只匹配 ExecutablePath 落在本仓库内的进程。
Write-Step "预检：清理本仓库遗留的 backend 进程（不触碰同名外部进程）"
$targets = @("backend.exe", "backend-$TargetTriple.exe")
try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='backend.exe' OR Name='backend-$TargetTriple.exe'" -ErrorAction Stop
} catch {
    $procs = @()
}
foreach ($proc in $procs) {
    $exePath = $proc.ExecutablePath
    if ($exePath -and $exePath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Host ("  结束 PID {0} ({1})" -f $proc.ProcessId, $exePath) -ForegroundColor Yellow
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host ("  跳过非本项目同名进程 PID {0} ({1})" -f $proc.ProcessId, $exePath) -ForegroundColor DarkGray
    }
}

# ---- 1) PyInstaller ----
if ($Onedir) {
    Write-Step "PyInstaller：onedir 布局（IELTS_PYI_LAYOUT=onedir，首启不解包）"
} else {
    Write-Step "PyInstaller：backend.spec（含 --add-data app/data，题库 app/data/ielts/** 随包）"
}
Push-Location $Backend
try {
    if ($Onedir) { $env:IELTS_PYI_LAYOUT = "onedir" } else { $env:IELTS_PYI_LAYOUT = "onefile" }
    & $Pyi --noconfirm --clean backend.spec
    if ($LASTEXITCODE -ne 0) { Fail "PyInstaller 失败（exit $LASTEXITCODE）。检查上方日志是否缺模块/缺数据。" }
}
finally { Pop-Location }

if ($Onedir) {
    $DistDir = Join-Path $Backend "dist\backend"
    $DistExeOnedir = Join-Path $DistDir "backend.exe"
    if (-not (Test-Path $DistExeOnedir)) { Fail "未找到 onedir 产物 $DistExeOnedir" }

    # ---- 2a) 便携目录：外壳 exe + backend.exe + _internal 并排 ----
    Write-Step "组装便携目录 dist-portable\"
    Push-Location $Frontend
    try {
        if (-not (Test-Path "node_modules")) { Write-Step "npm install"; npm install; if ($LASTEXITCODE -ne 0) { Fail "npm install 失败" } }
        Write-Step "npm run build（tsc -b && vite build）"
        npm run build
        if ($LASTEXITCODE -ne 0) { Fail "前端构建失败（tsc/vite）。修红后再打包。" }
        Write-Step "npm run tauri build（外壳 exe 会内嵌前端资源；安装包这次用不到）"
        npm run tauri build
        if ($LASTEXITCODE -ne 0) { Fail "tauri build 失败（Rust/NSIS）。" }
    }
    finally { Pop-Location }

    $Portable = Join-Path $Root "dist-portable"
    if (Test-Path $Portable) { Remove-Item $Portable -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Portable | Out-Null
    $ShellExe = Join-Path $Frontend "src-tauri\target\release\ielts-insight.exe"
    if (-not (Test-Path $ShellExe)) { Fail "未找到外壳 exe：$ShellExe" }
    Copy-Item $ShellExe -Destination $Portable -Force
    # sidecar 的**运行时名字**是 `backend.exe`（与外壳同目录）：`-<target-triple>` 后缀只是
    # externalBin 的构建期源文件名，`tauri build` 复制进 target\release 时就叫 `backend.exe`
    # （便携布局第一版拷成 triple 全名，外壳当场「启动后端 sidecar 失败: 系统找不到指定的文件」，
    # 是 shelllog 的 stdout 副本抓到的）。`_internal` 必须与 backend.exe 并排（PyInstaller 约定）。
    Copy-Item $DistExeOnedir -Destination (Join-Path $Portable "backend.exe") -Force
    Copy-Item (Join-Path $DistDir "_internal") -Destination $Portable -Recurse -Force
    # ⚠ 便携目录若建在被 harness 沙箱接管过的工作区里，会继承「Everyone 拒绝创建子目录」，
    # WebView2 要在 exe 旁建用户数据目录，建不出来就**卡在初始化、窗口永不出现**
    # （本机实拍踩过：dist-portable 双击无反应，同份文件拷到工作区外立刻正常）。
    # 这里探测一次并给出可操作的提示，不静默交付一个双击打不开的目录。
    $aclText = (icacls $Portable 2>$null) -join ' '
    if ($aclText -match 'DENY' -and $aclText -match '\(DC\)') {
        Write-Host "`n[build][警告] $Portable 继承了「拒绝创建子目录」的权限项，双击可能打不开窗口。" -ForegroundColor Yellow
        Write-Host "        把它整个拷到工作区外（例如 %USERPROFILE%\Desktop）再双击即可。" -ForegroundColor Yellow
    }
    Write-Host "`n[build] 完成（onedir 便携布局）。双击 $Portable\ielts-insight.exe 即用，首启不再解包。" -ForegroundColor Green
    Write-Host "        注意：便携布局不产 NSIS 安装包；安装包请跑不带 -Onedir 的 build.ps1。" -ForegroundColor DarkGray
    exit 0
}

if (-not (Test-Path $DistExe)) { Fail "未找到产物 $DistExe，spec 的 EXE name 是否为 'backend'？" }

# ---- 2) 复制为 Tauri sidecar 命名 ----
Write-Step "复制 sidecar → $SidecarDest"
$binDir = Split-Path -Parent $SidecarDest
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Force -Path $binDir | Out-Null }
try {
    Copy-Item -Path $DistExe -Destination $SidecarDest -Force
} catch {
    Fail "复制 sidecar 失败（多半是旧 exe 仍被占用）。请关闭正在运行的 IELTS Insight 后重试。原始错误：$($_.Exception.Message)" }

# ---- 3) 前端构建 + tauri build ----
Push-Location $Frontend
try {
    if (-not (Test-Path "node_modules")) { Write-Step "npm install"; npm install; if ($LASTEXITCODE -ne 0) { Fail "npm install 失败" } }
    Write-Step "npm run build（tsc -b && vite build）"
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail "前端构建失败（tsc/vite）。修红后再打包。" }

    Write-Step "npm run tauri build（会启用 custom-protocol，产出安装包）"
    # 注意：不要直接 `cargo build --release`——不带 custom-protocol 会得到卡在 ERR_CONNECTION_REFUSED 的空窗口。
    npm run tauri build
    if ($LASTEXITCODE -ne 0) { Fail "tauri build 失败（Rust/NSIS）。查看 frontend/src-tauri/target/release 与上方日志。" }
}
finally { Pop-Location }

Write-Host "`n[build] 完成。安装包在 frontend/src-tauri/target/release/bundle/nsis/ 下。" -ForegroundColor Green
