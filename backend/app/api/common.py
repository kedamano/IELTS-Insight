"""API 层共用件：响应 envelope、错误体、异常处理。

契约（spec-contracts.md §0）：
- 成功：`200` + `{"data": <payload>}`（音频/文件响应除外）；
- 失败：`{"detail": "<中文可读>", "code": "<机器码>"}` + 恰当状态码
  （400 校验 / 404 不存在 / 409 冲突 / 413 过大 / 502 AI 上游失败 / 503 依赖服务不可用）。

说明：`{data, code}` 形态的 `HTTPException` 无法用 FastAPI 默认 handler 产出（它会包一层
`{"detail": {...}}`），所以这里用自定义异常 + handler，并把 FastAPI 的 HTTPException /
请求校验错误也统一转换成契约形态。
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

CODE_BAD_REQUEST = "bad_request"
CODE_NOT_FOUND = "not_found"
CODE_CONFLICT = "conflict"
CODE_TOO_LARGE = "payload_too_large"
CODE_VALIDATION = "validation_failed"
CODE_AI_UPSTREAM = "ai_upstream_failed"
CODE_DEPENDENCY = "dependency_unavailable"


class ApiError(Exception):
    """带机器码的业务错误。"""

    def __init__(self, status_code: int, detail: str, code: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code


def not_found(detail: str = "记录不存在", code: str = CODE_NOT_FOUND) -> ApiError:
    return ApiError(404, detail, code)


def bad_request(detail: str, code: str = CODE_VALIDATION) -> ApiError:
    return ApiError(400, detail, code)


def dependency_unavailable(detail: str, code: str = CODE_DEPENDENCY) -> ApiError:
    return ApiError(503, detail, code)


def ok(data: Any) -> dict[str, Any]:
    """成功 envelope。"""
    return {"data": data}


def error_body(detail: str, code: str) -> dict[str, str]:
    return {"detail": detail, "code": code}


def _http_detail_text(exc: HTTPException) -> tuple[str, str]:
    detail = exc.detail
    if isinstance(detail, dict):
        text = str(detail.get("detail") or detail.get("message") or "请求处理失败")
        code = str(detail.get("code") or CODE_BAD_REQUEST)
        return text, code
    if isinstance(detail, str) and detail:
        return detail, CODE_BAD_REQUEST if exc.status_code < 500 else "server_error"
    return "请求处理失败", CODE_BAD_REQUEST if exc.status_code < 500 else "server_error"


def register_exception_handlers(app: FastAPI) -> None:
    """把所有错误响应统一成 `{detail, code}`。"""

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=error_body(exc.detail, exc.code))

    @app.exception_handler(HTTPException)
    async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
        text, code = _http_detail_text(exc)
        headers = getattr(exc, "headers", None) or {}
        headers.setdefault("X-Content-Type-Options", "nosniff")
        return JSONResponse(status_code=exc.status_code, content=error_body(text, code), headers=headers)

    # Starlette 基类：覆盖「未匹配路由」等由框架抛出的 404/405，
    # 否则它们会走 FastAPI 默认 handler 只产出 {"detail": "Not Found"}（缺 code）。
    @app.exception_handler(StarletteHTTPException)
    async def _starlette_http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        text, code = _http_detail_text(exc)
        if exc.status_code == 404:
            text = "接口或资源不存在"
            code = CODE_NOT_FOUND
        elif exc.status_code == 405:
            text = "请求方法不被允许"
            code = CODE_BAD_REQUEST
        headers = getattr(exc, "headers", None) or {}
        headers.setdefault("X-Content-Type-Options", "nosniff")
        return JSONResponse(status_code=exc.status_code, content=error_body(text, code), headers=headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first: Optional[Any] = exc.errors()[0] if exc.errors() else None
        loc = ".".join(str(p) for p in (first or {}).get("loc", [])[1:]) or "请求体"
        msg = f"参数校验失败：{loc}"
        return JSONResponse(status_code=400, content=error_body(msg, CODE_VALIDATION))

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        # 兜底：不泄漏内部细节（尤其不泄漏 key），但也不静默伪装成成功结果。
        print(f"[API] 未处理异常: {type(exc).__name__}: {exc}", flush=True)
        return JSONResponse(
            status_code=500, content=error_body("本地引擎内部错误，请重试或查看日志", "internal_error")
        )
