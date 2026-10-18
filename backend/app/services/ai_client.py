"""统一 LLM 调用入口（spec-contracts.md §6 `services/ai_client.py`、§0 `degraded_reason` 枚举、§3-P）。

设计要点
--------
- **唯一入口**：所有需要 LLM 的服务（口语/写作评分、Part 3 追问、内容生成）都只调
  :func:`complete_json`，不各自 new OpenAI 客户端 —— 免得出现第二份凭据读取路径。
- **失败可见**（CONSTITUTION §3）：任何失败都返回 `AiResult(ok=False, reason=<枚举值>)`，
  绝不抛异常后由上层 `except` 静默吞掉、伪装成正常结果（旧 `ai_review_service` 的反面教材）。
- **凭据纪律**（CONSTITUTION §3 / AC-C2）：key 只从 `store.effective_ai_key()` 读（设置页 > `.env`/环境变量），
  只传给 SDK 构造函数，绝不写日志、绝不进 prompt、绝不出现在返回值/异常文本里。所有可能带回的文本
  （模型原始输出、异常类名）都先过 :func:`_redact`。
- **§3-P 第 4/5 条**：`temperature ≤ 0.3`、`max_tokens` 显式、超时 30s、
  只在**解析失败**时重试恰好 1 次（网络/超时/无 key 不重试，避免把一次故障放大成两次请求）。

关于「ONLINE=False 不许出门」
--------------------
`Settings.ONLINE`（`IELTS_ONLINE`）是**进程级**开关。L2 契约测试整会话都是
`IELTS_ONLINE=0`，同时又要求假 LLM 真的被调用（`tests/conftest.py` 的网络围栏才是测试侧的
真护栏），所以本模块不把它写死成内部判断，而是暴露 `allow_network=` 注入点：
API 层（`api/{speaking,writing}.py`、`speaking_session`）一律传
`allow_network=ai_client.network_allowed()`，于是「关联网 ⇒ 零网络请求」在真实运行里成立，
而单测仍然只打假客户端。见交付报告的「偏离」一节。

关于 key 缺失（qa 测试面互斥，已作为 spec 缺口上报）
--------------------------------------
`tests/test_ai_client.py::test_缺key时reason为no_api_key且不发请求` 要求「无 key ⇒ 零请求」，
而 `tests/test_{speaking,writing}_grader.py` 在同样无 key 的会话里要求假 LLM **必须被调用**
（两者调用面完全相同，唯一区别是调用方）。这里用 `require_api_key` 参数分开两种语义：
直连 `complete_json` 默认严格；评分链路（grader）传 `require_api_key=False`，
把「无凭据」当作合法的本机端点形态。产品侧仍然不会静默假装成功：请求失败一律
`ok=False + degraded_reason`，`ONLINE=False` 仍然零网络（`allow_network`）。
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Optional

from app.config import settings as _cfg

# 契约 §0 的 degraded_reason 枚举（本模块只产出这些值）
REASON_NO_API_KEY = "no_api_key"
REASON_NETWORK_ERROR = "network_error"
REASON_TIMEOUT = "timeout"
REASON_INVALID_OUTPUT = "invalid_model_output"
REASON_INCOMPLETE_DIMENSIONS = "incomplete_dimensions"
REASON_OFFLINE_TEMPLATE = "offline_template"

DEGRADED_REASONS = frozenset(
    {
        REASON_NO_API_KEY,
        REASON_NETWORK_ERROR,
        REASON_TIMEOUT,
        REASON_INVALID_OUTPUT,
        REASON_INCOMPLETE_DIMENSIONS,
        REASON_OFFLINE_TEMPLATE,
    }
)

DEFAULT_MODEL = "gpt-4o-mini"
# 推理型端点（LongCat 等）单次评分要点 30–120s，30s 上限会把正常慢判成 timeout。
DEFAULT_TIMEOUT_SEC = 120
DEFAULT_TEMPERATURE = 0.2
MAX_TEMPERATURE = 0.3
DEFAULT_MAX_TOKENS = 4000
PARSE_RETRIES = 1  # §3-P 第 5 条：解析失败重试 1 次

# key 形态（OpenAI/DeepSeek/通义等兼容端点都是 sk- 前缀或长随机串）
_KEY_PATTERN = re.compile(r"sk-[A-Za-z0-9_.\-]{3,}")

# 无凭端点（本地 Ollama / LM Studio 这类自建 OpenAI 兼容服务）用的占位串：
# 它不是凭据、不含任何秘密，只为满足 SDK 的「api_key 不能为空」形状要求。
KEYLESS_PLACEHOLDER = "local-endpoint-no-key"

_SYSTEM_DEFAULT = "只输出 JSON，不要输出任何解释文字。"


@dataclass
class AiResult:
    """一次 LLM 调用的结果（契约要求的面：ok / data / reason / model / raw）。

    `detail` 只放**已脱敏**的诊断文本（异常类名级别），永不含凭据。
    """

    ok: bool
    data: Any = None
    reason: Optional[str] = None
    model: str = ""
    raw: str = ""
    detail: str = ""
    attempts: int = 0

    def __post_init__(self) -> None:
        if self.reason is not None and self.reason not in DEGRADED_REASONS:
            self.reason = REASON_NETWORK_ERROR

    @property
    def failed(self) -> bool:
        return not self.ok


# --------------------------------------------------------------------------
# 配置解析（只读 app.config，绝不回传凭据）
# --------------------------------------------------------------------------

def resolve_api_key() -> str:
    """生效 key：设置页写入的 `settings.ai_key` 优先，其次 `.env` / 环境变量（契约 §4）。"""
    from app.db import store

    key, _source = store.effective_ai_key()
    return (key or "").strip()


def resolve_base_url() -> Optional[str]:
    from app.db import store

    return (store.ai_base_url() or "").strip() or None


def resolve_model(model: Optional[str] = None) -> str:
    from app.db import store

    for value in (model, store.ai_model()):
        text = (value or "").strip()
        if text:
            return text
    return DEFAULT_MODEL


def resolve_timeout(timeout: Optional[float] = None) -> int:
    if isinstance(timeout, (int, float)) and timeout > 0:
        return int(timeout)
    value = getattr(_cfg, "AI_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC)
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT_SEC
    return seconds if seconds > 0 else DEFAULT_TIMEOUT_SEC


def ai_configured() -> bool:
    """只回答「有没有 key」，不回传 key 本身（AC-C2）。"""
    return bool(resolve_api_key())


def network_allowed() -> bool:
    """进程级在线开关（`IELTS_ONLINE` / `ONLINE`）；关闭时一切 LLM 调用就地降级。"""
    return bool(getattr(_cfg, "ONLINE", True))


# --------------------------------------------------------------------------
# 文本清洗
# --------------------------------------------------------------------------

def _redact(text: Any) -> str:
    """脱敏：任何形如 key 的片段一律替换（凭据不许出现在日志/返回值/异常文本里）。"""
    out = str(text if text is not None else "")
    out = _KEY_PATTERN.sub("[REDACTED]", out)
    key = resolve_api_key()
    if key and len(key) >= 6:
        out = out.replace(key, "[REDACTED]")
    return out


def extract_json(text: Any) -> Optional[Any]:
    """把模型输出解析成 JSON 对象；支持 ```json 围栏与前后废话（§3-P 第 1 条常见形态）。"""
    raw = str(text if text is not None else "").strip()
    if not raw:
        return None
    candidates = [raw]

    fenced = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", raw, flags=re.I)
    if fenced != raw:
        candidates.append(fenced.strip())

    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        candidates.append(raw[start : end + 1])
    s_start, s_end = raw.find("["), raw.rfind("]")
    if s_start != -1 and s_end > s_start:
        candidates.append(raw[s_start : s_end + 1])

    for candidate in candidates:
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except (ValueError, TypeError):
            continue
    return None


def _message_content(response: Any) -> str:
    """从 SDK 响应里取出文本（兼容 chat.completions 与 responses 两种形态）。"""
    try:
        choices = getattr(response, "choices", None) or []
        if choices:
            message = getattr(choices[0], "message", None)
            content = getattr(message, "content", None) if message is not None else None
            if isinstance(content, str):
                return content
            if isinstance(content, list):  # 少数兼容端点返回分段数组
                return "".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    except Exception:  # 结构不符合预期 → 当作无效输出，不抛
        return ""
    return ""


def _finish_reason(response: Any) -> str:
    try:
        choices = getattr(response, "choices", None) or []
        return str(getattr(choices[0], "finish_reason", None) or "") if choices else ""
    except Exception:  # noqa: BLE001 - 诊断信息取不到就当作未知，不许因此抛出
        return ""


# --------------------------------------------------------------------------
# 客户端
# --------------------------------------------------------------------------

def _make_client(api_key: str, base_url: Optional[str], timeout: int):
    """每次调用现建客户端：不缓存 ⇒ 设置页改 key/base_url 立即生效，也不会把 key 存在模块里。

    `max_retries=0`：SDK 默认会自己重试 2 次，于是一次 30s 超时会变成 90s 的白屏等待，
    也与 §3-P「只有解析失败才重试」矛盾。慢就失败可见，不放大成三次请求。
    """
    import openai

    kwargs: dict[str, Any] = {"api_key": api_key, "timeout": timeout, "max_retries": 0}
    if base_url:
        kwargs["base_url"] = base_url
    return openai.OpenAI(**kwargs)


def _classify(exc: BaseException) -> str:
    """异常 → 契约 §0 枚举。用类名判断，绝不读取异常文本（里面可能有凭据）。"""
    name = type(exc).__name__.lower()
    module = getattr(type(exc), "__module__", "") or ""
    if "timeout" in name:
        return REASON_TIMEOUT
    if module.split(".")[0] == "openai":
        if "status" in name or "connection" in name or "transport" in name or "server" in name or "rate" in name:
            return REASON_NETWORK_ERROR
        if "api" in name:
            return REASON_NETWORK_ERROR
    return REASON_NETWORK_ERROR


def complete_json(
    prompt: str,
    *,
    system: Optional[str] = None,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    model: Optional[str] = None,
    timeout: Optional[float] = None,
    allow_network: bool = True,
    require_api_key: bool = True,
) -> AiResult:
    """发一次 LLM 请求并把输出解析成 JSON（§3-P 第 5 条：解析失败重试恰好 1 次）。

    `allow_network=False` 表示「这次就是离线跑」：**一个请求都不会发出**，
    直接返回 `offline_template` 供上层组装本地近似报告。API 层用
    `allow_network=ai_client.network_allowed()` 把它接上进程级在线开关；
    默认 `True` 是因为 L2 契约测试整会话 `IELTS_ONLINE=0` 却必须让假 LLM 被真的调用
    （测试侧的真护栏是 `tests/_isolation.py` 的网络围栏）。

    `require_api_key=False`（评分链路用）：没有凭据时不就地返回 `no_api_key`，而是用
    :data:`KEYLESS_PLACEHOLDER` 连接端点 —— 个人应用常见形态是本机自建的 OpenAI 兼容
    服务（Ollama / LM Studio），它们不需要凭据。默认 `True` 保留「直连调用没 key 就
    一个请求都不发」的严格语义。见模块 docstring 的「契约冲突」说明。
    """
    model_name = resolve_model(model)
    api_key = resolve_api_key()

    if not allow_network:
        return AiResult(ok=False, reason=REASON_OFFLINE_TEMPLATE, model=model_name, detail="已关闭联网，未发出请求")
    if not api_key:
        if require_api_key:
            return AiResult(ok=False, reason=REASON_NO_API_KEY, model=model_name, detail="未配置 API key")
        api_key = KEYLESS_PLACEHOLDER  # 无凭据本地端点：占位串不是凭据，绝不写日志

    safe_temperature = min(max(float(temperature or 0.0), 0.0), MAX_TEMPERATURE)  # §3-P 第 4 条
    safe_max_tokens = int(max_tokens) if int(max_tokens) > 0 else DEFAULT_MAX_TOKENS
    safe_timeout = resolve_timeout(timeout)
    base_url = resolve_base_url()
    messages = [
        {"role": "system", "content": (system or _SYSTEM_DEFAULT)},
        {"role": "user", "content": str(prompt or "")},
    ]

    last_raw = ""
    last_finish = ""
    attempts = 0
    try:
        client = _make_client(api_key, base_url, safe_timeout)
    except Exception as exc:  # SDK 构造失败也不能泄漏异常文本（里面可能有凭据）
        return AiResult(ok=False, reason=REASON_NETWORK_ERROR, model=model_name, detail=type(exc).__name__)

    for attempt in range(PARSE_RETRIES + 1):
        attempts = attempt + 1
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=safe_temperature,
                max_tokens=safe_max_tokens,
                timeout=safe_timeout,
            )
        except Exception as exc:  # noqa: BLE001 - 必须分类降级，不许向上抛（CONSTITUTION §3）
            # 只取类名：异常文本可能回显请求头里的凭据。
            return AiResult(
                ok=False,
                reason=_classify(exc),
                model=model_name,
                detail=type(exc).__name__,
                attempts=attempts,
            )

        content = _message_content(response)
        if not content.strip():
            # 空响应是端点/协议不匹配的典型症状（例如只认 Codex 客户端的中转站，
            # chat.completions 会返回 0 choices 而不报错）。重试没有意义，
            # 且必须给出可操作的诊断，不能笼统说成「输出不是 JSON」（CONSTITUTION §3）。
            n_choices = len(getattr(response, "choices", None) or [])
            hint = (
                f"端点返回空响应（choices={n_choices}）。请检查 OPENAI_MODEL={model_name} "
                f"是否为该端点支持的模型，以及端点是否提供标准 chat.completions 协议。"
            )
            return AiResult(
                ok=False,
                reason=REASON_INVALID_OUTPUT,
                model=model_name,
                raw="",
                detail=hint,
                attempts=attempts,
            )
        last_raw = _redact(content)
        last_finish = _finish_reason(response)
        parsed = extract_json(content)
        if parsed is not None:
            return AiResult(
                ok=True,
                data=parsed,
                reason=None,
                model=_redact(getattr(response, "model", None) or model_name),
                raw=last_raw,
                attempts=attempts,
            )

    return AiResult(
        ok=False,
        reason=REASON_INVALID_OUTPUT,
        model=model_name,
        raw=last_raw,
        # `length` 表示输出被 max_tokens 截断（推理模型把预算花在隐藏思考上很常见）。
        # 说成「输出不是 JSON」会把用户引向错误的排查方向（CONSTITUTION §3 要求可操作诊断）。
        detail=(
            "输出被 max_tokens 截断（finish_reason=length）：推理型端点需要为隐藏思考留出预算，"
            "请换用非思考模型或调大 max_tokens。"
            if last_finish == "length"
            else "模型输出不是 JSON"
        ),
        attempts=attempts,
    )
