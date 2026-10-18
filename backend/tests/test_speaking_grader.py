"""L2 AI 契约：口语四维评分（spec-contracts.md §3-S、§3-P；§6 speaking_grader）。

覆盖 AC：AC-S4（四维齐全 + overall=平均后夹紧；越界值夹紧到 0–9 且 ai_used=false+invalid_model_output；
        非 JSON 降级不 500）、FR-S4（无音频时发音维度标低置信）、FR-S5（≥3 improvements + model_answer +
        upgrade_vocabulary）、§3-P 第 2 条（quote 必须是考生原文连续片段，否则丢弃并计 invalid_quotes）。
        LLM 全部走 fake_openai 替身，不产生任何真实请求。

契约要求的符号（spec §6 给模块名；调用面由 qa 固定，改名请先改 spec-contracts.md）：
    app.services.speaking_grader.grade(prompt, transcript, duration_sec,
                                       *, segments=None, audio_bytes=None) -> dict  # SpeakingReport
"""
from __future__ import annotations

import statistics

import pytest
from _samples import speaking_llm_payload, speaking_set

CRITERIA = ("fluency_coherence", "lexical_resource", "grammatical_range_accuracy", "pronunciation")
TRANSCRIPT = (
    "I would like to learn photography because it is a good skill. "
    "I think a lot of good things come from taking photos every day."
)
CUE_CARD = "Describe a skill you would like to learn."


def _grade(grader, prompt=CUE_CARD, transcript=TRANSCRIPT, duration_sec=90.0, **kwargs):
    fn = getattr(grader, "grade", None)
    assert callable(fn), "RED（等待实现）：app.services.speaking_grader 没有 grade()"
    return fn(prompt, transcript, duration_sec, **kwargs)


@pytest.fixture
def grader(load_or_wait, fake_openai):
    mod = load_or_wait("app.services.speaking_grader")
    return mod, fake_openai


@pytest.fixture
def ok_payload(grader):
    mod, fake = grader
    import json

    fake.queue(json.dumps(speaking_llm_payload()))
    return mod, fake


# --------------------------------------------------------------------------
# AC-S4 正常路径
# --------------------------------------------------------------------------
def test_AC_S4四维齐全且overall等于平均后夹紧(ok_payload):
    mod, _fake = ok_payload
    report = _grade(mod)

    band = report["band"]
    assert set(CRITERIA) <= set(band), f"四维缺失：{set(CRITERIA) - set(band)}"
    values = [float(band[c]) for c in CRITERIA]
    expected = _clamp_half(statistics.mean(values))
    assert band["overall"] == expected, f"FR-S4：四维平均后按 0.5 夹紧，期望 {expected}，实际 {band['overall']}"
    assert all(0.0 <= v <= 9.0 for v in values)


def test_AC_S4每条evidence都含考生原文quote(ok_payload):
    mod, _fake = ok_payload
    report = _grade(mod)
    assert report["evidence"], "AC-S4：证据引用不能为空"
    for item in report["evidence"]:
        assert "quote" in item and item["quote"], f"evidence 缺 quote：{item}"
        assert item["quote"] in TRANSCRIPT, f"§3-P 第 2 条：quote 必须是考生原文连续片段，实际 {item['quote']!r}"


def test_FR_S5反馈内容三项齐全(ok_payload):
    mod, _fake = ok_payload
    report = _grade(mod)
    assert len(report["improvements"]) >= 3, f"FR-S5：至少 3 条 improvements，实际 {len(report['improvements'])}"
    for item in report["improvements"]:
        assert {"issue", "fix", "quote"} <= set(item), f"改进项要「问题→改法＋原句」：{item}"
    assert report["model_answer"] and len(report["model_answer"].split()) <= 150 + 20, (
        "FR-S5：示范回答 150 词内"
    )
    assert isinstance(report["upgrade_vocabulary"], list) and report["upgrade_vocabulary"], "FR-S5：替换词表必须有内容"
    for pair in report["upgrade_vocabulary"]:
        assert {"from", "to"} <= set(pair), f"upgrade_vocabulary 项要含 from/to：{pair}"
        assert pair.get("note_zh") or pair.get("source"), "FR-S5：来源须标注（source 或中文说明）"


def test_AC_S4公共AI字段齐全(ok_payload):
    mod, fake = ok_payload
    report = _grade(mod)
    assert report["ai_used"] is True
    assert report["degraded_reason"] is None
    assert report["approximate"] is False
    assert "model" in report, "契约 §0：含评分的响应必须有 model"
    assert report["metrics"]["word_count"] == len(TRANSCRIPT.split())


def test_FR_S4无音频时发音维度标低置信(ok_payload):
    mod, _fake = ok_payload
    report = _grade(mod)
    assert report["band"]["pronunciation_confidence"] in ("high", "low")
    assert report["band"]["pronunciation_confidence"] == "low", (
        "FR-S4：本次调用没有传入音频（文本兜底 AC-S3b），发音维度必须标低置信"
    )


def test_AC_S4请求发给LLM的prompt包含考生原文(ok_payload):
    mod, fake = ok_payload
    _grade(mod)
    sent = str(fake.last_call)
    assert TRANSCRIPT in sent or TRANSCRIPT.split(" because ")[0] in sent, (
        "LLM 请求里必须带上考生原话，否则无法产出 §3-P 要求的 quote 校验"
    )


# --------------------------------------------------------------------------
# AC-S4 降级路径（不许 500）
# --------------------------------------------------------------------------
def test_AC_S4越界band夹紧到09并标记invalid_model_output(grader):
    mod, fake = grader
    import json

    payload = speaking_llm_payload()
    payload["band"]["pronunciation"] = 12
    payload["band"]["lexical_resource"] = -3
    fake.queue(json.dumps(payload))

    report = _grade(mod)
    band = report["band"]
    assert band["pronunciation"] == 9.0 and band["lexical_resource"] == 0.0, (
        f"越界值必须夹紧（AC-S4），实际 {band}"
    )
    assert report["ai_used"] is False, "AC-S4：越界输出属于模型输出非法，必须标记 ai_used=false"
    assert report["degraded_reason"] == "invalid_model_output"
    assert report["approximate"] is True
    assert 0.0 <= float(band["overall"]) <= 9.0


def test_AC_S4缺维度时补null且不崩溃(grader):
    """FR-S4 要求四维齐全；AC-W3 给了同类规则（incomplete_dimensions）。"""
    mod, fake = grader
    import json

    payload = speaking_llm_payload()
    payload["band"] = {"fluency_coherence": 6.0, "lexical_resource": 6.5}  # 缺 GRA 与 pronunciation
    fake.queue(json.dumps(payload))

    report = _grade(mod)
    band = report["band"]
    assert set(CRITERIA) <= set(band), f"缺失维度必须补齐为 null，实际 keys={list(band)}"
    assert band["grammatical_range_accuracy"] is None and band["pronunciation"] is None
    assert report["ai_used"] is False
    assert report["degraded_reason"] in ("incomplete_dimensions", "invalid_model_output"), (
        f"降级原因应能解释缺维度（AC-W3 用的是 incomplete_dimensions），实际 {report['degraded_reason']!r}"
    )


@pytest.mark.parametrize("bad", ["这不是 JSON", "", "   ", '{"band":'])
def test_AC_S4非JSON响应走降级不500(grader, bad):
    mod, fake = grader
    fake.queue(bad, bad)  # §3-P 第 5 条：重试 1 次
    report = _grade(mod)
    assert report["ai_used"] is False
    assert report["degraded_reason"] == "invalid_model_output"
    assert report["approximate"] is True
    assert set(CRITERIA) <= set(report["band"]), "降级报告也要有四维骨架（前端不能因缺字段崩）"


def test_AC_S4上游失败时仍返回离线近似报告(grader):
    """CONSTITUTION §3：AI 失败不许静默伪装成功；AC-G3：断网也能拿到标注过的分数。"""
    mod, fake = grader
    import httpx
    import openai

    request = httpx.Request("POST", "https://api.example.test/v1/chat/completions")
    fake.queue(openai.APIStatusError("upstream 503", response=httpx.Response(503, request=request), body=None))

    report = _grade(mod)
    assert report["ai_used"] is False
    assert report["approximate"] is True
    assert report["degraded_reason"] in ("network_error", "timeout", "no_api_key"), (
        f"上游失败必须给出可读降级原因，实际 {report['degraded_reason']!r}"
    )


def test_3P_quote不在原文则丢弃并计数(grader):
    mod, fake = grader
    import json

    payload = speaking_llm_payload(
        evidence=[
            {"criterion": "lexical_resource", "quote": "a lot of good things", "why": "用词空泛", "level": "6.0"},
            {"criterion": "grammar", "quote": "完全不是考生说过的话", "why": "幻觉引用", "level": "5.5"},
        ]
    )
    payload["improvements"] = [
        {"issue": "a", "fix": "b", "quote": "a lot of good things"},
        {"issue": "c", "fix": "d", "quote": "考生没说过"},
        {"issue": "e", "fix": "f", "quote": "taking photos every day"},
    ]
    fake.queue(json.dumps(payload))

    report = _grade(mod)
    kept = [e["quote"] for e in report["evidence"]]
    assert "完全不是考生说过的话" not in kept, f"§3-P 第 2 条：非法 quote 必须丢弃，实际 {kept}"
    assert all(q in TRANSCRIPT for q in kept), f"留下的 quote 必须都是原文连续片段：{kept}"
    assert report.get("invalid_quotes"), (
        "§3-P 第 2 条要求把丢弃条数记为 invalid_quotes（契约 §3-S 未列该字段 —— spec 缺口，见 qa 交付报告）"
    )
    assert len(report["improvements"]) >= 3, "FR-S5：丢弃非法 quote 后仍需 ≥3 条改进项（用合法 quote 或省略 quote）"
    for item in report["improvements"]:
        assert not item.get("quote") or item["quote"] in TRANSCRIPT, f"improvements.quote 也要校验：{item}"


def _clamp_half(value: float) -> float:
    """0.5 步长夹紧：向下取到最近 0.5（契约 §3-B 的"取较低档"口径）。"""
    clamped = max(0.0, min(9.0, float(value)))
    return int(clamped * 2) / 2.0
