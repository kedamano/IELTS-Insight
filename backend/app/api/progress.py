"""报告与概览端点（契约 §1 行 26–28；FR-P1/FR-P3）。

关键修复：这些数字**全部实时从 `attempts` 表算出**（旧实现读永远为空的
`learning_records`/`practice_records`，所以学习统计恒为 0）。
"""

from __future__ import annotations

import datetime as _dt
from typing import Optional

from fastapi import APIRouter, Query

from app.api.common import bad_request, ok
from app.db import store

router = APIRouter(tags=["progress"])


def _days_left(exam_date: Optional[str]) -> Optional[int]:
    if not exam_date:
        return None
    try:
        exam = _dt.date.fromisoformat(exam_date)
    except ValueError:
        return None
    return (exam - _dt.date.today()).days  # 负数 = 考试日已过


def _delta(current: dict[str, Optional[float]], previous: dict[str, Optional[float]]) -> dict[str, Optional[float]]:
    out: dict[str, Optional[float]] = {}
    for module in store.MODULES:
        cur, prev = current.get(module), previous.get(module)
        out[module] = round(cur - prev, 2) if (cur is not None and prev is not None) else None
    return out


@router.get("/progress/summary")
def progress_summary():
    raw = store.get_settings()
    current = store.latest_band_per_module()
    previous = store.previous_band_per_module()
    return ok(
        {
            "target_band": raw.get("target_band"),
            "exam_date": raw.get("exam_date"),
            "days_left": _days_left(raw.get("exam_date")),
            "current": current,
            # 每科「相比上一次」的 band 变化；与 current 同键，前端可按科显示箭头
            "delta_vs_previous": _delta(current, previous),
            "attempts_total": store.attempts_total(),
            "minutes_total": store.total_minutes(),
            "last_practice_at": store.last_practice_at(),
        }
    )


def _check_module(module: Optional[str]) -> Optional[str]:
    if module in (None, ""):
        return None
    if module not in store.MODULES:
        raise bad_request(f"module 只能是 {', '.join(store.MODULES)}")
    return module


@router.get("/progress/trend")
def progress_trend(
    module: Optional[str] = Query(None),
    days: int = Query(90, ge=1, le=36600),
):
    checked = _check_module(module)
    points = store.trend(checked, days=days) if checked else store.composite_trend(days)
    return ok({"points": points})


@router.get("/progress/analytics")
def progress_analytics(weeks: int = Query(8, ge=1, le=52)):
    return ok(
        {
            "by_question_type": store.question_type_accuracy(weeks),
            # 分科正确率：报告屏的「阅读 78% / 听力 82%」两块磁贴用它（题型表推不出科目）
            "by_module": store.module_accuracy(weeks),
            "by_error_type": store.error_type_stats(weeks),
            "minutes_by_day": store.minutes_by_day(weeks),
        }
    )
