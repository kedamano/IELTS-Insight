#!/usr/bin/env bash
# ② 真跑：listening/reading 生成端点在重 schema 上的「重启生效」验证（§17）
#
# 与 scripts/e2e 的分工：
#   e2e 跑 UI 全链路；本脚本只验内容生成管线在最重的两个 schema（listening 20/40 题、
#   reading 13 题 + 800–950 词篇章）上的端到端：提交 → job → 产物落 generated 根 →
#   **重启后端** → GET /listening/sets|reading/sets 读得到新题。
#
# 用 DSH 本地网关（127.0.0.1:8326，OpenAI 兼容）。凭据只从 ~/.dsh/openai-gateway/api-key
# 读进进程环境，绝不写日志、绝不回显（CONSTITUTION §3）。
#
# 用法：bash scripts/e2e/run-content-gen.sh [listening|reading|speak]
set -u

MODULE="${1:-listening}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$ROOT/backend/venv/Scripts/python.exe"

TMP="$(cygpath -m -w "${TEMP:-/tmp}")/ielts-gen-live"
mkdir -p "$TMP"

KEY_FILE="$HOME/.dsh/openai-gateway/api-key"
[ -f "$KEY_FILE" ] || { echo "错误：找不到网关密钥 $KEY_FILE"; exit 2; }
# 只读进变量，不 echo、不写盘
DSH_KEY="$(tr -d '\r\n' < "$KEY_FILE")"
export OPENAI_API_KEY="$DSH_KEY"
export OPENAI_BASE_URL="http://127.0.0.1:8326/v1"
export OPENAI_MODEL="${DSH_MODEL:-gemini/gemini-3.8-flash}"
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

PORT=8798
DB="$TMP/gen-$MODULE.db"
LOG="$TMP/gen-$MODULE.log"
rm -f "$DB" "$DB-wal" "$DB-shm"

cleanup() {
  for pid in "${BACKEND_PID:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
}
trap cleanup EXIT

wait_health() {
  local ready=0 code
  for _ in $(seq 1 40); do
    code="$(curl -s --max-time 2 --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health")"
    [ "$code" = "200" ] && { ready=1; break; }
    sleep 1
  done
  [ "$ready" = "1" ]
}

echo "[gen] 1/4 起后端 :$PORT（临时库 $DB，模型 $OPENAI_MODEL）"
cd "$ROOT/backend"
IELTS_DB_PATH="$DB" IELTS_TTS_CACHE_DIR="$TMP/tts" IELTS_LOG_DIR="$TMP/logs" \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" > "$LOG" 2>&1 &
BACKEND_PID=$!
wait_health || { echo "[gen] 后端没起来："; tail -20 "$LOG"; exit 1; }

echo "[gen] 2/4 提交生成任务（module=$MODULE, count=1）"
RESP="$(curl -s --noproxy '*' --max-time 10 -X POST "http://127.0.0.1:$PORT/api/content/generate" \
  -H 'Content-Type: application/json' \
  -d "{\"module\":\"$MODULE\",\"count\":1}")"
echo "[gen] 提交响应：$RESP"
JOB="$(printf '%s' "$RESP" | "$PY" -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('job_id',''))" 2>/dev/null)"
[ -n "$JOB" ] || { echo "[gen] 拿不到 job_id，放弃"; exit 1; }

echo "[gen] 3/4 等任务终态（最多 240s）"
STATUS=""
for _ in $(seq 1 48); do
  J="$(curl -s --noproxy '*' --max-time 10 "http://127.0.0.1:$PORT/api/content/jobs/$JOB")"
  STATUS="$("$PY" -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('status',''))" 2>/dev/null <<< "$J")"
  echo "    status=$STATUS"
  case "$STATUS" in succeeded|failed) break ;; esac
  sleep 5
done
echo "[gen] 终态：$STATUS"
printf '%s' "$J" > "$TMP/job-$MODULE.json"

echo "[gen] 4/4 重启后端，验证产物被装载"
kill "$BACKEND_PID" 2>/dev/null; wait "$BACKEND_PID" 2>/dev/null
IELTS_DB_PATH="$DB" IELTS_TTS_CACHE_DIR="$TMP/tts" IELTS_LOG_DIR="$TMP/logs" \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >> "$LOG" 2>&1 &
BACKEND_PID=$!
wait_health || { echo "[gen] 重启失败："; tail -20 "$LOG"; exit 1; }

COUNT="$(curl -s --noproxy '*' --max-time 10 "http://127.0.0.1:$PORT/api/health" \
  | "$PY" -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('content_counts',{}).get('$MODULE'))" 2>/dev/null)"
echo "[gen] 重启后 $MODULE content_counts=$COUNT"
echo "[gen] 日志位置：$LOG"
[ -n "$COUNT" ] && [ "$COUNT" -gt 0 ] && echo "[gen] OK：重启生效已验证" || echo "[gen] 未见新题（看 rejected 原因）"
