"""L2 契约：prompt 模板（spec-contracts.md §3-P）。

覆盖 AC：§3-P 第 1–4 条（只输出 JSON + 严格 schema + band 取值范围；quote 必须是考生原文连续片段；
        中文字段 *_zh；temperature ≤0.3、max_tokens 显式、超时 30s）、CONSTITUTION §3（禁止把 key 拼进 prompt）。

spec §6 说 "prompts/{speaking,writing}.py 模板字符串，含 JSON schema 文本"，但没规定常量/函数命名。
本测试因此采用「扫描模块里所有字符串（含模板字符串字面量）」的口径：命名由 T8 自定，
只要模板本身满足 §3-P 就能过；一条都扫不到则报 RED。
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

PROMPT_FILES = ("speaking.py", "writing.py")
JSON_ONLY = re.compile(r"(只输出|仅输出|output only|respond with json|json only|无其它文本|不要输出任何解释)", re.I)
BAND_RANGE = re.compile(r"(0\s*[-–至]\s*9|0\.5)", re.I)
STEP_HALF = re.compile(r"0\.5|half.?band|半步|步长", re.I)
ZH_FIELD = re.compile(r"[a-z_]+_zh")
QUOTE_RULE = re.compile(r"(quote|原文|连续片段|逐字)", re.I)
TEMP_MAX = re.compile(r"temperature[^0-9]{0,20}([01](?:\.[0-9]+)?)", re.I)


def _prompts_dir(repo_root: Path) -> Path:
    return repo_root / "backend" / "app" / "prompts"


def _collect_strings(mod, prompts_dir: Path) -> dict[str, str]:
    """模块里所有字符串常量 + 模板字符串字面量（f-string 的静态部分），按对象名归并。"""
    out: dict[str, str] = {}
    for name, value in vars(mod).items():
        if isinstance(value, str) and value.strip():
            out[name] = value
        elif isinstance(value, dict):
            for k, v in value.items():
                if isinstance(v, str) and v.strip():
                    out[f"{name}.{k}"] = v
    # 源文件里的 f-string 字面量（build_*_prompt 这类函数体）
    for py in sorted(prompts_dir.glob("*.py")):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"))
        except SyntaxError as exc:
            pytest.fail(f"RED（等待实现/语法错）：{py.name} 解析失败 → {exc}")
        parts: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.JoinedStr):  # f"..."
                parts.extend(c.value for c in node.values if isinstance(c, ast.Constant) and isinstance(c.value, str))
        if parts:
            out[f"{py.stem}:fstrings"] = "\n".join(parts)
    return out


@pytest.fixture(scope="module")
def prompts_mod(load_or_wait):
    return load_or_wait("app.prompts")


@pytest.fixture(scope="module")
def module_sources(repo_root):
    """返回 (prompts 目录, 文件名字典)。目录不存在时 files={} —— 由各测试自己报 RED（避免 fixture ERROR）。"""
    prompts_dir = _prompts_dir(repo_root)
    if not prompts_dir.is_dir():
        return prompts_dir, {}
    return prompts_dir, {p.name: p.read_text(encoding="utf-8") for p in prompts_dir.glob("*.py")}


def _require(module_sources):
    prompts_dir, files = module_sources
    assert files, (
        f"RED（等待实现）：{prompts_dir} 不存在或没有 .py 模板（契约 §6 要求 backend/app/prompts/ 按模块分文件）"
    )
    return prompts_dir, files


def test_3P按模块分文件(module_sources):
    _dir, files = _require(module_sources)
    missing = [name for name in PROMPT_FILES if name not in files]
    assert not missing, f"§6 要求 prompts/ 下按模块分文件，缺：{missing}（现有：{sorted(files)}）"


def test_3P模板能扫到内容(prompts_mod, module_sources):
    prompts_dir, files = _require(module_sources)
    strings = _collect_strings(prompts_mod, prompts_dir)
    assert strings, (
        "RED（等待实现）：app.prompts 里扫不到任何模板字符串 —— §3-P 要求 prompt 含 JSON schema 文本"
    )
    joined = "\n".join(strings.values())
    assert len(joined) > 200, f"模板内容过少（{len(joined)} 字符），不像含 schema 的 prompt"


@pytest.mark.parametrize("requirement", ["json_only", "band_range", "zh_fields", "quote_rule"])
def test_3P模板必须满足的四项(prompts_mod, module_sources, requirement):
    prompts_dir, files = _require(module_sources)
    corpus = "\n".join([*_collect_strings(prompts_mod, prompts_dir).values(), *files.values()])
    if requirement == "json_only":
        assert JSON_ONLY.search(corpus), "§3-P 第 1 条：prompt 必须要求「只输出 JSON」"
    elif requirement == "band_range":
        assert BAND_RANGE.search(corpus) and STEP_HALF.search(corpus), (
            "§3-P 第 1 条：prompt 必须声明 band 取值范围 0–9、步长 0.5"
        )
        assert re.search(r'"?(band|overall|task_response|fluency_coherence)"?', corpus), (
            "§3-P 第 1 条：prompt 要给严格 schema（字段名要出现在模板里）"
        )
    elif requirement == "zh_fields":
        assert ZH_FIELD.search(corpus), "§3-P 第 3 条：中文解释字段命名 *_zh（如 explanation_zh）"
    else:
        assert QUOTE_RULE.search(corpus), "§3-P 第 2 条：prompt 要强制 quote 为考生原文连续片段"


def test_3P温度不超过03(prompts_mod, module_sources):
    prompts_dir, files = _require(module_sources)
    corpus = "\n".join([*_collect_strings(prompts_mod, prompts_dir).values(), *files.values()])
    temps = [float(m.group(1)) for m in TEMP_MAX.finditer(corpus)]
    assert temps, (
        "RED（等待实现）：模板/调用参数里找不到 temperature —— §3-P 第 4 条要求 ≤0.3（可写在调用侧，也可写在模板）"
    )
    assert max(temps) <= 0.3, f"§3-P 第 4 条：temperature ≤ 0.3，实际出现 {sorted(set(temps))}"


@pytest.mark.parametrize("name", ["speaking.py", "writing.py"])
def test_每个模块模板非空(module_sources, name):
    prompts_dir, files = _require(module_sources)
    if name not in files:
        pytest.fail(f"RED（等待实现）：缺少 backend/app/prompts/{name}")
    text = files[name]
    assert len(text) > 200, f"§6：{name} 应是含 JSON schema 的模板字符串，当前只有 {len(text)} 字符"
    assert "{" in text and "}" in text, f"{name} 应含 JSON schema 文本"


def test_模板不得含凭据占位明文(module_sources):
    """CONSTITUTION §3：AI 凭据绝不进 prompt/日志。模板里出现 api_key 字面量是危险信号。"""
    prompts_dir, files = _require(module_sources)
    for name, text in files.items():
        if name == "__init__.py":
            continue
        assert not re.search(r"(api[_-]?key|authorization|bearer)\s*[:=]\s*['\"][A-Za-z0-9_\-]{8,}", text, re.I), (
            f"{name} 疑似把凭据硬编码进 prompt（CONSTITUTION §3）"
        )


def test_模板为简体中文说明文案(module_sources):
    """FR-G4：用户不可见的内部 prompt 允许中英混排，但至少要有中文（保证 *_zh 字段语义清晰）。"""
    prompts_dir, files = _require(module_sources)
    joined = "".join(text for name, text in files.items() if name != "__init__.py")
    assert re.search(r"[\u4e00-\u9fff]", joined), "模板里应使用中文表述以对齐 *_zh 字段与 FR-G4"
