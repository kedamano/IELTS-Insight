"""客观题 raw → band 换算（spec-contracts.md §3-B / §6；验收 AC-L5、AC-R5、FR-G5）。

纯函数、无 IO（test-plan §2-L1「最快、覆盖业务规则核心」）。

契约矛盾的处理（已随交付上报主控，见 tests/test_band_scale.py 文件头）：
§3-B 说 20 题「raw*2 后查 LISTENING_40」，但那样 16→7.5、13→6.5，与 AC-L5/AC-R5 的
4 个锚点（16/20→7.0、13/20→6.0、10/13→7.0、8/13→6.0）各差 0.5。锚点是验收依据，
所以这里为 20 题/13 题档**显式定义换算表**（LISTENING_20 / READING_13），
40 题档逐字使用 §3-B 的 LISTENING_40 / READING_40。

规则：
- band 一律 float，0–9，0.5 步长（FR-G5）；
- 单调不降；表内「档间取低」= 落在两个阈值之间取较低档；
- `raw_correct` 越界夹紧到 [0, raw_total]；非整数或 `raw_total` 不在契约档位 → `ValueError`
  （上层 API 转 400，绝不 500）；
- 非契约档位（如 2/4/5 题的测试构造集）走 40 题等比映射 `raw*40/total` 向下取整查表，
  由 `raw_to_band()` 提供，判分器用它兜底，`listening_band/reading_band` 仍严格限档。
"""

from __future__ import annotations

from typing import Any, Mapping

# ---------------------------------------------------------------------------
# §3-B 逐字给出的两张官方 40 题表（threshold → band；档内取低于该值的最高档）
# ---------------------------------------------------------------------------
LISTENING_40 = {39: 9.0, 37: 8.5, 35: 8.0, 32: 7.5, 30: 7.0, 26: 6.5, 23: 6.0, 19: 5.5, 15: 5.0, 13: 4.5, 10: 4.0, 8: 3.5, 6: 3.0, 4: 2.5, 2: 2.0}
READING_40 = {39: 9.0, 37: 8.5, 35: 8.0, 33: 7.5, 31: 7.0, 27: 6.5, 23: 6.0, 19: 5.5, 15: 5.0, 12: 4.5, 9: 4.0, 7: 3.5, 5: 3.0, 3: 2.5, 2: 2.0}

# 20 题听力 / 13 题阅读档：等比映射 + 「恰在中点允许 +0.5、两档之间取低」的精神，
# 但整体按 AC-L5/AC-R5 四个锚点校准（详见模块 docstring）。
LISTENING_20 = {
    20: 9.0, 19: 8.5, 18: 8.0, 17: 7.5, 16: 7.0, 14: 6.5, 13: 6.0, 11: 5.5,
    10: 5.0, 8: 4.5, 7: 4.0, 5: 3.5, 4: 3.0, 3: 2.5, 2: 2.0, 1: 1.5,
}
READING_13 = {
    13: 9.0, 12: 8.5, 11: 8.0, 10: 7.0, 9: 6.5, 8: 6.0, 7: 5.5, 6: 5.0,
    5: 4.5, 4: 4.0, 3: 3.0, 2: 2.5, 1: 1.5,
}

TABLES: dict[tuple[str, int], dict[int, float]] = {
    ("listening", 20): LISTENING_20,
    ("listening", 40): LISTENING_40,
    ("reading", 13): READING_13,
    ("reading", 40): READING_40,
}

# 契约声明的档位（tests/test_band_scale.py VALID_TOTALS）；其余在专用入口视为配置错误
MODULE_TOTALS: dict[str, tuple[int, ...]] = {"listening": (20, 40), "reading": (13, 40)}

_FLOOR_BAND = 1.5  # 最低有效档（对 40 题表 raw=1 这类「低于最小阈值但非零」的情形）


def _validate_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} 必须是整数，实际 {type(value).__name__}: {value!r}")
    return value


def _band_from_table(table: Mapping[int, float], raw_correct: int) -> float:
    """查表：取「阈值 ≤ raw_correct」的最高档；两档之间取低。"""
    if raw_correct <= 0:
        return 0.0
    best: float | None = None
    for threshold, band in table.items():
        if threshold <= raw_correct and (best is None or band > best):
            best = band
    return _FLOOR_BAND if best is None else float(best)


def _generic_band(module: str, raw_correct: int, raw_total: int) -> float:
    """任意题量档：等比缩放到 40 题当量后查官方表（向下取整＝取低档）。"""
    table = LISTENING_40 if module == "listening" else READING_40
    scaled = int(raw_correct * 40 / raw_total)
    return _band_from_table(table, scaled)


def _lookup(module: str, raw_correct: Any, raw_total: Any, *, strict_totals: bool) -> float:
    if module not in MODULE_TOTALS:
        raise ValueError(f"未知模块: {module!r}（仅 listening / reading）")
    total = _validate_int(raw_total, "raw_total")
    raw = _validate_int(raw_correct, "raw_correct")
    if total <= 0:
        raise ValueError(f"raw_total 必须为正整数，实际 {total}")
    if strict_totals and total not in MODULE_TOTALS[module]:
        raise ValueError(
            f"{module} 的 raw_total 只支持 {'/'.join(str(t) for t in MODULE_TOTALS[module])} 题档，实际 {total}"
        )
    raw = max(0, min(raw, total))  # 越界夹紧（CONSTITUTION §3：不抛给上层变 500）
    if total in MODULE_TOTALS[module]:
        return _band_from_table(TABLES[(module, total)], raw)
    return _generic_band(module, raw, total)


def listening_band(raw_correct: int, raw_total: int) -> float:
    """听力 raw → band。仅契约档位 20/40；其余 ValueError（tests 视为配置错误）。"""
    return _lookup("listening", raw_correct, raw_total, strict_totals=True)


def reading_band(raw_correct: int, raw_total: int) -> float:
    """阅读 raw → band。仅契约档位 13/40。"""
    return _lookup("reading", raw_correct, raw_total, strict_totals=True)


def raw_to_band(module: str, raw_correct: int, raw_total: int) -> float:
    """判分器入口：契约档位走精确表，其它题量走 40 题等比映射（不抛未知档位）。"""
    return _lookup(module, raw_correct, raw_total, strict_totals=False)


def band_scale_name(module: str, raw_total: int) -> str:
    """§3-OR 的 band_scale 标识，如 listening_20q / reading_13q。"""
    return f"{module}_{int(raw_total)}q"
