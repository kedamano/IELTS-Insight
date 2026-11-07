"""内容生成端点（契约 §1 行 40–41、§17；Wave 8 转正）。

- `POST /content/generate`：廉价校验就地拒绝（module/count/band 形状、离线 ⇒ 503），
  然后排队返回 `JobView`（§10.6 全套规则：去重、5s 复用、failed 不复用、启动 reap）。
  生成一套题是分钟级上游调用，同步等 = 用户盯着转圈（§10.6 的原始论据在这里同样成立）。
- `GET /content/jobs/{job_id}`：批改的 `GET /jobs/{id}` 已能回答 content 任务
  （同一张 jobs 表），这个别名端点存在只为契约 §1 行 41 的字面承诺；两者响应形状一致。

产物写 `<数据目录>/generated/ielts/`（§17.1），装载发生在下次启动 ——
响应与界面文案都必须写「重启应用后生效」，不许假装题库当场变多。
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Request

from app.api.common import bad_request, dependency_unavailable, not_found, ok
from app.api.jobs import job_view
from app.db import store
from app.services import ai_client, content_gen, job_queue

router = APIRouter(tags=["content"])

BAND_CHOICES = (5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0)


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        value = await request.json()
    except Exception:
        raise bad_request("请求体应为合法 JSON") from None
    if not isinstance(value, dict):
        raise bad_request("请求体必须是 JSON 对象")
    return value


def _validate(payload: dict[str, Any]) -> dict[str, Any]:
    """就地廉价校验（§10.6 条款 1：明显不该排队的请求不许进队列才发现）。"""
    module = str(payload.get("module") or "").strip()
    if module not in content_gen.MODULE_CHOICES:
        raise bad_request(
            f"module 只能是 {', '.join(content_gen.MODULE_CHOICES)}", code="validation_failed"
        )
    count = payload.get("count", 1)
    try:
        count = int(count)
    except (TypeError, ValueError):
        raise bad_request("count 应为 1 到 5 的整数", code="validation_failed") from None
    if not 1 <= count <= content_gen.MAX_COUNT:
        raise bad_request(f"count 应为 1 到 {content_gen.MAX_COUNT} 的整数", code="validation_failed")
    band: Optional[float] = None
    raw_band = payload.get("target_band")
    if raw_band not in (None, ""):
        try:
            band = float(raw_band)
        except (TypeError, ValueError):
            raise bad_request("target_band 应为数字（如 6.5）", code="validation_failed") from None
        if band not in BAND_CHOICES:
            raise bad_request("target_band 应为 5.0–9.0 的 0.5 步长", code="validation_failed")
    part = payload.get("part")
    if part not in (None, ""):
        try:
            part = int(part)
        except (TypeError, ValueError):
            raise bad_request("part 只能是 1、2 或 3", code="validation_failed") from None
        if part not in (1, 2, 3):
            raise bad_request("part 只能是 1、2 或 3", code="validation_failed")
    task = payload.get("task")
    if task not in (None, "") and task not in ("task1", "task2"):
        raise bad_request("task 只能是 task1 或 task2", code="validation_failed")
    hint = str(payload.get("topic_hint") or "").strip()[:120] or None
    return {"module": module, "count": count, "target_band": band, "part": part, "task": task, "topic_hint": hint}


@router.post("/content/generate")
async def generate(request: Request):
    params = _validate(await _json_body(request))
    # 出站许可在**提交时**就判（§15.2）：用户关着在线却排上一个两分钟后才失败的任务，
    # 等于把「你关掉了它」伪装成「上游坏了」。
    if not ai_client.network_allowed():
        raise dependency_unavailable(
            "已关闭联网，无法生成题目；请在设置里开启在线服务后重试", code="content_offline"
        )

    dedupe_key = f"content:{params['module']}:{params['count']}:{params['target_band']}"
    existing = store.find_reusable_job(dedupe_key)
    if existing:
        return ok(job_view(existing))

    job = store.create_job(
        module="content",
        task_ref=params["module"],
        request=params,
        dedupe_key=dedupe_key,
    )
    job_queue.submit(
        job["id"],
        lambda: content_gen.generate(**params),
        expects_attempt=False,  # 生成任务的产物是文件，不是练习记录（§17.3 条款 2）
    )
    return ok(job_view(job))


@router.get("/content/jobs/{job_id}")
def job_status(job_id: str):
    """与 `GET /jobs/{job_id}` 同形状（同一张 jobs 表）；契约 §1 行 41 的字面承诺。"""
    job = store.get_job(job_id)
    if not job:
        raise not_found(f"生成任务不存在：{job_id}")
    return ok(job_view(job))
