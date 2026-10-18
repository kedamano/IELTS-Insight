"""练习存档端点（契约 §1 行 23–25；FR-P4）。

数据源是 `attempts` 表 —— 也就是各模块 attempt 落库后自然可查的存档。
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from app.api.common import bad_request, not_found, ok
from app.db import store

router = APIRouter(tags=["attempts"])


def _check_module(module: Optional[str]) -> Optional[str]:
    if module is None or module == "":
        return None
    if module not in store.MODULES:
        raise bad_request(f"module 只能是 {', '.join(store.MODULES)}")
    return module


@router.get("/attempts")
def list_attempts(
    module: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    items, total = store.list_attempts(_check_module(module), limit=limit, offset=offset)
    return ok({"items": items, "total": total})


@router.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: str):
    record = store.get_attempt(attempt_id)
    if not record:
        raise not_found("练习记录不存在")
    return ok({"attempt": record["attempt"], "payload": record["payload"]})


@router.delete("/attempts/{attempt_id}")
def delete_attempt(attempt_id: str):
    """删除单条并重算当天练习时长（趋势由 attempts 实时算出，因此随之更新）。"""
    if not store.delete_attempt(attempt_id):
        raise not_found("练习记录不存在")
    return ok({"deleted": True})
