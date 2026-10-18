"""AI 深度点评服务 — v1.1 新增

按 v1.1 设计文档第 8.4 节：
- 联网时调用 LLM 生成详细点评
- 离线时使用预设模板降级
- 输出：逐词评分 + 错误分类 + 口型建议 + 鼓励文案
"""

import json
from typing import Optional
from app.config import settings

# 中国学生常见音素错误提示模板
PHONEME_TIPS_CN = {
    "/θ/": "舌尖放在上下齿之间，气流从缝隙中挤出，声带不振动",
    "/ð/": "舌尖放在上下齿之间，气流从缝隙中挤出，声带振动",
    "/æ/": "嘴巴张大，舌尖抵住下齿，发出介于'啊'和'哎'之间的音",
    "/ɪ/": "短元音，嘴唇放松微微张开，舌尖抵住下齿，不要读成/i/",
    "/l/": "舌尖抵住上齿龈，气流从舌头两侧流出",
    "/r/": "舌尖卷起但不接触口腔任何部位，嘴唇微微收圆",
    "/ʊ/": "短元音，嘴唇收圆但放松，比/u/更短更轻",
    "/aʊ/": "从/a/滑向/ʊ/，开口度从大到小，注意滑动过程",
    "/ə/": "央元音，口腔最放松，舌头居中，轻轻发出'呃'",
    "/iː/": "长元音，嘴角向两边拉开，舌头前部抬高",
    "/uː/": "长元音，嘴唇收圆收紧，舌头后部抬高",
    "/ɒ/": "短元音，嘴巴张大，嘴唇微微收圆，舌头后部放低",
    "/ɛ/": "短元音，嘴巴微张，舌尖抵住下齿",
}


def generate_offline_review(
    original_text: str,
    user_text: str,
    word_scores: list[dict],
    overall_score: float,
) -> dict:
    """离线降级：使用预设模板生成点评

    Args:
        original_text: 原文
        user_text: 用户转写
        word_scores: 逐词评分 [{word, score, error_type}]
        overall_score: 总分

    Returns:
        {
            "word_scores": [...],
            "overall_tip": str,
            "encouragement": str,
            "source": "offline"
        }
    """
    # 分析主要问题类型
    error_counts = {}
    low_score_words = []
    for ws in word_scores:
        if ws.get("score", 100) < 80:
            low_score_words.append(ws)
            et = ws.get("error_type", "未分类")
            error_counts[et] = error_counts.get(et, 0) + 1

    # 生成逐词 tips
    enriched_word_scores = []
    for ws in word_scores:
        word = ws.get("word", "")
        score = ws.get("score", 100)
        error_type = ws.get("error_type", "")
        tip = ws.get("tip", "")

        # 如果是低分词且没有 tip，尝试生成
        if score < 80 and not tip:
            tip = _generate_word_tip(word, error_type)

        enriched_word_scores.append({
            "word": word,
            "score": score,
            "error_type": error_type,
            "tip": tip,
        })

    # 整体建议
    if not low_score_words:
        overall_tip = "发音整体流畅自然，继续保持！"
    elif len(low_score_words) <= 2:
        issue_words = "、".join([w["word"] for w in low_score_words[:2]])
        overall_tip = f"整体语调上扬自然，重点练习 '{issue_words}' 的发音。"
    else:
        overall_tip = f"共有 {len(low_score_words)} 个词需要改进，建议逐词练习后重新尝试。"

    # 鼓励文案
    if overall_score >= 90:
        encouragement = "太棒了！你的发音接近母语者水平，继续保持！"
    elif overall_score >= 80:
        encouragement = "不错的表现！再注意一下细节就能达到 90+ 了。"
    elif overall_score >= 60:
        encouragement = f"继续加油！重点攻克 {error_counts}，你的进步会很快。"
    else:
        encouragement = "每一步练习都是进步，不要气馁，坚持就是胜利！"

    return {
        "word_scores": enriched_word_scores,
        "overall_tip": overall_tip,
        "encouragement": encouragement,
        "source": "offline",
        # CONSTITUTION §3：降级必须可见，不能伪装成 AI 结果
        "ai_used": False,
        "degraded_reason": "offline_template",
    }


def generate_ai_review(
    original_text: str,
    user_text: str,
    word_scores: list[dict],
    overall_score: float,
) -> dict:
    """AI 深度点评（联网）

    使用 OpenAI 兼容 API 生成详细的发音分析。

    凭据解析顺序（CONSTITUTION §3）：设置页写入 > `.env`。
    之前本文件读 `settings.OPENAI_BASE_URL/OPENAI_MODEL` 而 `config.py` 从未定义它们，
    AttributeError 被下面的 `except` 静默吞掉 → 永远走离线模板；现在 config 定义了这些字段，
    并且失败原因会写进结果的 `degraded_reason`，不再伪装成功。
    """
    from app.db import store

    api_key, _source = store.effective_ai_key()
    if not api_key:
        result = generate_offline_review(original_text, user_text, word_scores, overall_score)
        result["degraded_reason"] = "no_api_key"
        return result

    try:
        import openai

        client = openai.OpenAI(
            api_key=api_key,
            base_url=store.ai_base_url() or None,
            timeout=settings.AI_TIMEOUT_SEC,
        )

        word_scores_str = json.dumps(word_scores, ensure_ascii=False, indent=2)

        prompt = f"""你是一位资深英语口语教练，擅长通过对比分析学习者的发音问题。

【输入信息】
原文：{original_text}
用户转写：{user_text}
逐词评分数据：
{word_scores_str}

【分析要求】
1. 逐词发音对比，标注发音音素差异
2. 问题分类（从以下选择）：辅音错误、元音错误、连读问题、弱读缺失、重音错误、语调问题
3. 给出口型/舌位/气流的具体改进建议
4. 用中文回答，语气鼓励，不超过 150 字

【输出格式】（严格 JSON，不要输出其他内容）
{{
  "word_scores": [
    {{"word": "How", "score": 85, "error_type": "元音错误", "tip": "/aʊ/ 开口度要够大，双唇从张开到收圆"}}
  ],
  "overall_tip": "整体语调上扬自然...",
  "encouragement": "你的语调已经很自然了！..."
}}"""

        response = client.chat.completions.create(
            model=store.ai_model(),
            messages=[
                {"role": "system", "content": "你是英语口语教练。只输出JSON，不输出其他内容。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=800,
            timeout=15,
        )

        content = response.choices[0].message.content.strip()
        # 提取 JSON（可能被 markdown 代码块包裹）
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()

        result = json.loads(content)
        result["source"] = "ai"
        result["ai_used"] = True
        result["degraded_reason"] = None
        result["model"] = store.ai_model()
        return result

    except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
        print(f"[AI Review] 模型输出不可解析，降级为离线模板：{type(exc).__name__}", flush=True)
        result = generate_offline_review(original_text, user_text, word_scores, overall_score)
        result["degraded_reason"] = "invalid_model_output"
        return result

    except Exception as exc:
        # 降级可以，但必须可见（CONSTITUTION §3）。异常文本里绝不包含 key。
        reason = "network_error" if "timeout" not in type(exc).__name__.lower() else "timeout"
        print(f"[AI Review] 降级为离线模板：{type(exc).__name__}: {exc}", flush=True)
        result = generate_offline_review(original_text, user_text, word_scores, overall_score)
        result["degraded_reason"] = reason
        return result


def _generate_word_tip(word: str, error_type: str) -> str:
    """根据错误类型生成文字提示"""
    tips = {
        "辅音错误": f"注意 '{word}' 的辅音发音，检查舌头和气流的配合",
        "元音错误": f"注意 '{word}' 的元音开口度和舌位",
        "连读问题": f"'{word}' 在句中应与前后词连读，不要一字一顿",
        "弱读缺失": f"'{word}' 在句中应弱读，不要重读",
        "重音错误": f"注意 '{word}' 的重音位置",
        "语调问题": f"'{word}' 的语调需要注意升/降",
    }
    return tips.get(error_type, f"注意 '{word}' 的发声位置和气流控制")


def get_phoneme_tip(phoneme: str) -> str:
    """获取特定音素的学习建议"""
    return PHONEME_TIPS_CN.get(phoneme, f"注意 '{phoneme}' 的发声位置和口型")
