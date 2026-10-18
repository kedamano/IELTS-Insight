"""pytest 根配置 —— 隔离优先（CONSTITUTION §6 / test-plan §1）。

⚠ 本文件顶部先安装测试隔离，任何 ``import app.*`` 都必须发生在它之后。
旧版本在这里 import ``app.models.database`` 并把 ``DB_PATH`` 写在 Settings 已经实例化之后，
隔离完全无效 —— 每次 pytest 都会把用户真实 ``backend/db/app.db`` 写脏。现在：

1. ``IELTS_DB_PATH`` / ``IELTS_TTS_CACHE_DIR`` / ``IELTS_ONLINE`` 指向会话级 tmp 目录
   （同时设置同值旧字段 ``DB_PATH`` / ``TTS_CACHE_DIR``，让"env 覆盖尚未实现"的现在也隔离得住）；
2. 进程 CWD 切到 tmp：``./db/app.db`` 这类相对路径物理上写不到真实库；
3. 假 ``whisper`` / ``edge_tts`` 顶掉 torch 与网络依赖（懒加载本身由 test_stt_lazy_import.py 的子进程探针判定）；
4. 网络围栏：连非 127.0.0.1 的地址直接 RuntimeError；
5. 会话结束比对三处生产库的 sha256（test_isolation.py 报错）。
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import sys
import types as _types
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
for _p in (str(_HERE), str(_HERE / "tests")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import _isolation  # noqa: E402  本地模块，必须先于任何 app.* 导入

_isolation.setup_isolation()
_isolation.install_network_fence()

PROD_DB_SNAPSHOT = _isolation.production_db_digest()

import pytest  # noqa: E402

# --------------------------------------------------------------------------
# 内容下限（spec-product.md FR-S1）：测试只断言这些不变量，绝不断言具体总条数。
# 内容只增不减，所以这些数字是地板不是天花板。
# --------------------------------------------------------------------------
CONTENT_FLOORS: dict[str, int] = {
    "speaking_part1_topics": 12,
    "speaking_part1_questions_per_topic": 3,
    "speaking_part2_cue_cards": 6,
    "speaking_part3_followups_per_card": 3,
    "listening_sets": 2,
    "listening_questions_per_set": 20,
    "reading_sets": 2,
    "reading_questions_per_set": 13,
    "writing_task1": 3,
    "writing_task2": 3,
}

# spec-contracts.md §3-B 的 band 锚点（4 个 AC 锚点 + 官方 40 题原表锚点）
BAND_ANCHORS: dict[str, tuple[tuple[int, int, float], ...]] = {
    "listening": ((16, 20, 7.0), (13, 20, 6.0), (20, 20, 9.0), (0, 20, 0.0)),
    "reading": ((10, 13, 7.0), (8, 13, 6.0), (13, 13, 9.0), (0, 13, 0.0)),
    "listening_40q": ((30, 40, 7.0), (23, 40, 6.0), (39, 40, 9.0), (0, 40, 0.0)),
    "reading_40q": ((31, 40, 7.0), (23, 40, 6.0), (39, 40, 9.0), (0, 40, 0.0)),
}

# §5 可变表：每个测试前清空。sets 是内容表，由 startup 载入后跨测试保留。
MUTABLE_TABLES: tuple[str, ...] = (
    "attempt_items",
    "attempts",
    "jobs",
    "speaking_turns",
    "speaking_sessions",
    "review_items",
    "vocab",
    "practice_minutes",
    "plan_tasks",
    "settings",
)

_had_failures = {"value": False}


# --------------------------------------------------------------------------
# pytest hooks
# --------------------------------------------------------------------------
def pytest_configure(config: object) -> None:  # noqa: ARG001
    """args/testpaths 已解析完毕，此时才安全地切走 CWD（仍在任何 app.* 导入之前）。"""
    _isolation.enter_workdir()


def pytest_runtest_logreport(report: object) -> None:
    if getattr(report, "failed", False):
        _had_failures["value"] = True


def pytest_collection_modifyitems(config: object, items: list) -> None:  # noqa: ANN001
    picked = [i for i in items if i.get_closest_marker("integration")]
    if picked and os.environ.get("RUN_INTEGRATION") != "1":
        names = ", ".join(i.name for i in picked[:5])
        pytest.exit(
            "integration 用例必须显式 RUN_INTEGRATION=1 才能运行（会打真实网络/AI）。已选中: " + names,
            returncode=2,
        )


# --------------------------------------------------------------------------
# 会话级信息
# --------------------------------------------------------------------------
@pytest.fixture(scope="session")
def repo_root() -> Path:
    """仓库根目录绝对路径（进程 CWD 已被切到 tmp，测试里必须用它）。"""
    return _isolation.REPO_ROOT


@pytest.fixture(scope="session")
def tmp_workdir() -> Path:
    return _isolation.WORK_DIR


@pytest.fixture(scope="session")
def content_floors() -> dict[str, int]:
    return CONTENT_FLOORS


@pytest.fixture(scope="session")
def band_anchors() -> dict[str, tuple[tuple[int, int, float], ...]]:
    return BAND_ANCHORS


@pytest.fixture(scope="session", autouse=True)
def _production_db_guard():
    """会话结束时校验生产库未被写脏。

    只有全绿会话才作为哨兵报错：隔离真坏掉时其它测试必然红，那时的退出码已经是 1，
    在这里再抛一次失败只会掩盖真正的失败原因。不健康会话里额外打印显式诊断。
    """
    yield
    after = _isolation.production_db_digest()
    if after != PROD_DB_SNAPSHOT:
        changed = [k for k, v in after.items() if v != PROD_DB_SNAPSHOT.get(k)]
        message = (
            "ISOLATION VIOLATION: 测试进程写脏了生产数据库 "
            f"{changed}。快照时间=conftest 导入前，比对时间=会话结束。见 CONSTITUTION §6。"
        )
        if _had_failures["value"]:
            print(f"\n[qa-isolation-diagnostic] {message}", flush=True)
        else:
            pytest.fail(message, pytrace=False)


# --------------------------------------------------------------------------
# 通用工具
# --------------------------------------------------------------------------
@pytest.fixture(scope="session")
def load():
    """``load("app.services.band_scale")``：模块缺失时报"RED（等待实现）"，不是 collection error 也不是 skip。"""
    return _isolation.load_module


@pytest.fixture(scope="session")
def load_or_wait():
    """返回模块；模块还没落地时返回占位物 —— 属性访问发生在**测试体内**，所以记为 FAILED 而不是 ERROR。"""
    return _isolation.try_import


@pytest.fixture(scope="session")
def resolve() -> Any:
    return _isolation.resolve_path


@contextlib.contextmanager
def _env_overlay(overrides: dict[str, Any]):
    old: dict[str, str | None] = {}
    for key, value in (overrides or {}).items():
        old[key] = os.environ.get(key)
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = str(value)
    try:
        yield
    finally:
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


@pytest.fixture
def settings_cls():
    from app.config import Settings  # 延迟导入：隔离已安装

    return Settings


@pytest.fixture
def make_settings(settings_cls):
    """在指定 env 覆盖下构造全新 Settings（不动已导入的单例）。传 None 表示删除该变量。"""

    def _make(overrides: dict[str, Any] | None = None, cls=None):
        with _env_overlay(overrides):
            return (cls or settings_cls)()

    return _make


@pytest.fixture
def env_overlay():
    """把环境变量临时改掉（用于验证 IELTS_ONLINE=0 之类"配置真的被读到"）。"""
    return _env_overlay


# --------------------------------------------------------------------------
# 数据库 / TestClient
# --------------------------------------------------------------------------
def _test_db_file() -> Path:
    """当前实现认为的 sqlite 文件位置（IELTS_DB_PATH 生效时就是它）。"""
    explicit = os.environ.get("IELTS_DB_PATH") or os.environ.get("DB_PATH")
    if explicit:
        return Path(explicit)
    from app.config import settings  # noqa: PLC0415  延迟导入

    return _isolation.resolve_path(getattr(settings, "DB_PATH", "./db/app.db"))


@pytest.fixture
def db_path() -> Path:
    return _test_db_file()


@pytest.fixture(scope="session")
def app_started():
    """会话内跑**一次** lifespan：建库（migrate.run）+ 装载题库（sets_loader）。

    ``app/main.py`` 的初始化在 lifespan 里，而 starlette 的 TestClient 只有作为上下文管理器时才跑
    lifespan。这里进一次上下文（portal 常驻整个会话），各测试再各自 ``TestClient(app)`` 打请求，
    既不重复灌库也不需要 ``import app.main`` 时建表。

    用 ``IELTS_ONLINE=0`` 包住导入与启动：startup 绝不发真实网络请求（CONSTITUTION §6）。
    """
    with _env_overlay({"IELTS_ONLINE": "0", "ONLINE": "0"}):
        try:
            from fastapi.testclient import TestClient

            from app.main import app
        except Exception as exc:  # noqa: BLE001 - 装配失败要让 L3 全部亮红
            pytest.fail(
                f"RED（等待实现）：`app.main` 无法导入/启动 —— {type(exc).__name__}: {exc}",
                pytrace=False,
            )
        with TestClient(app) as started:
            yield started


@pytest.fixture
def db(db_path, app_started) -> sqlite3.Connection:  # noqa: ARG001 - app_started 负责建库
    if not db_path.exists():
        pytest.fail(
            f"RED（等待实现）：测试库 {db_path} 没有被创建 —— app/db/migrate.py 的建库路径没跑通。",
            pytrace=False,
        )
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()


@pytest.fixture
def table_names(db) -> set[str]:
    return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


@pytest.fixture
def clean_db(db, table_names):
    """清空可变表（保留 sets 内容）。契约 §5：attempts 是唯一练习事实表。"""
    for table in MUTABLE_TABLES:
        if table in table_names:
            db.execute(f"DELETE FROM {table}")  # noqa: S608 - 固定表名白名单
    db.commit()
    return db


@pytest.fixture
def client(app_started, clean_db):  # noqa: ARG001 - app_started 已跑过 lifespan
    """每个测试一个全新 TestClient（不打 lifespan，startup 已在会话里跑过一次）。"""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


@pytest.fixture
def conn(client, clean_db) -> sqlite3.Connection:
    """L3 用：确保 app 已导入（= 库已建好）之后的空库连接。"""
    return clean_db


@pytest.fixture
def seed(conn, clean_db) -> "SeedHelper":  # noqa: ARG001 - 依赖只为了保证建库/清表顺序
    """把契约 §5 表里的示例数据直接写库（不依赖 store.py 的函数签名）。"""
    return SeedHelper(conn)


class SeedHelper:
    """``seed.attempts()`` / ``seed.review()`` / ``seed.minutes()`` —— 幂等写入固定测试数据。"""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def attempts(self, rows=None) -> list[str]:
        import _api_helpers

        ids = []
        for row in rows if rows is not None else _api_helpers.SEED_ROWS:
            exists = self.conn.execute("SELECT 1 FROM attempts WHERE id = ?", (row["id"],)).fetchone()
            if not exists:
                ids.append(_api_helpers.seed_attempt(self.conn, row))
            else:
                ids.append(row["id"])
        return ids

    def review(self, **spec) -> str:
        import _api_helpers

        exists = self.conn.execute("SELECT 1 FROM review_items WHERE id = ?", (spec["id"],)).fetchone()
        if exists:
            return spec["id"]
        return _api_helpers.seed_review_item(self.conn, **spec)

    def minutes(self, date: str, minutes: float, attempts: int = 1) -> None:
        import _api_helpers

        _api_helpers.seed_minutes(self.conn, date, minutes, attempts)

    def clear_attempts(self) -> None:
        for table in ("attempt_items", "speaking_turns", "speaking_sessions", "attempts", "review_items"):
            self.conn.execute(f"DELETE FROM {table}")  # noqa: S608 - 固定表名白名单
        self.conn.commit()


@pytest.fixture
def clean_state(client, seed) -> sqlite3.Connection:  # noqa: ARG001 - client 保证 app 已导入
    """需要"已有练习记录"的 L3 测试用；只想要空库的测试请只用 ``clean_db``/``conn``。"""
    seed.attempts()
    return seed.conn


@pytest.fixture
def envelope():
    """契约 §0：除音频/文件外一切响应都是 200 + {"data": ...}。"""

    def _unwrap(response, *, status: int = 200) -> Any:
        assert response.status_code == status, (
            f"状态码期望 {status}，实际 {response.status_code}；body={response.text[:400]!r}"
        )
        body = response.json()
        assert "data" in body, f"响应缺少 envelope 字段 data（契约 §0）：{body!r}"
        return body["data"]

    return _unwrap


@pytest.fixture
def error_body():
    """契约 §0：错误体 ``{"detail": 中文可读, "code": 机器码}``。"""

    def _check(response, *, status: int) -> dict:
        assert response.status_code == status, (
            f"状态码期望 {status}，实际 {response.status_code}；body={response.text[:400]!r}"
        )
        body = response.json()
        assert "detail" in body and "code" in body, f"错误体必须是 {{detail, code}}（契约 §0），实际 {body!r}"
        assert str(body["detail"]).strip(), "detail 不允许为空"
        assert any("\u4e00" <= ch <= "\u9fff" for ch in str(body["detail"])), (
            f"detail 必须是简体中文可读文案（FR-G4），实际 {body['detail']!r}"
        )
        return body

    return _check


# --------------------------------------------------------------------------
# AI 替身：openai SDK 换成假客户端，真实 HTTP 不可能发生
# --------------------------------------------------------------------------
class AwaitableValue:
    """既能在同步代码里当返回值用，也能被 ``await``（实现用 sync 还是 async 都测得动）。"""

    __slots__ = ("_value",)

    def __init__(self, value: Any) -> None:
        object.__setattr__(self, "_value", value)

    def __await__(self):
        async def _resolve():
            return self._value

        return _resolve().__await__()

    def __getattr__(self, name: str) -> Any:
        return getattr(object.__getattribute__(self, "_value"), name)


class FakeLLM:
    def __init__(self) -> None:
        self.responses: list[Any] = []
        self.calls: list[dict[str, Any]] = []
        self.ctor_kwargs: dict[str, Any] = {}
        self.instances: int = 0

    def queue(self, *payloads: Any) -> None:
        self.responses.extend(payloads)

    @property
    def last_call(self) -> dict[str, Any]:
        assert self.calls, "假 LLM 未被调用：实现没有通过 openai 客户端发请求"
        return self.calls[-1]

    def _next(self, kwargs: dict[str, Any]) -> Any:
        self.calls.append(kwargs)
        payload = self.responses.pop(0) if self.responses else "{}"
        if isinstance(payload, BaseException):
            raise payload
        return payload


@pytest.fixture
def fake_openai(monkeypatch) -> FakeLLM:
    openai_mod = _isolation.load_module("openai")
    fake = FakeLLM()

    def _make_completion_response(content: Any, kwargs: dict[str, Any]):
        finish = "stop"
        # 队列项允许写成 `(文本, finish_reason)`：推理型端点把 max_tokens 吃满时
        # 返回 `finish_reason="length"` + 半截 JSON，实现必须据此给出不同诊断。
        if isinstance(content, tuple) and len(content) == 2:
            content, finish = content
        message = _types.SimpleNamespace(content=content)
        return _types.SimpleNamespace(
            choices=[_types.SimpleNamespace(message=message, finish_reason=finish)],
            model=kwargs.get("model", "fake-model"),
            usage=_types.SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        )

    class _Completions:
        def create(self, **kwargs):  # noqa: ANN003
            return AwaitableValue(_make_completion_response(fake._next(kwargs), kwargs))  # noqa: SLF001

    class _FakeClient:
        def __init__(self, *args, **kwargs):  # noqa: ANN001, ARG002
            fake.instances += 1
            fake.ctor_kwargs = dict(kwargs)
            self.chat = _types.SimpleNamespace(completions=_Completions())
            self.api_key = kwargs.get("api_key")
            self.base_url = kwargs.get("base_url")

    for name in ("OpenAI", "AsyncOpenAI"):
        monkeypatch.setattr(openai_mod, name, _FakeClient, raising=False)
    return fake


@pytest.fixture
def ai_client(load_or_wait, fake_openai):
    """加载 ai_client（缺失时给占位物）并清掉模块级客户端缓存。"""
    mod = load_or_wait("app.services.ai_client")
    for attr in ("_client", "_CLIENT", "client", "_async_client", "_cached_client", "_openai_client"):
        value = vars(mod).get(attr, ...)
        if value is not ... and not callable(value):
            vars(mod)[attr] = None
    return mod, fake_openai


# --------------------------------------------------------------------------
# TTS / STT 替身（test-plan §1：单测不许真合成/真转写）
# --------------------------------------------------------------------------
@pytest.fixture
def stub_tts(monkeypatch, tmp_workdir):
    mod = _isolation.load_module("app.services.tts_service")
    calls: list[dict[str, Any]] = []

    async def _generate_tts(text: str, voice_key: str = "en-US") -> str:
        calls.append({"text": text, "voice": voice_key})
        path = Path(tmp_workdir) / "tts-out.mp3"
        path.write_bytes(b"FAKE-MP3")
        return str(path)

    async def _batch(dialogues, voice_key: str = "en-US"):  # noqa: ANN001
        return {d.get("seq", i): await _generate_tts(d.get("en", ""), voice_key) for i, d in enumerate(dialogues)}

    monkeypatch.setattr(mod, "generate_tts", _generate_tts, raising=False)
    monkeypatch.setattr(mod, "batch_pre_generate", _batch, raising=False)
    monkeypatch.setattr(mod, "synthesize", _generate_tts, raising=False)
    mod._test_calls = calls  # type: ignore[attr-defined]  # noqa: SLF001
    return calls


@pytest.fixture
def tts_fails(monkeypatch):
    """模拟断网下 TTS 失败（AC-L1b）。"""
    mod = _isolation.load_module("app.services.tts_service")

    async def _fail(*args, **kwargs):  # noqa: ANN003, ARG002
        return ""

    monkeypatch.setattr(mod, "generate_tts", _fail, raising=False)
    monkeypatch.setattr(mod, "synthesize", _fail, raising=False)
    return True


@pytest.fixture
def stub_stt(monkeypatch):
    mod = _isolation.load_module("app.services.stt_service")
    calls: list[dict[str, Any]] = []

    def _transcribe(audio_bytes: bytes, input_format: str = "webm") -> dict:
        calls.append({"bytes": len(audio_bytes), "format": input_format})
        return {"text": "fake transcript", "confidence": 0.9, "segments": 1, "duration": 2.0}

    async def _transcribe_async(audio_bytes: bytes, input_format: str = "webm") -> dict:
        return _transcribe(audio_bytes, input_format)

    monkeypatch.setattr(mod, "transcribe", _transcribe, raising=False)
    monkeypatch.setattr(mod, "transcribe_async", _transcribe_async, raising=False)
    return calls
