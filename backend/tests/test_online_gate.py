"""L1/L3 契约：设置里的「允许在线服务」必须真的闸住出站（spec-contracts §15.2，Wave 7 B2）。

单独立一个文件的理由：这条防的不是「功能坏了」，而是**界面上有一个关不掉的开关** ——
`settings.online_enabled` 自 Wave 1 起就一直没人读，取消勾选之后作文正文照样发给远端。
其它用例看不出这种回归：它们断言的是「进程级 `IELTS_ONLINE=0` 时不出门」，
而本文件断言的是**用户那一侧的开关也算数**。

纪律：本文件的任何用例都不许真的把请求放出去（CONSTITUTION §1/§6）。
所以「打开开关」的方向只断言判定函数与 `/health` 读数，不打 `/api/tts` 的成功路径。
"""
from __future__ import annotations

import sqlite3
from typing import Any

import pytest
import _isolation
from app.config import settings as _cfg


@pytest.fixture
def 进程允许在线(monkeypatch: pytest.MonkeyPatch):
    """会话默认 `IELTS_ONLINE=0`；这里把进程级闸门抬起来，好单独看用户开关的作用。"""
    monkeypatch.setattr(_cfg, "ONLINE", True, raising=True)


def _set_online(client, envelope, value: bool) -> None:
    envelope(client.patch("/api/settings", json={"online_enabled": value}))


@pytest.fixture
def 无新增出站():
    """围栏计数是**进程级**的（`test_isolation.py` 会故意打一发 8.8.8.8 证明围栏有效），
    所以这里只能断言「本用例期间没有新增」，不能断言整个会话为零。"""
    before = set(_isolation.blocked_hosts())

    def _check() -> None:
        fresh = set(_isolation.blocked_hosts()) - before
        assert fresh == set(), f"关闭在线服务后仍尝试了出站连接：{sorted(fresh)}"

    return _check


def _essay() -> str:
    spine = "many employees now work from home and observers agree this trend will continue "
    return " ".join([spine] * 8)


def _writing_task_id(client, envelope) -> str:
    items = envelope(client.get("/api/writing/tasks", params={"module": "task2"}))["items"]
    assert items, "内容下限：写作 task2 至少要有一题"
    return str(items[0]["id"])


# --------------------------------------------------------------------------
# L1：判定点的 AND 语义（契约 §15.2 第 1/2/3/4 条）
# --------------------------------------------------------------------------
def test_进程在线但用户关闭_判定为不出门(load, 进程允许在线):
    """§15.2 第 1/2 条：用户开关参与判定 —— 这一条正是 B2 要修的缺陷。"""
    from app.db import store

    ai_client = load("app.services.ai_client")
    store.patch_settings({"online_enabled": False})
    try:
        assert ai_client.network_allowed() is False, "用户已关闭在线服务，判定点却仍放行"
    finally:
        store.patch_settings({"online_enabled": True})


def test_用户勾选但进程关闭_判定为不出门(load):
    """§15.2 第 2 条的另一半：env 总闸优先，用户勾了也不许出门。"""
    from app.db import store

    ai_client = load("app.services.ai_client")
    store.patch_settings({"online_enabled": True})
    assert _cfg.ONLINE is False, "本用例的前提是会话级 IELTS_ONLINE=0"
    assert ai_client.network_allowed() is False


def test_判定每次现读设置_改完立刻生效(load, 进程允许在线):
    """§15.2 第 3 条：不许在导入时把设置求成常量 —— 「要重启才生效」的开关不是开关。"""
    from app.db import store

    ai_client = load("app.services.ai_client")
    store.patch_settings({"online_enabled": False})
    try:
        assert ai_client.network_allowed() is False
        store.patch_settings({"online_enabled": True})
        assert ai_client.network_allowed() is True, "重新勾选后仍判为离线：设置被缓存了"
    finally:
        store.patch_settings({"online_enabled": True})


def test_读不到设置时关门(load, 进程允许在线, monkeypatch):
    """§15.2 第 4 条 fail-closed：误判离线可见可恢复，误判在线是把内容发出去、收不回。"""
    from app.db import store

    ai_client = load("app.services.ai_client")

    def _locked(*_a: Any, **_k: Any) -> None:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(store, "get_settings", _locked)
    assert ai_client.network_allowed() is False, "设置读不出来时必须判为不出门"


# --------------------------------------------------------------------------
# L3：闸门的每个出口都得接到它（契约 §15.2 第 1/2/5 条）
# --------------------------------------------------------------------------
def test_用户关闭后_tts_端点拒绝出门(client, envelope, error_body, 进程允许在线, 无新增出站):
    _set_online(client, envelope, False)
    body = error_body(client.get("/api/tts", params={"text": "To be or not to be"}), status=503)
    assert body["code"] == "tts_offline", f"关闭在线服务后 TTS 的错误码应说明是主动关闭：{body!r}"
    assert "联网" in body["detail"]
    无新增出站()


def test_用户关闭后_听力音频退回原文模式(client, envelope, 进程允许在线, 无新增出站):
    _set_online(client, envelope, False)
    set_id = str(envelope(client.get("/api/listening/sets"))["items"][0]["id"])
    response = client.get(f"/api/listening/sets/{set_id}/audio")
    assert response.status_code == 503, f"关闭在线服务后听力音频应可见降级：{response.status_code}"
    body = response.json()
    assert body["transcript_available"] is True, "降级必须同时告诉用户原文精读还可用（AC-L1b）"
    assert "联网" in body["detail"], f"文案要说明是用户关掉的，不是服务坏了：{body['detail']!r}"
    无新增出站()


def test_用户关闭后_写作批改只走本地近似(client, envelope, 进程允许在线, 无新增出站):
    _set_online(client, envelope, False)
    report = envelope(
        client.post(
            "/api/writing/attempts",
            json={"task_id": _writing_task_id(client, envelope), "response": _essay()},
        )
    )
    assert report["ai_used"] is False, "用户关闭在线服务后不许假装用了 AI"
    assert report["degraded_reason"] == "offline_template", (
        f"降级原因要点名离线，而不是网络错误：{report['degraded_reason']!r}"
    )
    无新增出站()


def test_用户关闭后_health_读数如实且勾选回来立刻恢复(
    client, envelope, 进程允许在线, 无新增出站
):
    """§15.2 第 5 条：`tts_ok` 报的是**生效**状态，不是用户愿望；且改设置不用重启就能反映。"""
    _set_online(client, envelope, False)
    assert envelope(client.get("/api/health"))["tts_ok"] is False, (
        "用户已关闭在线服务，/health 不许报告音频可用"
    )
    _set_online(client, envelope, True)
    assert envelope(client.get("/api/health"))["tts_ok"] is True, (
        "edge-tts 已安装且进程在线，重新勾选后读数应恢复"
    )
    无新增出站()


def test_设置里勾选但进程关闭时_health_仍报不可用(client, envelope):
    """会话级 `IELTS_ONLINE=0` + 用户勾选 ⇒ 仍不许报「可用」。"""
    _set_online(client, envelope, True)
    assert envelope(client.get("/api/health"))["tts_ok"] is False
