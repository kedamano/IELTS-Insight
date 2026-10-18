"""L3 API 契约：异步批改队列（契约 §1 行 20b/11b/20c；FR-W3「提交后先做别的」）。

覆盖 AC：
- AC-W3 / AC-G2：异步批改照样产出契约 §3-W 报告并落 `attempts`，与同步端点同形状；
- AC-S4：口语整场评分同样可排队；
- FR-G4：失败必须**可见** —— `jobs.status='failed'` + 中文可读 `error`，
  而不是让 UI 永远停在「批改中」；
- 入站校验纪律：异步端点也要就地拒绝空作文/错题目 ID，不让用户排队两分钟才发现写错了。

用例约定：每个提交任务都轮询到终态才结束，避免 worker 线程跨过 monkeypatch 还原点。
"""
from __future__ import annotations

import time
from typing import Any

import pytest

TERMINAL = ("succeeded", "failed")
POLL_TIMEOUT_SEC = 20.0


def essay(words: int = 270) -> str:
    """凑一篇恰好 words 词的 Task 2 正文（够过字数线，本地近似引擎也能给出 band）。"""
    spine = "many employees now work from home and observers agree that this trend will continue because "
    filler = "the data shows a clear change over the period and firms adapt slowly "
    text = spine
    while len(text.split()) < words:
        text += filler
    return " ".join(text.split()[:words])


def _task_id(client, envelope, module: str) -> str:
    items = envelope(client.get("/api/writing/tasks", params={"module": module}))["items"]
    assert items, f"内容下限：写作 {module} 至少要有一题"
    return str(items[0]["id"])


def _submit_writing(client, envelope, **body: Any) -> dict[str, Any]:
    return envelope(client.post("/api/writing/attempts/async", json=body))


def _wait_job(client, envelope, job_id: str, timeout: float = POLL_TIMEOUT_SEC) -> dict[str, Any]:
    deadline = time.time() + timeout
    last: dict[str, Any] = {}
    while time.time() < deadline:
        last = envelope(client.get(f"/api/jobs/{job_id}"))
        if last["status"] in TERMINAL:
            return last
        time.sleep(0.05)
    raise AssertionError(f"任务 {job_id} 未在 {timeout}s 内进入终态，最后状态：{last!r}")


def _writing_payload(client, envelope, *, words: int = 270) -> dict[str, Any]:
    return {"task_id": _task_id(client, envelope, "task2"), "response": essay(words)}


@pytest.fixture(autouse=True)
def _排空批改队列(client, envelope):
    """用例结束时等 worker 空闲。

    异步执行器是进程内常驻线程，残留任务会把批改结果写进下一个用例刚清空的库，
    让「只落 1 条 attempt」这类断言变成随机失败。
    """
    yield
    deadline = time.time() + POLL_TIMEOUT_SEC
    active: list[dict[str, Any]] = []
    while time.time() < deadline:
        active = envelope(client.get("/api/jobs", params={"status": "active"}))["items"]
        if not active:
            return
        time.sleep(0.05)
    raise AssertionError(f"批改 worker 未在 {POLL_TIMEOUT_SEC}s 内排空：{active!r}")


# ---------------------------------------------------------------------------
# 提交 → 轮询 → 落库（AC-W3 / AC-G2）
# ---------------------------------------------------------------------------

def test_AC_W3_提交立刻返回任务且当场不带报告(client, envelope):
    payload = _writing_payload(client, envelope)
    body = _submit_writing(client, envelope, **payload)
    missing = {"job_id", "status", "module", "task_ref", "attempt_id", "report", "error"} - set(body)
    assert not missing, f"任务响应缺字段 {missing}（实际键：{sorted(body)}）"
    assert body["job_id"].startswith("job_"), body["job_id"]
    assert body["module"] == "writing" and body["task_ref"] == payload["task_id"]
    assert body["status"] in ("queued", "running"), f"新任务应未完成：{body['status']!r}"
    assert body["report"] is None and body["attempt_id"] is None


def test_AC_W3_轮询到成功后报告与同步端点同形状并落库(client, envelope):
    payload = _writing_payload(client, envelope)
    job = _submit_writing(client, envelope, **payload)
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "succeeded", f"批改失败：{done['error']!r}"
    report = done["report"]
    assert isinstance(report, dict) and report, f"成功任务必须带报告：{report!r}"
    assert report["attempt_id"] == done["attempt_id"]
    band = report["band"]
    assert 0.0 <= float(band["overall"]) <= 9.0, f"band.overall 越界：{band!r}"
    assert {"ai_used", "degraded_reason", "approximate"} <= set(report)  # 契约 §3 的 AI 元信息

    # 结果进了唯一的练习事实表，且详情端点能原样读回（AC-G2）
    listed = envelope(client.get("/api/attempts", params={"module": "writing"}))
    assert listed["total"] == 1, f"异步批改应只落 1 条 attempt：{listed!r}"
    again = envelope(client.get(f"/api/writing/attempts/{done['attempt_id']}"))
    assert again["attempt_id"] == done["attempt_id"]
    assert float(again["band"]["overall"]) == float(band["overall"])


def test_AC_W3_重复提交同一篇只排一个任务(client, envelope):
    payload = _writing_payload(client, envelope)
    first = _submit_writing(client, envelope, **payload)
    second = _submit_writing(client, envelope, **payload)
    assert second["job_id"] == first["job_id"], "连点两次提交不该产出两份批改"
    done = _wait_job(client, envelope, first["job_id"])
    assert done["status"] == "succeeded"
    assert envelope(client.get("/api/attempts", params={"module": "writing"}))["total"] == 1


# ---------------------------------------------------------------------------
# 入站校验：异步不等于把错误推迟到队列里
# ---------------------------------------------------------------------------

def test_FR_G4_空作文就地400且不建任务(client, envelope, error_body):
    task_id = _task_id(client, envelope, "task2")
    response = client.post("/api/writing/attempts/async", json={"task_id": task_id, "response": "   "})
    body = error_body(response, status=400)
    assert body["code"] == "empty_response"
    assert envelope(client.get("/api/jobs"))["items"] == []


def test_FR_G4_缺task_id_与不存在题面各自报错(client, envelope, error_body):
    missing = error_body(client.post("/api/writing/attempts/async", json={"response": essay(270)}), status=400)
    assert "task_id" in missing["detail"]
    absent = error_body(
        client.post("/api/writing/attempts/async", json={"task_id": "wr_t9_nope_99", "response": essay(270)}),
        status=404,
    )
    assert absent["code"] == "not_found"
    assert envelope(client.get("/api/jobs"))["items"] == [], "校验失败不该留下任务"


def test_FR_G4_非数字时长就地400(client, envelope, error_body):
    payload = _writing_payload(client, envelope)
    body = error_body(client.post("/api/writing/attempts/async", json={**payload, "duration_sec": "abc"}), status=400)
    assert "duration_sec" in body["detail"]


# ---------------------------------------------------------------------------
# 失败可见性（FR-G4）
# ---------------------------------------------------------------------------

def test_FR_G4_引擎异常要让任务失败且不泄漏密钥(client, envelope, monkeypatch):
    from app.services import writing_grader

    def boom(*args, **kwargs):  # noqa: ANN002, ANN003
        raise RuntimeError("upstream 500 Authorization: Bearer sk-PRIVATE123")

    monkeypatch.setattr(writing_grader, "grade", boom)
    job = _submit_writing(client, envelope, **_writing_payload(client, envelope))
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "failed", f"引擎异常应让任务失败：{done!r}"
    assert done["error"], "失败必须有可读原因，不能只给状态"
    assert "sk-PRIVATE123" not in done["error"], f"错误文案泄漏了凭据：{done['error']!r}"
    assert done["report"] is None and done["attempt_id"] is None
    assert envelope(client.get("/api/attempts"))["total"] == 0, "失败的批改不该伪装成一次练习"


def test_FR_G4_业务错误的中文detail原样给到用户(client, envelope, monkeypatch):
    from app.services import writing_grader

    class DetailError(Exception):
        detail = "AI 考官连续两次返回无法解析的内容，请稍后重试"

    monkeypatch.setattr(writing_grader, "grade", lambda *a, **k: (_ for _ in ()).throw(DetailError()))
    job = _submit_writing(client, envelope, **_writing_payload(client, envelope))
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "failed"
    assert done["error"] == DetailError.detail


def test_FR_G4_执行器拒绝没有落库结果的任务(client, envelope):
    """worker 的兜底：runner 交回一个没写进 attempts 的「报告」必须判失败。

    写作/口语路径总会补 `attempt_id`，所以这条只能直接驱动执行器；它防的是
    「任务显示成功但练习记录里查不到东西」这种最伤信任的错配。
    """
    from app.db import store
    from app.services import job_queue

    for bogus in ({"band": {"overall": 6.0}}, [], None):
        job = store.create_job(module="writing", task_ref="wr_t2_q_04", request={"probe": True})
        job_queue.submit(job["id"], lambda value=bogus: value)
        done = _wait_job(client, envelope, job["id"])
        assert done["status"] == "failed", f"{bogus!r} 不该被判成功：{done!r}"
        assert done["error"]
    assert envelope(client.get("/api/attempts"))["total"] == 0


# ---------------------------------------------------------------------------
# 任务查询端点自身（契约 §1 行 20c）
# ---------------------------------------------------------------------------

def test_AC_G2_查询不存在的任务返回404(client, envelope, error_body):
    body = error_body(client.get("/api/jobs/job_不存在"), status=404)
    assert body["code"] == "not_found"


def test_FR_G4_列表参数越界给中文错误(client, envelope, error_body):
    bad_status = error_body(client.get("/api/jobs", params={"status": "bogus"}), status=400)
    assert "status" in bad_status["detail"]
    bad_limit = error_body(client.get("/api/jobs", params={"limit": 0}), status=400)
    assert "limit" in bad_limit["detail"]


def test_AC_W3_active列表只含未完成任务(client, envelope):
    payload = _writing_payload(client, envelope)
    job = _submit_writing(client, envelope, **payload)
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "succeeded"
    assert envelope(client.get("/api/jobs", params={"status": "active"}))["items"] == []
    assert {item["job_id"] for item in envelope(client.get("/api/jobs"))["items"]} == {job["job_id"]}


# ---------------------------------------------------------------------------
# 进程重启后的残留任务（否则前端会永远轮询）
# ---------------------------------------------------------------------------

def test_FR_G4_启动回收把未完成任务判失败(client, clean_db):
    from app.db import store

    stale = store.create_job(module="writing", task_ref="wr_t2_x_01", request={"task_id": "wr_t2_x_01"})
    store.mark_job_running(stale["id"])
    finished = store.create_job(module="writing", task_ref="wr_t2_y_02", request={"task_id": "wr_t2_y_02"})
    store.mark_job_running(finished["id"])
    store.mark_job_succeeded(finished["id"], attempt_id="att_fake", report={"attempt_id": "att_fake"})

    reason = "应用在批改完成前退出，请重新提交批改"
    assert store.reap_interrupted_jobs(reason) == 1
    reaped = store.get_job(stale["id"])
    assert reaped["status"] == "failed" and reaped["error"] == reason
    assert store.get_job(finished["id"])["status"] == "succeeded", "回收不该动终态任务"


def test_FR_G4_回收后前端能读到失败原因(client, envelope):
    from app.db import store

    stale = store.create_job(module="writing", task_ref="wr_t2_z_03", request={"task_id": "wr_t2_z_03"})
    reason = "应用在批改完成前退出，请重新提交批改"
    store.reap_interrupted_jobs(reason)
    data = envelope(client.get(f"/api/jobs/{stale['id']}"))
    assert data["status"] == "failed" and data["error"] == reason


# ---------------------------------------------------------------------------
# 口语（AC-S4）
# ---------------------------------------------------------------------------

def _speaking_session(client, envelope, text: str = "I usually cycle to work because it keeps me fit.") -> str:
    sets = envelope(client.get("/api/speaking/sets"))["items"]
    assert sets, "内容下限：口语至少有一套题"
    started = envelope(
        client.post("/api/speaking/sessions", json={"set_id": sets[0]["id"], "part": 1})
    )
    session_id = started["session_id"]
    turn = client.post(f"/api/speaking/sessions/{session_id}/turn", data={"text": text, "duration_sec": "12"})
    assert turn.status_code == 200, f"文本兜底作答失败：{turn.text[:300]!r}"
    return session_id


def test_AC_S4_口语评分可异步并回写会话(client, envelope):
    session_id = _speaking_session(client, envelope)
    job = envelope(client.post(f"/api/speaking/sessions/{session_id}/assess/async"))
    assert job["module"] == "speaking" and job["task_ref"] == session_id
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "succeeded", f"口语评分失败：{done['error']!r}"
    assert done["report"]["attempt_id"] == done["attempt_id"]
    assert float(done["report"]["band"]["overall"]) >= 0.0

    view = envelope(client.get(f"/api/speaking/sessions/{session_id}"))
    assert view["state"] == "assessed", f"评分后会话状态应翻转：{view['state']!r}"
    assert view["result"]["attempt_id"] == done["attempt_id"]
    assert envelope(client.get("/api/attempts", params={"module": "speaking"}))["total"] == 1


def test_AC_S4_同一会话重复排队复用任务(client, envelope):
    session_id = _speaking_session(client, envelope)
    first = envelope(client.post(f"/api/speaking/sessions/{session_id}/assess/async"))
    second = envelope(client.post(f"/api/speaking/sessions/{session_id}/assess/async"))
    assert second["job_id"] == first["job_id"]
    assert _wait_job(client, envelope, first["job_id"])["status"] == "succeeded"
    assert envelope(client.get("/api/attempts", params={"module": "speaking"}))["total"] == 1


def test_AC_S4_没有作答时排队就地400(client, envelope, error_body):
    sets = envelope(client.get("/api/speaking/sets"))["items"]
    started = envelope(client.post("/api/speaking/sessions", json={"set_id": sets[0]["id"], "part": 1}))
    body = error_body(client.post(f"/api/speaking/sessions/{started['session_id']}/assess/async"), status=400)
    assert body["code"] == "empty_answer"


def test_FR_G4_会话不存在给404(client, envelope, error_body):
    body = error_body(client.post("/api/speaking/sessions/ses_没有/assess/async"), status=404)
    assert body["code"] == "not_found"


# ---------------------------------------------------------------------------
# 同步端点保持不变（不许因异步改造翻案）
# ---------------------------------------------------------------------------

def test_AC_W3_同步端点仍然直接返回报告(client, envelope):
    report = envelope(client.post("/api/writing/attempts", json=_writing_payload(client, envelope)))
    assert report["attempt_id"] and report["band"]["overall"] is not None
    assert envelope(client.get("/api/jobs"))["items"] == [], "同步路径不该建任务"
