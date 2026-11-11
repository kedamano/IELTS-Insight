"""PyInstaller entry point for the IELTS Insight FastAPI backend sidecar.

职责边界（T6 交付）：
- 只做「冻结环境引导」：解析打包后数据根目录、确保本地数据目录存在、把生产 exe 的安全姿态固定下来。
- 路径策略（DB / TTS 缓存 / 联网开关）由 `app.config` 依据 `IELTS_DB_PATH` /
  `IELTS_TTS_CACHE_DIR` / `IELTS_ONLINE` 环境变量与 `.env` 决定，本入口【不越权硬写】，
  以便用户仍可用 `.env` 覆盖；测试进程不经过本入口（直接用 conftest 的环境变量）。
- 绝不打印 API key / base_url / model 之外的任何凭据值（CONSTITUTION §3）。
"""
import os
import sys


def _is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def _apply_cli_overrides(argv: list[str]) -> None:
    """把 `--port` / `--host` 写进环境变量，让 `app.config` 接住。

    冻结前没有这个函数，`backend.exe --port 8798` 会被**静默忽略**（日志照旧写
    「准备监听 8765」然后撞端口退出）—— 排查时看到的是「端口被占用」，
    完全指不到真正的错因。这是测试与运维的可观测性缺口，不是安全问题，
    但会让每次隔离栈都要靠环境变量绕一圈。

    只认这两个参数：sidecar 由 Tauri 拉起时不传参，行为不变；
    显式传参时以参数为准（env 已在 config 里优先于 .env，这里只补「命令行」这一层）。
    """
    it = iter(range(len(argv)))
    for i in it:
        arg = argv[i]
        if arg == "--port" and i + 1 < len(argv):
            os.environ["API_PORT"] = argv[i + 1]
            next(it, None)
        elif arg.startswith("--port="):
            os.environ["API_PORT"] = arg.split("=", 1)[1]
        elif arg == "--host" and i + 1 < len(argv):
            os.environ["API_HOST"] = argv[i + 1]
            next(it, None)
        elif arg.startswith("--host="):
            os.environ["API_HOST"] = arg.split("=", 1)[1]


def _appdata_dir() -> str:
    """本地数据根：优先 %LOCALAPPDATA%\\IELTSInsight，回退 ~/.ielts-insight。"""
    local = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if local:
        base = os.path.join(local, "IELTSInsight")
    else:
        base = os.path.join(os.path.expanduser("~"), ".ielts-insight")
    return base


def _data_root() -> str:
    """题库/词典等随 exe 打包的只读数据根目录。

    PyInstaller 打包后 `sys._MEIPASS` 是解包临时目录，spec 用
    `('app/data', 'app/data')` 把 `app/data/**` 放到 `_MEIPASS/app/data`。
    运行期需要读取这些 JSON 的模块应遵循同一约定（见 README「打包与数据加载」）：
        if getattr(sys, "frozen", False):
            DATA = Path(sys._MEIPASS) / "app" / "data"
        else:
            DATA = Path(__file__).resolve().parent / "data"
    """
    if _is_frozen():
        return os.path.join(getattr(sys, "_MEIPASS"), "app", "data")
    # 源码模式：本文件在 backend/，数据在 backend/app/data
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(backend_dir, "app", "data")


# --- 冻结引导 ---------------------------------------------------------------
# 暴露给业务代码的可选提示（app.config 若不读取也无副作用）。
os.environ.setdefault("IELTS_DATA_DIR", _data_root())

# 确保本地可写数据根存在（DB / TTS 缓存都放这里，而非 exe 同目录——
# exe 装到 Program Files 时不可写，旧的 relative-CWD 坑就是这么来的）。
_APPDATA = _appdata_dir()
os.makedirs(_APPDATA, exist_ok=True)
os.makedirs(os.path.join(_APPDATA, "cache", "tts"), exist_ok=True)

# 打包出来的 sidecar 永远是生产实例：强制关闭 DEBUG，
# 避免 `app.main` 里的 CORS 走 allow_origins=["*"]（CONSTITUTION 安全默认）。
os.environ["DEBUG"] = "False"

# 命令行参数必须在 import config **之前**落地：`settings` 是模块级单例，
# import 那一刻就把 API_PORT/API_HOST 定死了，之后再改 env 已经来不及。
# （实测过：把这段放在 __main__ 里，`python -m pyinstaller_entry --port 8797`
#   仍然监听 8765 —— 因为 settings 早在第 88 行就构造完了。）
_apply_cli_overrides(sys.argv[1:])

import uvicorn  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services import faultlog  # noqa: E402

if __name__ == "__main__":
    # 只打印非敏感的启动信息，绝不打印 OPENAI_API_KEY 等凭据。
    # 走 faultlog 而不是 print：这条 exe 由 Tauri 用 CREATE_NO_WINDOW 拉起，
    # stdout 会被父进程读走丢弃（契约 §15.3）。
    faultlog.info("Entry", f"准备监听 http://{settings.API_HOST}:{settings.API_PORT}（实际端口待首个请求核实）")
    faultlog.info("Entry", f"数据根目录={_data_root()} 用户数据={_APPDATA}")
    # 传入 app 对象（不是 import 字符串），PyInstaller 冻结模式下 reload/import-string 不可用。
    uvicorn.run(app, host=settings.API_HOST, port=settings.API_PORT, log_level="info")
