"""L1 纯函数：听力/阅读客观判分（spec-contracts.md §6 listening_grader/reading_grader + §3-OR）。

覆盖 AC：AC-L2（20 题全判分、返回 correct/total、每题 expected/accepted_alternatives/question_type）、
        AC-L3（等价规范化 + over_word_limit）、AC-R3（未答 → correct=false, reason=unanswered）、
        AC-R4（每题 explanation_zh 非空、answer_location 回填）、FR-G3（无 AI：ai_used=false）、
        §2-L（题面不得泄漏答案 —— 由 strip_answers 保证，端点侧在 test_api_module_endpoints.py 再测一次）。

契约要求的符号（spec §6 给模块名；函数名由 qa 固定，改名请先改 spec-contracts.md）：
    app.services.listening_grader.grade(set_doc, answers, *, duration_sec=None) -> dict
    app.services.reading_grader.grade(set_doc, answers, *, duration_sec=None, timed_out=False) -> dict
    app.services.{listening,reading}_grader.strip_answers(set_doc) -> dict
"""
from __future__ import annotations

import copy
from typing import Any

import pytest
from _samples import listening_set, reading_set

REASON_ENUM = {"wrong", "over_word_limit", "unanswered", "spelling_variant_rejected", None}
LEAK_KEYS = ("answer", "accepted_alternatives", "explanation_zh", "answer_quote", "answer_paragraph", "answer_label")


def build_questions(total: int, module: str) -> list[dict]:
    """按契约 §2-L/§2-R 的题型造 N 题：gap_fill / multiple_choice / (matching / tfng / heading_match)。"""
    questions: list[dict[str, Any]] = []
    for i in range(1, total + 1):
        if i % 4 == 0:
            q = {
                "id": f"q{i}",
                "type": "multiple_choice",
                "number": i,
                "prompt": f"Choice question {i}?",
                "options": ["A. first", "B. second", "C. third"],
                "answer": "B",
                "explanation_zh": f"第 {i} 题解析。",
            }
        elif module == "listening":
            q = {
                "id": f"q{i}",
                "type": "gap_fill",
                "number": i,
                "prompt": f"Fill blank {i}: ______.",
                "word_limit": 3,
                "answer": f"word{i}",
                "accepted_alternatives": [f"Word{i}", f"the word{i}"],
                "explanation_zh": f"第 {i} 题解析。",
            }
        elif i % 5 == 0:
            q = {
                "id": f"q{i}",
                "type": "true_false_notgiven",
                "number": i,
                "statement": f"Statement {i}.",
                "answer": "TRUE",
                "answer_label": "A",
                "answer_paragraph": "A",
                "answer_quote": "Urban planners now measure access in minutes, not miles.",
                "explanation_zh": f"第 {i} 题解析。",
            }
        else:
            q = {
                "id": f"q{i}",
                "type": "gap_fill",
                "number": i,
                "prompt": f"Fill blank {i}: ______.",
                "word_limit": 2,
                "answer": f"word{i}",
                "accepted_alternatives": [],
                "explanation_zh": f"第 {i} 题解析。",
            }
        questions.append(q)
    return questions


def all_correct_answers(questions: list[dict]) -> dict[str, str]:
    return {q["id"]: str(q["answer"]) for q in questions}


@pytest.fixture(scope="module")
def listening_grader(load_or_wait):
    return load_or_wait("app.services.listening_grader")


@pytest.fixture(scope="module")
def reading_grader(load_or_wait):
    return load_or_wait("app.services.reading_grader")


# --------------------------------------------------------------------------
# AC-L2：20 题全判分 + 报告结构
# --------------------------------------------------------------------------
def test_AC_L2听力20题全对(listening_grader):
    doc = listening_set(questions=build_questions(20, "listening"))
    report = listening_grader.grade(doc, all_correct_answers(doc["questions"]), duration_sec=600)

    assert report["module"] == "listening"
    assert report["raw_correct"] == 20
    assert report["raw_total"] == 20
    assert report["band"] == 9.0
    assert report["accuracy"] == pytest.approx(1.0)
    assert report["ai_used"] is False and report["approximate"] is False
    assert len(report["items"]) == 20
    for item in report["items"]:
        assert item["correct"] is True, f"{item['id']} 全对答案被判错：{item}"
        assert item["reason"] is None


def test_AC_L2听力20题全错(listening_grader):
    doc = listening_set(questions=build_questions(20, "listening"))
    answers = {q["id"]: "definitely-not-the-answer" for q in doc["questions"]}
    report = listening_grader.grade(doc, answers, duration_sec=300)

    assert report["raw_correct"] == 0
    assert report["band"] == 0.0
    assert all(item["correct"] is False for item in report["items"])


def test_AC_L2每题返回契约字段(listening_grader):
    doc = listening_set(questions=build_questions(20, "listening"))
    report = listening_grader.grade(doc, all_correct_answers(doc["questions"]))
    for q, item in zip(doc["questions"], report["items"], strict=True):
        assert item["id"] == q["id"]
        assert item["number"] == q["number"]
        assert item["type"] == q["type"], "契约 §3-OR 的 items[].type = question_type"
        assert "expected" in item, f"items[].expected 缺失：{item}"
        assert item["expected"] == q["answer"]
        assert "accepted_alternatives" in item, "AC-L2：每题要回传可接受变体"
        assert item["accepted_alternatives"] == q.get("accepted_alternatives", [])
        assert item["explanation_zh"], "attempt 响应必须回传中文解析（§2-L 只在题面剔除）"
        assert "your_answer" in item


def test_AC_L2未作答的题id也必须在items里(listening_grader):
    doc = listening_set(questions=build_questions(20, "listening"))
    answers = {q["id"]: str(q["answer"]) for q in doc["questions"][:5]}
    report = listening_grader.grade(doc, answers)
    assert len(report["items"]) == 20
    assert report["raw_correct"] == 5
    missing = [i for i in report["items"] if i["id"] not in answers]
    assert all(i["correct"] is False and i["reason"] == "unanswered" for i in missing)


# --------------------------------------------------------------------------
# AC-L3 / AC-R4 判分细节
# --------------------------------------------------------------------------
def test_AC_L3等价变体判对(listening_grader):
    doc = listening_set(questions=build_questions(20, "listening"))
    answers = {}
    for q in doc["questions"]:
        if q["type"] == "gap_fill":
            alts = q["accepted_alternatives"]
            answers[q["id"]] = alts[0] if alts else str(q["answer"])
        else:
            answers[q["id"]] = str(q["answer"])
    report = listening_grader.grade(doc, answers)
    assert report["raw_correct"] == 20, [i for i in report["items"] if not i["correct"]]


def test_AC_L3超字数判错并给原因(listening_grader):
    q = {
        "id": "q1",
        "type": "gap_fill",
        "number": 11,
        "prompt": "The museum opens at ______.",
        "word_limit": 2,
        "answer": "9:30",
        "accepted_alternatives": [],
        "explanation_zh": "原文给出时间。",
    }
    doc = listening_set(questions=[q])
    report = listening_grader.grade(doc, {"q1": "half past nine in the morning"})
    item = report["items"][0]
    assert item["correct"] is False
    assert item["reason"] == "over_word_limit"


def test_AC_L5判分结果用band_scale换算(listening_grader, load):
    """AC-L5：16/20 → 7.0（判分与换算必须串起来，不能各自正确）。"""
    band_scale = load("app.services.band_scale")
    doc = listening_set(questions=build_questions(20, "listening"))
    answers = all_correct_answers(doc["questions"])
    for q in doc["questions"][16:]:
        answers[q["id"]] = "nope"
    report = listening_grader.grade(doc, answers)
    assert report["raw_correct"] == 16
    assert report["band"] == band_scale.listening_band(16, 20) == 7.0
    assert isinstance(report.get("band_scale"), str) and report["band_scale"], "契约 §3-OR 要求 band_scale 标识"


def test_AC_L2_by_question_type聚合正确(listening_grader):
    doc = listening_set(questions=build_questions(20, "listening"))
    answers = all_correct_answers(doc["questions"])
    gap_ids = [q["id"] for q in doc["questions"] if q["type"] == "gap_fill"]
    answers[gap_ids[0]] = "totally wrong"
    report = listening_grader.grade(doc, answers)
    bucket = report["by_question_type"]["gap_fill"]
    assert bucket["total"] == len(gap_ids)
    assert bucket["correct"] == len(gap_ids) - 1
    assert sum(b["total"] for b in report["by_question_type"].values()) == 20
    assert report["raw_correct"] == sum(b["correct"] for b in report["by_question_type"].values())


def test_FR_L1听力报告回传transcript(listening_grader):
    doc = listening_set(questions=build_questions(2, "listening"))
    report = listening_grader.grade(doc, {})
    assert report["transcript"] == doc["audio_text"], "契约 §3-OR：transcript 是听力原文（AC-L1b 精读模式依赖它）"


# --------------------------------------------------------------------------
# AC-R3 / AC-R4 阅读
# --------------------------------------------------------------------------
def test_AC_R4阅读13题全对(listening_grader, reading_grader):
    doc = reading_set(questions=build_questions(13, "reading"))
    report = reading_grader.grade(doc, all_correct_answers(doc["questions"]), duration_sec=900)
    assert report["module"] == "reading"
    assert report["raw_total"] == 13
    assert report["raw_correct"] == 13
    assert report["band"] == 9.0
    assert len(report["items"]) == 13
    assert report["ai_used"] is False


def test_AC_R3到点未答记为unanswered(listening_grader, reading_grader):
    doc = reading_set(questions=build_questions(13, "reading"))
    answers = {q["id"]: str(q["answer"]) for q in doc["questions"][:6]}
    report = reading_grader.grade(doc, answers, duration_sec=1200, timed_out=True)
    assert report["raw_correct"] == 6
    for item in report["items"]:
        if item["id"] not in answers:
            assert item["correct"] is False
            assert item["reason"] == "unanswered"
        assert item["reason"] in REASON_ENUM


def test_AC_R4每题错答都有非空中文解析(listening_grader, reading_grader):
    doc = reading_set(questions=build_questions(13, "reading"))
    answers = {q["id"]: "not the answer" for q in doc["questions"]}
    report = reading_grader.grade(doc, answers)
    wrong = [i for i in report["items"] if not i["correct"]]
    assert len(wrong) == 13
    for item in wrong:
        assert item["explanation_zh"] and item["explanation_zh"].strip(), f"AC-R4：{item['id']} 缺中文解析"


def test_AC_R4答案定位字段回填(reading_grader):
    q = {
        "id": "q1",
        "type": "true_false_notgiven",
        "number": 1,
        "statement": "Planners measure access in miles.",
        "answer": "FALSE",
        "answer_label": "B",
        "answer_paragraph": "A",
        "answer_quote": "Urban planners now measure access in minutes, not miles.",
        "explanation_zh": "与原文相反。",
    }
    doc = reading_set(questions=[q])
    report = reading_grader.grade(doc, {"q1": "TRUE"})
    item = report["items"][0]
    assert item["answer_paragraph"] == "A", "FR-R4：answer_location（段落 label）"
    assert item["answer_quote"].startswith("Urban planners"), "FR-R4：answer_location 的原文引用句"


def test_FR_R4匹配类选项可重复使用(reading_grader):
    qs = [
        {
            "id": f"q{i}",
            "type": "heading_match",
            "number": i,
            "paragraph_label": chr(ord("A") + i),
            "options_headings": [{"i": "i", "text": "重复使用的标题"}, {"i": "ii", "text": "另一个"}],
            "answer": "i",
            "explanation_zh": "选项可重复使用。",
        }
        for i in range(1, 4)
    ]
    doc = reading_set(questions=qs)
    report = reading_grader.grade(doc, {f"q{i}": "i" for i in range(1, 4)})
    assert report["raw_correct"] == 3, "同一 heading 用于多题必须都判对"


# --------------------------------------------------------------------------
# §2-L：题面不得泄漏答案
# --------------------------------------------------------------------------
@pytest.mark.parametrize("module_name", ["listening", "reading"])
def test_2L题面strip_answers剔除答案字段(load, module_name):
    mod = load(f"app.services.{module_name}_grader")
    strip = getattr(mod, "strip_answers", None)
    assert callable(strip), f"RED（等待实现）：{module_name}_grader 没有 strip_answers()（§2-L 要求题面剔除答案）"
    doc = listening_set() if module_name == "listening" else reading_set()
    stripped = strip(copy.deepcopy(doc))
    for q in stripped["questions"]:
        for key in LEAK_KEYS:
            assert key not in q, f"题面泄漏答案字段 {key!r}：{q}"
    assert stripped["questions"], "剔除后题目本身还在"
    # 原对象不能被就地改坏（attempt 还要用原 doc 判分）
    assert any("answer" in q for q in doc["questions"]), "样本本身应含答案（测试前提）"


def test_判分函数不修改入参(listening_grader):
    doc = listening_set(questions=build_questions(4, "listening"))
    snapshot = copy.deepcopy(doc)
    listening_grader.grade(doc, all_correct_answers(doc["questions"]))
    assert doc == snapshot, "grade() 不允许就地修改题库文档"
