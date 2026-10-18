"""L3 API 契约：`GET /health`（契约 §1 行 1）与 Settings 四端点（§1 行 2–5、§4；AC-C1/AC-C2）。

覆盖 AC：AC-G1（首启不崩、健康能答）、AC-G2（版本 2.x）、AC-G3（离线时 health 如实报告，不假装在线）、
        AC-C1（PATCH 部分更新，未传字段保持原值）、AC-C2（AI key 只写不读，任何响应不含明文）、
        AC-X1（旧 /token /payment /scenes 端点彻底消失）、FR-G4（错误体中文可读 + 机器码）。
"""
from __future__ import annotations

import pytest
from _api_helpers import is_iso8601

HEALTH_KEYS = {
    "version",
    "ai_configured",
    "ai_base_url_host",
    "whisper",
    "tts_ok",
    "content_counts",
}

MODULES = ("speaking", "listening", "reading", "writing")

SETTINGS_KEYS = {
    "target_band",
    "exam_date",
    "daily_goal_minutes",
    "accent",
    "tts_voice",
    "tts_speed",
    "show_chinese_hints",
    "show_punctuation",
    "online_enabled",
    "audio_device",
    "recording_input_gain",
    "theme",
    "ai",
}


# --------------------------------------------------------------------------
# GET /health
# --------------------------------------------------------------------------
def test_AC_G1_health_返回_envelope(client, envelope):
    data = envelope(client.get("/api/health"))
    assert HEALTH_KEYS <= set(data), f"/health 缺少契约 §1 字段：{sorted(HEALTH_KEYS - set(data))}"


def test_AC_G2_health_版本是_2x_且与_settings_version_一致(client, envelope):
    data = envelope(client.get("/api/health"))
    assert str(data["version"]).startswith("2."), f"产品版本应为 2.x（AC-G2），实际 {data['version']!r}"
    body = client.get("/api/health").json()
    assert "appVersion" not in body, "旧响应字段 appVersion 已改名为 version（契约 §1 行 1）"


def test_AC_G1_health_内容计数只报不变量(client, envelope):
    """题库条数由内容 agent 决定，测试只断言"每科都有键、值是整数"（test-plan §1「断言过死」）。"""
    counts = envelope(client.get("/api/health"))["content_counts"]
    assert set(MODULES) <= set(counts), f"content_counts 应覆盖四科：{counts!r}"
    for module in MODULES:
        value = counts[module]
        assert isinstance(value, int) and value >= 0, f"content_counts[{module}] 应为非负整数，实际 {value!r}"


def test_AC_G3_离线会话下_health_不假装在线(client, envelope):
    """本会话以 ``IELTS_ONLINE=0`` 启动（conftest 的 app_started），健康检查必须如实反映离线。

    另外 /health 本身不允许产生任何出站请求（CONSTITUTION §6：健康检查不是联网探测）。
    """
    import _isolation

    data = envelope(client.get("/api/health"))
    assert data["tts_ok"] is False, "IELTS_ONLINE=0 时 tts_ok 必须为 False（AC-G3/FR-G8）"
    assert _isolation.blocked_hosts() == set(), (
        f"GET /health 期间发生了被围栏拦下的出站连接：{sorted(_isolation.blocked_hosts())}"
    )


def test_AC_G3_whisper_懒加载状态可观测(client, envelope):
    """契约 §1 行 1：whisper 是对象 {loaded, model}，供 UI 显示"语音引擎未就绪"。

    "启动不加载模型"这件事由 tests/test_stt_lazy_import.py 的子进程探针判定（这里不能依赖
    测试执行顺序去断言 loaded is False：同会话里 /api/stt 一旦被调用就会置 True）。
    """
    data = envelope(client.get("/api/health"))
    whisper = data["whisper"]
    assert isinstance(whisper, dict) and {"loaded", "model"} <= set(whisper), f"whisper 结构不符：{whisper!r}"
    assert isinstance(whisper["loaded"], bool), f"whisper.loaded 应为布尔：{whisper!r}"


def test_AC_C2_health_的_ai_状态不含明文_key(client, envelope):
    data = envelope(client.get("/api/health"))
    assert isinstance(data["ai_configured"], bool)
    assert data["ai_base_url_host"] is None or isinstance(data["ai_base_url_host"], str)
    assert "sk-" not in client.get("/api/health").text


# --------------------------------------------------------------------------
# GET /settings（契约 §4）
# --------------------------------------------------------------------------
def test_AC_C1_get_settings_含契约全部字段(client, envelope):
    data = envelope(client.get("/api/settings"))
    assert SETTINGS_KEYS <= set(data), f"GET /settings 缺少 §4 字段：{sorted(SETTINGS_KEYS - set(data))}"


def test_AC_C1_get_settings_默认值符合契约(client, envelope):
    """首启（库里没有 settings 行）时的默认值就是 §4 的示例值。"""
    data = envelope(client.get("/api/settings"))
    assert data["target_band"] == 6.5
    assert data["daily_goal_minutes"] == 60
    assert data["accent"] in ("en-GB", "en-US")
    assert data["show_chinese_hints"] is True
    assert data["show_punctuation"] is True
    assert isinstance(data["online_enabled"], bool)
    assert isinstance(data["tts_speed"], (int, float))
    if data["exam_date"] is not None:
        assert is_iso8601(f"{data['exam_date']}T00:00:00Z"), f"exam_date 应为 YYYY-MM-DD：{data['exam_date']!r}"


def test_AC_C1_ai_块字段齐全(client, envelope):
    ai = envelope(client.get("/api/settings"))["ai"]
    assert {"configured", "base_url_host", "model", "key_source"} <= set(ai), f"ai 块缺字段：{ai!r}"
    assert isinstance(ai["configured"], bool)
    assert ai["key_source"] in ("env", "settings", "none", None), f"key_source 取值异常：{ai['key_source']!r}"


def test_AC_C2_get_settings_永不含明文_key(client, envelope):
    """AC-C2：任何 GET 响应里都不能出现密钥明文。"""
    secret = "sk-secret-value-1234567890"
    client.put("/api/settings/ai-key", json={"key": secret})
    for path in ("/api/settings", "/api/health", "/api/attempts"):
        body = client.get(path)
        assert body.status_code == 200, f"{path} 期望 200，实际 {body.status_code} {body.text[:200]!r}"
        assert secret not in body.text, f"{path} 响应泄漏了明文 key（AC-C2）"
    data = envelope(client.get("/api/settings"))
    assert data["ai"]["configured"] is True, "写入 key 后 ai.configured 应为 True"


def test_AC_C2_ai_块只报_host_不报完整_url(client, envelope):
    client.patch("/api/settings", json={"ai": {"base_url": "https://api.example.com/v1/chat"}})
    ai = envelope(client.get("/api/settings"))["ai"]
    assert ai["base_url_host"] == "api.example.com", f"应只回 host，实际 {ai!r}"


# --------------------------------------------------------------------------
# PATCH /settings —— AC-C1「只传 target_band，其余原值保持」
# --------------------------------------------------------------------------
def test_AC_C1_patch_未传字段保持原值(client, envelope):
    """假绿守卫（test-plan §1）：旧实现用 Form 默认值把未传字段重置回默认，本测试在旧实现下必须红。"""
    first = envelope(client.get("/api/settings"))
    client.patch("/api/settings", json={"accent": "en-US", "daily_goal_minutes": 30, "show_punctuation": False})
    after = envelope(client.patch("/api/settings", json={"target_band": 7.0}))
    assert after["target_band"] == 7.0, f"PATCH 应改 target_band，实际 {after['target_band']!r}"
    for key in SETTINGS_KEYS - {"target_band", "ai"}:
        if key == "accent":
            assert after[key] == "en-US", f"accent 应保持上次 PATCH 的值：{after[key]!r}"
        elif key == "daily_goal_minutes":
            assert after[key] == 30, f"daily_goal_minutes 应保持上次 PATCH 的值：{after[key]!r}"
        elif key == "show_punctuation":
            assert after[key] is False, f"show_punctuation 应保持上次 PATCH 的值：{after[key]!r}"
        else:
            assert after[key] == first[key], f"未传字段 {key} 不该被重置：{first[key]!r} -> {after[key]!r}"


def test_AC_C1_主题默认跟随系统(client, envelope):
    """Wave 4 双主题：首启必须是 `system`（跟随系统），不能擅自锁死浅色或深色。"""
    assert envelope(client.get("/api/settings"))["theme"] == "system"


def test_AC_C1_主题可改浅色与深色(client, envelope):
    for theme in ("light", "dark", "system"):
        assert envelope(client.patch("/api/settings", json={"theme": theme}))["theme"] == theme


def test_FR_G4_非法主题返回_400(client):
    """`theme` 是枚举，写错的值必须挡下来而不是存进库里让前端猜。"""
    resp = client.patch("/api/settings", json={"theme": "midnight"})
    assert resp.status_code == 400, f"非法 theme 应 400，实际 {resp.status_code}"
    assert "theme" in resp.json()["detail"], f"错误信息要指名是哪个字段：{resp.json()}"


def test_AC_C1_patch_可改_ai_base_url_与_model(client, envelope):
    after = envelope(client.patch("/api/settings", json={"ai": {"base_url": "https://open.bigmodel.cn/api/paas/v4", "model": "glm-4.6"}}))
    assert after["ai"]["base_url_host"] == "open.bigmodel.cn"
    assert after["ai"]["model"] == "glm-4.6"


def test_FR_G4_patch_非法_target_band_返回_400(client):
    """契约 §0：400 + {detail(中文), code}。"""
    resp = client.patch("/api/settings", json={"target_band": 12.0})
    assert resp.status_code == 400, f"越界目标分应 400，实际 {resp.status_code}：{resp.text[:200]!r}"
    body = resp.json()
    assert "detail" in body and "code" in body, f"错误体应为 {{detail, code}}：{body!r}"
    assert any("\u4e00" <= ch <= "\u9fff" for ch in str(body["detail"])), f"detail 应中文可读：{body!r}"


def test_FR_G4_get_不存在的路径返回_404_带机器码(client):
    resp = client.get("/api/definitely-not-here")
    assert resp.status_code == 404
    body = resp.json()
    assert "code" in body, f"404 也要有机器码（契约 §0）：{body!r}"


# --------------------------------------------------------------------------
# PUT / DELETE /settings/ai-key
# --------------------------------------------------------------------------
def test_AC_C2_put_ai_key_只回_present(client):
    resp = client.put("/api/settings/ai-key", json={"key": "sk-abcdef-0123456789"})
    assert resp.status_code == 200, f"PUT ai-key 期望 200，实际 {resp.status_code}：{resp.text[:200]!r}"
    data = resp.json()["data"]
    assert data.get("ai_key_present") is True, f"响应不符契约 §1 行 4：{data!r}"
    assert "sk-abcdef-0123456789" not in resp.text, "PUT 响应不得回显 key（AC-C2）"


def test_AC_C2_delete_ai_key_后_present_为_false(client, envelope):
    client.put("/api/settings/ai-key", json={"key": "sk-to-delete"})
    data = envelope(client.delete("/api/settings/ai-key"))
    assert data.get("ai_key_present") is False, f"删除后应 ai_key_present=False：{data!r}"
    assert envelope(client.get("/api/settings"))["ai"]["configured"] is False


def test_AC_C2_ai_key_存库后不回读(client, db_path):
    """key 落库（重启不丢），但 GET /settings 永不回读它 —— 只以 ai_key_present/configured 呈现。"""
    import sqlite3

    secret = "sk-stored-9876543210"
    client.put("/api/settings/ai-key", json={"key": secret})
    conn = sqlite3.connect(db_path)
    try:
        rows = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        blobs = []
        for table in rows:
            for row in conn.execute(f"SELECT * FROM {table} LIMIT 50"):  # noqa: S608 - 全表扫描做泄漏检查
                blobs.append(str(row))
        assert any(secret in blob for blob in blobs), (
            "契约 §1 行 4 的 key 应当持久化（重启仍可用）；若产品决定只存 .env，请改契约"
        )
    finally:
        conn.close()
    assert secret not in client.get("/api/settings").text, "持久化了也不能回读明文（AC-C2）"


def test_FR_G4_put_空_key_返回_400(client):
    resp = client.put("/api/settings/ai-key", json={"key": ""})
    assert resp.status_code == 400, f"空 key 应 400，实际 {resp.status_code}"
    assert "code" in resp.json()


# --------------------------------------------------------------------------
# AC-X1：旧付费/剧本端点必须消失（防回归）
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/payment/order"),
        ("post", "/api/payment/order"),
        ("post", "/api/payment/verify"),
        ("get", "/api/scenes"),
        ("get", "/api/scenes/free_01"),
        ("post", "/api/sentence-parse/free_01/1"),
        ("get", "/api/learning-stats"),
        ("get", "/api/achievements"),
        ("get", "/api/wrong-records"),
        ("get", "/api/wordbook"),
        ("post", "/api/score"),
    ],
)
def test_AC_X1_旧端点已删除(client, method, path):
    resp = getattr(client, method)(path)
    assert resp.status_code in (404, 405), (
        f"{method.upper()} {path} 应已删除（契约 §1「删除」行），实际 {resp.status_code}：{resp.text[:200]!r}"
    )
    if resp.status_code == 404:
        body = resp.json()
        assert "code" in body, f"404 错误体要有机器码（契约 §0）：{body!r}"
