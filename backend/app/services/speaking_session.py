"""口语考官会话（spec-contracts.md §1 行 8–12、§2-S、§10.1/§10.2；FR-S1/S2/S3/S4/S6、AC-S2/S3/S3b/S6、AC-G2）。

状态机（§10.2 定稿）：`created → in_progress → awaiting_assess → assessed → closed`。

职责边界：
- 本模块负责**题序装配、状态推进、转写、落库**；评分本身在 `speaking_grader`（纯函数，可单测）；
- 音频**不落库**（契约 §5 的 `speaking_turns` 没有音频列），所以 `assess` 只拿转写文本评分，
  发音维度因此恒标 `pronunciation_confidence="low"`（FR-S4 的「无音频时低置信」口径）；
  调用方若能同时提供字节，则 `speaking_grader.grade(audio_bytes=...)` 会标成 high；
- 一切写库只经 `app.db.store`（CONSTITUTION §5：路由/服务不写裸 SQL）。
"""
from __future__ import annotations

import uuid
from typing import Any, Optional
from urllib.parse import quote

from app.config import settings as _cfg
from app.db import store
from app.prompts import FOLLOWUP_MAX_TOKENS, TEMPERATURE
from app.prompts import speaking as speaking_prompts
from app.services import ai_client, speaking_grader

STATES = ("created", "in_progress", "awaiting_assess", "assessed", "closed")
PARTS = (1, 2, 3)
DEFAULT_PREPARATION_SEC = 60  # FR-S2：Part 2 准备 60s
DEFAULT_SPEAKING_SEC = 120  # FR-S2/AC-S2：Part 2 独白 120s 到点自动停
MAX_TURNS = 40
CONFIDENCE_HINT = 0.5  # AC-S3：置信度低于此值提示可重录或改键盘输入


class SpeakingSessionError(Exception):
    """会话层的业务错误（api/speaking.py 转成契约 §0 的 {detail, code} 响应）。"""

    def __init__(self, status_code: int, detail: str, code: str = "bad_request") -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code


# --------------------------------------------------------------------------
# 题序装配（§2-S + §10.1：一文件一 part）
# --------------------------------------------------------------------------

def normalise_part(part: Any) -> int:
    text = str(part if part is not None else "").strip().lower().replace("part", "").strip()
    try:
        value = int(float(text))
    except (TypeError, ValueError):
        raise SpeakingSessionError(400, "part 只能是 1、2 或 3") from None
    if value not in PARTS:
        raise SpeakingSessionError(400, f"part 只能是 {'/'.join(str(p) for p in PARTS)}")
    return value


def speaking_set(set_id: str) -> dict[str, Any]:
    doc = store.get_set(set_id)
    if not isinstance(doc, dict) or doc.get("module") != "speaking":
        raise SpeakingSessionError(404, f"口语套题不存在：{set_id}", "not_found")
    return doc


def _audio_url(text: str, voice: str) -> Optional[str]:
    """考官提问音频：在线才给 URL（§10.2：离线 `audio_url = null`）。"""
    if not _cfg.ONLINE or not text:
        return None
    return f"/api/tts?text={quote(text)}&voice={quote(voice)}&speed=1.0"


def _question_prompt(item: Any, part: int, voice: str, index: int) -> Optional[dict[str, Any]]:
    if isinstance(item, str):
        text, qid = item.strip(), f"q{index + 1}"
    elif isinstance(item, dict):
        text = str(item.get("question") or item.get("prompt") or item.get("text") or "").strip()
        qid = str(item.get("id") or f"q{index + 1}")
    else:
        return None
    if not text:
        return None
    prompt: dict[str, Any] = {
        "id": qid,
        "part": part,
        "kind": "question",
        "text": text,
        "audio_url": _audio_url(text, voice),
    }
    if isinstance(item, dict) and item.get("depends_on_part2"):
        prompt["depends_on_part2"] = True
    return prompt


def set_prompts(doc: dict[str, Any], part: Any) -> list[dict[str, Any]]:
    """按 part 取题序（Part 1 三问 / Part 2 题卡一段独白 / Part 3 追问）。"""
    number = normalise_part(part)
    voice = str(doc.get("examiner_voice") or store.get_settings().get("tts_voice") or "en-GB-SoniaNeural")
    raw: list[Any] = []

    if number == 1:
        raw = list(doc.get("part1") or [])
    elif number == 3:
        raw = list(doc.get("part3") or [])
    else:
        card_value = doc.get("part2")
        card = card_value.get("cue_card") if isinstance(card_value, dict) else None
        card = card if isinstance(card, dict) else {}
        if not str(card.get("prompt") or card.get("text") or "").strip() and isinstance(card_value, list):
            card = {"prompt": str(card_value[0])} if card_value else {}
        text = str(card.get("prompt") or card.get("text") or "").strip()
        if not text:
            raise SpeakingSessionError(
                400, "该套题没有 Part 2 题卡，请改用 Part 1/3 或换一套题", "empty_prompt"
            )
        bullets = [str(b).strip() for b in (card.get("bullets") or []) if str(b).strip()]
        return [
            {
                "id": "cue_card",
                "part": 2,
                "kind": "cue_card",
                "text": text,
                "bullets": bullets,
                "preparation_sec": int(card.get("preparation_sec") or DEFAULT_PREPARATION_SEC),
                "speaking_sec": int(card.get("speaking_sec") or DEFAULT_SPEAKING_SEC),
                "audio_url": _audio_url(text, voice),
            }
        ]

    prompts = [p for p in (_question_prompt(i, number, voice, n) for n, i in enumerate(raw)) if p]
    if not prompts:
        raise SpeakingSessionError(
            400, f"该套题没有 Part {number} 的题目（一文件一 part，见契约 §10.1）", "empty_prompt"
        )
    return prompts


# --------------------------------------------------------------------------
# 会话读写
# --------------------------------------------------------------------------

def _row_or_error(session_id: str) -> dict[str, Any]:
    row = store.get_speaking_session(session_id) if session_id else None
    if not row:
        raise SpeakingSessionError(404, f"会话不存在：{session_id}", "not_found")
    return row


def _save(row: dict[str, Any], **changes: Any) -> dict[str, Any]:
    payload = {
        "session_id": row["id"],
        "set_id": row["set_id"],
        "part": row["part"],
        "state": changes.get("state", row["state"]),
        "current_index": int(changes.get("current_index", row.get("current_index") or 0)),
        "result_attempt_id": changes.get("result_attempt_id", row.get("result_attempt_id")),
    }
    return store.save_speaking_session(**payload)


def _turn_text(turn: dict[str, Any]) -> str:
    return str(turn.get("transcript") or "").strip()


def _turn_duration(turn: dict[str, Any]) -> float:
    value = turn.get("duration_sec")
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


def _speaking_limit(prompts: list[dict[str, Any]]) -> Optional[float]:
    """Part 2 的 120s 独白上限（AC-S2）；Part 1/3 无硬上限。"""
    for prompt in prompts:
        if prompt.get("kind") == "cue_card":
            return float(prompt.get("speaking_sec") or DEFAULT_SPEAKING_SEC)
    return None


def start_session(set_id: str, part: Any, question_id: Optional[str] = None) -> dict[str, Any]:
    doc = speaking_set(set_id)
    prompts = set_prompts(doc, part)
    index = 0
    if question_id:
        wanted = str(question_id).strip()
        for position, prompt in enumerate(prompts):
            if prompt["id"] == wanted:
                index = position
                break
        else:
            raise SpeakingSessionError(404, f"该套题的 Part {prompts[0]['part']} 没有题目：{wanted}", "not_found")

    session_id = f"ses_{uuid.uuid4().hex[:16]}"
    store.save_speaking_session(
        session_id=session_id,
        set_id=str(doc.get("id") or set_id),
        part=str(prompts[0]["part"]),
        state="created",
        current_index=index,
    )
    return {
        "session_id": session_id,
        "part": prompts[0]["part"],
        "current": prompts[index],
        "index": index,
        "total": len(prompts),
    }


def session_view(session_id: str) -> dict[str, Any]:
    """GET 会话（§1 行 9）：prompts + turns + 已评分时的 result。"""
    row = _row_or_error(session_id)
    doc = speaking_set(row["set_id"])
    prompts = set_prompts(doc, row["part"])
    turns = [_public_turn(turn) for turn in row.get("turns") or []]
    result: Optional[dict[str, Any]] = None
    attempt_id = row.get("result_attempt_id")
    if attempt_id:
        record = store.get_attempt(attempt_id)
        if record:
            result = record.get("payload")
    return {
        "session_id": row["id"],
        "set_id": row["set_id"],
        "part": int(row["part"]) if str(row["part"]).isdigit() else row["part"],
        "state": row["state"],
        "prompts": prompts,
        "turns": turns,
        "index": int(row.get("current_index") or 0),
        "total": len(prompts),
        "result": result,
        "elapsed_limit_reached": _limit_reached(prompts, turns),
    }


def _public_turn(turn: dict[str, Any]) -> dict[str, Any]:
    confidence = turn.get("confidence")
    return {
        "turn_id": turn.get("id"),
        "turn_index": turn.get("turn_index"),
        "prompt_id": turn.get("prompt_id"),
        "prompt_text": turn.get("prompt_text"),
        "transcript": _turn_text(turn),
        "confidence": float(confidence) if isinstance(confidence, (int, float)) else None,
        "duration_sec": _turn_duration(turn),
        "started_at": turn.get("started_at"),
        "low_confidence": (
            isinstance(confidence, (int, float)) and float(confidence) < CONFIDENCE_HINT
        ),  # AC-S3：前端据此提示重录/改键盘输入
    }


def _limit_reached(prompts: list[dict[str, Any]], turns: list[dict[str, Any]]) -> bool:
    limit = _speaking_limit(prompts)
    if limit is None:
        return False
    return sum(_turn_duration(turn) for turn in turns) >= limit


# --------------------------------------------------------------------------
# 转写（懒加载 whisper：只有真上传音频才 import）
# --------------------------------------------------------------------------

def transcribe_audio(data: bytes, input_format: str = "webm") -> dict[str, Any]:
    from app.services import stt_service  # noqa: PLC0415 - 懒加载，import app.main 不许拖入 torch

    try:
        result = stt_service.transcribe(data, input_format)
    except ValueError as exc:
        raise SpeakingSessionError(400, f"音频无法识别：{exc}", "audio_unintelligible") from exc
    except Exception as exc:  # noqa: BLE001 - 模型/解码失败必须可见（CONSTITUTION §3）
        raise SpeakingSessionError(
            503, f"语音转写不可用（{type(exc).__name__}），可改用键盘输入文本", "stt_failed"
        ) from exc
    if not isinstance(result, dict):
        raise SpeakingSessionError(503, "语音转写返回异常，可改用键盘输入文本", "stt_failed")
    return result


# --------------------------------------------------------------------------
# 逐题推进
# --------------------------------------------------------------------------

def add_turn(
    session_id: str,
    *,
    text: Optional[str] = None,
    audio_bytes: Optional[bytes] = None,
    duration_sec: Any = None,
    input_format: str = "webm",
) -> dict[str, Any]:
    """一次作答：音频走 whisper（AC-S3），文本走键盘兜底（AC-S3b）。"""
    row = _row_or_error(session_id)
    if row["state"] in ("assessed", "closed"):
        raise SpeakingSessionError(409, "会话已评分或已关闭，不能再作答", "conflict")

    doc = speaking_set(row["set_id"])
    prompts = set_prompts(doc, row["part"])
    turns = row.get("turns") or []
    if len(turns) >= MAX_TURNS:
        raise SpeakingSessionError(409, f"单次会话最多 {MAX_TURNS} 次作答", "conflict")

    limit = _speaking_limit(prompts)
    if limit is not None and _limit_reached(prompts, turns):
        raise SpeakingSessionError(409, "Part 2 已到 120s 上限，录音不可续（AC-S2），请直接评分", "conflict")

    seconds = _check_duration(duration_sec)
    transcript = ""
    confidence: Optional[float] = None
    segments: Optional[list[dict[str, Any]]] = None

    if audio_bytes:
        result = transcribe_audio(audio_bytes, input_format)
        transcript = str(result.get("text") or "").strip()
        value = result.get("confidence")
        confidence = float(value) if isinstance(value, (int, float)) else None
        raw_segments = result.get("segment_list")
        segments = raw_segments if isinstance(raw_segments, list) else None
        if not transcript:
            raise SpeakingSessionError(400, "转写结果为空，请重录或改用键盘输入文本", "audio_unintelligible")
        if seconds is None:
            seconds = float(result.get("duration") or 0.0)
    elif str(text or "").strip():
        transcript = str(text).strip()
        confidence = None  # 文本兜底没有声学置信度（AC-S3b）
    else:
        raise SpeakingSessionError(400, "请提交录音音频或直接输入的答案文本", "empty_answer")

    index = min(int(row.get("current_index") or 0), len(prompts) - 1)
    prompt = prompts[index]
    turn_id = store.add_speaking_turn(
        session_id=row["id"],
        turn_index=len(turns),
        prompt_id=prompt.get("id"),
        prompt_text=prompt.get("text"),
        transcript=transcript,
        confidence=confidence,
        duration_sec=seconds,
    )
    elapsed_limit_reached = limit is not None and (
        sum(_turn_duration(turn) for turn in turns) + (seconds or 0.0) >= limit
    )
    finished = elapsed_limit_reached or index + 1 >= len(prompts)
    next_prompt = None if finished else prompts[index + 1]
    state = "awaiting_assess" if finished else "in_progress"

    _save(row, state=state, current_index=index if finished else index + 1)

    payload: dict[str, Any] = {
        "turn_id": turn_id,
        "transcript": transcript,
        "confidence": confidence,
        "next": next_prompt,
        "elapsed_limit_reached": bool(elapsed_limit_reached),
        "state": state,
        "index": index,
        "total": len(prompts),
    }
    if confidence is not None and confidence < CONFIDENCE_HINT:
        payload["hint_zh"] = "录音可能不清晰，可重录或改用键盘输入文本（AC-S3）"
    if segments is not None:
        payload["segments"] = len(segments)
    return payload


def _check_duration(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SpeakingSessionError(400, "duration_sec 应为数字（秒）")
    if value < 0:
        raise SpeakingSessionError(400, "duration_sec 不能为负数")
    return float(value)


# --------------------------------------------------------------------------
# 评分 + 落库
# --------------------------------------------------------------------------

def assess(
    session_id: str,
    *,
    allow_network: Optional[bool] = None,
    target_band: Optional[float] = None,
) -> dict[str, Any]:
    """整场会话评分（§1 行 11 → §3-S），并落库（AC-G2）。"""
    row = _row_or_error(session_id)
    if row["state"] == "closed":
        raise SpeakingSessionError(409, "会话已关闭，无法评分", "conflict")

    doc = speaking_set(row["set_id"])
    prompts = set_prompts(doc, row["part"])
    turns = row.get("turns") or []
    answered = [_turn_text(turn) for turn in turns]
    answers = [value for value in answered if value]
    if not answers:
        raise SpeakingSessionError(400, "还没有任何作答，无法评分", "empty_answer")

    duration = round(sum(_turn_duration(turn) for turn in turns), 2)  # AC-S2：与实际录音时长一致
    prompt_text = "\n".join(str(p.get("text") or "") for p in prompts)
    transcript = " ".join(answers)
    part = prompts[0]["part"]

    report = speaking_grader.grade(
        prompt_text,
        transcript,
        duration,
        part=part,
        target_band=target_band if target_band is not None else _set_target_band(doc),
        allow_network=_allow_network(allow_network),
    )
    report["attempt_id"] = store.new_attempt_id()
    report["session_id"] = row["id"]
    report["part"] = part
    band = report.get("band") or {}

    store.record_attempt(
        module="speaking",
        task_ref=row["set_id"],
        report=report,
        band_overall=band.get("overall") if isinstance(band, dict) else None,
        band_sub=band if isinstance(band, dict) else {},
        duration_sec=duration,
        part=str(part),
        started_at=row.get("created_at"),
        ai_used=bool(report.get("ai_used")),
        degraded_reason=report.get("degraded_reason"),
        approximate=bool(report.get("approximate")),
        items=[
            {
                "item_ref": turn.get("prompt_id"),
                "question_type": f"speaking_part{part}",
                "prompt_ref": turn.get("prompt_text"),
                "your_answer": _turn_text(turn),
                "expected": None,
                "correct": None,
                "time_spent_sec": _turn_duration(turn),
                "detail": {"confidence": turn.get("confidence")},
            }
            for turn in turns
        ],
        attempt_id=report["attempt_id"],
    )
    _save(row, state="assessed", result_attempt_id=report["attempt_id"])
    return report


def _set_target_band(doc: dict[str, Any]) -> Optional[float]:
    value = doc.get("target_band")
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _allow_network(value: Optional[bool]) -> bool:
    return ai_client.network_allowed() if value is None else bool(value)


def close_session(session_id: str) -> dict[str, Any]:
    row = _row_or_error(session_id)
    _save(row, state="closed")
    return {"session_id": row["id"], "state": "closed"}


# --------------------------------------------------------------------------
# Part 3 动态追问（FR-S6 / AC-S6）
# --------------------------------------------------------------------------

def _question_strings(raw: Any) -> list[str]:
    """AI 追问列表 → 去空的字符串数组（字符串项或 {question} 对象项都接受）。"""
    out: list[str] = []
    for item in raw if isinstance(raw, list) else []:
        text = str(item.get("question") if isinstance(item, dict) else item or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def fallback_questions(doc: dict[str, Any], count: int = 3) -> list[str]:
    """题库预置追问优先，其次 part3[]，最后 part1 的 fallback_questions（AC-S6：不依赖网络）。"""
    out = [str(item).strip() for item in (doc.get("fallback_questions") or []) if str(item).strip()]
    if not out:
        out = [
            str(item.get("question") or item).strip()
            for item in (doc.get("part3") or [])
            if str(item.get("question") or item).strip()
        ]
    return out[:count] if out else []


def followups(
    set_id: str,
    part2_transcript: str,
    count: int = 3,
    *,
    allow_network: Optional[bool] = None,
) -> dict[str, Any]:
    doc = speaking_set(set_id)
    wanted = max(1, min(int(count or 3), 6))
    card = (doc.get("part2") or {}).get("cue_card") or {}
    cue_card = str(card.get("prompt") or "").strip()
    transcript = str(part2_transcript or "").strip()
    preset = fallback_questions(doc, wanted)

    if not transcript or not _allow_network(allow_network):
        # AC-S6：断网/没有 Part 2 回答时用题库预置追问，流程照走完
        return {
            "questions": (preset or [cue_card])[:wanted],
            "ai_used": False,
            "degraded_reason": ai_client.REASON_OFFLINE_TEMPLATE,
            "model": ai_client.resolve_model(),
            "source": "fallback",
            "fallback_questions": preset,
        }

    result = ai_client.complete_json(
        speaking_prompts.build_followup_prompt(cue_card, transcript, wanted),
        system=speaking_prompts.FOLLOWUP_SYSTEM_PROMPT,
        temperature=TEMPERATURE,
        max_tokens=FOLLOWUP_MAX_TOKENS,
        allow_network=True,
        require_api_key=False,  # 与评分链路同口径（见 ai_client 模块 docstring）
    )
    questions = _question_strings((result.data or {}).get("questions") if isinstance(result.data, dict) else None)

    if len(questions) < 2:  # 少于 2 条就当失败处理：AC-S6 要求预置追问兜底
        return {
            "questions": preset[:wanted] or questions[:wanted],
            "ai_used": False,
            "degraded_reason": result.reason or ai_client.REASON_INVALID_OUTPUT,
            "model": result.model,
            "source": "fallback",
            "fallback_questions": preset,
        }

    return {
        "questions": questions[:wanted],
        "ai_used": True,
        "degraded_reason": None,
        "model": result.model,
        "source": "ai",
    }


# --------------------------------------------------------------------------
# 列表/详情的安全视图（不含答案，§1 行 6–7）
# --------------------------------------------------------------------------

def set_meta(doc: dict[str, Any]) -> dict[str, Any]:
    part = doc.get("part")
    prompts: dict[str, Any] = {}
    if part == 1:
        prompts = {"part1": len(doc.get("part1") or [])}
    elif part == 2:
        prompts = {
            "part2": 1 if (doc.get("part2") or {}).get("cue_card") else 0,
            "part3": len(doc.get("part3") or []),
        }
    return {
        "id": doc.get("id"),
        "module": doc.get("module"),
        "kind": doc.get("kind"),
        "part": part,
        "target_band": doc.get("target_band"),
        "title_zh": doc.get("title_zh"),
        "topic": doc.get("topic"),
        "question_counts": prompts,
        "examiner_voice": doc.get("examiner_voice"),
        "source": doc.get("source"),
        "generated_at": doc.get("generated_at"),
    }
