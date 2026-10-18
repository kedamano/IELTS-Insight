"""STT（Whisper 转写）—— **懒加载**（CONSTITUTION §6 / test-plan §1 第二行）。

旧实现在模块导入时 `whisper.load_model()`，于是 `import app.main` 就把 torch 拖进进程
（数十秒 + 数 GB 内存），也让每次 pytest 都变重。现在：

- 模块级只有 `_model = None`；`whisper` 的 import 与 `load_model()` 都推迟到 :func:`_get_model`
  第一次被真正调用时（首次转写、`POST /api/speaking/.../turn` 带音频、或 `POST /api/stt`）；
- `GET /api/health` 的 `whisper.loaded` 读的就是这个状态（AC-C3 的真实加载状态）；
- 转写语言不再硬编码 `"en"`：调用方可传 `language=`，缺省取环境变量
  `IELTS_STT_LANGUAGE`（默认 `en`），因为 `config.py` 不由本 agent 拥有，新增配置项需主控落地。

公开函数名保持不变：`decode_audio` / `transcribe`（并新增异步壳 `transcribe_async` 供 turn 复用）。
"""
from __future__ import annotations

import io
import os
import threading
from typing import Any, Optional

import numpy as np

from app.config import settings

SAMPLE_RATE = 16000
DEFAULT_LANGUAGE = "en"

_model: Any = None
_lock = threading.Lock()


# --------------------------------------------------------------------------
# 懒加载
# --------------------------------------------------------------------------

def _get_model() -> Any:
    """首次使用时才加载 Whisper（`tests/whisper_probe.py` 探针断言的就是这个入口）。"""
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is None:
            import whisper  # 延迟导入：模块导入期绝不拖入 torch

            name = (settings.WHISPER_MODEL or "base") if hasattr(settings, "WHISPER_MODEL") else "base"
            # 日志只用 ASCII：打包 sidecar / 探针子进程在 GBK 控制台下打印中文会炸 stdout。
            print(
                f"[STT] loading whisper model '{name}' on '{getattr(settings, 'WHISPER_DEVICE', 'cpu')}' (lazy)...",
                flush=True,
            )
            _model = whisper.load_model(name, device=getattr(settings, "WHISPER_DEVICE", "cpu"))
            print("[STT] whisper model loaded.", flush=True)
    return _model


# 别名：探针与 health 允许任一名（契约 test-plan §1 写的是 `_get_model()`）
get_model = _get_model


def resolve_language(language: Optional[str] = None) -> str:
    value = (language or os.environ.get("IELTS_STT_LANGUAGE") or DEFAULT_LANGUAGE).strip()
    return value or DEFAULT_LANGUAGE


# --------------------------------------------------------------------------
# 解码与转写
# --------------------------------------------------------------------------

def decode_audio(data: bytes) -> np.ndarray:
    """把任意音频容器（webm/opus、mp3、wav、m4a…）解成 16kHz 单声道 float32。

    用 PyAV（自带 FFmpeg 库）而不是 shell out `ffmpeg`，这样打包后不依赖系统命令行。
    """
    import av

    container = av.open(io.BytesIO(data))
    try:
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
        chunks = []
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))
        for resampled in resampler.resample(None):  # flush
            chunks.append(resampled.to_ndarray().reshape(-1))
    finally:
        container.close()

    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32)


def transcribe(audio_bytes: bytes, input_format: str = "webm", *, language: Optional[str] = None) -> dict:
    """转写音频，返回 `{text, confidence, segments, duration}`。

    音频为空/无法解码/太短 → `ValueError`（带可读中文以外的原始英文描述由 API 层包成 400），
    模型或依赖不可用 → `RuntimeError`（API 层包成 503），二者都不许被静默吞掉。
    """
    if not audio_bytes:
        raise ValueError("Empty audio payload")

    try:
        audio = decode_audio(audio_bytes)
    except Exception as exc:
        raise ValueError(f"Cannot decode audio ({input_format}): {exc}") from exc

    # 小于 ~0.1s 的输入不含语音，会让 Whisper 在极短音频上卡住
    duration = len(audio) / SAMPLE_RATE
    if duration < 0.1:
        raise ValueError(f"Audio too short ({duration:.2f}s), please record at least 1 second")

    model = _get_model()
    try:
        result = model.transcribe(audio, language=resolve_language(language), fp16=False)
    except Exception as exc:
        raise RuntimeError(f"Transcription failed: {type(exc).__name__}") from exc

    segments = result.get("segments") or []
    logprob = float(result.get("avg_logprob", -1.0))
    # AC-S3 用 0–1 的置信度判「录音可能不清晰」，whisper 给的是对数概率 → 取指数映射
    confidence = max(0.0, min(1.0, math.exp(logprob)))
    return {
        "text": (result.get("text") or "").strip(),
        "confidence": round(confidence, 4),
        "avg_logprob": round(logprob, 4),
        "segments": len(segments),
        "duration": round(duration, 2),
        "segment_list": segments,
    }


async def transcribe_async(
    audio_bytes: bytes, input_format: str = "webm", *, language: Optional[str] = None
) -> dict:
    """在线程池里转写，避免阻塞 API 事件循环（口语 turn 走这条）。"""
    import asyncio

    return await asyncio.to_thread(transcribe, audio_bytes, input_format, language=language)
