"""写作端点（契约 §1 行 20–22b；FR-W1/W3/W3b/W4/W5、AC-W1/W3/W3b/W4、AC-G2）。

- `GET /writing/tasks` 返回任务文档（含 `chart`，前端本地 SVG 渲染，AC-W1）；
- `POST /writing/attempts` 走 `writing_grader`（字数惩罚在 LLM 之前，AC-W3b），
  落库 + 错题本（AC-W4：`review_items` 按 7 类聚合，跨次累计 seen_count）；
- `POST /writing/attempts/async` 只做廉价校验并排队，立刻返回 `job_id`（契约 §1 行 20b）：
  推理模型一次要 1–2 分钟，同步等会让用户以为程序卡死；结果由 `GET /jobs/{job_id}` 轮询；
- `GET /writing/attempts/{attempt_id}` 从 `attempts.raw_json` 复原报告（§10.2：报告内叫 `attempt_id`）；
- AI 不可用时不 500：本地近似报告 + `ai_used=false` + `approximate=true`（FR-W5、CONSTITUTION §3）。
"""
from __future__ import annotations

import hashlib
from typing import Any, Optional

from fastapi import APIRouter, Query, Request

from app.api.common import bad_request, not_found, ok
from app.api.jobs import job_view
from app.db import store
from app.services import ai_client, job_queue, writing_grader

router = APIRouter(tags=["writing"])

TASKS = ("task1", "task2")


def _writing_set(task_id: str) -> dict[str, Any]:
    doc = store.get_set(task_id)
    if not isinstance(doc, dict) or doc.get("module") != "writing":
        raise not_found(f"写作任务不存在：{task_id}")
    return doc


def _task_meta(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": doc.get("id"),
        "module": doc.get("module"),
        "kind": doc.get("kind"),
        "task": doc.get("task") or doc.get("kind"),
        "target_band": doc.get("target_band"),
        "title_zh": doc.get("title_zh"),
        "topic": doc.get("topic"),
        "question_type": doc.get("question_type"),
        "prompt": doc.get("prompt"),
        "min_words": doc.get("min_words"),
        "time_recommend_sec": doc.get("time_recommend_sec"),
        "outline_hint": doc.get("outline_hint"),
        "chart": doc.get("chart"),  # AC-W1：图表数据随任务下发，前端本地渲染
        "source": doc.get("source"),
        "generated_at": doc.get("generated_at"),
    }


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except Exception:
        raise bad_request("请求体应为合法 JSON") from None
    if not isinstance(value, dict):
        raise bad_request("请求体必须是 JSON 对象")
    return value


def _check_duration(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise bad_request("duration_sec 应为数字（秒）")
    if value < 0:
        raise bad_request("duration_sec 不能为负数")
    return float(value)


def _validate(body: dict[str, Any]) -> tuple[dict[str, Any], str, Optional[float]]:
    """同步与异步共用的入站校验：题面存在、作文非空、时长是数字。

    异步端点也跑它，用户不必排队两分钟才发现自己没写字或题目 ID 写错。
    """
    task_id = str(body.get("task_id") or "").strip()
    if not task_id:
        raise bad_request("task_id 不能为空")
    doc = _writing_set(task_id)

    response = body.get("response")
    if response is not None and not isinstance(response, str):
        raise bad_request("response 应为字符串（考生作文）")
    if not str(response or "").strip():
        raise bad_request("作文为空，无法批改", code="empty_response")

    return doc, str(response), _check_duration(body.get("duration_sec"))


def _grade_and_record(body: dict[str, Any]) -> dict[str, Any]:
    """批改 + 落库 + 错题本，返回契约 §3-W 报告（同步端点与异步 worker 共用）。"""
    doc, response, duration_sec = _validate(body)
    settings_row = store.get_settings()
    target_band = settings_row.get("target_band")

    report = writing_grader.grade(
        doc,
        response,
        duration_sec=duration_sec,
        target_band=float(target_band) if isinstance(target_band, (int, float)) else None,
        allow_network=ai_client.network_allowed(),
    )
    report["attempt_id"] = store.new_attempt_id()
    report["task_ref"] = str(body.get("task_id") or "").strip()
    if body.get("draft_saved_at"):
        report["draft_saved_at"] = str(body["draft_saved_at"])

    band = report.get("band") or {}
    store.record_attempt(
        module="writing",
        task_ref=report["task_ref"],
        report=report,
        band_overall=band.get("overall") if isinstance(band, dict) else None,
        band_sub=band if isinstance(band, dict) else {},
        duration_sec=duration_sec,
        started_at=str(body.get("started_at") or "") or None,
        ai_used=bool(report.get("ai_used")),
        degraded_reason=report.get("degraded_reason"),
        approximate=bool(report.get("approximate")),
        review=writing_grader.build_review_entries(report),  # AC-W4
        attempt_id=report["attempt_id"],
    )
    return report


@router.get("/writing/tasks")
def list_tasks(module: Optional[str] = Query(None)):
    wanted = (module or "").strip() or None
    if wanted and wanted not in TASKS:
        raise bad_request(f"module 只能是 {TASKS[0]} 或 {TASKS[1]}")
    docs = store.list_sets("writing", **({"task": wanted} if wanted else {}))
    return ok({"items": [_task_meta(doc) for doc in docs]})


@router.get("/writing/tasks/{task_id}")
def get_task(task_id: str):
    return ok(_task_meta(_writing_set(task_id)))


@router.post("/writing/attempts")
async def post_attempt(request: Request):
    body = await _json_body(request)
    return ok(_grade_and_record(body))


@router.post("/writing/attempts/async")
async def post_attempt_async(request: Request):
    """排队批改：立即返回 `job_id`，结果用 `GET /jobs/{job_id}` 轮询（契约 §1 行 20b）。

    同一篇作文重复提交（连点两次）复用仍在排队的任务，不会产出两份批改记录。
    """
    body = await _json_body(request)
    _doc, response, _duration = _validate(body)
    task_id = str(body.get("task_id") or "").strip()
    dedupe_key = f"writing:{task_id}:{hashlib.sha1(response.encode()).hexdigest()[:16]}"

    existing = store.find_active_job(dedupe_key)
    if existing:
        return ok(job_view(existing))

    job = store.create_job(
        module="writing",
        task_ref=task_id,
        request=body,
        dedupe_key=dedupe_key,
    )
    job_queue.submit(job["id"], lambda: _grade_and_record(body))
    return ok(job_view(job))


@router.get("/writing/attempts/{attempt_id}")
def get_attempt(attempt_id: str):
    record = store.get_attempt(attempt_id)
    if not record or record["attempt"].get("module") != "writing":
        raise not_found(f"写作批改记录不存在：{attempt_id}")
    payload = record.get("payload") or {}
    payload.setdefault("attempt_id", attempt_id)
    return ok(payload)
