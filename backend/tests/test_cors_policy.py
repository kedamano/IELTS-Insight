"""CORS 与 DEBUG 默认值（CONSTITUTION §6 隔离 / §3 不外泄）。

为什么单独一档测试：`DEBUG` 的默认值就是**打包出去的值**。sidecar 没有 `.env`，
`DEBUG=True` 会让 `allow_origins` 变成 `["*"]`，而中间件同时开着 `allow_credentials=True` ——
用户浏览器里打开的任何一个网页都能读写本机学习库（改目标分、删练习记录）。
默认值必须是「关」，开发要通配时显式 `DEBUG=true`。
"""
from __future__ import annotations

import pytest

from app.main import cors_allow_origins

# 一个与本机无关的外部站点：它绝不该拿到放行头
FOREIGN = "http://evil.example"


def test_DEBUG默认为假(make_settings):
    """默认值即生产值：不显式开 DEBUG 就不许是 True。"""
    settings = make_settings({"DEBUG": None})
    assert settings.DEBUG is False, (
        f"DEBUG 默认仍是 {settings.DEBUG!r}：打包出去的 sidecar 会把 CORS 开成通配"
    )


def test_默认策略不含通配():
    origins = cors_allow_origins(False)
    assert "*" not in origins, f"非 DEBUG 下出现通配：{origins!r}"


def test_显式开发模式仍给通配():
    assert cors_allow_origins(True) == ["*"], "DEBUG=true 时应当仍然放开，否则本地联调要改代码"


def test_名单覆盖Tauri与本机vite的两种host():
    """Tauri v1/v2 各平台 origin + vite 的 localhost / 127.0.0.1 两种写法。

    实拍脚本与部分用户会用 `http://127.0.0.1:5173` 打开开发页；只写 localhost 的话，
    收紧默认值会顺手把开发链路打断。
    """
    origins = cors_allow_origins(False)
    for expected in (
        "tauri://localhost",
        "http://tauri.localhost",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ):
        assert expected in origins, f"放行名单缺 {expected}：{origins!r}"


def test_外部origin拿不到放行头(client):
    """行为断言：不是只看名单，而是中间件真的不回显陌生 origin。"""
    response = client.options("/api/health", headers={"Origin": FOREIGN})
    allow = response.headers.get("access-control-allow-origin")
    assert allow != "*", f"预检对陌生 origin 回了通配：{allow!r}"
    assert allow != FOREIGN, f"陌生 origin 被回显放行：{allow!r}"


@pytest.mark.parametrize("origin", ["tauri://localhost", "http://tauri.localhost"])
def test_名单内origin被如实回显(client, origin):
    """webview 的 origin 必须拿得到自己的头，否则收紧后 app 直接白屏。"""
    response = client.options("/api/health", headers={"Origin": origin})
    assert response.headers.get("access-control-allow-origin") == origin
