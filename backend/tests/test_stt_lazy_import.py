"""测试隔离补充：stt_service 必须懒加载（test-plan §1 第二行）。

覆盖 AC：CONSTITUTION §6「stt_service.py 在模块导入时 whisper.load_model() 必须改成懒加载，
        否则 import 即拖入 torch」、AC-C3（假模型下载进度改成真实懒加载状态的前置条件）。

用子进程 + 探针脚本（tests/whisper_probe.py）跑：主进程已经被 conftest 的假 whisper 污染，
只有在干净解释器里才能看出"import 这个模块时到底有没有去 load_model"。
"""
from __future__ import annotations

import ast
import os
import subprocess
import sys
from pathlib import Path

import pytest

PROBE = Path(__file__).resolve().parent / "whisper_probe.py"


def _run_probe(target: str) -> tuple[int, list[str], str]:
    proc = subprocess.run(
        [sys.executable, str(PROBE), target],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=str(PROBE.parent.parent),  # backend/ —— 让 app 包可导入
        env={**os.environ, "PYTHONPATH": str(PROBE.parent.parent)},
    )
    events: list[str] = []
    for line in proc.stdout.splitlines():
        if line.startswith("EVENTS "):
            events = ast.literal_eval(line[len("EVENTS ") :])
    return proc.returncode, events, proc.stdout + proc.stderr


@pytest.mark.parametrize("target", ["app.services.stt_service", "app.main"])
def test_导入期不得加载whisper模型(target):
    """CONSTITUTION §6：import 即 load_model → 每次启动/每次 pytest 都要几 GB torch。"""
    code, events, output = _run_probe(target)
    assert code == 0, f"RED：import {target} 失败 → {output[-500:]}"
    assert "load_model" not in events, (
        f"RED（等待实现）：导入 {target} 时就调用了 whisper.load_model()，events={events}"
    )


@pytest.mark.parametrize("target", ["app.services.stt_service", "app.main"])
def test_导入期不得把torch拉进来(target):
    code, events, output = _run_probe(target)
    assert code == 0, f"RED：import {target} 失败 → {output[-500:]}"
    assert not [e for e in events if e == "import:torch"], (
        f"RED（等待实现）：{target} 在导入期就拉入了 torch，events={events}"
    )


def test_懒加载入口存在且首次使用时真的加载模型():
    """懒加载不是"永远不加载"：显式取模型时必须 load_model 一次（AC-C3 的真实加载状态依赖它）。"""
    proc = subprocess.run(
        [sys.executable, str(PROBE), "app.services.stt_service", "call_model"],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=str(PROBE.parent.parent),
        env={**os.environ, "PYTHONPATH": str(PROBE.parent.parent)},
    )
    output = proc.stdout + proc.stderr
    assert proc.returncode == 0, f"RED：探针失败 → {output[-500:]}"
    assert "NO_GETTER" not in output, (
        "RED（等待实现）：stt_service 没有 _get_model()/get_model() 懒加载入口（test-plan §1 点名的修法）"
    )
    after = [line for line in output.splitlines() if line.startswith("AFTER_GETTER_EVENTS ")]
    assert after, f"探针没有输出 AFTER_GETTER_EVENTS：{output[-300:]}"
    events = ast.literal_eval(after[0][len("AFTER_GETTER_EVENTS ") :])
    assert "load_model" in events, f"取模型时应当触发一次 whisper.load_model，events={events}"
