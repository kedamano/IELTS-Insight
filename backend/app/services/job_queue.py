"""异步批改执行器（契约 §1 行 20b/11b：提交即返回 job_id，客户端轮询取结果）。

为什么不用 FastAPI 的 `BackgroundTasks`：它跑在事件循环所属进程里，一次 1–2 分钟的
LLM 调用会把同进程的其他请求一起拖住，而且任务状态不落库——应用重启后前端只能永远转圈。

这里的取舍：
- 一条常驻 **守护** worker 线程串行执行（批改是长耗时上游调用，一次只打一个请求，
  既不用抢上游配额也让 sqlite 写入没有并发竞争）；
- 守护线程意味着退出时不强留批改中的请求，残留任务由下次启动
  `store.reap_interrupted_jobs()` 判为失败，用户看到明确原因而不是无限等待；
- 任务状态全部落 `jobs` 表，所以「提交后先做别的」「离开页面再回来」都成立。
"""

from __future__ import annotations

import queue
import threading
from typing import Any, Callable, Optional

from app.db import store
from app.services import faultlog

Runner = Callable[[], dict[str, Any]]

MAX_ERROR_CHARS = 200

_tasks: "queue.Queue[Optional[tuple[str, Runner]]]" = queue.Queue()
_worker: Optional[threading.Thread] = None
_lock = threading.Lock()


def submit(job_id: str, runner: Runner, *, expects_attempt: bool = True) -> None:
    """排队一个已入库的任务；worker 懒启动、进程内常驻。

    `expects_attempt=False` 给非批改类任务（§17 内容生成）：它们的产物是文件不是练习记录。
    默认 True —— 批改的「没有 attempt_id 就是失败」这条既有契约不许被顺手放宽。
    """
    global _worker
    with _lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_loop, name="grading-worker", daemon=True)
            _worker.start()
    _tasks.put((job_id, runner, expects_attempt))


def queue_size() -> int:
    return _tasks.qsize()


def _loop() -> None:
    while True:
        item = _tasks.get()
        if item is None:
            continue
        job_id, runner, expects_attempt = item
        try:
            _execute(job_id, runner, expects_attempt=expects_attempt)
        except Exception as exc:  # 执行器自身故障也不能让 worker 死掉
            faultlog.error("Job", f"worker 内部错误: {type(exc).__name__}: {exc}")


def _execute(job_id: str, runner: Runner, *, expects_attempt: bool = True) -> None:
    store.mark_job_running(job_id)
    try:
        report = runner()
    except Exception as exc:
        reason = _readable_error(exc)
        store.mark_job_failed(job_id, reason)
        faultlog.error("Job", f"{job_id} 批改失败: {type(exc).__name__}: {exc}")
        return
    if not isinstance(report, dict):
        store.mark_job_failed(job_id, "任务没有产出有效结果，请重新提交")
        return
    if expects_attempt and not report.get("attempt_id"):
        # 批改必须落练习记录（AC-G2）；没落库的「成功」是假成功。
        store.mark_job_failed(job_id, "批改没有产出有效结果，请重新提交")
        return
    if not expects_attempt and not report.get("generated"):
        # 生成类任务：一个 set 都没写成才算失败（§17.3 条款 4），部分成功是 succeeded。
        store.mark_job_failed(job_id, "没有生成出任何合格的题目，请检查 AI 端点后重试")
        return
    degraded = report.get("degraded_reason")
    store.mark_job_succeeded(
        job_id,
        attempt_id=report.get("attempt_id"),
        report=report,
        degraded_reason=degraded if isinstance(degraded, str) and degraded else None,
    )


def _readable_error(exc: Exception) -> str:
    """失败原因要可见、可读，且不泄漏内部细节（尤其 key，CONSTITUTION §3）。"""
    detail = getattr(exc, "detail", None)
    text = str(detail) if detail else f"批改失败（{type(exc).__name__}），请重试"
    text = " ".join(text.split())
    return text[:MAX_ERROR_CHARS]
