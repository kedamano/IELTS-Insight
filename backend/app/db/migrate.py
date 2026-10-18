"""数据库迁移（spec-contracts.md §5）。

策略（契约：旧数据是剧本跟读记录，无保留价值 → 不做业务迁移，只归档）：

1. `DB_PATH` 处若已存在**旧 schema** 的 app.db（有 `scenes`、无 `attempts`），
   先**复制**为同目录的 `app.pre-ielts.bak`（用户原文件绝不删除）；
2. 复制成功后，才把旧库里**用户可见的两样东西**带进新 schema：
   - 旧 `settings` 行的 `online_enabled` / `tts_voice`（其余字段是剧本跟读语义，已废弃）
   - 旧 `wordbook` 收藏 → 新 `vocab` 表（生词本能力延续，FR-V1）
   然后 `DROP` 掉 6 张旧表（否则旧 `settings` 表结构会与新契约的 `settings(json)` 冲突）；
3. `DB_PATH` 处的文件若不是合法 SQLite（损坏）→ 备份后重建；
4. 执行 `schema.sql`（全部 `IF NOT EXISTS`，因此幂等、首启安全）；
5. 播种 `settings` 单行（`INSERT OR IGNORE`，绝不覆盖用户已有设置）。

兼容旧打包：当**没有** `IELTS_DB_PATH` 覆盖时，顺带把历史上写在 CWD/exe 相对位置的旧库
（`backend/db/app.db`、仓库根 `db/app.db`）复制归档，避免路径改到 `%LOCALAPPDATA%` 后
旧库被静默遗弃在无人归档的位置。设了 `IELTS_DB_PATH`（测试）时**完全不碰**其它路径
——CONSTITUTION §6 的隔离要求。

本模块只用裸 `sqlite3` 连接（不回调 `store.connect()`，否则会触发建表懒加载造成递归）。
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any, Optional

from app.config import settings as _cfg
from app.db import store

ARCHIVE_SUFFIX = "app.pre-ielts.bak"

LEGACY_TABLES = ("scenes", "practice_records", "wrong_records", "learning_records", "wordbook", "settings")


def _legacy_candidates() -> list[Path]:
    """历史上（相对 CWD / exe 目录）可能存在的旧库位置。"""
    here = Path(__file__).resolve()  # backend/app/db/migrate.py
    backend = here.parents[2]
    out = [backend / "db" / "app.db", backend.parent / "db" / "app.db"]
    if getattr(sys, "frozen", False):
        out.append(Path(sys.executable).parent / "db" / "app.db")
    return out


def _raw_connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _table_names(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}


def _is_legacy_db(db_path: Path) -> bool:
    """旧 schema：有 scenes 且没有 attempts。空文件/合法新库都返回 False。"""
    if not db_path.exists() or db_path.stat().st_size == 0:
        return False
    try:
        conn = _raw_connect(db_path)
    except sqlite3.Error:
        return False
    try:
        tables = _table_names(conn)
    finally:
        conn.close()
    return store.NEW_MARKER_TABLE not in tables and store.LEGACY_MARKER_TABLE in tables


def _archive(db_path: Path) -> Optional[Path]:
    """复制归档（幂等：归档已存在则不覆盖，返回 None）。"""
    if not db_path.exists() or db_path.stat().st_size == 0:
        return None
    target = db_path.parent / ARCHIVE_SUFFIX
    if target.exists():
        return None
    shutil.copy2(db_path, target)
    return target


def _archive_if_legacy(db_path: Path) -> Optional[Path]:
    if not _is_legacy_db(db_path):
        return None
    target = _archive(db_path)
    if target:
        print(f"[Migrate] 旧剧本库已归档：{target}", flush=True)
    return target


def _replace_corrupt(db_path: Path) -> Optional[Path]:
    """损坏的库文件：先备份再移开，让新 schema 能建起来（没有备份就不动用户文件）。"""
    if not db_path.exists() or db_path.stat().st_size == 0:
        return None
    try:
        conn = _raw_connect(db_path)
        conn.execute("SELECT name FROM sqlite_master").fetchall()
        conn.close()
        return None
    except sqlite3.Error:
        pass
    target = _archive(db_path)
    db_path.unlink()
    print(f"[Migrate] 库文件损坏，已备份为 {target} 并重建", flush=True)
    return target


def _legacy_snapshot(db_path: Path) -> Optional[dict[str, Any]]:
    """读取旧库里值得保留的两项：settings(online_enabled/tts_voice) 与 wordbook 收藏。"""
    if not _is_legacy_db(db_path):
        return None
    try:
        conn = _raw_connect(db_path)
    except sqlite3.Error:
        return None
    try:
        tables = _table_names(conn)
        snap: dict[str, Any] = {"settings": {}, "wordbook": []}
        if "settings" in tables:
            row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
            if row:
                keys = row.keys()
                if "online_enabled" in keys:
                    snap["settings"]["online_enabled"] = bool(row["online_enabled"])
                if "tts_voice" in keys and row["tts_voice"]:
                    snap["settings"]["tts_voice"] = row["tts_voice"]
        if "wordbook" in tables:
            for row in conn.execute("SELECT word, phonetic, zh, example, created_at FROM wordbook").fetchall():
                snap["wordbook"].append(dict(row))
        return snap
    except sqlite3.Error as exc:
        print(f"[Migrate] 读取旧库失败，跳过携带：{exc}", flush=True)
        return None
    finally:
        conn.close()


def create_tables(db_path: Path) -> list[str]:
    """执行 schema.sql（幂等）。返回该库中的表名。"""
    sql = store.SCHEMA_PATH.read_text(encoding="utf-8")
    conn = _raw_connect(db_path)
    try:
        conn.executescript(sql)
        conn.commit()
        return sorted(_table_names(conn))
    finally:
        conn.close()


def _drop_legacy_tables(conn: sqlite3.Connection) -> int:
    dropped = 0
    for table in LEGACY_TABLES:
        if table in _table_names(conn):
            conn.execute(f"DROP TABLE IF EXISTS {table}")
            dropped += 1
    return dropped


def _apply_legacy_snapshot(conn: sqlite3.Connection, snap: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """把旧库值得保留的数据写进新 schema（新表已建好）。"""
    carry: dict[str, Any] = {}
    if snap.get("settings"):
        carry = dict(snap["settings"])
    moved = 0
    for item in snap.get("wordbook") or []:
        word = (item.get("word") or "").strip().lower()
        if not word:
            continue
        phonetics = {
            "phonetic": item.get("phonetic") or "",
            "zh": item.get("zh") or "",
            "examples": [item["example"]] if item.get("example") else [],
        }
        conn.execute(
            "INSERT OR IGNORE INTO vocab (word, context, source_module, source_ref, note_zh, tags, created_at, phonetics_json) "
            "VALUES (?, '', '', '', ?, '[]', ?, ?)",
            (
                word,
                item.get("zh") or "",
                item.get("created_at") or store.utc_now_iso(),
                json.dumps(phonetics, ensure_ascii=False),
            ),
        )
        moved += 1
    return moved, carry


def _seed_settings(carry_over: Optional[dict[str, Any]] = None) -> None:
    """播种设置单行。已有行不动（除非旧库带来 `carry_over` 字段需要合并）。"""
    db_path = Path(_cfg.DB_PATH)
    conn = _raw_connect(db_path)
    try:
        row = conn.execute("SELECT json FROM settings WHERE id = 1").fetchone()
        if row is not None and not carry_over:
            return
        values = dict(store.DEFAULT_SETTINGS)
        values["online_enabled"] = bool(_cfg.ONLINE)
        if row:
            try:
                values.update(json.loads(row["json"]))
            except (TypeError, ValueError):
                pass
        if carry_over:
            values.update(carry_over)
        with conn:
            conn.execute(
                "INSERT INTO settings (id, json, updated_at) VALUES (1, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
                (json.dumps(values, ensure_ascii=False), store.utc_now_iso()),
            )
    finally:
        conn.close()


def ensure_schema() -> list[str]:
    """建表 + 迁移旧库 + 播种（lifespan 与 store.connect 懒路径共用；幂等）。"""
    db_path = Path(_cfg.DB_PATH).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    _replace_corrupt(db_path)
    _archive_if_legacy(db_path)
    snap = _legacy_snapshot(db_path)

    if snap is not None:
        # 顺序很重要：旧 `settings` 表结构与契约 §5 的新 `settings(json)` 冲突，
        # 必须先删旧表（已有 .bak 副本 + 内存快照），再建 schema.sql。
        conn = _raw_connect(db_path)
        try:
            dropped = _drop_legacy_tables(conn)
            conn.commit()
        finally:
            conn.close()
        legacy_dropped = dropped
    else:
        legacy_dropped = 0

    create_tables(db_path)

    carry: dict[str, Any] = {}
    if snap is not None:
        conn = _raw_connect(db_path)
        try:
            moved, carry = _apply_legacy_snapshot(conn, snap)
            conn.commit()
        finally:
            conn.close()
        print(f"[Migrate] 旧剧本表已清理 {legacy_dropped} 张；生词本迁移 {moved} 条", flush=True)

    _seed_settings(carry or None)

    conn = _raw_connect(db_path)
    try:
        return sorted(_table_names(conn))
    finally:
        conn.close()


def run() -> dict[str, Any]:
    """启动时调用：返回迁移报告（main.py 打印，便于用户第一次跑时看清发生了什么）。"""
    db_path = Path(_cfg.DB_PATH).expanduser()
    archived: list[str] = []
    override = bool((os.environ.get("IELTS_DB_PATH") or "").strip())

    if not override:
        for legacy in _legacy_candidates():
            try:
                if legacy.resolve() == db_path.resolve():
                    continue
            except OSError:
                continue
            done = _archive_if_legacy(legacy)
            if done:
                archived.append(str(done))

    existed_before = db_path.exists() and db_path.stat().st_size > 0
    was_legacy = _is_legacy_db(db_path) if existed_before else False
    tables = ensure_schema()
    if was_legacy:
        bak = db_path.parent / ARCHIVE_SUFFIX
        if bak.exists():
            archived.append(str(bak))
    return {
        "db_path": str(db_path),
        "fresh": not existed_before,
        "was_legacy": was_legacy,
        "archived_to": archived,
        "tables": tables,
        "legacy_discovery": "skipped (IELTS_DB_PATH 覆盖，测试隔离)" if override else "enabled",
    }


if __name__ == "__main__":  # 手工执行：python -m app.db.migrate
    print(json.dumps(run(), ensure_ascii=False, indent=2))
