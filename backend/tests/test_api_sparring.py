"""1 对 1 口语陪练的 L3 契约测试（spec-contracts.md §16；FR-S7、AC-S7.1–S7.6）。

这一组用例守的是**契约形状与降级承诺**，不是 UI：

1. 话题（AC-S7.1）：≥6 条、每条 ≥6 个预置追问、开场白非空；
2. 会话（AC-S7.2）：未知 topic 404、level 非法 400 中文、会话不存在 404；
3. 追问（AC-S7.3a/b/c）：离线回落**且永不重复**；AI 可用时 `source="ai"` 且带上一句上下文；
4. 轮次上限（AC-S7.4）：到上限后 409 `conflict`，状态不被写坏；
5. 评分（AC-S7.5a/b/c）：与 §3-S 同形状 + `sparring` 块、落库一条 `part="sparring"`、
   离线仍产出完整报告、无作答 400 `empty_answer`、重复排队复用同一 job。

AI 全 mock（`fake_openai`），网络围栏见 `tests/conftest.py`；任何用例都不发真实请求。
"""
from __future__ import annotations

import json
import time
from typing import Any

import pytest

TERMINAL = ("succeeded", "failed")
POLL_TIMEOUT_SEC = 20.0


def _topics(client, envelope) -> list[dict[str, Any]]:
    return envelope(client.get("/api/sparring/topics"))["items"]


def _start(client, envelope, topic_id: str, **body: Any) -> dict[str, Any]:
    return envelope(client.post("/api/sparring/sessions", json={"topic_id": topic_id, **body}))


def _turn(client, envelope, session_id: str, text: str, *, duration: str = "3") -> dict[str, Any]:
    response = client.post(
        f"/api/sparring/sessions/{session_id}/turn",
        data={"text": text, "duration_sec": duration},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _wait_job(client, envelope, job_id: str, timeout: float = POLL_TIMEOUT_SEC) -> dict[str, Any]:
    deadline = time.time() + timeout
    last: dict[str, Any] = {}
    while time.time() < deadline:
        last = envelope(client.get(f"/api/jobs/{job_id}"))
        if last["status"] in TERMINAL:
            return last
        time.sleep(0.05)
    raise AssertionError(f"任务 {job_id} 未在 {timeout}s 内进入终态，最后状态：{last!r}")


@pytest.fixture(autouse=True)
def _排空批改队列(client, envelope):
    """用例结束时等 worker 空闲：排队任务会把批改结果写进下一个用例刚清空的库。"""
    yield
    deadline = time.time() + POLL_TIMEOUT_SEC
    while time.time() < deadline:
        active = envelope(client.get("/api/jobs", params={"status": "active"}))["items"]
        if not active:
            return
        time.sleep(0.05)
    raise AssertionError(f"批改 worker 未在 {POLL_TIMEOUT_SEC}s 内排空：{active!r}")


# ---------------------------------------------------------------------------
# AC-S7.1 话题
# ---------------------------------------------------------------------------

def test_AC_S7_1_话题至少六个且每个都带足量预置追问(client, envelope, content_floors):
    items = _topics(client, envelope)
    assert len(items) >= 6, f"陪练话题至少 6 个（当前 {len(items)}）：离线整场都靠预置追问"
    required = {"id", "title_zh", "topic", "scenario_zh", "level", "target_band", "turns", "preset_count"}
    for item in items:
        missing = required - set(item)
        assert not missing, f"话题 {item.get('id')} 缺字段 {missing}"
        assert item["preset_count"] >= 6, f"话题 {item['id']} 预置追问不足 6 条（{item['preset_count']}）"
        assert 8 <= item["turns"] <= 12, f"话题 {item['id']} 轮次上限越界：{item['turns']}"
    assert {item["level"] for item in items} <= {"a2", "b1", "b2"}


def test_AC_S7_1_话题详情回全文且含开场白与预置追问(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    doc = envelope(client.get(f"/api/sparring/topics/{topic_id}"))
    assert doc["id"] == topic_id
    assert doc["opening"].strip(), "开场白不能为空（陪练官的第一句）"
    assert len(doc["preset_questions"]) >= 6
    assert all(q.strip().endswith(("?", ".")) for q in doc["preset_questions"])


def test_AC_S7_1_未知话题404且detail是中文(client, error_body):
    body = error_body(client.get("/api/sparring/topics/no_such_topic"), status=404)
    assert body["code"] == "not_found"
    assert "陪练话题" in body["detail"]


def test_AS_S7_2_按level过滤且非法level返回400中文(client, envelope, error_body):
    a2 = envelope(client.get("/api/sparring/topics", params={"level": "a2"}))["items"]
    assert a2, "至少要有一个 a2 话题"
    assert all(item["level"] == "a2" for item in a2)
    body = error_body(client.get("/api/sparring/topics", params={"level": "c9"}), status=400)
    assert body["code"] == "validation_failed"
    assert "a2" in body["detail"]


# ---------------------------------------------------------------------------
# AC-S7.2 会话
# ---------------------------------------------------------------------------

def test_AC_S7_2_建会话回开场白与轮次上限(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    assert started["session_id"].startswith("spa_")
    assert started["state"] == "created"
    assert started["turn_index"] == 0
    assert 8 <= started["max_turns"] <= 12
    assert started["opening"].strip()
    assert len(started["messages"]) == 1
    assert started["messages"][0]["role"] == "partner"
    assert started["messages"][0]["source"] == "opening"


def test_AC_S7_2_建会话缺topic_id返回400(client, error_body):
    body = error_body(client.post("/api/sparring/sessions", json={}), status=400)
    assert "topic_id" in body["detail"]


def test_AC_S7_2_会话不存在404(client, error_body):
    body = error_body(client.get("/api/sparring/sessions/spa_nope"), status=404)
    assert body["code"] == "not_found"


def test_AC_S7_2_读会话能把整段对话接回(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    _turn(client, envelope, sid, "I usually study in the library after lunch.")
    view = envelope(client.get(f"/api/sparring/sessions/{sid}"))
    roles = [item["role"] for item in view["messages"]]
    assert roles == ["partner", "user", "partner"], f"对话结构应为 陪练官/我/陪练官，实际 {roles}"
    assert view["turn_index"] == 1
    assert view["remaining"] == view["max_turns"] - 1
    assert view["state"] == "in_progress"


# ---------------------------------------------------------------------------
# AC-S7.3 追问
# ---------------------------------------------------------------------------

def test_AC_S7_3b_离线回落预置追问且逐条不重复(client, envelope):
    """离线整场都靠预置问句，而且**不能把同一句念两遍**（那会让用户以为程序卡住）。"""
    topic_id = _topics(client, envelope)[0]["id"]
    doc = envelope(client.get(f"/api/sparring/topics/{topic_id}"))
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]

    replies: list[str] = []
    for index in range(5):
        turn = _turn(client, envelope, sid, f"answer number {index}")
        assert turn["partner"]["source"] == "fallback", "测试环境 IELTS_ONLINE=0，追问必须走预置"
        assert turn["degraded_reason"] == "offline_template"
        replies.append(turn["partner"]["text"])

    assert len(set(replies)) == len(replies), f"预置追问被重复使用：{replies}"
    assert set(replies) <= set(doc["preset_questions"]), "回落的问句必须来自该话题的预置清单"


def test_AC_S7_3c_我的作答原样进对话流(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    answer = "  I would like the lamb, please.  "
    turn = _turn(client, envelope, sid, answer)
    assert turn["transcript"] == answer.strip()
    view = envelope(client.get(f"/api/sparring/sessions/{sid}"))
    user_texts = [item["text"] for item in view["messages"] if item["role"] == "user"]
    assert user_texts == [answer.strip()]


def test_AC_S7_3_AI可用时追问来自模型并带上一句上下文(client, envelope, ai_client, monkeypatch):
    """AI 可用时 `source="ai"`，且 prompt 里真的带着考生最后一句（否则「陪练」退化成念题库）。

    这里**直接调服务层**并显式 `allow_network=True`：整会话 `IELTS_ONLINE=0`（CONSTITUTION §6），
    走 API 只能测到离线回落；出站许可那个判定点本身由 §15.2 的用例钉住。
    """
    from app.services import sparring

    _, fake = ai_client
    fake.queue(json.dumps({"reply": "You said the library gets crowded — when do you usually go there?"}))
    topic_id = _topics(client, envelope)[0]["id"]
    doc = envelope(client.get(f"/api/sparring/topics/{topic_id}"))
    answer = "The library is really crowded at noon, so I prefer the morning."

    reply = sparring.next_reply(
        doc,
        history=[("partner", doc["opening"]), ("user", answer)],
        last_user=answer,
        asked=[],
        allow_network=True,
    )
    assert reply["source"] == "ai", reply
    assert reply["degraded_reason"] is None
    assert "crowded" in reply["text"]
    prompt = fake.last_call["messages"][-1]["content"]
    assert answer in prompt, "追问 prompt 必须包含考生最后一句（§16.3 第 2 条）"
    assert fake.last_call["max_tokens"] == 1500, "陪练追问的 max_tokens 应为 1500（§3-P 预算纪律）"
    assert float(fake.last_call["temperature"]) <= 0.3


def test_AC_S7_3_模型重复上一句时按无效输出回落(client, envelope, ai_client):
    """模型念回上一句 → 判 `invalid_model_output` 并回落预置，不许照发（同样直调服务层）。"""
    from app.services import sparring

    _, fake = ai_client
    topic_id = _topics(client, envelope)[0]["id"]
    doc = envelope(client.get(f"/api/sparring/topics/{topic_id}"))
    first_preset = doc["preset_questions"][0]
    fake.queue(json.dumps({"reply": first_preset}), json.dumps({"reply": first_preset}))

    reply = sparring.next_reply(
        doc,
        history=[("partner", doc["opening"]), ("user", "some answer")],
        last_user="some answer",
        asked=[first_preset],
        allow_network=True,
    )
    assert reply["source"] == "fallback", "重复的问句不许当成有效 AI 追问"
    assert reply["degraded_reason"] == "invalid_model_output"
    assert reply["text"] != first_preset


def test_AC_S7_3_模型重复更早的问题也按无效输出回落(client, envelope, ai_client):
    """3 轮之后再念回第 1 轮，用户一样觉得「它卡住了」—— 去重范围是全部已问过，不是仅相邻一句。"""
    from app.services import sparring

    _, fake = ai_client
    topic_id = _topics(client, envelope)[0]["id"]
    doc = envelope(client.get(f"/api/sparring/topics/{topic_id}"))
    first_preset = doc["preset_questions"][0]
    later_preset = doc["preset_questions"][2]
    fake.queue(json.dumps({"reply": first_preset}), json.dumps({"reply": first_preset}))

    reply = sparring.next_reply(
        doc,
        history=[("partner", doc["opening"]), ("user", "some answer")],
        last_user="some answer",
        asked=[first_preset, later_preset],
        allow_network=True,
    )
    assert reply["source"] == "fallback", "念回更早问过的问题同样是重复"
    assert reply["degraded_reason"] == "invalid_model_output"


def test_AC_S7_3_AI问过的句子会进已问集合_避免下一轮撞预置(client, envelope, ai_client):
    """把 AI 追问记进 `used_presets`：否则模型第 3 轮会把预置清单第 1 句原样问一遍，
    而界面显示的是「AI 追问」，用户只读到一句重复。"""
    from app.services import sparring

    _, fake = ai_client
    topic_id = _topics(client, envelope)[0]["id"]
    doc = envelope(client.get(f"/api/sparring/topics/{topic_id}"))
    started = _start(client, envelope, topic_id, level="b1")
    sid = started["session_id"]
    ai_reply = "You mentioned a quiet corner — would a quieter table still work for you?"

    fake.queue(json.dumps({"reply": ai_reply}))
    # 第一轮就走 AI 路径（服务层直调，理由同上一个用例）
    reply = sparring.next_reply(
        doc,
        history=[("partner", doc["opening"])],
        last_user="I would like the quiet corner.",
        asked=[],
        allow_network=True,
    )
    assert reply["source"] == "ai"

    # 之后离线回落时，这条 AI 问句必须算「已经出现过」，不会再被念一遍
    doc_with_ai = {**doc, "preset_questions": [ai_reply, *doc["preset_questions"][1:]]}
    fallback = sparring.next_reply(
        doc_with_ai,
        history=[("partner", doc["opening"]), ("user", "x"), ("partner", ai_reply), ("user", "y")],
        last_user="y",
        asked=[ai_reply],
        allow_network=False,
    )
    assert fallback["source"] == "fallback"
    assert fallback["text"] != ai_reply, "AI 已经问过的那句不许再作为预置回落念一遍"


def test_AC_S7_3_只剩一个预置时用过一次就回固定收尾句(client, envelope):
    """预置问句用尽 → `preset_exhausted` + 固定收尾句，而不是无限重念最后一条。"""
    from app.services import sparring

    topic_id = _topics(client, envelope)[0]["id"]
    doc = dict(envelope(client.get(f"/api/sparring/topics/{topic_id}")))
    doc["preset_questions"] = ["Only one follow-up question?"]
    reply = sparring.next_reply(
        doc,
        history=[],
        last_user="answer",
        asked=["Only one follow-up question?"],
        allow_network=False,
    )
    assert reply["text"] == sparring.EXHAUSTED_REPLY
    assert reply["degraded_reason"] == "preset_exhausted"


def test_AC_S7_3a_既无音频也无文本时400(client, envelope, error_body):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    response = client.post(f"/api/sparring/sessions/{started['session_id']}/turn", data={})
    body = error_body(response, status=400)
    assert body["code"] == "empty_answer"
    assert any("\u4e00" <= ch <= "\u9fff" for ch in body["detail"])


def test_AC_S7_3a_音频过大413(client, envelope, error_body):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    big = b"\x1a\x45\xdf\xa3" + b"0" * (6 * 1024 * 1024)
    response = client.post(
        f"/api/sparring/sessions/{started['session_id']}/turn",
        files={"audio": ("speech.webm", big, "audio/webm")},
    )
    body = error_body(response, status=413)
    assert body["code"] == "payload_too_large"


# ---------------------------------------------------------------------------
# AC-S7.4 轮次上限
# ---------------------------------------------------------------------------

def test_AC_S7_4_到达上限后作答返回409且状态是awaiting_assess(client, envelope, error_body):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    max_turns = started["max_turns"]

    last: dict[str, Any] = {}
    for index in range(max_turns):
        last = _turn(client, envelope, sid, f"answer {index}")
        assert last["remaining"] == max_turns - index - 1
    assert last["state"] == "awaiting_assess"
    assert last["remaining"] == 0

    body = error_body(client.post(f"/api/sparring/sessions/{sid}/turn", data={"text": "one more"}), status=409)
    assert body["code"] == "conflict"
    assert "上限" in body["detail"]

    view = envelope(client.get(f"/api/sparring/sessions/{sid}"))
    assert view["state"] == "awaiting_assess", "被拒的作答不许把会话状态写坏"
    assert view["turn_index"] == max_turns


# ---------------------------------------------------------------------------
# AC-S7.5 评分
# ---------------------------------------------------------------------------

def test_AC_S7_5a_报告与题库口语同形状并带sparring块(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    for index in range(3):
        _turn(client, envelope, sid, f"I think cooking at home saves money and it is relaxing, answer {index}.")

    report = envelope(client.post(f"/api/sparring/sessions/{sid}/assess"))
    required = {
        "attempt_id", "band", "evidence", "strengths", "improvements",
        "model_answer", "upgrade_vocabulary", "metrics", "pronunciation_detail",
        "ai_used", "degraded_reason", "approximate", "sparring",
    }
    missing = required - set(report)
    assert not missing, f"陪练报告缺字段 {missing}（§16.4：必须与 §3-S 同形状）"
    band = report["band"]
    assert set(band) >= {"overall", "fluency_coherence", "lexical_resource",
                         "grammatical_range_accuracy", "pronunciation"}
    assert 0.0 <= float(band["overall"]) <= 9.0
    assert report["sparring"] == {"topic_id": topic_id, "turns": 3, "mode": "sparring"}
    assert len(report["improvements"]) >= 3, "FR-S5：改进建议至少 3 条"


def test_AC_S7_5b_离线仍产出完整报告且降级可见(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    _turn(client, envelope, sid, "Honestly I prefer mornings because the library is quiet then.")
    report = envelope(client.post(f"/api/sparring/sessions/{sid}/assess"))
    assert report["ai_used"] is False, "IELTS_ONLINE=0 时不许假装是 AI 评分"
    assert report["approximate"] is True
    assert report["degraded_reason"] == "offline_template"
    assert report["band"]["overall"] is not None, "离线也要给近似分，而不是空报告"


def test_AC_S7_5a_评分落库一条part为sparring的记录(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    _turn(client, envelope, sid, "I usually go to the gym three times a week.")
    report = envelope(client.post(f"/api/sparring/sessions/{sid}/assess"))

    listed = envelope(client.get("/api/attempts", params={"module": "speaking"}))
    assert listed["total"] == 1, f"陪练评分应落 1 条 attempt（AC-G2）：{listed}"
    row = listed["items"][0]
    assert row["part"] == "sparring"
    assert row["task_ref"] == topic_id
    assert row["id"] == report["attempt_id"]

    detail = envelope(client.get(f"/api/attempts/{report['attempt_id']}"))
    assert detail["attempt"]["id"] == report["attempt_id"]
    assert detail["payload"]["sparring"]["mode"] == "sparring"


def test_AC_S7_5c_没有作答就评分返回400empty_answer(client, envelope, error_body):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    body = error_body(client.post(f"/api/sparring/sessions/{started['session_id']}/assess"), status=400)
    assert body["code"] == "empty_answer"
    assert "作答" in body["detail"]


def test_AC_S7_5c_异步端点排队后报告与同步同形状(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    _turn(client, envelope, sid, "I would rather take the train because it is cheaper.")

    job = envelope(client.post(f"/api/sparring/sessions/{sid}/assess/async"))
    assert job["status"] in ("queued", "running"), f"新任务应未完成：{job['status']!r}"
    assert job["module"] == "speaking"
    assert job["task_ref"] == sid

    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "succeeded", f"批改失败：{done['error']!r}"
    report = done["report"]
    assert report["attempt_id"] == done["attempt_id"]
    assert report["sparring"]["topic_id"] == topic_id
    assert 0.0 <= float(report["band"]["overall"]) <= 9.0


def test_AC_S7_5c_重复排队复用同一任务(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    _turn(client, envelope, sid, "I think practice matters more than talent.")

    first = envelope(client.post(f"/api/sparring/sessions/{sid}/assess/async"))
    second = envelope(client.post(f"/api/sparring/sessions/{sid}/assess/async"))
    assert second["job_id"] == first["job_id"], "连点两次评分不该产出两份报告（§10.6 条款 4）"
    _wait_job(client, envelope, first["job_id"])
    assert envelope(client.get("/api/attempts", params={"module": "speaking"}))["total"] == 1


def test_AC_S7_5_会话评分后拒绝再作答(client, envelope, error_body):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    _turn(client, envelope, sid, "A short answer.")
    envelope(client.post(f"/api/sparring/sessions/{sid}/assess"))
    body = error_body(client.post(f"/api/sparring/sessions/{sid}/turn", data={"text": "after assess"}), status=409)
    assert body["code"] == "conflict"


def test_AC_S7_5_读会话时已评分的结果回填(client, envelope):
    topic_id = _topics(client, envelope)[0]["id"]
    started = _start(client, envelope, topic_id)
    sid = started["session_id"]
    _turn(client, envelope, sid, "I enjoy reading before bed.")
    report = envelope(client.post(f"/api/sparring/sessions/{sid}/assess"))
    view = envelope(client.get(f"/api/sparring/sessions/{sid}"))
    assert view["state"] == "assessed"
    assert view["result"]["attempt_id"] == report["attempt_id"]
