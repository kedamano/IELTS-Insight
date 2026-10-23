"""SQLite 访问的唯一入口（spec-contracts.md §5）。

约定：
- 路由与服务层**不写裸 SQL**，一切读写经本模块的事务型函数；
- 时间戳统一 UTC ISO-8601 字符串（CONTRACTS §0），「哪一天」的归属按本机本地日历日；
- 每次连接都开 `PRAGMA foreign_keys`，保证 `attempt_items` 的 `ON DELETE CASCADE` 生效。

`settings` 表里可能存有用户从设置页写入的 AI key（`ai_key`，CONSTITUTION §3 允许「设置页覆盖存
settings 表」）。它是私有字段：`public_settings()` / `settings_response()` 会剥掉它，
任何端点都不得返回原始 settings 行。
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional

from app.config import settings as _cfg

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

MODULES = ("speaking", "listening", "reading", "writing")
# 客观题两科：只有它们有 `attempt_items` 逐题对错，因此也只有它们能算「分科正确率」。
OBJECTIVE_MODULES = ("listening", "reading")

# 旧库指纹（剧本跟读时代的表）与新库指纹，供 migrate 判断
LEGACY_MARKER_TABLE = "scenes"
NEW_MARKER_TABLE = "attempts"

PRIVATE_SETTING_KEYS = frozenset({"ai_key"})

# ---------------------------------------------------------------------------
# 连接 / 事务
# ---------------------------------------------------------------------------

_schema_ready = False


def connect() -> sqlite3.Connection:
    """打开数据库连接（必要时先建表）。"""
    ensure_schema()
    conn = sqlite3.connect(_cfg.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_schema() -> None:
    """幂等建表。首次 `connect()` 时懒执行，避免测试/脚本绕过 lifespan。

    先置位再执行：`migrate` 内部只用裸连接，但若它在完成前再次回调本函数会形成递归。
    """
    global _schema_ready
    if _schema_ready:
        return
    _schema_ready = True
    from app.db import migrate  # 延迟导入，避免 store <-> migrate 循环依赖

    try:
        migrate.ensure_schema()
    except Exception:
        _schema_ready = False
        raise


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    """写事务：正常提交，异常回滚。"""
    conn = connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 时间工具
# ---------------------------------------------------------------------------

def utc_now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def today_local() -> str:
    """本机日历日 YYYY-MM-DD（计划与练习时长按本地日归属）。"""
    return _dt.date.today().isoformat()


def iso_to_local_date(value: str) -> Optional[str]:
    """把存储的时间戳归到本地日历日；无法解析时返回 None。"""
    if not value:
        return None
    try:
        dt = _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    return dt.astimezone().date().isoformat()


def practice_day_of(row: sqlite3.Row) -> Optional[str]:
    """一次练习归属的本地日历日：优先 `started_at`（用户实际练的时间），回退 `created_at`。"""
    return iso_to_local_date(row["started_at"] or "") or iso_to_local_date(row["created_at"] or "")


PRACTICE_AT_SQL = "COALESCE(NULLIF(started_at, ''), created_at)"
"""所有「按练习时间排序/分桶」的 SQL 统一用这个表达式。

理由：`attempts.created_at` 是落库时间，补录/重试时可能与用户实际练习时间不同一天；
面板的「当前分数」「趋势」「今日时长」都应跟随练习真正发生的时间。
"""


def practice_at(alias: str = "") -> str:
    """带表别名的练习时间表达式（JOIN 时用，如 `practice_at('a')`）。"""
    prefix = f"{alias}." if alias else ""
    return f"COALESCE(NULLIF({prefix}started_at, ''), {prefix}created_at)"


# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------

DEFAULT_SETTINGS: dict[str, Any] = {
    "target_band": 6.5,
    "exam_date": None,
    "daily_goal_minutes": 60,
    "accent": "en-GB",
    "tts_voice": "en-GB-SoniaNeural",
    "tts_speed": 1.0,
    "show_chinese_hints": True,
    "show_punctuation": True,
    "online_enabled": True,
    "audio_device": None,
    "recording_input_gain": 1.0,
    # 外观：浅色 / 深色 / 跟随系统（Wave 4 双主题，实解析在前端 useTheme）
    "theme": "system",
    # 可写但不原样回传（对外只在 ai 块里以 host/model 呈现）
    "ai_base_url": None,
    "ai_model": None,
    # 私有，永不回传
    "ai_key": None,
}

# 契约 §4 里暴露给前端的字段顺序
PUBLIC_SETTING_KEYS = (
    "target_band",
    "exam_date",
    "daily_goal_minutes",
    "accent",
    "tts_voice",
    "tts_speed",
    "show_chinese_hints",
    "show_punctuation",
    "online_enabled",
    "audio_device",
    "recording_input_gain",
    "theme",
)


def get_settings() -> dict[str, Any]:
    """返回完整设置（含私有字段）。仅内部使用，永不直接回传前端。"""
    conn = connect()
    try:
        row = conn.execute("SELECT json FROM settings WHERE id = 1").fetchone()
    finally:
        conn.close()
    merged = dict(DEFAULT_SETTINGS)
    if row:
        try:
            stored = json.loads(row["json"])
        except (TypeError, ValueError):
            stored = {}
        if isinstance(stored, dict):
            merged.update(stored)
    return merged


def _write_settings(values: dict[str, Any]) -> None:
    with tx() as conn:
        conn.execute(
            "INSERT INTO settings (id, json, updated_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
            (json.dumps(values, ensure_ascii=False), utc_now_iso()),
        )


def patch_settings(partial: dict[str, Any]) -> dict[str, Any]:
    """部分更新（AC-C1）：**只覆盖传入的键**，未传的保持原值。"""
    current = get_settings()
    updated = dict(current)
    updated.update(partial)
    _write_settings(updated)
    return updated


def set_ai_key(key: str) -> dict[str, Any]:
    current = get_settings()
    current["ai_key"] = (key or "").strip()
    _write_settings(current)
    return current


def clear_ai_key() -> dict[str, Any]:
    current = get_settings()
    current["ai_key"] = None
    _write_settings(current)
    return current


def effective_ai_key(raw: Optional[dict[str, Any]] = None) -> tuple[Optional[str], str]:
    """解析当前生效的 AI key 与来源。

    优先级：设置页写入（settings 表）> `.env`/环境变量（CONSTITUTION §3）。
    返回值只允许在 ai_client 内部使用；绝不写日志、绝不出现在响应里。
    """
    raw = raw or get_settings()
    stored = (raw.get("ai_key") or "").strip()
    if stored:
        return stored, "settings"
    from app.config import env_ai_key

    env_key = env_ai_key()
    if env_key:
        return env_key, "env"
    return None, "none"


def ai_base_url(raw: Optional[dict[str, Any]] = None) -> Optional[str]:
    raw = raw or get_settings()
    from app.config import ai_base_url as _env_base_url

    return (raw.get("ai_base_url") or "").strip() or _env_base_url()


def ai_model(raw: Optional[dict[str, Any]] = None) -> str:
    raw = raw or get_settings()
    from app.config import ai_model as _env_model

    return (raw.get("ai_model") or "").strip() or _env_model()


def _host_of(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    from urllib.parse import urlparse

    return urlparse(url).hostname or None


def ai_block(raw: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """契约 §4 的只读 `ai` 视图（永不含 key 明文）。"""
    raw = raw or get_settings()
    _, source = effective_ai_key(raw)
    return {
        "configured": source != "none",
        "base_url_host": _host_of(ai_base_url(raw)),
        "model": ai_model(raw),
        "key_source": source if source != "none" else None,
    }


def settings_response(raw: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """`GET /settings` / `PATCH /settings` 的响应体（剥私有字段）。"""
    raw = raw or get_settings()
    out = {key: raw.get(key) for key in PUBLIC_SETTING_KEYS}
    out["ai"] = ai_block(raw)
    return strip_private_settings(out)  # 防御层：私有 key 永不泄漏（AC-C2）


def strip_private_settings(raw: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in raw.items() if k not in PRIVATE_SETTING_KEYS}


# ---------------------------------------------------------------------------
# sets（题库）
# ---------------------------------------------------------------------------

def upsert_set(record: dict[str, Any]) -> None:
    """把一个 set JSON 写入 `sets`（同 id 覆盖，幂等）。"""
    with tx() as conn:
        conn.execute(
            "INSERT INTO sets (id, module, kind, target_band, title_zh, topic, source, generated_at, data_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET module=excluded.module, kind=excluded.kind, "
            "target_band=excluded.target_band, title_zh=excluded.title_zh, topic=excluded.topic, "
            "source=excluded.source, generated_at=excluded.generated_at, data_json=excluded.data_json",
            (
                record["id"],
                record["module"],
                record.get("kind"),
                record.get("target_band"),
                record.get("title_zh"),
                record.get("topic"),
                record.get("source"),
                record.get("generated_at"),
                json.dumps(record, ensure_ascii=False),
            ),
        )


def get_set(set_id: str) -> Optional[dict[str, Any]]:
    conn = connect()
    try:
        row = conn.execute("SELECT data_json FROM sets WHERE id = ?", (set_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return json.loads(row["data_json"])


def list_sets(module: str, **filters: Any) -> list[dict[str, Any]]:
    """按 module（+ 可选 target_band/kind/level/topic）列出 set 全文。"""
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT data_json FROM sets WHERE module = ? ORDER BY id", (module,)
        ).fetchall()
    finally:
        conn.close()
    out = [json.loads(r["data_json"]) for r in rows]
    for key, value in filters.items():
        if value is None:
            continue
        out = [s for s in out if s.get(key) == value]
    return out


def set_counts_by_module() -> dict[str, int]:
    conn = connect()
    try:
        rows = conn.execute("SELECT module, COUNT(*) AS n FROM sets GROUP BY module").fetchall()
    finally:
        conn.close()
    counts = {module: 0 for module in MODULES}
    for r in rows:
        counts[r["module"]] = r["n"]
    return counts


def refresh_sets_meta() -> dict[str, int]:
    counts = set_counts_by_module()
    with tx() as conn:
        for module, n in counts.items():
            conn.execute(
                "INSERT INTO sets_meta (module, count) VALUES (?, ?) "
                "ON CONFLICT(module) DO UPDATE SET count = excluded.count",
                (module, n),
            )
    return counts


# ---------------------------------------------------------------------------
# attempts（唯一练习事实表）
# ---------------------------------------------------------------------------

def new_attempt_id() -> str:
    return f"att_{uuid.uuid4().hex[:16]}"


def record_attempt(
    *,
    module: str,
    task_ref: str,
    report: dict[str, Any],
    band_overall: Optional[float] = None,
    band_sub: Optional[dict[str, Any]] = None,
    duration_sec: Optional[float] = None,
    part: Optional[str] = None,
    started_at: Optional[str] = None,
    ai_used: bool = False,
    degraded_reason: Optional[str] = None,
    approximate: bool = False,
    items: Optional[Iterable[dict[str, Any]]] = None,
    review: Optional[Iterable[dict[str, Any]]] = None,
    attempt_id: Optional[str] = None,
) -> str:
    """一次练习落库：attempt + attempt_items + practice_minutes +（可选）review_items。

    这是 AC-G2 的唯一写入口；`report` 是契约 §3 的模块报告，原样存 `raw_json`。
    """
    if module not in MODULES:
        raise ValueError(f"未知模块: {module}")
    attempt_id = attempt_id or new_attempt_id()
    band = band_overall
    if band is None:
        band = (report.get("band") or {}).get("overall") if isinstance(report.get("band"), dict) else report.get("band")
    now = utc_now_iso()
    with tx() as conn:
        conn.execute(
            "INSERT INTO attempts (id, module, task_ref, part, started_at, duration_sec, band_overall, "
            "band_sub_json, raw_json, ai_used, degraded_reason, approximate, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                attempt_id,
                module,
                task_ref,
                part,
                started_at,
                duration_sec,
                band,
                json.dumps(band_sub or {}, ensure_ascii=False),
                json.dumps(report, ensure_ascii=False),
                1 if ai_used else 0,
                degraded_reason,
                1 if approximate else 0,
                now,
            ),
        )
        for item in items or ():
            conn.execute(
                "INSERT INTO attempt_items (attempt_id, item_ref, item_number, question_type, prompt_ref, "
                "your_answer, expected, correct, reason, time_spent_sec, detail_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    attempt_id,
                    item.get("item_ref") or item.get("id"),
                    item.get("item_number") or item.get("number"),
                    item.get("question_type") or item.get("type"),
                    item.get("prompt_ref"),
                    _as_text(item.get("your_answer")),
                    _as_text(item.get("expected") or item.get("answer")),
                    _bool_to_int(item.get("correct")),
                    item.get("reason"),
                    item.get("time_spent_sec"),
                    json.dumps(item.get("detail") or {}, ensure_ascii=False),
                ),
            )
    for entry in review or ():
        record_review(
            module=module,
            item_ref=entry.get("item_ref"),
            question_type=entry.get("question_type"),
            error_type=entry.get("error_type", "other"),
            quote=entry.get("quote", ""),
            detail_zh=entry.get("detail_zh", ""),
            source_attempt_id=attempt_id,
        )
    day = iso_to_local_date(now) or today_local()
    recompute_practice_minutes(day)
    return attempt_id


def _as_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _bool_to_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    return 1 if value else 0


def _attempt_summary(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "module": row["module"],
        "task_ref": row["task_ref"],
        "part": row["part"],
        "band_overall": row["band_overall"],
        "duration_sec": row["duration_sec"],
        "ai_used": bool(row["ai_used"]),
        "degraded_reason": row["degraded_reason"],
        "approximate": bool(row["approximate"]),
        "started_at": row["started_at"],
        "created_at": row["created_at"],
    }


def list_attempts(
    module: Optional[str] = None, limit: int = 50, offset: int = 0
) -> tuple[list[dict[str, Any]], int]:
    conn = connect()
    try:
        where, params = ("module = ? AND 1=1", [module]) if module else ("1=1", [])
        total = conn.execute(f"SELECT COUNT(*) FROM attempts WHERE {where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM attempts WHERE {where} "
            f"ORDER BY {practice_at()} DESC, created_at DESC, id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
    finally:
        conn.close()
    return [_attempt_summary(r) for r in rows], total


def get_attempt(attempt_id: str) -> Optional[dict[str, Any]]:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
        if not row:
            return None
        items = conn.execute(
            "SELECT * FROM attempt_items WHERE attempt_id = ? ORDER BY id", (attempt_id,)
        ).fetchall()
    finally:
        conn.close()
    summary = _attempt_summary(row)
    payload = {}
    try:
        payload = json.loads(row["raw_json"] or "{}")
    except ValueError:
        payload = {}
    payload.setdefault("ai_used", bool(row["ai_used"]))
    payload.setdefault("degraded_reason", row["degraded_reason"])
    payload.setdefault("approximate", bool(row["approximate"]))
    return {
        "attempt": summary,
        "payload": payload,
        "band_sub": _load_json(row["band_sub_json"], {}),
        "items": [_attempt_item(r) for r in items],
    }


def _attempt_item(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["item_ref"],
        "number": row["item_number"],
        "type": row["question_type"],
        "your_answer": row["your_answer"],
        "expected": row["expected"],
        "correct": bool(row["correct"]) if row["correct"] is not None else None,
        "reason": row["reason"],
        "time_spent_sec": row["time_spent_sec"],
        "detail": _load_json(row["detail_json"], {}),
    }


def _load_json(text: Any, default: Any) -> Any:
    if not text:
        return default
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default


def delete_attempt(attempt_id: str) -> bool:
    """删除单条 attempt（attempt_items 级联删除，并重算当天练习时长 → FR-P4「重算趋势」）。"""
    conn = connect()
    try:
        row = conn.execute(
            "SELECT started_at, created_at FROM attempts WHERE id = ?", (attempt_id,)
        ).fetchone()
        if not row:
            return False
        dates = {iso_to_local_date(row["created_at"]), iso_to_local_date(row["started_at"] or "")}
        with conn:
            conn.execute("UPDATE speaking_turns SET attempt_id = NULL WHERE attempt_id = ?", (attempt_id,))
            conn.execute("DELETE FROM attempts WHERE id = ?", (attempt_id,))
    finally:
        conn.close()
    for day in filter(None, dates):
        recompute_practice_minutes(day)
    return True


# ---------------------------------------------------------------------------
# jobs（异步批改队列，契约 §1 行 20b/11b）
# ---------------------------------------------------------------------------

JOB_MODULES = ("writing", "speaking")
JOB_STATUS = ("queued", "running", "succeeded", "failed")
JOB_UNFINISHED = ("queued", "running")
"""未完成状态：启动时若还停在这两个状态，说明进程在批改中途退出。"""


def new_job_id() -> str:
    return f"job_{uuid.uuid4().hex[:16]}"


def create_job(*, module: str, task_ref: str, request: dict[str, Any], dedupe_key: Optional[str] = None) -> dict[str, Any]:
    """排队一条批改任务（状态 `queued`，执行交给 services/job_queue）。"""
    if module not in JOB_MODULES:
        raise ValueError(f"未知批改模块: {module}")
    job_id = new_job_id()
    with tx() as conn:
        conn.execute(
            "INSERT INTO jobs (id, module, task_ref, dedupe_key, status, request_json, created_at) "
            "VALUES (?, ?, ?, ?, 'queued', ?, ?)",
            (job_id, module, task_ref, dedupe_key, json.dumps(request, ensure_ascii=False), utc_now_iso()),
        )
    job = get_job(job_id)
    if job is None:  # pragma: no cover - 同事务刚提交，理论上不会丢
        raise RuntimeError(f"任务创建后无法读回: {job_id}")
    return job


def find_active_job(dedupe_key: str) -> Optional[dict[str, Any]]:
    """同一目标已在排队/执行时取回它（连点两次提交不该拿到两份批改）。"""
    placeholders = ",".join("?" for _ in JOB_UNFINISHED)
    conn = connect()
    try:
        row = conn.execute(
            f"SELECT * FROM jobs WHERE dedupe_key = ? AND status IN ({placeholders}) "
            "ORDER BY created_at DESC LIMIT 1",
            (dedupe_key, *JOB_UNFINISHED),
        ).fetchone()
    finally:
        conn.close()
    return _job_row(row) if row else None


def mark_job_running(job_id: str) -> None:
    with tx() as conn:
        conn.execute(
            "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'",
            (utc_now_iso(), job_id),
        )


def mark_job_succeeded(
    job_id: str,
    *,
    attempt_id: Optional[str],
    report: dict[str, Any],
    degraded_reason: Optional[str] = None,
) -> None:
    with tx() as conn:
        conn.execute(
            "UPDATE jobs SET status = 'succeeded', attempt_id = ?, report_json = ?, "
            "degraded_reason = ?, error = NULL, finished_at = ? WHERE id = ?",
            (attempt_id, json.dumps(report, ensure_ascii=False), degraded_reason, utc_now_iso(), job_id),
        )


def mark_job_failed(job_id: str, error: str) -> None:
    with tx() as conn:
        conn.execute(
            "UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
            (error, utc_now_iso(), job_id),
        )


def get_job(job_id: str) -> Optional[dict[str, Any]]:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    finally:
        conn.close()
    return _job_row(row) if row else None


def list_jobs(*, active_only: bool = False, limit: int = 50) -> list[dict[str, Any]]:
    conn = connect()
    try:
        if active_only:
            placeholders = ",".join("?" for _ in JOB_UNFINISHED)
            rows = conn.execute(
                f"SELECT * FROM jobs WHERE status IN ({placeholders}) ORDER BY created_at DESC LIMIT ?",
                (*JOB_UNFINISHED, max(1, int(limit))),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (max(1, int(limit)),)
            ).fetchall()
    finally:
        conn.close()
    return [_job_row(row) for row in rows]


def reap_interrupted_jobs(reason: str) -> int:
    """启动时把上次进程退出留下的未完成任务判为失败（否则前端会永远轮询到超时）。"""
    placeholders = ",".join("?" for _ in JOB_UNFINISHED)
    now = utc_now_iso()
    with tx() as conn:
        cur = conn.execute(
            f"UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE status IN ({placeholders})",
            (reason, now, *JOB_UNFINISHED),
        )
        return int(cur.rowcount or 0)


def prune_jobs(keep: int = 100) -> int:
    """只清理终态任务（`succeeded`/`failed`），保留最近 `keep` 条。"""
    limit = max(1, int(keep))
    with tx() as conn:
        cur = conn.execute(
            "DELETE FROM jobs WHERE status IN ('succeeded', 'failed') AND id NOT IN "
            "(SELECT id FROM jobs WHERE status IN ('succeeded', 'failed') ORDER BY created_at DESC LIMIT ?)",
            (limit,),
        )
        return int(cur.rowcount or 0)


def _job_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "module": row["module"],
        "task_ref": row["task_ref"],
        "status": row["status"],
        "attempt_id": row["attempt_id"],
        "report": _load_json(row["report_json"], None),
        "error": row["error"],
        "degraded_reason": row["degraded_reason"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
    }


# ---------------------------------------------------------------------------
# 统计（progress / analytics）——全部从 attempts 读
# ---------------------------------------------------------------------------

def latest_band_per_module() -> dict[str, Optional[float]]:
    """每科最近一次 band（契约 §1 行 26 的 `current`）。"""
    out: dict[str, Optional[float]] = {module: None for module in MODULES}
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT module, band_overall, created_at FROM attempts ORDER BY created_at DESC, id DESC"
        ).fetchall()
    finally:
        conn.close()
    for row in rows:
        module = row["module"]
        if module in out and out[module] is None and row["band_overall"] is not None:
            out[module] = row["band_overall"]
    return out


def previous_band_per_module() -> dict[str, Optional[float]]:
    """每科「上一次」band（用于 delta_vs_previous）。"""
    out: dict[str, Optional[float]] = {module: None for module in MODULES}
    seen: dict[str, int] = {}
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT module, band_overall FROM attempts ORDER BY created_at DESC, id DESC"
        ).fetchall()
    finally:
        conn.close()
    for row in rows:
        module = row["module"]
        if module not in out or row["band_overall"] is None:
            continue
        seen[module] = seen.get(module, 0) + 1
        if seen[module] == 2:
            out[module] = row["band_overall"]
    return out


def attempts_total() -> int:
    conn = connect()
    try:
        return conn.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]
    finally:
        conn.close()


def last_practice_at() -> Optional[str]:
    conn = connect()
    try:
        row = conn.execute("SELECT MAX(created_at) FROM attempts").fetchone()
    finally:
        conn.close()
    return row[0] if row and row[0] else None


def total_minutes() -> float:
    conn = connect()
    try:
        row = conn.execute("SELECT COALESCE(SUM(duration_sec), 0) FROM attempts").fetchone()
    finally:
        conn.close()
    return round((row[0] or 0) / 60.0, 1)


def trend(module: str, days: int = 90) -> list[dict[str, Any]]:
    """每科 band 趋势：按本地日历日取当天最后一条。"""
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=max(1, days))
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT band_overall, created_at FROM attempts "
            "WHERE module = ? AND band_overall IS NOT NULL AND created_at >= ? "
            "ORDER BY created_at ASC, id ASC",
            (module, cutoff.isoformat()),
        ).fetchall()
    finally:
        conn.close()
    by_day: dict[str, float] = {}
    for row in rows:
        day = iso_to_local_date(row["created_at"])
        if day:
            by_day[day] = row["band_overall"]
    return [{"date": day, "band": by_day[day]} for day in sorted(by_day)]


def composite_trend(days: int = 90) -> list[dict[str, Any]]:
    """未指定模块时的趋势：按本地日历日取当天所有 attempt band 的平均值（0.5 步长）。"""
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=max(1, days))
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT band_overall, created_at FROM attempts "
            "WHERE band_overall IS NOT NULL AND created_at >= ? ORDER BY created_at ASC, id ASC",
            (cutoff.isoformat(),),
        ).fetchall()
    finally:
        conn.close()
    buckets: dict[str, list[float]] = {}
    for row in rows:
        day = iso_to_local_date(row["created_at"])
        if day:
            buckets.setdefault(day, []).append(float(row["band_overall"]))
    return [
        {"date": day, "band": round(round(sum(buckets[day]) / len(buckets[day]) * 2) / 2, 1)}
        for day in sorted(buckets)
    ]


def question_type_accuracy(weeks: int = 8) -> list[dict[str, Any]]:
    """按题型正确率（听力/阅读；数据源 attempts + attempt_items）。"""
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(weeks=max(1, weeks))
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT i.question_type AS qt, i.correct AS correct, i.reason AS reason "
            "FROM attempt_items i JOIN attempts a ON a.id = i.attempt_id "
            "WHERE a.created_at >= ? AND i.question_type IS NOT NULL",
            (cutoff.isoformat(),),
        ).fetchall()
    finally:
        conn.close()
    acc: dict[str, dict[str, int]] = {}
    for row in rows:
        bucket = acc.setdefault(row["qt"], {"correct": 0, "total": 0})
        bucket["total"] += 1
        if row["correct"]:
            bucket["correct"] += 1
    out = []
    for qt in sorted(acc):
        total = acc[qt]["total"]
        correct = acc[qt]["correct"]
        out.append(
            {
                "question_type": qt,
                "correct": correct,
                "total": total,
                "accuracy": round(correct / total, 4) if total else 0.0,
            }
        )
    return out


def module_accuracy(weeks: int = 8) -> list[dict[str, Any]]:
    """按科目（听力/阅读）的正确率，契约 §1 行 28 的 `by_module`。

    与 `question_type_accuracy` **同源同过滤**（都取 `question_type` 非空的 `attempt_items` 行），
    所以两处的题量必须相等 —— 报告屏的分科磁贴和题型表因此不会互相打脸。
    口语/写作没有逐题对错，不会出现在结果里（不是 0%，是不显示）。
    """
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(weeks=max(1, weeks))
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT a.module AS module, i.correct AS correct "
            "FROM attempt_items i JOIN attempts a ON a.id = i.attempt_id "
            "WHERE a.created_at >= ? AND i.question_type IS NOT NULL",
            (cutoff.isoformat(),),
        ).fetchall()
    finally:
        conn.close()
    acc: dict[str, dict[str, int]] = {}
    for row in rows:
        if row["module"] not in OBJECTIVE_MODULES:
            continue
        bucket = acc.setdefault(row["module"], {"correct": 0, "total": 0})
        bucket["total"] += 1
        if row["correct"]:
            bucket["correct"] += 1
    out = []
    for module in OBJECTIVE_MODULES:
        if module not in acc:
            continue
        total = acc[module]["total"]
        correct = acc[module]["correct"]
        out.append(
            {
                "module": module,
                "correct": correct,
                "total": total,
                "accuracy": round(correct / total, 4) if total else 0.0,
            }
        )
    return out


# ---------------------------------------------------------------------------
# practice_minutes
# ---------------------------------------------------------------------------

def recompute_practice_minutes(day: str) -> float:
    """从 attempts 重算某天的练习分钟（写缓存表，保证删除 attempt 后一致）。"""
    conn = connect()
    try:
        rows = conn.execute("SELECT duration_sec, created_at, started_at FROM attempts").fetchall()
    finally:
        conn.close()
    minutes = 0.0
    count = 0
    for row in rows:
        days = {iso_to_local_date(row["created_at"]), iso_to_local_date(row["started_at"] or "")}
        if day in days:
            minutes += row["duration_sec"] or 0.0
            count += 1
    minutes = round(minutes / 60.0, 1)
    with tx() as conn:
        if count == 0:
            conn.execute("DELETE FROM practice_minutes WHERE date = ?", (day,))
        else:
            conn.execute(
                "INSERT INTO practice_minutes (date, minutes, attempts) VALUES (?, ?, ?) "
                "ON CONFLICT(date) DO UPDATE SET minutes = excluded.minutes, attempts = excluded.attempts",
                (day, minutes, count),
            )
    return minutes


def minutes_by_day(weeks: int = 8) -> list[dict[str, Any]]:
    """近 N 周每天的练习分钟（含 0 的空白日不返回，前端自行补格）。"""
    cutoff = _dt.date.today() - _dt.timedelta(weeks=max(1, weeks))
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT date, minutes FROM practice_minutes WHERE date >= ? ORDER BY date",
            (cutoff.isoformat(),),
        ).fetchall()
    finally:
        conn.close()
    return [{"date": r["date"], "minutes": r["minutes"]} for r in rows]


# ---------------------------------------------------------------------------
# review_items（错题本）
# ---------------------------------------------------------------------------

def review_id(module: str, item_ref: Optional[str], error_type: str, quote: str) -> str:
    """跨 attempt 的稳定身份 → 同一错误重复出现时累加 seen_count（AC-W4）。"""
    raw = "|".join([(module or ""), (item_ref or ""), (error_type or ""), (quote or "").strip().lower()])
    return f"rev_{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:20]}"


def record_review(
    *,
    module: str,
    error_type: str,
    quote: str = "",
    detail_zh: str = "",
    item_ref: Optional[str] = None,
    question_type: Optional[str] = None,
    source_attempt_id: Optional[str] = None,
) -> str:
    """upsert 错题：已存在则 `seen_count += 1` 并刷新 last_seen_at / detail。"""
    rid = review_id(module, item_ref, error_type, quote)
    now = utc_now_iso()
    with tx() as conn:
        existing = conn.execute(
            "SELECT status FROM review_items WHERE id = ?", (rid,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE review_items SET seen_count = COALESCE(seen_count, 0) + 1, last_seen_at = ?, "
                "detail_zh = COALESCE(NULLIF(?, ''), detail_zh), question_type = COALESCE(?, question_type), "
                "source_attempt_id = ?, status = CASE WHEN status = 'resolved' THEN 'resolved' ELSE 'open' END, "
                "resolved_at = NULL WHERE id = ?",
                (now, detail_zh, question_type, source_attempt_id, rid),
            )
        else:
            conn.execute(
                "INSERT INTO review_items (id, module, item_ref, question_type, error_type, quote, detail_zh, "
                "status, first_seen_at, last_seen_at, seen_count, resolved_at, source_attempt_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 1, NULL, ?)",
                (
                    rid,
                    module,
                    item_ref,
                    question_type,
                    error_type,
                    quote,
                    detail_zh,
                    now,
                    now,
                    source_attempt_id,
                ),
            )
    return rid


def _review_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "module": row["module"],
        "item_ref": row["item_ref"],
        "question_type": row["question_type"],
        "error_type": row["error_type"],
        "quote": row["quote"],
        "detail_zh": row["detail_zh"],
        "status": row["status"] or "open",
        "first_seen_at": row["first_seen_at"],
        "last_seen_at": row["last_seen_at"],
        "seen_count": row["seen_count"] if row["seen_count"] is not None else 1,
        "resolved_at": row["resolved_at"],
        "source_attempt_id": row["source_attempt_id"],
    }


def list_review_items(
    module: Optional[str] = None,
    status: Optional[str] = "open",
    error_type: Optional[str] = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    conn = connect()
    try:
        where, params = ["1=1"], []
        if module:
            where.append("module = ?")
            params.append(module)
        if error_type:
            where.append("error_type = ?")
            params.append(error_type)
        if status and status != "all":
            where.append("status = ?")
            params.append(status)
        rows = conn.execute(
            f"SELECT * FROM review_items WHERE {' AND '.join(where)} "
            "ORDER BY last_seen_at DESC, seen_count DESC LIMIT ?",
            params + [limit],
        ).fetchall()
    finally:
        conn.close()
    return [_review_row(r) for r in rows]


def get_review_item(review_id_value: str) -> Optional[dict[str, Any]]:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM review_items WHERE id = ?", (review_id_value,)).fetchone()
    finally:
        conn.close()
    return _review_row(row) if row else None


def resolve_review(review_id_value: str) -> Optional[dict[str, Any]]:
    now = utc_now_iso()
    conn = connect()
    try:
        with conn:
            conn.execute(
                "UPDATE review_items SET status = 'resolved', resolved_at = ? WHERE id = ?",
                (now, review_id_value),
            )
            row = conn.execute("SELECT * FROM review_items WHERE id = ?", (review_id_value,)).fetchone()
    finally:
        conn.close()
    return _review_row(row) if row else None


def delete_review(review_id_value: str) -> bool:
    with tx() as conn:
        cur = conn.execute("DELETE FROM review_items WHERE id = ?", (review_id_value,))
        return cur.rowcount > 0


def error_type_stats(weeks: int = 8) -> list[dict[str, Any]]:
    """按错误类型分布（写作/口语；契约 §1 行 28 的 by_error_type）。"""
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(weeks=max(1, weeks))
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT error_type, SUM(seen_count) AS cnt, MAX(last_seen_at) AS latest "
            "FROM review_items WHERE error_type IS NOT NULL AND last_seen_at >= ? "
            "GROUP BY error_type ORDER BY cnt DESC",
            (cutoff.isoformat(),),
        ).fetchall()
        out = []
        for row in rows:
            latest = conn.execute(
                "SELECT quote FROM review_items WHERE error_type = ? ORDER BY last_seen_at DESC LIMIT 1",
                (row["error_type"],),
            ).fetchone()
            out.append(
                {
                    "error_type": row["error_type"],
                    "count": row["cnt"] or 0,
                    "latest_quote": latest["quote"] if latest else None,
                }
            )
    finally:
        conn.close()
    return out


# ---------------------------------------------------------------------------
# vocab（生词本）
# ---------------------------------------------------------------------------

def _vocab_row(row: sqlite3.Row) -> dict[str, Any]:
    out = {
        "word": row["word"],
        "context": row["context"],
        "source_module": row["source_module"],
        "source_ref": row["source_ref"],
        "note_zh": row["note_zh"],
        "tags": _load_json(row["tags"], []),
        "created_at": row["created_at"],
    }
    phonetics = _load_json(row["phonetics_json"], {})
    if isinstance(phonetics, dict):
        out.update({k: v for k, v in phonetics.items() if k not in out})
    return out


def add_vocab(
    word: str,
    *,
    context: Optional[str] = None,
    source_module: Optional[str] = None,
    source_ref: Optional[str] = None,
    note_zh: Optional[str] = None,
    tags: Optional[Iterable[str]] = None,
    phonetics: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """收藏单词（重复收藏时更新非空字段，保留首次 created_at）。"""
    key = (word or "").strip().lower()
    if not key:
        raise ValueError("word 不能为空")
    now = utc_now_iso()
    with tx() as conn:
        conn.execute(
            "INSERT INTO vocab (word, context, source_module, source_ref, note_zh, tags, created_at, phonetics_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(word) DO UPDATE SET "
            "context = COALESCE(NULLIF(excluded.context, ''), vocab.context), "
            "source_module = COALESCE(NULLIF(excluded.source_module, ''), vocab.source_module), "
            "source_ref = COALESCE(NULLIF(excluded.source_ref, ''), vocab.source_ref), "
            "note_zh = COALESCE(NULLIF(excluded.note_zh, ''), vocab.note_zh), "
            "tags = CASE WHEN excluded.tags NOT IN ('[]', '') THEN excluded.tags ELSE vocab.tags END, "
            "phonetics_json = CASE WHEN excluded.phonetics_json NOT IN ('{}', '') "
            "THEN excluded.phonetics_json ELSE vocab.phonetics_json END",
            (
                key,
                context or "",
                source_module or "",
                source_ref or "",
                note_zh or "",
                json.dumps(list(tags or []), ensure_ascii=False),
                now,
                json.dumps(phonetics or {}, ensure_ascii=False),
            ),
        )
    return get_vocab(key) or {"word": key, "created_at": now}


def get_vocab(word: str) -> Optional[dict[str, Any]]:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM vocab WHERE word = ?", ((word or "").strip().lower(),)).fetchone()
    finally:
        conn.close()
    return _vocab_row(row) if row else None


def list_vocab(query: Optional[str] = None) -> list[dict[str, Any]]:
    conn = connect()
    try:
        if query:
            rows = conn.execute(
                "SELECT * FROM vocab WHERE word LIKE ? ORDER BY created_at DESC",
                (f"%{query.strip().lower()}%",),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM vocab ORDER BY created_at DESC").fetchall()
    finally:
        conn.close()
    return [_vocab_row(r) for r in rows]


def delete_vocab(word: str) -> bool:
    with tx() as conn:
        cur = conn.execute("DELETE FROM vocab WHERE word = ?", ((word or "").strip().lower(),))
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# plan_tasks
# ---------------------------------------------------------------------------

def upsert_plan_tasks(day: str, tasks: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """写入今日任务（幂等；已存在的任务保留它的 done 状态，未完成顺延）。"""
    now = utc_now_iso()
    stored: list[dict[str, Any]] = []
    with tx() as conn:
        for task in tasks:
            conn.execute(
                "INSERT INTO plan_tasks (id, date, module, set_ref, reason_zh, done, created_at) "
                "VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET "
                "module = excluded.module, set_ref = excluded.set_ref, reason_zh = excluded.reason_zh",
                (task["id"], day, task["module"], task.get("set_ref"), task.get("reason_zh", ""), now),
            )
            row = conn.execute("SELECT * FROM plan_tasks WHERE id = ?", (task["id"],)).fetchone()
            stored.append(_plan_row(row))
    return stored


def _plan_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "date": row["date"],
        "module": row["module"],
        "set_ref": row["set_ref"],
        "reason_zh": row["reason_zh"],
        "done": bool(row["done"]),
    }


def list_plan_tasks(day: str) -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM plan_tasks WHERE date = ? ORDER BY id", (day,)
        ).fetchall()
    finally:
        conn.close()
    return [_plan_row(r) for r in rows]


def get_plan_task(task_id: str) -> Optional[dict[str, Any]]:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM plan_tasks WHERE id = ?", (task_id,)).fetchone()
    finally:
        conn.close()
    return _plan_row(row) if row else None


def set_plan_task_done(task_id: str, done: bool) -> Optional[dict[str, Any]]:
    conn = connect()
    try:
        with conn:
            conn.execute("UPDATE plan_tasks SET done = ? WHERE id = ?", (1 if done else 0, task_id))
            row = conn.execute("SELECT * FROM plan_tasks WHERE id = ?", (task_id,)).fetchone()
    finally:
        conn.close()
    return _plan_row(row) if row else None


# ---------------------------------------------------------------------------
# speaking_sessions / speaking_turns（供 api/speaking.py 使用；路由不写裸 SQL）
# ---------------------------------------------------------------------------

def save_speaking_session(
    *,
    session_id: str,
    set_id: str,
    part: str,
    state: str,
    current_index: int = 0,
    result_attempt_id: Optional[str] = None,
) -> dict[str, Any]:
    now = utc_now_iso()
    with tx() as conn:
        conn.execute(
            "INSERT INTO speaking_sessions (id, set_id, part, state, current_index, created_at, updated_at, "
            "result_attempt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET set_id = excluded.set_id, part = excluded.part, "
            "state = excluded.state, current_index = excluded.current_index, updated_at = excluded.updated_at, "
            "result_attempt_id = COALESCE(excluded.result_attempt_id, speaking_sessions.result_attempt_id)",
            (session_id, set_id, str(part), state, current_index, now, now, result_attempt_id),
        )
    return get_speaking_session(session_id) or {}


def get_speaking_session(session_id: str) -> Optional[dict[str, Any]]:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM speaking_sessions WHERE id = ?", (session_id,)).fetchone()
        if not row:
            return None
        turns = conn.execute(
            "SELECT * FROM speaking_turns WHERE session_id = ? ORDER BY turn_index", (session_id,)
        ).fetchall()
    finally:
        conn.close()
    out = dict(zip(row.keys(), tuple(row)))
    out["turns"] = [dict(zip(t.keys(), tuple(t))) for t in turns]
    return out


def add_speaking_turn(
    *,
    session_id: str,
    turn_index: int,
    prompt_id: Optional[str] = None,
    prompt_text: Optional[str] = None,
    transcript: Optional[str] = None,
    confidence: Optional[float] = None,
    duration_sec: Optional[float] = None,
    attempt_id: Optional[str] = None,
) -> int:
    now = utc_now_iso()
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO speaking_turns (session_id, attempt_id, turn_index, prompt_id, prompt_text, "
            "transcript, confidence, duration_sec, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                session_id,
                attempt_id,
                turn_index,
                prompt_id,
                prompt_text,
                transcript,
                confidence,
                duration_sec,
                now,
            ),
        )
        return int(cur.lastrowid or 0)


# ---------------------------------------------------------------------------
# 测试/维护辅助
# ---------------------------------------------------------------------------

def table_names() -> list[str]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    finally:
        conn.close()
    return [r["name"] for r in rows]
