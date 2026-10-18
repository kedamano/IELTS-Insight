"""口语可本地计算的指标（spec-contracts.md §3-S metrics / §6；验收 AC-S4、FR-S5、FR-G3）。

纯函数：transcript + 时长（+ 可选 whisper segments）→
`{word_count, wpm, pause_total_sec, fillers, repeats}`，全部本地可算、无网络依赖。

- wpm = 词数 / (时长/60)；duration ≤ 0 时夹紧为 0，绝不 ZeroDivision；
- pause_total_sec 由相邻 segment 间隙求和（无 segments 视为 0）；
- fillers：多词填充语（"you know"/"sort of"）优先于其单词成分匹配，且只计一次；
- repeats：相邻重复 token 的对数（"I I went the the and and" → 3）。
"""

from __future__ import annotations

import re
from typing import Any, Optional, Sequence

# --------------------------------------------------------------------------
# 填充语表：多词短语必须排在单词成分之前（FR-S5）
# --------------------------------------------------------------------------
FILLERS_MULTI = (
    "you know",
    "what i mean",
    "sort of",
    "kind of",
    "i think",
    "i mean",
    "i guess",
    "to be honest",
    "at the end of the day",
    "how do i say",
    "more or less",
    "so to speak",
)
FILLERS_SINGLE = (
    "um",
    "uh",
    "erm",
    "er",
    "ah",
    "well",
    "basically",
    "actually",
    "literally",
)

_WORD_RE = re.compile(r"[a-z0-9]+(?:['’][a-z0-9]+)*|[a-z0-9]+", re.IGNORECASE)


def _words(transcript: Any) -> list[str]:
    if not transcript:
        return []
    return _WORD_RE.findall(str(transcript))


def _fillers(transcript: Any) -> list[str]:
    text = " ".join(str(transcript or "").lower().replace("’", "'").split())
    if not text:
        return []
    found: list[str] = []
    remaining = text
    # 先消掉多词短语（避免 "you know" 里的成分被单词表重复命中），再扫单词
    for phrase in sorted(FILLERS_MULTI, key=len, reverse=True):
        pattern = re.compile(rf"(?<!\w){re.escape(phrase)}(?!\w)")
        if pattern.search(remaining):
            found.append(phrase)
            remaining = pattern.sub(" ", remaining)
    tokens = re.findall(r"[a-z']+", remaining)
    for word in FILLERS_SINGLE:
        if word in tokens and word not in found:
            found.append(word)
    # 输出顺序 = 在原文中首次出现的顺序
    def _pos(item: str) -> int:
        m = re.search(rf"(?<!\w){re.escape(item)}(?!\w)", text)
        return m.start() if m else len(text)

    return sorted(found, key=_pos)


def _repeats(transcript: Any) -> int:
    tokens = [t.lower() for t in _words(transcript)]
    return sum(1 for i in range(1, len(tokens)) if tokens[i] == tokens[i - 1])


def _pause_total(segments: Optional[Sequence[Any]]) -> float:
    if not segments:
        return 0.0
    spans: list[tuple[float, float]] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        try:
            start, end = float(seg.get("start", 0.0)), float(seg.get("end", 0.0))
        except (TypeError, ValueError):
            continue
        spans.append((start, end))
    spans.sort(key=lambda s: s[0])
    pause = 0.0
    for prev, cur in zip(spans, spans[1:]):
        gap = cur[0] - prev[1]
        if gap > 0:
            pause += gap
    return round(pause, 1)


def compute(
    transcript: Any,
    duration_sec: Any,
    *,
    segments: Optional[Sequence[Any]] = None,
    expected_text: Optional[str] = None,
) -> dict[str, Any]:
    """§3-S metrics 的本地计算。`expected_text` 预留给逐句发音对比，不影响指标。"""
    words = _words(transcript)
    word_count = len(words)
    try:
        duration = float(duration_sec or 0.0)
    except (TypeError, ValueError):
        duration = 0.0
    if duration > 0.0:
        wpm = round(word_count / (duration / 60.0), 1)
    else:
        wpm = 0.0  # 零时长夹紧，绝不抛 ZeroDivisionError
    return {
        "word_count": word_count,
        "wpm": wpm,
        "pause_total_sec": _pause_total(segments),
        "fillers": _fillers(transcript),
        "repeats": _repeats(transcript),
    }
