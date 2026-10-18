"""L2 AI 契约：统一 LLM 调用层（spec-contracts.md §6 services/ai_client.py、§0 degraded_reason 枚举、§3-P）。

覆盖 AC：CONSTITUTION §3（AI 失败不许静默吞掉，必须带 ai_used=false + degraded_reason）、
        AC-S4/AC-W3 的降级来源、AC-C2/CONSTITUTION §3「凭据绝不写日志、绝不出现在返回值或错误文本里」、
        §3-P 第 4/5 条（temperature ≤0.3、max_tokens 显式、超时默认 120s、解析失败重试 1 次）。
        所有 openai SDK 调用都被 fake_openai 替身接管，网络围栏保证没有任何真实连接。

契约要求的符号（spec §6 给模块名；下面是 qa 固定的调用面，T8 若要改名请先改 spec-contracts.md §6）：
    app.services.ai_client.complete_json(prompt, *, system=None, temperature=0.2, max_tokens=1200)
        -> result，result 至少提供：
           .ok: bool                     成功且解析出 JSON
           .data: Any | None             解析后的对象
           .reason: str | None           失败原因，取契约 §0 的 degraded_reason 枚举
           .model: str                   实际使用的模型名
           .raw: str                     原始文本（供 grader 二次解析/校验）
"""
from __future__ import annotations

import httpx
import pytest

FAKE_KEY = "sk-TESTSECRET-0123456789abcdef"
DEGRADED_REASONS = {
    "no_api_key",
    "network_error",
    "timeout",
    "invalid_model_output",
    "incomplete_dimensions",
    "offline_template",
}


@pytest.fixture
def client_api(ai_client):
    mod, fake = ai_client

    def complete(prompt: str, **kwargs):
        fn = getattr(mod, "complete_json", None)  # 占位物 → 测试体内 RED（等待实现）
        assert callable(fn), "RED（等待实现）：app.services.ai_client 没有 complete_json()"
        return fn(prompt, **kwargs)

    return mod, complete, fake


def _key_env(monkeypatch, mod, value: str | None) -> None:
    """把 key 塞进实现可能读取的所有来源（env / settings / 模块常量）。"""
    import os

    monkeypatch.setenv("OPENAI_API_KEY", value or "")
    for attr in ("API_KEY", "OPENAI_API_KEY", "_API_KEY"):
        if hasattr(mod, attr):
            monkeypatch.setattr(mod, attr, value, raising=False)
    from app.config import settings

    if hasattr(settings, "OPENAI_API_KEY"):
        monkeypatch.setattr(settings, "OPENAI_API_KEY", value or "", raising=True)
    assert os.environ["OPENAI_API_KEY"] == (value or "")


# --------------------------------------------------------------------------
# 失败可见（CONSTITUTION §3）
# --------------------------------------------------------------------------
def test_缺key时reason为no_api_key且不发请求(client_api, monkeypatch):
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, None)

    result = complete("say something")
    assert result.ok is False, "没有 key 却报成功 —— 就是把失败伪装成正常结果（CONSTITUTION §3 反面教材）"
    assert result.reason == "no_api_key", f"degraded_reason 必须是枚举值 no_api_key，实际 {result.reason!r}"
    assert fake.calls == [], "没有 key 时不该发出任何 LLM 请求"


def test_超时映射为timeout(client_api, monkeypatch):
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue(openai_timeout_error())

    result = complete("say something")
    assert result.ok is False
    assert result.reason == "timeout", f"超时必须是 timeout（§0 枚举），实际 {result.reason!r}"


def test_HTTP5xx映射为network_error(client_api, monkeypatch):
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue(status_error(500))

    result = complete("say something")
    assert result.ok is False
    assert result.reason == "network_error", f"5xx 必须是 network_error，实际 {result.reason!r}"


@pytest.mark.parametrize("status", [401, 404, 429])
def test_其它HTTP错误也必须可见(client_api, monkeypatch, status):
    """不允许把 4xx 当成功；reason 必须落在 §0 枚举里。"""
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue(status_error(status))

    result = complete("say something")
    assert result.ok is False
    assert result.reason in DEGRADED_REASONS, f"reason={result.reason!r} 不在契约枚举内"


def test_异常文本绝不包含api_key(client_api, monkeypatch):
    """CONSTITUTION §3 / AC-C2：key 绝不出现在返回值、异常文本或日志里。"""
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue(status_error(500))

    result = complete("say something")
    for blob in (
        str(result),
        repr(result),
        str(result.reason),
        str(getattr(result, "raw", "")),
        str(getattr(result, "error", "")),
        str(getattr(result, "detail", "")),
    ):
        assert FAKE_KEY not in blob, "API key 泄漏到结果文本里"
        assert "sk-" not in blob, f"疑似 key 片段泄漏：{blob[:200]!r}"


def test_抛出的异常也不带key(client_api, monkeypatch):
    """实现若选择向上抛（而不是返回 ok=False），异常文本同样不许含 key。"""
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue(RuntimeError(f"upstream rejected {FAKE_KEY}"))

    try:
        result = complete("say something")
    except Exception as exc:  # noqa: BLE001 - 这里就是要捕获实现的异常文本
        assert FAKE_KEY not in str(exc), f"异常文本泄漏 key：{exc}"
        return
    assert FAKE_KEY not in str(result)


# --------------------------------------------------------------------------
# 重试与解析（§3-P 第 5 条：解析失败重试 1 次）
# --------------------------------------------------------------------------
def test_非法JSON重试一次后成功(client_api, monkeypatch):
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue("not json at all", '{"band": {"overall": 6.5}}')

    result = complete("say something")
    assert len(fake.calls) == 2, f"§3-P 要求重试恰好 1 次，实际请求 {len(fake.calls)} 次"
    assert result.ok is True, f"第二次是合法 JSON，应当成功：{result.reason}"
    assert result.data["band"]["overall"] == 6.5


def test_两次都非法则invalid_model_output且只请求2次(client_api, monkeypatch):
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue("oops", "still not json")

    result = complete("say something")
    assert len(fake.calls) == 2, f"重试次数应为 1（共 2 次请求），实际 {len(fake.calls)}"
    assert result.ok is False
    assert result.reason == "invalid_model_output"


def test_输出被截断时诊断必须指出预算不足(client_api, monkeypatch):
    """实测缺陷（LongCat 推理模型）：`max_tokens` 被隐藏思考吃满 → `finish_reason=length` →
    JSON 残缺。此时报「模型输出不是 JSON」会把用户引向错误的排查方向，
    必须给出可调的动作（CONSTITUTION §3：降级要可见且可操作）。"""
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)

    half_json = '{"band": {"overall": 6.5'
    fake.queue((half_json, "length"), (half_json, "length"))

    result = complete("say something")
    assert result.ok is False
    assert result.reason == "invalid_model_output", f"截断仍属无效输出，reason 应为枚举值，实际 {result.reason!r}"
    assert "截断" in (result.detail or ""), f"detail 应指出 max_tokens 截断，实际 {result.detail!r}"


def test_被markdown围栏包裹的JSON仍要能解析(client_api, monkeypatch):
    """模型常见输出形态：```json ... ```；直接判失败会白白降级。"""
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue('```json\n{"band": {"overall": 7.0}}\n```')

    result = complete("say something")
    assert result.ok is True, f"围栏 JSON 应被剥掉后解析成功，实际 reason={result.reason}"
    assert result.data["band"]["overall"] == 7.0


# --------------------------------------------------------------------------
# 配置来源与调用参数（§3-P 第 4 条）
# --------------------------------------------------------------------------
def test_model来自配置(client_api, monkeypatch):
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    from app.config import settings

    monkeypatch.setattr(settings, "OPENAI_MODEL", "glm-test-model", raising=False)
    fake.queue('{"ok": true}')

    result = complete("say something")
    assert fake.last_call.get("model") == "glm-test-model", f"model 未取配置：{fake.last_call}"
    assert result.model == "glm-test-model"


def test_base_url来自配置(client_api, monkeypatch):
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    from app.config import settings

    monkeypatch.setattr(settings, "OPENAI_BASE_URL", "https://api.example.test/v1", raising=False)
    fake.queue('{"ok": true}')
    complete("say something")

    ctor = getattr(fake, "ctor_kwargs", {})
    assert str(ctor.get("base_url", "")).startswith("https://api.example.test"), (
        f"OpenAI 客户端未按配置建 base_url：{ctor}"
    )


@pytest.mark.parametrize("temperature", [0.0, 0.2, 0.3])
def test_契约要求temperature不超过03(client_api, monkeypatch, temperature):
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue('{"ok": true}')
    complete("say something", temperature=temperature)
    assert float(fake.last_call.get("temperature", 99)) <= 0.3, "§3-P 第 4 条：temperature ≤ 0.3"


def test_必须显式传max_tokens与timeout(client_api, monkeypatch):
    mod, complete, fake = client_api
    _key_env(monkeypatch, mod, FAKE_KEY)
    fake.queue('{"ok": true}')
    complete("say something", max_tokens=900)

    call = fake.last_call
    assert call.get("max_tokens"), f"§3-P 第 4 条：max_tokens 必须显式设置，实际 {call}"
    timeout = call.get("timeout") or getattr(fake, "ctor_kwargs", {}).get("timeout")
    assert timeout == pytest.approx(120, abs=1), f"§3-P 第 4 条：超时默认 120s，实际 {timeout}"


def test_测试期间没有任何真实网络主机被访问():
    import _isolation

    assert _isolation.blocked_hosts() == set(), f"网络围栏挡到了外部主机：{_isolation.blocked_hosts()}"


# --------------------------------------------------------------------------
# 替身辅助
# --------------------------------------------------------------------------
def openai_timeout_error():
    import openai

    return openai.APITimeoutError(httpx.Request("POST", "https://api.example.test/v1/chat/completions"))


def status_error(status: int):
    import openai

    request = httpx.Request("POST", "https://api.example.test/v1/chat/completions")
    response = httpx.Response(status, request=request, text="upstream failure")
    return openai.APIStatusError(f"upstream {status}", response=response, body=None)
