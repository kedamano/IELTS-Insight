"""阅读端点（契约 §1 行 17–19；验收 AC-R3、AC-R4、AC-R5、AC-G2）。

- 题面响应**必须剔除**答案字段（§2-R / §10.1），复用 `listening_grader.strip_answers`
  （两科同一套 LEAK_KEYS），`passage` 保留（原文定位是阅读的核心功能，非泄漏）；
- 无音频端点：阅读不需要 TTS；
- attempt 判分走纯函数 `reading_grader.grade`（`timed_out=True` 时未答题按 unanswered 记，
  AC-R3 到点自动提交），落库走 `db/store.py`（AC-G2），错题同步进 `review_items`（FR-V2）。
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query, Request

from app.api.common import bad_request, not_found, ok
from app.db import store
from app.services import reading_grader
from app.services.listening_grader import strip_answers

router = APIRouter(tags=["reading"])


def _meta(doc: dict[str, Any]) -> dict[str, Any]:
    """列表端点的 SetMeta：只给安全字段（不含 passage/答案）。"""
    return {
        "id": doc.get("id"),
        "module": doc.get("module"),
        "kind": doc.get("kind"),
        "level": doc.get("level"),
        "target_band": doc.get("target_band"),
        "title": doc.get("title"),
        "title_zh": doc.get("title_zh"),
        "topic": doc.get("topic"),
        "time_limit_sec": doc.get("time_limit_sec"),
        "word_count": doc.get("word_count"),
        "question_count": len(doc.get("questions") or []),
        "source": doc.get("source"),
        "generated_at": doc.get("generated_at"),
    }


async def _json_body(request: Request) -> Any:
    try:
        return await request.json()
    except Exception:
        raise bad_request("请求体应为合法 JSON") from None


def _json_body_required(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise bad_request("请求体必须是 JSON 对象")
    return body


def _get_reading_set(set_id: str) -> dict[str, Any]:
    doc = store.get_set(set_id)
    if not isinstance(doc, dict) or doc.get("module") != "reading":
        raise not_found(f"阅读套题不存在：{set_id}")
    return doc


def _check_duration(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise bad_request("duration_sec 应为数字（秒）")
    if value < 0:
        raise bad_request("duration_sec 不能为负数")
    return float(value)


def _check_timed_out(value: Any) -> bool:
    if value is None:
        return False
    if not isinstance(value, bool):
        raise bad_request("timed_out 应为布尔值")
    return value


@router.get("/reading/sets")
def list_sets(level: Optional[str] = Query(None), kind: Optional[str] = Query(None)):
    filters: dict[str, Any] = {}
    if level:
        filters["level"] = level
    if kind:
        filters["kind"] = kind
    docs = store.list_sets("reading", **filters)
    return ok({"items": [_meta(d) for d in docs]})


@router.get("/reading/sets/{set_id}")
def get_set(set_id: str):
    doc = _get_reading_set(set_id)
    return ok(strip_answers(doc))  # §2-R：题面无答案；passage 保留（定位/精读）


@router.post("/reading/sets/{set_id}/attempt")
async def post_attempt(set_id: str, request: Request):
    doc = _get_reading_set(set_id)
    body = _json_body_required(await _json_body(request))
    answers = body.get("answers")
    if answers is None:
        answers = {}
    if not isinstance(answers, dict):
        raise bad_request("answers 应为 {题目id: 答案文本} 对象")
    duration_sec = _check_duration(body.get("duration_sec"))
    timed_out = _check_timed_out(body.get("timed_out"))

    report = reading_grader.grade(doc, answers, duration_sec=duration_sec, timed_out=timed_out)
    report["attempt_id"] = store.new_attempt_id()
    _persist(doc, report, duration_sec)
    return ok(report)


def _persist(doc: dict[str, Any], report: dict[str, Any], duration_sec: Optional[float]) -> None:
    """AC-G2 落库 + FR-V2 错题本（一律走 store，路由不写裸 SQL，契约 §5）。"""
    prompts = {
        q.get("id"): (q.get("prompt") or q.get("statement") or "")
        for q in doc.get("questions") or []
    }
    review = [
        {
            "item_ref": item.get("id"),
            "question_type": item.get("type"),
            "error_type": item.get("reason") or "wrong",
            "quote": prompts.get(item.get("id"), ""),
            "detail_zh": item.get("explanation_zh") or "",
        }
        for item in report["items"]
        if not item["correct"]
    ]
    store.record_attempt(
        module="reading",
        task_ref=doc.get("id") or "",
        report=report,
        band_overall=report["band"],
        duration_sec=duration_sec,
        ai_used=False,
        approximate=False,
        items=report["items"],
        review=review,
        attempt_id=report["attempt_id"],
    )
