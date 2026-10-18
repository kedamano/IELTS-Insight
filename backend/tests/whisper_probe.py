"""子进程探针脚本（由 tests/test_stt_lazy_import.py 用 venv python 直接执行）。

目标：在**干净的进程**里验证 test-plan §1 第二条 —— "import 即加载 whisper+torch" 已改成懒加载。
探针把真 whisper/torch 换成记账用的假模块（记录 import 与 load_model 调用顺序），
然后 import app.services.stt_service，打印两行结果供测试断言。
"""
from __future__ import annotations

import importlib.abc
import importlib.machinery
import sys
import types

EVENTS: list[str] = []


class _FakeModel:
    def transcribe(self, audio, **kwargs):  # noqa: ANN001, ARG002
        return {"text": "probe", "segments": [{"id": 0}], "avg_logprob": -0.3}


def _make_whisper() -> types.ModuleType:
    mod = types.ModuleType("whisper")
    loads: list[str] = []
    mod._loads = loads  # type: ignore[attr-defined]

    def load_model(name, *args, **kwargs):  # noqa: ANN001, ARG002
        loads.append(str(name))
        EVENTS.append("load_model")
        return _FakeModel()

    mod.load_model = load_model  # type: ignore[attr-defined]
    mod.available = types.SimpleNamespace(models=lambda: ["tiny"])  # type: ignore[attr-defined]
    return mod


class _StubFinder(importlib.abc.MetaPathFinder):
    """拦截 whisper / torch 的真模块导入：既记账，又不真的把 torch 拉进内存。"""

    PREFIXES = ("whisper", "torch", "tiktoken", "numba")

    def find_spec(self, fullname, path=None, target=None):  # noqa: ANN001, ARG002
        root = fullname.split(".")[0]
        if root not in self.PREFIXES:
            return None
        EVENTS.append(f"import:{root}")
        if root == "whisper":
            module = _make_whisper()
        else:
            module = types.ModuleType(fullname)
            module.__path__ = []  # type: ignore[attr-defined]
        loader = _StubLoader(module)
        return importlib.machinery.ModuleSpec(fullname, loader)


class _StubLoader(importlib.abc.Loader):
    def __init__(self, module: types.ModuleType) -> None:
        self._module = module

    def create_module(self, spec):  # noqa: ANN003
        return self._module

    def exec_module(self, module, *args):  # noqa: ANN003, ARG002
        return None


def main() -> int:
    sys.meta_path.insert(0, _StubFinder())

    target = sys.argv[1] if len(sys.argv) > 1 else "app.services.stt_service"
    action = sys.argv[2] if len(sys.argv) > 2 else "import"
    try:
        module = __import__(target, fromlist=["*"])
    except Exception as exc:  # noqa: BLE001 - 探针要把任何导入期异常如实报告
        print(f"IMPORT_ERROR {type(exc).__name__}: {exc}")
        print(f"EVENTS {EVENTS}")
        return 1

    if action == "call_model":
        # 懒加载不是"永远不加载"：显式取模型时必须真的 load_model
        getter = getattr(module, "_get_model", None) or getattr(module, "get_model", None)
        if getter is None:
            print("NO_GETTER")
        else:
            getter()
        print(f"AFTER_GETTER_EVENTS {EVENTS}")
    print(f"EVENTS {EVENTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
