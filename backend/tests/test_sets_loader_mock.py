"""题库装载器 `sets_loader` 的结构校验（契约 §2-L / §10.1）。

覆盖：
- `kind=mock_test` 被 `validate_record` 接受（装载侧与校验脚本同一套规则）；
- mock_test 的 40 题 / `sections_covered=[1,2,3,4]` / 1100–1400 词 / 60–90 句；
- practice 的原有口径不变（20 题 / 550–700 词 / 25–45 句）；
- 不合格 mock_test 被拒（装载器跳过它并记进 `rejected`）。

纪律：只测纯函数 `validate_record`，不写库、不碰仓库题库（CONSTITUTION §6）。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services import sets_loader  # noqa: E402


def _sentences(count: int) -> tuple[list[dict], str]:
    text = "This is a practice listening sentence number %d about campus life, study and work"
    parts = []
    sentences = []
    for i in range(count):
        body = text % (i + 1)
        parts.append(body)
        sentences.append({"idx": i, "text": body, "anchor_sec": round(i * 2.4, 1)})
    return sentences, " ".join(parts)


def _questions(count: int) -> list[dict]:
    out = []
    for n in range(1, count + 1):
        qtype = ["gap_fill", "multiple_choice", "matching", "map_diagram_label"][(n - 1) % 4]
        q: dict = {"id": f"q{n}", "type": qtype, "number": n, "prompt": f"Question {n}."}
        if qtype == "gap_fill":
            q["word_limit"] = 2
            q["answer"] = "practice"
            q["accepted_alternatives"] = ["practice listening"]
            q["explanation_zh"] = f"第 {n} 题解析。"
        elif qtype == "multiple_choice":
            q["options"] = ["A. alpha", "B. beta", "C. gamma"]
            q["answer"] = "A"
            q["explanation_zh"] = f"第 {n} 题解析。"
        elif qtype == "matching":
            q["options_list"] = ["A. alpha", "B. beta", "C. gamma"]
            q["answer"] = "B"
            q["explanation_zh"] = f"第 {n} 题解析。"
        else:
            q["labels"] = ["A", "B", "C"]
            q["answer"] = "C"
            q["explanation_zh"] = f"第 {n} 题解析。"
        out.append(q)
    return out


def _mock_doc() -> dict:
    sentences, audio = _sentences(80)  # ≈1120 词
    return {
        "id": "li_mock_campus_01",
        "module": "listening",
        "kind": "mock_test",
        "section": 1,
        "sections_covered": [1, 2, 3, 4],
        "target_band": 6.5,
        "title_zh": "校园模拟卷（自写练习）",
        "topic": "campus",
        "source": "hand",
        "generated_at": "2026-11-12T00:00:00Z",
        "instruction_zh": "听录音，完成第 1–40 题。",
        "audio_text": audio,
        "audio_voice": "en-GB-SoniaNeural",
        "sentences": sentences,
        "questions": _questions(40),
    }


def _practice_doc() -> dict:
    sentences, audio = _sentences(40)  # ≈560 词
    doc = _mock_doc()
    doc.update(
        {
            "id": "li_s1_leisure_99",
            "kind": "practice",
            "section": 1,
            "audio_text": audio,
            "sentences": sentences,
            "questions": _questions(20),
        }
    )
    doc.pop("sections_covered", None)
    return doc


def test_mock_test通过装载校验():
    assert sets_loader.validate_record(_mock_doc(), "listening") == []


def test_practice通过装载校验():
    assert sets_loader.validate_record(_practice_doc(), "listening") == []


def test_mock_test题数不是40被拒():
    doc = _mock_doc()
    doc["questions"] = doc["questions"][:20]
    for n, q in enumerate(doc["questions"], 1):
        q["number"] = n
    problems = sets_loader.validate_record(doc, "listening")
    assert any("40" in p for p in problems), problems


def test_mock_test缺少sections_covered被拒():
    doc = _mock_doc()
    doc.pop("sections_covered", None)
    problems = sets_loader.validate_record(doc, "listening")
    assert any("sections_covered" in p for p in problems), problems


def test_mock_test_audio词数不足被拒():
    doc = _mock_doc()
    sentences, audio = _sentences(30)
    doc["audio_text"] = audio
    doc["sentences"] = sentences
    problems = sets_loader.validate_record(doc, "listening")
    assert any("audio_text" in p or "词" in p for p in problems), problems
