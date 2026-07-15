import json
from pathlib import Path
from app.models.database import get_db
from app.models.scene import Scene, SceneListItem, DialogueItem

DATA_DIR = Path(__file__).parent.parent / "data"


def load_scenes_to_db():
    """从 JSON 文件加载场景到 SQLite（幂等）"""
    conn = get_db()
    for json_file in DATA_DIR.glob("scenes_*.json"):
        with open(json_file, "r", encoding="utf-8") as f:
            scenes = json.load(f)
        for s in scenes:
            conn.execute("""
                INSERT OR REPLACE INTO scenes (id, title, difficulty, category, is_free, dialogues, cultural_notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                s["id"], s["title"], s["difficulty"], s["category"],
                int(s["is_free"]), json.dumps(s["dialogues"], ensure_ascii=False),
                s.get("cultural_notes", "")
            ))
    conn.commit()
    conn.close()


def get_scene_list() -> list[SceneListItem]:
    conn = get_db()
    rows = conn.execute("SELECT id, title, difficulty, category, is_free, dialogues FROM scenes").fetchall()
    conn.close()
    return [
        SceneListItem(
            id=r["id"], title=r["title"], difficulty=r["difficulty"],
            category=r["category"], is_free=bool(r["is_free"]),
            dialogue_count=len(json.loads(r["dialogues"]))
        ) for r in rows
    ]


def get_scene_detail(scene_id: str) -> Scene | None:
    conn = get_db()
    row = conn.execute("SELECT * FROM scenes WHERE id = ?", (scene_id,)).fetchone()
    conn.close()
    if not row:
        return None
    dialogues = json.loads(row["dialogues"])
    return Scene(
        id=row["id"], title=row["title"], difficulty=row["difficulty"],
        category=row["category"], is_free=bool(row["is_free"]),
        dialogues=[DialogueItem(**d) for d in dialogues],
        cultural_notes=row["cultural_notes"]
    )
