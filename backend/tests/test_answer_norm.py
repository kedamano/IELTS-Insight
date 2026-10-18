"""L1 纯函数：答案等价规范化（spec-contracts.md §6 services/answer_norm.py）。

覆盖 AC：AC-L3（填空忽略大小写/前后空格/冠词/数字与日期多写法、超字数判错并给 over_word_limit）、
        AC-R4（阅读 gap_fill/sentence_completion 同一套规范化）、FR-G5（分数语义无关，这里只管判分）。

契约要求的符号（spec §6 只给了模块名，函数名由 qa 固定，T8 若改名请先改 spec-contracts.md）：
    app.services.answer_norm.normalize(text) -> str
    app.services.answer_norm.equivalent(expected, given, alternatives=()) -> bool
    app.services.answer_norm.word_count(text) -> int
    app.services.answer_norm.judge_fill(expected, given, *, accepted_alternatives=(), word_limit=None)
        -> tuple[bool, str | None]        # (correct, reason)，reason 取契约 §3-OR 的枚举
"""
from __future__ import annotations

import pytest

# 契约 §3-OR items[].reason 的取值域
REASON_ENUM = {"wrong", "over_word_limit", "unanswered", "spelling_variant_rejected", None}


@pytest.fixture(scope="module")
def answer_norm(load_or_wait):
    return load_or_wait("app.services.answer_norm")


# --------------------------------------------------------------------------
# normalize
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("raw", "expect_normalized_equal"),
    [
        ("  Museum ", "museum"),
        ("MUSEUM", "museum"),
        ("the museum", "museum"),
        ("The  Museum", "museum"),
        ("part-time job", "part time job"),
        ("it's   fine", "it's fine"),
    ],
)
def test_AC_L3_normalize小写去空格去冠词折叠空白(answer_norm, raw, expect_normalized_equal):
    assert answer_norm.normalize(raw) == expect_normalized_equal


@pytest.mark.parametrize("raw", ["", "   ", "\t\n"])
def test_normalize空输入返回空串(answer_norm, raw):
    assert answer_norm.normalize(raw) == ""


# --------------------------------------------------------------------------
# equivalent —— AC-L3 每一种等价至少 1 条
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("expected", "given"),
    [
        # 大小写
        ("museum", "Museum"),
        ("Monday", "monday"),
        # 前后空格
        ("9:30", "  9:30 "),
        # a/an/the 前缀
        ("the library", "library"),
        ("an hour", "hour"),
        ("apple juice", "the apple juice"),
        # 数字 ↔ 英文数词
        ("5 pounds", "five pounds"),
        ("12 students", "twelve students"),
        ("1,000", "1000"),
        # 时间多种写法（契约 §2-L accepted_alternatives 之外的内建等价）
        ("9:30", "9.30"),
        ("9:30", "nine thirty"),
        # 日期 3 种写法（FR-L3：20 October 2026 / 20/10/2026）
        ("20 October 2026", "20/10/2026"),
        ("20 October 2026", "October 20, 2026"),
        ("20 October 2026", "20-10-2026"),
        # 连字符 ↔ 空格
        ("part-time", "part time"),
        ("self-confident", "self confident"),
        # 标点/尾点
        ("Paris.", "Paris"),
    ],
)
def test_AC_L3等价判定(answer_norm, expected, given):
    assert answer_norm.equivalent(expected, given) is True, f"{expected!r} 应当等价于 {given!r}"


@pytest.mark.parametrize(
    ("expected", "given"),
    [
        ("museum", "theatre"),
        ("9:30", "9:15"),
        ("5 pounds", "six pounds"),
        ("20 October 2026", "21/10/2026"),
        ("library", "libraries"),  # 词形变化不是等价
        ("the museum", "musuem"),  # 拼错的词不能被"纠正"成正确答案
    ],
)
def test_AC_L3不等价判定(answer_norm, expected, given):
    assert answer_norm.equivalent(expected, given) is False, f"{expected!r} 不应等价于 {given!r}"


@pytest.mark.parametrize(
    ("expected", "given", "alternatives"),
    [
        ("9:30", "nine thirty", ["nine thirty"]),
        ("London", "Londn", ["Londn"]),  # 题库显式接受的变体
        ("museum", "the museum", []),
    ],
)
def test_AC_L3accepted_alternatives被接受(answer_norm, expected, given, alternatives):
    assert answer_norm.equivalent(expected, given, alternatives) is True


# --------------------------------------------------------------------------
# word_count
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("text", "count"),
    [
        ("nine thirty", 2),
        ("5 pounds", 2),
        ("the old city museum", 4),
        ("a", 1),
        ("", 0),
        ("ice-cream", 1),  # 连字符复合词算 1 个词（官方规则）
    ],
)
def test_FR_L3字数统计(answer_norm, text, count):
    assert answer_norm.word_count(text) == count


# --------------------------------------------------------------------------
# judge_fill —— 契约 §3-OR 的 reason 语义
# --------------------------------------------------------------------------
def test_AC_L3超字数直接判错并给原因(answer_norm):
    correct, reason = answer_norm.judge_fill("museum", "the old city museum", word_limit=2)
    assert correct is False
    assert reason == "over_word_limit"


def test_AC_L3字数恰好达线不判超(answer_norm):
    correct, reason = answer_norm.judge_fill("old town museum", "old town museum", word_limit=3)
    assert correct is True
    assert reason is None


@pytest.mark.parametrize("given", ["", "   ", None])
def test_AC_R3空答案判unanswered(answer_norm, given):
    correct, reason = answer_norm.judge_fill("museum", given)
    assert correct is False
    assert reason == "unanswered"


def test_错答案reason为wrong(answer_norm):
    correct, reason = answer_norm.judge_fill("museum", "cinema")
    assert correct is False
    assert reason == "wrong"


@pytest.mark.parametrize(
    ("expected", "given"),
    [("museum", "musuem"), ("library", "libary"), ("density", "densiti")],
)
def test_拼写近似但不同答案必须判错且reason在枚举内(answer_norm, expected, given):
    """契约 §3-OR 的 reason 只允许 {wrong, over_word_limit, unanswered, spelling_variant_rejected}。

    具体落在哪个值由实现决定（spec 没定义"近似拼写"该走哪条），但绝不能把拼错的词判对。
    """
    correct, reason = answer_norm.judge_fill(expected, given)
    assert correct is False, f"{given!r} 拼错却判对 —— 官方不接受拼写变体"
    assert reason in REASON_ENUM, f"reason={reason!r} 不在契约枚举内"


def test_有alternatives时命中即correct(answer_norm):
    correct, reason = answer_norm.judge_fill(
        "9:30", "half past nine", accepted_alternatives=["half past nine"]
    )
    assert correct is True
    assert reason is None
