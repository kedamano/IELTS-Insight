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

import uvicorn  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402

if __name__ == "__main__":
    # 只打印非敏感的启动信息，绝不打印 OPENAI_API_KEY 等凭据。
    print(f"[IELTS Backend] listening on http://{settings.API_HOST}:{settings.API_PORT}")
    print(f"[IELTS Backend] data root : {_data_root()}")
    print(f"[IELTS Backend] app data  : {_APPDATA}")
    # 传入 app 对象（不是 import 字符串），PyInstaller 冻结模式下 reload/import-string 不可用。
    uvicorn.run(app, host=settings.API_HOST, port=settings.API_PORT, log_level="info")
