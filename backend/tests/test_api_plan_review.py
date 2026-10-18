"""L3 API 契约：今日计划与错题本（契约 §1 行 29–33；FR-P2 / AC-P2 / FR-V2 / AC-V2 / AC-X1）。

覆盖 AC：AC-P2（今日任务按薄弱程度分配、可勾选完成、同一输入两次输出一致）、
        AC-V2（错题本能列、能标「已掌握」、能删）、AC-X1（旧「连续 3 次 80 分自动掌握」不再影响错题本）、
        FR-G4（未知 id → 404 + {detail, code}）。
"""
from __future__ import annotations

from _api_helpers import MODULES, is_iso8601, seed_review_item

PLAN_KEYS = {"id", "module", "set_ref", "reason_zh", "done"}
REVIEW_KEYS = {"id", "module", "question_type", "quote", "status", "seen_count", "last_seen_at", "error_type"}


# --------------------------------------------------------------------------
# /plan/today（契约 §1 行 29–30）
# --------------------------------------------------------------------------
def test_AC_P2_今日计划字段齐全(client, envelope):
    data = envelope(client.get("/api/plan/today"))
    assert {"items", "generated_at"} <= set(data), f"响应应为 {{items, generated_at}}：{sorted(data)}"
    assert is_iso8601(data["generated_at"]), f"generated_at 应为 ISO-8601：{data['generated_at']!r}"
    for task in data["items"]:
        missing = [k for k in PLAN_KEYS if k not in task]
        assert not missing, f"PlanTask 缺字段 {missing}（实际键：{sorted(task)}）"
        assert task["module"] in MODULES, f"plan 任务科目非法：{task!r}"
        assert isinstance(task["done"], bool)
        assert str(task["id"]).strip(), f"任务 id 不能为空：{task!r}"


def test_AC_P2_计划任务有中文理由(client, envelope):
    items = envelope(client.get("/api/plan/today"))["items"]
    assert items, "题库已就绪却没有任何今日任务（计划引擎空转）"
    for task in items:
        text = str(task["reason_zh"])
        assert text.strip(), f"reason_zh 不能为空：{task!r}"
        assert any("\u4e00" <= ch <= "\u9fff" for ch in text), f"reason_zh 应是简体中文：{task!r}"


def test_AC_P2_同一输入两次计划一致(client, envelope):
    """FR-P2 的确定性要求：同一天、同 settings、同 attempts ⇒ 同任务集合（generated_at 除外）。"""
    first = envelope(client.get("/api/plan/today"))["items"]
    second = envelope(client.get("/api/plan/today"))["items"]
    assert [t["id"] for t in first] == [t["id"] for t in second], "两次生成的任务集合不稳定（计划引擎含随机性）"
    assert [t["set_ref"] for t in first] == [t["set_ref"] for t in second]


def test_AC_P2_计划只指向题库里真实存在的_set(client, envelope, conn):
    ids = {row[0] for row in conn.execute("SELECT id FROM sets")}
    for task in envelope(client.get("/api/plan/today"))["items"]:
        assert task["set_ref"] in ids, f"计划任务的 set_ref 不在题库里：{task!r}"


def test_AC_P2_未练过的科目优先拿到名额(client, envelope, conn):
    """四科都没练过、目标分拉满时，计划必须覆盖多科（而不是把 5 个名额全给同一科）。"""
    conn.execute("DELETE FROM attempts")
    conn.execute("DELETE FROM plan_tasks")
    conn.commit()
    client.patch("/api/settings", json={"target_band": 9.0, "daily_goal_minutes": 60})
    modules = {t["module"] for t in envelope(client.get("/api/plan/today"))["items"]}
    assert len(modules) >= 2, f"目标 9.0 且四科都未练，计划却只覆盖 {modules}"


def test_AC_P2_勾选完成后状态回显(client, envelope):
    items = envelope(client.get("/api/plan/today"))["items"]
    assert items, "计划里没有可勾选的任务"
    task = items[0]
    data = envelope(client.post(f"/api/plan/{task['id']}/done", json={"done": True}))
    assert data.get("ok") is True, f"勾选响应不符契约 §1 行 30：{data!r}"
    after = envelope(client.get("/api/plan/today"))["items"]
    marked = next((t for t in after if t["id"] == task["id"]), None)
    assert marked is not None, f"勾选后任务从今日计划里消失：{task['id']}"
    assert marked["done"] is True, f"done 状态没有回显：{marked!r}"


def test_AC_P2_取消勾选(client, envelope):
    task = envelope(client.get("/api/plan/today"))["items"][0]
    client.post(f"/api/plan/{task['id']}/done", json={"done": True})
    envelope(client.post(f"/api/plan/{task['id']}/done", json={"done": False}))
    after = envelope(client.get("/api/plan/today"))["items"]
    assert next(t for t in after if t["id"] == task["id"])["done"] is False


def test_FR_G4_勾选未知任务_404(client):
    resp = client.post("/api/plan/pt_不存在_1/done", json={"done": True})
    assert resp.status_code == 404, f"未知任务应 404，实际 {resp.status_code}：{resp.text[:160]!r}"
    assert "code" in resp.json()


def test_FR_G4_勾选缺_done_字段_400(client, envelope):
    items = envelope(client.get("/api/plan/today"))["items"]
    assert items, "计划为空，无法验证 400 分支"
    resp = client.post(f"/api/plan/{items[0]['id']}/done", json={})
    assert resp.status_code == 400, f"缺 done 字段应 400，实际 {resp.status_code}：{resp.text[:160]!r}"
    assert "code" in resp.json()


# --------------------------------------------------------------------------
# /review/errors（契约 §1 行 31–33）
# --------------------------------------------------------------------------
def _seed_review(conn, *, item_id: str, module: str, error_type: str, status: str = "open") -> None:
    seed_review_item(
        conn,
        id=item_id,
        module=module,
        error_type=error_type,
        status=status,
        quote="The museum opens at 10:00",
        detail_zh="答案与原文不一致",
        seen_count=3,
    )


def test_AC_V2_错题本空态返回空数组(client, envelope):
    data = envelope(client.get("/api/review/errors"))
    assert data["items"] == [], f"空库应返回空列表：{data!r}"


def test_AC_V2_错题条目字段齐全(client, envelope, conn):
    _seed_review(conn, item_id="rv_t_1", module="listening", error_type="spelling")
    items = envelope(client.get("/api/review/errors"))["items"]
    assert items, "写入错题后列表为空"
    for row in items:
        missing = [k for k in REVIEW_KEYS if k not in row]
        assert not missing, f"ReviewItem 缺字段 {missing}（实际键：{sorted(row)}）"
        assert row["status"] in ("open", "resolved")
        assert int(row["seen_count"]) >= 1, f"重复错题应累加 seen_count：{row!r}"
        assert is_iso8601(row["last_seen_at"])


def test_AC_V2_按_module_与_status_过滤(client, envelope, conn):
    _seed_review(conn, item_id="rv_t_li", module="listening", error_type="spelling")
    _seed_review(conn, item_id="rv_t_wr", module="writing", error_type="grammar")
    _seed_review(conn, item_id="rv_t_done", module="reading", error_type="tense", status="resolved")
    only_writing = envelope(client.get("/api/review/errors", params={"module": "writing"}))["items"]
    assert {i["module"] for i in only_writing} == {"writing"}, f"module 过滤失效：{only_writing!r}"
    by_type = envelope(client.get("/api/review/errors", params={"error_type": "grammar"}))["items"]
    assert {i["error_type"] for i in by_type} == {"grammar"}, f"error_type 过滤失效：{by_type!r}"
    default = envelope(client.get("/api/review/errors"))["items"]
    assert "rv_t_done" not in {i["id"] for i in default}, f"默认应只显示未掌握错题：{[i['id'] for i in default]}"
    resolved = envelope(client.get("/api/review/errors", params={"status": "resolved"}))["items"]
    assert "rv_t_done" in {i["id"] for i in resolved}
    everything = envelope(client.get("/api/review/errors", params={"status": "all"}))["items"]
    assert len(everything) >= 3


def test_AC_V2_标记已掌握(client, envelope, conn):
    _seed_review(conn, item_id="rv_t_resolve", module="listening", error_type="spelling")
    data = envelope(client.post("/api/review/rv_t_resolve/resolve"))
    assert data.get("status") == "resolved", f"响应应为 {{status: resolved}}：{data!r}"
    after = envelope(client.get("/api/review/errors"))["items"]
    assert "rv_t_resolve" not in {i["id"] for i in after}, "标记后不该仍出现在未掌握列表"


def test_AC_V2_删除错题(client, envelope, conn):
    _seed_review(conn, item_id="rv_t_delete", module="writing", error_type="article")
    data = envelope(client.delete("/api/review/rv_t_delete"))
    assert data.get("deleted") is True
    after = envelope(client.get("/api/review/errors", params={"status": "all"}))["items"]
    assert "rv_t_delete" not in {i["id"] for i in after}


def test_FR_G4_未知错题_404(client):
    for resp in (client.post("/api/review/rv_不存在/resolve"), client.delete("/api/review/rv_不存在")):
        assert resp.status_code == 404, f"未知错题应 404，实际 {resp.status_code}"
        assert "code" in resp.json(), f"错误体缺机器码：{resp.text[:160]!r}"


def test_FR_G4_非法_status_过滤_400(client):
    resp = client.get("/api/review/errors", params={"status": "archived"})
    assert resp.status_code == 400, f"非法 status 应 400，实际 {resp.status_code}"
    assert "code" in resp.json()
