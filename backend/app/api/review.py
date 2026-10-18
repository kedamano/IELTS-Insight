"""错题本端点（契约 §1 行 31–33；FR-V2 / AC-V2）。

默认只显示未解决的错题（`status=open`）；`status=all` 看全部，`status=resolved` 看已掌握。
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from app.api.common import bad_request, not_found, ok
from app.db import store

router = APIRouter(tags=["review"])

_STATUSES = ("open", "resolved", "all")


@router.get("/review/errors")
def review_errors(
    module: Optional[str] = Query(None),
    status: Optional[str] = Query("open"),
    error_type: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
):
    if module is not None and module not in store.MODULES:
        raise bad_request(f"module 只能是 {', '.join(store.MODULES)}")
    state = (status or "open").strip()
    if state not in _STATUSES:
        raise bad_request(f"status 只能是 {', '.join(_STATUSES)}")
    items = store.list_review_items(
        module=module, status=state, error_type=error_type, limit=limit
    )
    return ok({"items": items})


@router.post("/review/{item_id}/resolve")
def resolve(item_id: str):
    """手动标记「已掌握」（不再用旧的连续 3 次 80 分自动掌握）。"""
    row = store.resolve_review(item_id)
    if not row:
        raise not_found("错题不存在")
    return ok({"status": row["status"]})


@router.delete("/review/{item_id}")
def delete(item_id: str):
    if not store.delete_review(item_id):
        raise not_found("错题不存在")
    return ok({"deleted": True})
