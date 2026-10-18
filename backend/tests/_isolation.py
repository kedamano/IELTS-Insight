"""测试隔离层（CONSTITUTION §6 / test-plan §1 第一行）—— 必须在 import 任何 ``app.*`` 之前执行。

由 ``backend/conftest.py`` 与 ``scripts/check.sh`` 在进程启动时导入。做四件事：

1. 把 ``IELTS_DB_PATH`` / ``IELTS_TTS_CACHE_DIR`` / ``IELTS_ONLINE`` 指向会话级 tmp 目录，
   同时设置同名旧字段（``DB_PATH`` / ``TTS_CACHE_DIR``）好让 **当前尚未支持 IELTS_ 覆盖的 config.py**
   也照样落到 tmp（pydantic-settings 会按字段名读环境变量）——隔离不依赖 backend-core 先落地。
2. 把进程 CWD 切到 tmp 工作目录：现在 ``config.DB_PATH`` 是 ``./db/app.db`` 这种相对路径，
   切目录后旧代码物理上写不到 ``backend/db/app.db`` 或根 ``db/app.db``（双保险）。
3. 用假的 ``whisper`` 模块顶掉真模块，避免 import 即拖入 torch（几 GB 内存 + 数十秒）。
   真正"是否懒加载"的判定放在 ``tests/test_stt_lazy_import.py`` 的子进程探针里，本 stub 只是加速。
4. 记录生产数据库的 sha256，供会话结束时比对（写脏真实库 = 隔离失效 = 直接失败）。

导出：
  - ``REPO_ROOT`` / ``TMP_ROOT`` / ``WORK_DIR`` / ``PROD_DB_CANDIDATES``
  - ``setup_isolation()`` / ``production_db_digest()`` / ``load_module()`` / ``blocked_hosts()``
"""
from __future__ import annotations

import hashlib
import importlib
import os
import shutil
import socket
import sys
import tempfile
import types
from pathlib import Path

def _detect_repo_root() -> Path:
    """仓库根：本文件在 backend/tests/ 下，向上找第一个带 .git 或 docs/specs 的目录。"""
    here = Path(__file__).resolve()
    for candidate in list(here.parents)[::-1]:
        if (candidate / ".git").exists() or (candidate / "docs" / "specs").is_dir():
            return candidate
    return here.parents[1]  # backend/


REPO_ROOT = Path(os.environ["IELTS_TEST_REPO_ROOT"]) if os.environ.get("IELTS_TEST_REPO_ROOT") else _detect_repo_root()

TMP_ROOT = Path(tempfile.mkdtemp(prefix="ielts-pytest-"))
WORK_DIR = TMP_ROOT / "cwd"
WORK_DIR.mkdir(parents=True, exist_ok=True)

# 生产库候选：真实应用可能写这三处（PyInstaller sidecar 的 CWD 是 binaries/ 目录）
PROD_DB_CANDIDATES: tuple[Path, ...] = (
    REPO_ROOT / "backend" / "db" / "app.db",
    REPO_ROOT / "db" / "app.db",
    REPO_ROOT / "frontend" / "src-tauri" / "binaries" / "db" / "app.db",
)

TEST_DB_PATH = TMP_ROOT / "db" / "app.db"
TEST_TTS_CACHE_DIR = TMP_ROOT / "cache" / "tts"
ONLINE_ENV_KEYS = (
    "IELTS_ONLINE",
    "ONLINE_ENABLED",
    "online_enabled",
    "ONLINE",
    "IELTS_ONLINE_ENABLED",
)


def _apply_env() -> None:
    os.environ["IELTS_TEST_REPO_ROOT"] = str(REPO_ROOT)
    os.environ["IELTS_DB_PATH"] = str(TEST_DB_PATH)
    os.environ["IELTS_TTS_CACHE_DIR"] = str(TEST_TTS_CACHE_DIR)
    os.environ["IELTS_ONLINE"] = "0"
    # 旧字段名兜底：config.Settings 的字段就是 DB_PATH/TTS_CACHE_DIR，pydantic-settings 按字段名读 env。
    # backend-core 落地 IELTS_* 覆盖后这两行无害（值一致）。
    os.environ["DB_PATH"] = str(TEST_DB_PATH)
    os.environ["TTS_CACHE_DIR"] = str(TEST_TTS_CACHE_DIR)
    # 绝不把用户凭据带进测试；也绝不读用户的 .env
    os.environ["OPENAI_API_KEY"] = ""
    os.environ["IELTS_AI_API_KEY"] = ""
    for key in ONLINE_ENV_KEYS:
        os.environ.setdefault(key, "0")
    TEST_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    TEST_TTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _install_whisper_stub() -> None:
    """顶掉 openai-whisper（import 即拖 torch）；load_model 调用次数被记录下来。"""
    if "whisper" in sys.modules and not hasattr(sys.modules["whisper"], "_qoder_test_stub"):
        return  # 已经有人 import 了真模块，别覆盖（探针测试用子进程，不受影响）

    stub = types.ModuleType("whisper")
    stub._qoder_test_stub = True  # type: ignore[attr-defined]
    loads: list[tuple[str, str]] = []
    stub._loads = loads  # type: ignore[attr-defined]

    class _FakeTranscribeModel:
        def transcribe(self, audio, **kwargs):  # noqa: ANN001, ARG002
            return {"text": "fake transcript", "segments": [{"id": 0}], "avg_logprob": -0.42}

    def load_model(name, *args, **kwargs):  # noqa: ANN001, ARG002
        loads.append((str(name), str(kwargs.get("device", ""))))
        return _FakeTranscribeModel()

    stub.load_model = load_model  # type: ignore[attr-defined]
    stub.available = types.SimpleNamespace(models=lambda: ["tiny", "base"])  # type: ignore[attr-defined]
    sys.modules["whisper"] = stub


def _install_edge_tts_stub() -> None:
    """顶掉 edge_tts：任何真实合成都会走网络，测试里必须看到"被调用了几次"而不是真发请求。"""
    if "edge_tts" in sys.modules and not hasattr(sys.modules["edge_tts"], "_qoder_test_stub"):
        return

    stub = types.ModuleType("edge_tts")
    stub._qoder_test_stub = True  # type: ignore[attr-defined]
    calls: list[tuple[str, str]] = []
    stub._calls = calls  # type: ignore[attr-defined]

    class _FakeCommunicate:
        def __init__(self, text, voice, **kwargs):  # noqa: ANN001, ARG002
            calls.append((str(text), str(voice)))

        async def stream(self):
            yield {"type": "audio", "data": b"FAKE-MP3-BYTES"}

    stub.Communicate = _FakeCommunicate  # type: ignore[attr-defined]
    sys.modules["edge_tts"] = stub


def setup_isolation() -> None:
    """env + 模块替身。CWD 切换要等到 pytest_configure（早了会让 pytest 找不到 testpaths）。"""
    _apply_env()
    _install_whisper_stub()
    _install_edge_tts_stub()


def enter_workdir() -> None:
    """把进程 CWD 切到 tmp：任何残留的相对路径写法都物理上写不到真实库。"""
    os.chdir(WORK_DIR)


def snapshot_production_db() -> dict[str, str | None]:
    return production_db_digest()


def production_db_digest() -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for p in PROD_DB_CANDIDATES:
        key = str(p.relative_to(REPO_ROOT)) if p.is_absolute() else str(p)
        try:
            out[key] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
        except OSError as exc:  # 文件被真实应用占用也应显式失败，而不是静默跳过
            out[key] = f"UNREADABLE:{exc.__class__.__name__}"
    return out


def resolve_path(value: object) -> Path:
    """把配置里的路径解析成绝对路径（相对路径按进程当前 CWD 解析）。"""
    p = Path(str(value))
    return p if p.is_absolute() else (Path.cwd() / p).resolve()


def online_is_enabled(settings=None) -> bool:  # noqa: ANN001
    """online 开关：读不到 settings 时退回环境变量。"""
    if settings is not None:
        for attr in ("IELTS_ONLINE", "ONLINE_ENABLED", "online_enabled"):
            if hasattr(settings, attr):
                v = getattr(settings, attr)
                if v is not None:
                    return str(v).strip().lower() not in ("0", "false", "no", "off", "")
    for key in ONLINE_ENV_KEYS:
        if key in os.environ:
            return os.environ[key].strip().lower() not in ("0", "false", "no", "off", "")
    return True


def blocked_hosts() -> set[str]:
    """默认测试运行中被网络围栏挡掉的主机（供测试断言"确实没有偷偷联网"）。"""
    return set(getattr(blocked_hosts, "_hosts", set()))


_REAL_SOCKET_CONNECT = socket.socket.connect
_REAL_CREATE_CONNECTION = socket.create_connection
_REAL_GETADDRINFO = socket.getaddrinfo


def _guard_addr(host: object) -> None:
    h = str(host).lower()
    if h in {"127.0.0.1", "localhost", "::1", "", "0.0.0.0"} or h.startswith("127."):
        return
    getattr(blocked_hosts, "_hosts", set()).add(h)
    raise RuntimeError(
        f"测试禁止访问外部网络主机 {h!r}（CONSTITUTION §6：单测不得访问网络）。"
        "AI/TTS/STT 请 monkeypatch app.services.ai_client 与 app.services.tts_service；"
        "真实网络用例请加 @pytest.mark.integration。"
    )


def _blocked_connect(self, address, *args, **kwargs):  # noqa: ANN001, ARG002
    if isinstance(address, tuple) and len(address) >= 2:
        _guard_addr(address[0])
    elif isinstance(address, (str, bytes)):
        _guard_addr(address)
    return _REAL_SOCKET_CONNECT(self, address, *args, **kwargs)


def _blocked_create_connection(address, *args, **kwargs):  # noqa: ANN001, ARG002
    host = address[0] if isinstance(address, tuple) else address
    _guard_addr(host)
    return _REAL_CREATE_CONNECTION(address, *args, **kwargs)


def _blocked_getaddrinfo(host, *args, **kwargs):  # noqa: ANN001, ARG002
    _guard_addr(host)
    return _REAL_GETADDRINFO(host, *args, **kwargs)


def install_network_fence() -> None:
    socket.socket.connect = _blocked_connect  # type: ignore[method-assign]
    socket.create_connection = _blocked_create_connection  # type: ignore[assignment]
    socket.getaddrinfo = _blocked_getaddrinfo  # type: ignore[assignment]
    setattr(blocked_hosts, "_hosts", set())  # noqa: B010


def load_module(dotted: str):
    """导入模块；缺失时明确报"待实现"而不是 collection error / skip 假绿。"""
    try:
        return importlib.import_module(dotted)
    except ModuleNotFoundError as exc:
        raise AssertionError(
            f"RED（等待实现）：`{dotted}` 不存在或依赖缺失 → {exc}。"
            f"契约出处：docs/specs/ielts/spec-contracts.md §6/§3。"
        ) from exc
    except ImportError as exc:
        raise AssertionError(
            f"RED（等待实现）：`{dotted}` 导入失败（符号缺失）→ {exc}。"
        ) from exc


class WaitingForImplementation:
    """模块还没落地时的占位物。

    访问任何属性即 pytest.fail → 结果记为 FAILED（"行为未实现"），
    而不是 fixture setup 的 ERROR（看起来像测试自己坏了）。
    """

    def __init__(self, dotted: str, reason: str) -> None:
        object.__setattr__(self, "_dotted", dotted)
        object.__setattr__(self, "_reason", reason)

    def __getattr__(self, attr: str):
        import pytest

        pytest.fail(
            f"RED（等待实现）：`{object.__getattribute__(self, '_dotted')}` 不可用 "
            f"→ {object.__getattribute__(self, '_reason')}（契约出处 docs/specs/ielts/spec-contracts.md §6）",
            pytrace=False,
        )

    def __repr__(self) -> str:
        return f"<waiting-for-implementation {self._dotted}>"


def try_import(dotted: str):
    """返回真模块，或 WaitingForImplementation 占位物（永不抛，供 fixture 使用）。"""
    try:
        return importlib.import_module(dotted)
    except Exception as exc:  # noqa: BLE001 - 任何导入期问题都归为"未实现/未就绪"
        return WaitingForImplementation(dotted, f"{type(exc).__name__}: {exc}")


def cleanup() -> None:
    shutil.rmtree(TMP_ROOT, ignore_errors=True)
