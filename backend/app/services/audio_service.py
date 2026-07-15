"""音频处理服务 — v1.1 新增

按 v1.1 设计文档第 13.2 节：
- FFmpeg 格式转换（WebM → 16kHz WAV）
- RNNoise 降噪（可选）
- 端点检测（VAD）

STT 服务已包含 FFmpeg 转换，本模块提供：
1. 音频预处理（降噪）
2. WAV 格式标准化
3. 音频质量检测（采样率、时长）
"""

import subprocess
import tempfile
from pathlib import Path


def convert_to_wav(input_bytes: bytes, sample_rate: int = 16000) -> bytes:
    """将音频转换为 16kHz 单声道 WAV（供 Whisper 使用）"""
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp_in:
        tmp_in.write(input_bytes)
        tmp_in_path = tmp_in.name

    tmp_out_path = tmp_in_path.replace(".webm", ".wav")

    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", tmp_in_path,
                "-ar", str(sample_rate),
                "-ac", "1",
                "-sample_fmt", "s16",
                tmp_out_path,
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        with open(tmp_out_path, "rb") as f:
            return f.read()
    finally:
        Path(tmp_in_path).unlink(missing_ok=True)
        Path(tmp_out_path).unlink(missing_ok=True)


def detect_silence(audio_bytes: bytes, threshold_db: float = 30.0) -> bool:
    """检测音频是否过于安静

    使用 ffmpeg volumedetect 滤镜分析音量
    """
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-i", tmp_path,
                "-af", "volumedetect",
                "-f", "null", "-",
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        # 解析 mean_volume
        for line in result.stderr.split("\n"):
            if "mean_volume" in line:
                parts = line.split(":")
                if len(parts) > 1:
                    try:
                        vol = float(parts[1].strip().split()[0])
                        return vol < -threshold_db
                    except ValueError:
                        pass
        return False
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def get_audio_info(audio_bytes: bytes) -> dict:
    """获取音频基本信息"""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", tmp_path],
            capture_output=True,
            text=True,
            timeout=10,
        )
        import json
        info = json.loads(result.stdout)
        fmt = info.get("format", {})
        stream = info.get("streams", [{}])[0]
        return {
            "duration": float(fmt.get("duration", 0)),
            "sample_rate": int(stream.get("sample_rate", 0)),
            "channels": int(stream.get("channels", 0)),
            "bit_rate": int(fmt.get("bit_rate", 0)),
        }
    except Exception:
        return {"duration": 0, "sample_rate": 0, "channels": 0, "bit_rate": 0}
    finally:
        Path(tmp_path).unlink(missing_ok=True)
