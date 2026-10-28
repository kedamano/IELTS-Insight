"""快照 / 备份 / 恢复测试（spec-contracts §14.3）。

一份备份的价值只有一个判定标准：**恢复的那一天它能不能读出来**。
所以这里不看「文件在不在」，全部把快照当数据库打开、把里面的练习记录读回来。

另外三条是这个功能真正危险的地方：
- restore 会覆盖当前库，动手之前必须先给当前状态留一份 `pre-restore`（§14.3）；
- 快照名字来自用户请求的 URL，不校验就是路径穿越（`../../`）；
- 备份会占磁盘，轮转只准删 `backups/` 里我们自己造的副本，`app.db` 旁边的归档永不碰。

每个用例都用 `own_db` 把库指到自己的 tmp 目录：restore 是破坏性动作，
绝不能跑在会话共享的测试库上，更不能跑在真实学习库上（CONSTITUTION §6）。
"""
from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path

import pytest


@pytest.fixture
def own_db(tmp_path, monkeypatch):
    """本测试独占的库 + 挡住 store 的建表缓存（不碰会话共享库）。"""
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
    """打请求用的 TestClient；不套上下文管理器 == 不跑 lifespan（除接线用例）。"""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def _open(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_attempt(db: Path, attempt_id: str, band: float = 6.5) -> None:
    conn = _open(db)
    try:
        conn.execute(
            "INSERT INTO attempts (id, module, task_ref, band_overall, created_at) "
            "VALUES (?, 'reading', ?, ?, '2026-01-01T00:00:00Z')",
            (attempt_id, f"seed_{attempt_id}", band),
        )
        conn.commit()
    finally:
        conn.close()


def _attempt_ids(db: Path) -> set[str]:
    conn = _open(db)
    try:
        return {row[0] for row in conn.execute("SELECT id FROM attempts").fetchall()}
    finally:
        conn.close()


def _snapshot_paths(home: Path) -> list[Path]:
    backups = home / "backups"
    return sorted(backups.glob("app.*.sqlite")) if backups.is_dir() else []


def _items(response) -> list[dict]:
    assert response.status_code == 200, response.text
    body = response.json()["data"]
    assert "items" in body, f"列表端点缺 items（契约 §1）：{list(body)}"
    return body["items"]


# ---------------------------------------------------------------------------
# GET /api/backup
# ---------------------------------------------------------------------------

def test_还没有过快照时列表是空的(local_client, own_db):
    from app.db import migrate

    migrate.ensure_schema()
    body = local_client.get("/api/backup").json()["data"]
    assert body["items"] == []
    assert body["keep"] > 0, "列表要说明轮转上限，用户才知道手里有多少份历史"


def test_手动快照进列表且字段够设置屏用(local_client, own_db):
    """设置屏要显示名字 / 大小 / 时刻 / 是不是升级前留的 —— 少一项就是一句没法核对的话。"""
    from app.db import migrate

    db = own_db / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_before")

    created = local_client.post("/api/backup").json()["data"]["name"]
    items = _items(local_client.get("/api/backup"))
    assert [i["name"] for i in items] == [created]
    row = items[0]
    assert row["size_bytes"] > 0, "快照大小为 0 == 一份没内容的文件，比没有更危险"
    assert row["created_at"].endswith(("Z", "+00:00")), f"契约 §0 要 UTC：{row['created_at']}"
    assert row["tag"] == "manual"
    assert row["pre_upgrade"] is False


# ---------------------------------------------------------------------------
# POST /api/backup/{name}/restore
# ---------------------------------------------------------------------------

def test_恢复真能把数据拉回快照时刻(local_client, own_db):
    """这是整份备份功能的验收标准：快照不是文件清单，是能读回来的库。"""
    from app.db import migrate

    db = own_db / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_kept")

    name = local_client.post("/api/backup").json()["data"]["name"]

    _seed_attempt(db, "att_after")
    assert _attempt_ids(db) == {"att_kept", "att_after"}

    response = local_client.post(f"/api/backup/{name}/restore")
    assert response.status_code == 200, response.text
    assert _attempt_ids(db) == {"att_kept"}, "恢复后当前库没回到快照时刻"

    # 通过 API 读回来确认（恢复的不只是一个文件，而是 app 正在用的那个库）
    listed = local_client.get("/api/attempts").json()["data"]["items"]
    assert {row["id"] for row in listed} == {"att_kept"}


def test_恢复前必须先把当前状态快照一份(local_client, own_db):
    """§14.3：恢复本身是破坏性动作 —— 选错快照不该导致当前进度无处可回。"""
    from app.db import migrate

    db = own_db / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_old")
    old = local_client.post("/api/backup").json()["data"]["name"]

    _seed_attempt(db, "att_current")
    response = local_client.post(f"/api/backup/{old}/restore")
    assert response.status_code == 200, response.text

    tags = {item["tag"] for item in _items(local_client.get("/api/backup"))}
    assert "pre-restore" in tags, "直接覆盖当前库、没有留恢复前的副本"
    pre_restore = next(p for p in _snapshot_paths(own_db) if ".pre-restore." in p.name)
    assert "att_current" in _attempt_ids(pre_restore), "pre-restore 副本里读不出恢复前的记录"


def test_恢复不存在的快照返回404(local_client, own_db):
    from app.db import migrate

    migrate.ensure_schema()
    response = local_client.post("/api/backup/app.manual.19700101T000000.sqlite/restore")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


@pytest.mark.parametrize(
    "name",
    [
        "../app.db",
        "..\\app.db",
        "app.manual.20260101T000000.sqlite/../../app.db",
        "/absolute/path/app.sqlite",
        "D:\\tmp\\other.sqlite",
        "not-a-snapshot.txt",
        "app.sqlite",
    ],
)
def test_恢复只准点名backups目录里的快照(local_client, own_db, name):
    """名字来自 URL：不校验等于把「覆盖本机任意文件」交给一个字符串（§14.1 的越界版）。"""
    from app.db import migrate

    db = own_db / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_safe")
    before = db.read_bytes()

    response = local_client.post(f"/api/backup/{name}/restore")
    assert response.status_code in (400, 404), f"非法名字没有被拒绝：{response.status_code} {response.text}"
    assert _attempt_ids(db) == {"att_safe"}, "非法名字顺手改动了当前库"
    assert db.read_bytes() == before


def test_非法名字的报错不含文件路径(local_client, own_db):
    """CONSTITUTION §3 同源：detail 给人看，不泄露本机目录结构。"""
    from app.db import migrate

    migrate.ensure_schema()
    response = local_client.post("/api/backup/../../etc/passwd/restore")
    assert response.status_code in (400, 404), response.status_code
    detail = response.json()["detail"]
    assert "\\" not in detail and "/" not in detail, detail


# ---------------------------------------------------------------------------
# 轮转
# ---------------------------------------------------------------------------

def test_轮转只保留最近十份(own_db):
    """快照会吃磁盘；上限是契约值（10），而且被删的只能是我们造的副本。"""
    from app.db import backup, migrate

    keep = backup.KEEP
    db = own_db / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_first")

    conn = _open(db)
    try:
        for _ in range(keep + 3):
            backup.snapshot(conn, tag="manual")
            time.sleep(0.002)  # 让 mtime 有先后，轮转才有「最近」可言
    finally:
        conn.close()

    remaining = _snapshot_paths(own_db)
    assert len(remaining) == keep, f"轮转后应剩 {keep} 份，实际 {len(remaining)}"
    for path in remaining:
        assert "att_first" in _attempt_ids(path), f"轮转留下来的快照读不出数据：{path.name}"
    assert (own_db / "app.db").exists(), "轮转把手上的原库删了"


def test_轮转不碰app_db旁边的归档副本(own_db):
    """§14.1：归档副本是用户的原文件，轮转的作用域只有 backups/。"""
    from app.db import backup, migrate

    db = own_db / "app.db"
    migrate.ensure_schema()
    archive = backup.unique_target(own_db, "app.db.pre-ielts")
    archive.write_bytes(b"legacy payload must survive")

    conn = _open(db)
    try:
        for _ in range(backup.KEEP + 5):
            backup.snapshot(conn, tag="manual")
            time.sleep(0.002)
    finally:
        conn.close()

    assert archive.exists(), "轮转越界删掉了 backups/ 之外的归档副本"
    assert len(_snapshot_paths(own_db)) == backup.KEEP


# ---------------------------------------------------------------------------
# 启动补拍（§14.3：距上次成功快照 > 7 天）
# ---------------------------------------------------------------------------

def test_快照过期才补拍_没过期就不动(own_db, monkeypatch):
    from app.db import backup, migrate

    db = own_db / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_x")

    assert backup.startup_snapshot_if_stale(fresh=False) is not None, "一次快照都没有就该补"
    first = len(_snapshot_paths(own_db))
    assert backup.startup_snapshot_if_stale(fresh=False) is None, "刚拍完又拍一次"
    assert len(_snapshot_paths(own_db)) == first

    # 把最新一份的 mtime 推到 8 天前
    newest = max(_snapshot_paths(own_db), key=os.path.getmtime)
    old = time.time() - 8 * 86400
    os.utime(newest, (old, old))
    assert backup.startup_snapshot_if_stale(fresh=False) is not None, "超过 7 天没有补拍"
    assert len(_snapshot_paths(own_db)) == first + 1


def test_首启新建的空库不该急着快照(own_db):
    """库里还没有任何东西，拍一份只是给 backups 添噪声（也让 pre-upgrade 标记失真）。"""
    from app.db import backup, migrate

    db = own_db / "app.db"
    assert not db.exists()
    migrate.ensure_schema()
    assert backup.startup_snapshot_if_stale(fresh=True) is None
    assert _snapshot_paths(own_db) == []


def test_启动接线_lifespan真的会补拍一份(own_db):
    """端点与 helper 都对但没人调用 == 用户永远只有升级前那一份。这里跑真实 lifespan。"""
    from fastapi.testclient import TestClient

    from app.db import migrate
    from app.main import app

    db = own_db / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_live")
    assert _snapshot_paths(own_db) == []

    with TestClient(app):  # 进 lifespan：migrate.run() + 启动补拍
        pass

    tags = {p.name.split(".")[1] for p in _snapshot_paths(own_db)}
    assert "startup" in tags, f"lifespan 没有调用启动补拍，实际：{sorted(p.name for p in _snapshot_paths(own_db))}"
    newest = max(_snapshot_paths(own_db), key=os.path.getmtime)
    assert "att_live" in _attempt_ids(newest)
