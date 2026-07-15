"""学习记录 ORM — v1.1 新增

按 v1.1 设计文档第 12 章：
- 每日学习时长、练习句数、平均得分
- 发音趋势（近 7 天折线图）
- 连续学习天数
- Top3 错误音素
"""

from pydantic import BaseModel
from typing import Optional


class LearningRecord(BaseModel):
    """每日学习记录"""
    id: Optional[int] = None
    date: str                           # YYYY-MM-DD
    duration_minutes: int = 0           # 学习时长（分钟）
    sentences_count: int = 0            # 练习句子数
    avg_score: float = 0                # 平均得分
    top_error_phonemes: str = "[]"      # JSON: [{"phoneme":"/θ/","count":12}, ...]
    created_at: Optional[str] = None


class LearningStats(BaseModel):
    """学习统计数据响应"""
    today: dict                         # 今日统计
    week: dict                          # 本周统计
    trend: list[dict]                   # 近7天得分趋势 [{date, score, sentences}]
    streak: int                         # 连续学习天数
    top_errors: list[dict]              # Top3 错误音素
    grade: dict                         # 当前等级信息
    achievements: list[dict]            # 已获成就列表


SQL_CREATE_LEARNING_RECORDS = """
CREATE TABLE IF NOT EXISTS learning_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    duration_minutes INTEGER DEFAULT 0,
    sentences_count INTEGER DEFAULT 0,
    avg_score REAL DEFAULT 0,
    top_error_phonemes TEXT DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""
