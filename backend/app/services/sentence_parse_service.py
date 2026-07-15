"""句子解析服务 — v1.5 新增

按 v1.1 设计文档第 10 章：
- 优先级1：场景内置数据（离线可用）
- 优先级2：AI 生成（联网）
- 优先级3：本地词典
"""

import json
from pathlib import Path
from typing import Optional

SENTENCE_PARSES_PATH = Path(__file__).parent.parent / "data" / "sentence_parses.json"


def _load_parses() -> dict:
    if not SENTENCE_PARSES_PATH.exists():
        return {}
    with open(SENTENCE_PARSES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


_PARSES_CACHE: Optional[dict] = None


def get_parses() -> dict:
    global _PARSES_CACHE
    if _PARSES_CACHE is None:
        _PARSES_CACHE = _load_parses()
    return _PARSES_CACHE


def parse_sentence(sentence_en: str, cultural_notes: str = "", scene_id: str = "") -> dict:
    """解析句子"""
    clean = sentence_en.strip().rstrip(".!?")
    
    # 优先级 1：预设解析
    parses = get_parses()
    key = f"{scene_id}:{clean}" if scene_id else clean
    if key in parses:
        result = parses[key]
        result["source"] = "preset"
        return result
    
    # 优先级 2：AI 生成（简化版，实际应调用 LLM）
    # 优先级 3：本地词典降级
    return _fallback_parse(sentence_en, cultural_notes)


def _fallback_parse(sentence_en: str, cultural_notes: str = "") -> dict:
    """本地词典降级"""
    from app.services.word_service import lookup_word
    
    words = []
    for w in sentence_en.split():
        clean_w = w.strip(".,!?;:'\"()[]{}").lower()
        if not clean_w:
            continue
        info = lookup_word(clean_w)
        if info.get("phonetic"):
            words.append({
                "word": clean_w,
                "phonetic": info.get("phonetic", ""),
                "zh": info.get("zh", ""),
            })
    
    return {
        "sentence": sentence_en,
        "phonetic": "",
        "words": words[:8],
        "expressions": [],
        "cultural_note": cultural_notes or "",
        "source": "dictionary",
    }
