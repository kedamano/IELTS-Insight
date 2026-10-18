# scripts/build.ps1 — 打包：PyInstaller 后端 sidecar → 复制到 binaries → tauri build
# 用法： powershell -ExecutionPolicy Bypass -File scripts/build.ps1
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
Write-Step "PyInstaller：backend.spec（含 --add-data app/data，题库 app/data/ielts/** 随包）"
Push-Location $Backend
try {
    & $Pyi --noconfirm --clean backend.spec
    if ($LASTEXITCODE -ne 0) { Fail "PyInstaller 失败（exit $LASTEXITCODE）。检查上方日志是否缺模块/缺数据。" }
}
finally { Pop-Location }
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
