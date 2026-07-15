# AI 英语学习桌面应用 — 实施计划

> **For Claude:** 可执行任务清单，按顺序逐步推进。
> 目标：M1 MVP — 1 个场景 + TTS + Whisper 转写 + 文本评分 + 基础 UI

**技术栈：** Tauri 2.x + React 19 + Vite + TailwindCSS + FastAPI + edge-tts + Whisper + SQLite

**工作目录：** `D:\work\项目\kecheng`

---

## 任务清单概览

| # | 任务 | 预估 |
|---|------|------|
| 1 | 项目脚手架搭建（含 Tauri sidecar 配置） | 20 min |
| 2 | Python 后端 FastAPI 骨架 | 20 min |
| 3 | 场景数据与 SQLite 存储 | 15 min |
| 4 | TTS 服务集成（批量预生成 + 缓存 + 降级） | 20 min |
| 5 | STT 服务集成（Whisper + 文件类型校验） | 20 min |
| 6 | 基础评分服务（WER 对比 + 长度限制） | 20 min |
| 7 | React 前端脚手架 | 15 min |
| 8 | 后端 API 客户端 | 10 min |
| 9 | 场景列表组件 | 15 min |
| 10 | 对话练习区组件 | 30 min |
| 11 | 评分展示面板 | 20 min |
| 12 | 录音 Hook（修复闭包 Bug） | 15 min |
| 13 | TTS 播放 Hook | 10 min |
| 14 | 组装联调 | 30 min |

---

## Task 1 — 项目脚手架搭建

**目标：** 建立前后端目录结构（含 Tauri sidecar 配置）

```bash
# 创建目录结构
mkdir -p D:\work\项目\kecheng\backend\app\services
mkdir -p D:\work\项目\kecheng\backend\app\models
mkdir -p D:\work\项目\kecheng\backend\app\data
mkdir -p D:\work\项目\kecheng\backend\db
mkdir -p D:\work\项目\kecheng\backend\cache\tts
mkdir -p D:\work\项目\kecheng\frontend\src\components
mkdir -p D:\work\项目\kecheng\frontend\src\hooks
mkdir -p D:\work\项目\kecheng\frontend\src\services
mkdir -p D:\work\项目\kecheng\frontend\src\pages
mkdir -p D:\work\项目\kecheng\frontend\src\types
```

### Tauri Sidecar 配置

创建 `D:\work\项目\kecheng\frontend\src-tauri\tauri.conf.json`（Tauri v2 配置）：

```json
{
  "productName": "AI Language Dialogue",
  "version": "0.1.0",
  "identifier": "com.ailanguage.dialogue",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "bundle": {
    "externalBin": ["python-sidecar"],
    "resources": ["../backend"]
  },
  "app": {
    "windows": [
      {
        "title": "AI Language Dialogue",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": null
    }
  }
}
```

### Sidecar 启动 Python 后端的 Rust Handler

创建 `D:\work\项目\kecheng\frontend\src-tauri\src\main.rs`：

```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 启动 Python FastAPI 后端（sidecar 或子进程）
            // 在 MVP 阶段，开发模式下用户手动启动后端
            // 生产模式通过 tauri_plugin_shell 启动 backend.exe
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 前端 vite.config.ts（生产环境直连后端）

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      }
    }
  }
})
```

> **MVP 简化策略**：前端开发时走 Vite Proxy `/api → :8765`，用户手动启动 Python 后端。Tauri 生产打包后再集成 sidecar 进程管理。这样 Task 1 不需要先跑所有 Tauri 脚手架，先专注功能跑通。

**验证：** `ls` 看到以上目录全部存在 + `tauri.conf.json` 和 `main.rs` 创建成功

**Commit:** `chore: 项目目录结构 + Tauri sidecar 框架`

---

## Task 2 — 后端 FastAPI 骨架

**Files:**
- 创建: `D:\work\项目\kecheng\backend\requirements.txt`
- 创建: `D:\work\项目\kecheng\backend\app\__init__.py`
- 创建: `D:\work\项目\kecheng\backend\app\main.py`
- 创建: `D:\work\项目\kecheng\backend\app\config.py`

**requirements.txt**
```text
fastapi==0.115.0
uvicorn[standard]==0.32.0
edge-tts==7.0.0
openai-whisper==20240930
openai==1.54.0
python-multipart==0.0.17
pydantic==2.9.0
pydantic-settings==2.6.0
```

**app/__init__.py**
```python
# 空文件
```

**app/config.py**
```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "AI Language Dialogue"
    DEBUG: bool = True
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8765
    TTS_CACHE_DIR: str = "./cache/tts"
    DB_PATH: str = "./db/app.db"
    OPENAI_API_KEY: str = ""
    WHISPER_MODEL: str = "base"
    WHISPER_DEVICE: str = "cpu"
    MAX_AUDIO_DURATION: int = 30

    class Config:
        env_file = ".env"


settings = Settings()
```

**app/main.py**
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.models.database import init_db
from app.services import router

app = FastAPI(title=settings.APP_NAME)

# CORS：开发阶段允许所有来源，生产环境应限制为 tauri://localhost
allow_origins = ["*"] if settings.DEBUG else ["tauri://localhost", "http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    init_db()

app.include_router(router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.API_HOST, port=settings.API_PORT, reload=True)
```

**安装依赖 & 启动验证：**
```bash
cd D:\work\项目\kecheng\backend
C:\Users\lcl13\.workbuddy\binaries\python\versions\3.13.12\python.exe -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
# 访问 http://127.0.0.1:8765/docs 可以看到 Swagger UI
```

**Commit:** `feat(backend): FastAPI 骨架 + CORS + 启动入口`

---

## Task 3 — 场景数据与 SQLite 存储

**Files:**
- 创建: `D:\work\项目\kecheng\backend\app\models\__init__.py`
- 创建: `D:\work\项目\kecheng\backend\app\models\database.py`
- 创建: `D:\work\项目\kecheng\backend\app\models\scene.py`
- 创建: `D:\work\项目\kecheng\backend\app\data\scenes_free.json`
- 创建: `D:\work\项目\kecheng\backend\app\services\__init__.py`
- 创建: `D:\work\项目\kecheng\backend\app\services\scene_service.py`

**models/database.py**
```python
import sqlite3
from app.config import settings
from pathlib import Path

Path(settings.DB_PATH).parent.mkdir(parents=True, exist_ok=True)

def get_db():
    conn = sqlite3.connect(settings.DB_PATH)
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
```

**models/scene.py**
```python
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
```

**data/scenes_free.json**（精简版：1 个场景，4 句对话）
```json
[
  {
    "id": "free_01",
    "title": "🍽️ 餐厅点餐",
    "difficulty": 1,
    "category": "daily",
    "is_free": true,
    "dialogues": [
      {"seq": 1, "speaker": "A", "role": "服务员", "en": "Welcome to our restaurant. How many people?", "zh": "欢迎光临。请问几位？", "keywords": ["welcome", "restaurant"], "tips": "注意 'How many' 的连读"},
      {"seq": 2, "speaker": "B", "role": "顾客", "en": "Table for two, please.", "zh": "请给我们两人桌。", "keywords": ["table", "two"], "tips": "'Table for' 注意连读"},
      {"seq": 3, "speaker": "A", "role": "服务员", "en": "Right this way. Here is the menu.", "zh": "这边请。这是菜单。", "keywords": ["right", "menu"], "tips": "注意 'menu' 的重音在第一个音节"},
      {"seq": 4, "speaker": "B", "role": "顾客", "en": "Thank you. Can I have some water first?", "zh": "谢谢。能先给我来点水吗？", "keywords": ["thank", "water"], "tips": "注意 'water' 中 /t/ 的闪音发音"}
    ],
    "cultural_notes": "在西方国家，服务员通常会先询问是否需要饮品，而不是直接让你看菜单。"
  }
]
```

**services/scene_service.py**
```python
import json
from pathlib import Path
from app.models.database import get_db
from app.models.scene import Scene, SceneListItem

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
        dialogues=[Scene.DialogueItem(**d) for d in dialogues],
        cultural_notes=row["cultural_notes"]
    )
```

**services/__init__.py**（路由注册）
```python
from fastapi import APIRouter
from . import scene_service

router = APIRouter()


@router.get("/scenes")
async def list_scenes():
    scene_service.load_scenes_to_db()
    return {"data": scene_service.get_scene_list()}


@router.get("/scenes/{scene_id}")
async def get_scene(scene_id: str):
    scene_service.load_scenes_to_db()
    scene = scene_service.get_scene_detail(scene_id)
    if not scene:
        return {"error": "Scene not found"}, 404
    return {"data": scene}
```

**数据库启动方式：** 启动时自动 `init_db()`，首次请求场景时自动 `load_scenes_to_db()`

**验证：**
```bash
curl http://127.0.0.1:8765/api/scenes
# 返回场景列表 JSON

curl http://127.0.0.1:8765/api/scenes/free_01
# 返回 free_01 的详细对话数据
```

**Commit:** `feat(backend): 场景数据加载 + SQLite 存储 + 列表/详情 API`

---

## Task 4 — TTS 服务（edge-tts）

**⚠️ 关键设计：批量预生成 + 缓存 + 降级提示**

edge-tts 完全依赖网络，首次播放每句需 1-3 秒延迟。MVP 阶段采用**场景加载时批量预生成所有句子 TTS** 策略，后续播放零延迟。

**Files:**
- 创建: `D:\work\项目\kecheng\backend\app\services\tts_service.py`

**tts_service.py**
```python
import asyncio
import hashlib
from pathlib import Path
import edge_tts
from app.config import settings

Path(settings.TTS_CACHE_DIR).mkdir(parents=True, exist_ok=True)

VOICE_MAP = {
    "en-US": "en-US-AvaNeural",
    "en-GB": "en-GB-SoniaNeural",
}


def _cache_key(text: str, voice: str) -> str:
    return hashlib.md5(f"{text}_{voice}".encode()).hexdigest()


async def _gen_one(text: str, voice: str) -> bytes:
    comm = edge_tts.Communicate(text, voice)
    data = b""
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            data += chunk["data"]
    return data


async def generate_tts(text: str, voice_key: str = "en-US") -> str:
    """生成 TTS 音频，返回缓存文件路径"""
    voice = VOICE_MAP.get(voice_key, VOICE_MAP["en-US"])
    cache_name = f"{_cache_key(text, voice)}.mp3"
    cache_path = Path(settings.TTS_CACHE_DIR) / cache_name

    if cache_path.exists():
        return str(cache_path)

    try:
        data = await _gen_one(text, voice)
        cache_path.write_bytes(data)
        return str(cache_path)
    except Exception as e:
        # 网络失败降级：返回空路径，前端提示用户
        print(f"[TTS] Failed to generate TTS for '{text}': {e}")
        return ""


async def batch_pre_generate(dialogues: list[dict], voice_key: str = "en-US") -> dict[int, str]:
    """批量预生成所有句子的 TTS，返回 {seq: file_path}"""
    results = {}
    for d in dialogues:
        path = await generate_tts(d["en"], voice_key)
        results[d["seq"]] = path
    return results
```

**修改 services/__init__.py，增加 TTS 端点：**
```python
from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from . import scene_service
from app.services.tts_service import generate_tts, batch_pre_generate

router = APIRouter()


@router.get("/scenes")
async def list_scenes():
    scene_service.load_scenes_to_db()
    return {"data": scene_service.get_scene_list()}


@router.get("/scenes/{scene_id}")
async def get_scene(scene_id: str):
    scene_service.load_scenes_to_db()
    scene = scene_service.get_scene_detail(scene_id)
    if not scene:
        return {"error": "Scene not found"}, 404
    return {"data": scene}


@router.get("/tts")
async def tts(text: str = Query(...), voice: str = Query("en-US")):
    """生成句子级 TTS，返回 MP3 文件"""
    cache_path = await generate_tts(text, voice)
    if not cache_path:
        return {"error": "TTS generation failed (network issue?)"}, 503
    return FileResponse(cache_path, media_type="audio/mpeg", filename="speech.mp3")


@router.get("/scenes/{scene_id}/tts/batch")
async def batch_tts(scene_id: str, voice: str = Query("en-US")):
    """批量预生成场景所有句子的 TTS"""
    scene_service.load_scenes_to_db()
    scene = scene_service.get_scene_detail(scene_id)
    if not scene:
        return {"error": "Scene not found"}, 404
    results = await batch_pre_generate([d.model_dump() for d in scene.dialogues], voice)
    return {"data": results}
```

**验证：**
```bash
# 单句
curl "http://127.0.0.1:8765/api/tts?text=Hello+world&voice=en-US" --output test.mp3

# 批量预生成
curl "http://127.0.0.1:8765/api/scenes/free_01/tts/batch?voice=en-US"
# 返回 {"data": {"1": "cache/tts/xxx.mp3", "2": "cache/tts/yyy.mp3", ...}}
```

**Commit:** `feat(backend): edge-tts TTS 服务 + 批量预生成 + 缓存 + 网络失败降级`

---

## Task 5 — STT 服务（Whisper）

**Files:**
- 创建: `D:\work\项目\kecheng\backend\app\services\stt_service.py`

**stt_service.py**
```python
import tempfile
import subprocess
from pathlib import Path
import whisper
from app.config import settings

print(f"[STT] Loading Whisper model: {settings.WHISPER_MODEL} on {settings.WHISPER_DEVICE}...")
_model = whisper.load_model(settings.WHISPER_MODEL, device=settings.WHISPER_DEVICE)
print("[STT] Model loaded.")


def transcribe(audio_bytes: bytes, input_format: str = "webm") -> dict:
    """转写音频，返回文本 + 置信度"""
    with tempfile.NamedTemporaryFile(suffix=f".{input_format}", delete=False) as tmp_in:
        tmp_in.write(audio_bytes)
        tmp_in_path = Path(tmp_in.name)

    try:
        # FFmpeg 转 16kHz WAV
        wav_path = tmp_in_path.with_suffix(".wav")
        subprocess.run([
            "ffmpeg", "-y", "-i", str(tmp_in_path),
            "-ar", "16000", "-ac", "1", "-f", "wav",
            str(wav_path)
        ], capture_output=True, check=True)

        result = _model.transcribe(str(wav_path), language="en", fp16=False)

        return {
            "text": result["text"].strip(),
            "confidence": float(result.get("avg_logprob", -1)),
            "segments": len(result.get("segments", []))
        }
    finally:
        tmp_in_path.unlink(missing_ok=True)
        wav_path.unlink(missing_ok=True)
```

**前置条件：** 安装 FFmpeg
```bash
# Windows (Choco)
choco install ffmpeg
# 或从 https://ffmpeg.org/download.html 下载，加入 PATH
```

**修改 services/__init__.py，增加 STT 端点：**
```python
from fastapi import UploadFile, File, HTTPException
from app.services.stt_service import transcribe

# WebM 文件魔数校验（前 4 字节为 0x1A 0x45 0xDF 0xA3）
WEBM_MAGIC = b'\x1a\x45\xdf\xa3'

@router.post("/stt")
async def stt(audio: UploadFile = File(...)):
    data = await audio.read()
    
    # 大小校验
    if len(data) > 5 * 1024 * 1024:  # 5MB 上限
        raise HTTPException(status_code=413, detail="Audio too large (max 5MB)")
    
    # 文件类型校验（魔数）
    if len(data) < 4 or data[:4] != WEBM_MAGIC:
        raise HTTPException(status_code=400, detail="Invalid audio format (expected WebM)")
    
    result = transcribe(data, "webm")
    return {"data": result}
```

**验证：**
```bash
# 录一段英语音频后
curl -X POST -F "audio=@test.webm" http://127.0.0.1:8765/api/stt
# 返回 {"data": {"text": "...", "confidence": -0.5, "segments": 1}}
```

**Commit:** `feat(backend): Whisper STT 转写服务 + FFmpeg 预处理`

---

## Task 6 — 基础评分服务（WER 对比）

**Files:**
- 创建: `D:\work\项目\kecheng\backend\app\services\score_service.py`

**score_service.py**
```python
import re
from dataclasses import dataclass


@dataclass
class WordScore:
    word: str
    status: str  # "correct" | "wrong" | "missing" | "extra"


@dataclass
class ScoreResult:
    pronunciation_score: int
    fluency_score: int
    completeness_score: int
    overall_score: int
    word_scores: list[WordScore]
    feedback: str


def _normalize(text: str) -> str:
    return re.sub(r"[^\w\s]", "", text.lower().strip())


def _wer(reference: str, hypothesis: str) -> float:
    """计算词错率 (Word Error Rate)"""
    r = _normalize(reference).split()
    h = _normalize(hypothesis).split()
    n = len(r)

    if n == 0:
        return 0.0

    # Levenshtein distance on word level
    dp = [[0] * (len(h) + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(len(h) + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, len(h) + 1):
            if r[i-1] == h[j-1]:
                dp[i][j] = dp[i-1][j-1]
            else:
                dp[i][j] = 1 + min(dp[i-1][j], dp[i-1][j-1], dp[i][j-1])

    return dp[n][len(h)] / n


def _align_words(reference: str, hypothesis: str) -> list[WordScore]:
    """逐词对齐，标注正确/错误"""
    r = _normalize(reference).split()
    h = _normalize(hypothesis).split()

    if not r:
        return [WordScore(word=w, status="extra") for w in h]

    # 简化版：按位置比对
    scores = []
    for i, ref_word in enumerate(r):
        if i < len(h) and h[i] == ref_word:
            scores.append(WordScore(word=ref_word, status="correct"))
        elif i < len(h):
            scores.append(WordScore(word=h[i], status="wrong"))
        else:
            scores.append(WordScore(word=ref_word, status="missing"))

    # 多余的词（用户多读）
    for j in range(len(r), len(h)):
        scores.append(WordScore(word=h[j], status="extra"))

    return scores


def score(original: str, user: str, duration_ms: int = 0, confidence: float = 0) -> ScoreResult:
    """
    三维评分（规则版，M1 阶段不使用 GPT）
    
    - 发音准确度：基于文本相似度映射（WER → 发音分）
    - 流利度：基于语速估计（实际词数 / 秒）
    - 完整度：基于 WER
    """
    wer_val = _wer(original, user)
    completeness = max(0, int((1 - wer_val) * 100))

    # 发音分：WER 作为间接指标（M1 无音素级对比，可接受）
    pronunciation = max(0, int((1 - wer_val) * 95))  # 最多 95，留 5 分给音素级改进空间

    # 流利度：基于录音时长估算
    if duration_ms > 0:
        word_count = len(_normalize(original).split())
        wpm = (word_count / duration_ms) * 60000
        # 目标 120 WPM
        fluency = max(0, min(100, int((wpm / 120) * 80 + 20)))
    else:
        fluency = completeness  # 无时长则用完整度近似

    overall = int(pronunciation * 0.5 + fluency * 0.3 + completeness * 0.2)
    word_scores = _align_words(original, user)

    # 生成简单反馈
    if completeness >= 90:
        feedback = "🌟 非常好！发音清晰，非常接近原文。"
    elif completeness >= 70:
        feedback = "👍 不错！基本正确，注意细节发音。"
    elif completeness >= 50:
        feedback = "💪 继续努力！多听几遍标准发音再试。"
    else:
        feedback = "🎯 先仔细听示范，再逐句跟读。"

    return ScoreResult(
        pronunciation_score=pronunciation,
        fluency_score=fluency,
        completeness_score=completeness,
        overall_score=overall,
        word_scores=word_scores,
        feedback=feedback
    )
```

**修改 services/__init__.py，增加评分端点：**
```python
from fastapi import Form, HTTPException, Query
from app.services.score_service import score

MAX_SCORE_TEXT_LENGTH = 500

@router.post("/score")
async def score_endpoint(
    original: str = Form(...),
    user_transcription: str = Form(...),
    duration_ms: int = Form(0),
    confidence: float = Form(0.0)
):
    # 长度限制，防止 O(n²) WER 计算超时
    if len(original) > MAX_SCORE_TEXT_LENGTH or len(user_transcription) > MAX_SCORE_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Text too long (max {MAX_SCORE_TEXT_LENGTH} chars)")
    result = score(original, user_transcription, duration_ms, confidence)
    return {"data": result.__dict__}
```

**Commit:** `feat(backend): WER 基础评分服务（三维：发音/流利/完整）`

---

## Task 7 — React 前端脚手架

Files:
- 需要运行 Vite 项目脚手架

```bash
cd D:\work\项目\kecheng\frontend
npm create vite@latest . -- --template react-ts
```

安装依赖：
```bash
npm install
npm install -D tailwindcss @tailwindcss/vite
npm install lucide-react
```

修改 vite.config.ts，添加 Tailwind 插件。

**验证：** `npm run dev` 后访问 localhost 看到 Vite 示例页。

**Commit:** `feat(frontend): React + Vite + TypeScript + Tailwind 脚手架`

---

## Task 8 — API 客户端

**Files:**
- 创建: `D:\work\项目\kecheng\frontend\src\services\api.ts`

```typescript
const BASE_URL = "http://127.0.0.1:8765/api";

export interface DialogueItem {
  seq: number;
  speaker: string;
  role: string;
  en: string;
  zh: string;
  keywords?: string[];
  tips?: string;
}

export interface SceneListItem {
  id: string;
  title: string;
  difficulty: number;
  category: string;
  is_free: boolean;
  dialogue_count: number;
}

export interface Scene extends SceneListItem {
  dialogues: DialogueItem[];
  cultural_notes: string;
}

export interface ScoreResult {
  pronunciation_score: number;
  fluency_score: number;
  completeness_score: number;
  overall_score: number;
  word_scores: { word: string; status: string }[];
  feedback: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  getScenes: () => fetchJson<{ data: SceneListItem[] }>(`${BASE_URL}/scenes`).then(r => r.data),
  getScene: (id: string) => fetchJson<{ data: Scene }>(`${BASE_URL}/scenes/${id}`).then(r => r.data),
  getTTSUrl: (text: string, voice = "en-US") =>
    `${BASE_URL}/tts?text=${encodeURIComponent(text)}&voice=${voice}`,
  transcribe: async (blob: Blob) => {
    const form = new FormData();
    form.append("audio", blob, "speech.webm");
    return fetchJson<{ data: { text: string; confidence: number } }>(`${BASE_URL}/stt`, {
      method: "POST", body: form,
    }).then(r => r.data);
  },
  score: async (original: string, userText: string, durationMs: number) => {
    const form = new FormData();
    form.append("original", original);
    form.append("user_transcription", userText);
    form.append("duration_ms", String(durationMs));
    const res = await fetchJson<{ data: ScoreResult }>(`${BASE_URL}/score`, {
      method: "POST", body: form,
    });
    return res.data;
  },
};
```

**Commit:** `feat(frontend): API 客户端封装（场景/TTS/转写/评分）`

---

## Task 9 — 场景列表组件

**Files:**
- 创建: `D:\work\项目\kecheng\frontend\src\components\SceneList.tsx`

```tsx
import { api, type SceneListItem } from "../services/api";

export function SceneList({ onSelect }: { onSelect: (id: string) => void }) {
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getScenes().then(data => { setScenes(data); setLoading(false); });
  }, []);

  if (loading) return <div className="p-4 text-gray-500">加载中...</div>;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider px-3">
        💬 场景库
      </h2>
      <div className="space-y-1">
        {scenes.map(scene => (
          <button
            key={scene.id}
            onClick={() => onSelect(scene.id)}
            className={`w-full text-left px-3 py-2 rounded-lg transition-colors hover:bg-gray-100 flex items-center justify-between ${
              !scene.is_free ? "opacity-50" : ""
            }`}
          >
            <div>
              <div className="font-medium text-sm">{scene.title}</div>
              <div className="text-xs text-gray-400">
                {"⭐".repeat(scene.difficulty)} · {scene.dialogue_count} 句
              </div>
            </div>
            {!scene.is_free && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">🔒 Pro</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Commit:** `feat(frontend): 场景列表组件`

---

## Task 10 — 对话练习区组件

**Files:**
- 创建: `D:\work\项目\kecheng\frontend\src\components\DialogueArea.tsx`

包含：
- 双语对话展示
- 逐句高亮播放
- 跟读按钮
- 录音状态指示
- 加载评分并展示结果

（此组件是 MVP 核心，约 150 行代码，详细代码见后续执行步骤）

---

## Task 11 — 评分展示面板

**Files:**
- 创建: `D:\work\项目\kecheng\frontend\src\components\ScorePanel.tsx`

三维雷达图（用 SVG 简化）+ 逐词高亮（绿色=正确，红色=错误，灰色=缺失，蓝色=多余）+ 反馈文字。

---

## Task 12 — 录音 Hook

**Files:**
- 创建: `D:\work\项目\kecheng\frontend\src\hooks\useRecorder.ts`

```typescript
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const durationRef = useRef<number>(0);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
    chunks.current = [];
    mr.ondataavailable = e => chunks.current.push(e.data);
    mr.start();
    mediaRecorder.current = mr;
    setRecording(true);
    durationRef.current = 0;
    setDuration(0);
    timer.current = window.setInterval(() => {
      durationRef.current += 100;
      setDuration(durationRef.current);
    }, 100);
  }, []);

  const stop = useCallback((): Promise<{ blob: Blob; durationMs: number }> => {
    return new Promise(resolve => {
      const mr = mediaRecorder.current!;
      mr.onstop = () => {
        setRecording(false);
        clearInterval(timer.current);
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
        }
        resolve({ blob, durationMs: durationRef.current });
      };
      mr.stop();
    });
  }, []);

  return { recording, duration, start, stop };
}
```

**Commit:** `feat(frontend): useRecorder 录音 Hook（MediaRecorder 封装，修复闭包 Bug）`

---

## Task 13 — TTS 播放 Hook

**Files:**
- 创建: `D:\work\项目\kecheng\frontend\src\hooks\useTTS.ts`

```typescript
export function useTTS() {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(async (text: string, voice = "en-US") => {
    if (playing) return;
    setPlaying(true);
    const url = api.getTTSUrl(text, voice);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    await audio.play();
  }, [playing]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  return { playing, play, stop };
}
```

**Commit:** `feat(frontend): useTTS 播放 Hook（autoplay 策略封装）`

---

## Task 14 — 组装联调

**Files:**
- 修改: `D:\work\项目\kecheng\frontend\src\App.tsx`

```tsx
import { SceneList } from "./components/SceneList";
import { DialogueArea } from "./components/DialogueArea";

export default function App() {
  const [selectedScene, setSelectedScene] = useState<string | null>(null);

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* 左栏: 场景列表 */}
      <aside className="w-64 border-r border-gray-200 bg-white overflow-y-auto p-3">
        <SceneList onSelect={setSelectedScene} />
      </aside>

      {/* 中栏: 对话练习区 */}
      <main className="flex-1 overflow-y-auto p-6">
        {selectedScene ? (
          <DialogueArea sceneId={selectedScene} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            👈 选择一个场景开始练习
          </div>
        )}
      </main>

      {/* 右栏: 学习报告（M1 简化版，仅占位） */}
      <aside className="w-72 border-l border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          📊 学习报告
        </h2>
        <div className="text-sm text-gray-400">M1 MVP 暂不展示数据</div>
      </aside>
    </div>
  );
}
```

**验证：** 启动后端 + 前端，选择场景 → 播放示范 → 跟读 → 看到评分

**Commit:** `feat(frontend): 主界面三栏布局 + 端到端联调`

---

## 附录：开发环境检查清单

在执行上述任务前，确保：

```bash
# 1. Python 3.13 已安装
C:\Users\lcl13\.workbuddy\binaries\python\versions\3.13.12\python.exe --version

# 2. Node.js 22 已安装  
node --version

# 3. FFmpeg 已安装并加入 PATH
ffmpeg -version

# 4. Git 初始化（可选）
cd D:\work\项目\kecheng
git init
git add .
git commit -m "chore: 项目初始化"
```

### 首次启动进度提示（M1 可简化，但必须有）

后端启动时 Whisper 模型加载需要 30 秒+（纯 CPU），必须在启动日志中输出进度：

```python
# 放在 main.py startup 事件中
import sys
print(f"[Startup] Loading Whisper model: {settings.WHISPER_MODEL}...", flush=True)
# ... 加载模型 ...
print("[Startup] Whisper model loaded.", flush=True)
print(f"[Startup] Server ready at http://{settings.API_HOST}:{settings.API_PORT}", flush=True)
```

前端 MVP 阶段简单处理：启动时显示"正在加载语音识别模型，首次启动约需 30 秒..."。

### 安装包体积优化（M4 前可接受，但需记录）

| 组件 | 大小 |
|------|------|
| Whisper base 模型 | ~150 MB |
| FFmpeg 静态库 | ~80 MB |
| Python 嵌入式运行时 | ~40 MB |
| WebView2 (Windows) | 已预装 |
| Tauri Rust 编译产物 | ~5 MB |
| React 前端产物 | ~2 MB |
| **总计** | **~280 MB** |

M4 优化方案：模型按需下载（首次练习时再下），安装包控制在 ~50 MB 以内。

### 平台兼容性备忘

| 平台 | 注意事项 |
|------|----------|
| Windows 10/11 | WebView2 运行时通常已预装，未预装时引导用户下载安装 |
| macOS 12+ | 需在 `Info.plist` 添加 `NSMicrophoneUsageDescription` 麦克风权限说明；`ffmpeg` 通过 `brew install ffmpeg` 或打包至 app bundle |
| Linux（V2）| 需要 `libwebkit2gtk-4.1-dev` 等 Tauri 依赖；暂不在 MVP 范围内 |

_实施计划结束_

_下一步：从 Task 1 开始执行编码_
