"""L3 配置契约：IELTS_* 环境变量覆盖与默认库路径（spec-contracts.md §5/§6）。

覆盖 AC：CONSTITUTION §6（隔离必须靠 IELTS_DB_PATH/IELTS_TTS_CACHE_DIR）、AC-G1（sidecar 端口与主机）、
        §5「db/app.db 路径改为 %LOCALAPPDATA%/IELTSInsight/app.db，仍可用 IELTS_DB_PATH 覆盖（测试用）」。
        这一组是 backend-core 的验收面：现在必然红（config.py 还不认识 IELTS_*），
        红得干净 —— 不是测试坏了，是行为没实现。
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest


def test_IELTS_DB_PATH覆盖DB_PATH(make_settings, tmp_path):
    """§5：IELTS_DB_PATH 必须真正决定 sqlite 文件位置。"""
    target = tmp_path / "override" / "ielts.db"
    settings = make_settings({"IELTS_DB_PATH": str(target), "DB_PATH": None})
    assert Path(str(settings.DB_PATH)) == target, (
        f"IELTS_DB_PATH 没生效：settings.DB_PATH={settings.DB_PATH!r}（CONSTITUTION §6 的隔离就靠它）"
    )


def test_IELTS_TTS_CACHE_DIR覆盖缓存目录(make_settings, tmp_path):
    target = tmp_path / "tts-cache"
    settings = make_settings({"IELTS_TTS_CACHE_DIR": str(target), "TTS_CACHE_DIR": None})
    assert Path(str(settings.TTS_CACHE_DIR)) == target, (
        f"IELTS_TTS_CACHE_DIR 没生效：settings.TTS_CACHE_DIR={settings.TTS_CACHE_DIR!r}"
    )


def test_IELTS_ONLINE关闭在线能力(make_settings):
    """CONSTITUTION §6 / §3：IELTS_ONLINE=0 时在线开关必须为假（edge-tts/AI 不许自动出门）。

    字段名允许 ONLINE / online_enabled / IELTS_ONLINE 任一种（契约 §4 的 API 侧叫 online_enabled，
    config 侧命名是实现自由），但必须真的读到环境变量值。
    """
    names = ("ONLINE", "online_enabled", "IELTS_ONLINE", "ONLINE_ENABLED")
    off = make_settings({"IELTS_ONLINE": "0"})
    on = make_settings({"IELTS_ONLINE": "1"})

    def _flag(instance):
        for name in names:
            if hasattr(instance, name):
                return name, getattr(instance, name)
        return None, None

    off_name, off_value = _flag(off)
    assert off_name is not None, f"Settings 里找不到在线开关字段（试过的名字：{names}）"
    assert str(off_value).lower() in ("false", "0", "none"), (
        f"IELTS_ONLINE=0 没被读到：settings.{off_name}={off_value!r}"
    )
    on_name, on_value = _flag(on)
    assert str(on_value).lower() in ("true", "1"), f"IELTS_ONLINE=1 没被读到：settings.{on_name}={on_value!r}"


def test_默认库路径不再是CWD相对路径(make_settings):
    """§5：默认路径必须是 %LOCALAPPDATA%/IELTSInsight/app.db（PyInstaller 的 CWD 坑就是它导致的）。"""
    settings = make_settings({"IELTS_DB_PATH": None, "DB_PATH": None})
    value = str(settings.DB_PATH)
    assert not value.startswith("./"), (
        f"默认 DB 路径仍是相对 CWD 的 {value!r}：sidecar 的 CWD 随启动方式变化，会把用户数据写到随机目录"
    )
    local = os.environ.get("LOCALAPPDATA") or str(Path.home())
    assert Path(value).is_absolute(), f"默认 DB 路径必须是绝对路径：{value!r}"
    assert "IELTSInsight" in value.replace("\\", "/"), f"§5 要求落在 IELTSInsight 目录：{value!r}"


@pytest.mark.parametrize(
    ("field", "env"),
    [
        ("OPENAI_BASE_URL", "OPENAI_BASE_URL"),
        ("OPENAI_MODEL", "OPENAI_MODEL"),
        ("AI_TIMEOUT_SEC", "AI_TIMEOUT_SEC"),
    ],
)
def test_AI配置字段存在且可读环境(make_settings, field, env):
    """CONSTITUTION §3 反面教材：ai_review_service 读 settings.OPENAI_BASE_URL 但 config 从没定义过。"""
    settings = make_settings({env: "60" if field == "AI_TIMEOUT_SEC" else "x"})
    assert hasattr(settings, field), f"Settings 缺字段 {field}（§6 要求 config.py 补齐）"
    # 值是否真从环境变量来，取决于 pydantic-settings 的 env 解析；只断言"存在且非 None"
    assert getattr(settings, field) is not None


def test_AI_TIMEOUT默认120秒(make_settings):
    """§3-P 第 4 条：超时默认 120s（推理型端点实测需要）。"""
    settings = make_settings({"AI_TIMEOUT_SEC": None})
    assert hasattr(settings, "AI_TIMEOUT_SEC"), "Settings 缺 AI_TIMEOUT_SEC（§3-P 要求超时可配）"
    assert float(settings.AI_TIMEOUT_SEC) == pytest.approx(120.0), (
        f"AI 超时默认应为 120s，实际 {settings.AI_TIMEOUT_SEC!r}"
    )
