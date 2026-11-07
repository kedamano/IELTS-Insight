"""契约 §15.5：转写失败时，界面上那句中文要看得懂，日志里那条要查得了案。

为什么单独立一个文件：CONSTITUTION §3 写了「界面文案中文、不含异常原文」很久，
但转写这条路一直在把 whisper 的英文原文拼进 `detail`
（`音频无法识别：Cannot decode audio (webm): ...`、`语音转写不可用（RuntimeError）`）。
个人自用应用最容易在这里松手 —— 英文原文对**开发者**是线索，对**用户**是噪音，
而它一旦被截进弹窗，用户既看不懂也复制不走。

所以本文件成对钉两件事，只做一半比现状更糟：
- 界面侧：固定中文句子 + 机器码，不含英文原文、不含异常类名；
- 日志侧：被撤下来的原文必须落到 `logs/app.log`，否则「为什么这段录不上」彻底没人能查。

纪律：不装真 whisper（`_isolation` 的桩顶着），也不碰真实学习库（CONSTITUTION §1/§6）。
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest
import _isolation  # noqa: F401 - 必须先装隔离，再 import app.*

英文原文 = "Cannot decode audio (webm): <_io.BytesIO object> Error"
类名原文 = "Transcription failed: OSError"

WEBM样本 = b"\x1a\x45\xdf\xa3" + b"x" * 32


@pytest.fixture
def 客户端():
    """打请求用的 TestClient；不套上下文管理器 == 不跑 lifespan。"""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


@pytest.fixture
def 日志收集(monkeypatch):
    """顶掉 faultlog 的落盘出口，只收「标签 + 消息」——本文件关心的是原文有没有被记下来。"""
    from app.services import faultlog

    收到: list[tuple[str, str]] = []

    def 记账(标签: str, 消息: str, *args, **kwargs) -> None:  # noqa: ANN001, ARG002
        收到.append((标签, 消息))

    for 级别 in ("info", "warn", "error"):
        monkeypatch.setattr(faultlog, 级别, 记账, raising=True)
    return 收到


def _让转写抛(异常: Exception):
    def 抛(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise 异常

    return 抛


# --------------------------------------------------------------------------
# 界面侧：/api/stt
# --------------------------------------------------------------------------

def test_解码失败时界面只给固定中文句子(客户端, monkeypatch):
    from app.services import stt_service

    monkeypatch.setattr(stt_service, "transcribe", _让转写抛(ValueError(英文原文)), raising=True)

    响应 = 客户端.post("/api/stt", files={"audio": ("take.webm", WEBM样本, "audio/webm")})

    assert 响应.status_code == 400
    体 = 响应.json()
    assert 体["code"] == "audio_unintelligible"
    assert 体["detail"] == "这段录音听不清，可能没录到声音或格式不对，请重录一次或改用键盘输入"
    assert "Cannot" not in 体["detail"] and "decode" not in 体["detail"]


def test_依赖失败时界面不报异常类名(客户端, monkeypatch):
    from app.services import stt_service

    monkeypatch.setattr(stt_service, "transcribe", _让转写抛(RuntimeError(类名原文)), raising=True)

    响应 = 客户端.post("/api/stt", files={"audio": ("take.webm", WEBM样本, "audio/webm")})

    assert 响应.status_code == 503
    体 = 响应.json()
    assert 体["code"] == "stt_failed"
    assert 体["detail"] == "本机语音转写暂时不可用（可能没装 whisper 或模型没加载），可改用键盘输入文本"
    assert "RuntimeError" not in 体["detail"] and "OSError" not in 体["detail"]


# --------------------------------------------------------------------------
# 界面侧：口语 turn 走的是 speaking_session，那才是主流程
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "异常, 期望状态, 期望码",
    [
        (ValueError(英文原文), 400, "audio_unintelligible"),
        (RuntimeError(类名原文), 503, "stt_failed"),
    ],
)
def test_口语会话的转写错误同样不泄漏原文(异常, 期望状态, 期望码, monkeypatch):
    from app.services import speaking_session, stt_service

    monkeypatch.setattr(stt_service, "transcribe", _让转写抛(异常), raising=True)

    with pytest.raises(speaking_session.SpeakingSessionError) as 抓到:
        speaking_session.transcribe_audio(WEBM样本)

    错 = 抓到.value
    assert 错.status_code == 期望状态
    assert 错.code == 期望码
    assert "Cannot" not in 错.detail and "decode" not in 错.detail
    assert "RuntimeError" not in 错.detail and "OSError" not in 错.detail
    # 中文句子必须给出下一步，而不是只说「失败」
    assert "改用键盘输入" in 错.detail


# --------------------------------------------------------------------------
# 日志侧：撤下界面的原文必须落到日志（§15.3）
# --------------------------------------------------------------------------

def test_撤下界面的原文必须出现在日志里(客户端, monkeypatch, 日志收集):
    from app.services import stt_service

    monkeypatch.setattr(stt_service, "transcribe", _让转写抛(ValueError(英文原文)), raising=True)

    响应 = 客户端.post("/api/stt", files={"audio": ("take.webm", WEBM样本, "audio/webm")})

    assert 响应.status_code == 400
    命中 = [消息 for _标签, 消息 in 日志收集 if 英文原文 in 消息]
    assert 命中, f"界面不显示原文了，日志里也没有，这条错误就没人能查：{日志收集}"


def test_口语会话的转写失败也记一条日志(monkeypatch, 日志收集):
    from app.services import speaking_session, stt_service

    monkeypatch.setattr(stt_service, "transcribe", _让转写抛(RuntimeError(类名原文)), raising=True)

    with pytest.raises(speaking_session.SpeakingSessionError):
        speaking_session.transcribe_audio(WEBM样本)

    assert any(类名原文 in 消息 for _标签, 消息 in 日志收集), 日志收集


# --------------------------------------------------------------------------
# 判据：不许靠人记（§15.5 第 3 条）
# --------------------------------------------------------------------------

用户可见错误的构造点 = {"bad_request", "dependency_unavailable", "ApiError", "SpeakingSessionError", "not_found"}
扫描范围 = ("app/api", "app/services/speaking_session.py")


异常变量名 = {"exc", "err", "e"}


def _拼进了异常对象(节点: ast.AST) -> bool:
    """实参里直接用了异常对象本身（`str(exc)`、f\"{exc}\"、f\"{type(exc).__name__}\"）才算泄漏。

    `exc.detail` / `exc.status_code` / `exc.code` 是结构化字段，不算 —— `api/speaking.py`
    把会话层错误转成响应体时正是这么写的，一刀切会把正确代码判成违规。
    """
    if (
        isinstance(节点, ast.Attribute)
        and isinstance(节点.value, ast.Name)
        and 节点.value.id in 异常变量名
    ):
        return False
    if isinstance(节点, ast.Name) and 节点.id in 异常变量名:
        return True
    return any(_拼进了异常对象(子) for 子 in ast.iter_child_nodes(节点))


def test_构造用户可见错误的地方不许拼异常对象():
    """AST 级判据：用户可见错误的构造点不许把异常原文拼进文案（契约 §15.5 第 3 条）。

    故意只扫 `app/api/` 与 `speaking_session.py`：`services/sets_loader.py` 的
    `report["errors"]` 也带文件名和异常文本，但那是题库导入 CLI 的产物，没有任何端点把它
    发给界面。判据把非用户可见的东西算进来，第一次误报就会被人加进白名单，之后拦不住真泄漏。
    """
    后端根 = Path(_isolation.__file__).resolve().parents[1] / "app"
    assert 后端根.is_dir(), f"扫描根不对：{后端根}"

    文件 = sorted((后端根 / "api").rglob("*.py")) + [后端根 / "services" / "speaking_session.py"]
    违规: list[str] = []
    for 路径 in 文件:
        树 = ast.parse(路径.read_text(encoding="utf-8"), filename=str(路径))
        for 节点 in ast.walk(树):
            if not isinstance(节点, ast.Call):
                continue
            函数名 = getattr(节点.func, "id", None) or getattr(节点.func, "attr", None)
            if 函数名 not in 用户可见错误的构造点:
                continue
            if any(_拼进了异常对象(实参) for 实参 in list(节点.args) + [kw.value for kw in 节点.keywords]):
                违规.append(f"{路径.name}:{节点.lineno} {函数名} -> {ast.unparse(节点)[:120]}")

    assert not 违规, "用户可见的错误文案里拼进了异常对象（契约 §15.5）：\n" + "\n".join(违规)
