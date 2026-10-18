"""L3 API 契约：练习存档 `GET /attempts`、`GET /attempts/{id}`、`DELETE /attempts/{id}`（契约 §1 行 23–25）。

覆盖 AC：AC-G2（attempts 是唯一练习事实表，列表/详情/删除都读它）、AC-P4（存档列表可分页、可删）、
        FR-G4（不存在的 id → 404 + {detail, code}）、AC-X1（不再有付费/成就类统计端点冒充存档）。

AttemptSummary 的字段名契约 §1 只写了类型名没写字段（已在报告里标为规格缺口）：
这里只断言 attempts 表必然带的四个字段，不多要。
"""
from __future__ import annotations

import pytest
from _api_helpers import MODULES, is_iso8601

SUMMARY_KEYS = ("id", "module", "task_ref", "created_at")


def test_AC_G2_空库时列表返回空数组而不是_500(client, envelope):
    data = envelope(client.get("/api/attempts"))
    assert data["items"] == [], f"空态应返回空列表：{data!r}"
    assert data["total"] == 0


@pytest.mark.parametrize("module", MODULES)
def test_AC_G2_按_module_过滤(client, envelope, clean_state, module):
    rows = envelope(client.get("/api/attempts", params={"module": module}))["items"]
    assert rows, f"seed 后 /attempts?module={module} 应有数据"
    assert {r["module"] for r in rows} == {module}, f"过滤失效：{[(r['module']) for r in rows]}"


def test_AC_P4_列表带_summary_必备字段(client, envelope, clean_state):
    items = envelope(client.get("/api/attempts"))["items"]
    assert items, "seed 数据未生效"
    for item in items:
        missing = [k for k in SUMMARY_KEYS if k not in item]
        assert not missing, f"AttemptSummary 缺字段 {missing}（实际键：{sorted(item)}）"
        assert item["module"] in MODULES
        assert is_iso8601(item["created_at"]), f"created_at 应为 ISO-8601：{item['created_at']!r}"


def test_AC_P4_total_是全集计数分页不改它(client, envelope, clean_state):
    full = envelope(client.get("/api/attempts", params={"limit": 200}))
    page1 = envelope(client.get("/api/attempts", params={"limit": 2, "offset": 0}))
    page2 = envelope(client.get("/api/attempts", params={"limit": 2, "offset": 2}))
    assert page1["total"] == page2["total"] == full["total"], "total 应是过滤后的总条数，与分页无关"
    assert full["total"] == len(full["items"]) >= 4
    assert len(page1["items"]) <= 2
    ids1 = {i["id"] for i in page1["items"]}
    ids2 = {i["id"] for i in page2["items"]}
    assert not (ids1 & ids2), f"offset 分页出现重复记录：{ids1 & ids2}"
    for item in page1["items"]:
        assert item.get("band_overall") is None or 0.0 <= float(item["band_overall"]) <= 9.0


def test_AC_G2_详情含_attempt_与_payload(client, envelope, clean_state):
    listed = envelope(client.get("/api/attempts"))["items"]
    target = next(i for i in listed if i["module"] == "listening")
    data = envelope(client.get(f"/api/attempts/{target['id']}"))
    assert {"attempt", "payload"} <= set(data), f"详情应为 {{attempt, payload}}：{sorted(data)}"
    assert data["attempt"]["id"] == target["id"]
    payload = data["payload"]
    assert isinstance(payload, dict) and payload, f"payload 应是完整模块报告：{payload!r}"
    assert "ai_used" in payload and "approximate" in payload, "payload 应带 §0 公共 AI 字段"


def test_FR_G4_未知_id_详情_404(client):
    resp = client.get("/api/attempts/att_不存在的")
    assert resp.status_code == 404
    assert "code" in resp.json()


def test_AC_P4_删除返回_deleted_true_并从列表消失(client, envelope, clean_state):
    listed = envelope(client.get("/api/attempts"))["items"]
    target = next(i for i in listed if i["module"] == "writing")
    data = envelope(client.delete(f"/api/attempts/{target['id']}"))
    assert data == {"deleted": True}, f"删除响应不符契约 §1 行 25：{data!r}"
    remaining = envelope(client.get("/api/attempts"))["items"]
    assert target["id"] not in {i["id"] for i in remaining}
    assert client.get(f"/api/attempts/{target['id']}").status_code == 404


def test_AC_P4_删除后趋势随之重算(client, envelope, clean_state):
    """契约 §1 行 25「（重算趋势）」：趋势必须实时从 attempts 派生，不能有第二份缓存。"""
    before = envelope(client.get("/api/progress/trend", params={"days": 3650}))
    listed = envelope(client.get("/api/attempts"))["items"]
    writing = [i for i in listed if i["module"] == "writing"]
    assert writing, "seed 应带一条写作记录"
    envelope(client.delete(f"/api/attempts/{writing[0]['id']}"))
    after = envelope(client.get("/api/progress/trend", params={"days": 3650}))
    assert after != before or len(before["points"]) == 0, (
        f"删除记录后 /progress/trend 没有任何变化（{before}）—— 说明趋势不是实时派生的"
    )


def test_FR_G4_删除未知_id_返回_404(client):
    resp = client.delete("/api/attempts/att_没有这条")
    assert resp.status_code == 404, f"期望 404，实际 {resp.status_code}"
    assert "code" in resp.json()


@pytest.mark.parametrize("params", [{"module": "speakingx"}, {"limit": 0}, {"offset": -1}])
def test_FR_G4_非法查询参数返回_400(client, params):
    resp = client.get("/api/attempts", params=params)
    assert resp.status_code == 400, f"{params} 应 400，实际 {resp.status_code}：{resp.text[:160]!r}"
    body = resp.json()
    assert "detail" in body and "code" in body, f"错误体应为 {{detail, code}}：{body!r}"
    assert any("\u4e00" <= ch <= "\u9fff" for ch in str(body["detail"])), f"detail 应中文：{body!r}"
