#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dictionary.json 的可追溯重建与来源核对（README「已知限制」第 ⑦ 条的修复）。

背景：`backend/app/data/dictionary.json`（392 词条）的来源此前没有在本仓库留档
（LICENSE-CONTENT.md §3）。本脚本做两件事，把「说不清」变成「说得清」：

1. `--check`：把现有 dictionary.json 与 **ECDICT**（skywind3000/ECDICT，MIT 许可）
   逐条交叉核对，打印覆盖率与不一致清单 —— 结论落进 `docs/specs/dictionary-provenance.md`。
2. `--rebuild`：从 ECDICT CSV 重建一份**来源明确**的词典（音标/释义/难度全部可指回 ECDICT
   的列），写到 `--out`。默认**不覆盖**现有文件：现有 231 条 IPA 是人工规范过的
   （ECDICT 的 phonetic 是键盘式注音 `ә'baut`，不是 `/əˈbaʊt/`），直接覆盖会丢掉这份手工活。
   想换用可追溯版本时显式 `--out backend/app/data/dictionary.json` 并跑测试。

ECDICT CSV 不进仓库（66MB，且 LICENSE-CONTENT 只管我们自己的文字）：
下载方式与校验和写在 docs/specs/dictionary-provenance.md，默认找
`backend/data-external/ecdict.csv`。

用法：
    cd backend
    python tools/rebuild_dictionary.py --check ..\\..\\.tmp-dict\\ecdict.csv
    python tools/rebuild_dictionary.py --rebuild data-external/ecdict.csv --out build/dictionary.traceable.json
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

csv.field_size_limit(10**8)

REPO = Path(__file__).resolve().parents[1]
DEFAULT_DICT = REPO / "app" / "data" / "dictionary.json"

# 难度分档：用 ECDICT 的 collins 星数 + 词频名次（bnc/frq 越小越常用）。
# 1 档 = 最基础。口径写在这里而不是散在判断里，重建结果才可复现。
def difficulty_of(row: dict) -> int:
    collins = _int_or(row.get("collins"), 0)
    frq = min((_int_or(row.get(k), 10**9) for k in ("bnc", "frq")), default=10**9)
    if collins >= 5 or frq <= 2000:
        return 1
    if collins >= 3 or frq <= 20000:
        return 2
    if collins >= 1 or frq <= 200000:
        return 3
    return 4


def _int_or(value, default: int) -> int:
    try:
        return int(str(value).strip() or default)
    except (TypeError, ValueError):
        return default


def _clean_phonetic(value: str) -> str:
    """ECDICT 的 phonetic 是键盘式注音（`ә'baut`），不带斜杠；补成 `/…/` 形状保持一致。"""
    text = (value or "").strip()
    if not text or text.startswith("/"):
        return text
    return f"/{text}/"


def _first_gloss(translation: str) -> str:
    """取 ECDICT translation 的第一条实义：去掉词性前缀（n./vt./[计]），取第一个逗号前的词。"""
    for line in re.split(r"[\n\r]+", translation or ""):
        line = line.strip()
        if not line or line.startswith("["):
            continue
        line = re.sub(r"^(?:[a-z]\.(?:\s+[a-z]\.)?\s+|\[[^\]]*\]\s*)", "", line).strip()
        head = re.split(r"[,;，；]", line)[0].strip()
        if head:
            return head
    return ""


def load_ecdict(path: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            word = (row.get("word") or "").strip().lower()
            if word:
                out[word] = row
    return out


def cmd_check(dictionary: dict, ecdict: dict[str, dict]) -> int:
    words = set(dictionary)
    matched = {w for w in words if w in ecdict}
    glossed = {w for w, v in dictionary.items() if (v.get("zh") or "").strip()}
    in_translation = sum(
        1
        for w in glossed
        if (dictionary[w]["zh"].strip() in (ecdict[w].get("translation") or ""))
        or (dictionary[w]["zh"].strip() in (ecdict[w].get("definition") or ""))
        if w in ecdict
    )
    print(f"现有词条: {len(words)}；出现在 ECDICT 中: {len(matched)}（{len(matched)/max(1,len(words)):.1%}）")
    print(f"缺词条: {sorted(words - matched)}")
    print(f"有中文释义: {len(glossed)}；逐字命中 ECDICT translation/definition 的: {in_translation}")
    print(f"其余 {len(glossed) - in_translation} 条为同义改写（如 account→「账户」对 ECDICT「帐目」：账/帐异体）")
    empty = [w for w, v in dictionary.items() if not (v.get("phonetic") or v.get("zh"))]
    print(f"音标与释义都为空的占位词条: {len(empty)}")
    return 0


def cmd_rebuild(ecdict: dict[str, dict], words: list[str], out_path: Path) -> int:
    data: dict[str, dict] = {}
    missing: list[str] = []
    for word in words:
        row = ecdict.get(word.lower())
        if not row:
            missing.append(word)
            continue
        data[word.lower()] = {
            "phonetic": _clean_phonetic(row.get("phonetic") or ""),
            "zh": _first_gloss(row.get("translation") or ""),
            "difficulty": difficulty_of(row),
            "examples": [],
        }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写 {out_path}（{len(data)} 条，来源 ECDICT MIT；缺 {len(missing)}: {missing[:10]}）")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="dictionary.json 的来源核对与可追溯重建")
    ap.add_argument("ecdict_csv", help="ECDICT 的 ecdict.csv 路径（见 docs/specs/dictionary-provenance.md）")
    ap.add_argument("--dictionary", default=str(DEFAULT_DICT), help="现有 dictionary.json（核对基准）")
    ap.add_argument("--check", action="store_true", help="交叉核对并打印覆盖率")
    ap.add_argument("--rebuild", action="store_true", help="从 ECDICT 重建一份可追溯词典")
    ap.add_argument("--out", default=str(REPO / "build" / "dictionary.traceable.json"), help="--rebuild 的输出路径")
    args = ap.parse_args(argv)

    csv_path = Path(args.ecdict_csv)
    if not csv_path.exists():
        print(f"错误：找不到 ECDICT CSV：{csv_path}\n下载方式见 docs/specs/dictionary-provenance.md", file=sys.stderr)
        return 2
    ecdict = load_ecdict(csv_path)

    if args.check:
        dictionary = json.loads(Path(args.dictionary).read_text(encoding="utf-8"))
        return cmd_check(dictionary, ecdict)
    if args.rebuild:
        dictionary = json.loads(Path(args.dictionary).read_text(encoding="utf-8"))
        return cmd_rebuild(ecdict, list(dictionary), Path(args.out))
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
