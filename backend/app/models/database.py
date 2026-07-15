import sqlite3
from pathlib import Path

# 确保父目录 exist
Path("./db").mkdir(exist_ok=True)

def get_db():
    conn = sqlite3.connect("./db/app.db")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS scenes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            difficulty INTEGER DEFAULT 1,
            category TEXT DEFAULT 'daily',
            is_free INTEGER DEFAULT 1,
            dialogues TEXT NOT NULL,
            cultural_notes TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS practice_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scene_id TEXT NOT NULL,
            sentence_seq INTEGER NOT NULL,
            original_text TEXT NOT NULL,
            user_text TEXT,
            pronunciation_score REAL DEFAULT 0,
            fluency_score REAL DEFAULT 0,
            completeness_score REAL DEFAULT 0,
            overall_score REAL DEFAULT 0,
            feedback TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (scene_id) REFERENCES scenes(id)
        );
    """)
    conn.commit()
    conn.close()
    print("[SQLite] Database initialized.")
