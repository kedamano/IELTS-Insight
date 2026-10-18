"""计划引擎（契约 §1 行 29–30；FR-P2 / AC-P2）。

确定性要求：**同一 settings + 同一 attempts + 同一天 ⇒ 同一输出**，日期是唯一变量。
因此不使用随机数、不依赖 dict 迭代顺序，集合顺序一律按 set id 排序，
tie-break 一律按模块名排序。

权重规则（差距越大权重越高）：
- 该科有历史 band：`weight = max(target_band - current_band, MAINTENANCE_FLOOR)`
  （已达标的科保留 0.25 的「保持手感」权重，避免它永远排不进今日任务）
- 该科从未练过：`weight = UNKNOWN_WEIGHT`（1.0，先摸底）
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Optional

from fastapi import APIRouter, Body, Query

from app.api.common import bad_request, not_found, ok
from app.db import store

router = APIRouter(tags=["plan"])

MAINTENANCE_FLOOR = 0.25
UNKNOWN_WEIGHT = 1.0
MIN_TASKS = 3
MAX_TASKS = 8
DEFAULT_TASK_COUNT = 5

_MODULE_ORDER = tuple(sorted(store.MODULES))  # listening, reading, speaking, writing


def _day_ordinal(day: str) -> int:
    return _dt.date.fromisoformat(day).toordinal()


def _task_count(daily_goal_minutes: Any) -> int:
    """每日任务数由练习时长目标推导（默认 60 分钟 → 5 个任务）。"""
    try:
        minutes = float(daily_goal_minutes)
    except (TypeError, ValueError):
        minutes = 60.0
    return max(MIN_TASKS, min(MAX_TASKS, int(round(minutes / 12.0)) or DEFAULT_TASK_COUNT))


def _weights(target_band: float, current: dict[str, Optional[float]]) -> dict[str, float]:
    weights: dict[str, float] = {}
    for module in _MODULE_ORDER:
        band = current.get(module)
        if band is None:
            weights[module] = UNKNOWN_WEIGHT
        else:
            weights[module] = max(float(target_band) - float(band), MAINTENANCE_FLOOR)
    return weights


def _allocate(weights: dict[str, float], slots: int) -> dict[str, int]:
    """按权重整数分配 slots 个任务（最大余数法；余数相同按模块名排序 → 确定性）。"""
    total = sum(weights.values()) or 1.0
    exact = {module: slots * weight / total for module, weight in weights.items()}
    base = {module: int(exact[module] // 1) for module in weights}
    remaining = slots - sum(base.values())
    order = sorted(weights, key=lambda m: (-(exact[m] - base[m]), m))
    for module in order[: max(0, remaining)]:
        base[module] += 1
    return base


def _reason_zh(module: str, gap: Optional[float], target_band: float, current_band: Optional[float]) -> str:
    label = {"speaking": "口语", "listening": "听力", "reading": "阅读", "writing": "写作"}.get(module, module)
    if current_band is None:
        return f"{label}尚无练习记录，先做一套摸底（目标 {target_band}）"
    if gap is not None and gap >= 1.0:
        return f"{label}当前 {current_band}，距目标 {target_band} 差 {round(gap, 1)}，今日重点"
    if gap is not None and gap > 0:
        return f"{label}当前 {current_band}，距目标 {target_band} 还差 {round(gap, 1)}"
    return f"{label}已达目标 {target_band}，保持手感"


def _pick_set(module: str, desired_band: float, day: str, index: int) -> Optional[str]:
    """在该科题库里选一个 set：优先难度贴近当前水平，再按日期轮转（同输入同输出）。"""
    candidates = store.list_sets(module)
    if not candidates:
        return None
    ranked = sorted(
        candidates,
        key=lambda s: (
            abs(float(s.get("target_band") or desired_band) - desired_band),
            str(s.get("id")),
        ),
    )
    offset = (_day_ordinal(day) + index) % len(ranked)
    return ranked[offset].get("id")


def build_plan(day: str) -> list[dict[str, Any]]:
    raw = store.get_settings()
    target_band = float(raw.get("target_band") or 6.5)
    current = store.latest_band_per_module()
    slots = _task_count(raw.get("daily_goal_minutes"))
    weights = _weights(target_band, current)
    allocation = _allocate(weights, slots)

    tasks: list[dict[str, Any]] = []
    for module in _MODULE_ORDER:
        for index in range(allocation.get(module, 0)):
            band = current.get(module)
            gap = None if band is None else target_band - float(band)
            set_ref = _pick_set(module, float(band) if band is not None else target_band, day, index)
            if set_ref is None:
                continue  # 题库未就绪（内容 agent 尚在生成）→ 不产出无法执行的任务
            tasks.append(
                {
                    "id": f"pt_{day.replace('-', '')}_{module}_{index + 1}",
                    "module": module,
                    "set_ref": set_ref,
                    "reason_zh": _reason_zh(module, gap, target_band, band),
                }
            )
    return tasks


@router.get("/plan/today")
def plan_today(date: Optional[str] = Query(None, description="YYYY-MM-DD，默认今天")):
    day = date or store.today_local()
    try:
        _dt.date.fromisoformat(day)
    except ValueError:
        raise bad_request("date 格式应为 YYYY-MM-DD") from None
    tasks = build_plan(day)
    stored = store.upsert_plan_tasks(day, tasks)
    return ok({"items": stored, "generated_at": store.utc_now_iso()})


@router.post("/plan/{task_id}/done")
def mark_plan_done(task_id: str, payload: dict = Body(...)):
    if not isinstance(payload, dict) or "done" not in payload:
        raise bad_request("请求体应包含 done: true/false")
    done = bool(payload["done"])
    if store.set_plan_task_done(task_id, done) is None:
        raise not_found("今日任务不存在")
    return ok({"ok": True})
