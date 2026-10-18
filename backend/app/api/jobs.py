"""批改任务查询端点（契约 §1 行 20c/11c：客户端轮询 `job_id` 取异步批改结果）。

- `GET /jobs/{job_id}`：单个任务状态。成功时带完整报告（与同步批改端点同形状，
  前端拿到即可直接渲染）；失败时带中文 `error` —— 「批改没成功」必须是可见状态，
  不能让 UI 永远停在转圈；
- `GET /jobs?status=active`：仍未完成的任务。用户提交后离开页面再回来时靠它重新挂上轮询。
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query

from app.api.common import bad_request, not_found, ok
from app.db import store

router = APIRouter(tags=["jobs"])

STATUS_FILTERS = ("all", "active")


def job_view(job: dict[str, Any]) -> dict[str, Any]:
    """`store` 行 → 契约响应（把内部列名换成端点字段名）。"""
    return {
        "job_id": job["id"],
        "module": job["module"],
        "task_ref": job["task_ref"],
        "status": job["status"],
        "attempt_id": job["attempt_id"],
        "report": job["report"],
        "error": job["error"],
        "degraded_reason": job["degraded_reason"],
        "created_at": job["created_at"],
        "started_at": job["started_at"],
        "finished_at": job["finished_at"],
    }


@router.get("/jobs")
def list_jobs(status: str = Query("all"), limit: int = Query(50)):
    wanted = (status or "all").strip()
    if wanted not in STATUS_FILTERS:
        raise bad_request(f"status 只能是 {', '.join(STATUS_FILTERS)}")
    if limit < 1 or limit > 200:
        raise bad_request("limit 应在 1 到 200 之间")
    items = [job_view(job) for job in store.list_jobs(active_only=(wanted == "active"), limit=limit)]
    return ok({"items": items})


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = store.get_job(job_id)
    if not job:
        raise not_found(f"批改任务不存在：{job_id}")
    return ok(job_view(job))
