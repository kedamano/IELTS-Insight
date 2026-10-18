"""听力端点（契约 §1 行 13–16；验收 AC-L1、AC-L1b、AC-L2、AC-L5、AC-G2）。

- 题面响应**必须剔除**答案字段（§2-L / §10.1），由 `listening_grader.strip_answers` 保证，
  `audio_text` 保留（AC-L1b 原文精读回落）；
- 音频由 edge-tts 合成 + MD5 磁盘缓存：复用 `api/media.py` 的合成/缓存路径（它已处理
  音色规范化与 (text, voice, speed) 缓存键），本模块只补 `X-Audio-Cache: hit|miss` 头（AC-L1）；
- TTS 失败 → 503 `{code:"tts_unavailable", transcript_available:true}`，绝不白屏（AC-L1b）；
- attempt 判分走纯函数 grader，落库走 `db/store.py`（AC-G2：attempts 是唯一练习事实表），
  错题同步进 `review_items`（FR-V2）。
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from app.api import media
from app.api.common import bad_request, not_found, ok
from app.config import settings as _cfg
from app.db import store
from app.services import listening_grader

router = APIRouter(tags=["listening"])

_ACCENTS = ("en-GB", "en-US")


def _meta(doc: dict[str, Any]) -> dict[str, Any]:
    """列表端点的 SetMeta：只给安全字段（不含任何 audio_text/答案）。"""
    return {
        "id": doc.get("id"),
        "module": doc.get("module"),
        "kind": doc.get("kind"),
        "section": doc.get("section"),
        "sections_covered": doc.get("sections_covered"),
        "target_band": doc.get("target_band"),
        "title_zh": doc.get("title_zh"),
        "topic": doc.get("topic"),
        "instruction_zh": doc.get("instruction_zh"),
        "question_count": len(doc.get("questions") or []),
        "source": doc.get("source"),
        "generated_at": doc.get("generated_at"),
    }


async def _json_body(request: Request) -> Any:
    try:
        return await request.json()
    except Exception:
        raise bad_request("请求体应为合法 JSON") from None


def _get_listening_set(set_id: str) -> dict[str, Any]:
    doc = store.get_set(set_id)
    if not isinstance(doc, dict) or doc.get("module") != "listening":
        raise not_found(f"听力套题不存在：{set_id}")
    return doc


@router.get("/listening/sets")
def list_sets(accent: Optional[str] = Query(None), kind: Optional[str] = Query(None)):
    docs = store.list_sets("listening", **({"kind": kind} if kind else {}))
    return ok({"items": [_meta(d) for d in docs]})


@router.get("/listening/sets/{set_id}")
def get_set(set_id: str):
    doc = _get_listening_set(set_id)
    return ok(listening_grader.strip_answers(doc))  # §2-L：题面无答案；audio_text 保留（§10.1）


@router.get("/listening/sets/{set_id}/audio")
async def get_audio(set_id: str, accent: Optional[str] = Query(None)):
    """audio/mpeg + `X-Audio-Cache: hit|miss`（AC-L1）。失败 503 可见降级（AC-L1b）。"""
    doc = _get_listening_set(set_id)
    text = (doc.get("audio_text") or "").strip()
    if not text:
        raise bad_request("该套题缺少 audio_text，无法合成音频")

    requested = (accent or "").strip()
    if requested and requested not in _ACCENTS:
        raise bad_request(f"accent 只能是 {' 或 '.join(_ACCENTS)}")
    voice_key = requested or doc.get("audio_voice") or store.get_settings().get("tts_voice") or "en-GB"
    voice = media._normalize_voice(voice_key)  # 非法音色 → 400（契约 §0）

    if not _cfg.ONLINE:
        return _audio_unavailable("已关闭联网，无法合成音频；可进入原文精读模式")

    from pathlib import Path

    cached = media._cache_path(text, voice, 1.0)
    hit = cached.exists() and cached.stat().st_size > 0
    try:
        path_str = await media._synthesize(text, voice, 1.0)
    except Exception as exc:  # 失败可见：503 + 机器码，不伪装成成功（CONSTITUTION §3）
        print(f"[ListeningAudio] TTS 异常: {type(exc).__name__}: {exc}", flush=True)
        return _audio_unavailable("语音合成失败（网络不可用？），可改用原文精读模式")
    if not path_str:
        return _audio_unavailable("语音合成失败（网络不可用？），可改用原文精读模式")

    return FileResponse(
        Path(path_str),
        media_type="audio/mpeg",
        filename=f"{set_id}.mp3",
        headers={"X-Audio-Cache": "hit" if hit else "miss"},
    )


def _audio_unavailable(detail: str) -> JSONResponse:
    """AC-L1b：503 + {detail, code:"tts_unavailable", transcript_available:true}。"""
    return JSONResponse(
        status_code=503,
        content={"detail": detail, "code": "tts_unavailable", "transcript_available": True},
    )


@router.post("/listening/sets/{set_id}/attempt")
async def post_attempt(set_id: str, request: Request):
    doc = _get_listening_set(set_id)
    body = _json_body_required(await _json_body(request))
    answers = body.get("answers")
    if answers is None:
        answers = {}
    if not isinstance(answers, dict):
        raise bad_request("answers 应为 {题目id: 答案文本} 对象")
    duration_sec = _check_duration(body.get("duration_sec"))

    report = listening_grader.grade(doc, answers, duration_sec=duration_sec)
    report["attempt_id"] = store.new_attempt_id()
    _persist(doc, report, duration_sec)
    return ok(report)


def _json_body_required(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise bad_request("请求体必须是 JSON 对象")
    return body


def _check_duration(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise bad_request("duration_sec 应为数字（秒）")
    if value < 0:
        raise bad_request("duration_sec 不能为负数")
    return float(value)


def _persist(doc: dict[str, Any], report: dict[str, Any], duration_sec: Optional[float]) -> None:
    """AC-G2 落库 + FR-V2 错题本（一律走 store，路由不写裸 SQL，契约 §5）。"""
    prompts = {q.get("id"): (q.get("prompt") or q.get("statement") or "") for q in doc.get("questions") or []}
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
        module="listening",
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
