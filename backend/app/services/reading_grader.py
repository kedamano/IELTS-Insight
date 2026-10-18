"""阅读客观判分（spec-contracts.md §6 + §3-OR；验收 AC-R3、AC-R4、AC-R5）。

判分核心复用 `listening_grader.grade_set`（题型分流在 answer_norm）：
- `gap_fill` / `sentence_completion` → 等价规范化 + word_limit；
- `true_false_notgiven` / `multiple_choice` / `heading_match` → 字面/标签等价，
  matching 类选项可重复使用（FR-R4），逐题独立判定；
- 每题回传 `answer_paragraph` + `answer_quote`（FR-R4 的答案定位）与 `explanation_zh`。
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.listening_grader import grade_set, strip_answers  # noqa: F401（题面剔除逻辑两科共用）

MODULE = "reading"


def grade(
    set_doc: dict[str, Any],
    answers: Any,
    *,
    duration_sec: Optional[float] = None,
    timed_out: bool = False,
) -> dict[str, Any]:
    """阅读 13 题判分。`timed_out=True` 时未答题按 unanswered 记（AC-R3 到点自动提交）。"""
    return grade_set(set_doc, answers, module=MODULE, duration_sec=duration_sec, timed_out=timed_out)
