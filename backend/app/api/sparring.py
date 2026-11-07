"""1 对 1 口语陪练端点（契约 §1 行 51–57；FR-S7、AC-S7.1–S7.6）。

- 话题：#51/#52；
- 会话：#53 建、#54 读（刷新/重开接回）、#55 一轮作答 + 陪练官追问；
- 评分：#56 同步（脚本/调试用）、#57 异步（前端默认走这条，§10.6）。

本模块只做 HTTP 形状与错误码转换；状态机、追问回落与落库都在 `services/sparring.py`，
评分在 `speaking_grader` 纯函数里 —— 陪练报告与题库口语报告必须是同一个东西（§16.4）。
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, File, Form, Query, Request, UploadFile

from app.api.common import CODE_CONFLICT, CODE_TOO_LARGE, ApiError, bad_request, ok
from app.api.jobs import job_view
from app.db import store
from app.services import ai_client, job_queue, sparring

router = APIRouter(tags=["sparring"])

MAX_AUDIO_BYTES = 5 * 1024 * 1024  # 与 #10 同口径（AC-S3：>5MB → 413）


def _unwrap(action, *args, **kwargs):
    try:
        return action(*args, **kwargs)
    except sparring.SparringError as exc:
        raise ApiError(exc.status_code, exc.detail, exc.code) from exc


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except Exception:
        raise bad_request("请求体应为合法 JSON") from None
    if not isinstance(value, dict):
        raise bad_request("请求体必须是 JSON 对象")
    return value


# --------------------------------------------------------------------------
# 话题（#51 / #52）
# --------------------------------------------------------------------------

@router.get("/sparring/topics")
def list_topics(level: Optional[str] = Query(None)):
    items = _unwrap(sparring.list_topics, level if level not in (None, "") else None)
    return ok({"items": items})


@router.get("/sparring/topics/{topic_id}")
def get_topic(topic_id: str):
    return ok(_unwrap(sparring.topic_of, topic_id))


# --------------------------------------------------------------------------
# 会话（#53–#55）
# --------------------------------------------------------------------------

@router.post("/sparring/sessions")
async def create_session(request: Request):
    body = await _json_body(request)
    topic_id = str(body.get("topic_id") or "").strip()
    if not topic_id:
        raise bad_request("topic_id 不能为空")
    result = _unwrap(sparring.start_session, topic_id, body.get("level"))
    return ok(result)


@router.get("/sparring/sessions/{session_id}")
def get_session(session_id: str):
    return ok(_unwrap(sparring.session_view, session_id))


@router.post("/sparring/sessions/{session_id}/turn")
async def post_turn(
    session_id: str,
    audio: Optional[UploadFile] = File(None),
    text: Optional[str] = Form(None),
    duration_sec: Optional[str] = Form(None),
):
    """一轮作答：multipart `audio`（whisper 转写）或 form `text`（AC-S3b 键盘兜底）。"""
    data = await audio.read() if audio is not None else b""
    if audio is not None:
        if len(data) > MAX_AUDIO_BYTES:
            raise ApiError(413, "音频过大（上限 5MB），请分段录制后重试", CODE_TOO_LARGE)
        if not data:
            raise bad_request("音频为空，请重录或改用键盘输入文本", code="empty_audio")

    seconds: Optional[float] = None
    if duration_sec not in (None, ""):
        try:
            seconds = float(str(duration_sec).strip())
        except ValueError:
            raise bad_request("duration_sec 应为数字（秒）") from None

    fmt = "webm" if data[:4] == b"\x1a\x45\xdf\xa3" else "audio"
    result = _unwrap(
        sparring.add_turn,
        session_id,
        text=text,
        audio_bytes=data or None,
        duration_sec=seconds,
        input_format=fmt,
        # 出站许可只有一个判定点（契约 §15.2）：这里显式传，服务层才不用再猜
        allow_network=ai_client.network_allowed(),
    )
    return ok(result)


# --------------------------------------------------------------------------
# 评分（#56 / #57）
# --------------------------------------------------------------------------

@router.post("/sparring/sessions/{session_id}/assess")
def assess(session_id: str):
    report = _unwrap(sparring.assess, session_id, allow_network=ai_client.network_allowed())
    return ok(report)


@router.post("/sparring/sessions/{session_id}/assess/async")
def assess_async(session_id: str):
    """排队评分（#57）：先就地跑前置条件，再返回 `job_id`（契约 §10.6 条款 1/4）。"""
    view = _unwrap(sparring.session_view, session_id)
    if view["state"] == sparring.STATE_CLOSED:
        raise ApiError(409, "会话已关闭，无法评分", CODE_CONFLICT)
    has_answer = any(
        str(item.get("text") or "").strip() for item in view["messages"] if item.get("role") == "user"
    )
    if not has_answer:
        raise bad_request("还没有任何作答，无法评分", code="empty_answer")

    dedupe_key = f"sparring:{session_id}"
    existing = store.find_reusable_job(dedupe_key)
    if existing:
        return ok(job_view(existing))

    job = store.create_job(
        module="speaking",  # jobs.module 只有 speaking/writing 两种（§10.6 与 store.JOB_MODULES）
        task_ref=session_id,
        request={"session_id": session_id, "mode": "sparring"},
        dedupe_key=dedupe_key,
    )
    job_queue.submit(
        job["id"],
        lambda: sparring.assess(session_id, allow_network=ai_client.network_allowed()),
    )
    return ok(job_view(job))
