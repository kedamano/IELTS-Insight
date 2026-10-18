"""API 聚合（契约 §6：`api_router = APIRouter(prefix="/api")`）。

四科模块（speaking/listening/reading/writing）已由 Wave 2 交付并在下方注册。
`api/content.py`（§1 行 40–41 `/content/generate`、`/content/jobs/{id}`）文件已存在但**故意不注册**，
属 test-plan §5 的 P3，见该文件说明。
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api import (
    attempts,
    health,
    jobs,
    listening,
    media,
    plan,
    progress,
    reading,
    review,
    settings,
    speaking,
    vocab,
    writing,
)

api_router = APIRouter(prefix="/api")

api_router.include_router(health.router)
api_router.include_router(settings.router)
api_router.include_router(attempts.router)
api_router.include_router(jobs.router)
api_router.include_router(progress.router)
api_router.include_router(plan.router)
api_router.include_router(review.router)
api_router.include_router(vocab.router)
api_router.include_router(media.router)
api_router.include_router(speaking.router)
api_router.include_router(listening.router)
api_router.include_router(reading.router)
api_router.include_router(writing.router)

__all__ = ["api_router"]
