"""1 对 1 口语陪练（spec-contracts.md §16；FR-S7 / AC-S7.1–S7.6）。

职责边界（与 `speaking_session` 同一条分界线）：
- 本模块负责**对话推进、追问回落、里程碑与落库**；评分本身交给 `speaking_grader.grade()`
  纯函数 —— 陪练报告与题库口语报告**必须同形状**（§16.4），所以这里不重新实现任何评分逻辑；
- 音频不落库（与 `speaking_turns` 同口径），只存转写文本；
- 一切写库经 `app.db.store`（路由/服务不写裸 SQL）。

两条最容易做错、因此写死在这里的规则：

1. **追问永不重复**（§16.3 规则 1）。AI 不可用时回落预置问句，且必须取「这条会话还没用过」的那条。
   预置用尽后给一句固定的英文收尾问句，而不是把上一条再念一遍 —— 重复念会让用户以为程序卡死。
2. **离线也要能走完整场**（FR-S7.5b / FR-G3）。`assess()` 在 `ai_used=false` 时仍产出完整
   `SpeakingReport`（本地近似 + 可见降级），绝不 500、绝不静默成功。
"""
from __future__ import annotations

import re
import uuid
from typing import Any, Optional

from app.db import store
from app.prompts import SPARRING_MAX_TOKENS, TEMPERATURE
from app.prompts import speaking as speaking_prompts
from app.services import ai_client, faultlog, speaking_grader

MODULE = "sparring"
STATE_CREATED = "created"
STATE_IN_PROGRESS = "in_progress"
STATE_AWAITING = "awaiting_assess"
STATE_ASSESSED = "assessed"
STATE_CLOSED = "closed"

DEFAULT_MAX_TURNS = 10
MAX_TURNS_RANGE = (8, 12)
CONFIDENCE_HINT = 0.5
#: 预置问句全用尽后的固定收尾（英文，保持陪练官口吻；**不是**再来一遍上一句）
EXHAUSTED_REPLY = "Let's pause there for a second. Is there anything else about this situation you'd like to practise before we wrap up?"
#: 预置问句用尽的降级原因：Wave 8 起是契约 §0 的**正式枚举值**（`ai_client.REASON_PRESET_EXHAUSTED`），
#: 不再是陪练私有字符串 —— 私有值会让 `AiResult.__post_init__` 之外的所有统一翻译面漏掉它。
REASON_PRESET_EXHAUSTED = ai_client.REASON_PRESET_EXHAUSTED

ANSWER_MAX_CHARS = 2000
"""单轮作答正文上限（转写再离谱也不该超过这个量级；超了当作客户端写坏）。"""


class SparringError(Exception):
    """陪练层的业务错误（api/sparring.py 转成契约 §0 的 {detail, code}）。"""

    def __init__(self, status_code: int, detail: str, code: str = "bad_request") -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code


# --------------------------------------------------------------------------
# 话题
# --------------------------------------------------------------------------

def _topics() -> list[dict[str, Any]]:
    return store.list_sets(MODULE)


def topic_of(topic_id: str) -> dict[str, Any]:
    doc = store.get_set(topic_id)
    if not isinstance(doc, dict) or doc.get("module") != MODULE:
        raise SparringError(404, f"陪练话题不存在：{topic_id}", "not_found")
    return doc


def normalise_level(level: Any) -> Optional[str]:
    if level in (None, ""):
        return None
    text = str(level).strip().lower()
    if text not in ("a2", "b1", "b2"):
        raise SparringError(400, "level 只能是 a2 / b1 / b2", "validation_failed")
    return text


def max_turns_of(doc: dict[str, Any]) -> int:
    value = doc.get("max_turns")
    if isinstance(value, int) and not isinstance(value, bool):
        low, high = MAX_TURNS_RANGE
        return max(low, min(high, value))
    return DEFAULT_MAX_TURNS


def preset_questions(doc: dict[str, Any]) -> list[str]:
    return [str(item).strip() for item in (doc.get("preset_questions") or []) if str(item).strip()]


def topic_meta(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": doc.get("id"),
        "title_zh": doc.get("title_zh"),
        "topic": doc.get("topic"),
        "scenario_zh": doc.get("scenario_zh"),
        "level": doc.get("level"),
        "target_band": doc.get("target_band"),
        "turns": max_turns_of(doc),
        "preset_count": len(preset_questions(doc)),
    }


def list_topics(level: Optional[str] = None) -> list[dict[str, Any]]:
    wanted = normalise_level(level)
    docs = _topics()
    if wanted:
        docs = [doc for doc in docs if str(doc.get("level") or "").lower() == wanted]
    return [topic_meta(doc) for doc in docs]


# --------------------------------------------------------------------------
# 追问（AI 优先，预置兜底）
# --------------------------------------------------------------------------

_WS = re.compile(r"\s+")


def _clean_reply(raw: Any, *, max_words: int = 40) -> str:
    """把模型输出清洗成「一句英文」。清洗失败一律返回空串，交给回落逻辑。"""
    text = raw if isinstance(raw, str) else ""
    text = text.strip()
    if not text:
        return ""
    # 去掉可能的引号包裹与 markdown（模型偶尔会回 ```json 或加引号）
    text = text.strip("\"'` ")
    text = _WS.sub(" ", text)
    if not text:
        return ""
    words = text.split()
    if len(words) > max_words:
        text = " ".join(words[:max_words]).rstrip(",;:") + "?"
    # 必须是问句或至少是英文句子；出现大量中文说明说明它没按 schema 输出
    if re.search(r"[\u4e00-\u9fff]", text):
        return ""
    return text


def _history_pairs(messages: list[dict[str, Any]]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for item in messages:
        role = str(item.get("role") or "")
        text = str(item.get("text") or "").strip()
        if role in ("partner", "user") and text:
            out.append((role, text))
    return out


def next_reply(
    doc: dict[str, Any],
    *,
    history: list[tuple[str, str]],
    last_user: str,
    asked: list[str],
    allow_network: Optional[bool] = None,
) -> dict[str, Any]:
    """产出陪练官的下一句。返回 `{text, source, degraded_reason, model}`，**永不抛异常**。

    `source ∈ {ai, fallback}`；`degraded_reason` 用 §0 枚举（或陪练专用的 `preset_exhausted`）。

    `asked` 是**已经问出去的全部问题**（AI 与预置都算，见 `add_turn` 的 `asked_next`），
    不是「已消耗过的预置问句」—— 后者只是它的一个子集，两者混用会让模型把预置清单
    第 1 句在第 3 轮再问一遍，而界面只能显示它是 AI 追问、看不出这是重复。
    """
    online = ai_client.network_allowed() if allow_network is None else bool(allow_network)
    used = [item for item in asked if str(item).strip()]
    preset = _first_unused_preset(doc, used)

    if not online:
        return _fallback(preset, ai_client.REASON_OFFLINE_TEMPLATE)

    result = ai_client.complete_json(
        speaking_prompts.build_sparring_reply_prompt(
            scenario=str(doc.get("scenario_zh") or ""),
            topic_title=str(doc.get("title_zh") or ""),
            level=str(doc.get("level") or "b1"),
            history=history,
            last_user=last_user,
            asked=used,
        ),
        system="\n\n".join([speaking_prompts.SPARRING_SYSTEM_PROMPT, speaking_prompts.SPARRING_RULES]),
        temperature=TEMPERATURE,
        max_tokens=SPARRING_MAX_TOKENS,
        allow_network=True,
        require_api_key=False,  # 与评分链路同口径：本机无凭据端点也允许（ai_client docstring）
    )

    if not result.ok:
        return _fallback(preset, result.reason or ai_client.REASON_OFFLINE_TEMPLATE)

    payload = result.data if isinstance(result.data, dict) else {}
    reply = _clean_reply(payload.get("reply") or payload.get("question") or payload.get("text"))
    if not reply:
        return _fallback(preset, ai_client.REASON_INVALID_OUTPUT)
    # AI 自己念回上一个问句 ⇒ 与离线回落同一个毛病，判为无效输出而不是照发。
    # 比对范围是**整段已问过的问题**（不只最后一条）：3 轮之后再念回第 1 轮，
    # 用户一样会觉得「它卡住了」，只看相邻一句抓不到。
    if used and _normalise_question(reply) in {_normalise_question(item) for item in used}:
        faultlog.warn("Sparring", "模型重复了已经问过的问题，按无效输出处理并回落预置")
        return _fallback(preset, ai_client.REASON_INVALID_OUTPUT)

    return {"text": reply, "source": "ai", "degraded_reason": None, "model": result.model}


def _first_unused_preset(doc: dict[str, Any], used: list[str]) -> Optional[str]:
    seen = {_normalise_question(item) for item in used}
    for item in preset_questions(doc):
        if _normalise_question(item) not in seen:
            return item
    return None


def _fallback(preset: Optional[str], reason: str) -> dict[str, Any]:
    if preset:
        return {
            "text": preset,
            "source": "fallback",
            "degraded_reason": reason if reason in ai_client.DEGRADED_REASONS else ai_client.REASON_OFFLINE_TEMPLATE,
            "model": None,
        }
    return {"text": EXHAUSTED_REPLY, "source": "fallback", "degraded_reason": REASON_PRESET_EXHAUSTED, "model": None}


def _normalise_question(text: str) -> str:
    return _WS.sub(" ", str(text or "").strip().lower()).strip(" ?.!。？")


# --------------------------------------------------------------------------
# 会话
# --------------------------------------------------------------------------

def _audio_url(text: str, voice: Optional[str]) -> Optional[str]:
    """追问音频（§16.3 规则 5）：离线为 null，前端显示「无音频，读文本」。"""
    if not ai_client.network_allowed() or not text:
        return None
    from urllib.parse import quote

    return f"/api/tts?text={quote(text)}&voice={quote(voice or 'en-GB-SoniaNeural')}&speed=1.0"


def _new_session_id() -> str:
    return f"spa_{uuid.uuid4().hex[:16]}"


def start_session(topic_id: str, level: Any = None, *, allow_network: Optional[bool] = None) -> dict[str, Any]:
    doc = topic_of(topic_id)
    wanted = normalise_level(level) or str(doc.get("level") or "b1").lower()
    opening = str(doc.get("opening") or "").strip()
    if not opening:
        raise SparringError(400, "该话题没有开场白，无法开始对话", "empty_prompt")

    voice = str(doc.get("partner_voice") or store.get_settings().get("tts_voice") or "en-GB-SoniaNeural")
    session_id = _new_session_id()
    messages = [
        {
            "seq": 0,
            "role": "partner",
            "text": opening,
            "source": "opening",
            "audio_url": _audio_url(opening, voice),
        }
    ]
    store.save_sparring_session(
        session_id=session_id,
        topic_id=str(doc.get("id") or topic_id),
        level=wanted,
        state=STATE_CREATED,
        turn_index=0,
        max_turns=max_turns_of(doc),
        messages=messages,
        used_presets=[],
    )
    return {
        "session_id": session_id,
        "topic": doc,
        "opening": opening,
        "turn_index": 0,
        "max_turns": max_turns_of(doc),
        "state": STATE_CREATED,
        "audio_url": messages[0]["audio_url"],
        "messages": messages,
    }


def _row_or_error(session_id: str) -> dict[str, Any]:
    row = store.get_sparring_session(session_id) if session_id else None
    if not row:
        raise SparringError(404, f"陪练会话不存在：{session_id}", "not_found")
    return row


def _state_of(row: dict[str, Any]) -> str:
    state = str(row.get("state") or STATE_CREATED)
    if state not in store.SPARRING_STATES:
        return STATE_CREATED
    return state


def _remaining(row: dict[str, Any]) -> int:
    return max(0, int(row.get("max_turns") or DEFAULT_MAX_TURNS) - int(row.get("turn_index") or 0))


def session_view(session_id: str) -> dict[str, Any]:
    row = _row_or_error(session_id)
    messages = [dict(item) for item in (row.get("messages") or []) if isinstance(item, dict)]
    result: Optional[dict[str, Any]] = None
    attempt_id = row.get("result_attempt_id")
    if attempt_id:
        record = store.get_attempt(attempt_id)
        if record:
            result = record.get("payload")
    return {
        "session_id": row["id"],
        "topic_id": row["topic_id"],
        "level": row.get("level"),
        "max_turns": int(row.get("max_turns") or DEFAULT_MAX_TURNS),
        "turn_index": int(row.get("turn_index") or 0),
        "remaining": _remaining(row),
        "state": _state_of(row),
        "messages": messages,
        "result": result,
    }


def transcribe_audio(data: bytes, input_format: str = "webm") -> dict[str, Any]:
    """与 `speaking_session.transcribe_audio` 同一条路（懒加载 whisper，契约 §15.5 文案口径）。"""
    from app.services import stt_service  # noqa: PLC0415 - 懒加载：import app.main 不许拖入 torch

    try:
        result = stt_service.transcribe(data, input_format)
    except ValueError as exc:
        faultlog.warn("STT", f"转写解码失败: {type(exc).__name__}: {exc}")
        raise SparringError(
            400,
            "这段录音听不清，可能没录到声音或格式不对，请重录一次或改用键盘输入",
            "audio_unintelligible",
        ) from exc
    except Exception as exc:  # noqa: BLE001 - 依赖失败必须可见（CONSTITUTION §3）
        faultlog.error("STT", f"语音转写不可用: {type(exc).__name__}: {exc}")
        raise SparringError(
            503,
            "本机语音转写暂时不可用（可能没装 whisper 或模型没加载），可改用键盘输入文本",
            "stt_failed",
        ) from exc
    if not isinstance(result, dict):
        raise SparringError(503, "语音转写返回异常，可改用键盘输入文本", "stt_failed")
    return result


def add_turn(
    session_id: str,
    *,
    text: Optional[str] = None,
    audio_bytes: Optional[bytes] = None,
    duration_sec: Any = None,
    input_format: str = "webm",
    allow_network: Optional[bool] = None,
) -> dict[str, Any]:
    """一轮作答：音频走 whisper（AC-S3 同口径），文本走键盘兜底（AC-S3b 同口径）。"""
    row = _row_or_error(session_id)
    state = _state_of(row)
    if state in (STATE_ASSESSED, STATE_CLOSED):
        raise SparringError(409, "会话已评分或已关闭，不能再作答", "conflict")

    doc = topic_of(str(row["topic_id"]))
    remaining = _remaining(row)
    if remaining <= 0:
        raise SparringError(
            409,
            f"已达到 {row.get('max_turns')} 轮上限，请直接结束并评分",
            "conflict",
        )

    seconds = _check_duration(duration_sec)
    transcript = ""
    confidence: Optional[float] = None
    if audio_bytes:
        result = transcribe_audio(audio_bytes, input_format)
        transcript = str(result.get("text") or "").strip()
        value = result.get("confidence")
        confidence = float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None
        if not transcript:
            raise SparringError(400, "转写结果为空，请重录或改用键盘输入文本", "audio_unintelligible")
        if seconds is None:
            seconds = float(result.get("duration") or 0.0)
    elif str(text or "").strip():
        transcript = str(text).strip()
    else:
        raise SparringError(400, "请提交录音音频或直接输入的答案文本", "empty_answer")

    if len(transcript) > ANSWER_MAX_CHARS:
        raise SparringError(413, f"单轮作答过长（上限 {ANSWER_MAX_CHARS} 字），请分几轮说", "payload_too_large")

    messages = [dict(item) for item in (row.get("messages") or []) if isinstance(item, dict)]
    used = [str(item) for item in (row.get("used_presets") or []) if str(item).strip()]

    seq = _next_seq(messages)
    messages.append(
        {
            "seq": seq,
            "role": "user",
            "text": transcript,
            "confidence": confidence,
            "duration_sec": seconds,
        }
    )

    reply = next_reply(
        doc,
        history=_history_pairs(messages),
        last_user=transcript,
        asked=used,
        allow_network=allow_network,
    )
    partner_message = {
        "seq": seq + 1,
        "role": "partner",
        "text": reply["text"],
        "source": reply["source"],
        "audio_url": _audio_url(reply["text"], doc.get("partner_voice")),
    }
    messages.append(partner_message)

    turn_index = int(row.get("turn_index") or 0) + 1
    remaining_after = max(0, int(row.get("max_turns") or DEFAULT_MAX_TURNS) - turn_index)
    new_state = STATE_AWAITING if remaining_after == 0 else STATE_IN_PROGRESS
    # `asked` 记**所有已经问出去的问题**，不只预置回落的那几条（契约 §16.3 规则 1 的实现口径）。
    # 只记 fallback 会让模型下一轮把预置清单里的同一句再问一遍 —— 用户看到的是「重复」，
    # 而根因是我们自己没把 AI 说过的内容记进「已问过」。用尽判定（`preset_exhausted`）仍只看
    # 「预置问句是否已全部出现过」，所以这句固定收尾句**不进集合**，否则它会被当成一次预置消耗。
    asked_next = used + (
        [] if reply["degraded_reason"] == REASON_PRESET_EXHAUSTED else [str(reply["text"])]
    )

    store.save_sparring_session(
        session_id=row["id"],
        topic_id=str(row["topic_id"]),
        level=row.get("level"),
        state=new_state,
        turn_index=turn_index,
        max_turns=int(row.get("max_turns") or DEFAULT_MAX_TURNS),
        messages=messages,
        used_presets=asked_next,
    )

    payload: dict[str, Any] = {
        "seq": seq,
        "transcript": transcript,
        "confidence": confidence,
        "partner": partner_message,
        "turn_index": turn_index,
        "remaining": remaining_after,
        "state": new_state,
        "degraded_reason": reply["degraded_reason"],
        "source": reply["source"],
    }
    if confidence is not None and confidence < CONFIDENCE_HINT:
        payload["hint_zh"] = "录音可能不清晰，可重录本轮或改用键盘输入文本（AC-S3 同口径）"
    return payload


def _next_seq(messages: list[dict[str, Any]]) -> int:
    highest = -1
    for item in messages:
        value = item.get("seq")
        if isinstance(value, int) and not isinstance(value, bool):
            highest = max(highest, value)
    return highest + 1


def _check_duration(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SparringError(400, "duration_sec 应为数字（秒）")
    if value < 0:
        raise SparringError(400, "duration_sec 不能为负数")
    return float(value)


# ------------------------------------------------------------------
# 评分（与题库口语同形状 + sparring 块）
# ------------------------------------------------------------------

def conversation_record(row: dict[str, Any], doc: dict[str, Any]) -> tuple[str, str]:
    """把会话拼成 `(prompt_text, transcript)` 供 `speaking_grader.grade`。

    - `transcript` 只能由**考生自己的句子**拼成：`evidence.quote` 要能在它里面逐字找到（§3-P 规则 2）；
    - `prompt_text` 是「场景 + 陪练官问过的话」，让评分模型知道这是自由对话而不是背题库。
    """
    messages = [item for item in (row.get("messages") or []) if isinstance(item, dict)]
    presented: list[str] = []
    answers: list[str] = []
    for item in messages:
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        if item.get("role") == "partner":
            presented.append(f"Partner: {text}")
        elif item.get("role") == "user":
            answers.append(text)

    scenario = str(doc.get("scenario_zh") or "").strip()
    title = str(doc.get("title_zh") or "").strip()
    header = f"【自由对话陪练：{title}】{scenario}\n这是 1 对 1 陪练对话，不是题库背诵；请按对话表现评四维。"
    prompt_text = header + ("\n\n对话提问：\n" + "\n".join(presented) if presented else "")
    return prompt_text, "\n".join(answers)


def total_duration(row: dict[str, Any]) -> float:
    total = 0.0
    for item in row.get("messages") or []:
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        value = item.get("duration_sec")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            total += float(value)
    return round(total, 2)


def assess(
    session_id: str,
    *,
    allow_network: Optional[bool] = None,
    target_band: Optional[float] = None,
) -> dict[str, Any]:
    """整场评分（§16.4）：`SpeakingReport` 同形状 + `sparring` 块，并落 `attempts`（AC-G2）。"""
    row = _row_or_error(session_id)
    if _state_of(row) == STATE_CLOSED:
        raise SparringError(409, "会话已关闭，无法评分", "conflict")

    doc = topic_of(str(row["topic_id"]))
    prompt_text, transcript = conversation_record(row, doc)
    if not transcript.strip():
        raise SparringError(400, "还没有任何作答，无法评分", "empty_answer")

    turns = int(row.get("turn_index") or 0)
    duration = total_duration(row)
    band_target = target_band if target_band is not None else doc.get("target_band")
    if not isinstance(band_target, (int, float)) or isinstance(band_target, bool):
        band_target = None

    report = speaking_grader.grade(
        prompt_text,
        transcript,
        duration,
        part="sparring",
        target_band=float(band_target) if band_target is not None else None,
        allow_network=ai_client.network_allowed() if allow_network is None else bool(allow_network),
    )
    report["attempt_id"] = store.new_attempt_id()
    report["session_id"] = row["id"]
    report["part"] = "sparring"
    report["sparring"] = {"topic_id": str(row["topic_id"]), "turns": turns, "mode": "sparring"}
    band = report.get("band") or {}

    items = [
        {
            "item_ref": f"turn_{index + 1}",
            "question_type": "sparring_turn",
            "prompt_ref": _partner_question_before(row, index),
            "your_answer": text,
            "expected": None,
            "correct": None,
            "time_spent_sec": duration_sec,
        }
        for index, (text, duration_sec) in enumerate(_user_turns(row))
    ]

    store.record_attempt(
        module="speaking",
        task_ref=str(row["topic_id"]),
        report=report,
        band_overall=band.get("overall") if isinstance(band, dict) else None,
        band_sub=band if isinstance(band, dict) else {},
        duration_sec=duration,
        part="sparring",
        started_at=row.get("created_at"),
        ai_used=bool(report.get("ai_used")),
        degraded_reason=report.get("degraded_reason"),
        approximate=bool(report.get("approximate")),
        items=items,
        attempt_id=report["attempt_id"],
    )
    store.save_sparring_session(
        session_id=row["id"],
        topic_id=str(row["topic_id"]),
        level=row.get("level"),
        state=STATE_ASSESSED,
        turn_index=turns,
        max_turns=int(row.get("max_turns") or DEFAULT_MAX_TURNS),
        messages=[item for item in (row.get("messages") or []) if isinstance(item, dict)],
        used_presets=[str(item) for item in (row.get("used_presets") or [])],
        result_attempt_id=report["attempt_id"],
    )
    return report


def _user_turns(row: dict[str, Any]) -> list[tuple[str, Optional[float]]]:
    out: list[tuple[str, Optional[float]]] = []
    for item in row.get("messages") or []:
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        value = item.get("duration_sec")
        seconds = float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None
        out.append((text, seconds))
    return out


def _partner_question_before(row: dict[str, Any], user_index: int) -> Optional[str]:
    """第 N 次作答之前陪练官说的那句（attempt_items 的 prompt_ref）。"""
    seen = 0
    last_partner: Optional[str] = None
    for item in row.get("messages") or []:
        if not isinstance(item, dict):
            continue
        if item.get("role") == "partner":
            text = str(item.get("text") or "").strip()
            if text:
                last_partner = text
        elif item.get("role") == "user":
            if seen == user_index:
                return last_partner
            seen += 1
    return last_partner


def close_session(session_id: str) -> dict[str, Any]:
    row = _row_or_error(session_id)
    store.save_sparring_session(
        session_id=row["id"],
        topic_id=str(row["topic_id"]),
        level=row.get("level"),
        state=STATE_CLOSED,
        turn_index=int(row.get("turn_index") or 0),
        max_turns=int(row.get("max_turns") or DEFAULT_MAX_TURNS),
        messages=[item for item in (row.get("messages") or []) if isinstance(item, dict)],
        used_presets=[str(item) for item in (row.get("used_presets") or [])],
    )
    return {"session_id": row["id"], "state": STATE_CLOSED}
