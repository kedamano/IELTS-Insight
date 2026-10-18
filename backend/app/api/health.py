"""`GET /health`（契约 §1 行 1）。

原则：本端点**不产生任何网络请求**，也不导入 whisper（CONSTITUTION §6：import 即拖入 torch
是明确的反面教材），只报告当前进程的真实状态。
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import APIRouter

from app.api.common import ok
from app.config import settings as _cfg
from app.db import store

router = APIRouter(tags=["health"])


def _whisper_state() -> dict:
    """懒加载真实状态：只有首次转写（`api/media.py` 的 /stt）才会把 stt_service 导入进 sys.modules。"""
    module = sys.modules.get("app.services.stt_service")
    loaded = module is not None and getattr(module, "_model", None) is not None
    return {"loaded": loaded, "model": _cfg.WHISPER_MODEL}


def _tts_ok() -> bool:
    """edge-tts 可用 = 依赖已装 + 允许联网 + 缓存目录可写。不实际发请求。"""
    if not _cfg.ONLINE:
        return False
    if importlib.util.find_spec("edge_tts") is None:
        return False
    try:
        Path(_cfg.TTS_CACHE_DIR).mkdir(parents=True, exist_ok=True)
    except OSError:
        return False
    return True


@router.get("/health")
def health():
    ai = store.ai_block()
    return ok(
        {
            "version": _cfg.APP_VERSION,
            "ai_configured": ai["configured"],
            "ai_base_url_host": ai["base_url_host"],
            "ai_model": ai["model"],
            "whisper": _whisper_state(),
            "tts_ok": _tts_ok(),
            "content_counts": store.set_counts_by_module(),
        }
    )
