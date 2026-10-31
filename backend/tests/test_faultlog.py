"""L1/L2/L3 契约：故障必须落盘、启动横幅不许宣称未核实的事实（spec-contracts §15.3，Wave 7 B3）。

单独立一个文件的理由：这条防的是**事后无法追查**。打包后的 sidecar 没有控制台，
stdout 被 `tauri-plugin-shell` 的读取线程读走又丢弃，所以只 `print` 的故障等于没发生过 ——
而设置屏的降级文案已经在一本正经地让用户「查看日志」了。
其它用例看不出这种回归：它们断言返回值，不断言「留下过证据」。

纪律：本文件只往 tmp 目录写，绝不往仓库 `logs/` 或用户数据目录写（CONSTITUTION §6）。
脱敏用例只用电报体自造字符串，绝不使用任何真实密钥。
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any, Optional

import pytest
from app.config import settings as _cfg

LINE_FIELDS = 4  # 时间 | 级别 | PID | [标签] 消息


@pytest.fixture
def 日志目录(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """把 `settings.LOG_DIR` 指到本用例独占的 tmp 目录（faultlog 每次现读，见 §15.3 第 2 条）。"""
    target = tmp_path / "logs"
    monkeypatch.setattr(_cfg, "LOG_DIR", str(target), raising=False)
    return target


def _lines(目录: Path) -> list[str]:
    log = 目录 / "app.log"
    if not log.exists():
        return []
    return [ln for ln in log.read_text(encoding="utf-8").splitlines() if ln.strip()]


# --------------------------------------------------------------------------
# L1：落盘本体（契约 §15.3 第 1/2/3/4 条）
# --------------------------------------------------------------------------
def test_记录同时进文件与stdout(日志目录, capsys):
    """§15.3 第 1 条：文件是主载体，stdout 只是开发期副本 —— 两条都得有。"""
    from app.services import faultlog

    faultlog.error("Probe", "合成失败样本")
    内容 = _lines(日志目录)
    assert any("合成失败样本" in ln for ln in 内容), f"文件里没有这条记录：{内容!r}"
    out = capsys.readouterr()
    assert "合成失败样本" in out.out, f"stdout 里丢了这条：{out.out!r}"


def test_每行带时间级别标签与PID(日志目录):
    """§15.3 第 2 条：`时间 | 级别 | PID | [标签] 消息`；PID 是孤儿进程归因字段（接 §15.4/B4）。"""
    import os

    from app.services import faultlog

    faultlog.warn("Probe", "带PID的记录")
    内容 = _lines(日志目录)
    assert len(内容) == 1, f"期望一行，实际 {内容!r}"
    parts = 内容[0].split(" | ")
    assert len(parts) == LINE_FIELDS, f"字段数不对：{内容[0]!r}"
    stamp, level, pid, rest = parts
    assert re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d", stamp), f"时间戳形态不对：{stamp!r}"
    assert level == "WARNING", f"warn() 的级别应是 WARNING，实际 {level!r}"
    assert pid == str(os.getpid()), f"PID 不对：{pid!r}"
    assert rest.startswith("[Probe]"), f"标签没落在消息里：{rest!r}"


def test_密钥形态写盘前被替换(日志目录):
    """§15.3 第 4 条：CONSTITUTION §3 的「密钥不进日志」要落到文件才算数。"""
    from app.services import faultlog

    假密钥 = [
        "sk-FAKEONLY1234567890",
        "ak_FAKEONLYabcdefghij",
        "Bearer FAKEONLYxyzxyz1234",
        "api_key=FAKEONLYsupersecret",
    ]
    faultlog.error("Probe", "上游报错 " + " / ".join(假密钥))
    落盘 = "\n".join(_lines(日志目录))
    for secret in 假密钥:
        assert secret not in 落盘, f"密钥原样进了日志文件：{secret!r}"
    assert "[已脱敏]" in 落盘, f"没有脱敏标记：{落盘!r}"
    # 正常中文文案不许被顺手吃掉
    assert "上游报错" in 落盘


def test_目录建不出来时绝不向上抛(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """§15.3 第 3 条：日志层把异常吞掉。用「路径上有个同名文件」造一个必然失败的 makedirs。"""
    from app.services import faultlog

    挡路的文件 = tmp_path / "blocked"
    挡路的文件.write_text("我不是目录", encoding="utf-8")
    monkeypatch.setattr(_cfg, "LOG_DIR", str(挡路的文件 / "sub"), raising=False)
    faultlog.error("Probe", "写不进也不该抛")  # 不抛 = 本用例的断言


def test_目标位置被占时绝不向上抛(日志目录, capsys):
    """§15.3 第 3 条的另一半：`app.log` 这个位置本身不是普通文件（Windows 上 open 必失败）。"""
    from app.services import faultlog

    日志目录.mkdir(parents=True, exist_ok=True)
    (日志目录 / "app.log").mkdir()
    faultlog.error("Probe", "位置被占也不该抛")
    err = capsys.readouterr().err
    assert "位置被占也不该抛" in err, f"落不了盘时至少要退回 stderr：{err!r}"


def test_超上限滚动且只保留三份(日志目录, monkeypatch: pytest.MonkeyPatch):
    """§15.3 第 2 条：1 MiB × 3 份。这里把上限调小，免得测试写真 1 MiB。"""
    from app.services import faultlog

    monkeypatch.setattr(faultlog, "MAX_BYTES", 400, raising=True)
    monkeypatch.setattr(faultlog, "KEEP", 3, raising=True)
    for i in range(120):
        faultlog.info("Rotate", f"填充行 {i} " + "y" * 60)
    目录 = 日志目录
    assert (目录 / "app.log").exists(), "主日志文件没生成"
    滚动件 = sorted(p.name for p in 目录.glob("app.log.*"))
    assert 滚动件 == ["app.log.1", "app.log.2", "app.log.3"], f"保留策略不对：{滚动件!r}"
    最新 = (目录 / "app.log").read_text(encoding="utf-8")
    assert "填充行 119" in 最新, "滚动把最新的记录滚丢了"
    assert "填充行 0" not in (目录 / "app.log.3").read_text(encoding="utf-8"), "第 4 份没被丢掉"


def test_多线程写不会把行写坏(日志目录):
    """§15.3 第 1 条：多个模块/线程（job_queue 的工作线程就在另一个线程里 print）同时写。"""
    import threading

    from app.services import faultlog

    def _worker(n: int) -> None:
        for i in range(40):
            faultlog.info("Thread", f"w{n}-{i}")

    threads = [threading.Thread(target=_worker, args=(n,)) for n in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    内容 = _lines(日志目录)
    assert len(内容) == 240, f"记录数不对（丢了或多写）：{len(内容)}"
    for ln in 内容:
        assert len(ln.split(" | ")) == LINE_FIELDS, f"有行被并发写坏了：{ln!r}"


# --------------------------------------------------------------------------
# L2：端口核实中间件（契约 §15.3 第 6 条）
# --------------------------------------------------------------------------
def _http_scope(server: Optional[tuple[str, Optional[int]]]) -> dict[str, Any]:
    scope: dict[str, Any] = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/api/health",
        "raw_path": b"/api/health",
        "query_string": b"",
        "headers": [(b"host", b"127.0.0.1")],
        "client": ("127.0.0.1", 54321),
        "root_path": "",
        "scheme": "http",
    }
    if server is not None:
        scope["server"] = server
    return scope


async def _pass_through(scope, receive, send) -> None:  # noqa: ARG001
    pass


async def _drive(mw, scope) -> None:
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        return None

    await mw(scope, receive, send)


@pytest.fixture
def 端口探针(日志目录, monkeypatch: pytest.MonkeyPatch):
    from app.main import BoundPortProbe

    monkeypatch.setattr(_cfg, "API_PORT", 8765, raising=True)
    return BoundPortProbe, 日志目录


def test_首个请求核实真实端口且只记一次(端口探针):
    """§15.3 第 6 条：确认一次就够，否则每条请求都往日志里灌一行。"""
    BoundPortProbe, 目录 = 端口探针
    mw = BoundPortProbe(_pass_through)
    asyncio.run(_drive(mw, _http_scope(("127.0.0.1", 8765))))
    asyncio.run(_drive(mw, _http_scope(("127.0.0.1", 8765))))
    asyncio.run(_drive(mw, _http_scope(("127.0.0.1", 8765))))
    命中 = [ln for ln in _lines(目录) if "[PortProbe]" in ln]
    assert len(命中) == 1, f"端口核实记了 {len(命中)} 次：{命中!r}"
    assert "8765" in 命中[0]


def test_端口与配置不一致时记WARNING(端口探针):
    """本会话实测过的形态：`--port 8766` 起来时横幅写着 8765。横幅不能指着错的端口。"""
    BoundPortProbe, 目录 = 端口探针
    mw = BoundPortProbe(_pass_through)
    asyncio.run(_drive(mw, _http_scope(("127.0.0.1", 8766))))
    命中 = [ln for ln in _lines(目录) if "[PortProbe]" in ln]
    assert len(命中) == 1, f"期望一条核实记录：{命中!r}"
    level = 命中[0].split(" | ")[1]
    assert level == "WARNING", f"配置端口与实际端口不一致必须是 WARNING，实际 {level}：{命中[0]!r}"
    assert "8766" in 命中[0] and "8765" in 命中[0], f"两个端口号都要写清楚：{命中[0]!r}"


def test_传输没给端口时不许冒充核实(端口探针):
    """httpx ASGITransport 的 scope 是 `("testserver", None)`：没有实测值就只说「没能核实」。"""
    BoundPortProbe, 目录 = 端口探针
    for scope in (_http_scope(None), _http_scope(("testserver", None))):
        before = len([ln for ln in _lines(目录) if "[PortProbe]" in ln])
        mw = BoundPortProbe(_pass_through)
        asyncio.run(_drive(mw, scope))
        命中 = [ln for ln in _lines(目录) if "[PortProbe]" in ln][before:]
        assert len(命中) == 1, f"期望一条说明，实际 {命中!r}"
        assert "未能" in 命中[0] or "无法" in 命中[0], f"要如实说没能核实：{命中[0]!r}"
        assert "8765" not in 命中[0], f"不许把配置端口冒充实测端口：{命中[0]!r}"


def test_app挂上了端口核实中间件():
    """条款要求的是「这个 app」真的带探针，不是有个类放着好看。"""
    from app.main import BoundPortProbe, app

    assert any(m.cls is BoundPortProbe for m in app.user_middleware), (
        f"中间件清单里没有 BoundPortProbe：{[m.cls.__name__ for m in app.user_middleware]!r}"
    )


# --------------------------------------------------------------------------
# L2：降级原因也要落盘（契约 §15.3 第 7 条）
# --------------------------------------------------------------------------
def _端点连不上的客户端():
    import types as _types

    class _Completions:
        @staticmethod
        def create(**kwargs: Any):  # noqa: ARG002
            raise ConnectionError("拒绝连接（127.0.0.1:9）")

    return _types.SimpleNamespace(chat=_types.SimpleNamespace(completions=_Completions()))


def test_AI失败降级要留下原因(日志目录, monkeypatch: pytest.MonkeyPatch):
    """§15.3 第 7 条：真跑出来的缺口 —— `degraded_reason=network_error` 进了库，日志里却什么都没有。

    同时钉住隐私：发给模型的正文不许进日志。
    """
    from app.services import ai_client

    monkeypatch.setattr(_cfg, "OPENAI_API_KEY", "sk-FAKEONLYabcdefghij", raising=True)
    monkeypatch.setattr(ai_client, "_make_client", lambda *a, **k: _端点连不上的客户端(), raising=True)

    正文 = "In my opinion remote work changes cities forever ZEBRACONTENT"
    result = ai_client.complete_json(正文, allow_network=True)
    assert result.ok is False and result.reason == "network_error", f"用例前提变了：{result!r}"

    命中 = [ln for ln in _lines(日志目录) if "[AI]" in ln]
    assert len(命中) == 1, f"失败降级要落且只落一条：{命中!r}"
    assert "network_error" in 命中[0], f"要写出 reason：{命中[0]!r}"
    assert "ConnectionError" in 命中[0], f"要写出异常类名：{命中[0]!r}"
    assert 正文 not in 命中[0], f"发给模型的内容不进日志：{命中[0]!r}"
    assert "sk-FAKEONLYabcdefghij" not in 命中[0]
    assert 命中[0].split(" | ")[1] == "WARNING", f"真实失败该是 WARNING：{命中[0]!r}"


def test_用户主动关在线时的降级记INFO不记WARNING(日志目录):
    """§15.3 第 7 条的级别分工：`offline_template` 是预期行为，刷成 WARNING 会把日志变成噪音。"""
    from app.services import ai_client

    result = ai_client.complete_json("任何正文", allow_network=False)
    assert result.ok is False and result.reason == "offline_template", f"用例前提变了：{result!r}"
    命中 = [ln for ln in _lines(日志目录) if "[AI]" in ln]
    assert len(命中) == 1, f"期望一条：{命中!r}"
    assert 命中[0].split(" | ")[1] == "INFO", f"主动离线不该记成故障：{命中[0]!r}"


# --------------------------------------------------------------------------
# L3：端到端证据（契约 §15.3 第 1/5/6 条）
# --------------------------------------------------------------------------
def test_启动记录落在文件里且不复述端口(
    app_started,
):  # noqa: ARG001 - fixture 只负责把 lifespan 跑一次
    """§15.3 第 6 条：会话级 lifespan 的 `[Startup]` 系列必须在文件里读得到，
    且不能再出现「Server ready at http://<配置端口>」这种宣称。"""
    目录 = Path(_cfg.LOG_DIR)
    内容 = _lines(目录)
    assert 内容, f"日志文件 {目录 / 'app.log'} 里什么都没有 —— 启动输出没落盘"
    startup = [ln for ln in 内容 if "[Startup]" in ln]
    assert startup, f"启动记录没进文件：{内容[:5]!r}"
    assert any("按配置端口" in ln for ln in startup), f"横幅要如实说明端口待核实：{startup!r}"
    assert not any("Server ready at" in ln for ln in startup), f"还在复述未核实的端口：{startup!r}"


def test_未处理异常落盘(日志目录, monkeypatch: pytest.MonkeyPatch):
    """§15.3 第 1 条点名的那处：`api/common.py` 的兜底 handler 只 print 过一次就再也不留痕迹。"""
    from fastapi.testclient import TestClient

    from app.db import store
    from app.main import app

    def _boom(*args: Any, **kwargs: Any):  # noqa: ANN001, ARG002
        raise RuntimeError("模拟内部错误")

    monkeypatch.setattr(store, "get_settings", _boom, raising=True)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/settings")
    assert resp.status_code == 500, f"期望兜底 500，实际 {resp.status_code}"
    assert resp.json()["code"] == "internal_error"
    内容 = "\n".join(_lines(日志目录))
    assert "[API] 未处理异常" in 内容, f"兜底异常没落盘：{内容!r}"
    assert "模拟内部错误" in 内容, f"落盘要留下原因：{内容!r}"


def test_没有任何端点把日志读回前端(app_started):  # noqa: ARG001
    """§15.3 第 5 条是给后来者立的墙：日志文件可以含路径与异常名，UI 不行。"""
    from app.main import app

    路径 = set(app.openapi()["paths"])
    命中 = [p for p in 路径 if "log" in p.lower()]
    assert 命中 == [], f"出现了把日志读回前端的端点：{命中!r}"


def test_后端不再有裸print报告事实(repo_root: Path):
    """§15.3 第 1 条的判据本身：只有 faultlog 自己与 `migrate.py` 的 CLI 允许 `print(`。"""
    允许 = ("app/services/faultlog.py",)
    offenders: list[str] = []
    for py in sorted((repo_root / "backend" / "app").rglob("*.py")):
        rel = str(py.relative_to(repo_root / "backend")).replace("\\", "/")
        if rel in 允许:
            continue
        for no, line in enumerate(py.read_text(encoding="utf-8").splitlines(), start=1):
            if "print(" not in line or line.strip().startswith("#"):
                continue
            # CLI 出口（`python -m app.db.migrate`）往 stdout 打 JSON 是人机对话，不是日志
            if rel == "app/db/migrate.py" and "json.dumps(run()" in line:
                continue
            offenders.append(f"{rel}:{no}: {line.strip()[:80]}")
    assert offenders == [], "这些地方还在用裸 print（记录会进没人读的管道）：\n" + "\n".join(offenders)
