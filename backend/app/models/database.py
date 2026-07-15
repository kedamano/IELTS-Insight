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
        );

        CREATE TABLE IF NOT EXISTS learning_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            duration_minutes INTEGER DEFAULT 0,
            sentences_count INTEGER DEFAULT 0,
            avg_score REAL DEFAULT 0,
            top_error_phonemes TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS wordbook (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL UNIQUE,
            phonetic TEXT DEFAULT '',
            zh TEXT DEFAULT '',
            example TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY DEFAULT 1,
            practice_mode TEXT DEFAULT 'normal',
            shadowing_delay REAL DEFAULT 0.5,
            playback_speed REAL DEFAULT 1.0,
            tts_voice TEXT DEFAULT 'en-US',
            online_enabled INTEGER DEFAULT 1,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        INSERT OR IGNORE INTO settings (id) VALUES (1);
    """)
    conn.commit()
    conn.close()
    print("[SQLite] Database initialized.")
