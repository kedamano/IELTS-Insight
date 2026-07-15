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
