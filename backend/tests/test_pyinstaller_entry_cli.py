"""冻结入口的命令行参数解析（--port / --host）。

守的坑：这个函数不存在时，`backend.exe --port 8798` 会被**静默忽略** ——
日志照旧写「准备监听 8765」，然后撞端口退出，排查时看到的是「端口被占用」，
指不到真正的错因。
"""

from __future__ import annotations

import importlib

import pytest

entry = importlib.import_module("pyinstaller_entry")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """每个用例前后清掉这两个 env，避免互相污染。"""
    monkeypatch.delenv("API_PORT", raising=False)
    monkeypatch.delenv("API_HOST", raising=False)


def test_无参数时不改环境():
    entry._apply_cli_overrides([])
    import os

    assert "API_PORT" not in os.environ
    assert "API_HOST" not in os.environ


def test_识别等号形式的端口():
    entry._apply_cli_overrides(["--port=8798"])
    import os

    assert os.environ["API_PORT"] == "8798"


def test_识别空格形式的端口与主机():
    entry._apply_cli_overrides(["--port", "8798", "--host", "0.0.0.0"])
    import os

    assert os.environ["API_PORT"] == "8798"
    assert os.environ["API_HOST"] == "0.0.0.0"


def test_端口后缺值不炸():
    entry._apply_cli_overrides(["--port"])
    import os

    assert "API_PORT" not in os.environ


def test_未知参数被忽略():
    entry._apply_cli_overrides(["--verbose", "--port=9000", "whatever"])
    import os

    assert os.environ["API_PORT"] == "9000"


def test_已有env不被无关参数覆盖(monkeypatch):
    monkeypatch.setenv("API_PORT", "8765")
    entry._apply_cli_overrides(["--host=127.0.0.1"])
    import os

    assert os.environ["API_PORT"] == "8765"
    assert os.environ["API_HOST"] == "127.0.0.1"
