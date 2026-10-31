"""`/api/drafts/{key}`（契约 §14.5，§1 行 48–50）：草稿的第二份副本。

为什么值得多写三个端点：作文正文在提交成功之前只有 WebView2 的 localStorage 一份，
那份 profile 被清理 / 重装 / 换机器 == 一篇写了半小时的文章永久消失，而学习库和快照里
没有它任何痕迹。写进 `drafts` 表之后，草稿第一次享有 §14.3 的快照保护。
CONSTITUTION §1 的「没有服务器」指的是不依赖远端服务， sidecar 与页面同机，不违背它。

三条实现约束（都有对应测试）：

- `{key}` 来自 URL、用户可控：只接受三个面板自己的命名法，越界一律 400，
  且 detail **不回显 key 也不含路径分隔符**（否则一个字符串就能把本机目录结构抄进响应体）。
- 正文上限在 handler 里判、不交给框架：超限是 413「太大了」，
  不是 400「参数不对」，前端要显示的是两句不同的话。
- `DELETE` 幂等：提交后前端「先删远端、成功后才清本地」，靠的就是远端没有也不算失败。
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Body

from app.api.common import CODE_TOO_LARGE, ApiError, bad_request, not_found, ok
from app.db import store

router = APIRouter(prefix="/drafts", tags=["drafts"])

_KEY_RE = re.compile(store.DRAFT_KEY_PATTERN)


def _check_key(key: str) -> str:
    if not _KEY_RE.fullmatch(key):
        # 不回显 key：它本身就可能是 `../../`，抄进 detail 等于把路径写进响应体
        raise bad_request("草稿的名字不属于本机支持的任务，已拒绝，学习库没有改动。")
    return key


@router.put("/{key}")
def put_draft(key: str, body: dict[str, Any] = Body(...)):
    _check_key(key)
    value = body.get("value")
    if not isinstance(value, str):
        raise bad_request("草稿正文必须是字符串：听力/阅读传序列化后的答案，写作传散文。")
    if len(value) > store.MAX_DRAFT_VALUE_CHARS:
        raise ApiError(
            413,
            f"这份草稿太长了（超过 {store.MAX_DRAFT_VALUE_CHARS} 字），本机没有保存。请分段完成后再提交。",
            CODE_TOO_LARGE,
        )
    saved_at = body.get("saved_at")
    stamp = saved_at if isinstance(saved_at, (int, float)) and not isinstance(saved_at, bool) else None
    return ok(store.upsert_draft(key, value, stamp))


@router.get("/{key}")
def get_draft(key: str):
    record = store.get_draft(_check_key(key))
    if record is None:
        # 404 是「远端没有副本」的正常答案：前端据此回落到本地草稿，不许当成错误弹红
        raise not_found("本机还没有这份草稿的副本。")
    return ok(record)


@router.delete("/{key}")
def delete_draft(key: str):
    _check_key(key)
    store.delete_draft(key)
    return ok({"cleared": True})
