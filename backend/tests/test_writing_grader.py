"""L2 AI 契约：写作四维批改（spec-contracts.md §3-W、§3-P；§6 writing_grader）。

覆盖 AC：AC-W3（mock 固定返回时字段齐全；少于 4 个维度 → 补 null + ai_used=false +
        incomplete_dimensions，不 500）、FR-W3（corrections/upgraded_sentences≥3/structure_issues/model_answer）、
        AC-W3b（字数未达标给 word_count_penalty 且不额外调 LLM；task_response 上限夹到 5.0）、
        AC-W4（error_type 归入 7 类）、FR-G5/§0（band 0–9、0.5 步长、公共 AI 字段）。
        LLM 全部走 fake_openai 替身。

契约要求的符号（spec §6 给模块名；调用面由 qa 固定）：
    app.services.writing_grader.grade(task, response, *, duration_sec=None) -> dict  # WritingReport
    task 为 §2-W 的任务文档（含 min_words / task / prompt）
"""
from __future__ import annotations

import json
import statistics

import pytest
from _samples import writing_llm_payload, writing_task1, writing_task2

CRITERIA = ("task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")
ERROR_TYPES = {"grammar", "lexical", "collocation", "punctuation", "spelling", "task_response", "cohesion"}

# 含 corrections 引用片段的正文骨架（§3-P 第 2 条要求 quote 必须是考生原文连续片段）
_SPINE = "people is facing a very big problem these days and many observers agree that "


def essay(words: int) -> str:
    """造一篇恰好 words 个词、且包含 _SPINE 引用片段的作文。"""
    text = _SPINE
    while len(text.split()) < words:
        text += "the data shows a clear trend over the period "
    return " ".join(text.split()[:words])


def _grade(grader, task, response, **kwargs):
    fn = getattr(grader, "grade", None)
    assert callable(fn), "RED（等待实现）：app.services.writing_grader 没有 grade()"
    return fn(task, response, **kwargs)


@pytest.fixture
def grader(load_or_wait, fake_openai):
    mod = load_or_wait("app.services.writing_grader")
    return mod, fake_openai


@pytest.fixture
def ok_payload(grader):
    mod, fake = grader
    payload = writing_llm_payload(
        upgraded_sentences=[
            {"from": "people is", "to": "people are increasingly", "why_zh": "主谓一致与正式度"},
            {"from": "very big problem", "to": "pressing challenge", "why_zh": "6.5+ 搭配"},
            {"from": "many observers agree", "to": "a growing body of evidence suggests", "why_zh": "避免空泛主语"},
        ]
    )
    fake.queue(json.dumps(payload))
    return mod, fake


# --------------------------------------------------------------------------
# AC-W3 正常路径
# --------------------------------------------------------------------------
def test_AC_W3固定返回时字段齐全(ok_payload):
    mod, _fake = ok_payload
    text = essay(270)
    report = _grade(mod, writing_task2(), text, duration_sec=2000)

    assert set(CRITERIA) <= set(report["band"]), f"四维缺失：{set(CRITERIA) - set(report['band'])}"
    assert report["band"]["overall"] == _clamp_half(
        statistics.mean(float(report["band"][c]) for c in CRITERIA)
    ), "§3-W：overall = 四维平均后按 0.5 夹紧"
    for field in ("corrections", "upgraded_sentences", "structure_issues", "strengths", "model_answer", "error_summary"):
        assert field in report, f"§3-W 缺字段 {field}"
    assert report["corrections"] and report["upgraded_sentences"] and report["structure_issues"]
    assert len(report["upgraded_sentences"]) >= 3, "FR-W3：≥3 句高档改写"
    assert report["model_answer"], "FR-W3：必须给范文"
    assert report["word_count"] == 270
    assert report["word_count_penalty"] is None


def test_AC_W3每条纠正字段齐全且quote来自原文(ok_payload):
    mod, _fake = ok_payload
    text = essay(270)
    report = _grade(mod, writing_task2(), text, duration_sec=2000)
    for item in report["corrections"]:
        assert {"quote", "error_type", "explanation_zh", "suggestion"} <= set(item), f"§3-W 纠正项字段不全：{item}"
        assert item["quote"] in text, f"§3-P 第 2 条：quote 必须是考生原文连续片段：{item['quote']!r}"
        assert item["error_type"] in ERROR_TYPES, f"AC-W4：error_type 必须归入 7 类，实际 {item['error_type']!r}"


def test_AC_W4_error_summary按类型聚合(grader):
    mod, fake = grader
    payload = writing_llm_payload(
        corrections=[
            {"quote": "people is", "error_type": "grammar", "explanation_zh": "主谓一致", "suggestion": "people are"},
            {"quote": "very big problem", "error_type": "lexical", "explanation_zh": "用词口语化", "suggestion": "serious issue"},
            {"quote": "people is", "error_type": "grammar", "explanation_zh": "又一处主谓一致", "suggestion": "people are"},
        ]
    )
    fake.queue(json.dumps(payload))
    report = _grade(mod, writing_task2(), essay(270))
    assert report["error_summary"].get("grammar") == 2, report["error_summary"]
    assert report["error_summary"].get("lexical") == 1, report["error_summary"]
    assert sum(report["error_summary"].values()) == len(report["corrections"]), "AC-W4：聚合数必须等于纠正条数"


def test_AC_W4未知错误类型被归类或丢弃但不透传(grader):
    mod, fake = grader
    payload = writing_llm_payload(
        corrections=[
            {"quote": "people is", "error_type": "syntax-error", "explanation_zh": "归类测试", "suggestion": "people are"},
            {"quote": "very big problem", "error_type": "grammar", "explanation_zh": "基线", "suggestion": "serious issue"},
        ]
    )
    fake.queue(json.dumps(payload))
    report = _grade(mod, writing_task2(), essay(270))
    types = {c["error_type"] for c in report["corrections"]}
    assert types <= ERROR_TYPES, f"AC-W4：error_type 必须先归入 7 类（映射或丢弃），实际 {types}"


def test_AC_W4越界band夹紧且公共字段齐全(ok_payload):
    mod, _fake = ok_payload
    report = _grade(mod, writing_task1(), essay(200))
    assert report["ai_used"] is True and report["degraded_reason"] is None and report["approximate"] is False
    assert "model" in report, "契约 §0"
    for criterion, value in report["band"].items():
        if value is None:
            continue
        assert 0.0 <= float(value) <= 9.0, f"FR-G5：{criterion}={value} 越界"
        assert (float(value) * 2) % 1 == 0, f"FR-G5：{criterion}={value} 不是 0.5 步长"


# --------------------------------------------------------------------------
# AC-W3 降级路径
# --------------------------------------------------------------------------
def test_AC_W3少于四个维度补null并incomplete_dimensions(grader):
    mod, fake = grader
    payload = writing_llm_payload()
    payload["band"] = {"task_response": 6.0, "coherence_cohesion": 6.5}  # 缺 lexical / GRA
    fake.queue(json.dumps(payload))

    report = _grade(mod, writing_task2(), essay(270))
    band = report["band"]
    assert set(CRITERIA) <= set(band), f"缺失维度要补齐为 null，实际 keys={list(band)}"
    assert band["lexical_resource"] is None and band["grammatical_range_accuracy"] is None
    assert report["ai_used"] is False
    assert report["degraded_reason"] == "incomplete_dimensions", "AC-W3 明确写的是这个原因值"
    assert report["approximate"] is True


def test_AC_W3非法JSON两次后降级不500(grader):
    mod, fake = grader
    fake.queue("对不起我无法评分", "still not json")
    report = _grade(mod, writing_task2(), essay(270))
    assert report["ai_used"] is False
    assert report["degraded_reason"] == "invalid_model_output"
    assert report["approximate"] is True
    assert set(CRITERIA) <= set(report["band"]), "降级报告也要有四维骨架"


def test_AC_W3bTask1少于150词给惩罚且不额外调用LLM(grader):
    mod, fake = grader
    payload = writing_llm_payload()
    payload["band"]["task_response"] = 6.5  # 模型给高了，实现必须按官方规则夹到 5.0
    fake.queue(json.dumps(payload))

    calls_before = len(fake.calls)
    report = _grade(mod, writing_task1(), essay(149), duration_sec=1000)

    assert report["word_count"] == 149
    assert report["word_count_penalty"], "AC-W3b：Task1 <150 词必须有硬性惩罚"
    assert report["word_count_penalty"]["kind"] == "under_length"
    assert report["word_count_penalty"]["missing_words"] == 1
    assert float(report["band"]["task_response"]) <= 5.0, (
        f"§3-W：未达字数时 task_response 上限夹到 5.0，实际 {report['band']['task_response']}"
    )
    assert len(fake.calls) == calls_before + 1, "AC-W3b：惩罚是本地规则，不许为它额外调用 LLM"


def test_AC_W3bTask1正好150词无惩罚(grader):
    mod, fake = grader
    fake.queue(json.dumps(writing_llm_payload()))
    report = _grade(mod, writing_task1(), essay(150))
    assert report["word_count"] == 150
    assert not report["word_count_penalty"], "AC-W3b：达线不该给惩罚"


def test_AC_W3bTask2少于250词给惩罚(grader):
    mod, fake = grader
    fake.queue(json.dumps(writing_llm_payload()))
    report = _grade(mod, writing_task2(), essay(240))
    assert report["word_count_penalty"]["missing_words"] == 10
    assert float(report["band"]["task_response"]) <= 5.0


def test_3P_quote不在原文的纠正被丢弃(grader):
    mod, fake = grader
    payload = writing_llm_payload(
        corrections=[
            {"quote": "people is", "error_type": "grammar", "explanation_zh": "合法引用", "suggestion": "people are"},
            {"quote": "彻底不存在的一句话", "error_type": "lexical", "explanation_zh": "幻觉", "suggestion": "x"},
        ]
    )
    fake.queue(json.dumps(payload))
    text = essay(270)
    report = _grade(mod, writing_task2(), text)
    kept = [c["quote"] for c in report["corrections"]]
    assert "彻底不存在的一句话" not in kept, f"§3-P 第 2 条：非法 quote 必须丢弃，实际 {kept}"
    assert report.get("invalid_quotes"), "§3-P 要求计数 invalid_quotes（契约 §3-W 未列该字段，见 qa 报告）"


# --------------------------------------------------------------------------
# 辅助
# --------------------------------------------------------------------------
def _clamp_half(value: float) -> float:
    clamped = max(0.0, min(9.0, float(value)))
    return int(clamped * 2) / 2.0
