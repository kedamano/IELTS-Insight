"""`/api/backup`（契约 §14.3）：列出快照、手动快照、恢复。

这一组端点操作的是**本机的学习库文件**，规矩比别的端点硬：

- `{name}` 来自 URL，先过 `backup.resolve_snapshot()` 的白名单，越界一律拒绝，
  且拒绝时不许动到当前库；
- 报错的 detail 只说人话，**不含文件路径**（CONSTITUTION §3 同源：响应体不该泄露本机目录）。
  唯一给出目录的地方是列表里的 `directory` —— 用户要知道去哪儿把副本拷出机器，那是本机自用信息。
- 恢复必须先在 `backups/` 里留下当前状态的 `pre-restore` 副本才允许覆盖（§14.3）。
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.common import bad_request, not_found, ok
from app.db import backup

router = APIRouter(prefix="/backup", tags=["backup"])


@router.get("")
def list_backups():
    return ok(
        {
            "items": backup.list_rows(),
            "keep": backup.KEEP,
            "max_age_days": backup.MAX_AGE_DAYS,
            "days_since_last": backup.newest_age_days(),
            "directory": str(backup.backups_dir()),
        }
    )


@router.post("")
def create_backup():
    row = backup.create_manual()
    return ok(row)


@router.post("/{name}/restore")
def restore_backup(name: str):
    try:
        result = backup.restore(name)
    except backup.SnapshotNameError:
        raise bad_request("这份备份的名字不是本机快照文件名，已拒绝，当前库没有改动。")
    except FileNotFoundError:
        raise not_found("本机找不到这份备份，可能已被轮转删掉。列表里最新的一份总是安全的。")
    return ok(result)
