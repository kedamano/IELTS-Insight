"""`GET /health`（契约 §1 行 1）。

原则：本端点**不产生任何网络请求**，也不导入 whisper（CONSTITUTION §6：import 即拖入 torch
是明确的反面教材），只报告当前进程的真实状态。

§14.6 追加一条：库坏了的时候它**必须还能答 200**。概览屏靠它判断当前是不是只读降级，
一个 500 的体检端点在故障时正好把「到底怎么了」藏起来 —— 所以两处读库都包了兜底。
"""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

from fastapi import APIRouter

from app.api.common import ok
from app.config import settings as _cfg
from app.db import migrations, store
from app.services import ai_client, faultlog, runtime

router = APIRouter(tags=["health"])


def _whisper_state() -> dict:
    """懒加载真实状态：只有首次转写（`api/media.py` 的 /stt）才会把 stt_service 导入进 sys.modules。"""
    module = sys.modules.get("app.services.stt_service")
    loaded = module is not None and getattr(module, "_model", None) is not None
    return {"loaded": loaded, "model": _cfg.WHISPER_MODEL}


def _tts_ok() -> bool:
    """edge-tts 可用 = 依赖已装 + **生效的**在线许可 + 缓存目录可写。不实际发请求。

    在线许可走 §15.2 的唯一判定点：用户关掉「允许在线服务」时这里必须跟着变不可用。
    """
    if not ai_client.network_allowed():
        return False
    if not _edge_tts_installed():
        return False
    try:
        Path(_cfg.TTS_CACHE_DIR).mkdir(parents=True, exist_ok=True)
    except OSError:
        return False
    return True


def _edge_tts_installed() -> bool:
    """`find_spec` 对「已在 sys.modules 但没有 `__spec__`」的模块直接抛 ValueError。

    打包产物与测试桩都是这个形状，而 `/api/health` 在库出事时还必须答 200（§14.6），
    所以这里不许让一个探测函数把体检端点打成 500。
    """
    try:
        return importlib.util.find_spec("edge_tts") is not None
    except (ValueError, ImportError):
        return "edge_tts" in sys.modules


@router.get("/health")
def health():
    # 身份先算，且只从进程内存算（契约 §15.4 第 1 条）：库读不出来时正是最需要知道
    # 「现在应答的是哪一个进程、它什么时候起来的」，这一组字段不能跟着库一起坏。
    身份 = runtime.identity()
    try:
        ai = store.ai_block()
        counts = store.set_counts_by_module()
    except (sqlite3.Error, store.StorageUnavailableError, migrations.SchemaUpgradeError) as exc:
        # 原始异常只进日志；界面拿到的是中文文案（CONSTITUTION §3）
        faultlog.error("Health", f"库读不出来，按环境变量报告：{type(exc).__name__}")
        ai = store.ai_block({})
        counts = {module: 0 for module in store.MODULES}
    return ok(
        {
            "version": _cfg.APP_VERSION,
            "pid": 身份["pid"],
            "port": 身份["port"],
            "port_source": 身份["port_source"],
            "started_at": 身份["started_at"],
            "ai_configured": ai["configured"],
            "ai_base_url_host": ai["base_url_host"],
            "ai_model": ai["model"],
            "whisper": _whisper_state(),
            "tts_ok": _tts_ok(),
            "content_counts": counts,
            "storage": store.storage_state(),
        }
    )
