"""练习记录软删 + 回收站 + 统计口径（spec-contracts §14.4）。

这里盯的是两个相反方向的失败：

1. **删得太狠**：用户点「删除」之后进度就永久没了 —— 所以行必须还在库里，
   能列出来、能恢复，连口语录音的归属都不许断（断了就不是可逆）。
2. **删得太轻**：只把记录从列表里藏起来，统计照旧算它 —— 趋势会因一条
   用户在回收站里都看不见的记录长期偏低，等于数据对了但结论错了。
   所以断言全部打在 `progress` / `analytics` 的真实数字上，不是打在「列表里有没有」上。

用例一律用 `own_db`：软删会重算 `practice_minutes`、purge 会真删行，
这些都不该跑在会话共享库上（CONSTITUTION §6）。
"""
from __future__ import annotations

import datetime as _dt
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def own_db(tmp_path, monkeypatch):
    from app.config import settings as cfg
    from app.db import store

    home = tmp_path / "data"
    home.mkdir()
    monkeypatch.setattr(cfg, "DB_PATH", str(home / "app.db"))
    monkeypatch.setattr(store, "_schema_ready", False)
    monkeypatch.setattr(store, "_schema_failed", None)
    return home


@pytest.fixture
def local_client(own_db):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


# ---------------------------------------------------------------------------
# 造数据：直接写库，近 N 天内的时间戳（analytics 的 weeks 窗口要能命中）
# ---------------------------------------------------------------------------

def _utc(days_ago: int = 0) -> str:
    moment = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=days_ago)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _open(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    return conn


def _insert_attempt(db: Path, *, attempt_id: str, module: str, band: float | None,
                    duration_sec: float | None, created_at: str, items: int = 0,
                    turns: int = 0) -> None:
    conn = _open(db)
    try:
        conn.execute(
            "INSERT INTO attempts (id, module, task_ref, duration_sec, band_overall, raw_json, "
            "ai_used, approximate, created_at) VALUES (?, ?, ?, ?, ?, '{}', 0, 0, ?)",
            (attempt_id, module, f"seed_{attempt_id}", duration_sec, band, created_at),
        )
        for index in range(items):
            conn.execute(
                "INSERT INTO attempt_items (attempt_id, item_ref, question_type, correct) "
                "VALUES (?, ?, 'gap_fill', ?)",
                (attempt_id, f"q{index + 1}", 1 if index % 2 == 0 else 0),
            )
        for index in range(turns):
            conn.execute(
                "INSERT INTO speaking_turns (session_id, attempt_id, turn_index, prompt_id, "
                "prompt_text, transcript, confidence, duration_sec, started_at) "
                "VALUES (?, ?, ?, 'q1', 'p', 't', 0.9, 20, ?)",
                (f"sess_{attempt_id}", attempt_id, index, created_at),
            )
        conn.commit()
    finally:
        conn.close()


def _row(db: Path, attempt_id: str) -> sqlite3.Row | None:
    conn = _open(db)
    try:
        return conn.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
    finally:
        conn.close()


def _counts(db: Path) -> dict[str, int]:
    conn = _open(db)
    try:
        return {
            "attempts": conn.execute("SELECT COUNT(*) FROM attempts").fetchone()[0],
            "items": conn.execute("SELECT COUNT(*) FROM attempt_items").fetchone()[0],
            "orphan_turns": conn.execute(
                "SELECT COUNT(*) FROM speaking_turns WHERE attempt_id IS NULL"
            ).fetchone()[0],
        }
    finally:
        conn.close()


def _build(local_client, own_db) -> Path:
    """五科混合的库：听力两条（一条带逐题明细、一条带录音）、阅读/写作/口语各一条。"""
    from app.db import migrate

    db = own_db / "app.db"
    migrate.ensure_schema()
    _insert_attempt(db, attempt_id="att_li_1", module="listening", band=7.0,
                    duration_sec=300, created_at=_utc(1), items=4, turns=2)
    _insert_attempt(db, attempt_id="att_li_2", module="listening", band=6.0,
                    duration_sec=600, created_at=_utc(0))
    _insert_attempt(db, attempt_id="att_re_1", module="reading", band=6.5,
                    duration_sec=500, created_at=_utc(2))
    _insert_attempt(db, attempt_id="att_wr_1", module="writing", band=5.5,
                    duration_sec=900, created_at=_utc(3))
    _insert_attempt(db, attempt_id="att_sp_1", module="speaking", band=6.0,
                    duration_sec=120, created_at=_utc(4))
    return db


def _data(response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()["data"]


# ---------------------------------------------------------------------------
# §14.4：删除只是打标记
# ---------------------------------------------------------------------------

def test_删除后行仍在库里且带上删除时刻(local_client, own_db):
    db = _build(local_client, own_db)
    body = _data(local_client.delete("/api/attempts/att_li_1"))
    assert body["deleted"] is True, f"契约 §1 行 25：{body!r}"

    row = _row(db, "att_li_1")
    assert row is not None, "软删把行真的删掉了 —— 回收站里没有可恢复的东西"
    assert row["deleted_at"], "行还在但没有删除标记，恢复功能无从判断"
    assert row["deleted_at"].endswith(("Z", "+00:00")), f"契约 §0 要 UTC：{row['deleted_at']}"


def test_删除是幂等的(local_client, own_db):
    _build(local_client, own_db)
    first = local_client.delete("/api/attempts/att_re_1")
    again = local_client.delete("/api/attempts/att_re_1")
    assert first.status_code == again.status_code == 200, (again.status_code, again.text)
    assert _data(again)["deleted"] is True


def test_列表与详情都不再出现已删记录(local_client, own_db):
    _build(local_client, own_db)
    local_client.delete("/api/attempts/att_li_1")
    listed = _data(local_client.get("/api/attempts"))
    assert "att_li_1" not in {i["id"] for i in listed["items"]}
    assert listed["total"] == 4, f"total 要跟着排除，否则存档屏的分页数对不上：{listed!r}"
    assert local_client.get("/api/attempts/att_li_1").status_code == 404, (
        "§1 行 24：已删记录的详情仍 404（回收站只给摘要，要看报告得先恢复）"
    )


def test_回收站列出已删记录并带摘要字段(local_client, own_db):
    _build(local_client, own_db)
    local_client.delete("/api/attempts/att_li_1")
    local_client.delete("/api/attempts/att_sp_1")

    body = _data(local_client.get("/api/attempts/trash"))
    assert {"items", "total"} <= set(body), f"列表端点应为 {{items, total}}：{sorted(body)}"
    assert body["total"] == 2
    assert {i["id"] for i in body["items"]} == {"att_li_1", "att_sp_1"}
    for item in body["items"]:
        # 回收站里要点开决定「恢复还是清除」，这几项少了用户就只能凭 id 猜
        for key in ("module", "task_ref", "band_overall", "created_at", "deleted_at"):
            assert key in item, f"回收站行缺 {key}（实际键：{sorted(item)}）"
    assert _data(local_client.get("/api/attempts/trash", params={"module": "listening"}))["total"] == 1


# ---------------------------------------------------------------------------
# §14.4：可逆 —— 恢复后连录音归属都还在
# ---------------------------------------------------------------------------

def test_恢复后回到列表且详情可读(local_client, own_db):
    db = _build(local_client, own_db)
    local_client.delete("/api/attempts/att_li_1")

    body = _data(local_client.post("/api/attempts/att_li_1/restore"))
    assert body["restored"] is True, body

    assert "att_li_1" in {i["id"] for i in _data(local_client.get("/api/attempts"))["items"]}
    assert _data(local_client.get("/api/attempts/trash"))["items"] == []
    assert local_client.get("/api/attempts/att_li_1").status_code == 200
    assert _row(db, "att_li_1")["deleted_at"] is None


def test_恢复不弄断口语录音归属(local_client, own_db):
    db = _build(local_client, own_db)
    before = _row(db, "att_li_1")["id"]
    assert _open(db).execute(
        "SELECT COUNT(*) FROM speaking_turns WHERE attempt_id = ?", (before,)
    ).fetchone()[0] == 2

    local_client.delete("/api/attempts/att_li_1")
    assert _open(db).execute(
        "SELECT COUNT(*) FROM speaking_turns WHERE attempt_id = ?", (before,)
    ).fetchone()[0] == 2, "软删就把录音归属清了 == 恢复回来的记录是半截的"

    local_client.post("/api/attempts/att_li_1/restore")
    assert _open(db).execute(
        "SELECT COUNT(*) FROM speaking_turns WHERE attempt_id = ?", (before,)
    ).fetchone()[0] == 2


def test_恢复未知id返回404_未删过的幂等(local_client, own_db):
    _build(local_client, own_db)
    missing = local_client.post("/api/attempts/att_没有这条/restore")
    assert missing.status_code == 404, missing.text
    assert "code" in missing.json()

    alive = local_client.post("/api/attempts/att_re_1/restore")
    assert alive.status_code == 200, alive.text
    assert "att_re_1" in {i["id"] for i in _data(local_client.get("/api/attempts"))["items"]}


# ---------------------------------------------------------------------------
# §14.4 最致命的一条：所有统计口径必须排除，且恢复后要回来
# ---------------------------------------------------------------------------

def test_删除后各项统计排除恢复后又回来(local_client, own_db):
    _build(local_client, own_db)
    baseline = {
        "summary": _data(local_client.get("/api/progress/summary")),
        "trend": _data(local_client.get("/api/progress/trend", params={"module": "listening", "days": 3650})),
        "analytics": _data(local_client.get("/api/progress/analytics", params={"weeks": 8})),
    }
    assert baseline["summary"]["attempts_total"] == 5
    # 听力只剩 band 6.0 那条之后，当前分与趋势点都要跟着降下来
    local_client.delete("/api/attempts/att_li_1")

    after = _data(local_client.get("/api/progress/summary"))
    assert after["attempts_total"] == 4, f"attempts_total 还数着已删记录：{after!r}"
    assert after["minutes_total"] == round((600 + 500 + 900 + 120) / 60.0, 1), (
        f"minutes_total 没排除已删的 300 秒：{after!r}"
    )
    assert after["current"]["listening"] == 6.0, (
        f"当前分仍取已删那条的 7.0：{after['current']!r}"
    )

    trend = _data(local_client.get("/api/progress/trend", params={"module": "listening", "days": 3650}))
    assert [p["band"] for p in trend["points"]] == [6.0], f"趋势里还带着已删记录：{trend!r}"

    analytics = _data(local_client.get("/api/progress/analytics", params={"weeks": 8}))
    assert analytics["by_question_type"] == [], (
        f"题型正确率仍统计已删 attempt 的逐题明细：{analytics['by_question_type']!r}"
    )
    assert analytics["by_module"] == [], f"分科正确率同样要排除：{analytics['by_module']!r}"

    local_client.post("/api/attempts/att_li_1/restore")
    assert _data(local_client.get("/api/progress/summary")) == baseline["summary"], (
        "恢复后概览没有回到删除前"
    )
    assert _data(local_client.get("/api/progress/analytics", params={"weeks": 8}))["by_question_type"] == \
        baseline["analytics"]["by_question_type"], "恢复后题型正确率没回来"


def test_删除的是最后一条时该科显示为未练过(local_client, own_db):
    _build(local_client, own_db)
    local_client.delete("/api/attempts/att_wr_1")
    current = _data(local_client.get("/api/progress/summary"))["current"]
    assert current["writing"] is None, f"该科已无有效记录，仍显示已删的 5.5：{current!r}"


def test_软删与恢复重算当天练习分钟(local_client, own_db):
    """缓存表 practice_minutes 与统计必须同口径，否则「今日分钟」和「总分钟」互相打脸。"""
    from app.db import store

    db = _build(local_client, own_db)
    day = store.iso_to_local_date(_utc(1))
    assert day, "测试数据的时间戳读不出本地日"
    store.recompute_practice_minutes(day)
    conn = _open(db)
    try:
        row = conn.execute("SELECT minutes, attempts FROM practice_minutes WHERE date = ?", (day,)).fetchone()
    finally:
        conn.close()
    assert row is not None and row["minutes"] == 5.0 and row["attempts"] == 1, f"基线：{row!r}"

    local_client.delete("/api/attempts/att_li_1")
    conn = _open(db)
    try:
        assert conn.execute("SELECT 1 FROM practice_minutes WHERE date = ?", (day,)).fetchone() is None, (
            "当天唯一一条已删，缓存分钟却没重算"
        )
    finally:
        conn.close()

    local_client.post("/api/attempts/att_li_1/restore")
    conn = _open(db)
    try:
        row = conn.execute("SELECT minutes, attempts FROM practice_minutes WHERE date = ?", (day,)).fetchone()
    finally:
        conn.close()
    assert row is not None and row["minutes"] == 5.0, f"恢复后分钟没回来：{row!r}"


def test_今日计划不再排已删的那科(local_client, own_db):
    """plan 从 latest_band_per_module 派生（api/plan.py），软删必须传导到计划里。"""
    _build(local_client, own_db)
    for attempt_id in ("att_li_1", "att_li_2"):
        local_client.delete(f"/api/attempts/{attempt_id}")
    items = _data(local_client.get("/api/plan/today"))["items"]
    assert "listening" not in {i["module"] for i in items}, (
        f"听力两条都删了，今日计划还在给它排任务：{items!r}"
    )


# ---------------------------------------------------------------------------
# purge：不可逆动作必须先有退路
# ---------------------------------------------------------------------------

def test_本机零快照时清除被拒绝且记录还在(local_client, own_db):
    db = _build(local_client, own_db)
    local_client.delete("/api/attempts/att_re_1")
    assert _data(local_client.get("/api/backup"))["items"] == [], "本用例的前提是还没有任何快照"

    response = local_client.delete("/api/attempts/att_re_1/purge")
    assert response.status_code == 409, f"零退路时不该直接清除：{response.status_code} {response.text}"
    body = response.json()
    assert body["code"] == "conflict", body
    assert any("\u4e00" <= ch <= "\u9fff" for ch in body["detail"]), body
    assert "\\" not in body["detail"] and "/" not in body["detail"], f"detail 泄露路径：{body['detail']!r}"
    assert _row(db, "att_re_1") is not None, "拒绝清除却顺手改了库"


def test_有快照后清除真删掉行与逐题明细(local_client, own_db):
    db = _build(local_client, own_db)
    local_client.post("/api/backup")
    local_client.delete("/api/attempts/att_li_1")

    assert _counts(db)["items"] == 4
    body = _data(local_client.delete("/api/attempts/att_li_1/purge"))
    assert body["purged"] is True, body

    counts = _counts(db)
    assert counts["attempts"] == 4 and counts["items"] == 0, (
        f"清除后应只剩其它四条、明细级联清空：{counts!r}"
    )
    assert _data(local_client.get("/api/attempts/trash"))["items"] == []


def test_清除会断开录音归属而软删不会(local_client, own_db):
    db = _build(local_client, own_db)
    local_client.post("/api/backup")
    local_client.delete("/api/attempts/att_li_1")
    assert _counts(db)["orphan_turns"] == 0
    local_client.delete("/api/attempts/att_li_1/purge")
    assert _counts(db)["orphan_turns"] == 2, "行没了但录音还指向它 == 孤儿外键，下次备份恢复会撞约束"


def test_清除未知id返回404_清除未删的也可用(local_client, own_db):
    _build(local_client, own_db)
    local_client.post("/api/backup")
    assert local_client.delete("/api/attempts/att_没有这条/purge").status_code == 404
    assert local_client.delete("/api/attempts/att_sp_1/purge").status_code == 200


# ---------------------------------------------------------------------------
# 迁移 v2：schema.sql 已带这一列，所以 ALTER 必须先查再改
# ---------------------------------------------------------------------------

V1_ATTEMPTS_DDL = """
CREATE TABLE attempts(
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  task_ref TEXT NOT NULL,
  part TEXT,
  started_at TEXT,
  duration_sec REAL,
  band_overall REAL,
  band_sub_json TEXT,
  raw_json TEXT,
  ai_used INTEGER,
  degraded_reason TEXT,
  approximate INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)
"""


def _columns(db: Path, table: str) -> set[str]:
    conn = _open(db)
    try:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    finally:
        conn.close()


def _indexes(db: Path) -> set[str]:
    conn = _open(db)
    try:
        return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
    finally:
        conn.close()


def _user_version(db: Path) -> int:
    conn = _open(db)
    try:
        return int(conn.execute("PRAGMA user_version").fetchone()[0])
    finally:
        conn.close()


def test_新库建好就带deleted_at且版本到位(own_db):
    """§14.2/§14.4：新库由 schema.sql 直接带列，迁移步骤必须不撞 duplicate column。"""
    from app.db import migrate, store

    migrate.ensure_schema()
    db = own_db / "app.db"
    assert "deleted_at" in _columns(db, "attempts")
    assert "idx_attempts_deleted" in _indexes(db), "索引由迁移步骤建，新库也要跑到"
    assert _user_version(db) == store.SCHEMA_VERSION == 2


def test_老库升级到v2加列且记录一条不少(own_db):
    """v1 结构 + user_version=1 的库：升级后要能软删，且练习记录不能动过。"""
    from app.db import migrate

    db = own_db / "app.db"
    conn = _open(db)
    with conn:
        conn.execute(V1_ATTEMPTS_DDL)
        conn.execute(
            "INSERT INTO attempts (id, module, task_ref, band_overall, created_at) "
            "VALUES ('att_v1_old', 'reading', 'r1', 6.0, '2026-01-01T00:00:00Z')"
        )
        conn.execute("PRAGMA user_version = 1")
    conn.close()
    assert "deleted_at" not in _columns(db, "attempts")

    migrate.ensure_schema()

    assert _user_version(db) == 2
    assert "deleted_at" in _columns(db, "attempts")
    assert "idx_attempts_deleted" in _indexes(db), (
        "索引写在 schema.sql 会让老库升级当场断掉（它跑在迁移之前），必须由步骤补建"
    )
    assert {r[0] for r in _open(db).execute("SELECT id FROM attempts").fetchall()} == {"att_v1_old"}, (
        "结构升级弄丢了老记录"
    )
    snaps = sorted((own_db / "backups").glob("app.*.sqlite"))
    assert snaps, "改结构前没有留快照（§14.3）"


def test_v2步骤重复执行不报错(own_db):
    """步骤可能对「schema.sql 已建列」的新库再跑一次；不能因 duplicate column 崩。"""
    from app.db import migrate, migrations

    migrate.ensure_schema()
    db = own_db / "app.db"
    step = next(s for s in migrations.MIGRATIONS if s.version == 2)
    conn = _open(db)
    try:
        conn.isolation_level = None
        conn.execute("BEGIN IMMEDIATE")
        step.apply(conn)
        conn.execute("COMMIT")
    finally:
        conn.close()
    assert "deleted_at" in _columns(db, "attempts")


def test_升级后删除端点立即可用(local_client, own_db):
    """列是新库建的，软删写它时必须已经有列 —— 这条串起迁移与端点。"""
    db = _build(local_client, own_db)
    assert _data(local_client.delete("/api/attempts/att_sp_1"))["deleted"] is True
    assert _row(db, "att_sp_1")["deleted_at"]
