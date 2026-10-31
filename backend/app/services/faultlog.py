"""故障日志落盘（契约 §15.3，Wave 7 B3）。

为什么非要有这个模块：打包后的 sidecar 没有控制台。`tauri-plugin-shell` 给子进程加了
`CREATE_NO_WINDOW`，又用一条读取线程把 stdout **读走丢弃**（本仓库 `src-tauri/src/main.rs`
把 `spawn()` 返回的接收端当场扔掉），所以只 `print` 的故障 —— AI 降级、快照没拍成、
未处理异常 —— 只在没人看过的管道里存在过一瞬间。设置屏却已经写着「请查看日志」。

三条硬规矩，都由 `tests/test_faultlog.py` 钉住：

- **文件是主载体，stdout 只是副本**：先落盘再 print，且 `print` 自己也包在 try 里
  （管道断了 `print(flush=True)` 会抛 `OSError`，不该反过来打断业务）。
- **绝不向上抛**：目录建不出来、磁盘满、位置被占 —— 吞掉，退回 stderr。
  用「把请求打挂」换一条记录，是把看不见故障升级成制造故障。
- **写盘前脱敏**（CONSTITUTION §3）：`sk-x` / `ak_x` / `Bearer x` / `api_key=x` 一律换成
  `[已脱敏]`。异常 repr 里带过请求头，这不是猜想。

日志文件**不许**被任何端点读回前端（§15.3 第 5 条）：它可以含路径与异常类型名，
而用户可见文案不行。
"""

from __future__ import annotations

import os
import re
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.config import settings

FILE_NAME = "app.log"
# 单文件 1 MiB、保留 3 份：这是给用户留的「最近出过什么事」，不是审计归档。
MAX_BYTES = 1024 * 1024
KEEP = 3
REDACTED = "[已脱敏]"

_LOCK = threading.Lock()


def _harden_stdout() -> None:
    """GBK 控制台下打印中文会 `UnicodeEncodeError`（`stt_service` 里那句「日志只用 ASCII」就是这么来的）。

    文件那条路本来就是 UTF-8 字节写入，不受影响；这里只把 stdout/stderr 的副本调成
    「编不出来就替换」，别让一个生僻符号反过来打断记录。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (OSError, ValueError, AttributeError):
            pass

# 先长后短：`api_key=` 那条要连前缀一起留着，才看得出脱敏发生在哪。
_KEY_VALUE = re.compile(r"(?i)(api[_-]?(?:key|token)[\"'\s:=]+)\S+")
_KEY_TOKEN = re.compile(r"\b(?:sk|ak|pk|rk)[-_][A-Za-z0-9_\-]{6,}")
_BEARER = re.compile(r"(?i)\b(Bearer\s+)[A-Za-z0-9._~+/=\-]{6,}")


def redact(text: str) -> str:
    """把密钥形态替换掉；正常中文文案与路径不受影响。"""
    out = _KEY_VALUE.sub(lambda m: f"{m.group(1)}{REDACTED}", text)
    out = _KEY_TOKEN.sub(REDACTED, out)
    out = _BEARER.sub(lambda m: f"{m.group(1)}{REDACTED}", out)
    return out


def _log_path() -> Path:
    """每次现读 `settings.LOG_DIR`：测试要能把日志指进自己的 tmp 目录（CONSTITUTION §6）。"""
    return Path(str(settings.LOG_DIR)).expanduser() / FILE_NAME


def _shift(path: Path) -> None:
    for index in range(KEEP - 1, 0, -1):
        src = path.with_name(f"{path.name}.{index}")
        if src.exists():
            os.replace(src, path.with_name(f"{path.name}.{index + 1}"))
    if path.exists():
        os.replace(path, path.with_name(f"{path.name}.1"))


def _rotate_if_needed(path: Path, incoming_bytes: int) -> None:
    if not path.exists():
        return
    try:
        size = path.stat().st_size
    except OSError:
        return  # 读不出大小就当不用滚，交给下面的 open 去失败
    if size + incoming_bytes > MAX_BYTES:
        _shift(path)


def _append(line: str) -> None:
    path = _log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (line + "\n").encode("utf-8")
    _rotate_if_needed(path, len(payload))
    with open(path, "ab") as fh:
        fh.write(payload)
        fh.flush()


def _to_stderr(line: str, reason: Optional[BaseException]) -> None:
    prefix = f"[faultlog] 落盘失败({type(reason).__name__})：" if reason else "[faultlog] "
    try:
        sys.stderr.write(prefix + line + "\n")
        sys.stderr.flush()
    except BaseException:  # noqa: BLE001 - stderr 也写不进去时没有第三条路，只能静默
        pass


def emit(level: str, tag: str, message: str) -> None:
    """落一行记录。任何入口（`info`/`warn`/`error`）最终都走这里，也**只有**这里碰 IO。"""
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    line = f"{stamp} | {level} | {os.getpid()} | {redact(f'[{tag}] {message}')}"
    with _LOCK:
        try:
            _append(line)
        except BaseException as exc:  # noqa: BLE001 - §15.3 第 3 条：日志绝不向上抛
            _to_stderr(line, exc)
        try:
            print(line, flush=True)
        except BaseException:  # noqa: BLE001 - stdout 是副本，坏了不动文件那条路
            pass


def info(tag: str, message: str) -> None:
    emit("INFO", tag, message)


def warn(tag: str, message: str) -> None:
    emit("WARNING", tag, message)


def error(tag: str, message: str) -> None:
    emit("ERROR", tag, message)


_harden_stdout()
