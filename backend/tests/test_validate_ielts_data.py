"""`backend/tools/validate_ielts_data.py` 的机器化校验规则（契约 §2-L / §2 / §10.1）。

**为什么直接调 `main()` 而不是 import 内部函数**：校验规则的唯一真源是那个脚本本身，
CLI 的退出码与输出是它的对外契约。import 内部函数等于把测试绑死到实现细节上
（`check_listening` 改名就红），而这里要守的是「一个 mock_test 文件放进目录后，
校验脚本是否放行」。

覆盖（Wave 9 的 mock_test 接入）：
- `kind=mock_test` 必须被接受（此前 `check_common` 显式拒绝，见 §2-L 两种形状表）；
- mock_test 的 40 题 / `sections_covered=[1,2,3,4]` / 1100–1400 词 / 60–90 句；
- practice 的原有口径不变（20 题 / 550–700 词 / 25–45 句）。

纪律：全部走 `--data-dir` 指向 tmp 目录，绝不碰仓库题库（CONSTITUTION §6）。
`CONTENT_FLOORS`（全库下限）与 `manifest.json` 是**全库口径**，单模块 tmp 目录必然不满足，
所以断言里把它们与「被测规则」分开：只看输出里有没有与 mock_test 相关的错误行。
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"
TOOL = BACKEND / "tools" / "validate_ielts_data.py"

sys.path.insert(0, str(BACKEND / "tools"))
import validate_ielts_data as V  # noqa: E402

MOCK_ID = "li_mock_campus_01"


def _run(tmp_path: Path, *args: str):
    """跑 CLI（捕获 stdout 与退出码）。"""
    argv = ["--data-dir", str(tmp_path), *args]
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = V.main(argv)
    return code, out.getvalue()


def _write_set(root: Path, module: str, doc: dict) -> Path:
    """把一个 set 写成 `<root>/<module>/<id>.json`（2 空格缩进 + LF，与校验器同口径）。"""
    d = root / module
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{doc['id']}.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return path


def _set_module_dirs(root: Path) -> None:
    """CLI 要求四个模块目录 + sparring 都存在，否则报「模块目录不存在」。"""
    for module in (*V.MODULES, V.SPARRING_DIR):
        (root / module).mkdir(parents=True, exist_ok=True)


def _questions(count: int) -> list[dict]:
    """`count` 道结构合法的题（四种题型循环），题号 1..count。"""
    out = []
    for n in range(1, count + 1):
        qtype = ["gap_fill", "multiple_choice", "matching", "map_diagram_label"][(n - 1) % 4]
        q: dict = {"id": f"q{n}", "type": qtype, "number": n, "prompt": f"Question {n}."}
        if qtype == "gap_fill":
            q["word_limit"] = 2
            q["answer"] = "practice"
            q["accepted_alternatives"] = ["practice listening"]
            q["explanation_zh"] = f"第 {n} 题解析。"
        elif qtype == "multiple_choice":
            q["options"] = ["A. alpha", "B. beta", "C. gamma"]
            q["answer"] = "A"
            q["explanation_zh"] = f"第 {n} 题解析。"
        elif qtype == "matching":
            q["options_list"] = ["A. alpha", "B. beta", "C. gamma"]
            q["answer"] = "B"
            q["explanation_zh"] = f"第 {n} 题解析。"
        else:
            q["labels"] = ["A", "B", "C"]
            q["answer"] = "C"
            q["explanation_zh"] = f"第 {n} 题解析。"
        out.append(q)
    return out


def _sentences(count: int) -> tuple[list[dict], str]:
    """`count` 句锚点单调递增的句子 + 用空格连接成的 audio_text。

    每句约 15 词（真实听力文本的句长），好让「25–45 句 ∩ 550–700 词」与
    「60–90 句 ∩ 1100–1400 词」两个区间都有可行的交集。
    """
    text = (
        "This is a practice listening sentence number %d about campus life, study and work"
    )
    parts = []
    sentences = []
    for i in range(count):
        body = text % (i + 1)
        parts.append(body)
        sentences.append({"idx": i, "text": body, "anchor_sec": round(i * 2.4, 1)})
    return sentences, " ".join(parts)


def _mock_listening_doc() -> dict:
    """一份结构上合格的 40 题 mock_test（1100–1400 词、60–90 句、§2-L）。"""
    # 80 句 × ~14 词 ≈ 1120 词（落在 1100–1400），80 句在 60–90
    sentences, audio = _sentences(80)
    return {
        "id": MOCK_ID,
        "module": "listening",
        "kind": "mock_test",
        "section": 1,
        "sections_covered": [1, 2, 3, 4],
        "target_band": 6.5,
        "title_zh": "校园模拟卷（自写练习）",
        "topic": "campus",
        "source": "hand",
        "generated_at": "2026-11-12T00:00:00Z",
        "instruction_zh": "听录音，完成第 1–40 题。",
        "audio_text": audio,
        "audio_voice": "en-GB-SoniaNeural",
        "sentences": sentences,
        "questions": _questions(40),
    }


def _practice_listening_doc() -> dict:
    """一份结构上合格的 20 题 practice（550–700 词、25–45 句）。

    句长 ~15 词 ⇒ 25–45 句 = 375–675 词；取 30 句 ≈ 450 词，再补足到 550–700。
    """
    sentences, audio = _sentences(40)  # 40 句 ≈ 600 词，落在 550–700 且句数在 25–45
    doc = _mock_listening_doc()
    doc.update(
        {
            "id": "li_s1_leisure_99",
            "kind": "practice",
            "section": 1,
            "audio_text": audio,
            "sentences": sentences,
            "questions": _questions(20),
        }
    )
    doc.pop("sections_covered", None)
    return doc


# ---------------------------------------------------------------------------
# 校验规则
# ---------------------------------------------------------------------------

def test_mock_test被接受(tmp_path: Path):
    """§2-L 两种形状：mock_test 是正式 kind，不是「预留」。

    这是本轮的 RED 源头：修前 `check_common` 显式报
    「kind='mock_test' 目前只允许 'practice'（mock_test 预留）」。
    """
    _set_module_dirs(tmp_path)
    _write_set(tmp_path, "listening", _mock_listening_doc())
    code, out = _run(tmp_path)
    assert "mock_test 预留" not in out, out
    assert "kind=" not in out, f"mock_test 仍被拒：{out}"
    assert "sections_covered" not in out, out
    assert "li_mock_campus_01" not in out, f"合格 mock_test 被拒：{out}"


def test_mock_test题数不是40被拒(tmp_path: Path):
    """§2-L：mock_test 必须 40 题。"""
    _set_module_dirs(tmp_path)
    doc = _mock_listening_doc()
    doc["questions"] = doc["questions"][:20]
    for n, q in enumerate(doc["questions"], 1):
        q["number"] = n
    _write_set(tmp_path, "listening", doc)
    code, out = _run(tmp_path)
    assert code == 1, out
    assert "40" in out, out


def test_mock_test缺少sections_covered被拒(tmp_path: Path):
    """§2-L：mock_test 必须声明覆盖 4 个 section。"""
    _set_module_dirs(tmp_path)
    doc = _mock_listening_doc()
    doc.pop("sections_covered", None)
    _write_set(tmp_path, "listening", doc)
    code, out = _run(tmp_path)
    assert code == 1, out
    assert "sections_covered" in out, out


def test_mock_test_audio词数下限生效(tmp_path: Path):
    """§2-L：mock_test 的 audio_text 是 1100–1400 词，短了要拒。"""
    _set_module_dirs(tmp_path)
    doc = _mock_listening_doc()
    sentences, audio = _sentences(30)  # ~330 词，对 mock_test 来说太短
    doc["audio_text"] = audio
    doc["sentences"] = sentences
    _write_set(tmp_path, "listening", doc)
    code, out = _run(tmp_path)
    assert code == 1, out
    assert "词" in out, out


def test_practice仍可校验通过(tmp_path: Path):
    """既有口径不许回退：practice 20 题 + 550–700 词。"""
    _set_module_dirs(tmp_path)
    _write_set(tmp_path, "listening", _practice_listening_doc())
    code, out = _run(tmp_path)
    assert "li_s1_leisure_99" not in out, f"practice set 被拒：{out}"
    assert "550" not in out or "700" not in out, out


def test_重建manifest后mock_test进入清单(tmp_path: Path):
    """manifest 收录 mock_test（全库下限 CONTENT_FLOORS 与本规则无关，只看 mock_test 行）。"""
    _set_module_dirs(tmp_path)
    _write_set(tmp_path, "listening", _mock_listening_doc())
    _run(tmp_path, "--write-manifest")
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert MOCK_ID in manifest["sets"]["listening"], manifest
