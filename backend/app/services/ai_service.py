import os
from openai import OpenAI
from app.config import settings

# OpenAI 兼容客户端（支持 DeepSeek / 通义千问等）
_client = None


def _get_client():
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=settings.OPENAI_API_KEY or "sk-placeholder",
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        )
    return _client


def get_ai_feedback(original: str, user_text: str, word_scores: list[dict]) -> str:
    """
    调用 GPT 分析发音问题，返回中文纠错建议。
    如果 API key 未配置，返回空字符串（前端展示基础评分）。
    """
    if not settings.OPENAI_API_KEY:
        return ""

    # 只分析有问题的单词（减少 token 消耗）
    wrong_words = [w for w in word_scores if w["status"] != "correct"]
    if not wrong_words:
        return "🌟 完美！所有单词发音都正确。"

    prompt = f"""你是一位资深英语口语教练。用户朗读了以下英文句子：
原文：{original}
用户转写：{user_text}
发音有问题的单词：{wrong_words}

请完成：
1. 逐词分析发音错误原因（口型/舌位/气流）
2. 给出具体的改进建议（不超过 100 字）
3. 用中文、语气鼓励、简洁明了

直接输出建议文字，不要 JSON 格式。"""

    try:
        resp = _get_client().chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "你是一位专业的英语口语教练，擅长发音纠错。"},
                {"role": "user", "content": prompt},
            ],
            max_tokens=200,
            temperature=0.7,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        print(f"[AI] GPT feedback failed: {e}")
        return ""
