"""写作 prompt 模板（spec-contracts.md §3-P + §3-W + FR-W3/W3b/W4/W5）。

四维 = Task Achievement/Response、Coherence and Cohesion、Lexical Resource、Grammatical Range and Accuracy。
只表述能力要求，不搬运官方 Band Descriptors 原文（CONSTITUTION §2）。
"""
from __future__ import annotations

from typing import Any, Optional

CRITERIA = ("task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")

# AC-W4 / FR-W4：error_type 必须归入这 7 类（契约 §10.2 用常量表达，不做跨科枚举收敛）
WRITING_ERROR_TYPES = ("grammar", "lexical", "collocation", "punctuation", "spelling", "task_response", "cohesion")

SEVERITIES = ("high", "medium", "low")

SYSTEM_PROMPT = (
    "你是一位雅思写作考官，按官方四项标准给分："
    "Task Achievement / Task Response（任务完成度）、Coherence and Cohesion（连贯与衔接）、"
    "Lexical Resource（词汇资源）、Grammatical Range and Accuracy（语法范围与准确性）。"
    "只输出 JSON，不要输出任何解释文字、不要 markdown 之外的说明。"
)

BAND_RULES = (
    "评分规则：\n"
    "- 四个维度各给一个 band，band 范围 0–9，步长 0.5（例如 5.0、5.5、6.0），不允许其它小数；\n"
    "- Task Achievement/Response 看是否完整回应题目所有指令、立场是否清楚、例子是否支撑论点；\n"
    "- Coherence and Cohesion 看段落是否有单一中心、衔接是否自然（机械堆砌 first and then 会扣分）；\n"
    "- Lexical Resource 看用词精准度、搭配与不常见词，是否重复同一个词；\n"
    "- Grammatical Range and Accuracy 看句式多样度与错误密度；\n"
    "- 越界（如 0 以下或 9 以上）或非 0.5 步长的输出会被后端判为非法模型输出并降级为本地近似分。"
)

CORRECTION_RULES = (
    "批改规则：\n"
    "- corrections[] 每条的 quote 必须是【考生原文】里的连续片段，逐字照抄，不得改写、不得拼接不同句子；\n"
    "- quote 找不到原文依据就不要给这条纠正；后端会校验 quote in response，不符的条目会被丢弃；\n"
    "- error_type 只能取这 7 个值之一：grammar / lexical / collocation / punctuation / spelling / "
    "task_response / cohesion；其它值会被后端归类或丢弃；\n"
    "- explanation_zh 用简体中文解释错在哪（不要英文术语堆砌），suggestion 给可直接替换的写法，"
    "severity 取 high / medium / low；\n"
    "- upgraded_sentences[] 至少 3 条，from 是考生原句片段（必须出现在原文中），to 是高半档到一档的改写，"
    "why_zh 用中文说明升级点；\n"
    "- structure_issues[] 是段落层面的问题：kind 取 paragraph_function / cohesion / position / development，"
    "issue_zh 用中文说明，paragraph_index 从 1 开始；\n"
    "- model_answer 是完整范文：Task 1 不少于 150 词，Task 2 不少于 260 词，英文；\n"
    "- 所有中文解释字段以 _zh 结尾（explanation_zh / issue_zh / why_zh），英文引用保持考生原文。"
)

SCHEMA = """{
  "band": {
    "task_response": 6.0,
    "coherence_cohesion": 6.5,
    "lexical_resource": 6.0,
    "grammatical_range_accuracy": 5.5
  },
  "corrections": [
    {
      "quote": "考生原文中的连续片段",
      "error_type": "grammar",
      "explanation_zh": "中文说明错误原因",
      "suggestion": "替换后的正确写法",
      "severity": "high"
    }
  ],
  "upgraded_sentences": [
    {"from": "考生原句片段", "to": "更高分的写法", "why_zh": "中文说明改写收益"}
  ],
  "structure_issues": [
    {"kind": "paragraph_function", "issue_zh": "中文说明段落层面的问题", "paragraph_index": 3}
  ],
  "strengths": ["中文说明优点"],
  "model_answer": "A full model answer in English."
}"""

USER_TEMPLATE = (
    "【任务类型】{task_label}\n"
    "【题目】\n{prompt_text}\n"
    "{chart_line}"
    "{outline_line}"
    "【字数硬要求】最低 {min_words} 词；本次实际 {word_count} 词。{penalty_line}\n"
    "【考生作文（唯一评分依据）】\n{response}\n"
    "【用时】{duration_line}\n"
    "【本地已算出的统计（供参考，不要重复输出）】\n{stats_line}\n"
    "请严格按下面 schema 输出 JSON，只输出 JSON：\n"
    "{schema}\n"
)

PENALTY_NOTE = (
    " 注意：字数未达标时 Task Achievement/Response 不得高于 5.0"
    "（后端会按官方规则把它夹到 5.0，这是本地规则，不会因此再调用一次模型）。"
)


def build_prompt(
    task: dict[str, Any],
    response: str,
    *,
    word_count: Optional[int] = None,
    penalty: Optional[dict[str, Any]] = None,
    duration_sec: Optional[float] = None,
    stats: Optional[dict[str, Any]] = None,
) -> str:
    """组装 user 消息；考生原文必须逐字出现（§3-P 第 2 条）。"""
    task = task or {}
    min_words = int(task.get("min_words") or (150 if task.get("task") == "task1" else 250))
    count = word_count if isinstance(word_count, int) else len((response or "").split())
    task1 = task.get("task") == "task1"
    task_label = "Task 1（图表描述，Academic）" if task1 else "Task 2（议论/报告文）"

    chart_line = ""
    chart = task.get("chart")
    if isinstance(chart, dict):
        inner = chart.get("data") if isinstance(chart.get("data"), dict) else chart
        unit = inner.get("unit") or ""
        kinds = [s.get("name") for s in (inner.get("series") or []) if isinstance(s, dict)]
        x_labels = inner.get("labels") or inner.get("years") or []
        chart_line = (
            "【图表数据（只能据此报告趋势，不得臆造数字）】\n"
            f"type={inner.get('type')}, unit={unit or '未标注'}, "
            f"series={kinds}, x_axis={x_labels}\n"
        )

    outline = task.get("outline_hint")
    outline_line = f"【提纲提示】{outline}\n" if outline else ""
    penalty_line = PENALTY_NOTE if penalty else ""
    duration_line = (
        f"{round(float(duration_sec), 1)} 秒（建议 {task.get('time_recommend_sec')} 秒）"
        if isinstance(duration_sec, (int, float))
        else "未提供"
    )
    if stats:
        stats_line = (
            f"paragraph_count={stats.get('paragraph_count')}, "
            f"avg_sentence_length={stats.get('avg_sentence_length')}, "
            f"connectives={stats.get('connectives') or []}, "
            f"repeated_words={stats.get('repeated_words') or []}"
        )
    else:
        stats_line = "无"

    return USER_TEMPLATE.format(
        task_label=task_label,
        prompt_text=(task.get("prompt") or "").strip() or "（无题干）",
        chart_line=chart_line,
        outline_line=outline_line,
        min_words=min_words,
        word_count=count,
        penalty_line=penalty_line,
        response=(response or "").strip() or "（考生没有写作文）",
        duration_line=duration_line,
        stats_line=stats_line,
        schema=SCHEMA,
    )
