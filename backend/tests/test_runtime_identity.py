"""L1/L2/L3 契约：引擎要能自证身份，孤儿进程要能被指认（spec-contracts §15.4，Wave 7 B4）。

立这个文件的理由：打包后的 sidecar 无窗口、无托盘，被强制结束的父进程一丢就成了孤儿，
而下一次启动「让位给它」这件事**没有任何一处能看出来** —— `main.rs` 的结论只写进了
release 下不存在的控制台，`/api/health` 又不报自己是哪个进程。用户看到的永远是
「正在启动本地引擎…」，日志里连一行 `address already in use` 都没有（uvicorn 走它自己的
logging，stdout/stderr 按 §15.3 是被读走又丢弃的）。

纪律：本文件只往 `tmp_path` 写（第 8 条），探活只打 127.0.0.1，绝不结束任何进程。
"""
from __future__ import annotations

import json
import os
import socket
from pathlib import Path

import pytest
from app.config import settings as _cfg

FIELDS = ("pid", "port", "port_source", "started_at", "version")


@pytest.fixture
def 数据目录(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """把 DB 与日志都指到本用例独占的 tmp 目录（契约 §15.4 第 8 条）。

    `_observed_port` 也复位：端口核实状态是进程级的，不复位的话用例之间会互相污染。
    """
    from app.services import runtime

    monkeypatch.setattr(_cfg, "DB_PATH", str(tmp_path / "app.db"), raising=True)
    monkeypatch.setattr(_cfg, "LOG_DIR", str(tmp_path / "logs"), raising=False)
    monkeypatch.setattr(runtime, "_observed_port", None, raising=False)
    return tmp_path


def _日志(目录: Path) -> list[str]:
    log = 目录 / "logs" / "app.log"
    if not log.exists():
        return []
    return [ln for ln in log.read_text(encoding="utf-8").splitlines() if ln.strip()]


def _写凭据(目录: Path, **覆盖) -> Path:
    """手工摆一个「别的实例留下的」run.json（pid 默认取一个明显不是自己的值）。"""
    from app.services import runtime

    内容 = {
        "pid": os.getpid() + 1_000_000,
        "host": "127.0.0.1",
        "port": _空闲端口(),
        "started_at": "2026-01-01T00:00:00+08:00",
        "version": "0.0.0-别的实例",
    }
    内容.update(覆盖)
    target = runtime.run_file()
    target.write_text(json.dumps(内容, ensure_ascii=False), encoding="utf-8")
    return target


def _空闲端口() -> int:
    """拿一个刚释放的端口：没人应答，就是「上一个实例已经不在了」的判据。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _监听端口() -> socket.socket:
    """真起一个监听套接字：这是「另一个实例还活着」的形态。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    return sock


# --------------------------------------------------------------------------
# L1：凭据文件本体（契约 §15.4 第 2/3/4 条）
# --------------------------------------------------------------------------
def test_凭据文件与库同目录并随环境变量进临时目录(数据目录):
    """第 2/8 条：位置由 DB 目录派生，所以 `IELTS_DB_PATH` 一隔离它就隔离 —— 不许写到真实用户目录。"""
    from app.services import runtime

    assert runtime.run_file() == 数据目录 / "run.json", f"位置不对：{runtime.run_file()!r}"


def test_启动写好凭据且内容能指认进程(数据目录):
    """第 2 条：pid / port / started_at / version 四样，缺一样就回答不了「谁在用这个目录」。"""
    from app.services import runtime

    runtime.start()
    内容 = json.loads((数据目录 / "run.json").read_text(encoding="utf-8"))
    assert 内容["pid"] == os.getpid(), f"pid 不是自己：{内容!r}"
    assert 内容["version"] == _cfg.APP_VERSION, f"版本没落进去：{内容!r}"
    assert isinstance(内容["port"], int) and 内容["port"] > 0, f"端口不对：{内容!r}"
    assert "T" in str(内容["started_at"]), f"启动时间要带时区的 ISO8601：{内容!r}"


def test_正常退出删除凭据(数据目录):
    from app.services import runtime

    runtime.start()
    assert (数据目录 / "run.json").exists()
    runtime.stop()
    assert not (数据目录 / "run.json").exists(), "正常退出必须把凭据收走，否则下次启动会被误判成孤儿"


def test_删除失败只记日志绝不向上抛(数据目录, monkeypatch):
    """第 2 条：退出流程被打断的代价是「用户按了关闭但库还在被写」，比留一个残留文件大得多。"""
    from app.services import runtime

    runtime.start()
    monkeypatch.setattr(
        Path,
        "unlink",
        lambda *a, **k: (_ for _ in ()).throw(OSError("被占用")),
        raising=False,
    )
    runtime.stop()  # 不许抛
    命中 = [ln for ln in _日志(数据目录) if "[RunFile]" in ln and "删除" in ln]
    assert 命中, f"删除失败要留下证据，实际日志：{_日志(数据目录)!r}"


def test_写不进凭据不影响启动(数据目录, monkeypatch):
    """第 2/3 条：这个文件是线索不是锁 —— 目录只读、磁盘满都照常把服务起起来。"""
    from app.services import runtime

    monkeypatch.setattr(
        Path,
        "write_text",
        lambda *a, **k: (_ for _ in ()).throw(OSError("磁盘满了")),
        raising=False,
    )
    runtime.start()  # 不许抛
    assert runtime.identity()["pid"] == os.getpid(), "凭据没写成也必须知道自己是谁"


# --------------------------------------------------------------------------
# L1：残留与并发实例的归因（契约 §15.4 第 3 条）
# --------------------------------------------------------------------------
def test_残留凭据记成未正常退出(数据目录):
    """崩溃/关机没走完留下的文件 ⇒ WARNING + 覆盖，绝不拒绝启动。"""
    from app.services import runtime

    陈旧端口 = _空闲端口()
    _写凭据(数据目录, port=陈旧端口)
    runtime.start()
    命中 = [ln for ln in _日志(数据目录) if "[RunFile]" in ln and "未正常退出" in ln]
    assert len(命中) == 1, f"期望一条未正常退出记录：{_日志(数据目录)!r}"
    assert "WARNING" in 命中[0], f"必须是 WARNING：{命中[0]!r}"
    assert str(陈旧端口) in 命中[0], f"要把陈旧 pid/port 写清楚便于指认：{命中[0]!r}"
    现在 = json.loads((数据目录 / "run.json").read_text(encoding="utf-8"))
    assert 现在["pid"] == os.getpid(), f"陈旧凭据要被覆盖：{现在!r}"


def test_有人应答算活着的另一个实例(数据目录):
    """两个引擎写同一个目录才是真风险；这一支必须留下「共用同一个数据目录」的证据。"""
    from app.services import runtime

    监听 = _监听端口()
    try:
        活端口 = int(监听.getsockname()[1])
        _写凭据(数据目录, port=活端口)
        runtime.start()
    finally:
        监听.close()
    命中 = [ln for ln in _日志(数据目录) if "[RunFile]" in ln and "共用同一个数据目录" in ln]
    assert len(命中) == 1, f"期望一条共用目录记录：{_日志(数据目录)!r}"
    assert "未正常退出" not in 命中[0], f"对方还活着，不许说成未正常退出：{命中[0]!r}"
    assert str(活端口) in 命中[0], f"要写明应答的端口：{命中[0]!r}"


def test_损坏的凭据文件按残留处理(数据目录):
    """文件写坏一半（上次崩在写入途中）不能把启动卡住 —— 它是线索，不是必须解析的配置。"""
    from app.services import runtime

    (数据目录 / "run.json").write_text("{不是 json", encoding="utf-8")
    runtime.start()  # 不许抛
    命中 = [ln for ln in _日志(数据目录) if "[RunFile]" in ln]
    assert 命中, f"要留下处理过残留的痕迹：{_日志(数据目录)!r}"
    assert json.loads((数据目录 / "run.json").read_text(encoding="utf-8"))["pid"] == os.getpid()


def test_绝不删别人的凭据(数据目录):
    """第 2 条：后起实例的凭据不能被先起那个的退出动作抹掉。"""
    from app.services import runtime

    别人 = _写凭据(数据目录, port=_空闲端口())
    runtime.stop()  # 当前进程没 start 过，文件里是别人的 pid
    assert 别人.exists(), "文件里的 pid 不是自己时不许删"


def test_探活只打本机绝不因凭据里的地址出门(数据目录, monkeypatch):
    """第 4 条：判定存活只允许本机套接字探测 —— 一个残留文件不该把程序指向外部地址。"""
    import socket as _socket

    from app.services import runtime

    外部端口 = _空闲端口()
    _写凭据(数据目录, host="198.51.100.7", port=外部端口)
    目标: list[tuple] = []
    原连接 = _socket.socket.connect

    def 记录连接(self, addr, *args, **kwargs):  # noqa: ANN001
        目标.append(addr)
        return 原连接(self, addr, *args, **kwargs)

    monkeypatch.setattr(_socket.socket, "connect", 记录连接, raising=True)
    runtime.start()  # 桩由 monkeypatch 在用例结束时还原
    assert 目标, "没做过探活就无法证明它没出门"
    assert {addr[0] for addr in 目标} == {"127.0.0.1"}, f"探活必须固定打本机，实际连了：{目标!r}"
    assert 外部端口 in {addr[1] for addr in 目标}, f"要探的是凭据里那个端口：{目标!r}"


# --------------------------------------------------------------------------
# L2：身份字段（契约 §15.4 第 1 条）
# --------------------------------------------------------------------------
def test_身份字段不读库不读盘(数据目录, monkeypatch):
    """§14.6 要求库坏时体检还答 200；身份字段若依赖库，正好在最需要归因时一起坏掉。"""
    from app.services import runtime

    def 禁止读盘(*a, **k):
        raise AssertionError("身份字段不许读磁盘")

    monkeypatch.setattr(Path, "read_text", 禁止读盘, raising=False)
    身份 = runtime.identity()
    assert 身份["pid"] == os.getpid()
    assert set(FIELDS) <= set(身份), f"缺字段：{sorted(set(FIELDS) - set(身份))}"


def test_未核实时端口如实标注来源(数据目录, monkeypatch):
    from app.services import runtime

    monkeypatch.setattr(_cfg, "API_PORT", 8765, raising=True)
    身份 = runtime.identity()
    assert 身份["port"] == 8765, f"没核实过时取配置值：{身份!r}"
    assert 身份["port_source"] == "config", f"要如实说明这个端口只是配置值：{身份!r}"


def _驱动探针打到实际端口(实际端口: int, 配置端口: int, monkeypatch: pytest.MonkeyPatch) -> None:
    """真跑一遍 BoundPortProbe（不复制它的判断，只喂它一个真实 scope）。"""
    import asyncio

    from app.main import BoundPortProbe

    monkeypatch.setattr(_cfg, "API_PORT", 配置端口, raising=True)

    async def _receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def _send(_message):
        return None

    async def _inner(_scope, _receive, _send):
        return None

    scope = {"type": "http", "method": "GET", "path": "/x", "server": ("127.0.0.1", 实际端口)}
    asyncio.run(BoundPortProbe(_inner)(scope, _receive, _send))


def test_端口探针回填后来源变成实测(数据目录, monkeypatch):
    """§15.3 第 6 条核实到的 `scope["server"]` 必须喂给身份字段，否则界面上还是个配置值。
    本会话实测过配置 8765 / 实际 8766 的形态。"""
    from app.services import runtime

    _驱动探针打到实际端口(8766, 8765, monkeypatch)
    身份 = runtime.identity()
    assert 身份["port"] == 8766, f"实测端口没回填进身份字段：{身份!r}"
    assert 身份["port_source"] == "probe", f"来源应标注为实测：{身份!r}"


def test_核实到不同端口后凭据也一起改(数据目录, monkeypatch):
    """凭据里留一个根本没开的端口，下一次启动的存活探测就会敲错门，
    把一个**还活着**的实例误判成「未正常退出」（§15.4 第 3 条的判据全靠这个数）。"""
    import json

    from app.services import runtime

    runtime.start()
    最初 = json.loads((数据目录 / "run.json").read_text(encoding="utf-8"))
    assert 最初["port"] == 8765, f"起点是配置端口：{最初!r}"
    _驱动探针打到实际端口(8766, 8765, monkeypatch)
    刷新 = json.loads((数据目录 / "run.json").read_text(encoding="utf-8"))
    assert 刷新["port"] == 8766, f"实测端口没写回凭据：{刷新!r}"
    assert 刷新["pid"] == os.getpid(), f"刷新不能顺手把身份写坏：{刷新!r}"


def test_health返回身份字段(client):
    """第 1 条进端点总表：界面/外壳要靠它回答「现在应答的是哪一个进程」。"""
    from app.services import runtime

    data = client.get("/api/health").json()["data"]
    for field in FIELDS:
        assert field in data, f"/api/health 少了 {field}：{sorted(data)!r}"
    assert data["pid"] == os.getpid()
    assert data["version"] == _cfg.APP_VERSION
    assert data["started_at"] == runtime.identity()["started_at"]


def test_库读不出来时health仍200且带身份(client, monkeypatch):
    """§14.6 + §15.4 的联动：坏库时恰恰最需要知道应答者是谁。"""
    import sqlite3

    from app.api import health as health_api

    def 炸(*a, **k):
        raise sqlite3.DatabaseError("库读不出来")

    # 只打坏其中一处读库：except 分支里的 `ai_block({})` 必须还能跑，
    # 两个都打坏就变成在测兜底的兜底，不是这条契约要防的东西。
    monkeypatch.setattr(health_api.store, "set_counts_by_module", 炸, raising=True)
    response = client.get("/api/health")
    assert response.status_code == 200, f"体检端点不许把自己打成 500：{response.status_code}"
    assert response.json()["data"]["pid"] == os.getpid()


def test_app启动时凭据已写好(client, tmp_workdir):
    """lifespan 必须真的接上 runtime.start()，不是有个函数放着好看。"""
    assert (_test_db_dir() / "run.json").exists(), (
        f"会话级 lifespan 跑过后应在 DB 同目录留下凭据：{_test_db_dir()!r}"
    )


def _test_db_dir() -> Path:
    return Path(_cfg.DB_PATH).expanduser().resolve().parent


# --------------------------------------------------------------------------
# L1：禁止「顺手加个自动清理」（契约 §15.4 第 5 条）
# --------------------------------------------------------------------------
FORBIDDEN = ("taskkill", "TerminateProcess", "os.kill", "SIGKILL", "psutil")

源码根 = ("backend/app", "backend/pyinstaller_entry.py", "frontend/src-tauri/src", "frontend/src-tauri/capabilities")


def _可执行文本(path: Path) -> str:
    """取文件的**代码部分**：注释与 docstring 里写「为什么禁止 os.kill」正是这个契约需要的说明，
    把它们算成违规只会逼人把理由删掉，所以判据只看代码行。"""
    源码 = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix == ".py":
        import ast

        屏蔽: set[int] = set()
        for node in ast.walk(ast.parse(源码)):
            if not isinstance(node, ast.Module | ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
                continue
            首个 = node.body[0] if node.body else None
            if isinstance(首个, ast.Expr) and isinstance(首个.value, ast.Constant) and isinstance(首个.value.value, str):
                屏蔽.update(range(首个.lineno, 首个.end_lineno + 1))
        行列表 = []
        for index, 行 in enumerate(源码.splitlines(), start=1):
            if index in 屏蔽:
                continue
            行列表.append(行.split("#", 1)[0])
        return "\n".join(行列表)
    if path.suffix == ".rs":
        return "\n".join(行.split("//", 1)[0] for 行 in 源码.splitlines())
    return 源码


@pytest.mark.parametrize("形态", FORBIDDEN)
def test_后端与外壳不许有结束别人进程的能力(repo_root, 形态):
    """第 5 条：误杀用户正在用的另一个引擎，代价高于「端口被占」本身。清理只能靠精确告知。"""
    命中 = []
    for 相对 in 源码根:
        root = repo_root / 相对
        paths = [root] if root.is_file() else sorted(root.rglob("*")) if root.is_dir() else []
        for path in paths:
            if not path.is_file() or path.suffix not in {".py", ".rs", ".toml", ".json"}:
                continue
            if 形态 in _可执行文本(path):
                命中.append(str(path.relative_to(repo_root)))
    assert not 命中, f"{形态} 出现在 {命中}：契约 §15.4 第 5 条禁止结束不是自己 spawn 的进程"


def test_外壳三条启动结论都落盘(repo_root):
    """第 6 条：release 下 `windows_subsystem = "windows"`，`eprintln!` 等于写进黑洞。"""
    import re

    main = repo_root / "frontend" / "src-tauri" / "src" / "main.rs"
    源码 = main.read_text(encoding="utf-8")
    # `eprintln!` 里也含 `println!` 子串，所以要按「前面不是 e」数，否则结论数虚高一倍
    结论数 = len(re.findall(r"(?<!e)println!|eprintln!", 源码))
    落盘数 = 源码.count("shelllog::")
    assert 落盘数 >= 3, f"外壳启动结论至少三条要落盘，实际 {落盘数} 次 shelllog 调用"
    assert 落盘数 >= 结论数, f"每条 stdout 结论都得有对应的落盘（stdout {结论数} / 落盘 {落盘数}）"


def test_三处版本号一致否则旧引擎提示变成噪音(repo_root):
    """契约 §15.4 第 7 条的前提条件：比较基准一旦在仓库里就不同步，提示会每次启动都出现，
    而常驻的提示等于没有提示 —— 这条用例就是为了让「升版本忘了另一处」进不了主干。
    前端的 `src/version.ts` 直接 import package.json，所以它不可能单独漂移，不用另测。"""
    前端 = json.loads((repo_root / "frontend" / "package.json").read_text(encoding="utf-8"))["version"]
    外壳 = json.loads(
        (repo_root / "frontend" / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8")
    )["version"]
    assert (前端, 外壳) == (_cfg.APP_VERSION, _cfg.APP_VERSION), (
        f"版本不一致：package.json={前端} tauri.conf.json={外壳} config.APP_VERSION={_cfg.APP_VERSION}"
    )
