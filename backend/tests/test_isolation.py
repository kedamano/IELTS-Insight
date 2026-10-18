"""测试隔离守卫（CONSTITUTION §6 / test-plan §1 第一行）。

覆盖 AC：CONSTITUTION §6（禁止测试写真实库）、§5（默认不跑 integration）。

这里断言的是"隔离机制本身"，因此现在就应该全绿；它绿得越早，backend-core 之后把 IELTS_DB_PATH
接进 config.py 时越不可能悄悄退化。真正的写脏检测由 conftest 的会话级 autouse fixture 在
套件结束时比对三处生产库的 sha256（backend/db/app.db、db/app.db、src-tauri/binaries/db/app.db）。
"""
from __future__ import annotations

import os
import socket
import sys
from pathlib import Path

import pytest


def test_隔离在任何app导入之前生效():
    """conftest 顶部必须先装隔离再 import app.*，否则 Settings 单例已经指向真实库。"""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import _isolation

    from app.config import settings  # 此刻才首次导入 app.*

    resolved = _isolation.resolve_path(settings.DB_PATH)
    assert str(_isolation.TMP_ROOT) in str(resolved), (
        f"IELTS_DB_PATH 没有落到测试 tmp：settings.DB_PATH={settings.DB_PATH!r} → {resolved}"
    )
    assert resolved != (_isolation.REPO_ROOT / "backend" / "db" / "app.db"), "仍然指向用户真实库！"


def test_进程CWD已被切到tmp防止相对路径写脏():
    import _isolation

    assert Path.cwd() == _isolation.WORK_DIR, f"CWD={Path.cwd()}，应为 {_isolation.WORK_DIR}"


def test_环境变量已按契约命名注入():
    """spec-contracts §5/§6：IELTS_DB_PATH / IELTS_TTS_CACHE_DIR / IELTS_ONLINE。"""
    for key in ("IELTS_DB_PATH", "IELTS_TTS_CACHE_DIR"):
        assert key in os.environ, f"{key} 必须设置（CONSTITUTION §6 点名的隔离开关）"
        assert Path(os.environ[key]).is_absolute(), f"{key} 必须是绝对路径：{os.environ[key]}"
        assert str(Path(os.environ[key]).parent).startswith(str(Path(os.environ["IELTS_DB_PATH"]).parent.parent)), (
            f"{key} 应落在测试 tmp 目录树内：{os.environ[key]}"
        )
    assert os.environ.get("IELTS_ONLINE") == "0", "IELTS_ONLINE 必须置 0（CONSTITUTION §6：单测不访问网络）"
    assert not os.environ.get("OPENAI_API_KEY"), "测试进程不许携带真实 AI 凭据"


def test_网络围栏挡掉外部主机():
    with pytest.raises(RuntimeError, match="测试禁止访问外部网络"):
        socket.create_connection(("8.8.8.8", 53), timeout=1)


def test_网络围栏不挡本地回环():
    """TestClient/uvicorn 用 ASGI 直连，不该被围栏误伤；这里只验证 127.0.0.1 不被拒绝。"""
    sock = socket.socket()
    try:
        sock.settimeout(0.2)
        try:
            sock.connect(("127.0.0.1", 1))
        except (ConnectionRefusedError, TimeoutError, OSError) as exc:
            # 拒绝/超时都说明连接被放行到 OS 层；只有围栏的 RuntimeError 才是隔离坏了
            assert "测试禁止访问外部网络" not in str(exc)
    finally:
        sock.close()


def test_默认运行排除integration用例():
    """CONSTITUTION §5 / test-plan §0：pytest.ini 必须默认 -m "not integration" 且注册 marker。"""
    import _isolation

    ini = _isolation.REPO_ROOT / "backend" / "pytest.ini"
    assert ini.is_file(), "pytest.ini 必须存在（markers/integration 注册处）"
    text = ini.read_text(encoding="utf-8")
    assert "not integration" in text, "pytest.ini 的 addopts 必须默认排除 integration"
    assert "integration:" in text, "pytest.ini 必须注册 integration marker（否则 --strict-markers 会红）"


def test_whisper没有被真实导入():
    """test-plan §1：import 阶段不许拖入 torch/whisper 真模块。"""
    assert "app.services.stt_service" not in sys.modules or "torch" not in sys.modules, (
        "torch 被导入了：stt_service 仍是模块级加载 whisper 模型"
    )
    whisper = sys.modules.get("whisper")
    assert whisper is not None and getattr(whisper, "_qoder_test_stub", False), (
        "whisper 未被测试替身接管 —— 说明有测试绕过了 conftest 隔离"
    )
