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
