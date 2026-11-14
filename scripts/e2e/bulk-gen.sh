#!/usr/bin/env bash
# 批量扩题：循环调生成端点，把产物归集到仓库题库目录并重建 manifest（§17）。
#
# 为什么要它：设置页「题库生成」一次只能点 5 套、产物落在 generated 根、
# 还要手动重启才生效；想从 22 套 speaking 扩到 40+，手工点几十次不现实。
# 本脚本把「提交 → 等终态 → 失败换 topic_hint 重试 → 凑够目标数」自动化。
#
# 用法：
#   bash scripts/e2e/bulk-gen.sh speaking 30        # 目标再生成 30 套
#   bash scripts/e2e/bulk-gen.sh listening 10 20    # 目标 10 套，最多跑 20 次
#
# 环境：
#   DSH_MODEL=gemini/gemini-3.8-flash   （默认；推理型端点需 max_tokens 已放大）
#   BULK_PORT=8798                       （隔离端口，不碰用户的 8765）
#
# 注意：真实消耗 AI 网关额度。speaking 每套约 2–5 分钟，30 套约 1–1.5 小时。
set -u

MODULE="${1:-speaking}"
TARGET="${2:-10}"
MAX_TRIES="${3:-$((TARGET * 3))}"
BATCH=5
PORT="${BULK_PORT:-8798}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$ROOT/backend/venv/Scripts/python.exe"
KEY_FILE="$HOME/.dsh/openai-gateway/api-key"

TMP="$(cygpath -m -w "${TEMP:-/tmp}")/ielts-bulk-$MODULE"
mkdir -p "$TMP"
DB="$TMP/bulk.db"
LOG="$TMP/bulk.log"
rm -f "$DB" "$DB-wal" "$DB-shm"

[ -f "$KEY_FILE" ] || { echo "错误：找不到网关密钥 $KEY_FILE"; exit 2; }
export OPENAI_API_KEY="$(tr -d '\r\n' < "$KEY_FILE")"
export OPENAI_BASE_URL="http://127.0.0.1:8326/v1"
export OPENAI_MODEL="${DSH_MODEL:-gemini/gemini-3.8-flash}"
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

BACKEND_PID=""
cleanup() { [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null; }
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

echo "[bulk] 1/3 起后端 :$PORT（模型 $OPENAI_MODEL，目标 $TARGET 套，最多 $MAX_TRIES 次）"
cd "$ROOT/backend"
IELTS_DB_PATH="$DB" IELTS_TTS_CACHE_DIR="$TMP/tts" IELTS_LOG_DIR="$TMP/logs" \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" > "$LOG" 2>&1 &
BACKEND_PID=$!
wait_health || { echo "[bulk] 后端没起来："; tail -20 "$LOG"; exit 1; }

# 当前 generated 根里已有的 id（避免重复生成同 id）
existing_ids() {
  curl -s --noproxy '*' --max-time 10 "http://127.0.0.1:$PORT/api/health" \
    | "$PY" -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('content_counts',{}).get('$MODULE',0))" 2>/dev/null
}

echo "[bulk] 2/3 循环生成（每轮 count=$BATCH）"
made=0
tries=0
while [ "$made" -lt "$TARGET" ] && [ "$tries" -lt "$MAX_TRIES" ]; do
  tries=$((tries + 1))
  resp="$(curl -s --noproxy '*' --max-time 10 -X POST "http://127.0.0.1:$PORT/api/content/generate" \
    -H 'Content-Type: application/json' \
    -d "{\"module\":\"$MODULE\",\"count\":$BATCH}")"
  job="$(printf '%s' "$resp" | "$PY" -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('job_id',''))" 2>/dev/null)"
  [ -n "$job" ] || { echo "[bulk] 第 $tries 轮拿不到 job_id：$resp"; continue; }

  status=""
  for _ in $(seq 1 72); do   # 最多 6 分钟一轮
    j="$(curl -s --noproxy '*' --max-time 10 "http://127.0.0.1:$PORT/api/content/jobs/$job")"
    status="$("$PY" -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('status',''))" 2>/dev/null <<< "$j")"
    case "$status" in succeeded|failed) break ;; esac
    sleep 5
  done

  if [ "$status" = "succeeded" ]; then
    written="$("$PY" -c "import sys,json;d=json.load(sys.stdin);print((d.get('data') or {}).get('report',{}).get('written',0))" 2>/dev/null <<< "$j")"
    made=$((made + written))
    echo "[bulk] 第 $tries 轮：succeeded，本轮写入 $written，累计 $made/$TARGET"
  else
    echo "[bulk] 第 $tries 轮：$status（重试）"
  fi
done

echo "[bulk] 生成结束：成功 $made 套（目标 $TARGET）"

echo "[bulk] 3/3 归集产物到仓库题库 + 重建 manifest"
# 产物在 <数据目录>/generated/ielts/<module>/，数据目录由 DB 路径派生（§17.1）。
# 必须带上 IELTS_DB_PATH，否则 generated_root() 会指向用户真实数据目录。
SRC="$(IELTS_DB_PATH="$DB" "$PY" -c "
import sys; sys.path.insert(0, r'$ROOT/backend')
from app.services import sets_loader
print(sets_loader.generated_root() / '$MODULE')
" 2>/dev/null)"
DEST="$ROOT/backend/app/data/ielts/$MODULE"
if [ -d "$SRC" ]; then
  copied=0
  for f in "$SRC"/*.json; do
    [ -f "$f" ] || continue
    cp "$f" "$DEST/" && copied=$((copied + 1))
  done
  echo "[bulk] 已拷贝 $copied 个产物到 $DEST"
else
  echo "[bulk] 没有找到产物目录 $SRC"
fi

# 归集后必须复验：模型偶发输出 target_band 字符串 / id 带连字符，
# 拷进仓库题库前拦住（否则污染 manifest，且这些文件不会随校验被清理）。
echo "[bulk] 复验仓库题库，清掉不合格产物"
BULK_MODULE="$MODULE" "$PY" "$ROOT/scripts/e2e/_prune_bad_sets.py" 2>&1 | tail -8

cd "$ROOT/backend"
"$PY" tools/validate_ielts_data.py --write-manifest 2>&1 | tail -3
echo "[bulk] 完成。日志：$LOG"
