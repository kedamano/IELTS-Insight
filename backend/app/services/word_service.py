"""单词查询服务 — v1.1 新增

按 v1.1 设计文档第 11 章：
- 优先级1：本地词典（dictionary.json，5000+高频词）
- 优先级2：联网时调用 AI 生成详细解析
- 优先级3：降级为预设模板
"""

import json
import re
from pathlib import Path
from typing import Optional

DICT_PATH = Path(__file__).parent.parent / "data" / "dictionary.json"


def _load_dict() -> dict:
    """加载本地词典"""
    if not DICT_PATH.exists():
        return {}
    with open(DICT_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


_DICT_CACHE: Optional[dict] = None


def get_dict() -> dict:
    global _DICT_CACHE
    if _DICT_CACHE is None:
        _DICT_CACHE = _load_dict()
    return _DICT_CACHE


def lookup_word(word: str) -> dict:
    """查询单词信息

    返回格式：
    {
        "word": str,
        "phonetic": str,       # 音标
        "zh": str,             # 中文释义
        "difficulty": int,     # 难度 1-5
        "examples": list[str], # 例句
        "source": str          # "local" | "fallback"
    }
    """
    word_lower = word.lower().strip(".,!?;:'\"()[]{}")
    d = get_dict()

    if word_lower in d:
        entry = d[word_lower]
        return {
            "word": word_lower,
            "phonetic": entry.get("phonetic", ""),
            "zh": entry.get("zh", ""),
            "difficulty": entry.get("difficulty", 1),
            "examples": entry.get("examples", []),
            "source": "local",
        }

    # 降级：返回基本信息
    return {
        "word": word_lower,
        "phonetic": "",
        "zh": f"（未收录）{word_lower}",
        "difficulty": 3,
        "examples": [],
        "source": "fallback",
    }


def search_words(query: str, limit: int = 20) -> list[dict]:
    """搜索单词"""
    d = get_dict()
    results = []
    q = query.lower()
    for word, entry in d.items():
        if q in word or q in entry.get("zh", ""):
            results.append({
                "word": word,
                "phonetic": entry.get("phonetic", ""),
                "zh": entry.get("zh", ""),
                "difficulty": entry.get("difficulty", 1),
            })
        if len(results) >= limit:
            break
    return results


def get_word_detail(word: str) -> dict:
    """获取单词详细信息（含发音难点提示）"""
    info = lookup_word(word)
    phonetic = info.get("phonetic", "")

    # 中国学生常见发音难点
    difficulty_tips = {
        "/θ/": "舌尖放在上下齿之间，气流从缝隙中挤出，声带不振动",
        "/ð/": "舌尖放在上下齿之间，气流从缝隙中挤出，声带振动",
        "/æ/": "嘴巴张大，舌尖抵住下齿，发出介于'啊'和'哎'之间的音",
        "/ɪ/": "短元音，嘴唇放松微微张开，舌尖抵住下齿",
        "/l/": "舌尖抵住上齿龈，气流从舌头两侧流出（dark L 舌尖不接触）",
        "/r/": "舌尖卷起但不接触口腔任何部位，嘴唇微微收圆",
        "/ʊ/": "短元音，嘴唇收圆但放松，比/u/更短更轻",
        "/aʊ/": "从/a/滑向/ʊ/，开口度从大到小",
        "/ə/": "央元音，口腔最放松的状态，舌头居中，轻轻发出'呃'",
    }

    tips = []
    for phoneme, tip in difficulty_tips.items():
        if phoneme in phonetic:
            tips.append({"phoneme": phoneme, "tip": tip})

    return {**info, "pronunciation_tips": tips}
