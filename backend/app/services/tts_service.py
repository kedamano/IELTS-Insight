import asyncio
import hashlib
import time
from pathlib import Path
import edge_tts
from app.config import settings
from app.services import faultlog

Path(settings.TTS_CACHE_DIR).mkdir(parents=True, exist_ok=True)

VOICE_MAP = {
    "en-US": "en-US-AvaNeural",
    "en-GB": "en-GB-SoniaNeural",
}

# 缓存清理阈值（§17 同源思路：本机产物要能被自动回收，否则磁盘只增不减）。
# 两个条件任一命中就按最旧优先删，直到两个都满足为止。
CACHE_MAX_AGE_DAYS = 90
CACHE_MAX_BYTES = 500 * 1024 * 1024


def _cache_key(text: str, voice: str) -> str:
    return hashlib.md5(f"{text}_{voice}".encode()).hexdigest()


def cleanup_cache(max_age_days: int = CACHE_MAX_AGE_DAYS, max_bytes: int = CACHE_MAX_BYTES) -> int:
    """清理过期 / 超量的 TTS 缓存，返回删除的文件数。

    判据是**缓存文件自己的 mtime**：TTS 缓存是纯派生产物，删掉只是让下次
    合成多花几秒，没有任何数据损失。这是它与 `backups/` 的本质区别 ——
    备份要按快照名白名单严格校验，缓存可以直接按年龄轮转。

    两条规则：
    - 超过 `max_age_days` 的一律删（音频内容不会变，但缓存不该无限期占盘）；
    - 删完仍然超过 `max_bytes` 时，按 mtime 从最旧继续删到达标。
    """
    directory = Path(settings.TTS_CACHE_DIR)
    if not directory.is_dir():
        return 0
    files = [p for p in directory.glob("*.mp3") if p.is_file()]
    if not files:
        return 0

    now = time.time()
    cutoff = now - max_age_days * 86400
    stats: list[tuple[Path, int, float]] = []
    for path in files:
        try:
            st = path.stat()
        except OSError:
            continue
        stats.append((path, st.st_size, st.st_mtime))
    if not stats:
        return 0

    # 先删过期的（无条件），同时算出剩余总量。
    remaining = 0
    removed = 0
    survivors: list[tuple[Path, int, float]] = []
    for path, size, mtime in stats:
        if mtime < cutoff:
            try:
                path.unlink()
                removed += 1
                continue
            except OSError:
                pass  # 删不掉就留着，不因一次失败中断整个清理
        remaining += size
        survivors.append((path, size, mtime))

    # 仍然超量 → 从最旧的开始继续删。
    if remaining > max_bytes:
        for path, size, mtime in sorted(survivors, key=lambda item: item[2]):
            if remaining <= max_bytes:
                break
            try:
                path.unlink()
                remaining -= size
                removed += 1
            except OSError:
                continue
    return removed


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
        faultlog.error("TTS", f"合成失败: {e}")
        return ""


async def batch_pre_generate(dialogues: list[dict], voice_key: str = "en-US") -> dict[int, str]:
    """批量预生成所有句子的 TTS，返回 {seq: file_path}"""
    results = {}
    for d in dialogues:
        path = await generate_tts(d["en"], voice_key)
        results[d["seq"]] = path
    return results
