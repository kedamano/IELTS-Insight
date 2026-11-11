"""安全响应头（第 ② 项）：成功与错误响应都要有基础头。

守三条不变量：
1. 成功响应带 nosniff / X-Frame-Options / Referrer-Policy；
2. 错误响应（404 / 400）同样带 —— 异常处理器的响应也走这条中间件；
3. 不与既有错误处理器里的 nosniff 重复（同一名只出现一次）。
"""

from __future__ import annotations

from starlette.testclient import TestClient

from app.main import app

EXPECTED = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
}


def _headers_of(path: str) -> dict[str, list[str]]:
    """取响应头（同名可能多值，用 getlist 语义）。"""
    client = TestClient(app)
    resp = client.get(path)
    assert resp.status_code in (200, 404), f"意外状态 {resp.status_code}"
    return {name: resp.headers.get_list(name) for name in EXPECTED}


def test_成功响应带安全头():
    headers = _headers_of("/api/health")
    for name, expected in EXPECTED.items():
        assert headers[name] == [expected], f"{name} 应为 [{expected}]，实际 {headers[name]}"


def test_404响应同样带安全头():
    headers = _headers_of("/api/nonexistent-xyz")
    for name, expected in EXPECTED.items():
        assert headers[name] == [expected], f"404 的 {name} 应为 [{expected}]，实际 {headers[name]}"


def test_响应头不重复():
    """common.py 的错误处理器自己也设过 nosniff；中间件按名去重，不该出现两次。"""
    headers = _headers_of("/api/nonexistent-xyz")
    assert len(headers["x-content-type-options"]) == 1, "nosniff 重复出现"
