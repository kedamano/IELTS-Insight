"""听力客观判分（spec-contracts.md §6 + §3-OR；验收 AC-L2、AC-L3、AC-L5、§2-L）。

`grade()` 是**纯函数**：题库文档 + `AnswerMap` → ObjectiveReport，不碰 IO、不修改入参
（tests/test_grade_objective.py 断言）。落库由 `api/listening.py` 走 `db/store.py` 完成（AC-G2）。

判分核心 `grade_set()` 与题型/泄漏字段常量放在本模块，`reading_grader.py` 从这里复用
（所有权：本 Wave 只允许创建任务列出的文件，故不为共用代码另开模块文件）。

`strip_answers()` 生成题面视图：剔除 `answer`/`accepted_alternatives`/`explanation_zh`
与答案定位字段（§2-L / §10.1），但**保留 `audio_text`**（AC-L1b 原文精读回落）。
"""

from __future__ import annotations

import copy
from typing import Any, Optional

from app.services import answer_norm, band_scale

# 走「等价规范化 + 词数上限」判定的题型；其余（选项/标签/TFNG/heading）走字面等价
GAP_TYPES = frozenset({"gap_fill", "sentence_completion"})

# §2-L / §10.1：题面必须剔除的字段（tests/test_grade_objective.py LEAK_KEYS 同集合）
LEAK_KEYS = ("answer", "accepted_alternatives", "explanation_zh", "answer_quote", "answer_paragraph", "answer_label")

MODULE = "listening"


def judge_question(question: dict[str, Any], your_answer: Any) -> tuple[bool, Optional[str]]:
    """单题判定：填空题走 answer_norm.judge_fill，其余走 judge_choice。"""
    qtype = question.get("type") or ""
    expected = question.get("answer")
    alts = question.get("accepted_alternatives") or []
    if qtype in GAP_TYPES:
        return answer_norm.judge_fill(
            expected, your_answer, accepted_alternatives=alts, word_limit=question.get("word_limit")
        )
    return answer_norm.judge_choice(expected, your_answer, question_type=qtype, accepted_alternatives=alts)


def grade_set(
    set_doc: dict[str, Any],
    answers: Any,
    *,
    module: str,
    duration_sec: Optional[float] = None,
    timed_out: bool = False,
) -> dict[str, Any]:
    """§3-OR ObjectiveReport 的公共构造（听/读共用，不修改入参）。

    `answers` 值一般为字符串；也接受 `{"answer": str, "time_spent_sec": number}`
    ——契约请求体没定义逐题用时，前端将来可无损增传。
    """
    questions = [q for q in (set_doc.get("questions") or []) if isinstance(q, dict)]
    answer_map: dict[str, Any] = answers if isinstance(answers, dict) else {}

    items: list[dict[str, Any]] = []
    by_question_type: dict[str, dict[str, int]] = {}
    raw_correct = 0

    for question in questions:
        qid = question.get("id")
        time_spent: Any = None
        your_answer: Any = answer_map.get(qid)
        if isinstance(your_answer, dict):
            time_spent = your_answer.get("time_spent_sec")
            your_answer = your_answer.get("answer", "")

        correct, reason = judge_question(question, your_answer)
        if correct:
            raw_correct += 1

        qtype = str(question.get("type") or "unknown")
        bucket = by_question_type.setdefault(qtype, {"correct": 0, "total": 0})
        bucket["total"] += 1
        if correct:
            bucket["correct"] += 1

        items.append(
            {
                "id": qid,
                "number": question.get("number"),
                "type": qtype,  # §3-OR：items[].type = question_type
                "your_answer": "" if your_answer is None else str(your_answer),
                "expected": question.get("answer"),
                "accepted_alternatives": list(question.get("accepted_alternatives") or []),
                "correct": bool(correct),
                "reason": reason,
                "explanation_zh": question.get("explanation_zh") or "",
                "answer_quote": question.get("answer_quote"),
                "answer_paragraph": question.get("answer_paragraph"),
                "time_spent_sec": time_spent,
            }
        )

    raw_total = len(questions)
    band = band_scale.raw_to_band(module, raw_correct, raw_total) if raw_total else 0.0
    report: dict[str, Any] = {
        "module": module,
        "raw_correct": raw_correct,
        "raw_total": raw_total,
        "band": float(band),
        "band_scale": band_scale.band_scale_name(module, raw_total),
        # 客观题无 AI：ai_used 恒 false（CONSTITUTION §3 的可见降级在 AI 模块）
        "ai_used": False,
        "degraded_reason": None,
        "approximate": False,
        "items": items,
        "by_question_type": by_question_type,
        "accuracy": round(raw_correct / raw_total, 3) if raw_total else 0.0,
    }
    if module == "listening":
        # AC-L1b：attempt 响应回传听力原文，供「音频不可用 → 精读模式」
        report["transcript"] = set_doc.get("audio_text") or ""
    elif timed_out:
        report["timed_out"] = True  # AC-R3：到点自动提交标记
    return report


def grade(
    set_doc: dict[str, Any],
    answers: Any,
    *,
    duration_sec: Optional[float] = None,
) -> dict[str, Any]:
    """听力 20 题判分（AC-L2 全量判分 + AC-L5 band 换算）。"""
    return grade_set(set_doc, answers, module=MODULE, duration_sec=duration_sec)


def strip_answers(set_doc: dict[str, Any]) -> dict[str, Any]:
    """题面视图（深拷贝）：剔除一切答案泄漏字段，保留 audio_text（§10.1）。"""
    doc = copy.deepcopy(set_doc)
    for question in doc.get("questions") or []:
        if isinstance(question, dict):
            for key in LEAK_KEYS:
                question.pop(key, None)
    return doc
