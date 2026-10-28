"""在线快照、副本命名与恢复（spec-contracts §14.3）。

三件事在这里定死，别的模块只准复用：

1. **副本名字必须唯一且永不覆盖。** §14.1 的不变式（不许出现「副本没写成 + 原文件已消失」）
   全靠它：只有先拿到一个确定可写的新路径，才允许对原库做破坏性动作。覆盖上一份副本
   等于上一份副本没了，所以同名时给时间戳追加 `-02`、`-03`。
2. **快照走 SQLite 在线备份 API（`conn.backup()`）。** 复制正在写的 `app.db` 活文件只会
   得到半截库（页没刷完 + WAL 没合并），那种备份在真正要恢复的一天必然失效。
3. **恢复之前必须先给当前状态留一份副本。** 恢复是这套功能里唯一会主动毁掉用户数据的动作，
   选错快照不该等于进度清零。

快照落在 `<数据目录>/backups/`，与 `app.db` 旁边的归档/改名副本分开：前者是我们造的副本，
可以轮转；后者是用户的原文件，永远不删。
"""

from __future__ import annotations

import datetime as _dt
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

from app.config import settings as _cfg

BACKUPS_DIRNAME = "backups"
SNAPSHOT_SUFFIX = "sqlite"

# 快照标记（进文件名）：`pre-upgrade` 回答「这份是不是升级前留的」，
# 设置屏与备份列表要靠它区分自动与手动。
TAG_PRE_UPGRADE = "pre-upgrade"
TAG_PRE_RESTORE = "pre-restore"
TAG_MANUAL = "manual"
TAG_STARTUP = "startup"

KEEP = 10
MAX_AGE_DAYS = 7

# 快照名字来自 URL，是用户可控字符串：白名单只有这一种形态（§14.3）。
_NAME_RE = re.compile(r"^app\.(?P<tag>[a-z][a-z-]{0,20})\.(?P<stamp>\d{8}T\d{6}(?:-\d{2})?)\.sqlite$")

# 快照/恢复都要读整个库，恢复还会覆盖当前库，而同进程里的异步批改线程也在写。
# 重入锁：restore 内部会先调 snapshot（拿锁再拿锁）。
_write_lock = threading.RLock()


class SnapshotNameError(ValueError):
    """名字不是 `backups/` 里的合法快照（越界 / 绝对路径 / 格式不对）。"""


def utc_stamp() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%S")


def unique_target(directory: Path, stem: str, suffix: str = "bak") -> Path:
    """同目录下带 UTC 时间戳的唯一副本路径；同名已存在则追加 `-02`、`-03`…
    """
    base = directory / f"{stem}.{utc_stamp()}.{suffix}"
    if not base.exists():
        return base
    index = 2
    while True:
        candidate = directory / f"{stem}.{utc_stamp()}-{index:02d}.{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def data_dir() -> Path:
    return Path(_cfg.DB_PATH).expanduser().parent


def backups_dir() -> Path:
    return data_dir() / BACKUPS_DIRNAME


def snapshots() -> list[Path]:
    """历史快照，**旧→新**。

    按 mtime 排而不是按名字：同一秒内的两份名字只差 `-02` 后缀，而 `-`（45）排在 `.`（46）
    前面，按名字比会把后拍的那份认成更早的 —— 轮转就会删错。
    """
    directory = backups_dir()
    if not directory.is_dir():
        return []
    found = [p for p in directory.glob(f"app.*.{SNAPSHOT_SUFFIX}") if p.is_file()]
    return sorted(found, key=lambda p: (p.stat().st_mtime, p.name))


def _iso_from_stamp(stamp: str) -> str:
    try:
        moment = _dt.datetime.strptime(stamp[:15], "%Y%m%dT%H%M%S").replace(tzinfo=_dt.timezone.utc)
    except ValueError:
        return ""
    return moment.isoformat()


def describe(path: Path) -> dict[str, Any]:
    """列表行：名字 / 字节数 / UTC 时刻 / 标记 / 是否升级前快照（契约 §14.3）。"""
    match = _NAME_RE.match(path.name)
    tag = match.group("tag") if match else ""
    stamp = match.group("stamp") if match else ""
    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    return {
        "name": path.name,
        "size_bytes": size,
        "created_at": _iso_from_stamp(stamp),
        "tag": tag,
        "pre_upgrade": tag == TAG_PRE_UPGRADE,
    }


def list_rows() -> list[dict[str, Any]]:
    """新→旧；第一条就是「现在能恢复回去的最新一份」。"""
    return [describe(path) for path in reversed(snapshots())]


def resolve_snapshot(name: str) -> Path:
    """把 URL 传进来的名字限制在 `backups/` 目录内的合法快照上。

    少校验一次，`{name}` 就成了「让本机任意文件被覆盖」的入口。
    """
    if not _NAME_RE.match(name or ""):
        raise SnapshotNameError(name)
    directory = backups_dir().resolve()
    candidate = (directory / name).resolve()
    if candidate.parent != directory:
        raise SnapshotNameError(name)
    return candidate


def rotate(keep: int = KEEP) -> list[Path]:
    """只保留最近 `keep` 份快照，返回被删掉的那些。

    删的全是我们自己造的副本，`app.db` 与它的归档副本都不在本目录，碰不到。
    """
    doomed = snapshots()[:-keep] if keep > 0 else snapshots()
    removed: list[Path] = []
    for path in doomed:
        try:
            path.unlink()
            removed.append(path)
        except OSError:
            continue  # 轮转失败不该让备份本身算失败
    return removed


def snapshot(src: sqlite3.Connection, *, tag: str = TAG_MANUAL, keep: int = KEEP) -> Optional[Path]:
    """把 `src` 指向的库在线备份一份，返回副本路径。

    备份失败时必须把半截副本清掉再上抛：留着它，备份列表会显示一份看着能用、
    实则读不出表的快照 —— 而用户以为自己有备份。
    """
    with _write_lock:
        directory = backups_dir()
        directory.mkdir(parents=True, exist_ok=True)
        target = unique_target(directory, f"app.{tag}", SNAPSHOT_SUFFIX)
        dest: Optional[sqlite3.Connection] = None
        try:
            dest = sqlite3.connect(str(target))
            src.backup(dest)
            dest.commit()
        except BaseException:
            if dest is not None:
                dest.close()
                dest = None
            try:
                target.unlink()
            except OSError:
                pass
            raise
        else:
            dest.close()
        rotate(keep)
        return target


def _open_current(timeout: int = 10) -> sqlite3.Connection:
    """裸连接（不走 `store.connect()`：那会在快照途中再触发一次建表/迁移）。"""
    conn = sqlite3.connect(str(_cfg.DB_PATH), timeout=timeout)
    conn.row_factory = sqlite3.Row
    return conn


def create_manual() -> dict[str, Any]:
    """用户点「立即备份」：拍一份 `manual` 快照并返回它的列表行。"""
    with _write_lock:
        conn = _open_current()
        try:
            target = snapshot(conn, tag=TAG_MANUAL)
        finally:
            conn.close()
    return describe(target) if target else {}


def restore(name: str) -> dict[str, Any]:
    """用快照覆盖当前库 —— 但**先**给当前状态留一份 `pre-restore` 副本（§14.3）。

    实现是「把快照内容 `backup()` 写回当前库」，不是替换文件：Windows 上正在被连接的
    `app.db` 换不掉，换到一半比不恢复更糟。写回途中失败也还能救 —— 恢复前那份副本已经在
    `backups/` 里了，这正是先拍副本的意义。
    """
    target = resolve_snapshot(name)
    if not target.is_file():
        raise FileNotFoundError(name)
    with _write_lock:
        safety = snapshot(_open_current(), tag=TAG_PRE_RESTORE)
        src = sqlite3.connect(str(target))
        dst = _open_current()
        try:
            src.backup(dst)
            dst.commit()
        finally:
            src.close()
            dst.close()
        # 恢复回来的是一份老结构 + 老版本号：清掉「结构已就绪」这个结论，
        # 让下一次连接重新按 `user_version` 判定（§14.2）。
        from app.db import store  # 延迟导入：避开 store 的加载顺序问题

        store.reset_schema_state()
    return {"restored": name, "pre_restore": safety.name if safety else None}


def startup_snapshot_if_stale(*, fresh: bool, max_age_days: int = MAX_AGE_DAYS) -> Optional[Path]:
    """距上次成功快照 > `max_age_days` 天时补拍一份；本次刚建的空库不拍。"""
    if fresh:
        return None
    existing = snapshots()
    if existing:
        age = time.time() - existing[-1].stat().st_mtime
        if age <= max_age_days * 86400:
            return None
    with _write_lock:
        conn = _open_current()
        try:
            return snapshot(conn, tag=TAG_STARTUP)
        finally:
            conn.close()


def newest_age_days() -> Optional[float]:
    """最近一份快照距今多少天；一份都没有时返回 None（设置屏要说「还没有备份」）。"""
    existing = snapshots()
    if not existing:
        return None
    return (time.time() - existing[-1].stat().st_mtime) / 86400
