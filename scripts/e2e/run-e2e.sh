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

PY="$ROOT/backend/venv/Scripts/python.exe"
CHROME="${CHROME_EXE:-C:/Program Files/Google/Chrome/Application/chrome.exe}"
CHROME_PROFILE="$TMP/profile"

cleanup() {
  echo ""
  echo "[e2e] 清理…"
  for pid in "${BACKEND_PID:-}" "${PREVIEW_PID:-}" "${CHROME_PID:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  # Chrome 是后台起的，按 profile 找进程收掉
  [ -n "${CHROME_PROFILE:-}" ] && powershell -Command \
    "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { \$_.Path -eq '$CHROME' } | Stop-Process -Force" 2>/dev/null
  echo "[e2e] 已清理"
}
trap cleanup EXIT

echo "[e2e] 1/3 起后端 :8799（临时库 + 离线）"
cd "$ROOT/backend"
IELTS_DB_PATH="$TMP/e2e.db" \
IELTS_TTS_CACHE_DIR="$TMP/tts" \
IELTS_LOG_DIR="$TMP/logs" \
IELTS_ONLINE=0 \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8799 > "$TMP/backend.log" 2>&1 &
BACKEND_PID=$!

for i in $(seq 1 30); do
  curl -s --max-time 2 --noproxy '*' http://127.0.0.1:8799/api/health -o /dev/null && break
  sleep 1
done
curl -s --max-time 3 --noproxy '*' http://127.0.0.1:8799/api/health -o /dev/null || {
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
for i in $(seq 1 20); do
  curl -s --max-time 2 --noproxy '*' http://127.0.0.1:5173/ -o /dev/null && break
  sleep 1
done
echo "[e2e] preview 就绪"

echo "[e2e] 3/3 起 Chrome CDP :9222"
"$CHROME" --remote-debugging-port=9222 --user-data-dir="$CHROME_PROFILE" \
  --no-first-run --no-default-browser-check about:blank > /dev/null 2>&1 &
CHROME_PID=$!
for i in $(seq 1 20); do
  curl -s --max-time 2 --noproxy '*' http://127.0.0.1:9222/json/version -o /dev/null && break
  sleep 1
done
echo "[e2e] Chrome 就绪"

echo "[e2e] 跑用例…"
cd "$ROOT"
node scripts/e2e/drive-four-skills.mjs
CODE=$?
echo "[e2e] 退出码 $CODE"
exit $CODE
