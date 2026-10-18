"""L3 API 契约测试的共用件（test-plan §2-L3）。

设计原则：
- **不依赖 store.py 的函数签名**（T2/T8 正在改它）。测试数据用契约 §5 的表/列名直接写 sqlite，
  这样"能不能落库"由 schema 决定，而不是由某个还没写出来的 helper 决定。
- 读接口一律只断言契约 §1/§3 写明的字段名，实现多给的字段不算失败。
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any

MODULES = ("speaking", "listening", "reading", "writing")

# 契约 §0：所有含评分的响应都必须带的公共字段
AI_FIELDS = ("ai_used", "degraded_reason", "model", "approximate")

DEGRADED_ENUM = (
    "no_api_key",
    "network_error",
    "timeout",
    "invalid_model_output",
    "incomplete_dimensions",
    "offline_template",
    None,
)

def is_iso8601(value: Any) -> bool:
    """契约 §0：时间是 ISO-8601 字符串（允许带/不带时区、允许 Z 或 +00:00）。"""
    import datetime as dt

    if not isinstance(value, str) or not value.strip():
        return False
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt.datetime.fromisoformat(text)
    except ValueError:
        return False
    return True


def utc_text(value: Any) -> bool:
    """UTC 表述（Z 或 +00:00）；本地时间要失败 —— 契约 §0 要求 ISO-8601 UTC。"""
    if not isinstance(value, str):
        return False
    return value.endswith("Z") or "+00:00" in value


# --------------------------------------------------------------------------
# 直接写库（仅测试用；生产写入必须走 store.py，见契约 §5）
# --------------------------------------------------------------------------
def seed_attempt(conn: sqlite3.Connection, spec: dict[str, Any]) -> str:
    """插一条 attempts（+可选 attempt_items / speaking_turns / speaking_sessions / practice_minutes）。"""
    attempt_id = spec["id"]
    conn.execute(
        "INSERT INTO attempts (id, module, task_ref, part, started_at, duration_sec, band_overall, "
        "band_sub_json, raw_json, ai_used, degraded_reason, approximate, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            attempt_id,
            spec["module"],
            spec.get("task_ref", f"seed_{attempt_id}"),
            spec.get("part"),
            spec.get("started_at"),
            spec.get("duration_sec"),
            spec.get("band_overall"),
            json.dumps(spec.get("band_sub") or {}, ensure_ascii=False),
            json.dumps(spec.get("payload") or {}, ensure_ascii=False),
            1 if spec.get("ai_used") else 0,
            spec.get("degraded_reason"),
            1 if spec.get("approximate") else 0,
            spec["created_at"],
        ),
    )
    for item in spec.get("items") or []:
        conn.execute(
            "INSERT INTO attempt_items (attempt_id, item_ref, item_number, question_type, prompt_ref, "
            "your_answer, expected, correct, reason, time_spent_sec, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                attempt_id,
                item.get("item_ref", "q1"),
                item.get("item_number", 1),
                item.get("question_type", "gap_fill"),
                item.get("prompt_ref"),
                item.get("your_answer", "x"),
                item.get("expected", "x"),
                1 if item.get("correct") else 0,
                item.get("reason"),
                item.get("time_spent_sec"),
                json.dumps(item.get("detail") or {}, ensure_ascii=False),
            ),
        )
    for turn in spec.get("turns") or []:
        conn.execute(
            "INSERT INTO speaking_turns (session_id, attempt_id, turn_index, prompt_id, prompt_text, "
            "transcript, confidence, duration_sec, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                turn.get("session_id", f"sess_{attempt_id}"),
                attempt_id,
                turn.get("turn_index", 0),
                turn.get("prompt_id", "q1"),
                turn.get("prompt_text", "Describe a skill."),
                turn.get("transcript", "well you know I think it is fine"),
                turn.get("confidence", 0.9),
                turn.get("duration_sec", 30.0),
                turn.get("started_at", spec["created_at"]),
            ),
        )
    if spec.get("session_state"):
        conn.execute(
            "INSERT OR REPLACE INTO speaking_sessions (id, set_id, part, state, current_index, created_at, updated_at, result_attempt_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                f"sess_{attempt_id}",
                spec.get("task_ref", "sp_p2_test_01"),
                spec.get("part", "2"),
                spec["session_state"],
                spec.get("current_index", 0),
                spec["created_at"],
                spec["created_at"],
                attempt_id if spec["session_state"] == "assessed" else None,
            ),
        )
    conn.commit()
    return attempt_id


def seed_minutes(conn: sqlite3.Connection, date: str, minutes: float, attempts: int = 1) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO practice_minutes (date, minutes, attempts) VALUES (?, ?, ?)",
        (date, minutes, attempts),
    )
    conn.commit()


def seed_review_item(conn: sqlite3.Connection, **spec: Any) -> str:
    item_id = spec["id"]
    conn.execute(
        "INSERT INTO review_items (id, module, item_ref, question_type, error_type, quote, detail_zh, status, "
        "first_seen_at, last_seen_at, seen_count, resolved_at, source_attempt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            item_id,
            spec["module"],
            spec.get("item_ref", "q1"),
            spec.get("question_type", "grammar"),
            spec.get("error_type", "grammar"),
            spec.get("quote", "people is"),
            spec.get("detail_zh", "主谓一致"),
            spec.get("status", "open"),
            spec.get("first_seen_at", "2026-01-01T00:00:00Z"),
            spec.get("last_seen_at", spec.get("first_seen_at", "2026-01-01T00:00:00Z")),
            spec.get("seen_count", 1),
            spec.get("resolved_at"),
            spec.get("source_attempt_id"),
        ),
    )
    conn.commit()
    return item_id


SEED_ROWS: tuple[dict[str, Any], ...] = (
    {
        "id": "att_seed_li_1",
        "module": "listening",
        "task_ref": "li_s2_test_01",
        "duration_sec": 300,
        "band_overall": 7.0,
        "band_sub": {},
        "created_at": "2026-01-05T00:00:00Z",
        "started_at": "2026-01-05T00:00:00Z",
        "payload": {
            "attempt_id": "att_seed_li_1",
            "module": "listening",
            "raw_correct": 16,
            "raw_total": 20,
            "band": 7.0,
            "band_scale": "listening_20q",
            "ai_used": False,
            "approximate": False,
            "items": [
                {
                    "id": "q1",
                    "number": 11,
                    "type": "gap_fill",
                    "your_answer": "9:30",
                    "expected": "9:30",
                    "correct": True,
                    "reason": None,
                    "explanation_zh": "原文直给",
                }
            ],
            "by_question_type": {"gap_fill": {"correct": 1, "total": 1}},
            "transcript": "The museum opens at 9:30.",
            "accuracy": 0.8,
        },
        "items": [
            {
                "item_ref": "q1",
                "item_number": 11,
                "question_type": "gap_fill",
                "your_answer": "9:30",
                "expected": "9:30",
                "correct": True,
                "time_spent_sec": 20,
            },
            {
                "item_ref": "q2",
                "item_number": 12,
                "question_type": "multiple_choice",
                "your_answer": "A",
                "expected": "B",
                "correct": False,
                "reason": "wrong",
                "time_spent_sec": 30,
            },
        ],
    },
    {
        "id": "att_seed_re_1",
        "module": "reading",
        "task_ref": "re_h_test_01",
        "duration_sec": 500,
        "band_overall": 6.0,
        "created_at": "2026-01-06T00:00:00Z",
        "payload": {
            "attempt_id": "att_seed_re_1",
            "module": "reading",
            "raw_correct": 8,
            "raw_total": 13,
            "band": 6.0,
            "band_scale": "reading_13q",
            "ai_used": False,
            "approximate": False,
            "items": [],
            "by_question_type": {},
            "accuracy": 0.615,
        },
    },
    {
        "id": "att_seed_sp_1",
        "module": "speaking",
        "task_ref": "sp_p2_test_01",
        "part": "2",
        "duration_sec": 120,
        "band_overall": 6.5,
        "band_sub": {"fluency_coherence": 6.5, "lexical_resource": 6.0},
        "ai_used": True,
        "created_at": "2026-01-07T00:00:00Z",
        "payload": {
            "attempt_id": "att_seed_sp_1",
            "ai_used": True,
            "degraded_reason": None,
            "approximate": False,
            "model": "glm-4.6",
            "band": {
                "overall": 6.5,
                "fluency_coherence": 6.5,
                "lexical_resource": 6.0,
                "grammatical_range_accuracy": 6.0,
                "pronunciation": 7.0,
                "pronunciation_confidence": "low",
            },
            "evidence": [{"criterion": "lexical_resource", "quote": "a lot of good things", "why": "用词空泛", "level": "6.0"}],
            "strengths": ["能连贯说完"],
            "improvements": [],
            "metrics": {"word_count": 120, "wpm": 60, "pause_total_sec": 4.0, "fillers": ["you know"], "repeats": 1},
        },
        "turns": [{"session_id": "sess_seed_sp_1", "transcript": "a lot of good things you know"}],
        "session_state": "assessed",
    },
    {
        "id": "att_seed_sp_2",
        "module": "speaking",
        "task_ref": "sp_p1_test_01",
        "part": "1",
        "band_overall": None,
        "created_at": "2026-01-04T00:00:00Z",
        "turns": [{"session_id": "sess_seed_sp_2", "transcript": "I work in a shop"}],
        "session_state": "active",
    },
    {
        "id": "att_seed_wr_1",
        "module": "writing",
        "task_ref": "w1_line_test_01",
        "duration_sec": 900,
        "band_overall": 5.5,
        "ai_used": True,
        "created_at": "2026-01-08T00:00:00Z",
        "payload": {
            "attempt_id": "att_seed_wr_1",
            "task": "task1",
            "ai_used": True,
            "degraded_reason": None,
            "approximate": False,
            "model": "glm-4.6",
            "band": {"overall": 5.5, "task_response": 5.5, "coherence_cohesion": 6.0},
            "word_count": 149,
            "word_count_penalty": {"kind": "under_length", "missing_words": 1},
            "corrections": [{"quote": "people is", "error_type": "grammar", "explanation_zh": "主谓一致", "suggestion": "people are", "severity": "high"}],
            "error_summary": {"grammar": 1},
        },
    },
)


def attempt_payload(row: dict[str, Any]) -> dict[str, Any]:
    return json.loads(row["raw_json"])


def first(seq, pred):
    """返回第一个满足 pred 的元素，没有则 None（避免测试里写一堆 next(...) 样板）。"""
    return next((x for x in seq if pred(x)), None)


def items_of(data: dict[str, Any]) -> list[dict[str, Any]]:
    """契约 §1：列表端点的 data 一律是 ``{items: [...], ...}``。"""
    assert isinstance(data, dict), f"列表端点应返回对象，实际 {type(data).__name__}"
    assert "items" in data, f"响应缺少 items 数组（契约 §1）：{list(data)}"
    assert isinstance(data["items"], list), f"items 必须是数组，实际 {type(data['items']).__name__}"
    return data["items"]
