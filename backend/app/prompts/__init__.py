"""LLM prompt 模板（spec-contracts.md §3-P / §6 `prompts/{speaking,writing}.py`）。

每个模板必须满足 §3-P 五条：
1. 要求**只输出 JSON**，并给出严格 schema 与 band 取值范围 0–9、步长 0.5；
2. 强制 `quote` 是考生原文的**连续片段**（后端会校验 `quote in transcript`，不合法的条目丢弃并计 invalid_quotes）；
3. 中文解释字段一律命名 `*_zh`（`explanation_zh` / `note_zh` / `issue_zh`），英文引用保持原文；
4. 调用参数 `temperature ≤ 0.3`（默认 TEMPERATURE = 0.2）、`max_tokens` 显式设置、超时 30s；
5. 解析失败重试 1 次，仍失败交给 `offline_feedback` 做本地近似并标 `degraded_reason`。

凭据纪律（CONSTITUTION §3）：模板里不出现任何 key / base_url / Authorization 文本，
密钥只在 `app.services.ai_client` 内部注入 SDK 客户端，绝不进 prompt、日志或返回值。

官方 Band Descriptors 只**表述能力**，不逐字搬运（CONSTITUTION §2）。
"""
from __future__ import annotations

from app.prompts import speaking as speaking_prompts
from app.prompts import writing as writing_prompts

# §3-P 第 4 条：temperature ≤ 0.3
TEMPERATURE = 0.2
# §3-P 第 4 条：max_tokens 显式设置。
# 预算必须**远大于**答案本身：推理型端点（LongCat、o 系列、DeepSeek-R 等）把 max_tokens
# 当作「思考 + 作答」的总上限，预算给小了会全程用在做 reasoning 上、`content` 返回空串，
# 于是评分被误判成 `invalid_model_output`（实测：900 时 content 为空，4000 时 12s 出结果）。
SPEAKING_MAX_TOKENS = 7000
WRITING_MAX_TOKENS = 8000
FOLLOWUP_MAX_TOKENS = 3000

JSON_ONLY = "只输出 JSON 对象本身：不要 markdown 之外的说明文字，不要输出任何解释。"

BAND_SCALE = "band 一律 0–9，步长 0.5（半步档，例如 5.5、6.0、6.5），不得出现 6.3 或 12 这类值。"

ZH_FIELDS = "中文说明字段命名 *_zh（explanation_zh / note_zh / issue_zh / why_zh），英文引用字段保持考生原文。"

QUOTES = "所有 quote 必须是考生原文中的连续片段，逐字照抄（后端会校验 quote in transcript，不符的条目会被丢弃）。"

__all__ = [
    "TEMPERATURE",
    "SPEAKING_MAX_TOKENS",
    "WRITING_MAX_TOKENS",
    "FOLLOWUP_MAX_TOKENS",
    "JSON_ONLY",
    "BAND_SCALE",
    "ZH_FIELDS",
    "QUOTES",
    "speaking_prompts",
    "writing_prompts",
]
