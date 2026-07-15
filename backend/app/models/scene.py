from pydantic import BaseModel
from typing import Optional


class DialogueItem(BaseModel):
    seq: int
    speaker: str
    role: str
    en: str
    zh: str
    keywords: list[str] = []
    tips: Optional[str] = None


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
