"""存储层失败必须可见（spec-contracts §14.6）。

三条不变式，按「用户会怎么受伤」排序：
1. 库坏了**不许**顺手删掉重建 —— 损坏的库比没有库有价值得多（§14.1 同源）。
   所以本文件最关键的一条是 `test_启动遇到损坏库_不删不重建且照常起来`：
   它同时钉住「文件字节没变」和「服务还起得来」。
2. 写不进去时必须明确告诉用户「这次操作没保存」，而不是笼统的「内部错误」——
   后者会让人以为重试有用，而磁盘满时重试一万次也没用。
3. 只读降级期间读还得能读（用户至少要看得到自己以前的记录）。

破坏性用例一律 `own_db` / tmp_path，绝不碰会话共享库与真实学习库（CONSTITUTION §6）。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import common
from app.db import store

ESSAY = "In recent years, an increasing number of people work from home."
REASON = "学习库文件读不出：不是有效的数据库文件"


@pytest.fixture
def own_db(tmp_path, monkeypatch):
    """本测试独占的库 + 清掉 store 的结构缓存与只读闩。"""
    from app.config import settings as cfg

    home = tmp_path / "data"
    home.mkdir()
    monkeypatch.setattr(cfg, "DB_PATH", str(home / "app.db"))
    monkeypatch.setattr(store, "_schema_ready", False)
    monkeypatch.setattr(store, "_schema_failed", None)
    store.clear_storage_readonly()
    yield home
    store.clear_storage_readonly()


@pytest.fixture
def seeded_db(own_db):
    """先把建表链跑完，后续请求才是在「有库但坏了」的场景上。"""
    store.connect().close()
    return own_db


@pytest.fixture
def local_client(own_db):
    """不套上下文管理器 == 不跑 lifespan。"""
    from app.main import app

    return TestClient(app)


def _db(home: Path) -> Path:
    return home / "app.db"


def _break_table(home: Path, table: str, alias: str) -> None:
    """在线把某张表改名 —— 真实触发 `no such table`，而不是 mock 一个异常。"""
    conn = sqlite3.connect(str(_db(home)))
    conn.execute(f"ALTER TABLE {table} RENAME TO {alias}")
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# 1. quick_check：坏库只报告，不动手
# ---------------------------------------------------------------------------


def test_健康库_quick_check_通过(seeded_db):
    report = store.quick_check()
    assert report["ok"] is True, report
    assert report["absent"] is False
    assert report["reason"] is None


def test_库文件还不存在时不算故障(own_db):
    """新装机器上「还没有库」不是损坏，不能因此把 app 打成只读。"""
    report = store.quick_check()
    assert report["absent"] is True
    assert report["ok"] is True


def test_坏库_quick_check_不通过且原因可读(own_db):
    _db(own_db).write_bytes(b"this is definitely not a sqlite file" * 40)
    report = store.quick_check()
    assert report["ok"] is False, report
    assert report["reason"], "报告了不通过却没给原因，界面就无法解释"
    assert str(own_db) not in report["reason"], "原因里不许带路径（CONSTITUTION §3）"


def test_quick_check_不创建也不改动文件(own_db):
    db = _db(own_db)
    db.write_bytes(b"garbage" * 500)
    before = db.read_bytes()
    store.quick_check()
    assert db.read_bytes() == before, "只是体检一下，却把用户的文件改了"
    assert db.stat().st_size == len(before)


def test_启动遇到损坏库_不删不重建且照常起来(own_db):
    """§14.6 最硬的一条：损坏 → 只读降级，不是「删了重开」。"""
    from app.main import app

    db = _db(own_db)
    db.write_bytes(b"\x00\x00 not a database \x00\x00" * 300)
    before = db.read_bytes()

    with TestClient(app) as client:
        assert db.read_bytes() == before, "启动把损坏的库改掉/重建了 —— 用户连手工救数据的机会都没了"
        health = client.get("/api/health").json()["data"]
        assert health["storage"]["state"] == "readonly", health["storage"]
        assert health["storage"]["reason"], "降级了却没说原因"
    assert store.storage_state()["state"] == "readonly"


def test_降级期间不跑迁移也不拍快照(own_db, monkeypatch):
    """半损坏的库上跑 ALTER 只会更坏；快照还会把坏结构复制进 backups/。"""
    from app.db import backup, migrate
    from app.main import app

    _db(own_db).write_bytes(b"corrupt" * 400)
    calls = {"migrate": 0, "snapshot": 0}
    real_run, real_snap = migrate.run, backup.startup_snapshot_if_stale
    monkeypatch.setattr(migrate, "run", lambda *a, **k: (calls.__setitem__("migrate", calls["migrate"] + 1), real_run(*a, **k))[1])
    monkeypatch.setattr(
        backup,
        "startup_snapshot_if_stale",
        lambda *a, **k: (calls.__setitem__("snapshot", calls["snapshot"] + 1), real_snap(*a, **k))[1],
    )
    with TestClient(app):
        pass
    assert calls["migrate"] == 0, "只读降级还去跑迁移，等于在坏库上继续动结构"
    assert calls["snapshot"] == 0, "只读降级还去拍快照，等于把坏库复制成 N 份"


# ---------------------------------------------------------------------------
# 2. 只读降级：写必须被挡住，读还得能用
# ---------------------------------------------------------------------------


def test_只读闩住后写请求_503_带机器码(local_client):
    store.set_storage_readonly(REASON)
    resp = local_client.put("/api/drafts/writing_task2", json={"value": ESSAY})
    assert resp.status_code == 503, resp.text
    body = resp.json()
    assert body["code"] == "storage_readonly", body
    assert "保存" in body["detail"], body
    assert ".db" not in body["detail"] and "drafts/" not in body["detail"], body


def test_只读闩住后读请求仍然可用(local_client, seeded_db):
    store.set_storage_readonly("磁盘写入被拒绝")
    assert local_client.get("/api/health").status_code == 200
    assert local_client.get("/api/attempts", params={"limit": 5}).status_code == 200


def test_解除只读后写请求恢复(local_client, seeded_db):
    store.set_storage_readonly("磁盘写入被拒绝")
    assert local_client.put("/api/drafts/writing_task2", json={"value": ESSAY}).status_code == 503
    store.clear_storage_readonly()
    assert local_client.put("/api/drafts/writing_task2", json={"value": ESSAY}).status_code == 200


def test_只读拒绝的写没有落库(own_db, seeded_db):
    from app.main import app

    store.set_storage_readonly("磁盘已满")
    client = TestClient(app)
    resp = client.put("/api/drafts/writing_task2", json={"value": ESSAY})
    assert resp.status_code == 503
    store.clear_storage_readonly()
    conn = sqlite3.connect(str(_db(own_db)))
    try:
        assert conn.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 0, "被拒绝的写还是进了库"
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 3. sqlite 异常必须映射成 storage_unavailable，且不外泄细节
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("message", "needle"),
    [
        ("disk I/O error", "学习库"),
        ("attempt to write a readonly database", "只读"),
        ("database is locked", "占用"),
        ("no such table: drafts", "结构"),
    ],
)
def test_sqlite_错误分类文案(message, needle):
    """分类而不是原样抛出：detail 里不许出现 SQL 片段与表名（CONSTITUTION §3）。"""
    detail = common.storage_error_detail(sqlite3.OperationalError(message))
    assert needle in detail, detail
    assert message not in detail, detail
    assert detail.endswith("。")


def test_未分类的sqlite错误也有兜底文案():
    detail = common.storage_error_detail(sqlite3.DatabaseError("file is not a database"))
    assert "学习库" in detail
    assert "Traceback" not in detail and "sqlite3." not in detail


def test_库结构缺表时端点返回_storage_unavailable(local_client, seeded_db):
    """真跑一遍：把表改名，让请求撞上 no such table，看用户拿到什么。"""
    _break_table(seeded_db, "drafts", "drafts_hidden")
    resp = local_client.get("/api/drafts/writing_task2")
    assert resp.status_code == 500, resp.text
    body = resp.json()
    assert body["code"] == "storage_unavailable", body
    assert "结构" in body["detail"], body
    assert str(seeded_db) not in body["detail"] and "SELECT" not in body["detail"].upper()


def test_缺表故障会顺手降级成只读(local_client, seeded_db):
    """结构不完整时继续写只会把库越写越坏，所以闩成只读。"""
    _break_table(seeded_db, "drafts", "drafts_hidden")
    assert local_client.get("/api/drafts/writing_task2").status_code == 500
    assert store.storage_state()["state"] == "readonly"
    assert local_client.put("/api/drafts/writing_task2", json={"value": ESSAY}).status_code == 503


def test_降级期间读请求也不许重建库(own_db):
    """7f 实拍抓到的真缺陷：启动只读闩住之后，请求路径上的 `ensure_schema()` 照样跑了迁移链，
    而迁移的坏库分支会把残损文件改名成 `app.db.corrupt.<ts>.bak` 再建一个空库 ——
    用户看到的是「一切正常，只是没有数据」，真相是他的库被动过。§14.6 说不许重建就是不许。"""
    from app.main import app

    db = _db(own_db)
    db.write_bytes(b"\x00\x00 not a database \x00\x00" * 300)
    before = db.read_bytes()

    with TestClient(app) as client:
        resp = client.get("/api/attempts")
        assert resp.status_code == 500, resp.text
        assert resp.json()["code"] == "storage_unavailable", resp.json()
        assert db.read_bytes() == before, "读请求把损坏的库重建了"
        assert not list(own_db.glob("*.bak")), f"残损文件被改名搬走了: {[p.name for p in own_db.iterdir()]}"


def test_health_一直带存储状态(local_client):
    assert local_client.get("/api/health").json()["data"]["storage"] == {"state": "ok", "reason": None}


def test_结构未就绪时_health_仍然可读(local_client, seeded_db):
    """体检端点自己 500 的话，故障时正好把「到底怎么了」藏起来（§14.6）。"""
    store.mark_schema_failed("学习库结构升级失败")
    resp = local_client.get("/api/health")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["content_counts"] == {m: 0 for m in store.MODULES}, data
    assert data["storage"]["state"] == "ok"
