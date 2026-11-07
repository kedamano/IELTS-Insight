"""口语 prompt 模板（spec-contracts.md §3-P + §3-S + FR-S4/S5/S6）。

四维 = Fluency and Coherence / Lexical Resource / Grammatical Range and Accuracy / Pronunciation。
这里只表述各维度的能力要求，不逐字引用官方 Band Descriptors（CONSTITUTION §2）。
"""
from __future__ import annotations

from typing import Any, Optional, Sequence

CRITERIA = ("fluency_coherence", "lexical_resource", "grammatical_range_accuracy", "pronunciation")

SYSTEM_PROMPT = (
    "你是一位经验丰富的雅思口语考官，按官方四项标准给分："
    "Fluency and Coherence（流利与连贯）、Lexical Resource（词汇资源）、"
    "Grammatical Range and Accuracy（语法范围与准确性）、Pronunciation（发音）。"
    "只输出 JSON，不要输出任何解释文字或多余的说明。"
)

#: 1 对 1 陪练整场评分时追加到 BAND_RULES 之后的口径（契约 §16.4）。
#: 不加这一段，模型会把自由对话当成「背题库」来扣分：它会因为你没覆盖题卡的三个提示点
#: 而压低 FC，而陪练里根本没有题卡。这条与 `build_prompt` 的 `part_label_of("sparring")`
#: 成对存在 —— 只改一处会出现「标签说自由对话、规则说按题卡评」的自相矛盾。
SPARRING_SCORING_RULES = (
    "陪练评分补充规则（本次是自由对话，不是题库背诵）：\n"
    "- 考生回答的是陪练官**上一轮的追问**，不是预先给定的题卡；不要因为「没覆盖三个提示点」而扣分；\n"
    "- Fluency and Coherence 看**接话**能力：是否听懂追问、是否直接回应、有没有把话题推进下去；\n"
    "- 多处只答一两个词就停（没展开）算 FC 与 LR 的失分点；答非所问同样算 FC 失分；\n"
    "- 同一场里反复出现同一套句式/同一个连接词，算 GRA 与 LR 的失分点；\n"
    "- model_answer 要写成对**最后一个追问**的示范回应，而不是对题卡的独白。"
)


BAND_RULES = (
    "评分规则：\n"
    "- 四个维度各给一个 band，band 范围 0–9，步长 0.5（例如 5.0、5.5、6.0），不允许其它小数；\n"
    "- Fluency and Coherence 看说话是否连贯、展开是否充分、停顿与填充词是否影响交流；\n"
    "- Lexical Resource 看用词是否准确、是否有搭配与话题词，是否反复使用空泛词；\n"
    "- Grammatical Range and Accuracy 看句式是否有变化、错误是否影响理解；\n"
    "- Pronunciation 在没有音频时只能按转写文本推测，此时 pronunciation_confidence 必须是 \"low\"；\n"
    "- 分数要贴合考生实际水平，不要普遍给高，也不要给 0–9 之外的数（越界输出会被后端判为非法并降级为本地近似）。"
)

EVIDENCE_RULES = (
    "证据规则：\n"
    "- evidence[] 每条的 quote 必须是【考生转写原文】里的连续片段，逐字照抄，不得改写、不得跨句拼接；\n"
    "- improvements[] 的 quote 同样必须是考生原文连续片段；没有原文依据就不要给该条；\n"
    "- improvements[] 至少 3 条，每条是「问题 → 改法」，用中文写 issue 与 fix，quote 保持英文原文；\n"
    "- upgrade_vocabulary[] 把考生用过的平庸词替换为 6.5+/7.5+ 的搭配，from 必须是考生用过的词，"
    "to 是升级写法，note_zh 用中文说明适用语境与来源（本词库/搭配习惯）；\n"
    "- model_answer 是一段比考生高约一档的示范回答，150 词以内，英文；\n"
    "- 中文说明字段一律用 *_zh 命名或写成中文文本，英文引用保持考生原话。"
)

SCHEMA = """{
  "band": {
    "fluency_coherence": 6.5,
    "lexical_resource": 6.0,
    "grammatical_range_accuracy": 6.0,
    "pronunciation": 6.5,
    "pronunciation_confidence": "high"
  },
  "evidence": [
    {
      "criterion": "lexical_resource",
      "quote": "考生原文中的连续片段",
      "why": "中文说明这条证据反映了什么问题",
      "level": "6.0"
    }
  ],
  "strengths": ["中文说明考生做得好的地方"],
  "improvements": [
    {"issue": "中文问题描述", "fix": "中文改法建议", "quote": "考生原文中的连续片段"}
  ],
  "model_answer": "An answer about one band higher than the candidate, under 150 words.",
  "upgrade_vocabulary": [
    {"from": "good", "to": "rewarding", "note_zh": "6.5+ 搭配，用于描述学习经历"}
  ]
}"""

USER_TEMPLATE = (
    "【考试部分】{part_label}\n"
    "【考官提问 / 题卡】{prompt_text}\n"
    "【考生回答转写（唯一评分依据，band 与所有 quote 都只能基于这段文字）】\n"
    "{transcript}\n"
    "【转写时长】{duration_line}\n"
    "【目标分数】{target_line}\n"
    "【本地已算出的指标（供参考，不要重复输出这些数字）】\n"
    "{metrics_line}\n"
    "【音频】{audio_line}\n"
    "请严格按下面 schema 输出 JSON，只输出 JSON：\n"
    "{schema}\n"
)

FOLLOWUP_SYSTEM_PROMPT = (
    "你是一位雅思口语考官，正在就考生 Part 2 的回答做 Part 3 追问（抽象化、比较化、因果化，"
    "而不是重复题卡）。只输出 JSON。"
)

FOLLOWUP_SCHEMA = """{
  "questions": [
    "Why do some people ... ?",
    "Do you think ... ?",
    "How might ... ?"
  ]
}"""

FOLLOWUP_TEMPLATE = (
    "【题卡】{cue_card}\n"
    "【考生 Part 2 回答转写】\n{transcript}\n"
    "请生成 {count} 个 Part 3 追问：每个是一句英文问题，围绕同一话题但上升到社会/因果/比较层面；"
    "避免与题卡或彼此重复。\n"
    "严格按此 schema 输出 JSON，只输出 JSON：\n{schema}\n"
)


SPARRING_PART_LABEL = "Part 1–3 自由对话（1 对 1 陪练）"


def part_label_of(part: Optional[Any]) -> str:
    """Part 标签：题库练习给 `Part N`；陪练模式（`part="sparring"`）给自由对话标签（契约 §16.4）。"""
    if part in (None, ""):
        return "Part 2（独白）"
    if str(part).strip().lower() == "sparring":
        return SPARRING_PART_LABEL
    return f"Part {part}"


def build_prompt(
    prompt_text: str,
    transcript: str,
    duration_sec: Optional[float] = None,
    *,
    part: Optional[Any] = None,
    target_band: Optional[float] = None,
    metrics: Optional[dict[str, Any]] = None,
    has_audio: bool = False,
) -> str:
    """组装 user 消息。考生原文必须逐字出现在 prompt 里（§3-P 第 2 条的校验前提）。"""
    part_label = part_label_of(part)
    duration_line = (
        f"{round(float(duration_sec), 1)} 秒" if isinstance(duration_sec, (int, float)) else "未提供"
    )
    target_line = f"target_band {target_band}" if target_band else "未设定"
    if metrics:
        metrics_line = (
            f"word_count={metrics.get('word_count')}, wpm={metrics.get('wpm')}, "
            f"pause_total_sec={metrics.get('pause_total_sec')}, "
            f"fillers={metrics.get('fillers') or []}, repeats={metrics.get('repeats')}"
        )
    else:
        metrics_line = "无"
    audio_line = (
        "本次调用带有录音音频，pronunciation_confidence 可给 \"high\"。"
        if has_audio
        else "本次调用没有音频，只有转写文本，pronunciation_confidence 必须给 \"low\"。"
    )
    return USER_TEMPLATE.format(
        part_label=part_label,
        prompt_text=(prompt_text or "").strip() or "（无题面文本）",
        transcript=(transcript or "").strip() or "（考生没有留下可转写的回答）",
        duration_line=duration_line,
        target_line=target_line,
        metrics_line=metrics_line,
        audio_line=audio_line,
        schema=SCHEMA,
    )


def build_followup_prompt(cue_card: str, transcript: str, count: int = 3) -> str:
    return FOLLOWUP_TEMPLATE.format(
        cue_card=(cue_card or "").strip() or "（无题卡）",
        transcript=(transcript or "").strip() or "（无回答文本）",
        count=count,
        schema=FOLLOWUP_SCHEMA,
    )


# --------------------------------------------------------------------------
# 1 对 1 陪练：每轮追问（契约 §16.3 第 2 条）
# --------------------------------------------------------------------------

SPARRING_SYSTEM_PROMPT = (
    "你是一位雅思口语陪练官，正在与考生进行一对一自由对话。"
    "你只输出 JSON，不要输出任何解释文字。你的唯一任务是：听清考生刚说的那句英文，"
    "顺着他的内容追问一句，让他继续说下去。"
)

SPARRING_RULES = (
    "追问规则：\n"
    "- 只输出 {\"reply\": \"...\"}，reply 必须是**一句**英文问句（偶尔可以是简短回应 + 问句）；\n"
    "- 必须扣住考生最后一句里的具体信息（他提到的地点、原因、人物、数字、感受），不得照抄你自己的上一个问题；\n"
    "- 风格像真实考官：礼貌、简洁，40 词以内，不用 markdown、不用 emoji、不用中文；\n"
    "- 追问难度贴近该话题的 level：a2 用简单句与常见词，b1 可加原因/对比，b2 可用抽象或假设句式；\n"
    "- 话题跑偏时先用一句承接，再拉回当前场景，不要突然换题；\n"
    "- 不要重复考生的话，不要给出评价或分数（评分在整场结束后统一做）。"
)

SPARRING_SCHEMA = """{
  "reply": "One English follow-up question, under 40 words."
}"""

SPARRING_TEMPLATE = (
    "【场景】{scenario}\n"
    "【话题】{topic_title}\n"
    "【难度档】{level}\n"
    "【对话最近几轮（最后一条是考生刚说的话）】\n"
    "{history}\n"
    "【考生最后一句（必须针对它追问）】\n"
    "{last_user}\n"
    "【已经问过的问题（不要重复）】\n"
    "{asked}\n"
    "请严格按下面 schema 输出 JSON，只输出 JSON：\n"
    "{schema}\n"
)


def build_sparring_reply_prompt(
    *,
    scenario: str,
    topic_title: str,
    level: str,
    history: Sequence[tuple[str, str]],
    last_user: str,
    asked: Sequence[str] = (),
    max_history: int = 3,
) -> str:
    """组装陪练官追问的 user 消息。

    `history` 传 `(role, text)`；只保留最近 `max_history` 轮（更长的上下文既贵又会把模型
    引回很早以前说过的话）。`history` 的渲染与 `last_user` 分开是有意的：
    最后一轮必须被**显式强调**，否则模型很容易回一句跟上下文无关的通用问题。
    """
    recent = list(history)[-max_history:]
    labels = {"partner": "陪练官", "user": "考生"}
    history_line = (
        "\n".join(f"{labels.get(role, role)}：{text}" for role, text in recent) or "（对话尚未开始）"
    )
    asked_line = "\n".join(f"- {q}" for q in asked if str(q).strip()) or "（还没有问过任何问题）"
    return SPARRING_TEMPLATE.format(
        scenario=(scenario or "").strip() or "（未提供场景）",
        topic_title=(topic_title or "").strip() or "（未提供话题）",
        level=(level or "b1").strip(),
        history=history_line,
        last_user=(last_user or "").strip() or "（考生这句没听清）",
        asked=asked_line,
        schema=SPARRING_SCHEMA,
    )
