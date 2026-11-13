"""L3 API 契约：题库生成端点（spec-contracts.md §17；§1 行 40–41）。

覆盖：
- AC-CT-1 提交即返回 JobView；廉价校验就地拒绝（module/count/band 形状、离线 ⇒ 503）；
- AC-CT-2 mock LLM 全链路：合格产物落 generated 根、job succeeded、重启装载读得到；
- AC-CT-3 坏输出（schema 不合格）⇒ rejected；全部失败 ⇒ failed + 中文 error；
- AC-CT-4 hand 保护：同 id 是手工题时拒绝覆盖（rejected 里说清原因）；
- AC-CT-5 版权硬闸：产出含禁用来源词即拒绝（CONSTITUTION §2）；
- AC-CT-6 去重复用（§10.6 条款 4 同规则）；GET /content/jobs/{id} 与 GET /jobs/{id} 同形状。

纪律：LLM 全 mock（fake_openai），产物写**本用例专属的 tmp 数据目录**
（monkeypatch DB_PATH → generated_root 跟着派生，§17.1；CONSTITUTION §6），
绝不写仓库题库目录或用户数据目录。
"""
from __future__ import annotations

import json
import time
from typing import Any

import pytest

TERMINAL = ("succeeded", "failed")
POLL_TIMEOUT_SEC = 20.0


def good_sparring(set_id: str = "sb_shopping_11", **over: Any) -> dict:
    """过 §16.1 校验的合格 sparring 话题（内存样本，不依赖仓库内容）。"""
    doc = {
        "id": set_id,
        "module": "sparring",
        "kind": "practice",
        "target_band": 6.0,
        "title_zh": "超市购物",
        "topic": "shopping",
        "level": "a2",
        "scenario_zh": "你在超市找收银台，店员会指路并问你有没有会员卡。",
        "opening": "Hi there, you look a bit lost — are you looking for something in particular?",
        "preset_questions": [
            "Do you usually bring your own bags?",
            "Would you like help finding an item?",
            "Do you have a membership card with us?",
            "Will that be cash or card today?",
            "Would you like a receipt in the bag?",
            "Is there anything else I can help you with?",
        ],
        "max_turns": 10,
        "partner_voice": "en-GB-SoniaNeural",
    }
    doc.update(over)
    return doc


def _online(monkeypatch):
    """把「生效在线许可」打开（整会话 IELTS_ONLINE=0，判定点被显式抬起才走 AI 路径）。

    提交端点与 runner 都经 `ai_client.network_allowed()`，patch 一处两边同效 ——
    这正是 §15.2「唯一判定点」的红利：测试能整体开关闸门而不是逐点 stub。
    """
    from app.services import ai_client

    monkeypatch.setattr(ai_client, "network_allowed", lambda: True, raising=True)
    return ai_client


def _own_data_dir(monkeypatch, tmp_path):
    """把 DB 路径指到本用例专属目录：generated_root 由它派生（§17.1），产物不漏进仓库。"""
    from app.config import settings as cfg
    from app.db import store

    db = tmp_path / "app.db"
    monkeypatch.setattr(cfg, "DB_PATH", str(db), raising=True)
    store.reset_schema_state()
    return db


def _wait_job(client, envelope, job_id: str, timeout: float = POLL_TIMEOUT_SEC) -> dict[str, Any]:
    deadline = time.time() + timeout
    last: dict[str, Any] = {}
    while time.time() < deadline:
        last = envelope(client.get(f"/api/content/jobs/{job_id}"))
        if last["status"] in TERMINAL:
            return last
        time.sleep(0.05)
    raise AssertionError(f"任务 {job_id} 未在 {timeout}s 内进入终态，最后状态：{last!r}")


def _active_jobs(client, envelope) -> list:
    return envelope(client.get("/api/jobs", params={"status": "active"}))["items"]


def _max_tokens_seen(fake_openai) -> int:
    """从假 LLM 的调用记录里取 max_tokens（断言生成预算真的按模块放大）。"""
    assert fake_openai.calls, "假 LLM 未被调用"
    return int(fake_openai.calls[-1].get("max_tokens") or 0)


@pytest.fixture(autouse=True)
def _排空生成队列(client, envelope):
    """用例结束时等 worker 空闲：残留任务会把文件写进下一个用例刚换掉的 tmp 目录。"""
    yield
    deadline = time.time() + POLL_TIMEOUT_SEC
    while time.time() < deadline:
        if not _active_jobs(client, envelope):
            return
        time.sleep(0.05)
    raise AssertionError(f"worker 未在 {POLL_TIMEOUT_SEC}s 内排空")


# ---------------------------------------------------------------------------
# AC-CT-1 提交与廉价校验
# ---------------------------------------------------------------------------

def test_AC_CT_1_离线时提交被当场503拒绝而不是排队后失败(client, envelope):
    """§17.2：用户关着在线却排上一个两分钟后才失败的任务，等于把「你关掉了它」伪装成上游坏了。"""
    response = client.post("/api/content/generate", json={"module": "sparring", "count": 1})
    assert response.status_code == 503, response.text
    body = response.json()
    assert body["code"] == "content_offline"
    assert "联网" in body["detail"]
    assert _active_jobs(client, envelope) == [], "离线提交不该产生任务"


@pytest.mark.parametrize("payload,needle", [
    ({"module": "cooking"}, "module"),
    ({"module": "sparring", "count": 0}, "count"),
    ({"module": "sparring", "count": 99}, "count"),
    ({"module": "sparring", "target_band": 6.3}, "target_band"),
    ({"module": "speaking", "part": 7}, "part"),
])
def test_AC_CT_1_形状错误就地400(client, payload, needle):
    """§10.6 条款 1：这些错误必须在 HTTP 响应里当场给出，不许推迟到队列里。"""
    response = client.post("/api/content/generate", json=payload)
    assert response.status_code == 400, response.text
    body = response.json()
    assert body["code"] == "validation_failed"
    assert needle in body["detail"], f"detail 应指出 {needle}：{body['detail']}"


def test_AC_CT_1_在线提交返回JobView且module为content(client, envelope, monkeypatch, fake_openai):
    _online(monkeypatch)
    fake_openai.queue(json.dumps(good_sparring()))
    body = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    missing = {"job_id", "status", "module", "task_ref", "attempt_id", "report", "error"} - set(body)
    assert not missing, f"响应缺字段 {missing}"
    assert body["module"] == "content"
    assert body["task_ref"] == "sparring"
    assert body["status"] in ("queued", "running")


# ---------------------------------------------------------------------------
# AC-CT-2 全链路：产物落 generated 根 + 重启装载
# ---------------------------------------------------------------------------

def test_AC_CT_2_合格产物写入generated根且重启装载读得到(client, envelope, monkeypatch, fake_openai, tmp_path):
    from app.services import sets_loader

    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    fake_openai.queue(json.dumps(good_sparring()))

    job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "succeeded", f"生成失败：{done['error']!r}"
    report = done["report"]
    assert report["written"] == 1, report
    assert report["generated"][0]["id"] == "sb_shopping_11"

    # 产物在 generated 根（§17.1），**不在**仓库题库目录
    path = sets_loader.generated_root() / "sparring" / "sb_shopping_11.json"
    assert path.is_file(), f"产物没写到生成根：{path}"
    record = json.loads(path.read_text(encoding="utf-8"))
    assert record["source"].startswith("ai:"), "生成产物必须记录 ai:<model> 来源（CONSTITUTION §2 可追溯）"
    assert record["generated_at"].endswith("Z")

    # 「重启应用后生效」是真的：装载扫两个根，产物进 sets 表
    load_report = sets_loader.load_sets()
    assert load_report["loaded"] >= 53, f"生成题未被装载：{load_report['loaded']}"
    stored = sets_loader.store.get_set("sb_shopping_11")
    assert stored and stored["source"].startswith("ai:")


def test_AC_CT_2_prompt含LEGAL硬约束与schema(client, envelope, monkeypatch, fake_openai, tmp_path):
    """提示词纪律（§17.2）：LEGAL 段与 schema 必须真的发给模型，而不是只写在文档里。"""
    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    fake_openai.queue(json.dumps(good_sparring()))
    job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    _wait_job(client, envelope, job["job_id"])
    prompt = fake_openai.last_call["messages"][-1]["content"]
    assert "100% original text" in prompt, "LEGAL 段缺失 = 版权防线只剩事后扫描"
    assert "Cambridge IELTS" in prompt  # LEGAL 段里明令禁止的字样本身在
    assert "sb_<topic>_<nn>" in prompt, "schema 段缺失 = 模型不知道要输出什么形状"
    assert float(fake_openai.last_call["temperature"]) <= 0.3
    assert fake_openai.last_call["max_tokens"], "max_tokens 必须显式（§3-P 第 4 条）"


# ---------------------------------------------------------------------------
# AC-CT-3 坏输出
# ---------------------------------------------------------------------------

def test_AC_CT_3_不合格输出进rejected不入库(client, envelope, monkeypatch, fake_openai, tmp_path):
    from app.services import sets_loader

    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    broken = good_sparring(id="sb_bad_12", preset_questions=["only one question?"])
    fake_openai.queue(json.dumps(broken))

    job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    done = _wait_job(client, envelope, job["job_id"])
    # 全部失败 = failed（§17.3 条款 4：一题没成不是「部分成功」）
    assert done["status"] == "failed", done
    assert done["error"], "failed 必须带可读原因"
    assert not (sets_loader.generated_root() / "sparring" / "sb_bad_12.json").exists(), "不合格产物不许落盘"


def test_AC_CT_3_部分成功是succeeded且rejected带中文原因(client, envelope, monkeypatch, fake_openai, tmp_path):
    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    fake_openai.queue(
        json.dumps(good_sparring()),
        json.dumps(good_sparring(id="sb_bad_12", level="c1")),
    )
    job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 2}))
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "succeeded", done
    report = done["report"]
    assert report["written"] == 1 and report["requested"] == 2
    assert report["rejected"] and report["rejected"][0]["id"] == "sb_bad_12"
    assert any("level" in r for r in report["rejected"][0]["reasons"]), report["rejected"]


def test_AC_CT_3_上游失败不崩且failed原因可读(client, envelope, monkeypatch, fake_openai, tmp_path):
    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    fake_openai.queue(RuntimeError("upstream exploded"))
    job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "failed"
    detail = done["error"] or ""
    assert "upstream exploded" not in detail, "原始异常文本不许透传（CONSTITUTION §3）"
    assert any("\u4e00" <= ch <= "\u9fff" for ch in detail), f"error 应为中文可读：{detail!r}"


# ---------------------------------------------------------------------------
# AC-CT-4 hand 保护
# ---------------------------------------------------------------------------

def test_AC_CT_4_同id手工题永不覆盖(client, envelope, monkeypatch, fake_openai, tmp_path):
    from app.services import sets_loader

    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    # 先在生成根放一份 hand 文件（模拟「用户手工放进去的同 id 内容」）
    hand_path = sets_loader.generated_root() / "sparring" / "sb_shopping_11.json"
    hand_path.parent.mkdir(parents=True, exist_ok=True)
    hand = good_sparring(title_zh="手工版")
    hand["source"] = "hand"
    hand_path.write_text(json.dumps(hand, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    fake_openai.queue(json.dumps(good_sparring(title_zh="生成版")))
    job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "failed", "唯一候选被 hand 保护拒绝 = 一题没成"
    kept = json.loads(hand_path.read_text(encoding="utf-8"))
    assert kept["title_zh"] == "手工版" and kept["source"] == "hand", "hand 内容被覆盖了"


# ---------------------------------------------------------------------------
# AC-CT-5 版权硬闸
# ---------------------------------------------------------------------------

def test_AC_CT_5_产出含来源标记即拒绝(client, envelope, monkeypatch, fake_openai, tmp_path):
    """提示词里的 LEGAL 是第一道防线；这里是第二道——模型不听话时**不入库**。"""
    from app.services import sets_loader

    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    dirty = good_sparring(scenario_zh="改编自剑桥雅思 14 测试 1 的收银场景。")
    fake_openai.queue(json.dumps(dirty))
    job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "failed"
    assert not (sets_loader.generated_root() / "sparring" / "sb_shopping_11.json").exists()


# ---------------------------------------------------------------------------
# AC-CT-6 去重与查询面
# ---------------------------------------------------------------------------

def test_AC_CT_6_同参数连点两次复用同一任务(client, envelope, monkeypatch, fake_openai, tmp_path):
    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    fake_openai.queue(json.dumps(good_sparring()), json.dumps(good_sparring()))
    first = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1, "target_band": 6.0}))
    second = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1, "target_band": 6.0}))
    assert second["job_id"] == first["job_id"], "连点两次不该排两份生成任务（§10.6 条款 4）"
    _wait_job(client, envelope, first["job_id"])


def test_AC_CT_6_content别名与通用jobs端点同形状(client, envelope, monkeypatch, fake_openai, tmp_path):
    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    fake_openai.queue(json.dumps(good_sparring()))
    job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    _wait_job(client, envelope, job["job_id"])
    via_alias = envelope(client.get(f"/api/content/jobs/{job['job_id']}"))
    via_generic = envelope(client.get(f"/api/jobs/{job['job_id']}"))
    assert via_alias == via_generic, "两个查询口必须同形状（§1 行 41）"
    missing = {"job_id", "status", "module", "task_ref", "report", "error", "degraded_reason"} - set(via_alias)
    assert not missing, f"JobView 缺字段 {missing}"


def test_AC_CT_6_未知任务404中文(client, error_body):
    body = error_body(client.get("/api/content/jobs/job_nope"), status=404)
    assert body["code"] == "not_found"
    assert "生成任务" in body["detail"]


# ---------------------------------------------------------------------------
# §17.2 生成预算：重 schema（listening/reading）需要给推理型端点留出思考预算
# ---------------------------------------------------------------------------

def test_重schema的生成预算大于轻schema(client, envelope, monkeypatch, fake_openai, tmp_path):
    """推理型端点（gemini 等）把隐藏思考也算进 max_tokens：8000 的预算会被思考吃光，
    产出 finish_reason=length 的半截 JSON → 整批 rejected（实测 §17.5 同款）。
    重 schema（listening 20 题 / reading 13 题+900 词）必须给更大的预算。
    """
    from app.services import content_gen

    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)

    fake_openai.queue(json.dumps(good_sparring()))
    light_job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    _wait_job(client, envelope, light_job["job_id"])
    light = _max_tokens_seen(fake_openai)
    assert light == content_gen.MAX_TOKENS, f"轻 schema 预算应为 {content_gen.MAX_TOKENS}，实际 {light}"

    heavy = content_gen.max_tokens_for("listening")
    assert heavy > light, f"listening 的生成预算应大于 sparring：{heavy} <= {light}"


def test_生成全部失败时report含rejected原因(client, envelope, monkeypatch, fake_openai, tmp_path):
    """§17.3 条款 4：全部失败 = failed + 可读 error，且 rejected 逐条带原因。

    `report` 必须落库 —— 否则界面只能显示「没有生成出任何合格的题目」，
    看不到「为什么不合格」（实测：listening 候选被拒时用户无从下手）。
    """
    from app.services import content_gen

    _own_data_dir(monkeypatch, tmp_path)
    _online(monkeypatch)
    # 一个必然被拒的候选：缺 answer（判分必需）
    bad = good_sparring()
    bad["preset_questions"] = ["not a question"]  # 非问句 → 校验拒收
    fake_openai.queue(json.dumps(bad))

    job = envelope(client.post("/api/content/generate", json={"module": "sparring", "count": 1}))
    done = _wait_job(client, envelope, job["job_id"])
    assert done["status"] == "failed", done
    report = done.get("report")
    assert isinstance(report, dict), f"失败任务的 report 应落库（含 rejected 原因），实际 {report!r}"
    rejected = report.get("rejected") or []
    assert rejected, "report 里应列出被拒候选"
    assert any("preset_questions" in str(r) or "问句" in str(r) for r in rejected[0].get("reasons", [])), rejected
