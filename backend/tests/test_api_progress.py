"""L3 API 契约：报告三端点（契约 §1 行 26–28；FR-P1/FR-P2/FR-P3/AC-P3）。

覆盖 AC：AC-G2（概览数字实时来自 attempts，不是旧的 learning_records 空表）、AC-P1（概览含四科当前分与
        距考试天数）、AC-P3（空库返回空态而不是 500/NaN）、FR-P3（弱项分析按题型/错因聚合）。

`current` 的取值：本文件用「最近一次 band_overall」与「该科均值」两种口径都能通过的断言
（契约没写死，见报告：FR-P1 的 delta_vs_previous 也依赖同一口径）。
"""
from __future__ import annotations

from _api_helpers import MODULES, is_iso8601

SUMMARY_KEYS = {
    "target_band",
    "exam_date",
    "days_left",
    "current",
    "delta_vs_previous",
    "attempts_total",
    "minutes_total",
    "last_practice_at",
}


def test_AC_P1_空库时概览返回空态而不是_500(client, envelope):
    data = envelope(client.get("/api/progress/summary"))
    assert SUMMARY_KEYS <= set(data), f"summary 缺字段：{sorted(SUMMARY_KEYS - set(data))}"
    assert set(data["current"]) >= set(MODULES), f"current 应覆盖四科：{data['current']!r}"
    for module in MODULES:
        assert data["current"][module] is None, f"没有任何练习时 {module} 应为 null，实际 {data['current'][module]!r}"
    assert data["attempts_total"] == 0 and data["minutes_total"] == 0
    assert data["last_practice_at"] is None


def test_AC_P1_有记录后概览实时反映(client, envelope, clean_state):
    data = envelope(client.get("/api/progress/summary"))
    assert data["attempts_total"] == len(clean_state.execute("SELECT id FROM attempts").fetchall())
    assert data["attempts_total"] > 0, "seed 未生效"
    assert set(data["current"]) >= set(MODULES)
    for module in MODULES:
        band = data["current"][module]
        assert band is None or (0.0 <= float(band) <= 9.0 and abs(float(band) * 2 - round(float(band) * 2)) < 1e-9), (
            f"{module} 的 band 越界或非 0.5 步长：{band!r}"
        )
    assert data["minutes_total"] > 0, f"seed 里带了 duration_sec，总时长不该为 0：{data['minutes_total']!r}"
    assert data["last_practice_at"] is None or is_iso8601(data["last_practice_at"])


def test_AC_P1_days_left_跟随_exam_date(client, envelope):
    client.patch("/api/settings", json={"exam_date": "2099-12-31"})
    data = envelope(client.get("/api/progress/summary"))
    assert isinstance(data["days_left"], int) and data["days_left"] > 0, f"远期考试日应有正天数：{data['days_left']!r}"
    client.patch("/api/settings", json={"exam_date": None})
    assert envelope(client.get("/api/progress/summary"))["days_left"] is None, "未设置考试日时 days_left 应为 null"


def test_FR_P1_同一科两次记录后_delta_有符号(client, envelope, seed):
    seed.attempts()
    second = {
        "id": "att_seed_li_2",
        "module": "listening",
        "task_ref": "li_s2_test_01",
        "band_overall": 6.0,
        "duration_sec": 280,
        "created_at": "2026-02-02T00:00:00Z",
    }
    if not seed.conn.execute("SELECT 1 FROM attempts WHERE id = ?", (second["id"],)).fetchone():
        from _api_helpers import seed_attempt

        seed_attempt(seed.conn, second)
    counts = {
        row["module"]: row["n"]
        for row in seed.conn.execute("SELECT module, COUNT(*) AS n FROM attempts GROUP BY module")
    }
    delta = envelope(client.get("/api/progress/summary"))["delta_vs_previous"]
    assert set(MODULES) <= set(delta), f"delta_vs_previous 应覆盖四科：{delta!r}"
    assert delta["listening"] is not None, (
        f"同一科有两次记录时 delta 必须可算（FR-P1 上升/下降箭头），实际 {delta!r}"
    )
    assert abs(float(delta["listening"])) <= 9.0
    for module, count in counts.items():
        if count < 2:
            assert delta[module] is None, f"{module} 只练过 {count} 次，不该有对比值：{delta[module]!r}"


def test_AC_P3_trend_空库返回空点集(client, envelope):
    data = envelope(client.get("/api/progress/trend", params={"module": "writing", "days": 30}))
    assert data["points"] == [], f"空态应为 []：{data!r}"


def test_FR_P2_trend_点结构为_date_band(client, envelope, clean_state):
    points = envelope(client.get("/api/progress/trend", params={"module": "listening", "days": 3650}))["points"]
    assert points, f"有记录却没有趋势点：{points!r}"
    for point in points:
        assert {"date", "band"} <= set(point), f"趋势点应为 {{date, band}}：{point!r}"
        assert is_iso8601(f"{point['date']}T00:00:00Z"), f"date 应为 YYYY-MM-DD：{point['date']!r}"
        assert 0.0 <= float(point["band"]) <= 9.0
    dates = [p["date"] for p in points]
    assert dates == sorted(dates), f"趋势点应按日期升序（画折线用）：{dates}"


def test_FR_P2_trend_的_days_窗口生效(client, envelope, clean_state):
    assert envelope(client.get("/api/progress/trend", params={"days": 1}))["points"] == []


def test_FR_P3_analytics_三个分组键(client, envelope, clean_state):
    data = envelope(client.get("/api/progress/analytics", params={"weeks": 8}))
    assert {"by_question_type", "by_error_type", "minutes_by_day"} <= set(data), f"analytics 缺字段：{sorted(data)}"
    for row in data["by_question_type"]:
        assert {"question_type", "correct", "total", "accuracy"} <= set(row), f"题型统计字段不全：{row!r}"
        assert 0.0 <= float(row["accuracy"]) <= 1.0, f"accuracy 应在 0–1（不是百分数）：{row!r}"
        assert row["correct"] <= row["total"]
    for row in data["by_error_type"]:
        assert {"error_type", "count", "latest_quote"} <= set(row), f"错因统计字段不全：{row!r}"
    for row in data["minutes_by_day"]:
        assert {"date", "minutes"} <= set(row), f"每日时长字段不全：{row!r}"
        assert float(row["minutes"]) >= 0


def test_FR_P3_analytics_的_quote_来自考生原文(client, envelope, clean_state):
    """契约 §1 行 28：latest_quote 给错题本/报告页展示，必须是考生说的话/写的句子。"""
    rows = envelope(client.get("/api/progress/analytics", params={"weeks": 52}))["by_error_type"]
    for row in rows:
        quote = row["latest_quote"]
        assert quote is None or (isinstance(quote, str) and quote.strip()), f"latest_quote 异常：{row!r}"


def test_AC_P3_analytics_空库返回空数组(client, envelope):
    data = envelope(client.get("/api/progress/analytics", params={"weeks": 4}))
    for key in ("by_question_type", "by_error_type", "minutes_by_day"):
        assert isinstance(data[key], list) and data[key] == [], f"空态 {key} 应为 []：{data[key]!r}"


def test_FR_G4_非法_trend_module_返回_400(client):
    resp = client.get("/api/progress/trend", params={"module": "grammar"})
    assert resp.status_code == 400, f"未知科目应 400，实际 {resp.status_code}：{resp.text[:160]!r}"
    body = resp.json()
    assert "code" in body and any("\u4e00" <= ch <= "\u9fff" for ch in str(body["detail"])), f"错误体不符契约：{body!r}"
