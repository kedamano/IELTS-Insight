"""引擎自证身份 + 单实例凭据（契约 §15.4，Wave 7 B4）。

要解决的问题不是「启动失败」，而是**启动成功之后没人知道是谁在应答**：
打包后的 sidecar 由 `tauri-plugin-shell` 以 `CREATE_NO_WINDOW` 拉起，无窗口、无托盘，
父进程一被强制结束（崩溃、任务管理器、关机没走完）它就成孤儿，继续占着 8765 与
`backend-*.exe`。下一次启动走 `main.rs` 的「端口被占」分支让位给它 —— 用户以为在用新版本，
其实连的是上一个没退出的旧引擎，而界面上没有任何一处能看出来。

所以本模块只做两件不做主的事：
1. 让进程随时能报出自己是谁（`pid` / 实际 `port` / `started_at` / `version`）；
2. 在数据目录留一份凭据，让下一次启动能指认「上一个是不是没退干净」。

**绝不做**：结束任何不是自己 spawn 的进程（§15.4 第 5 条）。探测存活只允许打 127.0.0.1
的套接字 —— `os.kill(pid, 0)` 在 Windows 上会走 `TerminateProcess`，那是把「查一下」做成「杀掉」。
"""

from __future__ import annotations

import json
import os
import socket
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from app.config import settings as _cfg
from app.services import faultlog

FILE_NAME = "run.json"
TAG = "RunFile"
_PROBE_TIMEOUT_SEC = 0.25

# 进程启动时刻：import 即进程刚起来，比任何一次请求都早，够精确到「哪个窗口开的」。
_STARTED_AT = datetime.now().astimezone().isoformat(timespec="seconds")

# §15.3 第 6 条的端口探针回填这里；None = 还没被真实请求核实过。
_observed_port: Optional[int] = None


def run_file() -> Path:
    """凭据文件与库同目录：用户找自己的东西只找一个地方，且 `IELTS_DB_PATH` 一隔离它就隔离。"""
    return Path(str(_cfg.DB_PATH)).expanduser().resolve().parent / FILE_NAME


def identity() -> dict[str, Any]:
    """本进程的身份。**只读内存与 settings，绝不碰库和磁盘**（§15.4 第 1 条）：
    §14.6 要求库读不出来时体检端点还答 200，身份字段若依赖库，正好在最需要归因的时候一起坏掉。
    """
    observed = _observed_port if isinstance(_observed_port, int) and _observed_port > 0 else None
    return {
        "pid": os.getpid(),
        "port": observed if observed is not None else int(_cfg.API_PORT),
        # 没实测值就如实标注来源，绝不拿配置值冒充实测值（§15.3 第 6 条同一个口径）。
        "port_source": "probe" if observed is not None else "config",
        "started_at": _STARTED_AT,
        "version": str(_cfg.APP_VERSION),
    }


def set_observed_port(port: Any) -> None:
    """端口探针核实到实际绑定地址后回填（契约 §15.3 第 6 条 ↔ §15.4 第 1 条）。

    凭据文件也要跟着改写：留一个「配置端口」在文件里，下一次启动的存活探测就会去敲
    一扇根本没开的门，把一个活着的实例误判成孤儿。
    """
    global _observed_port
    if not isinstance(port, int) or port <= 0 or port == _observed_port:
        return
    _observed_port = port
    _dump()


def _previous() -> Optional[dict[str, Any]]:
    """读上一个实例留下的凭据。读不出来 / 写坏一半都按「没有凭据」处理，绝不因此卡住启动。"""
    path = run_file()
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:
        faultlog.warn(TAG, f"上一次的凭据文件读不出来（{type(exc).__name__}），按残留处理")
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        faultlog.warn(TAG, "上一次的凭据文件是坏的（大概率写在途中崩了），按残留处理")
        return None
    return data if isinstance(data, dict) else None


def _port_open(port: Any) -> bool:
    """判定「上一个实例还在不在」= 它记录的端口有没有人应答。

    目标地址**写死 127.0.0.1**：残留文件里的 `host` 只是记录，不该把程序指向外部地址。
    """
    try:
        target = int(port)
    except (TypeError, ValueError):
        return False
    if target <= 0:
        return False
    try:
        with socket.create_connection(("127.0.0.1", target), timeout=_PROBE_TIMEOUT_SEC):
            return True
    except OSError:
        return False


def _dump() -> None:
    """把当前身份写成凭据。任何失败只记日志 —— 这个文件是线索不是锁（§15.4 第 2/3 条）。"""
    try:
        path = run_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({**identity(), "host": str(_cfg.API_HOST)}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except (OSError, TypeError, ValueError) as exc:
        faultlog.warn(
            TAG,
            f"凭据文件写不出去（{type(exc).__name__}）：本次启动在磁盘上无法被指认，但服务照常起",
        )


def start() -> dict[str, Any]:
    """写本进程凭据，并指认上一个实例是残留还是还活着。**任何失败都不向上抛**（§15.4 第 2/3 条）。"""
    previous = _previous()
    if previous is not None:
        pid = previous.get("pid")
        port = previous.get("port")
        if isinstance(pid, int) and pid != os.getpid():
            if _port_open(port):
                # 这一支才是真风险：两个引擎同时写一个库目录，§14.6 的只读降级管不到并发写。
                faultlog.warn(
                    TAG,
                    f"端口 {port} 上还有一个实例正在应答（pid={pid}），本次启动与它共用同一个数据目录："
                    "两边的改动可能互相看得见对方没写完的部分",
                )
            else:
                faultlog.warn(
                    TAG,
                    f"上一个实例（pid={pid}，port={port}）未正常退出：端口没有应答，本次覆盖它的凭据",
                )
    身份 = identity()
    _dump()
    return 身份


def stop() -> None:
    """正常退出收走凭据。删除失败只记日志 —— 把退出流程打断的代价比留一个残留文件大得多。"""
    try:
        previous = _previous()
        if previous is None:
            return
        pid = previous.get("pid")
        if isinstance(pid, int) and pid != os.getpid():
            # 后起实例的凭据不能被先起那个的退出动作抹掉。
            faultlog.info(TAG, f"凭据文件里的 pid={pid} 不是自己（{os.getpid()}），保留不动")
            return
        run_file().unlink(missing_ok=True)
    except (OSError, TypeError, ValueError) as exc:
        faultlog.warn(
            TAG,
            f"凭据文件删除失败（{type(exc).__name__}）：下次启动会把它当成上一次未退出的实例",
        )
