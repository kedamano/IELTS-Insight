"""题库装载与结构校验（`backend/app/data/ielts/**/*.json` → `sets` 表）。

契约：spec-contracts.md §2（内容 schema）+ §5（sets 表）；验收 test-plan §2 L4 `test_sets_loader.py`。

设计取舍（重要）：
- **只断言不变量，不断言具体条数**。内容 agent 正在并发产出这些 JSON，
  所以：目录不存在 / 文件为空 / 单条不合格 → 记录到报告并跳过该条，**绝不抛异常、绝不阻断启动**。
- **不做删除对齐**（磁盘上暂时消失/损坏的 set 不会把库里已有的行删掉），
  否则并发生成期间一次写坏文件就会把已生成的题库清掉。
- 版权守卫（CONSTITUTION §2）：出现「Cambridge IELTS / 官方真题」等来源标记的条目直接拒绝入库。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Optional

from app.db import store

MODULE_ABBR = {"speaking": "sp", "listening": "li", "reading": "re", "writing": "wr"}
# 契约 §2 的 id 规则写的是 `wr_`，但 §2-W 的示例 id 是 `w1_line_energy_04`（按 task 编号）。
# 这里同时接受 wr_/w1_/w2_，并把该矛盾原样上报给主控。
WRITING_ID_PREFIXES = ("wr_", "w1_", "w2_")

LISTENING_TYPES = {"gap_fill", "multiple_choice", "matching", "map_diagram_label"}
READING_TYPES = {
    "true_false_notgiven",
    "multiple_choice",
    "heading_match",
    "sentence_completion",
    "gap_fill",
}
CHART_TYPES = {"line", "bar", "pie", "table", "dynamic_chart"}
TASK2_TYPES = {
    "agree_disagree",
    "discuss_both_views",
    "advantages_disadvantages",
    "problem_solution",
    "two_part_question",
}
KINDS = {"practice", "mock_test"}

READING_WORD_COUNT_RANGE = (800, 950)

# 版权来源标记（CONSTITUTION §2：严禁复制剑桥/官方真题原文）
COPYRIGHT_MARKERS = (
    "cambridge ielts",
    "official ielts",
    "ielts.org sample",
    "剑雅",
    "剑桥雅思",
    "官方真题",
)

_DIR_MODULES = ("speaking", "listening", "reading", "writing")


def data_root() -> Path:
    """PyInstaller 打包后的数据根目录（与其它服务一致的 `sys._MEIPASS` 约定）。"""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "app" / "data" / "ielts"
    return Path(__file__).resolve().parents[1] / "data" / "ielts"


def _iter_records(payload: Any, file_hint: str) -> list[dict[str, Any]]:
    """一个 JSON 文件可以是：单个 set、set 数组、或 {"sets": [...]}。"""
    if isinstance(payload, dict) and isinstance(payload.get("sets"), list):
        items = payload["sets"]
    elif isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        items = [payload]
    else:
        return []
    out = []
    for item in items:
        if isinstance(item, dict):
            out.append(item)
        else:
            out.append({"_invalid_shape": True, "_file": file_hint})
    return out


def _check_common(record: dict[str, Any], module_hint: Optional[str]) -> tuple[list[str], str, str]:
    errors: list[str] = []
    record_id = record.get("id")
    module = record.get("module") or module_hint
    if record.get("_invalid_shape"):
        return ["记录不是 JSON 对象"], str(module or ""), str(record_id or "")
    if not isinstance(record_id, str) or not record_id.strip():
        errors.append("缺少 id")
    if module not in store.MODULES:
        errors.append(f"module 非法：{module!r}（应为 {', '.join(store.MODULES)}）")
    elif isinstance(record_id, str) and record_id:
        prefix = MODULE_ABBR.get(module, "")
        allowed = (f"{prefix}_",) if module != "writing" else WRITING_ID_PREFIXES
        if not record_id.startswith(allowed):
            errors.append(f"id 前缀与模块不符：{record_id}（应以 {'/'.join(allowed)} 开头）")
    for key in ("kind", "target_band", "source", "generated_at"):
        if key not in record or record[key] in (None, ""):
            errors.append(f"缺少 {key}")
    kind = record.get("kind")
    if kind is not None and kind not in KINDS:
        errors.append(f"kind 非法：{kind!r}（应为 practice / mock_test）")
    band = record.get("target_band")
    if isinstance(band, (int, float)) and not (0.0 <= float(band) <= 9.0):
        errors.append(f"target_band 越界：{band}")
    if "title_zh" not in record:
        errors.append("缺少 title_zh")
    return errors, str(module or ""), str(record_id or "")


def _copyright_scan(record: dict[str, Any]) -> Optional[str]:
    blob = json.dumps(record, ensure_ascii=False).lower()
    for marker in COPYRIGHT_MARKERS:
        if marker in blob:
            return f"疑似含版权来源标记「{marker}」（CONSTITUTION §2）"
    return None


def _check_speaking(record: dict[str, Any]) -> list[str]:
    """口语结构校验。

    契约 §2-S 把一个 set 画成 part1+part2+part3 混在一起，但 FR-S1 的量（Part 1 40 话题、
    Part 2 20 题卡、Part 3 每卡 3 追问）和示例 id `sp_p2_*` 都指向「按 part 分文件」。
    内容 agent 产出的正是后者（带 `part: 1|2|3`）。这里**两种都接受**，
    只校验「出现的那部分」的结构，不断言条数（test-plan §1「断言过死」的教训）。
    """
    errors: list[str] = []
    part = record.get("part")
    mixed = part not in (1, 2, 3, "1", "2", "3")
    part = None if mixed else int(part)

    part1 = record.get("part1")
    part2 = record.get("part2")
    part3 = record.get("part3")

    if not any(isinstance(x, (list, dict)) and x for x in (part1, part2, part3)):
        errors.append("part1/part2/part3 至少要有一个非空")

    if part1 is not None:
        if not isinstance(part1, list) or not part1:
            errors.append("part1 必须是非空数组")
        else:
            for i, q in enumerate(part1):
                if not isinstance(q, dict) or not q.get("question") or not q.get("id"):
                    errors.append(f"part1[{i}] 缺少 id/question")

    if part2 is not None:
        if not isinstance(part2, dict) or not isinstance(part2.get("cue_card"), dict):
            errors.append("part2.cue_card 缺失")
        else:
            card = part2["cue_card"]
            for key in ("prompt", "bullets", "preparation_sec", "speaking_sec"):
                if key not in card:
                    errors.append(f"part2.cue_card 缺少 {key}")
            if not isinstance(card.get("bullets"), list) or not card.get("bullets"):
                errors.append("part2.cue_card.bullets 必须是非空数组")

    if part3 is not None:
        if not isinstance(part3, list) or not part3:
            errors.append("part3 必须是非空数组")
        elif len(part3) < 3:
            errors.append(f"part3 追问不足 3 个（当前 {len(part3)}）")
        else:
            for i, q in enumerate(part3):
                if not isinstance(q, dict) or not q.get("question") or not q.get("id"):
                    errors.append(f"part3[{i}] 缺少 id/question")

    if mixed and not (isinstance(part1, list) and part1 and isinstance(part2, dict)):
        errors.append("无 part 字段的 set 必须同时提供 part1 与 part2（契约 §2-S 的完整形态）")
    if "fallback_questions" in record and not isinstance(record["fallback_questions"], list):
        errors.append("fallback_questions 应为数组（AC-S6 离线兜底）")
    return errors


def _check_listening(record: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(record.get("audio_text"), str) or not record["audio_text"].strip():
        errors.append("缺少 audio_text（edge-tts 合成源）")
    sentences = record.get("sentences")
    if not isinstance(sentences, list) or not sentences:
        errors.append("缺少 sentences[]（逐句重听时间轴锚点，FR-L4）")
    else:
        for i, s in enumerate(sentences):
            if not isinstance(s, dict) or "text" not in s or "anchor_sec" not in s:
                errors.append(f"sentences[{i}] 需含 text 与 anchor_sec")
    questions = record.get("questions")
    if not isinstance(questions, list) or not questions:
        errors.append("questions 必须是非空数组")
        return errors
    for q in questions:
        if not isinstance(q, dict):
            errors.append("question 不是对象")
            continue
        qid = q.get("id", "?")
        if not q.get("id") or q.get("number") is None or not q.get("prompt"):
            errors.append(f"题 {qid} 缺少 id/number/prompt")
        if q.get("type") not in LISTENING_TYPES:
            errors.append(f"题 {qid} 题型非法：{q.get('type')!r}")
        if "answer" not in q or q.get("answer") in (None, ""):
            errors.append(f"题 {qid} 缺少 answer（判分必需）")
        if q.get("type") == "gap_fill" and "word_limit" not in q:
            errors.append(f"题 {qid} gap_fill 缺少 word_limit")
        if q.get("type") in ("multiple_choice", "map_diagram_label") and not (
            q.get("options") or q.get("options_list") or q.get("labels")
        ):
            errors.append(f"题 {qid} 缺少选项/标签列表")
    return errors


def _check_reading(record: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    low, high = READING_WORD_COUNT_RANGE
    declared = record.get("word_count")
    if not isinstance(declared, int):
        errors.append("缺少 word_count（整数）")
    else:
        if not low <= declared <= high:
            errors.append(f"word_count {declared} 不在 {low}–{high} 区间")
    paragraphs = (record.get("passage") or {}).get("paragraphs") if isinstance(record.get("passage"), dict) else None
    if not isinstance(paragraphs, list) or not paragraphs:
        errors.append("缺少 passage.paragraphs[]")
    else:
        labels = []
        texts = []
        for i, p in enumerate(paragraphs):
            if not isinstance(p, dict) or not p.get("label") or not p.get("text"):
                errors.append(f"passage.paragraphs[{i}] 需含 label 与 text")
                continue
            labels.append(p["label"])
            texts.append(p["text"])
        if len(labels) != len(set(labels)):
            errors.append("段落 label 重复")
        actual = sum(len(re.findall(r"[A-Za-z][A-Za-z'-]*", t)) for t in texts)
        if actual and isinstance(declared, int) and abs(actual - declared) > max(60, declared * 0.15):
            errors.append(f"word_count 声明 {declared} 与实际 {actual} 不符（差 >15%）")
    questions = record.get("questions")
    if not isinstance(questions, list) or not questions:
        errors.append("questions 必须是非空数组")
        return errors
    if isinstance(declared, int) and low <= declared <= high and len(questions) != 13:
        # AC-R1 是「1 篇 + 13 题」；这是结构不变量而非内容条数，仍然校验
        errors.append(f"阅读题目数应为 13（当前 {len(questions)}）")
    for q in questions:
        if not isinstance(q, dict):
            errors.append("question 不是对象")
            continue
        qid = q.get("id", "?")
        if not q.get("id") or q.get("number") is None:
            errors.append(f"题 {qid} 缺少 id/number")
        if q.get("type") not in READING_TYPES:
            errors.append(f"题 {qid} 题型非法：{q.get('type')!r}")
        if "answer" not in q or q.get("answer") in (None, ""):
            errors.append(f"题 {qid} 缺少 answer")
        if not q.get("explanation_zh"):
            errors.append(f"题 {qid} 缺少 explanation_zh（AC-R4）")
        if q.get("type") == "heading_match" and not q.get("options_headings"):
            errors.append(f"题 {qid} heading_match 缺少 options_headings")
    return errors


def _check_writing(record: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    task = record.get("task")
    if task not in ("task1", "task2"):
        errors.append(f"task 非法：{task!r}")
        return errors
    if not record.get("prompt"):
        errors.append("缺少 prompt")
    if not isinstance(record.get("min_words"), int):
        errors.append("缺少 min_words")
    if record.get("time_recommend_sec") is None:
        errors.append("缺少 time_recommend_sec")
    if task == "task1":
        chart = record.get("chart")
        if not isinstance(chart, dict):
            errors.append("task1 缺少 chart")
            return errors
        inner = chart.get("data") if isinstance(chart.get("data"), dict) else chart
        if not inner.get("series"):
            errors.append("task1 chart 缺少 series（AC-W1 要求 chart.data.series）")
        if inner.get("type") not in CHART_TYPES and chart.get("type") not in CHART_TYPES:
            errors.append(f"chart.type 非法：{inner.get('type') or chart.get('type')!r}")
        if not (inner.get("years") or inner.get("labels") or chart.get("years") or chart.get("labels")):
            errors.append("chart 缺少 years/labels")
    else:
        if record.get("question_type") not in TASK2_TYPES:
            errors.append(f"question_type 非法：{record.get('question_type')!r}")
        if not isinstance(record.get("outline_hint"), list):
            errors.append("task2 缺少 outline_hint 数组")
    return errors


_CHECKERS = {
    "speaking": _check_speaking,
    "listening": _check_listening,
    "reading": _check_reading,
    "writing": _check_writing,
}


def validate_record(record: dict[str, Any], module_hint: Optional[str] = None) -> list[str]:
    """返回不变量违规列表（空 = 合格）。"""
    errors, module, _ = _check_common(record, module_hint)
    if errors:
        return errors
    marker = _copyright_scan(record)
    if marker:
        return [marker]
    return _CHECKERS[module](record)


def _module_from_path(path: Path, root: Path) -> Optional[str]:
    parts = [p.lower() for p in path.relative_to(root).parts[:-1]]
    for part in parts:
        if part in _DIR_MODULES:
            return part
    return None


# 内容 agent 的元数据文件（不是 set，不参与 schema 校验）
META_FILES = {"manifest.json"}


def iter_files(root: Path) -> Iterable[Path]:
    return sorted(
        p
        for p in root.rglob("*.json")
        if p.is_file() and p.name not in META_FILES and not p.name.startswith("_")
    )


def load_sets(root: Optional[Path] = None) -> dict[str, Any]:
    """装载题库，返回报告（不抛异常）。"""
    report: dict[str, Any] = {
        "data_dir": "",
        "exists": False,
        "files": 0,
        "loaded": 0,
        "rejected": 0,
        "counts": {module: 0 for module in store.MODULES},
        "errors": [],
    }
    base = root or data_root()
    report["data_dir"] = str(base)
    if not base.exists():
        report["errors"].append({"file": str(base), "id": None, "error": "题库目录尚不存在（内容 agent 未产出）"})
        print(f"[Sets] 题库目录不存在，跳过装载：{base}", flush=True)
        return report
    if not any(iter_files(base)):
        report["errors"].append({"file": str(base), "id": None, "error": "题库目录为空"})
        print(f"[Sets] 题库目录为空：{base}", flush=True)
        return report

    for path in iter_files(base):
        report["files"] += 1
        hint = _module_from_path(path, base)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            report["errors"].append({"file": path.name, "id": None, "error": f"JSON 解析失败：{exc}"})
            continue
        except (OSError, UnicodeDecodeError) as exc:
            report["errors"].append({"file": path.name, "id": None, "error": f"读取失败：{exc}"})
            continue

        for record in _iter_records(payload, path.name):
            record_id = record.get("id") if isinstance(record, dict) else None
            module_hint = hint or (record.get("module") if isinstance(record, dict) else None)
            problems = validate_record(record, module_hint)
            if problems:
                report["rejected"] += 1
                report["errors"].append({"file": path.name, "id": record_id, "error": "；".join(problems[:4])})
                continue
            try:
                store.upsert_set(record)
            except Exception as exc:  # 单条写库失败不能拖垮启动
                report["rejected"] += 1
                report["errors"].append({"file": path.name, "id": record_id, "error": f"写库失败：{exc}"})
                continue
            report["loaded"] += 1

    counts = store.refresh_sets_meta()
    report["counts"] = counts
    summary = ", ".join(f"{m}:{counts.get(m, 0)}" for m in store.MODULES)
    print(
        f"[Sets] 文件 {report['files']} 个，装载 {report['loaded']} 条，拒绝 {report['rejected']} 条（{summary}）",
        flush=True,
    )
    for item in report["errors"][:20]:
        print(f"[Sets] 跳过 {item['file']} {item['id']}: {item['error']}", flush=True)
    if len(report["errors"]) > 20:
        print(f"[Sets] 其余 {len(report['errors']) - 20} 条问题见返回报告", flush=True)
    return report
