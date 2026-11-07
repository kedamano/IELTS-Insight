"""STT 转写**成功路径**要真的跑通（回归：`math` 漏导入让每次成功转写都变成 503）。

这个缺陷是**真浏览器实跑**抓到的，不是单测抓到的 —— 原因具体：
`transcribe()` 在最后一步用 `math.exp(logprob)` 把对数概率映射成 0–1 的置信度（AC-S3），
而模块顶部只 `import io / os / threading`，漏了 `import math`。于是：

- 所有**失败**路径（空音频、解码失败、短音频、模型不可用）都照常工作 → 既有用例全绿；
- 唯一**成功**的那一步必然抛 `NameError`，被上层 `except Exception` 归成 `stt_failed`（503）
  → 用户读到「本机语音转写暂时不可用」，而模型其实刚装好。

教训：**异常分支覆盖再全，也替代不了跑一次正常分支**。所以本用例真的调
`stt_service.transcribe()`，只把 `decode_audio()`（PyAV 解容器，与缺陷无关）打桩成 1 秒静音，
后处理全部走产品代码 —— 这样 `NameError` 才拦得住。
"""
from __future__ import annotations

import ast
import math
from pathlib import Path

import numpy as np
import pytest

STT_SOURCE = Path(__file__).resolve().parents[1] / "app" / "services" / "stt_service.py"


@pytest.fixture
def stt(monkeypatch, load_or_wait):
    """真实的 stt_service；whisper 已被 conftest 换成假模块，解码打桩成 1 秒静音。"""
    mod = load_or_wait("app.services.stt_service")
    monkeypatch.setattr(
        mod,
        "decode_audio",
        lambda data, **kw: np.zeros(mod.SAMPLE_RATE, dtype=np.float32),  # noqa: ARG005
    )
    return mod


def _fake_model(payload):
    class _Model:
        def transcribe(self, audio, **kwargs):  # noqa: ANN001, ARG002
            return payload

    return _Model()


def test_成功转写返回置信度而不是抛NameError(stt, monkeypatch):
    """核心回归：`math.exp(logprob)` 必须真的算出来（漏导入时这条会 NameError → 503）。"""
    payload = {"text": "fake transcript", "avg_logprob": -0.42, "segments": [{"id": 0}]}
    monkeypatch.setattr(stt, "_model", _fake_model(payload))

    result = stt.transcribe(b"irrelevant-bytes", "webm")

    assert result["text"] == "fake transcript"
    assert result["duration"] == 1.0
    confidence = result["confidence"]
    assert isinstance(confidence, float) and 0.0 <= confidence <= 1.0
    assert confidence == pytest.approx(round(math.exp(-0.42), 4)), (
        "AC-S3：置信度来自 exp(avg_logprob)，值不对说明映射写错了"
    )


def test_极低对数概率被夹紧到0而不是负数(stt, monkeypatch):
    """`exp(-9)` 是 1e-4 量级，但 `avg_logprob` 可能更小；夹紧的下界不许漏。"""
    payload = {"text": "x", "avg_logprob": -30.0, "segments": []}
    monkeypatch.setattr(stt, "_model", _fake_model(payload))
    assert stt.transcribe(b"bytes", "webm")["confidence"] == 0.0


def test_源码里math被导入(stt):
    """静态判据（比行为判据更早、更明确地指出病根）。"""
    tree = ast.parse(STT_SOURCE.read_text(encoding="utf-8"))
    uses_math = any(
        isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "math"
        for node in ast.walk(tree)
    )
    if not uses_math:
        pytest.skip("stt_service 不再用 math（实现换了映射之后本判据失效）")
    imported = {
        alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names
    }
    assert "math" in imported, "stt_service 用了 math 却没 import math"
