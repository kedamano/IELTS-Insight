"""FastAPI 应用装配（契约 §6：main.py 只负责组装 app + include_router(api_router) + 启动初始化）。

- 用 lifespan 取代已废弃的 `@app.on_event`；
- 启动顺序：迁移/建表（`db.migrate`）→ 装载题库（`services.sets_loader`）
  → 回收上次进程遗留的未完成任务（`jobs` 表，见契约 §1 行 20b）；
- 题库缺失或结构不合格只打日志、不崩（内容 agent 正在并发产出）；
- CORS 允许来源保持原有清单（Tauri v1/v2 webview + Vite dev）。
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.api.common import register_exception_handlers
from app.config import settings
from app.db import migrate, store
from app.services import sets_loader

REAP_REASON = "应用在批改完成前退出，请重新提交批改"


@asynccontextmanager
async def lifespan(_: FastAPI):
    report = migrate.run()
    print(
        f"[Startup] DB={report['db_path']} "
        f"{'(首启新建)' if report['fresh'] else ''}"
        f"{' 旧剧本库已归档' if report['archived_to'] else ''}",
        flush=True,
    )
    if report["archived_to"]:
        print(f"[Startup] 归档位置: {', '.join(report['archived_to'])}", flush=True)

    sets_report = sets_loader.load_sets()
    if sets_report["loaded"] == 0:
        print(
            "[Startup] 警告：题库为空（目录 "
            f"{sets_report['data_dir']}）。四科入口在内容产出前不可用；"
            f"问题清单 {json.dumps(sets_report['errors'][:5], ensure_ascii=False)}",
            flush=True,
        )

    reaped = store.reap_interrupted_jobs(REAP_REASON)
    if reaped:
        print(f"[Startup] 上次退出时未完成批改 {reaped} 个，已标记为失败", flush=True)
    pruned = store.prune_jobs()
    if pruned:
        print(f"[Startup] 清理历史批改任务 {pruned} 条", flush=True)

    print(f"[Startup] Server ready at http://{settings.API_HOST}:{settings.API_PORT}", flush=True)
    yield


# CORS：默认只放行 Tauri webview 与本机 vite 开发服务器；显式 `DEBUG=true` 才开成通配。
# Tauri v2: Windows/Linux/Android 为 http://tauri.localhost，macOS/iOS 为 tauri://localhost
# Tauri v1: 全平台为 tauri://localhost
TAURI_ORIGINS = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
]
# vite 的两种写法都要收：只写 localhost 会让用 127.0.0.1 打开的开发页拿不到数据。
DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def cors_allow_origins(debug: bool) -> list[str]:
    return ["*"] if debug else [*TAURI_ORIGINS, *DEV_ORIGINS]


allow_origins = cors_allow_origins(settings.DEBUG)

app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Audio-Cache", "Content-Disposition"],
)

register_exception_handlers(app)

app.include_router(api_router)

print(f"[CORS] DEBUG={settings.DEBUG!r} allow_origins={allow_origins!r}", flush=True)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)
