"""schema 版本与增量迁移测试（spec-contracts §14.2）。

这些用例测的不是「功能对不对」，而是**结构变更会不会把学习库改成半截**。
核心三条：

1. 库里的版本（`PRAGMA user_version`）就是真相，新库一建好就该等于 `store.SCHEMA_VERSION`；
2. 升级前必须先有一份能读回来的在线快照（§14.3），且只在真的要改结构时做一次；
3. 某一步失败 → 那一步的 DDL 一起回滚、`user_version` 保持原值、API 明确返回
   `schema_upgrade_failed`。**半迁移状态禁止继续跑**（§14.2 最后一条）。

用例一律用「真实迁移表再往上一格」的版本号造步骤，不写死 2 ——
`MIGRATIONS` 会长出真步骤（§14.4 的 `attempts.deleted_at` 就是第一个），写死的测试会跟着一起烂。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterable

import pytest

STEP_NAME = "加探针列"


@pytest.fixture
def db_home(tmp_path, monkeypatch):
    """本测试专属的空目录 + 挡住 store 的懒建表缓存（与 test_migrate_safety 同一套路）。"""
    from app.config import settings as cfg
    from app.db import store

    home = tmp_path / "data"
    home.mkdir()
    monkeypatch.setattr(cfg, "DB_PATH", str(home / "app.db"))
    monkeypatch.setattr(store, "_schema_ready", True)
    return home


# ---------------------------------------------------------------------------
# 裸 sqlite 读回（断言的是磁盘上的真相，不是某个 helper 的返回值）
# ---------------------------------------------------------------------------

def _open(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    return conn


def _user_version(db: Path) -> int:
    conn = _open(db)
    try:
        return int(conn.execute("PRAGMA user_version").fetchone()[0])
    finally:
        conn.close()


def _set_user_version(db: Path, value: int) -> None:
    conn = _open(db)
    try:
        conn.execute(f"PRAGMA user_version = {int(value)}")  # noqa: S608 - 测试内固定整数
        conn.commit()
    finally:
        conn.close()


def _columns(db: Path, table: str) -> set[str]:
    conn = _open(db)
    try:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    finally:
        conn.close()


def _seed_attempt(db: Path, attempt_id: str) -> None:
    conn = _open(db)
    try:
        conn.execute(
            "INSERT INTO attempts (id, module, task_ref, band_overall, created_at) "
            "VALUES (?, 'reading', ?, 6.5, '2026-01-01T00:00:00Z')",
            (attempt_id, f"seed_{attempt_id}"),
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


def _snapshot_files(home: Path) -> list[Path]:
    backups = home / "backups"
    return sorted(backups.glob("app.*.sqlite")) if backups.is_dir() else []


# ---------------------------------------------------------------------------
# 可控的迁移步骤（造一次「真实的结构变更」）
# ---------------------------------------------------------------------------

def _next_version() -> int:
    """真迁移表顶再往上一格：与未来新增的真步骤永远不撞号。"""
    from app.db import store

    return int(store.SCHEMA_VERSION) + 1


def _probe_step(applied: list[int], version: int, *, name: str = STEP_NAME) -> Any:
    from app.db import migrations

    def apply(conn: sqlite3.Connection) -> None:
        conn.execute("ALTER TABLE attempts ADD COLUMN probe TEXT")
        applied.append(version)

    return migrations.Step(version, name, apply)


def _boom_step(version: int) -> Any:
    """模拟「结构改到一半才炸」：ALTER 已经执行，后面才失败。

    这一步是整个契约里最凶的形态 —— ALTER 在 SQLite 里是会提交的，
    步骤没有自己的事务时，失败后库里就多出 probe 列而版本号仍是旧值。
    """
    from app.db import migrations

    def apply(conn: sqlite3.Connection) -> None:
        conn.execute("ALTER TABLE attempts ADD COLUMN probe TEXT")
        raise RuntimeError("模拟迁移步骤内部失败")

    return migrations.Step(version, STEP_NAME, apply)


def _plan(monkeypatch, version: int, extra_steps: Iterable[Any]) -> None:
    """把目标版本抬到 `version` 并把测试步骤接到迁移表尾（不碰库，等调用方跑迁移）。"""
    from app.db import migrations, store

    monkeypatch.setattr(store, "SCHEMA_VERSION", version)
    monkeypatch.setattr(migrations, "MIGRATIONS", [*migrations.MIGRATIONS, *extra_steps])


# ---------------------------------------------------------------------------
# §14.2：版本就是真相
# ---------------------------------------------------------------------------

def test_新库的user_version就是SCHEMA_VERSION(db_home):
    """§14.2：库内版本存在 `PRAGMA user_version`，新库建完就该等于常量。"""
    from app.db import migrate, store

    assert isinstance(store.SCHEMA_VERSION, int) and store.SCHEMA_VERSION >= 1
    migrate.ensure_schema()
    assert _user_version(db_home / "app.db") == store.SCHEMA_VERSION


def test_版本化之前的老库要补跑到最新(db_home, monkeypatch):
    """老库表齐全但没写版本：按序补跑落后的那一步，用户数据一条不能少。"""
    from app.db import migrate

    db = db_home / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_old")
    _set_user_version(db, 0)  # 版本化之前问世的库

    version = _next_version()
    applied: list[int] = []
    _plan(monkeypatch, version, [_probe_step(applied, version)])
    migrate.ensure_schema()

    assert applied == [version], "老库没有把落后的那一步补跑掉"
    assert _user_version(db) == version
    assert "probe" in _columns(db, "attempts"), "迁移步骤跑完了但列不在"
    assert _attempt_ids(db) == {"att_old"}, "结构升级弄丢了练习记录"


def test_已是最新版本的库不再重跑步骤(db_home, monkeypatch):
    """每次启动都重跑迁移表 == 同一条 ALTER 第二次必然报错，所以版本到了就该跳过。"""
    from app.db import migrate

    db = db_home / "app.db"
    migrate.ensure_schema()
    version = _next_version()
    applied: list[int] = []
    _plan(monkeypatch, version, [_probe_step(applied, version)])

    migrate.ensure_schema()
    assert applied == [version]
    migrate.ensure_schema()
    assert applied == [version], "第二次启动重跑了同一步骤（不是幂等）"


def test_库版本比程序新时必须拒绝写库(db_home):
    """用户装了老版本 EXE 打开新结构库：按老结构写下去会毁数据，必须拒绝。"""
    from app.db import migrate, migrations, store

    db = db_home / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_newer")
    _set_user_version(db, int(store.SCHEMA_VERSION) + 3)

    with pytest.raises(migrations.SchemaUpgradeError):
        migrate.ensure_schema()
    assert _attempt_ids(db) == {"att_newer"}, "拒绝启动时也该把库留在原样"


# ---------------------------------------------------------------------------
# §14.2 + §14.1：失败形态
# ---------------------------------------------------------------------------

def test_迁移中途抛错不得留下半迁移状态(db_home, monkeypatch):
    """§14.2：该步事务回滚、`user_version` 保持原值 —— ALTER 尤其不能漏。"""
    from app.db import migrate, migrations

    db = db_home / "app.db"
    migrate.ensure_schema()
    version_before = _user_version(db)
    _seed_attempt(db, "att_keep")

    _plan(monkeypatch, _next_version(), [_boom_step(_next_version())])
    with pytest.raises(migrations.SchemaUpgradeError):
        migrate.ensure_schema()

    assert _user_version(db) == version_before, "步骤失败却把版本号写上去了"
    assert "probe" not in _columns(db, "attempts"), "半迁移状态：列已加上但版本号没写"
    assert _attempt_ids(db) == {"att_keep"}, "回滚把用户数据一起弄没了"


def test_迁移表与SCHEMA_VERSION不一致要报错(db_home, monkeypatch):
    """抬高了常量却忘了写步骤 == 假装升级完成，比崩溃更糟。"""
    from app.db import migrate, migrations

    _plan(monkeypatch, _next_version(), [])
    with pytest.raises(migrations.SchemaUpgradeError):
        migrate.ensure_schema()


def test_步骤版本号跳号要报错(db_home, monkeypatch):
    """有序表必须连续：1→3 的库永远不知道第 2 步要不要跑。"""
    from app.db import migrate, migrations, store

    def noop(conn: sqlite3.Connection) -> None:
        return None

    gap_version = int(store.SCHEMA_VERSION) + 2
    _plan(monkeypatch, gap_version, [migrations.Step(gap_version, "跳号", noop)])
    with pytest.raises(migrations.SchemaUpgradeError):
        migrate.ensure_schema()


# ---------------------------------------------------------------------------
# §14.3：升级前快照
# ---------------------------------------------------------------------------

def test_升级前必须有一份能读回来的快照(db_home, monkeypatch):
    """§14.3：快照走 `conn.backup()` 写到 `<数据目录>/backups/`，且含升级前的数据。"""
    from app.db import migrate

    db = db_home / "app.db"
    migrate.ensure_schema()
    _seed_attempt(db, "att_before_upgrade")

    version = _next_version()
    _plan(monkeypatch, version, [_probe_step([], version)])
    migrate.ensure_schema()

    snaps = _snapshot_files(db_home)
    assert snaps, "schema 升级前没有做任何快照"
    conn = _open(snaps[-1])
    try:
        ids = {row[0] for row in conn.execute("SELECT id FROM attempts").fetchall()}
    finally:
        conn.close()
    assert "att_before_upgrade" in ids, "快照里读不出升级前的练习记录（等于没有备份）"


def test_没有结构变更时不该反复快照(db_home):
    """每次启动都快照一遍会在 backups 里堆垃圾，也让「升级前快照」这个标记失去意义。"""
    from app.db import migrate

    db = db_home / "app.db"
    migrate.ensure_schema()
    for _ in range(3):
        migrate.ensure_schema()
    assert _snapshot_files(db_home) == [], "版本没变仍然产生了快照"


# ---------------------------------------------------------------------------
# §14.2 + §14.6：失败必须被 API 看见，且可重试
# ---------------------------------------------------------------------------

def test_结构未就绪时读写返回500schema_upgrade_failed(client):
    """§14.2：app 不许带着半迁移结构继续跑，也不许把原因伪装成 internal_error。"""
    from app.db import store

    store.mark_schema_failed("学习库结构升级失败，已停止写入以保护现有记录")
    try:
        response = client.get("/api/attempts")
    finally:
        store.reset_schema_state()

    assert response.status_code == 500, response.text
    body = response.json()
    assert body["code"] == "schema_upgrade_failed"
    assert "升级" in body["detail"]
    assert ".db" not in body["detail"] and "SELECT" not in body["detail"].upper()


def test_升级失败后闩住但可重试(db_home, monkeypatch):
    """§14.6：失败必须可重试，但不能每个请求都重跑升级（那会在 backups 里堆副本）。"""
    from app.db import migrate, migrations, store

    db = db_home / "app.db"
    migrate.ensure_schema()  # 先按当前版本建库：下一步才是「真的一次结构变更失败」
    original = int(store.SCHEMA_VERSION)

    _plan(monkeypatch, _next_version(), [_boom_step(_next_version())])
    monkeypatch.setattr(store, "_schema_ready", False)

    with pytest.raises(migrations.SchemaUpgradeError):
        store.connect()
    assert len(_snapshot_files(db_home)) == 1, "升级前快照应在真正改结构之前做一次"

    with pytest.raises(migrations.SchemaUpgradeError):
        store.connect()
    assert len(_snapshot_files(db_home)) == 1, "每个请求都重跑了一次升级"

    # 把坏步骤撤掉再重试：库必须能升上来，而不是永远卡在「未就绪」
    monkeypatch.setattr(store, "SCHEMA_VERSION", original)
    monkeypatch.setattr(migrations, "MIGRATIONS", list(migrations.MIGRATIONS[:-1]))
    store.reset_schema_state()
    conn = store.connect()
    conn.close()
    assert _user_version(db) == original
