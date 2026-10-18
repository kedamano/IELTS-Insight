"""写作评分（spec-contracts.md §3-W + §3-P + §6；AC-W3/W3b/W4、FR-W3/W3b/W4/W5）。

流程：**先做本地硬规则（字数惩罚）** → 组 prompt → `ai_client.complete_json` → 解析 →
校验与夹紧 → 组装 §3-W `WritingReport`。

口径：
- `word_count = len(response.split())`；Task1 < 150 / Task2 < 250 →
  `word_count_penalty = {"kind": "under_length", "missing_words": N}`，
  并把 `band.task_response` 上限夹到 **5.0**（官方规则，本地实现，**不额外调用 LLM**，AC-W3b）；
- band 越界/非 0.5 步长 → 夹紧 + `ai_used=false` + `invalid_model_output`；四维缺项 → 补 `null` +
  `incomplete_dimensions`；非 JSON（重试 1 次后仍失败）/网络失败 → 本地近似报告，`approximate=true`；
- `corrections[].quote` 必须是考生原文连续片段，否则**丢弃该条**并计入 `invalid_quotes`（§3-P 第 2 条）；
- `error_type` 一律归一化到 7 类（AC-W4），未知值先按别名归类，归不进就并入 `lexical`；
- `error_summary` 只统计保留下来的纠正项，所以 `sum(error_summary.values()) == len(corrections)`。

本模块**不碰数据库**：落库与错题本（AC-W4 / AC-G2）由 `api/writing.py` 经
`app.db.store.record_attempt(..., review=build_review_entries(report))` 完成。
"""
from __future__ import annotations

import re
import statistics
from typing import Any, Optional

from app.prompts import TEMPERATURE, WRITING_MAX_TOKENS
from app.prompts import writing as writing_prompts
from app.services import ai_client

CRITERIA: tuple[str, ...] = writing_prompts.CRITERIA
ERROR_TYPES: tuple[str, ...] = writing_prompts.WRITING_ERROR_TYPES
SEVERITIES: tuple[str, ...] = writing_prompts.SEVERITIES
STRUCTURE_KINDS = ("paragraph_function", "cohesion", "position", "development")
UNDER_LENGTH = "under_length"
TASK_MIN_WORDS = {"task1": 150, "task2": 250}
UPGRADED_MIN = 3

# error_type 别名 → 契约 7 类（AC-W4：模型自造的标签不许透传给前端）
_ERROR_ALIASES: dict[str, str] = {
    "syntax": "grammar",
    "tense": "grammar",
    "verb": "grammar",
    "agreement": "grammar",
    "subjectverb": "grammar",
    "article": "grammar",
    "sentencestructure": "grammar",
    "word": "lexical",
    "wordchoice": "lexical",
    "vocabulary": "lexical",
    "lexis": "lexical",
    "spellingerror": "spelling",
    "spell": "spelling",
    "punct": "punctuation",
    "comma": "punctuation",
    "collocate": "collocation",
    "phrase": "collocation",
    "cohesive": "cohesion",
    "coherencetoo": "cohesion",
    "linking": "cohesion",
    "paragraphing": "cohesion",
    "taskachievement": "task_response",
    "taskresponse": "task_response",
    "relevance": "task_response",
    "content": "task_response",
    "development": "task_response",
    "position": "task_response",
    "answer": "task_response",
}


# --------------------------------------------------------------------------
# 本地可选依赖（grade-core 产出；缺席时用本模块等价实现）
# --------------------------------------------------------------------------

def _offline_module():
    try:
        from app.services import offline_feedback  # noqa: PLC0415

        return offline_feedback
    except Exception:  # noqa: BLE001 - 兄弟模块半成品时不影响本模块可用
        return None


_CONNECTIVE_HINTS = (
    "however", "therefore", "moreover", "furthermore", "in addition", "as a result", "for example",
    "for instance", "although", "whereas", "while", "because", "since", "in conclusion", "on the one hand",
)


def analyze(text: str) -> dict[str, Any]:
    """FR-W5 的本地统计（段落数/句长/衔接词/重复词），优先复用 grade-core 的实现。"""
    offline = _offline_module()
    builder = getattr(offline, "analyze_text", None) if offline else None
    if callable(builder):
        try:
            value = builder(text)
            if isinstance(value, dict) and "word_count" in value:
                return value
        except Exception:  # noqa: BLE001 - 统计失败不影响评分
            pass

    body = text or ""
    paragraphs = [chunk.strip() for chunk in re.split(r"\n\s*\n", body) if chunk.strip()]
    sentences = [chunk.strip() for chunk in re.split(r"[.!?]+", body) if chunk.strip()]
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", body.lower())
    lengths = [len(re.findall(r"[A-Za-z][A-Za-z'-]*", item.lower())) for item in sentences]
    lowered = body.lower()
    counts: dict[str, int] = {}
    for word in words:
        counts[word] = counts.get(word, 0) + 1
    return {
        "word_count": len(body.split()),
        "paragraph_count": len(paragraphs) or (1 if body.strip() else 0),
        "sentence_lengths": lengths,
        "avg_sentence_length": round(statistics.mean(lengths), 2) if lengths else 0,
        "connectives": sorted({hint for hint in _CONNECTIVE_HINTS if hint in lowered}),
        "missing_articles": [],
        "repeated_words": sorted(
            [(word, value) for word, value in counts.items() if value >= 4 and word not in {"the", "a", "to", "of", "and"}]
            or [
                (word, value)
                for word, value in sorted(counts.items(), key=lambda kv: -kv[1])[:3]
                if value >= 3 and word not in {"the", "a", "to", "of", "and", "in", "is", "for"}
            ]
        ),
    }


# --------------------------------------------------------------------------
# 字数硬规则（AC-W3b，LLM 调用之前）
# --------------------------------------------------------------------------

def task_kind(task: Optional[dict[str, Any]]) -> str:
    value = str((task or {}).get("task") or (task or {}).get("kind") or "").strip().lower()
    return "task1" if "task1" in value or value in {"1", "t1"} else ("task2" if "task2" in value or value in {"2", "t2"} else "task2")


def min_words(task: Optional[dict[str, Any]]) -> int:
    raw = (task or {}).get("min_words")
    if isinstance(raw, bool):
        raw = None
    if isinstance(raw, (int, float)) and int(raw) > 0:
        return int(raw)
    return TASK_MIN_WORDS.get(task_kind(task), 250)


def count_words(response: Any) -> int:
    return len(str(response or "").split())


def word_penalty(word_count: int, task: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """未达字数 → §3-W 的硬性惩罚；达线返回 None（离线/在线共用）。"""
    floor = min_words(task)
    if word_count >= floor:
        return None
    return {
        "kind": UNDER_LENGTH,
        "missing_words": floor - word_count,
        "min_words": floor,
        "note_zh": f"低于官方最低 {floor} 词，Task Response/Achievement 上限夹到 5.0（AC-W3b）",
    }


# --------------------------------------------------------------------------
# band 校验与夹紧
# --------------------------------------------------------------------------

def clamp_band(value: float) -> float:
    clamped = max(0.0, min(9.0, float(value)))
    return int(clamped * 2) / 2.0


def _as_number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    return float(match.group()) if match else None


def normalise_band(raw: Any) -> tuple[dict[str, Any], bool, bool]:
    """(band, 是否缺维度, 是否有越界/非法值)：缺失补 null，越界夹紧（AC-W3 / FR-G5）。"""
    payload = raw if isinstance(raw, dict) else {}
    band: dict[str, Any] = {}
    missing = False
    illegal = False
    for criterion in CRITERIA:
        if criterion not in payload or payload.get(criterion) is None:
            band[criterion] = None
            missing = True
            continue
        number = _as_number(payload.get(criterion))
        if number is None:
            band[criterion] = None
            missing = True
            continue
        if not (0.0 <= number <= 9.0) or (number * 2) % 1 != 0:
            illegal = True
        band[criterion] = clamp_band(number)

    given = _as_number(payload.get("overall"))
    values = [band[c] for c in CRITERIA if band[c] is not None]
    if values:
        overall = clamp_band(statistics.mean(values))
        if given is not None and abs(given - overall) > 0.51:
            illegal = True  # 总分与四维不符 → 以四维为准并判非法输出
        band["overall"] = overall
    else:
        band["overall"] = clamp_band(given) if given is not None else None
    return band, missing, illegal


def apply_word_penalty(band: dict[str, Any], penalty: Optional[dict[str, Any]]) -> dict[str, Any]:
    """§3-W：未达字数时 task_response 上限 5.0，总分按四维重算。"""
    if not penalty:
        return band
    current = _as_number(band.get("task_response"))
    if current is not None:
        band["task_response"] = min(current, 5.0)
    values = [band[c] for c in CRITERIA if isinstance(band.get(c), (int, float))]
    band["overall"] = clamp_band(statistics.mean(values)) if values else band.get("overall")
    return band


# --------------------------------------------------------------------------
# 引用与错误类型校验
# --------------------------------------------------------------------------

def quote_in_source(quote: Any, source: str) -> str:
    """合法则返回逐字片段，否则空串（§3-P 第 2 条）。"""
    if not isinstance(quote, str):
        return ""
    text = quote.strip()
    if not text or not source:
        return ""
    return text if text in source else ""


def normalise_error_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in ERROR_TYPES:
        return raw
    compact = re.sub(r"[^a-z]+", "", raw)
    for known in ERROR_TYPES:
        if known.replace("_", "") == compact:
            return known
    if _ERROR_ALIASES.get(compact):
        return _ERROR_ALIASES[compact]
    for known in ERROR_TYPES:
        if known in raw or raw in known or known.replace("_", "") in compact:
            return known
    for alias, mapped in _ERROR_ALIASES.items():
        if alias and alias in compact:
            return mapped
    return "lexical"  # 归不进 7 类的按最宽泛的词汇问题保留，绝不透传未知标签


def _str_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    return []


def assemble_corrections(raw: Any, text: str) -> tuple[list[dict[str, Any]], int]:
    kept: list[dict[str, Any]] = []
    invalid = 0
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            invalid += 1
            continue
        quote = quote_in_source(item.get("quote"), text)
        if not quote:
            invalid += 1  # 幻觉引用：整条丢弃（§3-P 第 2 条）
            continue
        severity = str(item.get("severity") or "").strip().lower()
        kept.append(
            {
                "quote": quote,
                "error_type": normalise_error_type(item.get("error_type")),
                "explanation_zh": str(
                    item.get("explanation_zh") or item.get("explanation") or item.get("why") or ""
                ).strip(),
                "suggestion": str(item.get("suggestion") or item.get("fix") or "").strip(),
                "severity": severity if severity in SEVERITIES else "medium",
            }
        )
    return kept, invalid


def error_summary(corrections: list[dict[str, Any]]) -> dict[str, int]:
    """AC-W4：按 7 类聚合，且聚合总数 == 纠正条数。"""
    summary: dict[str, int] = {}
    for item in corrections:
        key = item["error_type"]
        summary[key] = summary.get(key, 0) + 1
    return summary


_LOCAL_UPGRADE_MAP: tuple[tuple[str, str, str], ...] = (
    ("a very big problem", "a serious problem", "避免 very + 泛型名词，搭配更正式"),
    ("very big problem", "pressing challenge", "6.5+ 搭配替换口语化的 big"),
    ("many people think", "a growing number of people argue", "主语与动词同时升级"),
    ("many people", "a large proportion of people", "量化表述更学术"),
    ("more and more", "an increasing number of", "口语比较级 → 学术表达"),
    ("i think", "in my view", "立场句避免第一人称直白"),
    ("good", "beneficial", "泛型形容词换成语域明确的词"),
    ("bad", "detrimental", "同上，负面影响的正式说法"),
    ("get", "obtain", "正式语体动词"),
    ("because", "owing to the fact that", "原因状语的高分连接方式（勿滥用）"),
    ("people is", "people are", "主谓一致"),
)


def local_upgrades(text: str) -> list[dict[str, Any]]:
    """无 AI（或 AI 给不够 3 条）时，从考生原文里挑真实片段做升级（from 必为原文连续片段）。"""
    lowered = (text or "").lower()
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for needle, better, why in _LOCAL_UPGRADE_MAP:
        index = lowered.find(needle)
        if index == -1 or needle in seen:
            continue
        seen.add(needle)
        out.append({"from": text[index : index + len(needle)], "to": better, "why_zh": why, "source": "local"})
    if len(out) < UPGRADED_MIN:
        for sentence in re.split(r"(?<=[.!?])\s+", (text or "").strip()):
            fragment = sentence.strip()
            if len(out) >= UPGRADED_MIN:
                break
            if len(fragment.split()) < 4 or fragment in seen:
                continue
            seen.add(fragment)
            out.append(
                {
                    "from": fragment,
                    "to": f"{fragment.rstrip('.')} — a claim that needs a concrete example to hold up",
                    "why_zh": "本地模板：观点句后补一个具体例证或让步，可稳定提高 TR 与 CC",
                    "source": "local",
                }
            )
    return out


def assemble_upgrades(raw: Any, text: str) -> tuple[list[dict[str, Any]], int]:
    kept: list[dict[str, Any]] = []
    invalid = 0
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            invalid += 1
            continue
        word_from = str(item.get("from") or item.get("from_sentence") or "").strip()
        better = str(item.get("to") or item.get("to_sentence") or "").strip()
        if not word_from or not better:
            continue
        if quote_in_source(word_from, text):
            word_from = quote_in_source(word_from, text)
        else:
            invalid += 1  # from 不是原文片段（§3-P 第 2 条）
            continue
        kept.append(
            {
                "from": word_from,
                "to": better,
                "why_zh": str(item.get("why_zh") or item.get("why") or "AI 考官给出的高档改写").strip(),
            }
        )
    if len(kept) < UPGRADED_MIN:
        for extra in local_upgrades(text):
            if len(kept) >= UPGRADED_MIN:
                break
            if extra["from"] not in {entry["from"] for entry in kept}:
                kept.append(extra)
    return kept[:8], invalid


def assemble_structure(raw: Any, stats: dict[str, Any]) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, str):
            kept.append({"kind": "paragraph_function", "issue_zh": item.strip(), "paragraph_index": None})
            continue
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip().lower()
        index = _as_number(item.get("paragraph_index"))
        kept.append(
            {
                "kind": kind if kind in STRUCTURE_KINDS else "paragraph_function",
                "issue_zh": str(item.get("issue_zh") or item.get("issue") or "").strip(),
                "paragraph_index": int(index) if index is not None and index >= 1 else None,
            }
        )
    if not kept:
        paragraphs = int(stats.get("paragraph_count") or 0)
        kept.append(
            {
                "kind": "paragraph_function",
                "issue_zh": (
                    f"本地统计只有 {paragraphs} 段：按「引入立场 / 主体论证 1 / 主体论证 2 / 结论」拆到 4 段"
                    if paragraphs < 4
                    else "本地统计未发现段落级问题；请再核对每段是否只服务一个中心"
                ),
                "paragraph_index": None,
            }
        )
    return kept[:6]


def local_model_answer(task: Optional[dict[str, Any]]) -> str:
    prompt_text = str((task or {}).get("prompt") or "").strip() or "The task prompt"
    return (
        "[本地范文骨架，非 AI 产出] " + prompt_text + " — "
        "The issue above has attracted considerable attention, and this response sets out a clear position in the "
        "first paragraph, develops two distinct reasons in the body, and closes by restating the conclusion. "
        "Each body paragraph serves one central idea: claim, explanation, concrete example, and a short consequence. "
        "Connectives such as however, as a result and in contrast are used sparingly, so that cohesion comes from the "
        f"argument itself rather than from memorised linkers. Aim for at least {min_words(task)} words with your own data."
    ).strip()


# --------------------------------------------------------------------------
# 报告组装
# --------------------------------------------------------------------------

def _skeleton(
    task: Optional[dict[str, Any]],
    text: str,
    stats: dict[str, Any],
    *,
    word_count: int,
    penalty: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """§3-W 报告骨架（前端不能因缺字段崩，AC-W3 降级路径也要齐全）。"""
    band = {criterion: None for criterion in CRITERIA}
    band["overall"] = None
    return {
        "attempt_id": None,
        "module": "writing",
        "task": task_kind(task),
        "band": band,
        "word_count": word_count,
        "word_count_penalty": penalty,
        "corrections": [],
        "upgraded_sentences": [],
        "structure_issues": [],
        "strengths": [],
        "model_answer": "",
        "error_summary": {},
        "invalid_quotes": 0,
        "analysis": stats,
    }


def _finalise(report: dict[str, Any], penalty: Optional[dict[str, Any]]) -> dict[str, Any]:
    report["band"] = apply_word_penalty(report.get("band") or {}, penalty)
    report["word_count_penalty"] = penalty
    report["corrections"] = report.get("corrections") or []
    report["error_summary"] = error_summary(report["corrections"])
    return report


def _local_band(stats: dict[str, Any], task: Optional[dict[str, Any]], word_count: int) -> dict[str, Any]:
    """本地近似四维（只用可核对的统计量；整份报告标 approximate=true，FR-W5）。"""
    floor = min_words(task)
    coverage = clamp_band(3.0 + min(3.0, (word_count / floor if floor else 0.0) * 3.0))
    paragraphs = int(stats.get("paragraph_count") or 0)
    cohesion = clamp_band(
        3.0 + min(2.5, paragraphs * 0.6) + min(1.0, len(stats.get("connectives") or []) * 0.3)
    )
    avg = float(stats.get("avg_sentence_length") or 0.0)
    grammar = clamp_band(4.0 + min(2.5, avg / 8.0))
    unique = len({word.lower() for word in str(stats.get("_raw") or "").split() if word.strip()})
    lexical = clamp_band(3.5 + min(2.5, unique / 30.0))
    band = {
        "task_response": coverage,
        "coherence_cohesion": cohesion,
        "lexical_resource": lexical,
        "grammatical_range_accuracy": grammar,
    }
    band["overall"] = clamp_band(statistics.mean(band.values()))
    return band


def _offline_report(
    task: Optional[dict[str, Any]],
    text: str,
    stats: dict[str, Any],
    *,
    duration_sec: Optional[float],
    word_count: int,
    penalty: Optional[dict[str, Any]],
    reason: str,
    model: str,
) -> dict[str, Any]:
    """AI 失败时的本地近似报告（优先复用 grade-core 的 offline_feedback.writing_report）。"""
    offline = _offline_module()
    builder = getattr(offline, "writing_report", None) if offline else None
    if callable(builder):
        try:
            report = builder(task, text, duration_sec=duration_sec)
            if isinstance(report, dict):
                band = report.get("band") if isinstance(report.get("band"), dict) else {}
                merged = _skeleton(task, text, stats, word_count=word_count, penalty=penalty)
                merged["attempt_id"] = report.get("attempt_id")
                merged["task"] = report.get("task") or merged["task"]
                for criterion in CRITERIA:
                    value = _as_number(band.get(criterion))
                    merged["band"][criterion] = clamp_band(value) if value is not None else None
                merged["band"]["overall"] = _as_number(band.get("overall"))
                if all(merged["band"][c] is None for c in CRITERIA):
                    merged["band"] = _local_band(stats, task, word_count)
                merged["corrections"] = [
                    {
                        "quote": str(item.get("quote") or ""),
                        "error_type": normalise_error_type(item.get("error_type")),
                        "explanation_zh": str(item.get("explanation_zh") or item.get("explanation") or ""),
                        "suggestion": str(item.get("suggestion") or ""),
                        "severity": str(item.get("severity") or "low").strip().lower()
                        if str(item.get("severity") or "").strip().lower() in SEVERITIES
                        else "medium",
                    }
                    for item in (report.get("corrections") or [])
                    if isinstance(item, dict) and quote_in_source(item.get("quote"), text)
                ]
                merged["upgraded_sentences"] = [
                    {"from": str(item.get("from") or ""), "to": str(item.get("to") or ""),
                     "why_zh": str(item.get("why_zh") or ""), "source": str(item.get("source") or "local")}
                    for item in (report.get("upgraded_sentences") or [])
                    if isinstance(item, dict)
                ] or local_upgrades(text)
                merged["structure_issues"] = [
                    item for item in (report.get("structure_issues") or []) if isinstance(item, dict)
                ] or assemble_structure(None, stats)
                merged["strengths"] = _str_list(report.get("strengths")) or [
                    "本次为本地近似评分：统计量可核对，但没有 AI 考官的逐项批注。"
                ]
                merged["model_answer"] = str(report.get("model_answer") or "") or local_model_answer(task)
                merged["analysis"] = report.get("analysis") or stats
                merged["invalid_quotes"] = 0
                merged["ai_used"] = False
                merged["degraded_reason"] = (
                    reason if reason in ai_client.DEGRADED_REASONS else ai_client.REASON_OFFLINE_TEMPLATE
                )
                merged["approximate"] = True
                merged["model"] = model
                return _finalise(merged, penalty)
        except Exception:  # noqa: BLE001 - 兄弟模块不可用时退回本模块实现
            pass

    merged = _skeleton(task, text, stats, word_count=word_count, penalty=penalty)
    merged["band"] = _local_band(stats, task, word_count)
    merged["corrections"] = []
    merged["upgraded_sentences"] = local_upgrades(text)
    merged["structure_issues"] = assemble_structure(None, stats)
    merged["strengths"] = ["本次为本地近似评分：统计量可核对，但没有 AI 考官的逐项批注。"]
    merged["model_answer"] = local_model_answer(task)
    merged["ai_used"] = False
    merged["degraded_reason"] = reason if reason in ai_client.DEGRADED_REASONS else ai_client.REASON_OFFLINE_TEMPLATE
    merged["approximate"] = True
    merged["model"] = model
    return _finalise(merged, penalty)


# --------------------------------------------------------------------------
# 入口
# --------------------------------------------------------------------------

def grade(
    task: Optional[dict[str, Any]],
    response: Any,
    *,
    duration_sec: Optional[float] = None,
    allow_network: bool = True,
    target_band: Optional[float] = None,
) -> dict[str, Any]:
    """一次写作批改，返回 §3-W `WritingReport`（**永不抛异常**，AC-W3）。"""
    text = "" if response is None else str(response).strip()
    task_doc = task if isinstance(task, dict) else {}
    word_count = count_words(text)
    stats = analyze(text)
    stats.setdefault("_raw", text)

    # AC-W3b：字数惩罚是本地硬规则，必须在调用 LLM 之前算好（并写进 prompt，不让它再判一次）
    penalty = word_penalty(word_count, task_doc)

    user_prompt = writing_prompts.build_prompt(
        task_doc,
        text,
        word_count=word_count,
        penalty=penalty,
        duration_sec=duration_sec,
        stats=stats,
    )
    system = "\n\n".join(
        [
            writing_prompts.SYSTEM_PROMPT,
            writing_prompts.BAND_RULES,
            writing_prompts.CORRECTION_RULES,
            f"调用参数固定为 temperature={TEMPERATURE}（§3-P 第 4 条：temperature ≤ 0.3），max_tokens 显式设置。",
        ]
    )
    result = ai_client.complete_json(
        user_prompt,
        system=system,
        temperature=TEMPERATURE,
        max_tokens=WRITING_MAX_TOKENS,
        allow_network=allow_network,
        require_api_key=False,  # 评分链路允许本机无凭据 OpenAI 兼容端点（见 ai_client 模块 docstring）
    )

    if not result.ok:
        reason = result.reason or ai_client.REASON_OFFLINE_TEMPLATE
        return _offline_report(
            task_doc,
            text,
            stats,
            duration_sec=duration_sec,
            word_count=word_count,
            penalty=penalty,
            reason=reason,
            model=result.model,
        )

    payload = result.data if isinstance(result.data, dict) else {}
    band, missing, illegal = normalise_band(payload.get("band"))
    corrections, invalid_corrections = assemble_corrections(payload.get("corrections"), text)
    upgraded, invalid_upgrades = assemble_upgrades(payload.get("upgraded_sentences"), text)

    report = _skeleton(task_doc, text, stats, word_count=word_count, penalty=penalty)
    report["band"] = band
    report["corrections"] = corrections
    report["upgraded_sentences"] = upgraded
    report["structure_issues"] = assemble_structure(payload.get("structure_issues"), stats)
    report["strengths"] = _str_list(payload.get("strengths")) or ["AI 考官未给出优势项，请对照 corrections 逐条订正。"]
    report["model_answer"] = str(payload.get("model_answer") or "").strip() or local_model_answer(task_doc)
    report["invalid_quotes"] = invalid_corrections + invalid_upgrades
    if target_band is not None:
        report["target_band"] = float(target_band)

    reason: Optional[str] = None
    if illegal:
        reason = ai_client.REASON_INVALID_OUTPUT
    elif missing:
        reason = ai_client.REASON_INCOMPLETE_DIMENSIONS

    report["ai_used"] = reason is None
    report["degraded_reason"] = reason
    report["approximate"] = reason is not None
    report["model"] = result.model
    return _finalise(report, penalty)


# --------------------------------------------------------------------------
# 落库辅助（供 api/writing.py 使用，AC-W4 错题本）
# --------------------------------------------------------------------------

def build_review_entries(report: dict[str, Any]) -> list[dict[str, Any]]:
    """把纠正项转成 `store.record_review` 的入参（AC-W4：写作错误进错题本）。"""
    task = str(report.get("task") or "")
    entries: list[dict[str, Any]] = []
    for item in report.get("corrections") or []:
        if not isinstance(item, dict):
            continue
        entries.append(
            {
                "item_ref": task or None,
                "question_type": task or None,
                "error_type": item.get("error_type") or "lexical",
                "quote": item.get("quote") or "",
                "detail_zh": item.get("explanation_zh") or "",
            }
        )
    return entries
