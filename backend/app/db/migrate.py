"""数据库建表与结构升级（spec-contracts.md §5 + §14）。

**§14.1 不变式：任何路径都不得出现「副本没写成 + 原文件已消失」。** 本模块所有破坏性动作
都要先拿到一个「确定不存在」的目标路径（`backup.unique_target`，带 UTC 时间戳、永不覆盖）才继续。

策略：

1. `DB_PATH` 处若已存在**旧 schema** 的 app.db（有 `scenes`、无 `attempts`），
   先**复制**为同目录的 `app.db.pre-ielts.<UTC时间戳>.bak`（用户原文件绝不删除）；
2. 复制成功后，才把旧库里**用户可见的两样东西**带进新 schema：
   - 旧 `settings` 行的 `online_enabled` / `tts_voice`（其余字段是剧本跟读语义，已废弃）
   - 旧 `wordbook` 收藏 → 新 `vocab` 表（生词本能力延续，FR-V1）
   然后 `DROP` 掉 6 张旧表（否则旧 `settings` 表结构会与新契约的 `settings(json)` 冲突）；
3. `DB_PATH` 处的文件若不是合法 SQLite（损坏）→ **原子改名**移开（`corrupt` 标签），
   再让新 schema 建起来。改名失败就抛错放弃重建，原库留在原地（§14.3）；
4. 执行 `schema.sql`（全部 `IF NOT EXISTS`，因此幂等、首启安全）；
5. 播种 `settings` 单行（`INSERT OR IGNORE`，绝不覆盖用户已有设置）；
6. **结构升级**（§14.2）：读 `PRAGMA user_version` → 落后于 `store.SCHEMA_VERSION` 时
   先做升级前在线快照（§14.3），再按 `app/db/migrations.py` 的有序表逐步 apply（每步一个事务）→
   版本号与 DDL 同事务提交。任一步失败 → 整步回滚、版本号保持原值、抛
   `SchemaUpgradeError`，app 进入「结构未就绪」。**半迁移状态禁止继续跑。**

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
from app.db import backup, migrations, store

# 归档标签（文件名的一部分）。§14.3：归档名带 UTC 时间戳且永不覆盖，
# 所以这里只是「这一段是干什么的」，不再是完整文件名。
TAG_LEGACY = "pre-ielts"
TAG_CORRUPT = "corrupt"


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
    """裸连接（不回调 store.connect，否则会触发建表懒加载造成递归）。

    建连后任何一步失败都要把连接关掉：Windows 上泄漏的连接会把 app.db 锁住，
    后面的改名/删除直接 PermissionError —— 实测 test_migrate_safety 就是这么撞出来的。
    """
    conn = sqlite3.connect(str(db_path), timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
    except BaseException:
        conn.close()
        raise
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


def _archive(db_path: Path, tag: str = TAG_LEGACY) -> Optional[Path]:
    """复制归档（§14.3：唯一名、永不覆盖）。文件不存在或为空时返回 None。

    注意这里**只复制、不删除**：旧剧本库复制完还要就地转成新 schema（`_drop_legacy_tables`），
    损坏库才需要真正移开，那条路走 `_replace_corrupt` 的原子改名。
    """
    if not db_path.exists() or db_path.stat().st_size == 0:
        return None
    target = backup.unique_target(db_path.parent, f"{db_path.name}.{tag}")
    shutil.copy2(db_path, target)
    return target


def _record(archives: Optional[list[Path]], target: Optional[Path]) -> None:
    if target is not None and archives is not None:
        archives.append(target)


def _archive_if_legacy(db_path: Path, archives: Optional[list[Path]] = None) -> Optional[Path]:
    if not _is_legacy_db(db_path):
        return None
    target = _archive(db_path, TAG_LEGACY)
    if target:
        _record(archives, target)
        print(f"[Migrate] 旧剧本库已归档：{target.name}", flush=True)
    return target


def _is_corrupt(db_path: Path) -> bool:
    """能打开但读不出 sqlite_master == 损坏。0 字节是「还没写」，不算损坏。"""
    if not db_path.exists() or db_path.stat().st_size == 0:
        return False
    try:
        conn = _raw_connect(db_path)
    except sqlite3.Error:
        return True
    try:
        conn.execute("SELECT name FROM sqlite_master").fetchall()
    except sqlite3.Error:
        return True
    finally:
        conn.close()
    return False


def _replace_corrupt(db_path: Path, archives: Optional[list[Path]] = None) -> Optional[Path]:
    """损坏的库：**原子改名**移开后让新 schema 建起来（§14.3）。

    改名而不是「复制 + 删除」，是因为后者中间那步删除正是 §14.1 禁止的形态：
    副本没写成（归档名被占用）时原文件照样没了。改名要么成功（原路径立刻是副本名，
    全程存在），要么抛错（原库留在原地，调用方放弃重建）。
    """
    if not _is_corrupt(db_path):
        return None
    target = backup.unique_target(db_path.parent, f"{db_path.name}.{TAG_CORRUPT}")
    os.replace(db_path, target)  # 失败即抛：不捕获、不兜底删除，原库必须还在
    _record(archives, target)
    print(f"[Migrate] 库文件损坏，已改名为 {target.name} 并重建", flush=True)
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


def _read_user_version(db_path: Path) -> int:
    """库内结构版本（§14.2 的唯一真相）。读不出来（没有库/损坏）按 0 处理。"""
    if not db_path.exists() or db_path.stat().st_size == 0:
        return 0
    try:
        conn = _raw_connect(db_path)
    except sqlite3.Error:
        return 0
    try:
        return int(conn.execute("PRAGMA user_version").fetchone()[0])
    except sqlite3.Error:
        return 0
    finally:
        conn.close()


def _upgrade_version(db_path: Path, *, pre_existing: bool, archives: Optional[list[Path]] = None) -> list[int]:
    """§14.2：读 `user_version` → 落后则**先做升级前快照**，再按序 apply（每步一个事务）。

    `pre_existing` 决定要不要快照：本次刚建出来的空库没有值得保护的东西，给它拍一份只会
    让 backups 目录多一个没人需要的文件。返回实际跑掉的步骤版本号列表。

    失败形态全部往上抛 `SchemaUpgradeError`：半迁移状态禁止继续跑（§14.2 最后一条）。
    """
    target = store.SCHEMA_VERSION
    conn = _raw_connect(db_path)
    # 手工事务：默认（legacy）模式下 Python 不为 DDL 开事务，ALTER 会当场提交，
    # 步骤失败后库里就多出半截结构而版本号仍是旧值 —— 正是契约禁止的形态。
    conn.isolation_level = None
    try:
        current = migrations.read_version(conn)
        if current > target:
            raise migrations.SchemaUpgradeError(
                migrations.DETAIL_NEWER, reason=f"库内版本 {current} 高于程序版本 {target}"
            )
        steps = migrations.pending_steps(current=current, target=target)
        if not steps:
            return []
        if pre_existing:
            _record(archives, backup.snapshot(conn, tag=backup.TAG_PRE_UPGRADE))
        return migrations.apply_steps(conn, steps)
    finally:
        conn.close()


def ensure_schema(archives: Optional[list[Path]] = None) -> list[str]:
    """建表 + 迁移旧库 + 播种 + 结构升级（lifespan 与 store.connect 懒路径共用；幂等）。

    `archives`：调用方给一个空列表，本次产生的归档/改名副本/升级前快照会 append 进去
    （§14.3 要求报告里能列出这些文件；不给就是不在意，行为不变）。
    """
    db_path = Path(_cfg.DB_PATH).expanduser()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # 「升级前快照」只在库里可能已有东西时做：判定时机必须在任何破坏性动作之前。
    pre_existing = db_path.exists() and db_path.stat().st_size > 0

    if _replace_corrupt(db_path, archives) is not None:
        pre_existing = False
    _archive_if_legacy(db_path, archives)
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
    _upgrade_version(db_path, pre_existing=pre_existing, archives=archives)

    conn = _raw_connect(db_path)
    try:
        return sorted(_table_names(conn))
    finally:
        conn.close()


def run() -> dict[str, Any]:
    """启动时调用：返回迁移报告（main.py 打印，便于用户第一次跑时看清发生了什么）。"""
    db_path = Path(_cfg.DB_PATH).expanduser()
    produced: list[Path] = []
    override = bool((os.environ.get("IELTS_DB_PATH") or "").strip())

    if not override:
        for legacy in _legacy_candidates():
            try:
                if legacy.resolve() == db_path.resolve():
                    continue
            except OSError:
                continue
            _archive_if_legacy(legacy, produced)

    existed_before = db_path.exists() and db_path.stat().st_size > 0
    was_legacy = _is_legacy_db(db_path) if existed_before else False
    version_before = _read_user_version(db_path) if existed_before else 0
    tables = ensure_schema(produced)
    return {
        "db_path": str(db_path),
        "fresh": not existed_before,
        "was_legacy": was_legacy,
        # 本次运行留下/移开的每一个副本（§14.3）：损坏改名、旧库归档与升级前快照都算。
        "archived_to": [str(p) for p in produced],
        "tables": tables,
        # §14.2：库内版本才是真相，报告里把它和程序目标版本一起给出。
        "schema_version": _read_user_version(db_path),
        "schema_version_before": version_before,
        "target_schema_version": store.SCHEMA_VERSION,
        "legacy_discovery": "skipped (IELTS_DB_PATH 覆盖，测试隔离)" if override else "enabled",
    }


if __name__ == "__main__":  # 手工执行：python -m app.db.migrate
    print(json.dumps(run(), ensure_ascii=False, indent=2))
