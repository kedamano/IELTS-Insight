"""FastAPI 应用装配（契约 §6：main.py 只负责组装 app + include_router(api_router) + 启动初始化）。

- 用 lifespan 取代已废弃的 `@app.on_event`；
- 启动顺序：留身份（`services/runtime`，契约 §15.4）→ 体检/迁移建表（`db.migrate`）
  → 装载题库（`services.sets_loader`）
  → 回收上次进程遗留的未完成任务（`jobs` 表，见契约 §1 行 20b）；
- 题库缺失或结构不合格只打日志、不崩（内容 agent 正在并发产出）；
- CORS 允许来源保持原有清单（Tauri v1/v2 webview + Vite dev）。
"""

from __future__ import annotations

import ipaddress
import json
import sqlite3
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api import api_router
from app.api.common import (
    CODE_STORAGE_READONLY,
    STORAGE_READONLY_DETAIL,
    error_body,
    register_exception_handlers,
)
from app.config import settings
from app.db import backup, migrate, migrations, store
from app.services import faultlog, runtime, sets_loader, tts_service

REAP_REASON = "应用在批改完成前退出，请重新提交批改"

# 只读降级要挡的方法（GET/HEAD/OPTIONS 不在内 —— 降级期间读还得能用，§14.6）
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class StorageReadonlyGuard:
    """只读降级期间把写请求当场挡下（契约 §14.6）。

    裸 ASGI 中间件而不是 `BaseHTTPMiddleware`：后者会把每个响应套一层流，音频/文件
    端点经它转发是已知隐患，而这里只需要在进路由之前直接回一个 503。
    被拒绝的写**根本没机会碰库** —— 测试会验这一点，不能靠「大概率失败」糊过去。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in WRITE_METHODS
            and store.storage_is_readonly()
        ):
            response = JSONResponse(
                status_code=503, content=error_body(STORAGE_READONLY_DETAIL, CODE_STORAGE_READONLY)
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _is_bind_address(host: object) -> bool:
    """`scope["server"]` 的 host 是不是一个真的套接字地址（契约 §15.3 第 6 条的判据补强）。

    uvicorn 用 `transport.getsockname()` 填，永远是 IP 字面量；而 starlette `TestClient`
    填的是 `("testserver", 80)` —— 那是传输层造的虚拟地址，拿它冒充实测端口会同时污染
    日志与 `/api/health` 的身份字段（§15.4 第 1 条）。
    """
    try:
        ipaddress.ip_address(str(host or ""))
    except ValueError:
        return False
    return True


class BoundPortProbe:
    """用第一个真实请求核实监听端口（契约 §15.3 第 6 条）。

    启动横幅手里只有配置值；`scope["server"]` 才是 uvicorn 从 `transport.getsockname()`
    填进来的**实际绑定地址**（`uvicorn/protocols/utils.py:get_local_addr`）。
    本类注册在中间件链最外层，所以只读降级的 503 与 CORS 预检也算「见过请求」。
    每进程只记一次：端口不会中途变，反复记只是把日志刷成噪音。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.checked = False


    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and not self.checked:
            self.checked = True
            server = scope.get("server") or ()
            host = server[0] if len(server) > 0 else None
            port = server[1] if len(server) > 1 else None
            if isinstance(port, int) and _is_bind_address(host):
                # 实测值同时要喂给身份字段（契约 §15.4 第 1 条），否则 /api/health 报的还是配置端口
                runtime.set_observed_port(port)
                if port == settings.API_PORT:
                    faultlog.info("PortProbe", f"已确认服务端口 {host}:{port}（与配置一致）")
                else:
                    faultlog.warn(
                        "PortProbe",
                        f"实际服务端口 {host}:{port} 与配置端口 {settings.API_PORT} 不一致："
                        "以实际端口为准，前端连不上本机服务就是这个原因",
                    )
            else:
                # httpx ASGITransport / starlette TestClient 给的是 ("testserver", 80) 这类
                # **虚拟地址**，不是 socket 绑出来的值。没有实测值就如实说没能核实（§15.3 第 6 条）。
                faultlog.info("PortProbe", f"未能从请求核实端口（传输给出的不是本机地址：{host}:{port}）")
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 第一件事是留身份，不是建表（契约 §15.4 第 2/3 条）：「上一个实例没退干净」或
    # 「两个引擎共用同一个数据目录」都必须在下手改库之前落进日志 —— 之后任何一条锁冲突、
    # 任何一次只读降级，都只有靠这两行才知道是谁跟谁撞的。
    身份 = runtime.start()
    faultlog.info(
        "Startup",
        f"本次引擎：pid={身份['pid']} version={身份['version']} 启动于 {身份['started_at']}",
    )
    try:
        # 第一件事是体检，不是建表（§14.6）：`quick_check` 不通过说明这个文件读都读不出，
        # 此时跑迁移只会更坏，拍快照等于把坏库复制进 backups/。
        # 关键约束：**不删库、不重建** —— 损坏的库比没有库有价值得多，用户还有手工救数据的机会。
        check = store.quick_check()
        if not check["ok"]:
            reason = check["reason"] or store.STORAGE_GENERIC
            store.set_storage_readonly(reason)
            faultlog.error("Startup", f"学习库未通过结构体检，本次以只读方式运行：{reason}")
            yield
            return

        try:
            report = migrate.run()
        except migrations.SchemaUpgradeError as exc:
            # §14.2：结构未就绪时**照常把服务起起来**，让每个读写都拿到明确的
            # schema_upgrade_failed。直接崩掉的话前端只会显示「连不上本地服务」，
            # 而真相是「库结构升级失败、升级前的快照已经留在 backups 目录」。
            store.mark_schema_failed(exc.detail)
            faultlog.error("Startup", f"学习库结构未就绪：{exc.detail}（原因 {exc.reason}）")
            yield
            return
        faultlog.info(
            "Startup",
            f"DB={report['db_path']} "
            f"{'(首启新建)' if report['fresh'] else ''}"
            f"{' 已留下副本/归档' if report['archived_to'] else ''}"
            f" 库结构 v{report['schema_version']}",
        )
        if report["archived_to"]:
            faultlog.info("Startup", f"副本位置: {', '.join(report['archived_to'])}")
        if report["schema_version"] > report["schema_version_before"]:
            faultlog.info(
                "Startup",
                f"学习库结构已从 v{report['schema_version_before']} 升级到 "
                f"v{report['schema_version']}（升级前快照见上面的副本位置）",
            )

        # 日常补拍（§14.3：距上次成功快照 > 7 天）。补拍失败不该挡住启动 ——
        # 一个没拍成的备份是坏事，一个起不来的 app 会让用户连库都看不到。
        try:
            opportun = backup.startup_snapshot_if_stale(fresh=report["fresh"])
            if opportun is not None:
                faultlog.info("Startup", f"已补拍学习库快照：{opportun.name}")
        except (sqlite3.Error, OSError) as exc:
            faultlog.warn("Startup", f"快照补拍失败（{type(exc).__name__}），本次启动没有新增备份")

        sets_report = sets_loader.load_sets()
        if sets_report["loaded"] == 0:
            faultlog.warn(
                "Startup",
                "题库为空（目录 "
                f"{sets_report['data_dir']}）。四科入口在内容产出前不可用；"
                f"问题清单 {json.dumps(sets_report['errors'][:5], ensure_ascii=False)}",
            )

        # TTS 缓存是纯派生产物，删了只是下次多花几秒合成 —— 可以无条件轮转。
        # 放在这里而不是 generate 路径里：合成路径每句都要调，那里做清理会反复扫目录。
        try:
            removed = tts_service.cleanup_cache()
            if removed:
                faultlog.info("Startup", f"已清理过期/超量 TTS 缓存 {removed} 份")
        except OSError as exc:
            # 清不掉不影响功能（磁盘可能晚点满），只记一笔
            faultlog.warn("Startup", f"TTS 缓存清理失败（{type(exc).__name__}），跳过本次清理")

        reaped = store.reap_interrupted_jobs(REAP_REASON)
        if reaped:
            faultlog.warn("Startup", f"上次退出时未完成批改 {reaped} 个，已标记为失败")
        pruned = store.prune_jobs()
        if pruned:
            faultlog.info("Startup", f"清理历史批改任务 {pruned} 条")

        # 契约 §15.3 第 6 条：这里只报「配置写的端口」，实际端口由 BoundPortProbe 用首个请求核实。
        faultlog.info(
            "Startup",
            f"按配置端口启动 http://{settings.API_HOST}:{settings.API_PORT}，实际端口待首个请求核实",
        )
        yield
    finally:
        # 无论走哪条出口都要收走凭据：残留文件会让下一次启动把一个正常退出的实例
        # 误判成孤儿（契约 §15.4 第 2 条）。stop() 自己绝不抛异常。
        runtime.stop()


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

class SecurityHeadersMiddleware:
    """给**所有**响应补齐基础安全头（契约 §0 同源：错误响应已有的 nosniff 在这里统一）。

    本机应用的风险面比公网小，但有三条是白捡的：
    - `X-Content-Type-Options: nosniff`：挡 MIME 嗅探（原来只在错误响应上加）；
    - `X-Frame-Options: DENY`：挡点击劫持（本机虽然不会被嵌 iframe，但成本为零）；
    - `Referrer-Policy: no-referrer`：不出站时也不带 Referer。

    刻意**不加** HSTS：那是给 HTTPS 站点用的，本机 http 上设了只会让浏览器强制跳转
    到一个不存在的 https 端点，把应用锁死。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                existing = {k.lower() for k, _ in headers}
                for name, value in (
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                ):
                    if name not in existing:
                        headers.append((name, value))
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestTimingMiddleware:
    """记录每个 HTTP 请求的耗时与状态码（契约 §15.3 同源：故障日志）。

    裸 ASGI 中间件而不是 `BaseHTTPMiddleware`：后者会把响应套一层流，音频/文件端点
    经它转发是已知隐患，与 `StorageReadonlyGuard` 的取舍一致。

    状态码取自 `http.response.start`。比守卫靠外，所以只读降级的 503 也会记一笔；
    比 CORS 靠内，所以 CORS 预检（在 CORS 层就被拦下、不进本中间件）不计入耗时统计。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status = 0

        async def send_with_timing(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_with_timing)
        finally:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            faultlog.info(
                "Timing",
                f"{scope['method']} {scope.get('path', '')} -> {status or '?'} in {elapsed_ms}ms",
            )


# 先注册守卫、后注册 CORS：`add_middleware` 是插到列表头部，后加的更靠外，
# 于是 CORS 在守卫外面 —— 只读降级的 503 也带得到 CORS 头。
app.add_middleware(StorageReadonlyGuard)

# 耗时探针夹在守卫与 CORS 之间：它比守卫靠外，所以降级的 503 也会被记一笔；
# 它比 CORS 靠内，所以 CORS 预检（没有走到守卫）不计入耗时统计。
app.add_middleware(RequestTimingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Audio-Cache", "Content-Disposition"],
)

# 端口核实探针放最后一次 `add_middleware`：Starlette 插到列表头部，最后加的在最外层，
# 于是降级的 503 与 CORS 预检也能触发核实（契约 §15.3 第 6 条）。
app.add_middleware(BoundPortProbe)

# 安全头放**最外层**（最后一次 add_middleware）：这样异常处理器产出的响应、
# 只读降级的 503、CORS 预检全都带得到；send 里按名去重，不会与 common.py 的 nosniff 重复。
app.add_middleware(SecurityHeadersMiddleware)

register_exception_handlers(app)

app.include_router(api_router)

faultlog.info("CORS", f"DEBUG={settings.DEBUG!r} allow_origins={allow_origins!r}")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)
