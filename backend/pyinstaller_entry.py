"""PyInstaller entry point for the FastAPI backend sidecar."""
import os
import sys

# When running from PyInstaller bundle, resolve paths relative to the exe
if getattr(sys, 'frozen', False):
    exe_dir = os.path.dirname(sys.executable)
else:
    exe_dir = os.path.dirname(os.path.abspath(__file__))

# Set data paths
os.environ.setdefault("TTS_CACHE_DIR", os.path.join(exe_dir, "cache", "tts"))
os.environ.setdefault("DB_PATH", os.path.join(exe_dir, "db", "app.db"))

# Ensure data directories exist
os.makedirs(os.environ["TTS_CACHE_DIR"], exist_ok=True)
os.makedirs(os.path.dirname(os.environ["DB_PATH"]), exist_ok=True)

# Override DEBUG to False for production
os.environ.setdefault("DEBUG", "False")

import uvicorn
from app.main import app
from app.config import settings

if __name__ == "__main__":
    print(f"[Backend] Starting on {settings.API_HOST}:{settings.API_PORT}")
    print(f"[Backend] DB path: {settings.DB_PATH}")
    print(f"[Backend] TTS cache: {settings.TTS_CACHE_DIR}")
    uvicorn.run(app, host=settings.API_HOST, port=settings.API_PORT, log_level="info")
