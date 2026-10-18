"""设置端点（契约 §1 行 2–5、§4；验收 AC-C1 / AC-C2）。

- `PATCH /settings` 是**部分更新**：没传的字段保持库里的原值。
  （旧实现 `services/__init__.py:495-501` 用 Form 默认值把未传字段重置回默认，是 bug。）
- AI key 只写不读：`PUT /settings/ai-key` 存进 settings 表（CONSTITUTION §3 允许设置页覆盖），
  任何响应只回 `ai_key_present` / `ai.configured`，永不含明文。
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Request

from app.api.common import bad_request, ok
from app.db import store

router = APIRouter(tags=["settings"])

_BAND_STEP = 0.5
_ACCENTS = ("en-GB", "en-US")
_WRITABLE_AI_KEYS = ("base_url", "model")


async def _json_body(request: Request) -> Any:
    """读取 JSON body；非法 JSON 按 400 契约错误处理，而不是 500。"""
    try:
        return await request.json()
    except Exception:
        raise bad_request("请求体应为合法 JSON") from None


def _check_band(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise bad_request("target_band 必须是数字（0–9，步长 0.5）")
    band = float(value)
    if not 0.0 <= band <= 9.0:
        raise bad_request("target_band 超出范围：应为 0 到 9 之间的分数")
    if abs(band / _BAND_STEP - round(band / _BAND_STEP)) > 1e-9:
        raise bad_request("target_band 步长必须是 0.5（例如 6.5）")
    return band


def _check_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise bad_request("exam_date 应为 YYYY-MM-DD 格式的字符串或 null")
    try:
        _dt.date.fromisoformat(value)
    except ValueError:
        raise bad_request("exam_date 格式不正确：应为 YYYY-MM-DD") from None
    return value


def _check_bool(value: Any) -> bool:
    if not isinstance(value, bool):
        raise bad_request("该设置项需要布尔值")
    return value


def _check_number(value: Any, low: float, high: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise bad_request(f"{name} 必须是数字")
    number = float(value)
    if not low <= number <= high:
        raise bad_request(f"{name} 超出范围：{low} 到 {high}")
    return number


def _check_int(value: Any, low: int, high: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise bad_request(f"{name} 必须是整数")
    if not low <= value <= high:
        raise bad_request(f"{name} 超出范围：{low} 到 {high}")
    return value


def _check_text(value: Any, name: str, allow_null: bool = True) -> Optional[str]:
    if value is None:
        if allow_null:
            return None
        raise bad_request(f"{name} 不能为空")
    if not isinstance(value, str) or not value.strip():
        raise bad_request(f"{name} 必须是非空字符串")
    return value.strip()


def _check_ai_block(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise bad_request("ai 配置必须是一个对象，可包含 base_url 与 model")
    unknown = set(value) - set(_WRITABLE_AI_KEYS)
    if unknown:
        raise bad_request(f"ai 配置不支持的字段：{', '.join(sorted(unknown))}（可写字段：base_url、model）")
    patch: dict[str, Any] = {}
    if "base_url" in value:
        url = value["base_url"]
        if url is None:
            patch["ai_base_url"] = None
        else:
            url = _check_text(url, "ai.base_url")
            parsed = urlparse(str(url))
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise bad_request("ai.base_url 应为完整 URL，例如 https://api.example.com/v1")
            patch["ai_base_url"] = str(url)
    if "model" in value:
        patch["ai_model"] = _check_text(value["model"], "ai.model", allow_null=False)
    return patch


def _check_accent(value: Any) -> str:
    if not isinstance(value, str) or value not in _ACCENTS:
        raise bad_request(f"accent 只能是 {' 或 '.join(_ACCENTS)}（英音 / 美音）")
    return value


def _check_tts_voice(value: Any) -> str:
    return _check_text(value, "tts_voice", allow_null=False)


def _check_tts_speed(value: Any) -> float:
    return _check_number(value, 0.5, 1.5, "tts_speed")


def _check_daily_goal(value: Any) -> int:
    return _check_int(value, 5, 720, "daily_goal_minutes")


def _check_audio_device(value: Any) -> Optional[str]:
    return _check_text(value, "audio_device")


def _check_input_gain(value: Any) -> float:
    return _check_number(value, 0.5, 2.0, "recording_input_gain")


_THEMES = ("light", "dark", "system")


def _check_theme(value: Any) -> str:
    if not isinstance(value, str) or value not in _THEMES:
        raise bad_request(f"theme 只能是 {' / '.join(_THEMES)}（浅色 / 深色 / 跟随系统）")
    return value


_VALIDATORS = {
    "target_band": _check_band,
    "exam_date": _check_date,
    "daily_goal_minutes": _check_daily_goal,
    "accent": _check_accent,
    "tts_voice": _check_tts_voice,
    "tts_speed": _check_tts_speed,
    "show_chinese_hints": _check_bool,
    "show_punctuation": _check_bool,
    "online_enabled": _check_bool,
    "audio_device": _check_audio_device,
    "recording_input_gain": _check_input_gain,
    "theme": _check_theme,
    "ai": _check_ai_block,
}


def _validate_patch(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise bad_request("请求体必须是 JSON 对象")
    unknown = set(body) - set(_VALIDATORS)
    if unknown:
        raise bad_request(
            f"未知设置项：{', '.join(sorted(unknown))}；可用：{', '.join(sorted(_VALIDATORS))}"
        )
    patch: dict[str, Any] = {}
    for key, value in body.items():
        checked = _VALIDATORS[key](value)
        if isinstance(checked, dict):
            patch.update(checked)
        else:
            patch[key] = checked
    return patch


@router.get("/settings")
def get_settings():
    return ok(store.settings_response(store.get_settings()))


@router.patch("/settings")
async def patch_settings(request: Request):
    patch = _validate_patch(await _json_body(request))
    raw = store.patch_settings(patch)
    return ok(store.settings_response(raw))


@router.put("/settings/ai-key")
async def put_ai_key(request: Request):
    body = await _json_body(request)
    if not isinstance(body, dict):
        raise bad_request('请求体应为 {"key": "..."}')
    key = body.get("key")
    if not isinstance(key, str) or not key.strip():
        raise bad_request("AI key 不能为空")
    key = key.strip()
    if len(key) > 300 or any(ord(c) < 32 for c in key):
        raise bad_request("AI key 格式不正确（长度应为 1–300 且不含控制字符）")
    store.set_ai_key(key)
    return ok({"ai_key_present": True})


@router.delete("/settings/ai-key")
def delete_ai_key():
    store.clear_ai_key()
    return ok({"ai_key_present": False})
