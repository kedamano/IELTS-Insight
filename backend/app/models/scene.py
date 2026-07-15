from pydantic import BaseModel
from typing import Optional


class WordItem(BaseModel):
    """单词级数据：用于热力图评分和单词弹窗"""
    word: str
    phonetic: str = ""
    zh: str = ""
    difficulty: int = 1  # 1-5


class DialogueItem(BaseModel):
    seq: int
    speaker: str
    role: str
    en: str
    zh: str
    keywords: list[str] = []
    tips: Optional[str] = None
    words: list[WordItem] = []  # v1.1 新增：逐词音素数据


class Scene(BaseModel):
    id: str
    title: str
    difficulty: int = 1
    category: str = "daily"
    is_free: bool = True
    dialogues: list[DialogueItem]
    cultural_notes: str = ""


class SceneListItem(BaseModel):
    id: str
    title: str
    difficulty: int
    category: str
    is_free: bool
    dialogue_count: int
