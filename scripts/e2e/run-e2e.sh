#!/usr/bin/env bash
# 四科真浏览器 E2E 的一键隔离栈（跑完自动清理）
#
# 用这三个端口，绝不碰用户的开发栈：
#   8799  后端（临时库 + 离线模式）
#   5173  前端生产构建（vite preview，端口必须 5173 —— 后端 CORS 白名单只放它）
#   9222  Chrome CDP（独立 profile）
#
# 用法：bash scripts/e2e/run-e2e.sh
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FRONTEND="$ROOT/frontend"
TMP="${TEMP:-${TMPDIR:-/tmp}}/ielts-e2e"
mkdir -p "$TMP"
# 必须转成绝对路径：store.quick_check() 用 path.as_uri() 开只读连接，相对路径会 ValueError。
# git-bash 的 $TEMP 是 /tmp（POSIX 路径），Windows 原生 python 需要 C:/... 形式（-m 给正斜杠）。
TMP_ABS="$(cygpath -m -w "$TMP" 2>/dev/null || echo "$TMP")"
case "$TMP_ABS" in
  [A-Za-z]:/*) : ;;                      # 已是 Windows 绝对路径
  *)           TMP_ABS="$ROOT/$(basename "$TMP")" ;;  # 兜底：仓库内同名目录
esac

PY="$ROOT/backend/venv/Scripts/python.exe"
CHROME="${CHROME_EXE:-C:/Program Files/Google/Chrome/Application/chrome.exe}"
CHROME_PROFILE="$TMP/profile"

cleanup() {
  echo ""
  echo "[e2e] 清理…"
  for pid in "${BACKEND_PID:-}" "${PREVIEW_PID:-}" "${CHROME_PID:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  # Chrome 是后台起的，按 profile 找进程收掉（绝不 Stop-Process 整个 chrome，
  # 那会连带杀掉用户自己开着的浏览器窗口）
  [ -n "${CHROME_PROFILE:-}" ] && powershell -Command \
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*$CHROME_PROFILE*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" 2>/dev/null
  echo "[e2e] 已清理"
}
trap cleanup EXIT

echo "[e2e] 1/3 起后端 :8799（临时库 + 离线）"
cd "$ROOT/backend"
IELTS_DB_PATH="$TMP_ABS/e2e.db" \
IELTS_TTS_CACHE_DIR="$TMP_ABS/tts" \
IELTS_LOG_DIR="$TMP_ABS/logs" \
IELTS_ONLINE=0 \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8799 > "$TMP/backend.log" 2>&1 &
BACKEND_PID=$!

# Windows 原生 curl.exe：用 -w 取 HTTP 状态码，`-s` 的退出码在部分版本下不可靠
ready=0
for i in $(seq 1 30); do
  code="$(curl -s --max-time 2 --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:8799/api/health)"
  [ "$code" = "200" ] && { ready=1; break; }
  sleep 1
done
[ "$ready" = "1" ] || {
  echo "[e2e] 后端没起来，日志："; tail -20 "$TMP/backend.log"; exit 1;
}
echo "[e2e] 后端就绪"

echo "[e2e] 2/3 构建 + 起 preview :5173"
cd "$FRONTEND"
VITE_API_BASE=http://127.0.0.1:8799/api npx vite build > "$TMP/build.log" 2>&1 || {
  echo "[e2e] 构建失败："; tail -20 "$TMP/build.log"; exit 1;
}
npx vite preview --port 5173 --host 127.0.0.1 > "$TMP/preview.log" 2>&1 &
PREVIEW_PID=$!
ready=0
for i in $(seq 1 20); do
  code="$(curl -s --max-time 2 --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/)"
  [ "$code" = "200" ] && { ready=1; break; }
  sleep 1
done
[ "$ready" = "1" ] || { echo "[e2e] preview 没起来："; tail -20 "$TMP/preview.log"; exit 1; }
echo "[e2e] preview 就绪"

echo "[e2e] 3/3 起 Chrome CDP :9222"
"$CHROME" --remote-debugging-port=9222 --user-data-dir="$CHROME_PROFILE" \
  --no-first-run --no-default-browser-check about:blank > /dev/null 2>&1 &
CHROME_PID=$!
ready=0
for i in $(seq 1 20); do
  code="$(curl -s --max-time 2 --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:9222/json/version)"
  [ "$code" = "200" ] && { ready=1; break; }
  sleep 1
done
[ "$ready" = "1" ] || { echo "[e2e] Chrome CDP 没起来"; exit 1; }
echo "[e2e] Chrome 就绪"

echo "[e2e] 跑用例…"
# 驱动脚本必须放在 frontend/ 下：ESM 的包解析基于脚本所在目录，
# playwright-core 只装在 frontend/node_modules，cd 到那里也救不了仓库根的脚本。
# canonical 版本在 scripts/e2e/，这里复制一份到 frontend/ 运行（不污染 git 跟踪）。
cp "$ROOT/scripts/e2e/drive-four-skills.mjs" "$FRONTEND/drive-four-skills.mjs"
( cd "$FRONTEND" && node drive-four-skills.mjs )
CODE=$?
rm -f "$FRONTEND/drive-four-skills.mjs" "$FRONTEND/e2e-final.png"
echo "[e2e] 退出码 $CODE"
exit $CODE
