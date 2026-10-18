"""音频端点：`GET /tts`、`POST /stt`（契约 §1 行 39，以及 §1 表下「保留 `POST /stt`」的决策）。

- 语速需要 edge-tts 的 `rate` 参数，而现有 `tts_service.generate_tts()` 不接语速
  （CONSTITUTION：不改不属于本任务的既有服务）。因此：
  · `voice` 命中 `tts_service.VOICE_MAP` 的旧键（`en-US`/`en-GB`）且 `speed == 1.0` 时
    走 `generate_tts`，与既有缓存文件共用（老缓存不失效）；
  · 其余（完整神经语音名如 `en-US-GuyNeural`、或任何非 1.0 语速）在本模块内合成，
    缓存键包含 voice 与 speed，**不会静默换成别的音色**。
  T8 做听力音频（需要 `X-Audio-Cache: hit|miss`）时可以把这两条路径合并进 tts_service。
- whisper 只在 `POST /stt` 被调用时才导入（`import app.main` 不再拖入 torch）。
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import FileResponse

from app.api.common import (
    CODE_TOO_LARGE,
    ApiError,
    bad_request,
    dependency_unavailable,
    ok,
)
from app.config import settings as _cfg, data_dir_for
from app.services.tts_service import VOICE_MAP, generate_tts

router = APIRouter(tags=["media"])

# WebM 文件魔数（前 4 字节）
WEBM_MAGIC = b"\x1a\x45\xdf\xa3"
MAX_AUDIO_BYTES = 5 * 1024 * 1024
MAX_TTS_TEXT = 5000
_NEURAL_VOICE = re.compile(r"^[A-Za-z]{2}-[A-Za-z]{2,3}-[A-Za-z]+Neural$")


def _normalize_voice(voice: str) -> str:
    value = (voice or "").strip()
    if value in VOICE_MAP:
        return value
    if _NEURAL_VOICE.match(value):
        return value
    raise bad_request(
        f"voice 不合法：{value!r}。可用 en-GB / en-US 或完整神经语音名（如 en-GB-SoniaNeural）"
    )


def _rate(speed: float) -> str:
    percent = int(round((speed - 1.0) * 100))
    return f"{percent:+d}%"


def _cache_path(text: str, voice: str, speed: float) -> Path:
    key = hashlib.md5(f"{text}_{voice}_{speed}".encode()).hexdigest()
    return Path(_cfg.TTS_CACHE_DIR) / f"{key}.mp3"


async def _synthesize(text: str, voice: str, speed: float) -> str:
    """非默认音色/语速的 TTS：直接调 edge-tts 并按 (text, voice, speed) 缓存。"""
    path = _cache_path(text, voice, speed)
    if path.exists() and path.stat().st_size > 0:
        return str(path)
    import edge_tts

    communicate = edge_tts.Communicate(text, VOICE_MAP.get(voice, voice), rate=_rate(speed))
    data = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            data += chunk["data"]
    if not data:
        return ""
    data_dir_for(str(path))
    path.write_bytes(data)
    return str(path)


@router.get("/tts")
async def tts(
    text: str = Query(..., description="要合成的文本"),
    voice: str = Query("en-GB"),
    speed: float = Query(1.0, ge=0.5, le=1.5),
):
    content = (text or "").strip()
    if not content:
        raise bad_request("text 不能为空")
    if len(content) > MAX_TTS_TEXT:
        raise bad_request(f"text 过长（最多 {MAX_TTS_TEXT} 字符）")
    if not _cfg.ONLINE:
        raise dependency_unavailable("已关闭联网，无法合成语音", code="tts_offline")

    normalized = _normalize_voice(voice)
    try:
        if normalized in VOICE_MAP and abs(speed - 1.0) < 1e-6:
            path = await generate_tts(content, normalized)
        else:
            path = await _synthesize(content, normalized, speed)
    except Exception as exc:  # 网络失败要可见：503 + 机器码，不伪装成成功
        print(f"[TTS] 合成失败: {type(exc).__name__}: {exc}", flush=True)
        raise dependency_unavailable("语音合成失败（网络不可用？），可改用文本模式练习", code="tts_unavailable") from exc

    if not path:
        raise dependency_unavailable("语音合成失败（网络不可用？），可改用文本模式练习", code="tts_unavailable")
    return FileResponse(path, media_type="audio/mpeg", filename="speech.mp3")


@router.post("/stt")
async def stt(audio: UploadFile = File(...)):
    """转写音频。前端主流程已并入口语 turn（契约 §1 行 10），本端点保留供内部复用。"""
    data = await audio.read()
    if len(data) > MAX_AUDIO_BYTES:
        raise ApiError(413, "音频过大（上限 5MB）", CODE_TOO_LARGE)
    if not data:
        raise bad_request("音频为空", code="empty_audio")

    fmt = "webm" if data[:4] == WEBM_MAGIC else "audio"
    from app.services.stt_service import transcribe  # 懒加载：不在 import app.main 时拖入 torch

    try:
        result = transcribe(data, fmt)
    except ValueError as exc:
        raise bad_request(str(exc), code="audio_unintelligible") from exc
    except Exception as exc:
        raise dependency_unavailable(f"转写失败：{exc}", code="stt_failed") from exc

    return ok(result)
