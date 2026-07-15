import re
from dataclasses import dataclass


@dataclass
class WordScore:
    word: str
    status: str  # "correct" | "wrong" | "missing" | "extra"


@dataclass
class ScoreResult:
    pronunciation_score: int
    fluency_score: int
    completeness_score: int
    overall_score: int
    word_scores: list[WordScore]
    feedback: str
    ai_tip: str = ""


def _normalize(text: str) -> str:
    return re.sub(r"[^\w\s]", "", text.lower().strip())


def _wer(reference: str, hypothesis: str) -> float:
    """计算词错率 (Word Error Rate)"""
    r = _normalize(reference).split()
    h = _normalize(hypothesis).split()
    n = len(r)

    if n == 0:
        return 0.0

    dp = [[0] * (len(h) + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(len(h) + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, len(h) + 1):
            if r[i - 1] == h[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i - 1][j - 1], dp[i][j - 1])

    return dp[n][len(h)] / n


def _align_words(reference: str, hypothesis: str) -> list[WordScore]:
    """逐词对齐，标注正确/错误"""
    r = _normalize(reference).split()
    h = _normalize(hypothesis).split()

    if not r:
        return [WordScore(word=w, status="extra") for w in h]

    scores = []
    for i, ref_word in enumerate(r):
        if i < len(h) and h[i] == ref_word:
            scores.append(WordScore(word=ref_word, status="correct"))
        elif i < len(h):
            scores.append(WordScore(word=h[i], status="wrong"))
        else:
            scores.append(WordScore(word=ref_word, status="missing"))

    for j in range(len(r), len(h)):
        scores.append(WordScore(word=h[j], status="extra"))

    return scores


def score(original: str, user: str, duration_ms: int = 0, confidence: float = 0) -> ScoreResult:
    """
    三维评分 + AI 纠错（M2 接入 GPT）
    """
    wer_val = _wer(original, user)
    completeness = max(0, int((1 - wer_val) * 100))
    pronunciation = max(0, int((1 - wer_val) * 95))

    if duration_ms > 0:
        word_count = len(_normalize(original).split())
        wpm = (word_count / duration_ms) * 60000
        fluency = max(0, min(100, int((wpm / 120) * 80 + 20)))
    else:
        fluency = completeness

    overall = int(pronunciation * 0.5 + fluency * 0.3 + completeness * 0.2)
    word_scores = _align_words(original, user)

    if completeness >= 90:
        feedback = "🌟 非常好！发音清晰，非常接近原文。"
    elif completeness >= 70:
        feedback = "👍 不错！基本正确，注意细节发音。"
    elif completeness >= 50:
        feedback = "💪 继续努力！多听几遍标准发音再试。"
    else:
        feedback = "🎯 先仔细听示范，再逐句跟读。"

    return ScoreResult(
        pronunciation_score=pronunciation,
        fluency_score=fluency,
        completeness_score=completeness,
        overall_score=overall,
        word_scores=word_scores,
        feedback=feedback
    )


def score_with_ai(original: str, user: str, duration_ms: int = 0, confidence: float = 0) -> ScoreResult:
    """三维评分 + GPT AI 纠错（M2 新增）"""
    base = score(original, user, duration_ms, confidence)

    # 调用 GPT 纠错
    from app.services.ai_service import get_ai_feedback
    ai_tip = get_ai_feedback(original, user, base.word_scores)

    base.ai_tip = ai_tip
    return base
