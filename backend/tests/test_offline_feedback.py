"""L1 纯函数：无 AI 时的本地近似反馈（spec-contracts.md §6 offline_feedback）。

覆盖 AC：AC-G3（断网也能做完一次并存的分数标注为离线近似）、FR-W5（写作本地统计 + approximate=true）、
        AC-S6 / FR-S5（口语离线模板仍能走完并给出报告骨架）、CONSTITUTION §3（降级必须可见：
        ai_used=false + degraded_reason + approximate）。

契约要求的符号（spec §6 给模块名，函数名由 qa 固定）：
    app.services.offline_feedback.analyze_text(text) -> dict
    app.services.offline_feedback.writing_report(task, response, *, duration_sec=None) -> dict
    app.services.offline_feedback.speaking_report(prompt, transcript, duration_sec, *, metrics=None) -> dict
"""
from __future__ import annotations

import pytest
from _samples import writing_task1, writing_task2

ANALYSIS_KEYS = {
    "word_count",
    "paragraph_count",
    "sentence_lengths",
    "avg_sentence_length",
    "connectives",
    "missing_articles",
    "repeated_words",
}


@pytest.fixture(scope="module")
def offline(load_or_wait):
    return load_or_wait("app.services.offline_feedback")


THREE_PARAGRAPHS = (
    "Remote work removes commuting. However, it also blurs the boundary between office and home. "
    "Many people find it hard to stop working in the evening.\n\n"
    "Some managers worry about supervision. They believe that visible staff are productive staff. "
    "As a result, they introduce strict monitoring tools.\n\n"
    "In my view, remote work is beneficial. Remote work is beneficial for families. "
    "Remote work is beneficial for the environment. Remote work is beneficial."
)


# --------------------------------------------------------------------------
# analyze_text —— FR-W5 列出的每一项本地统计
# --------------------------------------------------------------------------
def test_FR_W5本地统计字段齐全(offline):
    result = offline.analyze_text(THREE_PARAGRAPHS)
    assert ANALYSIS_KEYS <= set(result), f"缺字段：{ANALYSIS_KEYS - set(result)}"


def test_FR_W5字数与段落数(offline):
    result = offline.analyze_text(THREE_PARAGRAPHS)
    assert result["word_count"] == len(THREE_PARAGRAPHS.split())
    assert result["paragraph_count"] == 3


def test_FR_W5句长分布(offline):
    result = offline.analyze_text("I like tea. This is a much longer sentence that keeps going and going. Me too.")
    assert len(result["sentence_lengths"]) == 3, f"句数应为 3：{result['sentence_lengths']}"
    assert all(isinstance(n, int) and n > 0 for n in result["sentence_lengths"])
    assert result["avg_sentence_length"] == pytest.approx(sum(result["sentence_lengths"]) / 3, abs=0.6)


def test_FR_W5连接词清单命中(offline):
    result = offline.analyze_text(THREE_PARAGRAPHS)
    hits = {str(c).lower() for c in result["connectives"]}
    assert "however" in hits, f"However 应命中连接词清单：{hits}"
    assert any("as a result" in h for h in hits), f"as a result 应命中：{hits}"


def test_FR_W5重复词top10(offline):
    text = "beneficial " * 12 + "commuting " * 3 + "This proposal is beneficial for families and the environment."
    result = offline.analyze_text(text)
    repeats = result["repeated_words"]
    assert len(repeats) <= 10, "重复词只取 top10"
    top = repeats[0]
    word, count = (top[0], top[1]) if not isinstance(top, dict) else (top["word"], top["count"])
    assert word.lower() == "beneficial", f"最高频实词应是 beneficial：{repeats}"
    assert count >= 10, f"出现 13 次却只统计到 {count}"


def test_FR_W5冠词缺失启发式(offline):
    result = offline.analyze_text("I went to store and bought apple then I took bus.")
    assert result["missing_articles"], "FR-W5 要求检测 the/a 缺失"


def test_FR_W5空文本不炸(offline):
    result = offline.analyze_text("")
    assert result["word_count"] == 0
    assert result["paragraph_count"] in (0, 1)
    assert result["repeated_words"] == []


# --------------------------------------------------------------------------
# writing_report —— 离线近似必须"可见降级"
# --------------------------------------------------------------------------
@pytest.mark.parametrize("task_builder", [writing_task1, writing_task2])
def test_AC_G3离线写作报告结构完整且标记近似(offline, task_builder):
    task = task_builder()
    report = offline.writing_report(task, THREE_PARAGRAPHS, duration_sec=900)

    assert report["ai_used"] is False
    assert report["approximate"] is True, "FR-W5：主分数必须标记 approximate=true"
    assert report["degraded_reason"] == "offline_template", "CONSTITUTION §3：降级原因必须写出来"
    band = report["band"]
    assert set(band) >= {"overall", "task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy"}
    assert band["overall"] is None or (0.0 <= float(band["overall"]) <= 9.0 and (float(band["overall"]) * 2) % 1 == 0), (
        f"FR-G5：近似分也必须落在 0–9 / 0.5 步长，实际 {band['overall']}"
    )
    assert report["word_count"] == len(THREE_PARAGRAPHS.split())
    assert isinstance(report.get("corrections"), list)
    assert isinstance(report.get("error_summary"), dict)


def test_AC_W3b离线也遵守字数惩罚(offline):
    short = "Remote work is convenient. It saves time."
    report = offline.writing_report(writing_task2(), short, duration_sec=120)
    assert report["word_count_penalty"], "FR-W3b：Task2 未达 250 词必须有硬性惩罚（离线也一样，且不需要 LLM）"
    assert report["word_count_penalty"]["kind"] == "under_length"
    assert report["word_count_penalty"]["missing_words"] > 0


# --------------------------------------------------------------------------
# speaking_report —— AC-S6：ai_used=false 时流程仍能走完
# --------------------------------------------------------------------------
def test_AC_S6离线口语报告骨架(offline):
    transcript = (
        "I would like to learn photo photography because you know it is a good skill "
        "and I I think it helps me remember things. um maybe I will learn it next year."
    )
    report = offline.speaking_report("Describe a skill you would like to learn.", transcript, 90.0)

    assert report["ai_used"] is False
    assert report["approximate"] is True
    assert report["degraded_reason"] == "offline_template"
    band = report["band"]
    assert set(band) >= {
        "overall",
        "fluency_coherence",
        "lexical_resource",
        "grammatical_range_accuracy",
        "pronunciation",
    }, f"§3-S：四维 + overall 必须齐全，实际 {band}"
    assert band["pronunciation_confidence"] == "low", "无音频时发音维度必须标为低置信（FR-S4）"
    assert len(report["improvements"]) >= 3, "FR-S5：至少 3 条改进项"
    for item in report["improvements"]:
        assert {"issue", "fix", "quote"} <= set(item), f"改进项字段不全：{item}"
    assert report["model_answer"], "FR-S5：离线也要给示范回答（模板级即可）"
    assert isinstance(report["upgrade_vocabulary"], list)
    assert report["metrics"]["word_count"] > 0
