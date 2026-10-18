"""L1 纯函数：客观题 raw → band 换算（spec-contracts.md §3-B）。

覆盖 AC：AC-L5（听力 16/20→7.0、13/20→6.0）、AC-R5（阅读 10/13→7.0、8/13→6.0）、FR-G5（0–9、0.5 步长）。

契约要求的符号（spec §3-B/§6 给了表名，函数名是 qa 侧固定下来的，T8 若用别的名字请先改 spec）：
    app.services.band_scale.LISTENING_40 / READING_40      # §3-B 逐字给出的两张表
    app.services.band_scale.listening_band(raw_correct, raw_total) -> float
    app.services.band_scale.reading_band(raw_correct, raw_total) -> float

⚠ 契约自相矛盾（已上报主控，不弱化测试）：§3-B 说 20 题用 "raw*2 后查 LISTENING_40"，
  但按该表 16*2=32 → 7.5、13*2=26 → 6.5，与 AC-L5 锚点要求的 7.0/6.0 各差 0.5。
  本文件按「AC 锚点是验收依据」（spec-product AC-L5/AC-R5 + test-plan §3-B 说明"必须过这 4 个锚点"）
  断言锚点，40 题档则按 §3-B 表逐条断言。要在 20 题/13 题档同时满足两者，
  契约必须显式补 LISTENING_20 / READING_13 两张表（hand-off 见交付报告）。
"""
from __future__ import annotations

import pytest

MODULE_FUNCS = {
    "listening": "listening_band",
    "reading": "reading_band",
}
# 契约支持的题量档：听力 20 题短练 / 40 题模拟卷，阅读 13 题 / 40 题（spec §3-B、FR-L2、FR-R1）
VALID_TOTALS = {"listening": (20, 40), "reading": (13, 40)}
MODULE_TOTALS = [(m, t) for m, ts in VALID_TOTALS.items() for t in ts]


@pytest.fixture(scope="module")
def band_scale(load_or_wait):
    return load_or_wait("app.services.band_scale")


def _call(band_scale, module: str, raw_correct, raw_total) -> float:
    fn = getattr(band_scale, MODULE_FUNCS[module], None)
    assert fn is not None, f"RED（等待实现）：app.services.band_scale 缺少函数 {MODULE_FUNCS[module]!r}"
    return fn(raw_correct, raw_total)


# --------------------------------------------------------------------------
# AC 锚点（绑定验收）
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("module", "raw_correct", "raw_total", "expected"),
    [
        ("listening", 16, 20, 7.0),
        ("listening", 13, 20, 6.0),
        ("reading", 10, 13, 7.0),
        ("reading", 8, 13, 6.0),
    ],
)
def test_AC_L5_AC_R5_四个锚点(band_scale, module, raw_correct, raw_total, expected):
    """AC-L5 / AC-R5：test-plan 明确"必须过这 4 个锚点"。"""
    assert _call(band_scale, module, raw_correct, raw_total) == expected


@pytest.mark.parametrize(
    ("module", "raw_correct", "raw_total", "expected"),
    [
        ("listening", 30, 40, 7.0),
        ("listening", 23, 40, 6.0),
        ("reading", 31, 40, 7.0),
        ("reading", 23, 40, 6.0),
    ],
)
def test_AC_L5_官方40题档(band_scale, module, raw_correct, raw_total, expected):
    """FR-L5/FR-R5：官方 40 题对照表档位（§3-B LISTENING_40/READING_40）。"""
    assert _call(band_scale, module, raw_correct, raw_total) == expected


@pytest.mark.parametrize(("module", "raw_total"), MODULE_TOTALS)
def test_AC_G5_零分与满分(band_scale, module, raw_total):
    """FR-G5：全错 → 0.0，全对 → 9.0（不存在 100 分制主分数）。"""
    assert _call(band_scale, module, 0, raw_total) == 0.0
    assert _call(band_scale, module, raw_total, raw_total) == 9.0


# --------------------------------------------------------------------------
# 不变量
# --------------------------------------------------------------------------
@pytest.mark.parametrize(("module", "raw_total"), MODULE_TOTALS)
def test_FR_G5_band一定是0到9且0步长05(band_scale, module, raw_total):
    """FR-G5：band ∈ [0,9] 且是 0.5 的整数倍。"""
    for raw in range(0, raw_total + 1):
        band = _call(band_scale, module, raw, raw_total)
        assert isinstance(band, float), f"band 必须是 float（契约 §0），实际 {type(band)}"
        assert 0.0 <= band <= 9.0, f"{module} {raw}/{raw_total} → {band} 越出 0–9"
        assert (band * 2) % 1 == 0, f"{module} {raw}/{raw_total} → {band} 不是 0.5 步长"


@pytest.mark.parametrize(("module", "raw_total"), MODULE_TOTALS)
def test_band随正确数单调不降(band_scale, module, raw_total):
    previous = -1.0
    for raw in range(0, raw_total + 1):
        band = _call(band_scale, module, raw, raw_total)
        assert band >= previous, f"{module} {raw}/{raw_total} → {band} 比上一档 {previous} 还低"
        previous = band


# --------------------------------------------------------------------------
# 夹紧与非法输入（CONSTITUTION §3：不允许 500，越界必须夹紧）
# --------------------------------------------------------------------------
@pytest.mark.parametrize(("raw_correct", "expected"), [(21, 9.0), (99, 9.0), (-1, 0.0), (-50, 0.0)])
def test_越界输入夹紧到09(band_scale, raw_correct, expected):
    assert _call(band_scale, "listening", raw_correct, 20) == expected


@pytest.mark.parametrize("bad", ["abc", 1.5, None, [1], {}])
def test_非法raw_correct抛ValueError(band_scale, bad):
    """非法输入必须 ValueError（上层转 400），不能 TypeError → 500。"""
    with pytest.raises(ValueError):
        _call(band_scale, "listening", bad, 20)


@pytest.mark.parametrize("bad_total", [0, -1, 7, 33, "20", None])
def test_未知题数抛ValueError(band_scale, bad_total):
    """raw_total 只允许契约声明的档位（20/40 听力、13/40 阅读）；其余是配置错误。"""
    with pytest.raises(ValueError):
        _call(band_scale, "listening", 1, bad_total)


# --------------------------------------------------------------------------
# 契约 §3-B 逐字给出的两张表
# --------------------------------------------------------------------------
def test_契约表LISTENING_40与READING_40逐条一致(band_scale):
    expected_listening = {
        39: 9.0, 37: 8.5, 35: 8.0, 32: 7.5, 30: 7.0, 26: 6.5, 23: 6.0,
        19: 5.5, 15: 5.0, 13: 4.5, 10: 4.0, 8: 3.5, 6: 3.0, 4: 2.5, 2: 2.0,
    }
    expected_reading = {
        39: 9.0, 37: 8.5, 35: 8.0, 33: 7.5, 31: 7.0, 27: 6.5, 23: 6.0,
        19: 5.5, 15: 5.0, 12: 4.5, 9: 4.0, 7: 3.5, 5: 3.0, 3: 2.5, 2: 2.0,
    }
    assert band_scale.LISTENING_40 == expected_listening, "LISTENING_40 与 spec-contracts §3-B 不一致"
    assert band_scale.READING_40 == expected_reading, "READING_40 与 spec-contracts §3-B 不一致"
