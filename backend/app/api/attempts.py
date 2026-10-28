"""练习存档端点（契约 §1 行 23–25 + §14.4 回收站；FR-P4）。

数据源是 `attempts` 表 —— 也就是各模块 attempt 落库后自然可查的存档。

删除是**打标记**而不是删行：这是个人备考工具，「手滑删掉三个月的练习」是唯一不可挽回的
用户损失，所以列表和统计都不再显示它，但行留在库里，随时能从回收站恢复。
真正不可逆的 `purge` 额外要求「本机至少有一份快照」—— 没有退路时不允许清除。

⚠ 路由顺序：`/attempts/trash` 必须注册在 `/attempts/{attempt_id}` 之前，
否则 `trash` 会被当成一个 attempt id，回收站永远是空的。
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from app.api.common import CODE_CONFLICT, ApiError, bad_request, not_found, ok
from app.db import backup, store

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


@router.get("/attempts/trash")
def list_trash(
    module: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """回收站：给出摘要 + `deleted_at`，够用来决定「恢复还是清除」。"""
    items, total = store.list_attempts(_check_module(module), limit=limit, offset=offset, trashed=True)
    return ok({"items": items, "total": total})


@router.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: str):
    record = store.get_attempt(attempt_id)
    if not record:
        raise not_found("练习记录不存在或已在回收站中，恢复后可查看报告")
    return ok({"attempt": record["attempt"], "payload": record["payload"]})


@router.delete("/attempts/{attempt_id}")
def trash_attempt(attempt_id: str):
    """软删：从列表与全部统计口径里消失，但行留下（§14.4）。幂等。"""
    if not store.trash_attempt(attempt_id):
        raise not_found("练习记录不存在")
    return ok({"deleted": True})


@router.post("/attempts/{attempt_id}/restore")
def restore_attempt(attempt_id: str):
    restored = store.restore_attempt(attempt_id)
    if restored is None:
        raise not_found("练习记录不存在")
    return ok({"restored": True})


@router.delete("/attempts/{attempt_id}/purge")
def purge_attempt(attempt_id: str):
    """彻底清除。**没有快照就不许清除**：这一步之后无法撤回，而用户此刻最需要的是退路。"""
    if not backup.snapshots():
        raise ApiError(
            409,
            "本机还没有任何学习库快照，清除后就无法撤回。请先在「数据与备份」里备份一份，再执行清除。",
            CODE_CONFLICT,
        )
    if store.purge_attempt(attempt_id) is None:
        raise not_found("练习记录不存在")
    return ok({"purged": True})
