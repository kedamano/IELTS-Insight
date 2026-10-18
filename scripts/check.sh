#!/usr/bin/env bash
# scripts/check.sh — 双端质量门（docs/specs/ielts/test-plan.md §0、CONSTITUTION §7-2）
# 顺序执行，第一个失败的 gate 即以非零码退出：
#   [1/3] npx tsc -b            前端类型门禁
#   [2/3] npm test              前端 vitest（含 msw 契约测试）
#   [3/3] pytest -m "not integration"   后端单测（--quick 时跳过）
# 用法： bash scripts/check.sh [--quick]
set -u

QUICK=0
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    -h|--help) echo "usage: bash scripts/check.sh [--quick]  (--quick 跳过后端 pytest)"; exit 0 ;;
    *) echo "[check.sh] 未知参数: $arg（支持 --quick）" >&2; exit 2 ;;
  esac
done

# 以本脚本位置解析仓库根目录：路径含中文，绝不硬编码绝对路径。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
PY="$ROOT/backend/venv/Scripts/python.exe"

gate_fail() {
  echo "" >&2
  echo "[check.sh] ✗ FAILED at $1" >&2
  exit 1
}

echo "[check.sh] repo root: $ROOT"
echo ""

echo "==> [1/3] TypeScript 类型门禁: npx tsc -b"
( cd "$FRONTEND" && npx tsc -b ) || gate_fail "gate 1 (frontend tsc)"
echo "    gate 1 OK"
echo ""

echo "==> [2/3] 前端测试: npm test (vitest run)"
( cd "$FRONTEND" && npm test ) || gate_fail "gate 2 (frontend vitest)"
echo "    gate 2 OK"
echo ""

if [ "$QUICK" = "1" ]; then
  echo "==> [3/3] 后端 pytest：已跳过（--quick）"
  echo ""
  echo "[check.sh] ALL GATES PASSED (quick)"
  exit 0
fi

echo "==> [3/3] 后端测试: pytest（addopts 已含 -q 与 -m \"not integration\"，见 backend/pytest.ini）"
if [ ! -f "$PY" ]; then
  echo "[check.sh] 找不到后端虚拟环境: $PY" >&2
  echo "           请先按 backend/requirements-dev.txt 创建 venv，或改用 --quick" >&2
  exit 1
fi
export PYTHONIOENCODING=utf-8
# 注意：不要在命令行再补 -q / -m，pytest.ini addopts 已声明；重复 -q 会变成 -qq，
# 导致最后一行 "N passed" 摘要被抑制，CI 日志里看不到计数。
( cd "$ROOT/backend" && "$PY" -m pytest ) || gate_fail "gate 3 (backend pytest)"
echo "    gate 3 OK"
echo ""

echo "[check.sh] ALL GATES PASSED"
