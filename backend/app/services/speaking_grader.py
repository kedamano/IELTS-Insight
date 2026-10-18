"""口语评分（spec-contracts.md §3-S + §3-P + §6；AC-S4/S5/S6、FR-S4/S5/S6）。

流程：组 prompt → `ai_client.complete_json` → 解析 → **校验与夹紧** → 组装 §3-S `SpeakingReport`。

夹紧/降级口径（AC-S4）：
- band 越界（如 12 / -3）或非 0.5 步长 → 夹到 0–9 的 0.5 档，`ai_used=false` +
  `degraded_reason="invalid_model_output"` + `approximate=true`，**不 500**；
- 四维缺项 → 缺失维度补 `null` + `incomplete_dimensions`；
- 非 JSON（重试 1 次后仍失败）/ 无 key / 网络失败 → 本地近似报告，`degraded_reason` 用真实原因；
- `quote` 不是考生原文连续片段 → 该条证据丢弃、改进项去掉引用，并计入 `invalid_quotes`（§3-P 第 2 条）。

本模块**不碰数据库**（L2 契约测试直接调用它）：落库由 `api/speaking.py` + `speaking_session`
经 `app.db.store.record_attempt` 完成（AC-G2）。
"""
from __future__ import annotations

import re
import statistics
from typing import Any, Optional

from app.prompts import TEMPERATURE, SPEAKING_MAX_TOKENS
from app.prompts import speaking as speaking_prompts
from app.services import ai_client

CRITERIA: tuple[str, ...] = speaking_prompts.CRITERIA
BAND_KEYS = ("overall", *CRITERIA, "pronunciation_confidence")
MODEL_ANSWER_MAX_WORDS = 150

# §3-P 第 2 条：证据必须能在考生原文里逐字找到
_FILLER_HINTS = ("you know", "i mean", "kind of", "sort of", "um", "uh")


# --------------------------------------------------------------------------
# 本地可选依赖（grade-core 并行产出；缺失时用本模块的等价实现，绝不因此失败）
# --------------------------------------------------------------------------

def _metrics_module():
    try:
        from app.services import speaking_metrics  # noqa: PLC0415

        if callable(getattr(speaking_metrics, "compute", None)):
            return speaking_metrics
    except Exception:  # noqa: BLE001 - 兄弟模块半成品时不影响本模块可用
        return None
    return None


def _offline_module():
    try:
        from app.services import offline_feedback  # noqa: PLC0415

        return offline_feedback
    except Exception:  # noqa: BLE001
        return None


def _words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z'’\-]*|\d[\d.,:/-]*", text or "")


def local_metrics(transcript: str, duration_sec: float, *, segments: Optional[list[dict]] = None) -> dict[str, Any]:
    """`speaking_metrics.compute` 的等价兜底：{word_count, wpm, pause_total_sec, fillers, repeats}。"""
    text = transcript or ""
    words = text.split()
    count = len(words)
    try:
        seconds = float(duration_sec or 0.0)
    except (TypeError, ValueError):
        seconds = 0.0
    wpm = round(count / (seconds / 60.0)) if seconds > 0 else 0

    pause_total = 0.0
    if isinstance(segments, list):
        previous_end: Optional[float] = None
        for seg in segments:
            if not isinstance(seg, dict):
                continue
            try:
                start = float(seg.get("start"))
                end = float(seg.get("end"))
            except (TypeError, ValueError):
                continue
            if previous_end is not None and start > previous_end:
                pause_total += start - previous_end
            previous_end = max(previous_end or 0.0, end)

    lowered = text.lower()
    fillers: list[str] = []
    for filler in _FILLER_HINTS:
        if re.search(rf"\b{re.escape(filler)}\b", lowered):
            fillers.append(filler)
    repeats = 0
    for a, b in zip(words, words[1:]):
        if a.lower().strip(".,!?") == b.lower().strip(".,!?"):
            repeats += 1

    return {
        "word_count": count,
        "wpm": wpm,
        "pause_total_sec": round(pause_total, 2),
        "fillers": fillers,
        "repeats": repeats,
    }


def compute_metrics(
    transcript: str, duration_sec: float, *, segments: Optional[list[dict]] = None
) -> dict[str, Any]:
    mod = _metrics_module()
    if mod is not None:
        try:
            value = mod.compute(transcript, float(duration_sec or 0.0), segments=segments)
            if isinstance(value, dict) and "word_count" in value:
                value.setdefault("wpm", 0)
                value.setdefault("pause_total_sec", 0.0)
                value.setdefault("fillers", [])
                value.setdefault("repeats", 0)
                return value
        except Exception:  # noqa: BLE001 - 指标算不出来也不许拖垮评分
            pass
    return local_metrics(transcript, duration_sec, segments=segments)


# --------------------------------------------------------------------------
# band 校验与夹紧
# --------------------------------------------------------------------------

def clamp_band(value: float) -> float:
    """0–9 夹紧 + 向下取到最近 0.5 档（§3-B「取较低档」口径，FR-G5）。"""
    clamped = max(0.0, min(9.0, float(value)))
    return int(clamped * 2) / 2.0


def _as_number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    return float(match.group()) if match else None


def _normalise_band(raw: Any) -> tuple[dict[str, Any], bool, bool]:
    """返回 (band 字典, 是否缺维度, 是否有越界/非法值)。缺失补 null，越界夹紧。"""
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
            illegal = True  # 模型给的总分与四维明显不符 → 按四维重算并标记非法
    else:
        overall = clamp_band(given) if given is not None else None
    band["overall"] = overall
    return band, missing, illegal


# --------------------------------------------------------------------------
# 引用校验
# --------------------------------------------------------------------------

def quote_in_source(quote: Any, source: str) -> str:
    """合法则返回逐字片段，否则空串（§3-P 第 2 条）。"""
    if not isinstance(quote, str):
        return ""
    text = quote.strip()
    if not text or not source:
        return ""
    return text if text in source else ""


def _first_criterion(value: Any) -> str:
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    for criterion in CRITERIA:
        if criterion in text or text in criterion:
            return criterion
    aliases = {
        "fluency": "fluency_coherence",
        "coherence": "fluency_coherence",
        "lexis": "lexical_resource",
        "vocabulary": "lexical_resource",
        "grammar": "grammatical_range_accuracy",
        "range": "grammatical_range_accuracy",
        "pron": "pronunciation",
    }
    for key, mapped in aliases.items():
        if key in text:
            return mapped
    return "lexical_resource"


def _str_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    return []


def _sample_quote(transcript: str, max_chars: int = 60) -> str:
    """从考生原文里取一段连续片段当兜底引用（一定是原文子串，符合 §3-P）。"""
    text = (transcript or "").strip()
    if not text:
        return ""
    return text[:max_chars].strip()


# --------------------------------------------------------------------------
# 报告组装
# --------------------------------------------------------------------------

def _ai_meta(report: dict[str, Any], *, ai_used: bool, reason: Optional[str], model: str) -> dict[str, Any]:
    report["ai_used"] = ai_used
    report["degraded_reason"] = reason
    report["approximate"] = not ai_used
    report["model"] = model
    return report


def _assemble_evidence(raw: Any, transcript: str) -> tuple[list[dict[str, Any]], int]:
    kept: list[dict[str, Any]] = []
    invalid = 0
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            invalid += 1
            continue
        quote = quote_in_source(item.get("quote"), transcript)
        if not quote:
            invalid += 1
            continue
        kept.append(
            {
                "criterion": _first_criterion(item.get("criterion")),
                "quote": quote,
                "why": str(item.get("why") or item.get("why_zh") or item.get("explanation_zh") or "").strip(),
                "level": str(item.get("level") or "").strip(),
            }
        )
    return kept, invalid


def _assemble_improvements(raw: Any, transcript: str, metrics: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    kept: list[dict[str, Any]] = []
    invalid = 0
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            invalid += 1
            continue
        issue = str(item.get("issue") or item.get("issue_zh") or "").strip()
        fix = str(item.get("fix") or item.get("fix_zh") or "").strip()
        if not issue and not fix:
            continue
        quote = quote_in_source(item.get("quote"), transcript)
        if item.get("quote") and not quote:
            invalid += 1  # 非法引用：条目保留（FR-S5 要 ≥3 条），但不带原文
        kept.append({"issue": issue, "fix": fix, "quote": quote})

    if len(kept) < 3:
        kept.extend(_local_improvements(transcript, metrics))
    return kept[:8], invalid


def _local_improvements(transcript: str, metrics: dict[str, Any]) -> list[dict[str, Any]]:
    """本地可核对的改进项（FR-S5 的 3 条下限；quote 一律取考生原文连续片段）。"""
    sample = _sample_quote(transcript)
    candidates = [
        {
            "issue": "填充词与重复影响流利度",
            "fix": "用停顿代替 you know / um，并把重复的词换成同义替换",
            "quote": sample,
        },
        {
            "issue": "回答展开不足，缺少具体例子",
            "fix": "按「观点 + 原因 + 一个具体场景」三段式扩写，每个问题至少说 3 句",
            "quote": sample,
        },
        {
            "issue": "用词空泛（good / bad / things 一类）",
            "fix": "换成语域明确的搭配，例如 rewarding / drawback / aspect",
            "quote": sample,
        },
        {
            "issue": "句式单一，多为简单句",
            "fix": "加入一个原因从句或条件句（because / if / although），注意时态一致",
            "quote": sample,
        },
    ]
    wanted = 3 if not metrics.get("fillers") and (metrics.get("wpm") or 0) >= 60 else 4
    return candidates[: max(3, wanted)]


def _local_upgrades(transcript: str) -> list[dict[str, Any]]:
    """无 AI 时的词表替换（来源标注为 local，FR-S5「来源须标注」）。"""
    map_ = {
        "good": ("rewarding", "6.5+ 搭配，用来描述经历或收获"),
        "bad": ("drawback", "替换 bad 的书面/口语高档说法"),
        "very": ("particularly", "避免 very + 形容词的平淡组合"),
        "things": ("aspects", "抽象名词更精确"),
        "nice": ("enjoyable", "描述体验时更具体"),
        "important": ("crucial", "7+ 强调程度的搭配"),
        "like": ("keen on", "表达喜好的高分搭配"),
        "think": ("reckon / believe", "避免反复使用 think"),
        "many": ("a great many", "数量表达更精确"),
    }
    lowered = (transcript or "").lower()
    out: list[dict[str, Any]] = []
    for word, (better, note) in map_.items():
        if re.search(rf"\b{re.escape(word)}\b", lowered):
            out.append({"from": word, "to": better, "note_zh": note, "source": "local"})
    return out


def _assemble_upgrades(raw: Any, transcript: str) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        word_from = str(item.get("from") or item.get("from_word") or "").strip()
        word_to = str(item.get("to") or item.get("to_word") or "").strip()
        if not word_from or not word_to:
            continue
        note = str(item.get("note_zh") or item.get("note") or "").strip()
        entry = {"from": word_from, "to": word_to, "note_zh": note or "AI 考官给出的搭配升级"}
        if item.get("source"):
            entry["source"] = str(item["source"])
        kept.append(entry)
    return kept or _local_upgrades(transcript)


def _truncate_answer(text: Any, max_words: int = MODEL_ANSWER_MAX_WORDS) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    words = value.split()
    return value if len(words) <= max_words else " ".join(words[:max_words])


def _pronunciation_detail(
    transcript: str, *, expected_text: Optional[str] = None, confidence: Optional[float] = None
) -> dict[str, Any]:
    """§3-S 的发音细节区（AC-V3 折叠区）。只有存在跟读原文时才用 WER 规则分（§10.2）。"""
    wer: Optional[float] = None
    score: Optional[int] = None
    if expected_text:
        try:
            from app.services.score_service import score as rule_score  # noqa: PLC0415

            result = rule_score(expected_text, transcript or "")
            wer = round(max(0.0, min(1.0, 1.0 - result.completeness_score / 100.0)), 4)
            score = int(result.pronunciation_score)
        except Exception:  # noqa: BLE001 - 发音辅助分算不出就给 null，不影响 band
            wer, score = None, None
    return {
        "wer": wer,
        "score_0_100": score,
        "problem_words": [],
        "confidence": confidence,
        "note_zh": (
            "无音频，发音维度按转写文本推断" if wer is None else "发音近似分来自 WER 规则，仅作辅助（AC-G5）"
        ),
    }


def _offline_report(
    prompt_text: str,
    transcript: str,
    duration_sec: float,
    metrics: dict[str, Any],
    *,
    reason: str,
    model: str,
    has_audio: bool,
) -> dict[str, Any]:
    """本地近似报告（CONSTITUTION §3：必须可见）。优先复用 grade-core 的 offline_feedback。"""
    offline = _offline_module()
    builder = getattr(offline, "speaking_report", None) if offline else None
    if callable(builder):
        try:
            report = builder(prompt_text, transcript, duration_sec, metrics=metrics)
            if isinstance(report, dict):
                report.setdefault("band", {})
                band = report["band"]
                for criterion in CRITERIA:
                    band.setdefault(criterion, None)
                band["overall"] = _final_overall(band)
                band["pronunciation_confidence"] = "high" if has_audio else "low"
                report.setdefault("evidence", [])
                report.setdefault("strengths", [])
                report.setdefault("improvements", _local_improvements(transcript, metrics))
                report.setdefault("upgrade_vocabulary", _local_upgrades(transcript))
                report["metrics"] = metrics
                report["pronunciation_detail"] = _pronunciation_detail(transcript)
                report["invalid_quotes"] = 0
                return _ai_meta(
                    report,
                    ai_used=False,
                    reason=reason if reason in ai_client.DEGRADED_REASONS else ai_client.REASON_OFFLINE_TEMPLATE,
                    model=model,
                )
        except Exception:  # noqa: BLE001 - 兄弟模块不可用时退回本模块实现
            pass
    return _local_report(prompt_text, transcript, duration_sec, metrics, reason=reason, model=model, has_audio=has_audio)


def _final_overall(band: dict[str, Any]) -> Optional[float]:
    values = [band[c] for c in CRITERIA if isinstance(band.get(c), (int, float))]
    return clamp_band(statistics.mean(values)) if values else None


def _local_report(
    prompt_text: str,
    transcript: str,
    duration_sec: float,
    metrics: dict[str, Any],
    *,
    reason: str,
    model: str,
    has_audio: bool,
) -> dict[str, Any]:
    """完全本地可算的 §3-S 骨架（grade-core 的 offline_feedback 缺席时的等价实现）。"""
    band = {criterion: None for criterion in CRITERIA}
    word_count = int(metrics.get("word_count") or 0)
    wpm = float(metrics.get("wpm") or 0.0)

    # 只从本地量给「近似」定位：语速与展开程度，全部标 approximate
    fluency = clamp_band(4.0 + min(2.0, wpm / 60.0) - min(1.0, (metrics.get("repeats") or 0) * 0.25))
    length = clamp_band(3.5 + min(2.5, word_count / 60.0))
    band["fluency_coherence"] = clamp_band((fluency + length) / 2)
    band["lexical_resource"] = clamp_band(length - 0.5 if word_count < 40 else length)
    band["grammatical_range_accuracy"] = clamp_band(length - 0.5)
    band["pronunciation"] = clamp_band(5.0) if has_audio else None
    band["overall"] = _final_overall(band)
    band["pronunciation_confidence"] = "high" if has_audio else "low"

    return _ai_meta(
        {
            "attempt_id": None,
            "band": band,
            "evidence": [],
            "strengths": ["本次为本地近似评分，未使用 AI 考官的逐项证据。"],
            "improvements": _local_improvements(transcript, metrics),
            "model_answer": _truncate_answer(_template_answer(prompt_text, transcript)),
            "upgrade_vocabulary": _local_upgrades(transcript),
            "metrics": metrics,
            "pronunciation_detail": _pronunciation_detail(transcript),
            "invalid_quotes": 0,
        },
        ai_used=False,
        reason=reason if reason in ai_client.DEGRADED_REASONS else ai_client.REASON_OFFLINE_TEMPLATE,
        model=model,
    )


def _template_answer(prompt_text: str, transcript: str) -> str:
    opener = "Well, " if not (prompt_text or "").startswith("Describe") else "I would like to talk about "
    return (
        f"{opener}the topic you have been given. Let me start with a clear position and then give a reason, "
        f"because examiners reward answers that are organised rather than long. "
        f"For instance, I remember one specific occasion which shows why this matters to me. "
        f"As a result, I would say the experience changed the way I think about it. "
        "This is a template answer (one band above the local estimate); replace the details with your own example."
    )


# --------------------------------------------------------------------------
# 入口
# --------------------------------------------------------------------------

def grade(
    prompt: str,
    transcript: str,
    duration_sec: float,
    *,
    segments: Optional[list[dict[str, Any]]] = None,
    audio_bytes: Optional[bytes] = None,
    part: Optional[Any] = None,
    target_band: Optional[float] = None,
    expected_text: Optional[str] = None,
    allow_network: bool = True,
) -> dict[str, Any]:
    """一次口语评分，返回 §3-S `SpeakingReport`（**永不抛异常**，AC-S4）。"""
    text = (transcript or "").strip()
    seconds = float(duration_sec) if isinstance(duration_sec, (int, float)) else 0.0
    has_audio = bool(audio_bytes)
    metrics = compute_metrics(text, seconds, segments=segments)

    user_prompt = speaking_prompts.build_prompt(
        prompt,
        text,
        seconds,
        part=part,
        target_band=target_band,
        metrics=metrics,
        has_audio=has_audio,
    )
    system = "\n\n".join(
        [
            speaking_prompts.SYSTEM_PROMPT,
            speaking_prompts.BAND_RULES,
            speaking_prompts.EVIDENCE_RULES,
            f"调用参数固定为 temperature={TEMPERATURE}（§3-P 第 4 条：temperature ≤ 0.3），max_tokens 显式设置。",
        ]
    )
    result = ai_client.complete_json(
        user_prompt,
        system=system,
        temperature=TEMPERATURE,
        max_tokens=SPEAKING_MAX_TOKENS,
        allow_network=allow_network,
        require_api_key=False,  # 评分链路允许本机无凭据 OpenAI 兼容端点（见 ai_client 模块 docstring）
    )

    if not result.ok:
        reason = result.reason or ai_client.REASON_OFFLINE_TEMPLATE
        return _ai_meta(
            _offline_report(prompt, text, seconds, metrics, reason=reason, model=result.model, has_audio=has_audio),
            ai_used=False,
            reason=reason,
            model=result.model,
        )

    payload = result.data if isinstance(result.data, dict) else {}
    band, missing, illegal = _normalise_band(payload.get("band"))
    declared_confidence = str((payload.get("band") or {}).get("pronunciation_confidence") or "").strip().lower()
    # FR-S4：没有音频时发音维度只能是低置信（文本兜底 AC-S3b 也走这条路）
    band["pronunciation_confidence"] = "high" if has_audio and declared_confidence != "low" else "low"
    evidence, invalid_evidence = _assemble_evidence(payload.get("evidence"), text)
    improvements, invalid_improve = _assemble_improvements(payload.get("improvements"), text, metrics)

    reason: Optional[str] = None
    if illegal:
        reason = ai_client.REASON_INVALID_OUTPUT
    elif missing:
        reason = ai_client.REASON_INCOMPLETE_DIMENSIONS

    return _ai_meta(
        {
            "attempt_id": None,
            "band": band,
            "evidence": evidence,
            "strengths": _str_list(payload.get("strengths"))
            or ["本次回答的结构可以在证据里逐条对照。"],
            "improvements": improvements,
            "model_answer": _truncate_answer(payload.get("model_answer")) or _truncate_answer(_template_answer(prompt, text)),
            "upgrade_vocabulary": _assemble_upgrades(payload.get("upgrade_vocabulary"), text),
            "metrics": metrics,
            "pronunciation_detail": _pronunciation_detail(text, expected_text=expected_text),
            "invalid_quotes": invalid_evidence + invalid_improve,
        },
        ai_used=reason is None,
        reason=reason,
        model=result.model,
    )
