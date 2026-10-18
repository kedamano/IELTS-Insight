"""应用配置（进程级、来自环境变量 / .env）。

契约：`docs/specs/ielts/spec-contracts.md` §6。

硬规则：
- CONSTITUTION §3：AI 凭据只能从 `.env` / 环境变量读入，绝不出现在任何返回值、
  日志或异常文本里。
- CONSTITUTION §6：测试必须在 **import `app.*` 之前**用 `IELTS_DB_PATH` /
  `IELTS_TTS_CACHE_DIR` / `IELTS_ONLINE` 指向 tmp 路径，所以这三个 env 名是契约的一部分，
  优先级高于 `.env` 与旧名（`DB_PATH` / `TTS_CACHE_DIR` / `ONLINE`）。
- 路径默认落在可写的用户数据目录（`%LOCALAPPDATA%`），不再相对 CWD（PyInstaller 会踩坑）。
"""

import os
from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AliasChoices

APP_VERSION = "2.0.0"


def default_data_dir() -> Path:
    """用户数据目录：`%LOCALAPPDATA%/IELTSInsight`，回退 `~/.ielts-insight`。"""
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if base and os.name == "nt":
        return Path(base) / "IELTSInsight"
    return Path.home() / ".ielts-insight"


def default_db_path() -> str:
    return str(default_data_dir() / "app.db")


def default_tts_cache_dir() -> str:
    return str(default_data_dir() / "cache" / "tts")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    APP_NAME: str = "IELTS Insight"
    APP_VERSION: str = APP_VERSION
    DEBUG: bool = True
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8765

    # --- 本地数据路径（可被 IELTS_* env 覆盖；CONSTITUTION §6） ---
    DB_PATH: str = Field(
        default_factory=default_db_path,
        validation_alias=AliasChoices("IELTS_DB_PATH", "DB_PATH"),
    )
    TTS_CACHE_DIR: str = Field(
        default_factory=default_tts_cache_dir,
        validation_alias=AliasChoices("IELTS_TTS_CACHE_DIR", "TTS_CACHE_DIR"),
    )
    # ONLINE=False 时禁用一切需要网络的增强（AI / edge-tts），核心流程仍可用。
    ONLINE: bool = Field(
        default=True,
        validation_alias=AliasChoices("IELTS_ONLINE", "ONLINE"),
    )

    # --- AI（OpenAI 兼容端点）---
    # 之前 config 里从来没有 OPENAI_BASE_URL / OPENAI_MODEL，
    # 而 ai_review_service 读了它们 → AttributeError 被吞 → 永远走离线模板
    # （CONSTITUTION §3 点名的反面教材）。
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    AI_TIMEOUT_SEC: int = 120

    # --- Whisper（懒加载，见 api/media.py 与 T8 的 stt_service 改造） ---
    WHISPER_MODEL: str = "base"
    WHISPER_DEVICE: str = "cpu"


settings = Settings()


def data_dir_for(path_str: str) -> Path:
    """确保目录存在并返回其父目录。"""
    parent = Path(path_str).expanduser().resolve().parent
    parent.mkdir(parents=True, exist_ok=True)
    return parent


def env_ai_key() -> Optional[str]:
    """`.env` / 环境变量里的 key（可能为 None）。调用方不得把它写日志或回传前端。"""
    key = (settings.OPENAI_API_KEY or "").strip()
    return key or None


def ai_base_url() -> Optional[str]:
    url = (settings.OPENAI_BASE_URL or "").strip()
    return url or None


def ai_model() -> str:
    return (settings.OPENAI_MODEL or "gpt-4o-mini").strip()
