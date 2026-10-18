"""内容生成端点（契约 §1 行 40–41，标记「新，可后置」；test-plan §5 列为 P3）。

**当前未注册到 `api_router`**（`api/__init__.py` 只聚合已实现的 9 个模块）。
原因：题库生成管线属于 T3（`backend/tools/gen_ielts_bank.py`），
把作业交给 T3 后这里才有真正的 `job` 语义；现在实现只能是假任务表。
主控如需要，把 `router` 加进 `api/__init__.py` 即可（501 + 机器码，不会假成功）。
"""

from __future__ import annotations

from fastapi import APIRouter, Body

from app.api.common import ApiError, bad_request, ok
from app.db import store

router = APIRouter(tags=["content"])

_NOT_IMPLEMENTED = ApiError(501, "题库生成管线由内容工具（backend/tools/gen_ielts_bank.py）提供，尚未接入", "not_implemented")


@router.post("/content/generate")
def generate(payload: dict = Body(...)):
    if not isinstance(payload, dict):
        raise bad_request("请求体应为 {module, count, target_band}")
    module = payload.get("module")
    if module not in store.MODULES:
        raise bad_request(f"module 只能是 {', '.join(store.MODULES)}")
    raise _NOT_IMPLEMENTED


@router.get("/content/jobs/{job_id}")
def job_status(job_id: str):
    raise _NOT_IMPLEMENTED
