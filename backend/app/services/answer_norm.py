"""答案等价规范化（spec-contracts.md §6；验收 AC-L3、AC-R4 的填空部分）。

纯函数、表驱动，无 IO。判分 reason 取值遵循契约 §3-OR 枚举：
`wrong` / `over_word_limit` / `unanswered` / `spelling_variant_rejected`（判对时为 None）。

符号（tests/test_answer_norm.py 头部固定）：
    normalize(text) -> str
    equivalent(expected, given, alternatives=()) -> bool
    word_count(text) -> int
    judge_fill(expected, given, *, accepted_alternatives=(), word_limit=None) -> (bool, str|None)
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional, Tuple

# --------------------------------------------------------------------------
# 表
# --------------------------------------------------------------------------
_ARTICLES = ("a", "an", "the")

_NUM_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14",
    "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18",
    "nineteen": "19", "twenty": "20", "thirty": "30", "forty": "40", "fifty": "50",
}

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
_MONTH_ABBR = {name[:3]: value for name, value in _MONTHS.items()}

# true/false/notgiven 的官方书写变体（FR-R4 要求区分「未提及」与「反驳」，这里只做书写归一）
_TFNG = {
    "true": "true", "t": "true",
    "false": "false", "f": "false",
    "notgiven": "notgiven", "not given": "notgiven", "ng": "notgiven",
}

# --------------------------------------------------------------------------
# normalize：小写 / 折叠空白 / 连字符变空格 / 去句首冠词
# --------------------------------------------------------------------------

def _strip_leading_articles(s: str) -> str:
    """只剥句首冠词（官方规则：答案前的 a/an/the 不影响判定）。

    "the apple juice" 中间的 the 属于答案本体，不剥；整串就是冠词时保留（"a" 是合法答案）。
    """
    changed = True
    while changed:
        changed = False
        for art in _ARTICLES:
            prefix = art + " "
            if s.startswith(prefix) and s[len(prefix):].strip():
                s = s[len(prefix):].lstrip()
                changed = True
                break
    return s


def normalize(text: Any) -> str:
    if text is None:
        return ""
    s = str(text).strip().lower()
    s = s.replace("-", " ").replace("_", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return _strip_leading_articles(s)


# --------------------------------------------------------------------------
# canonical：等价判定用的内部规范形（时间 / 日期 / 数字词 / 标点）
# --------------------------------------------------------------------------

def _canonical_date(s: str) -> str:
    """把 4 种日期写法统一为 "d m y"（数字月）。"""
    toks = s.split()
    if len(toks) != 3:
        return s
    a, b, c = toks
    if not (c.isdigit() and len(c) == 4):
        return s
    if b in _MONTHS or b in _MONTH_ABBR:
        month = _MONTHS.get(b) or _MONTH_ABBR[b]
        if a.isdigit():
            return f"{int(a)} {month} {int(c)}"
    if a in _MONTHS or a in _MONTH_ABBR:
        month = _MONTHS.get(a) or _MONTH_ABBR[a]
        if b.isdigit():
            return f"{int(b)} {month} {int(c)}"
    if a.isdigit() and b.isdigit() and 1 <= int(b) <= 12:
        return f"{int(a)} {int(b)} {int(c)}"
    return s


def _canonical(text: Any) -> str:
    s = normalize(text)
    if not s:
        return ""
    s = re.sub(r"(?<=\d),(?=\d{3}(\b|$))", "", s)  # 1,000 → 1000
    s = s.replace(",", " ").replace("/", " ")
    s = re.sub(r"\s+", " ", s)
    s = " ".join(_NUM_WORDS.get(tok, tok) for tok in s.split())

    # 时间：9.30 → 9:30；整串 "9 30"（数字词展开后的 nine thirty）→ 9:30；去小时前导零
    s = re.sub(r"(?<!\d)(\d{1,2})\.(\d{2})(?!\d)", r"\1:\2", s)
    whole = re.fullmatch(r"(\d{1,2}) (\d{2})", s)
    if whole:
        s = f"{int(whole.group(1))}:{whole.group(2)}"
    s = re.sub(r"(?<!\d)0(\d)(:\d{2})\b", r"\1\2", s)

    # 先去掉除字母/数字/撇号/冒号/空格之外的标点（October 20, 2026 → october 20 2026），
    # 再解析日期，最后整体折叠空白。9:30 的冒号在白名单里不会被误删。
    s = re.sub(r"[^a-z0-9': ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return _canonical_date(s)


# --------------------------------------------------------------------------
# equivalent
# --------------------------------------------------------------------------

def equivalent(expected: Any, given: Any, alternatives: Optional[Iterable[Any]] = None) -> bool:
    """大小写/空格/冠词/数字/时间/日期/连字符等价，或命中题库显式接受的变体。

    注意：拼写错误**不是**等价（library ≠ libraries，musuem ≠ museum）。
    """
    cg = _canonical(given)
    if not cg:
        return False
    if cg == _canonical(expected):
        return True
    for alt in alternatives or ():
        if cg == _canonical(alt):
            return True
    return False


# --------------------------------------------------------------------------
# word_count（官方：连字符复合词算 1 词；数字/单词都算 1 词）
# --------------------------------------------------------------------------

def word_count(text: Any) -> int:
    if text is None:
        return 0
    s = str(text).strip()
    if not s:
        return 0
    return len([t for t in re.split(r"\s+", s) if t])


# --------------------------------------------------------------------------
# 近似拼写（spelling_variant_rejected 路径）
# --------------------------------------------------------------------------

def _damerau_levenshtein(a: str, b: str, limit: int) -> int:
    """受限编辑距离（含相邻换位）；只为「近似拼写仍判错、但原因单列」服务。"""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    la, lb = len(a), len(b)
    prev2: Optional[list[int]] = None
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if (
                i > 1 and j > 1 and prev2 is not None
                and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]
            ):
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        prev2 = prev
        prev = cur
    return prev[lb]


def _is_spelling_variant(expected: Any, given: Any, alternatives: Optional[Iterable[Any]] = None) -> bool:
    """单词级近似拼写：musuem≈museum、libary≈library、densiti≈density。

    官方不接受拼写变体 → 判错；原因与「完全答错」区分（契约 §3-OR 枚举内的
    spelling_variant_rejected）。多词答案不做该判定（那是 wrong/unanswered 的领域）。
    """
    g = normalize(given)
    if not g or " " in g or not re.fullmatch(r"[a-z']{4,}", g):
        return False
    for w in [str(expected)] + [str(a) for a in (alternatives or ())]:
        e = normalize(w)
        if not e or not re.fullmatch(r"[a-z']{4,}", e):
            continue
        limit = 2 if len(e) >= 6 else 1
        if _damerau_levenshtein(e, g, limit) <= limit:
            return True
    return False


# --------------------------------------------------------------------------
# judge_fill —— 契约 §3-OR reason 语义
# --------------------------------------------------------------------------

def judge_fill(
    expected: Any,
    given: Any,
    *,
    accepted_alternatives: Optional[Iterable[Any]] = None,
    word_limit: Optional[int] = None,
) -> Tuple[bool, Optional[str]]:
    """填空题判分。返回 (correct, reason)，reason ∈ §3-OR 枚举或 None（判对）。

    顺序（官方规则）：空 → unanswered；超词数 → over_word_limit（先于内容判定）；
    等价或命中显式变体 → 判对；近似拼写 → spelling_variant_rejected；其余 → wrong。
    """
    if given is None or str(given).strip() == "":
        return False, "unanswered"
    if word_limit is not None and word_count(given) > word_limit:
        return False, "over_word_limit"
    alts = list(accepted_alternatives or ())
    if equivalent(expected, given, alts):
        return True, None
    if _is_spelling_variant(expected, given, alts):
        return False, "spelling_variant_rejected"
    return False, "wrong"


# --------------------------------------------------------------------------
# 选择类判分（multiple_choice / matching / map_diagram_label / heading_match / TFNG）
# --------------------------------------------------------------------------

def _tfng_canon(s: str) -> Optional[str]:
    return _TFNG.get(s)


def judge_choice(
    expected: Any,
    given: Any,
    *,
    question_type: Optional[str] = None,
    accepted_alternatives: Optional[Iterable[Any]] = None,
) -> Tuple[bool, Optional[str]]:
    """非填空题判分：标签/字母/罗马数字/TRUE-FALSE-NOTGIVEN 的字面等价。

    matching / heading_match 选项可重复使用 → 逐题独立判定即可（FR-R4）。
    """
    if given is None or str(given).strip() == "":
        return False, "unanswered"
    alts = list(accepted_alternatives or ())

    def canon(value: Any) -> str:
        s = normalize(value)
        if question_type == "true_false_notgiven":
            tf = _tfng_canon(s)
            if tf:
                return tf
        # 回填了整条选项文本（"B. To ask about hours"）→ 取首个单字母标记
        m = re.match(r"^([a-p])[.)\s]", s)
        return m.group(1) if m else s

    cg = canon(given)
    if not cg:
        return False, "unanswered"
    if cg == canon(expected):
        return True, None
    for alt in alts:
        if cg == canon(alt):
            return True, None
    return False, "wrong"
