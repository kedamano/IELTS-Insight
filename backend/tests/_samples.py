"""契约形状的测试样本（spec-contracts.md §2/§3）—— 全部在内存里，不依赖 backend/app/data/ielts 是否就绪。

用途：L1/L2 纯函数与 grader 测试用这些样本喂实现；L3 端点测试用真实内容（缺失时明确报 RED）。
"""
from __future__ import annotations

from typing import Any


def speaking_set(set_id: str = "sp_p2_environment_01", **over: Any) -> dict:
    doc = {
        "id": set_id,
        "module": "speaking",
        "kind": "practice",
        "target_band": 6.5,
        "title_zh": "环境类话题",
        "topic": "environment",
        "source": "ai:glm-4.6",
        "generated_at": "2026-10-17T00:00:00Z",
        "part1": [
            {"id": "q1", "question": "Do you work or are you a student?"},
            {"id": "q2", "question": "What do you like about your studies?"},
            {"id": "q3", "question": "Is there anything you would change?"},
        ],
        "part2": {
            "cue_card": {
                "prompt": "Describe a skill you would like to learn.",
                "bullets": ["what it is", "why you want to learn it", "how you would learn it"],
                "preparation_sec": 60,
                "speaking_sec": 120,
            }
        },
        "part3": [
            {
                "id": "q1",
                "question": "Why do some people learn faster than others?",
                "depends_on_part2": True,
            },
            {"id": "q2", "question": "Should schools teach more practical skills?"},
            {"id": "q3", "question": "Does technology change how people learn?"},
        ],
        "fallback_questions": ["What did you enjoy as a child?", "Do you prefer studying alone?"],
        "examiner_voice": "en-GB-SoniaNeural",
    }
    doc.update(over)
    return doc


def listening_set(set_id: str = "li_s2_travel_03", **over: Any) -> dict:
    doc = {
        "id": set_id,
        "module": "listening",
        "kind": "practice",
        "section": 2,
        "target_band": 6.5,
        "title_zh": "旅行信息",
        "topic": "travel",
        "source": "ai:glm-4.6",
        "generated_at": "2026-10-17T00:00:00Z",
        "instruction_zh": "听录音，完成 11–20 题，每空不超过 TWO WORDS AND/OR A NUMBER。",
        "audio_text": "The museum opens at 9:30 every day except Monday.",
        "sentences": [
            {"idx": 0, "text": "The museum opens at 9:30.", "anchor_sec": 12.0},
            {"idx": 1, "text": "Tickets cost 5 pounds for students.", "anchor_sec": 18.5},
        ],
        "questions": [
            {
                "id": "q1",
                "type": "gap_fill",
                "number": 11,
                "prompt": "The museum opens at ______.",
                "word_limit": 3,
                "answer": "9:30",
                "accepted_alternatives": ["nine thirty", "9.30"],
                "explanation_zh": "原文直接给出开馆时间。",
            },
            {
                "id": "q2",
                "type": "gap_fill",
                "number": 12,
                "prompt": "Students pay ______.",
                "word_limit": 3,
                "answer": "5 pounds",
                "accepted_alternatives": ["five pounds"],
                "explanation_zh": "数字加单位。",
            },
            {
                "id": "q3",
                "type": "multiple_choice",
                "number": 13,
                "prompt": "Why did the man call?",
                "options": ["A. To book a ticket", "B. To ask about opening hours", "C. To cancel a visit"],
                "answer": "B",
                "explanation_zh": "他询问开放时间。",
            },
            {
                "id": "q4",
                "type": "matching",
                "number": 14,
                "prompt": "Match each person to an activity.",
                "options_list": ["A. guided tour", "B. audio guide", "C. workshop"],
                "answer": "C",
                "explanation_zh": "选项可重复使用。",
            },
            {
                "id": "q5",
                "type": "map_diagram_label",
                "number": 15,
                "prompt": "Where is the entrance?",
                "labels": ["A", "B", "C"],
                "answer": "A",
                "explanation_zh": "地图标签。",
            },
        ],
    }
    doc.update(over)
    return doc


def reading_set(set_id: str = "re_h_urban_02", **over: Any) -> dict:
    doc = {
        "id": set_id,
        "module": "reading",
        "kind": "practice",
        "level": "upper-intermediate",
        "target_band": 6.5,
        "title": "The Twelve-Minute City",
        "title_zh": "十二分钟城市",
        "time_limit_sec": 1200,
        "word_count": 874,
        "source": "ai:glm-4.6",
        "generated_at": "2026-10-17T00:00:00Z",
        "passage": {
            "paragraphs": [
                {"label": "A", "text": "Urban planners now measure access in minutes, not miles."},
                {"label": "B", "text": "Density is the single variable that predicts walking distance."},
            ]
        },
        "questions": [
            {
                "id": "q1",
                "type": "true_false_notgiven",
                "number": 1,
                "statement": "Planners still measure access mainly in miles.",
                "answer": "NOTGIVEN",
                "answer_label": "C",
                "answer_paragraph": "B",
                "answer_quote": "Density is the single variable",
                "explanation_zh": "文中未提及「主要度量单位」，只说用分钟衡量可达性。",
            },
            {
                "id": "q2",
                "type": "heading_match",
                "number": 2,
                "paragraph_label": "B",
                "options_headings": [
                    {"i": "i", "text": "A historical view"},
                    {"i": "ii", "text": "Why density matters"},
                ],
                "answer": "ii",
                "explanation_zh": "B 段讨论密度。",
            },
            {
                "id": "q3",
                "type": "sentence_completion",
                "number": 3,
                "prompt": "The ___ of the city predicts walking distance.",
                "word_limit": 2,
                "answer": "density",
                "accepted_alternatives": [],
                "explanation_zh": "同位改写。",
            },
            {
                "id": "q4",
                "type": "multiple_choice",
                "number": 4,
                "prompt": "What do planners optimise first?",
                "options": ["A. Roads", "B. Access time", "C. Building height"],
                "answer": "B",
                "explanation_zh": "细节题。",
            },
            {
                "id": "q5",
                "type": "gap_fill",
                "number": 5,
                "prompt": "Neighbourhood shops shorten the ___ of trips.",
                "word_limit": 2,
                "answer": "length",
                "accepted_alternatives": ["distance"],
                "explanation_zh": "词数限制内。",
            },
        ],
    }
    doc.update(over)
    return doc


def writing_task1(task_id: str = "w1_line_energy_04", **over: Any) -> dict:
    doc = {
        "id": task_id,
        "module": "writing",
        "kind": "practice",
        "task": "task1",
        "time_recommend_sec": 1200,
        "min_words": 150,
        "prompt": "The chart below shows coal consumption. Summarise the information by selecting and reporting the main features.",
        "chart": {
            "type": "line",
            "unit": "million tonnes",
            "years": [2000, 2010, 2020],
            "series": [
                {"name": "Coal", "values": [120, 98, 64]},
                {"name": "Gas", "values": [30, 55, 71]},
            ],
            "source_note": "Data generated for practice",
        },
        "band_descriptors_ref": "task1",
        "source": "ai:glm-4.6",
        "generated_at": "2026-10-17T00:00:00Z",
    }
    doc.update(over)
    return doc


def writing_task2(task_id: str = "w2_agree_remote_01", **over: Any) -> dict:
    doc = {
        "id": task_id,
        "module": "writing",
        "kind": "practice",
        "task": "task2",
        "time_recommend_sec": 2400,
        "min_words": 250,
        "question_type": "agree_disagree",
        "prompt": "Some people think working from home is better for employees. To what extent do you agree or disagree?",
        "outline_hint": ["Introduction with position", "Body 1", "Body 2", "Conclusion"],
        "source": "ai:glm-4.6",
        "generated_at": "2026-10-17T00:00:00Z",
    }
    doc.update(over)
    return doc


# --------------------------------------------------------------------------
# 固定 LLM 返回（契约 §3-P：只输出 JSON）
# --------------------------------------------------------------------------
def speaking_llm_payload(**over: Any) -> dict:
    payload = {
        "band": {
            "fluency_coherence": 6.5,
            "lexical_resource": 6.0,
            "grammatical_range_accuracy": 6.0,
            "pronunciation": 7.0,
        },
        "evidence": [
            {"criterion": "lexical_resource", "quote": "a lot of good things", "why": "用词空泛", "level": "6.0"}
        ],
        "strengths": ["观点展开完整"],
        "improvements": [
            {"issue": "例子太少", "fix": "补一个具体场景", "quote": "I like many things"},
            {"issue": "连接词单一", "fix": "用 however / as a result", "quote": "and and and"},
            {"issue": "时态混用", "fix": "回忆经历用过去时", "quote": "I go there last year"},
        ],
        "model_answer": "A model answer one band higher than the candidate, under 150 words.",
        "upgrade_vocabulary": [{"from": "good", "to": "rewarding", "note_zh": "6.5+ 搭配"}],
    }
    payload.update(over)
    return payload


def writing_llm_payload(**over: Any) -> dict:
    payload = {
        "band": {
            "task_response": 6.0,
            "coherence_cohesion": 6.5,
            "lexical_resource": 6.0,
            "grammatical_range_accuracy": 5.5,
        },
        "corrections": [
            {
                "quote": "people is",
                "error_type": "grammar",
                "explanation_zh": "主谓一致：people 是复数",
                "suggestion": "people are",
                "severity": "high",
            },
            {
                "quote": "very big problem",
                "error_type": "lexical",
                "explanation_zh": "用词口语化",
                "suggestion": "significant problem",
                "severity": "medium",
            },
        ],
        "upgraded_sentences": [
            {"from": "people is", "to": "people are increasingly", "why_zh": "提升准确性与正式度"}
        ],
        "structure_issues": [
            {"kind": "paragraph_function", "issue_zh": "第三段没有回应题目要求", "paragraph_index": 3}
        ],
        "strengths": ["立场清晰"],
        "model_answer": "Model answer placeholder with enough words to satisfy the task requirement.",
        "evidence": [],
    }
    payload.update(over)
    return payload


ESSAY_160_WORDS = (
    "In recent years remote working has become normal for many office employees. "
) * 3  # ~162 词，用于"Task1 达标 / Task2 不达标"这类边界用例的基底
LONG_ENOUGH_SENTENCE = (
    "The chart demonstrates a clear downward trend in coal consumption while gas use rose steadily over the same period. "
)
