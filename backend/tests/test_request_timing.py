from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.services import faultlog


@pytest.fixture()
def client():
    return TestClient(app)


def test_正常请求记录耗时(client, monkeypatch):
    calls = []
    monkeypatch.setattr(faultlog, "info", lambda tag, msg: calls.append((tag, msg)))
    r = client.get("/api/health")
    assert r.status_code == 200
    timing = [m for t, m in calls if t == "Timing"]
    assert any("GET /api/health" in m and "200" in m for m in timing)


def test_404请求也记录(client, monkeypatch):
    calls = []
    monkeypatch.setattr(faultlog, "info", lambda tag, msg: calls.append((tag, msg)))
    r = client.get("/api/nonexistent-xyz")
    assert r.status_code == 404
    timing = [m for t, m in calls if t == "Timing"]
    assert any("404" in m for m in timing)


def test_中间件不影响响应体(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert "version" in r.json()["data"]
