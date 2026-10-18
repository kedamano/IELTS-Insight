"""无 AI 时的本地近似反馈（spec-contracts.md §6/§0；验收 FR-W5、AC-G3、AC-W3b、AC-S6）。

CONSTITUTION §3：**降级必须可见**。本模块产出的每个报告都带
`ai_used=false` + `degraded_reason="offline_template"` + `approximate=true`，
UI 据此显示「近似分/离线模板」，绝不伪装成 AI 结果。

符号（tests/test_offline_feedback.py 头部固定）：
    analyze_text(text) -> dict
    writing_report(task, response, *, duration_sec=None) -> dict
    speaking_report(prompt, transcript, duration_sec, *, metrics=None) -> dict
band 一律 0–9、0.5 步长（FR-G5）：近似分同样受限。
"""

from __future__ import annotations

import re
from typing import Any, Optional

from app.services import speaking_metrics

# --------------------------------------------------------------------------
# 本地词表（FR-W5：连接词清单命中 / 冠词缺失启发式）
# --------------------------------------------------------------------------
CONNECTIVES = (
    "as a result", "in contrast", "on the other hand", "for example", "for instance",
    "in conclusion", "to sum up", "in my view", "from my perspective", "at the end of the day",
    "due to", "because of", "even though", "nevertheless", "nonetheless", "furthermore",
    "moreover", "therefore", "consequently", "additionally", "meanwhile", "subsequently",
    "although", "however", "instead", "overall", "thus", "hence",
)

STOPWORDS = frozenset(
    """the and but for with that this from they them their there here where when what which
    while about between without within because before after above below again then once also
    have has had him her his its our your mine yours someone anyone everyone nobody should
    would could might must being been into onto upon such own very more most other another
    one two three times time year years people person thing things make makes made""".split()
)

# 需要冠词的可数单数名词（启发式清单，FR-W5 "the/a 缺失"）
ArticleNeedingNouns = frozenset(
    """store shop school hospital university college office station airport bank park cinema
    museum library restaurant supermarket market square street road bridge tower palace
    bus car train taxi bike boat ship plane apple banana sandwich orange cake cookie cup
    glass plate spoon knife fork table chair desk lamp phone computer laptop book pen
    job career profession idea opinion question answer problem solution suggestion
    child student teacher worker farmer doctor nurse patient visitor tourist friend
    house flat room kitchen garden forest lake river mountain valley village town city"""
    .split()
)

_TRIGGER_WORDS = frozenset(
    "to for in on at of with without by went visited bought took take buy visit need needed "
    "want wanted see saw use using call called send sent bring brought find found met meet".split()
)

_DETERMINERS = frozenset(
    "a an the this that these those my your his her its our their some any every no each "
    "one two both many few several all half".split()
)

_SENTENCE_SPLIT = re.compile(r"[.!?]+")
_WORD_FIND = re.compile(r"[A-Za-z][A-Za-z'-]*|\d+(?:[.,]\d+)?")


def _clamp_band(value: float) -> float:
    """0–9、0.5 步长（FR-G5）；向下取到 0.5，防止四舍五入越界。"""
    v = max(0.0, min(9.0, float(value)))
    return round(int(v * 2) / 2, 1) if v < 9.0 else 9.0


# --------------------------------------------------------------------------
# analyze_text —— FR-W5 列出的每一项本地统计
# --------------------------------------------------------------------------

def analyze_text(text: Any) -> dict[str, Any]:
    raw = "" if text is None else str(text)
    words = _WORD_FIND.findall(raw)
    lower_words = [w.lower() for w in words]

    paragraphs = [p for p in re.split(r"\n\s*\n|\r\n\s*\r\n", raw.strip()) if p.strip()]

    lengths: list[int] = []
    for sentence in _SENTENCE_SPLIT.split(raw):
        count = len(_WORD_FIND.findall(sentence))
        if count > 0:
            lengths.append(count)
    avg = round(sum(lengths) / len(lengths), 1) if lengths else 0.0

    flat = " ".join(lower_words)
    hits: list[str] = []
    remaining = f" {flat} "
    for device in CONNECTIVES:  # 表内多词短语在前，单词在后
        pattern = re.compile(rf"(?<![a-z]){re.escape(device)}(?![a-z])")
        if pattern.search(remaining):
            hits.append(device)
            remaining = pattern.sub(" ", remaining)

    missing_articles: list[str] = []
    for i, word in enumerate(lower_words):
        if word not in _TRIGGER_WORDS or i + 1 >= len(lower_words):
            continue
        nxt = lower_words[i + 1]
        # 启发式：「介词/动词 + 可数单数名词」且中间没有冠词/限定词
        if nxt in ArticleNeedingNouns and word not in _DETERMINERS and not nxt.endswith("s"):
            missing_articles.append(f"{word} {nxt}")

    counts: dict[str, int] = {}
    order: dict[str, int] = {}
    for idx, word in enumerate(lower_words):
        if len(word) < 4 or word in STOPWORDS or not word.isalpha():
            continue
        counts[word] = counts.get(word, 0) + 1
        order.setdefault(word, idx)
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], order[kv[0]]))[:10]

    return {
        "word_count": len(words),
        "paragraph_count": len(paragraphs),
        "sentence_lengths": lengths,
        "avg_sentence_length": avg,
        "connectives": hits,
        "missing_articles": missing_articles,
        "repeated_words": [[w, c] for w, c in ranked if c >= 2],
    }


# --------------------------------------------------------------------------
# writing_report —— 离线近似写作报告（§3-W 形状）
# --------------------------------------------------------------------------

def _writing_band(analysis: dict[str, Any], min_words: int) -> dict[str, float]:
    wc = analysis["word_count"]
    if wc == 0:
        return {
            "overall": 0.0,
            "task_response": 0.0,
            "coherence_cohesion": 0.0,
            "lexical_resource": 0.0,
            "grammatical_range_accuracy": 0.0,
        }
    task_response = 5.0 if wc >= min_words else 4.0
    coherence = 4.0 + 0.5 * min(len(analysis["connectives"]), 3)
    if analysis["paragraph_count"] >= 3:
        coherence += 0.5
    lexical = 4.0 + (0.5 if wc >= min_words else 0.0) + (0.5 if analysis["avg_sentence_length"] >= 10 else 0.0)
    grammar = 5.0 - 0.5 * min(len(analysis["missing_articles"]), 3)
    overall = _clamp_band((task_response + coherence + lexical + grammar) / 4)
    return {
        "overall": overall,
        "task_response": _clamp_band(task_response),
        "coherence_cohesion": _clamp_band(coherence),
        "lexical_resource": _clamp_band(lexical),
        "grammatical_range_accuracy": _clamp_band(grammar),
    }


def writing_report(task: Any, response: Any, *, duration_sec: Optional[float] = None) -> dict[str, Any]:
    """FR-W5 本地统计 + §3-W 报告骨架；未达字数同样给硬性惩罚（AC-W3b，不需要 LLM）。"""
    task_doc = task if isinstance(task, dict) else {}
    text = "" if response is None else str(response)
    analysis = analyze_text(text)
    min_words = task_doc.get("min_words")
    min_words = int(min_words) if isinstance(min_words, (int, float)) else 0

    penalty: Optional[dict[str, Any]] = None
    if min_words and analysis["word_count"] < min_words:
        penalty = {"kind": "under_length", "missing_words": min_words - analysis["word_count"]}

    band = _writing_band(analysis, min_words)
    if penalty:
        band["task_response"] = min(band["task_response"], 5.0)  # 官方规则：欠字 TA/TR ≤5.0
        band["overall"] = _clamp_band(
            (band["task_response"] + band["coherence_cohesion"] + band["lexical_resource"] + band["grammatical_range_accuracy"]) / 4
        )

    corrections: list[dict[str, Any]] = [
        {
            "quote": phrase,
            "error_type": "grammar",
            "explanation_zh": "可数单数名词前疑似缺少冠词 the/a（离线启发式检测，仅供参考）",
            "suggestion": None,
            "severity": "low",
        }
        for phrase in analysis["missing_articles"][:10]
    ]
    error_summary: dict[str, int] = {}
    for c in corrections:
        error_summary[c["error_type"]] = error_summary.get(c["error_type"], 0) + 1
    if penalty:
        error_summary["task_response"] = error_summary.get("task_response", 0) + 1
    if not analysis["connectives"]:
        error_summary["cohesion"] = error_summary.get("cohesion", 0) + 1

    structure_issues: list[dict[str, Any]] = []
    if analysis["paragraph_count"] < 3:
        structure_issues.append(
            {"kind": "paragraph_function", "issue_zh": f"仅 {analysis['paragraph_count']} 段，建议至少 3-4 段（引入/主体/结论）", "paragraph_index": None}
        )

    return {
        "attempt_id": None,
        "module": "writing",
        "task": task_doc.get("task"),
        "ai_used": False,
        "degraded_reason": "offline_template",
        "approximate": True,
        "model": None,
        "band": band,
        "word_count": analysis["word_count"],
        "word_count_penalty": penalty,
        "corrections": corrections,
        "upgraded_sentences": [],
        "structure_issues": structure_issues,
        "strengths": (["检测到连接成分，段落衔接有意识"] if analysis["connectives"] else []),
        "model_answer": None,
        "error_summary": error_summary,
        "analysis": analysis,
        "duration_sec": duration_sec,
    }


# --------------------------------------------------------------------------
# speaking_report —— AC-S6：ai_used=false 时流程仍能走完
# --------------------------------------------------------------------------

def speaking_report(prompt: Any, transcript: Any, duration_sec: Any, *, metrics: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """§3-S 骨架的离线模板版：metrics 本地可算，四维给近似分，发音低置信（FR-S4）。"""
    text = "" if transcript is None else str(transcript)
    local = metrics if isinstance(metrics, dict) else speaking_metrics.compute(text, duration_sec)

    word_count = int(local.get("word_count") or 0)
    wpm = float(local.get("wpm") or 0.0)
    fillers = list(local.get("fillers") or [])
    repeats = int(local.get("repeats") or 0)

    fluency = 4.0 + (0.5 if word_count >= 60 else 0.0) + (0.5 if 90 <= wpm <= 150 else 0.0)
    fluency -= 0.5 * min(len(fillers) // 2, 2)
    lexical = 4.0 + (0.5 if word_count >= 100 else 0.0) + (0.5 if repeats == 0 else 0.0)
    grammar = 5.0 - (0.5 if repeats > 2 else 0.0)
    pronunciation = 5.0  # 无音频可比对，低置信占位（FR-S4：文本推断并标注）
    band = {
        "overall": _clamp_band((fluency + lexical + grammar + pronunciation) / 4),
        "fluency_coherence": _clamp_band(fluency),
        "lexical_resource": _clamp_band(lexical),
        "grammatical_range_accuracy": _clamp_band(grammar),
        "pronunciation": _clamp_band(pronunciation),
        "pronunciation_confidence": "low",
    }

    snippet = text.strip()[:80]
    improvements: list[dict[str, Any]] = []
    if fillers:
        improvements.append(
            {"issue": f"填充词偏多（{', '.join(fillers[:3])}）", "fix": "想到下句时宁可停顿静音，不要用 um/you know 填充", "quote": fillers[0]}
        )
    if repeats:
        improvements.append(
            {"issue": f"检测到 {repeats} 处连续重复", "fix": "卡顿处先停下，再用 however / so 重新起句", "quote": snippet}
        )
    if word_count and word_count < 80:
        improvements.append(
            {"issue": "回答偏短，内容展开不足", "fix": "用「观点 + 原因 + 具体例子」三段式扩展到 30 秒以上", "quote": snippet}
        )
    if wpm and wpm > 160:
        improvements.append({"issue": "语速过快", "fix": "在意群边界刻意停顿，保证发音清晰", "quote": snippet})
    # FR-S5 要求至少 3 条：不足时补模板项
    templates = [
        {"issue": "连接词单一", "fix": "交替使用 however / as a result / on top of that", "quote": snippet},
        {"issue": "时态一致性待核对", "fix": "讲述经历统一用过去时，表达观点用现在时", "quote": snippet},
        {"issue": "话题词汇密度低", "fix": "围绕话题准备 5-8 个 6.5+ 搭配并刻意用进答案", "quote": snippet},
    ]
    for item in templates:
        if len(improvements) >= 3:
            break
        improvements.append(item)

    return {
        "attempt_id": None,
        "module": "speaking",
        "ai_used": False,
        "degraded_reason": "offline_template",
        "approximate": True,
        "model": None,
        "prompt": prompt if isinstance(prompt, str) else None,
        "band": band,
        "evidence": [],
        "strengths": (["完整说完了回答"] if word_count else []),
        "improvements": improvements,
        "model_answer": "离线模板：本功能需要 AI 评分时才能提供高分示范回答。请检查设置中的 AI 配置后重试。",
        "upgrade_vocabulary": [],
        "metrics": local,
        "transcript": text,
        "duration_sec": duration_sec,
    }
