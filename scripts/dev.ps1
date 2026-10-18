# scripts/dev.ps1 — 开发模式：本地引擎(uvicorn --reload) + 前端(vite)
# 用法： powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
#       （或 pwsh scripts/dev.ps1）
$ErrorActionPreference = "Stop"

# ---- 路径 ----
$Root      = Split-Path -Parent $PSScriptRoot      # 仓库根
$Backend   = Join-Path $Root "backend"
$Frontend  = Join-Path $Root "frontend"
$VenvPy    = Join-Path $Backend "venv\Scripts\python.exe"
$Port      = if ($env:API_PORT) { $env:API_PORT } else { "8765" }

function Write-Step($m) { Write-Host "[dev] $m" -ForegroundColor Cyan }
function Write-Err($m)  { Write-Host "[dev][ERROR] $m" -ForegroundColor Red }

# ---- 预检：venv python 必须存在 ----
if (-not (Test-Path $VenvPy)) {
    Write-Err "找不到后端虚拟环境：$VenvPy"
    Write-Host "先创建并安装依赖：" -ForegroundColor Yellow
    Write-Host '  cd backend ; py -3.13 -m venv venv ; .\venv\Scripts\python.exe -m pip install -r requirements.txt'
    exit 1
}

# ---- 预检：8765 是否被占用（可能是上次未退出的打包版 sidecar）----
try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
    if ($listener) {
        $owningPids = $listener | Select-Object -ExpandProperty OwningProcess -Unique
        Write-Err "端口 $Port 已在监听（PID: $($owningPids -join ', ')）。"
        Write-Host "可能是上一个 IELTS Insight 实例未退出。请关闭它后重试；本脚本【不会】擅自结束陌生进程。" -ForegroundColor Yellow
        foreach ($procId in $owningPids) {
            $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($p) { Write-Host ("  PID {0} = {1} ({2})" -f $p.Id, $p.ProcessName, $p.Path) }
        }
        exit 1
    }
} catch [Microsoft.PowerShell.CmdletizationExceptions.ParentContainsErrorRecordException] {
    # Get-NetTCPConnection 抛错通常等价于“无匹配监听”，继续
} catch {
    Write-Step "端口占用检查跳过（$($_.Exception.Message)）"
}

# ---- 环境变量（后端 config 读取；此处仅给开发默认值）----
$env:IELTS_ONLINE = if ($env:IELTS_ONLINE) { $env:IELTS_ONLINE } else { "true" }
# DB / TTS 路径由 backend/app/config.py 决定（默认 %LOCALAPPDATA%\IELTSInsight）。
# 若想让开发数据落到临时目录，可先设置 $env:IELTS_DB_PATH 再运行本脚本。

# ---- 启动后端（独立进程，日志单窗）----
Write-Step "启动后端：uvicorn app.main:app --reload (127.0.0.1:$Port)"
$backendProc = Start-Process -FilePath $VenvPy `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", $Port) `
    -WorkingDirectory $Backend -PassThru

try {
    # ---- 前端依赖检查 ----
    if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
        Write-Step "首次运行：安装前端依赖 npm install"
        Push-Location $Frontend
        npm install
        Pop-Location
    }

    Write-Step "启动前端：vite (devUrl http://localhost:5173)"
    Write-Host "浏览器/桌面调试请用：npm run tauri dev（需 Rust）；纯 Web 调试直接访问 http://localhost:5173" -ForegroundColor DarkGray
    Push-Location $Frontend
    # vite 前台运行，Ctrl+C 只停 vite；finally 里再停后端
    npm run dev
}
finally {
    if ($backendProc -and -not $backendProc.HasExited) {
        Write-Step "停止后端进程树 PID=$($backendProc.Id)"
        # --reload 会派生子进程：结束整个进程树，且只针对本脚本刚启动的 PID
        try { Stop-Process -Id $backendProc.Id -Tree -Force -ErrorAction Stop }
        catch { Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue }
    }
    Write-Step "dev 结束。"
}
