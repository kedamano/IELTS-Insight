"""错题管理 ORM — v1.1 新增

按 v1.1 设计文档第 8.5 节：
- 自动归档：每次评分后音素错误自动记录
- 分类统计：按音素类型分组
- 掌握标准：同一音素连续 3 次 80+ 分 → 从错题本移除
- 定期复习：累计 5 条错题时推送
"""

from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class WrongRecord(BaseModel):
    """错题记录"""
    id: Optional[int] = None
    scene_id: str
    sentence_seq: int
    word: str
    phonetic_expected: str = ""    # 标准音素
    phonetic_actual: str = ""      # 用户实际发音（Whisper 转写）
    error_type: str = ""           # 错误分类：辅音错误/元音错误/连读问题/弱读缺失/重音错误/语调问题
    score: float = 0               # 该词得分 0-100
    mastered: bool = False         # 是否已掌握
    consecutive_pass: int = 0      # 连续通过次数
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class WrongRecordList(BaseModel):
    """错题列表响应"""
    data: list[WrongRecord]
    total: int


class WrongStats(BaseModel):
    """错题统计"""
    total_wrong: int               # 总错题数
    active_wrong: int              # 未掌握的错题数
    mastered: int                  # 已掌握的错题数
    top_phonemes: list[dict]       # Top 错误音素 [{phoneme, count}]


SQL_CREATE_WRONG_RECORDS = """
CREATE TABLE IF NOT EXISTS wrong_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id TEXT NOT NULL,
    sentence_seq INTEGER NOT NULL,
    word TEXT NOT NULL,
    phonetic_expected TEXT DEFAULT '',
    phonetic_actual TEXT DEFAULT '',
    error_type TEXT DEFAULT '',
    score REAL DEFAULT 0,
    mastered INTEGER DEFAULT 0,
    consecutive_pass INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""
