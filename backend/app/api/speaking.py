"""口语端点（契约 §1 行 6–12；FR-S1/S2/S3/S4/S6、AC-S1/S2/S3/S3b/S4/S6、AC-G2）。

- 题面：`GET /speaking/sets*`（口语题没有答案字段，无需 §10.1 的答案剔除）；
- 会话：`POST /speaking/sessions` → `POST .../turn`（multipart 音频 **或** form 文本，AC-S3/S3b）
  → `POST .../assess`（§3-S 报告 + 落库）；`POST .../assess/async` 只排队并返回 `job_id`，
  结果由 `GET /jobs/{job_id}` 轮询（契约 §1 行 11b：批改要 1–2 分钟，不该让用户干等）；
- 追问：`POST /speaking/followups`（FR-S6，AI 失败回题库预置追问，AC-S6）；
- 一切状态与落库都在 `services/speaking_session.py` 里，本模块只做 HTTP 形状与错误码转换；
- whisper 只在真的收到音频时才被导入（`services/stt_service` 懒加载，CONSTITUTION §6 的启动开销）。
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, File, Form, Query, Request, UploadFile

from app.api.common import CODE_CONFLICT, CODE_TOO_LARGE, ApiError, bad_request, not_found, ok
from app.api.jobs import job_view
from app.db import store
from app.services import ai_client, job_queue, speaking_session

router = APIRouter(tags=["speaking"])

MAX_AUDIO_BYTES = 5 * 1024 * 1024  # AC-S3：>5MB → 413


def _unwrap(action, *args, **kwargs):
    """把服务层的业务错误转成契约 §0 的 {detail, code} 响应。"""
    try:
        return action(*args, **kwargs)
    except speaking_session.SpeakingSessionError as exc:
        raise ApiError(exc.status_code, exc.detail, exc.code) from exc


# --------------------------------------------------------------------------
# 题面（行 6–7）
# --------------------------------------------------------------------------

@router.get("/speaking/sets")
def list_sets(target_band: Optional[str] = Query(None)):
    wanted: Optional[float] = None
    if target_band not in (None, ""):
        try:
            wanted = float(target_band)
        except ValueError:
            raise bad_request("target_band 应为数字（如 6.5）") from None
    docs = store.list_sets("speaking", **({"target_band": wanted} if wanted is not None else {}))
    return ok({"items": [speaking_session.set_meta(doc) for doc in docs]})


@router.get("/speaking/sets/{set_id}")
def get_set(set_id: str):
    doc = store.get_set(set_id)
    if not isinstance(doc, dict) or doc.get("module") != "speaking":
        raise not_found(f"口语套题不存在：{set_id}")
    return ok(doc)


# --------------------------------------------------------------------------
# 会话（行 8–11）
# --------------------------------------------------------------------------

async def _json_body(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except Exception:
        raise bad_request("请求体应为合法 JSON") from None
    if not isinstance(value, dict):
        raise bad_request("请求体必须是 JSON 对象")
    return value


@router.post("/speaking/sessions")
async def create_session(request: Request):
    body = await _json_body(request)
    set_id = str(body.get("set_id") or "").strip()
    if not set_id:
        raise bad_request("set_id 不能为空")
    part = body.get("part")
    if part is None:
        raise bad_request("part 必填（1/2/3，契约 §10.1）")
    question_id = body.get("question_id")
    result = _unwrap(
        speaking_session.start_session,
        set_id,
        part,
        str(question_id) if question_id else None,
    )
    return ok(result)


@router.get("/speaking/sessions/{session_id}")
def get_session(session_id: str):
    return ok(_unwrap(speaking_session.session_view, session_id))


@router.post("/speaking/sessions/{session_id}/turn")
async def post_turn(
    session_id: str,
    audio: Optional[UploadFile] = File(None),
    text: Optional[str] = Form(None),
    duration_sec: Optional[str] = Form(None),
):
    """一次作答：multipart `audio`（whisper 转写）或 form `text`（AC-S3b 键盘兜底）。"""
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
        speaking_session.add_turn,
        session_id,
        text=text,
        audio_bytes=data or None,
        duration_sec=seconds,
        input_format=fmt,
    )
    return ok(result)


@router.post("/speaking/sessions/{session_id}/assess")
def assess(session_id: str):
    report = _unwrap(
        speaking_session.assess,
        session_id,
        allow_network=ai_client.network_allowed(),
    )
    return ok(report)


@router.post("/speaking/sessions/{session_id}/assess/async")
def assess_async(session_id: str):
    """排队评分：立即返回 `job_id`（契约 §1 行 11b）。

    先把 `assess` 的两条前置条件就地跑一遍（会话存在/未关闭、至少有一次作答），
    这样明显不该批改的请求不用等排到队才报错；同一会话重复提交复用未完成任务。
    """
    view = _unwrap(speaking_session.session_view, session_id)
    if view["state"] == "closed":
        raise ApiError(409, "会话已关闭，无法评分", CODE_CONFLICT)
    if not any(str(turn.get("transcript") or "").strip() for turn in view["turns"]):
        raise bad_request("还没有任何作答，无法评分", code="empty_answer")

    dedupe_key = f"speaking:{session_id}"
    existing = store.find_active_job(dedupe_key)
    if existing:
        return ok(job_view(existing))

    job = store.create_job(
        module="speaking",
        task_ref=session_id,
        request={"session_id": session_id},
        dedupe_key=dedupe_key,
    )
    job_queue.submit(
        job["id"],
        lambda: speaking_session.assess(session_id, allow_network=ai_client.network_allowed()),
    )
    return ok(job_view(job))


# --------------------------------------------------------------------------
# Part 3 动态追问（行 12）
# --------------------------------------------------------------------------

@router.post("/speaking/followups")
async def followups(request: Request):
    body = await _json_body(request)
    set_id = str(body.get("set_id") or "").strip()
    if not set_id:
        raise bad_request("set_id 不能为空")
    transcript = str(body.get("part2_transcript") or body.get("transcript") or "")
    count = body.get("count") or 3
    result = _unwrap(
        speaking_session.followups,
        set_id,
        transcript,
        count,
        allow_network=ai_client.network_allowed(),
    )
    return ok(result)
