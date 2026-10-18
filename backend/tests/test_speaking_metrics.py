"""L1 纯函数：口语可本地计算的指标（spec-contracts.md §3-S metrics / §6 speaking_metrics）。

覆盖 AC：AC-S4（报告要有 metrics）、FR-S5（反馈要有可核对的量化依据）、AC-G5（0–9 语义不影响这里，
        但 wpm/pause 是本地量，必须无网络也能算）。

契约要求的符号（spec §6 给模块名，函数签名由 qa 固定）：
    app.services.speaking_metrics.compute(
        transcript: str, duration_sec: float,
        *, segments: list[dict] | None = None, expected_text: str | None = None
    ) -> dict   # {word_count, wpm, pause_total_sec, fillers, repeats}
segments 元素形如 whisper 输出：{"start": float, "end": float, "text": str}
"""
from __future__ import annotations

import pytest

METRIC_KEYS = {"word_count", "wpm", "pause_total_sec", "fillers", "repeats"}


@pytest.fixture(scope="module")
def metrics(load_or_wait):
    mod = load_or_wait("app.services.speaking_metrics")

    def _call(*args, **kwargs):
        fn = getattr(mod, "compute", None)  # 占位物会在测试体内触发 RED（等待实现）
        assert callable(fn), "RED（等待实现）：app.services.speaking_metrics 没有 compute()"
        return fn(*args, **kwargs)

    return _call


def test_AC_S4字数与wpm按实际时长算(metrics):
    transcript = " ".join(f"word{i}" for i in range(30))
    result = metrics(transcript, 60.0)
    assert result["word_count"] == 30
    assert result["wpm"] == pytest.approx(30.0, abs=0.6), "wpm = 词数 / 分钟"


def test_AC_S4时长非整分钟也按分钟换算(metrics):
    transcript = " ".join(["alpha"] * 20)
    result = metrics(transcript, 30.0)
    assert result["wpm"] == pytest.approx(40.0, abs=0.8)


def test_AC_S4标点与大小写不影响词数(metrics):
    a = metrics("Hello, there. I am fine!", 60.0)
    assert a["word_count"] == 5, f"标点应被忽略：{a}"
    assert list(a["fillers"]) == []


def test_AC_S4零时长不炸(metrics):
    result = metrics("some words here", 0.0)
    assert result["word_count"] == 3
    assert result["wpm"] in (0, 0.0) or result["wpm"] == pytest.approx(0.0), "duration=0 时 wpm 必须夹紧为 0，不能 ZeroDivision"


def test_FR_S5停顿总时长由segments间隙算出(metrics):
    segments = [
        {"start": 0.0, "end": 2.0, "text": "I like"},
        {"start": 3.0, "end": 5.0, "text": "playing tennis"},
        {"start": 8.0, "end": 9.5, "text": "very much"},
    ]
    transcript = " ".join(s["text"] for s in segments)
    result = metrics(transcript, 9.5, segments=segments)
    assert result["pause_total_sec"] == pytest.approx(4.0, abs=0.2), "间隙 3.0-2.0=1.0s 与 8.0-5.0=3.0s，合计 4.0s 停顿"


def test_AC_S4空停顿为0(metrics):
    segments = [{"start": 0.0, "end": 2.0, "text": "one two"}, {"start": 2.0, "end": 4.0, "text": "three four"}]
    result = metrics("one two three four", 4.0, segments=segments)
    assert result["pause_total_sec"] == pytest.approx(0.0, abs=0.05)


@pytest.mark.parametrize(
    ("transcript", "filler"),
    [
        ("I think, you know, it is a good idea", "you know"),
        ("um, I was going to say, uh, maybe later", "um"),
        ("it was sort of difficult to explain", "sort of"),
        ("You KNOW what I mean", "you know"),  # 大小写不敏感
    ],
)
def test_FR_S5填充词被识别(metrics, transcript, filler):
    result = metrics(transcript, 60.0)
    assert filler in [str(f).lower().strip() for f in result["fillers"]], f"{filler!r} 应出现在 fillers：{result}"


def test_FR_S5重复词计数统计连续重复(metrics):
    transcript = "I I went to the the shop and and bought food"
    result = metrics(transcript, 60.0)
    assert result["repeats"] == 3, f"三处连续重复：{result}"


def test_AC_S4返回字典键齐全(metrics):
    result = metrics("hello world", 10.0)
    assert isinstance(result, dict)
    assert METRIC_KEYS <= set(result), f"metrics 缺字段：{METRIC_KEYS - set(result)}"


def test_FR_G3空转写也能算(metrics):
    result = metrics("", 0.0)
    assert result["word_count"] == 0
    assert result["wpm"] == pytest.approx(0.0)
    assert result["fillers"] == []
    assert result["repeats"] == 0
