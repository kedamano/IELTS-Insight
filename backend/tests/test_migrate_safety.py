"""归档不变式测试（spec-contracts §14.1 / §14.3）。

这一档测的是「会不会把你的学习库删掉」，不是功能对不对，所以断言全部围绕一条：
**任何路径都不得出现「副本没写成 + 原文件已消失」**。

现状（Wave 6 审计发现）：`migrate._replace_corrupt` 先 `_archive()`（固定归档名
`app.pre-ielts.bak`，已存在即返回 None），再无条件 `db_path.unlink()` —— 第二次损坏时
原库被删除且零副本，而它自己的注释写的是「没有备份就不动用户文件」。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

# 故意不是合法 SQLite 文件头的字节：`sqlite3.connect` 会成功（懒打开），
# 但一读 sqlite_master 就抛 DatabaseError —— 这正是 _replace_corrupt 要处理的形态。
GARBAGE_A = b"THIS IS NOT A SQLITE DATABASE -- payload A --\x00\00\00"
GARBAGE_B = b"THIS IS NOT A SQLITE DATABASE -- payload B --\x00\00\00"


@pytest.fixture
def db_home(tmp_path, monkeypatch):
    """把全局 config 的 DB_PATH 指到本测试专属目录，并挡住 store 的懒建表。"""
    from app.config import settings as cfg
    from app.db import store

    home = tmp_path / "data"
    home.mkdir()
    monkeypatch.setattr(cfg, "DB_PATH", str(home / "app.db"))
    monkeypatch.setattr(store, "_schema_ready", True)
    return home


def _corrupt(db: Path, payload: bytes) -> bytes:
    db.write_bytes(payload)
    return payload


def _copies_of(home: Path, payload: bytes) -> list[Path]:
    """目录里内容恰好等于 payload 的文件（即「这份损坏库还留得下来吗」）。"""
    return sorted(p for p in home.iterdir() if p.is_file() and p.read_bytes() == payload)


def _tables(db: Path) -> set[str]:
    conn = sqlite3.connect(str(db))
    try:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    finally:
        conn.close()


def test_第二次损坏不得零副本删除原库(db_home):
    """§14.1：两次损坏都要留下各自的副本。现在红在第二次（被 unlink，零副本）。"""
    from app.db import migrate

    db = db_home / "app.db"
    migrate.ensure_schema()
    assert "attempts" in _tables(db)

    first = _corrupt(db, GARBAGE_A)
    migrate.ensure_schema()
    assert _copies_of(db_home, first), "第一次损坏的副本没留下"
    assert "attempts" in _tables(db), "损坏库没能重建"

    second = _corrupt(db, GARBAGE_B)
    migrate.ensure_schema()
    assert _copies_of(db_home, second), (
        "第二次损坏时原库被删除且没有任何副本 —— 违反 §14.1 不变式"
    )


def test_归档永不覆盖同名即追加序号(db_home):
    """两份不同的损坏库必须同时留得下来，后一份不许把前一份顶掉。"""
    from app.db import migrate

    db = db_home / "app.db"
    migrate.ensure_schema()

    first = _corrupt(db, GARBAGE_A)
    migrate.ensure_schema()
    second = _corrupt(db, GARBAGE_B)
    migrate.ensure_schema()

    kept_a = _copies_of(db_home, first)
    kept_b = _copies_of(db_home, second)
    assert kept_a and kept_b, "两份损坏库必须都还在"
    assert set(kept_a).isdisjoint(kept_b), "两份副本撞在同一个文件名上（互相覆盖）"


def test_改名失败时绝不删除原库(db_home, monkeypatch):
    """§14.3：移开损坏库靠原子改名；改名失败（占用/权限/跨卷）就放弃重建，原库留在原地。"""
    from app.db import migrate

    db = db_home / "app.db"
    migrate.ensure_schema()
    payload = _corrupt(db, GARBAGE_A)

    def boom(*args, **kwargs):
        raise OSError("another process is using the file")

    monkeypatch.setattr("os.replace", boom)
    with pytest.raises(OSError):
        migrate.ensure_schema()
    assert db.read_bytes() == payload, "改名失败后仍然把原库删掉了"


def test_合法空文件不算损坏(tmp_path, monkeypatch):
    """0 字节（刚创建/未写盘）不是损坏，不该产生任何归档。"""
    from app.config import settings as cfg
    from app.db import migrate, store

    home = tmp_path / "data2"
    home.mkdir()
    monkeypatch.setattr(cfg, "DB_PATH", str(home / "app.db"))
    monkeypatch.setattr(store, "_schema_ready", True)
    (home / "app.db").write_bytes(b"")

    migrate.ensure_schema()
    assert "attempts" in _tables(home / "app.db")
    assert sorted(p.name for p in home.iterdir()) == ["app.db"], "空文件被当成损坏并产生了归档"
