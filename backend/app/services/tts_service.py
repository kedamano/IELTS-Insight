import asyncio
import hashlib
from pathlib import Path
import edge_tts
from app.config import settings

Path(settings.TTS_CACHE_DIR).mkdir(parents=True, exist_ok=True)

VOICE_MAP = {
    "en-US": "en-US-AvaNeural",
    "en-GB": "en-GB-SoniaNeural",
}


def _cache_key(text: str, voice: str) -> str:
    return hashlib.md5(f"{text}_{voice}".encode()).hexdigest()


async def _gen_one(text: str, voice: str) -> bytes:
    comm = edge_tts.Communicate(text, voice)
    data = b""
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            data += chunk["data"]
    return data


async def generate_tts(text: str, voice_key: str = "en-US") -> str:
    """生成 TTS 音频，返回缓存文件路径（失败返回空字符串）"""
    voice = VOICE_MAP.get(voice_key, VOICE_MAP["en-US"])
    cache_name = f"{_cache_key(text, voice)}.mp3"
    cache_path = Path(settings.TTS_CACHE_DIR) / cache_name

    if cache_path.exists():
        return str(cache_path)

    try:
        data = await _gen_one(text, voice)
        cache_path.write_bytes(data)
        return str(cache_path)
    except Exception as e:
        print(f"[TTS] Failed to generate TTS for '{text[:30]}...': {e}")
        return ""


async def batch_pre_generate(dialogues: list[dict], voice_key: str = "en-US") -> dict[int, str]:
    """批量预生成所有句子的 TTS，返回 {seq: file_path}"""
    results = {}
    for d in dialogues:
        path = await generate_tts(d["en"], voice_key)
        results[d["seq"]] = path
    return results
