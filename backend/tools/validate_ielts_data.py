#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验 `backend/app/data/ielts/**` 题库是否满足 spec-contracts.md §2 与 spec-product.md 的内容下限。

只依赖标准库（不引入 jsonschema/pytest 依赖），可独立运行：

    cd backend && python tools/validate_ielts_data.py
    cd backend && python tools/validate_ielts_data.py --write-manifest   # 重建 manifest.json

任一检查失败 → 打印可读中文消息并以非 0 退出码结束（供 pytest / scripts/check.sh 复用）。
检查项（与 CONTENT_FLOORS 对应，只增不减）：
  * 文件层：UTF-8、LF、2 空格缩进、文件名 = id、每个 set 一个文件、id 全局唯一
  * 公共头：module/kind/target_band/title_zh/topic/source/generated_at 与 id 前缀规则
  * 口语：Part 1 ≥12 话题（每话题 3 问）、Part 2 ≥6 题卡（60s/120s + 3 追问 + fallback）、band 覆盖 5.5/6.5/7.5
  * 听力：≥2 set × 20 题、audio_text 550–700 词、sentences 锚点单调递增、gap_fill 有 word_limit 与
          accepted_alternatives、答案（或其变体）确实出现在 audio_text 中
  * 阅读：≥2 set × 13 题、篇章 800–950 词且 word_count 与实际一致、answer_quote 是所指段落的逐字子串
  * 写作：≥3 Task1（chart 五类之一，series 与 labels 等长、pie 合计 100%）+ ≥3 Task2（question_type 合法）
  * 合法性：不得出现「Cambridge IELTS / Official IELTS / 剑桥雅思 / 真题」等来源标注（CONSTITUTION §2）
  * manifest.json：按模块列出全部 set id，且与目录实际文件一一对应
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from collections import Counter

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATA = os.path.join(BACKEND, "app", "data", "ielts")

MODULES = ("speaking", "listening", "reading", "writing")
MODULE_ABBR = {"speaking": "sp", "listening": "li", "reading": "re", "writing": "wr"}
ID_RES = {
    "speaking": re.compile(r"^sp_p[123]_[a-z][a-z0-9_]*_\d{2}$"),
    "listening": re.compile(r"^li_[a-z][a-z0-9]*_[a-z][a-z0-9_]*_\d{2}$"),
    "reading": re.compile(r"^re_[a-z][a-z0-9]*_[a-z][a-z0-9_]*_\d{2}$"),
    "writing": re.compile(r"^wr_t[12]_[a-z][a-z0-9_]*_\d{2}$"),
}
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
BANDS = {5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0}
LI_TYPES = {"gap_fill", "multiple_choice", "matching", "map_diagram_label"}
RE_TYPES = {"true_false_notgiven", "heading_match", "sentence_completion",
            "multiple_choice", "gap_fill"}
CHART_TYPES = {"line", "bar", "pie", "table", "dynamic_chart"}
ESSAY_TYPES = {"agree_disagree", "discuss_both_views", "advantages_disadvantages",
               "problem_solution", "two_part_question"}
LEVELS = {"beginner", "intermediate", "upper-intermediate", "advanced"}
TFNG = {"TRUE": "A", "FALSE": "B", "NOTGIVEN": "C"}
HEADERS = ("id", "module", "kind", "target_band", "title_zh", "topic", "source", "generated_at")
FORBIDDEN = ("cambridge ielts", "official ielts", "ielts authentic", "cambridge grammar",
             "real exam material", "剑桥雅思", "官方真题", "真题还原")
CAUTION = ("cambridge", "剑橋", "剑桥")
FLOORS = {"speaking_part1": 12, "speaking_part2": 6, "listening": 2, "reading": 2,
          "writing_task1": 3, "writing_task2": 3}
WORDS = re.compile(r"\S+")


def word_count(text):
    return len(WORDS.findall(text or ""))


def letter_of(opt):
    m = re.match(r"\s*([A-Z])[\.\):\- ]", str(opt) + " ")
    return m.group(1) if m else str(opt).strip()


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def err(self, where, msg):
        self.errors.append("错误 [%s] %s" % (where, msg))

    def warn(self, where, msg):
        self.warnings.append("警告 [%s] %s" % (where, msg))


def load_sets(data_dir, rep):
    """读取四个模块子目录（manifest.json 在根目录，不参与 set 校验）。"""
    sets = []
    for module in MODULES:
        d = os.path.join(data_dir, module)
        if not os.path.isdir(d):
            rep.err(d, "模块目录不存在")
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".json"):
                rep.warn(os.path.join(d, name), "非 .json 文件被忽略")
                continue
            path = os.path.join(d, name)
            raw = open(path, "rb").read()
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                rep.err(path, "文件不是合法 UTF-8（中文解析会乱码）")
                continue
            try:
                obj = json.loads(text)
            except ValueError as exc:
                rep.err(path, "JSON 解析失败：%s" % exc)
                continue
            canonical = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
            if text != canonical:
                rep.err(path, "格式不符：必须 2 空格缩进、LF 换行、文件末尾换行、非 ASCII 不转义")
            if "\t" in text:
                rep.err(path, "包含制表符，缩进必须为空格")
            if "\r" in raw.decode("latin-1"):
                rep.err(path, "包含 CRLF 换行，必须使用 LF")
            sets.append((module, path, obj))
    return sets


def check_common(module, path, obj, rep):
    where = os.path.basename(path)
    for key in HEADERS:
        if key not in obj:
            rep.err(where, "缺少公共头字段 %s" % key)
    if obj.get("module") != module:
        rep.err(where, "module=%r 与所在目录 %s 不一致" % (obj.get("module"), module))
    if obj.get("kind") != "practice":
        rep.err(where, "kind=%r 目前只允许 'practice'（mock_test 预留）" % obj.get("kind"))
    band = obj.get("target_band")
    if not isinstance(band, (int, float)) or isinstance(band, bool) or float(band) not in BANDS:
        rep.err(where, "target_band=%r 必须是 5.0–9.0 的 0.5 步长数值" % (band,))
    if not str(obj.get("title_zh", "")).strip():
        rep.err(where, "title_zh 不能为空")
    if not str(obj.get("topic", "")).strip():
        rep.err(where, "topic 不能为空")
    if not str(obj.get("source", "")).strip():
        rep.err(where, "source 不能为空（CONSTITUTION §2 要求可追溯）")
    if not ISO_RE.match(str(obj.get("generated_at", ""))):
        rep.err(where, "generated_at=%r 必须是 ISO-8601 UTC（以 Z 结尾）" % (obj.get("generated_at"),))
    sid = str(obj.get("id", ""))
    if not sid:
        rep.err(where, "id 为空")
        return where, []
    if not ID_RES[module].match(sid):
        rep.err(where, "id=%r 不符合规则 {abbr}_{part|kind}_{topic}_{nn}（应匹配 %s）"
                % (sid, ID_RES[module].pattern))
    stem = os.path.basename(path)[:-5]
    if stem != sid:
        rep.err(where, "文件名 %s.json 与 id=%r 不一致" % (stem, sid))
    texts = [json.dumps(obj, ensure_ascii=False)]
    return where, texts


def check_questions(where, questions, rep, module):
    if not isinstance(questions, list) or not questions:
        rep.err(where, "questions 必须是非空数组")
        return []
    ids, numbers = [], []
    for q in questions:
        qid = q.get("id")
        if not isinstance(qid, str) or not qid:
            rep.err(where, "存在缺少 id 的题目")
            continue
        ids.append(qid)
        numbers.append(q.get("number"))
        if not str(q.get("prompt", "") or q.get("statement", "") or
                   q.get("question", "")).strip():
            rep.err(where, "%s 缺少题干（prompt/statement 为空）" % qid)
        if not str(q.get("explanation_zh", "")).strip():
            rep.err(where, "%s 缺少 explanation_zh" % qid)
        if "answer" not in q or (isinstance(q.get("answer"), str) and not q["answer"].strip()):
            rep.err(where, "%s 的 answer 缺失或为空" % qid)
    dup = [i for i, c in Counter(ids).items() if c > 1]
    if dup:
        rep.err(where, "同一 set 内题目 id 重复：%s" % dup)
    if None in numbers:
        rep.err(where, "有题目缺少 number")
    elif len(set(numbers)) != len(numbers):
        rep.err(where, "题目 number 重复：%s" % numbers)
    return ids


def check_speaking(where, obj, rep):
    part = obj.get("part")
    p1 = obj.get("part1")
    p2 = obj.get("part2")
    if not p1 and not p2:
        rep.err(where, "既没有 part1 也没有 part2.cue_card")
    if part == 1 or (p1 and not p2):
        if not isinstance(p1, list) or len(p1) < 3:
            rep.err(where, "Part 1 set 至少要有 3 个问题，实际 %s" % (len(p1 or []),))
        else:
            seen = []
            for item in p1:
                if not str(item.get("question", "")).strip():
                    rep.err(where, "Part 1 有问题缺少 question 文本")
                seen.append(item.get("id"))
            if len(set(seen)) != len(seen):
                rep.err(where, "Part 1 问题 id 重复：%s" % seen)
            if any(not str(q).strip() for q in obj.get("fallback_questions", [""])):
                rep.err(where, "fallback_questions 含空字符串")
        if obj.get("part3"):
            rep.warn(where, "Part 1 set 同时带 part3，通常应放在 Part 2 set 里")
        return
    if part == 2 or p2:
        card = (p2 or {}).get("cue_card")
        if not isinstance(card, dict):
            rep.err(where, "Part 2 set 缺少 part2.cue_card 对象")
            return
        if not str(card.get("prompt", "")).strip():
            rep.err(where, "cue_card.prompt 为空")
        bullets = card.get("bullets")
        if not isinstance(bullets, list) or len(bullets) != 3:
            rep.err(where, "cue_card.bullets 必须是 3 条提示点，实际 %s" % (bullets,))
        elif any(not str(b).strip() for b in bullets):
            rep.err(where, "cue_card.bullets 含空字符串")
        if card.get("preparation_sec") != 60:
            rep.err(where, "preparation_sec 必须是 60，实际 %r" % (card.get("preparation_sec"),))
        if card.get("speaking_sec") != 120:
            rep.err(where, "speaking_sec 必须是 120，实际 %r" % (card.get("speaking_sec"),))
        p3 = obj.get("part3")
        if not isinstance(p3, list) or len(p3) != 3:
            rep.err(where, "Part 2 set 必须配 3 个 Part 3 追问，实际 %s" % (p3,))
        else:
            for item in p3:
                if not str(item.get("question", "")).strip():
                    rep.err(where, "Part 3 追问缺少 question")
                if item.get("depends_on_part2") is not True:
                    rep.err(where, "Part 3 追问必须标 depends_on_part2: true")
        fb = obj.get("fallback_questions")
        if not isinstance(fb, list) or len(fb) < 3:
            rep.err(where, "fallback_questions（离线兜底追问）至少 3 条，实际 %s" % (fb,))
        elif any(not str(q).strip() for q in fb):
            rep.err(where, "fallback_questions 含空字符串")


def check_listening(where, obj, rep):
    section = obj.get("section")
    if not isinstance(section, int) or not 1 <= section <= 4:
        rep.err(where, "section=%r 必须是 1–4 的整数" % (section,))
    if not str(obj.get("instruction_zh", "")).strip():
        rep.err(where, "缺少 instruction_zh（中文作答说明）")
    audio = obj.get("audio_text")
    if not isinstance(audio, str) or not audio.strip():
        rep.err(where, "audio_text 不能为空")
        return
    wc = word_count(audio)
    if not 550 <= wc <= 700:
        rep.err(where, "audio_text 共 %d 词，首轮 set 要求 550–700" % wc)
    for bad in re.findall(r"[^\x00-\x7F\u4e00-\u9fff\u2013\u2014\u2018\u2019\u2026]+",
                          audio.replace("’", "").replace("‘", "")):
        rep.warn(where, "audio_text 含可能无法被 TTS 朗读的片段：%r" % bad[:40])
    sents = obj.get("sentences")
    if not isinstance(sents, list) or len(sents) < 10:
        rep.err(where, "sentences[] 缺失或少于 10 句（逐句重听依赖时间轴）")
        sents = sents or []
    prev_anchor = -1.0
    for i, s in enumerate(sents):
        if s.get("idx") != i:
            rep.err(where, "sentences[%d].idx=%r 必须等于下标" % (i, s.get("idx")))
        if not str(s.get("text", "")).strip():
            rep.err(where, "sentences[%d].text 为空" % i)
        elif str(s["text"]) not in audio:
            rep.err(where, "sentences[%d] 的文本不是 audio_text 的子串" % i)
        anchor = s.get("anchor_sec")
        if not isinstance(anchor, (int, float)) or isinstance(anchor, bool):
            rep.err(where, "sentences[%d].anchor_sec 必须是数值" % i)
            continue
        if anchor <= prev_anchor:
            rep.err(where, "sentences[%d].anchor_sec=%s 未单调递增（上一句 %s）"
                    % (i, anchor, prev_anchor))
        prev_anchor = float(anchor)
    questions = obj.get("questions", [])
    if len(questions) not in (10, 20, 40):
        rep.err(where, "题目数量 %d 不属于 10/20/40（自学短练为 2 section × 10 题）" % len(questions))
    check_questions(where, questions, rep, "listening")
    if [q.get("number") for q in questions] != list(range(1, len(questions) + 1)):
        rep.err(where, "题目 number 必须是从 1 连续编号")
    low = audio.lower()
    for q in questions:
        qid, qtype = q.get("id"), q.get("type")
        if qtype not in LI_TYPES:
            rep.err(where, "%s 的题型 %r 不在听力枚举 %s" % (qid, qtype, sorted(LI_TYPES)))
            continue
        ans = str(q.get("answer", "")).strip()
        if qtype == "gap_fill":
            wl = q.get("word_limit")
            if not isinstance(wl, int) or isinstance(wl, bool) or wl < 1:
                rep.err(where, "%s gap_fill 缺少正整数 word_limit" % qid)
                wl = None
            alts = q.get("accepted_alternatives")
            if not isinstance(alts, list) or not alts:
                rep.err(where, "%s gap_fill 至少要有 1 个 accepted_alternatives 变体" % qid)
            else:
                if wl is not None and len(ans.split()) > wl:
                    rep.err(where, "%s 答案本身超出 word_limit" % qid)
                forms = [ans] + [str(a) for a in alts]
                if not any(f.lower() in low for f in forms):
                    rep.err(where, "%s 的答案 %r（及其变体）没有出现在 audio_text 中" % (qid, ans))
        elif qtype == "multiple_choice":
            opts = q.get("options")
            if not isinstance(opts, list) or len(opts) < 2:
                rep.err(where, "%s multiple_choice 需要至少 2 个 options" % qid)
            elif ans not in [letter_of(o) for o in opts]:
                rep.err(where, "%s 答案 %r 不在选项字母中 %s"
                        % (qid, ans, [letter_of(o) for o in opts]))
        elif qtype == "matching":
            opts = q.get("options_list")
            if not isinstance(opts, list) or len(opts) < 3:
                rep.err(where, "%s matching 需要 options_list（≥3 项，可重复使用）" % qid)
            elif ans not in [letter_of(o) for o in opts]:
                rep.err(where, "%s 答案 %r 不在 options_list 字母中" % (qid, ans))
        elif qtype == "map_diagram_label":
            labels = q.get("labels")
            if not isinstance(labels, list) or len(labels) < 2:
                rep.err(where, "%s map_diagram_label 需要 labels 字母表" % qid)
            elif ans not in [str(x).strip() for x in labels]:
                rep.err(where, "%s 答案 %r 不在 labels 中" % (qid, ans))


def check_reading(where, obj, rep):
    if obj.get("level") not in LEVELS:
        rep.err(where, "level=%r 不在 %s" % (obj.get("level"), sorted(LEVELS)))
    if obj.get("time_limit_sec") != 1200:
        rep.err(where, "time_limit_sec 必须是 1200（FR-R1 限时 20 分钟），实际 %r"
                % (obj.get("time_limit_sec"),))
    if not str(obj.get("title", "")).strip():
        rep.err(where, "阅读 set 需要英文 title")
    paras = (obj.get("passage") or {}).get("paragraphs")
    if not isinstance(paras, list) or not 5 <= len(paras) <= 8:
        rep.err(where, "passage.paragraphs 需要 5–8 段，实际 %s" % (len(paras or []),))
        paras = paras or []
    texts, joined = {}, ""
    for i, p in enumerate(paras):
        label = str(p.get("label", ""))
        if label != chr(ord("A") + i):
            rep.err(where, "第 %d 段 label=%r 应为 %r（A/B/C… 连续）" % (i + 1, label, chr(ord("A") + i)))
        if not str(p.get("text", "")).strip():
            rep.err(where, "段落 %s 为空" % label)
        texts[label] = p.get("text", "")
        joined += " " + str(p.get("text", ""))
    wc = word_count(joined)
    if obj.get("word_count") != wc:
        rep.err(where, "word_count=%r 与实际词数 %d 不符" % (obj.get("word_count"), wc))
    if not 800 <= wc <= 950:
        rep.err(where, "篇章共 %d 词，FR-R1 要求 800–950" % wc)
    questions = obj.get("questions", [])
    if len(questions) != 13:
        rep.err(where, "阅读 set 必须 13 题，实际 %d" % len(questions))
    check_questions(where, questions, rep, "reading")
    seen_types = set()
    for q in questions:
        qid, qtype = q.get("id"), q.get("type")
        seen_types.add(qtype)
        if qtype not in RE_TYPES:
            rep.err(where, "%s 的题型 %r 不在阅读枚举 %s" % (qid, qtype, sorted(RE_TYPES)))
            continue
        ap = q.get("answer_paragraph")
        if ap not in texts:
            rep.err(where, "%s answer_paragraph=%r 不是有效段落 label" % (qid, ap))
        else:
            quote = str(q.get("answer_quote", ""))
            if not quote:
                rep.err(where, "%s 缺少 answer_quote（原文定位引用）" % qid)
            elif quote not in texts[ap]:
                rep.err(where, "%s 的 answer_quote 不是段落 %s 的逐字子串：%r" % (qid, ap, quote[:70]))
        ans = str(q.get("answer", "")).strip()
        if qtype == "true_false_notgiven":
            if ans not in TFNG:
                rep.err(where, "%s answer=%r 必须是 TRUE/FALSE/NOTGIVEN" % (qid, ans))
            elif q.get("answer_label") != TFNG[ans]:
                rep.err(where, "%s answer_label=%r 应为 %r" % (qid, q.get("answer_label"), TFNG[ans]))
        elif qtype == "heading_match":
            if q.get("paragraph_label") not in texts:
                rep.err(where, "%s paragraph_label=%r 无效" % (qid, q.get("paragraph_label")))
            heads = q.get("options_headings")
            if not isinstance(heads, list) or len(heads) < 6:
                rep.err(where, "%s heading_match 需要 ≥6 条 options_headings" % qid)
            else:
                is_list = [h.get("i") for h in heads]
                if len(set(is_list)) != len(is_list):
                    rep.err(where, "%s options_headings 的 i 重复：%s" % (qid, is_list))
                if ans not in is_list:
                    rep.err(where, "%s 答案 %r 不在标题选项 %s 中" % (qid, ans, is_list))
        elif qtype in ("sentence_completion", "gap_fill"):
            if not isinstance(q.get("word_limit"), int) or q["word_limit"] < 1:
                rep.err(where, "%s %s 缺少正整数 word_limit" % (qid, qtype))
            if ans.lower() not in joined.lower():
                rep.err(where, "%s 答案 %r 没有出现在篇章中" % (qid, ans))
        elif qtype == "multiple_choice":
            opts = q.get("options")
            if not isinstance(opts, list) or len(opts) != 4:
                rep.err(where, "%s 阅读选择题应有 4 个 options" % qid)
            elif ans not in [letter_of(o) for o in opts]:
                rep.err(where, "%s 答案 %r 不在选项字母中" % (qid, ans))
    for required in ("true_false_notgiven", "heading_match", "sentence_completion", "multiple_choice"):
        if required not in seen_types:
            rep.err(where, "13 题中必须包含题型 %s" % required)


def check_writing(where, obj, rep):
    task = obj.get("task")
    if task == "task1":
        if obj.get("min_words") != 150 or obj.get("time_recommend_sec") != 1200:
            rep.err(where, "Task 1 必须 min_words=150 / time_recommend_sec=1200，实际 %r/%r"
                    % (obj.get("min_words"), obj.get("time_recommend_sec")))
        chart = obj.get("chart")
        if not isinstance(chart, dict):
            rep.err(where, "Task 1 缺少 chart 对象（前端本地 SVG 渲染依赖它）")
        else:
            ctype = chart.get("type")
            if ctype not in CHART_TYPES:
                rep.err(where, "chart.type=%r 不在 %s" % (ctype, sorted(CHART_TYPES)))
            if not str(chart.get("unit", "")).strip():
                rep.err(where, "chart.unit 缺失（轴/图例单位）")
            labels = chart.get("labels")
            if not isinstance(labels, list) or not labels:
                rep.err(where, "chart.labels 缺失")
                labels = []
            years = chart.get("years")
            if not isinstance(years, list) or not years:
                rep.err(where, "chart.years 缺失（契约 §2-W 要求 series/labels/unit/years）")
            series = chart.get("series")
            if not isinstance(series, list) or not series:
                rep.err(where, "chart.series 缺失")
                series = []
            for s in series:
                vals = s.get("values")
                if not str(s.get("name", "")).strip():
                    rep.err(where, "chart.series 有一项缺少 name")
                if not isinstance(vals, list) or not vals:
                    rep.err(where, "series %r 的 values 为空" % s.get("name"))
                    continue
                if labels and len(vals) != len(labels):
                    rep.err(where, "series %r 有 %d 个 values，但 labels 有 %d 项"
                            % (s.get("name"), len(vals), len(labels)))
                if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in vals):
                    rep.err(where, "series %r 的 values 必须全为数字" % s.get("name"))
            if ctype == "pie" and series:
                total = sum(series[0].get("values", []))
                if abs(total - 100) > 0.5:
                    rep.err(where, "pie 的 values 合计 %s，应为 100" % total)
            if not str(chart.get("source_note", "")).strip():
                rep.err(where, "chart.source_note 缺失（须标明数据为练习虚构）")
        if obj.get("band_descriptors_ref") != "task1":
            rep.err(where, "Task 1 的 band_descriptors_ref 应为 'task1'")
    elif task == "task2":
        if obj.get("min_words") != 250 or obj.get("time_recommend_sec") != 2400:
            rep.err(where, "Task 2 必须 min_words=250 / time_recommend_sec=2400，实际 %r/%r"
                    % (obj.get("min_words"), obj.get("time_recommend_sec")))
        if obj.get("question_type") not in ESSAY_TYPES:
            rep.err(where, "question_type=%r 不在 %s" % (obj.get("question_type"), sorted(ESSAY_TYPES)))
        hint = obj.get("outline_hint")
        if not isinstance(hint, list) or len(hint) < 3:
            rep.err(where, "Task 2 需要 outline_hint（≥3 条结构提示）")
        elif any(not str(h).strip() for h in hint):
            rep.err(where, "outline_hint 含空字符串")
        if obj.get("band_descriptors_ref") != "task2":
            rep.err(where, "Task 2 的 band_descriptors_ref 应为 'task2'")
    else:
        rep.err(where, "task=%r 只能是 task1 或 task2" % (task,))
    if "chart" in obj and task == "task2":
        rep.err(where, "Task 2 不应带 chart")


def check_manifest(data_dir, sets, rep):
    path = os.path.join(data_dir, "manifest.json")
    by_module = {}
    for module, _, obj in sets:
        by_module.setdefault(obj.get("module", "?"), []).append(obj.get("id"))
    for m in by_module:
        by_module[m] = sorted(by_module[m])
    if not os.path.exists(path):
        rep.err(path, "manifest.json 缺失（用 --write-manifest 生成）")
        return by_module
    text = open(path, "rb").read().decode("utf-8", errors="replace")
    try:
        man = json.loads(text)
    except ValueError as exc:
        rep.err(path, "JSON 解析失败：%s" % exc)
        return by_module
    if text != json.dumps(man, ensure_ascii=False, indent=2) + "\n":
        rep.err(path, "manifest.json 格式不符：2 空格缩进 + LF + 末尾换行")
    listed = man.get("sets") or {}
    for module in MODULES:
        want = by_module.get(module, [])
        got = sorted(listed.get(module, []))
        if want != got:
            missing = sorted(set(want) - set(got))
            extra = sorted(set(got) - set(want))
            rep.err(path, "%s 清单与目录不一致，缺少 %s，多余 %s" % (module, missing, extra))
    counts = man.get("counts") or {}
    for module in MODULES:
        if counts.get(module) != len(by_module.get(module, [])):
            rep.err(path, "counts.%s=%r 与实际 %d 不符"
                    % (module, counts.get(module), len(by_module.get(module, []))))
    return by_module


def write_manifest(data_dir, sets):
    by_module = {m: [] for m in MODULES}
    for _, _, obj in sets:
        if obj.get("module") in by_module:
            by_module[obj["module"]].append(obj["id"])
    for m in by_module:
        by_module[m] = sorted(set(by_module[m]))
    manifest = {
        "schema": "ielts-manifest/1",
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "索引文件，位于模块子目录之外；sets_loader 只加载 <module>/*.json，不要把本文件当 set。",
        "counts": {m: len(by_module[m]) for m in MODULES},
        "sets": by_module,
    }
    path = os.path.join(data_dir, "manifest.json")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description="校验 IELTS 题库（stdlib-only）")
    ap.add_argument("--data-dir", default=DEFAULT_DATA, help="默认 backend/app/data/ielts")
    ap.add_argument("--write-manifest", action="store_true", help="按目录内容重建 manifest.json")
    ap.add_argument("--quiet", action="store_true", help="只在有错误时输出")
    args = ap.parse_args(argv)

    data_dir = os.path.abspath(args.data_dir)
    if not os.path.isdir(data_dir):
        print("错误：找不到题库目录 %s" % data_dir)
        return 2
    rep = Report()
    sets = load_sets(data_dir, rep)
    if not sets:
        print("错误：%s 下没有任何 set 文件" % data_dir)
        return 2
    if args.write_manifest:
        print("已写入 %s" % write_manifest(data_dir, sets))

    ids = {}
    blobs = []
    for module, path, obj in sets:
        where, texts = check_common(module, path, obj, rep)
        blobs.extend(texts)
        sid = obj.get("id")
        if sid in ids:
            rep.err(where, "id %r 与 %s 重复（每个 set 必须一个文件且 id 唯一）" % (sid, ids[sid]))
        ids[sid] = where
        try:
            if module == "speaking":
                check_speaking(where, obj, rep)
            elif module == "listening":
                check_listening(where, obj, rep)
            elif module == "reading":
                check_reading(where, obj, rep)
            elif module == "writing":
                check_writing(where, obj, rep)
        except (KeyError, TypeError, AttributeError) as exc:
            rep.err(where, "结构异常，无法完成校验：%s" % exc)

    blob = "\n".join(blobs)
    low = blob.lower()
    for term in FORBIDDEN:
        if term.lower() in low:
            rep.err("CONSTITUTION §2", "题库文本出现来源标注/真题字样：%r" % term)
    for term in CAUTION:
        if term.lower() in low:
            rep.warn("CONSTITUTION §2", "文本含 %r，请人工确认只是地名而非真题来源" % term)

    by_module = check_manifest(data_dir, sets, rep)

    p1 = sum(1 for _, _, o in sets if o.get("module") == "speaking" and o.get("part") == 1)
    p2 = sum(1 for _, _, o in sets if o.get("module") == "speaking" and o.get("part") == 2)
    li = len(by_module.get("listening", []))
    re_ = len(by_module.get("reading", []))
    w1 = sum(1 for _, _, o in sets if o.get("task") == "task1")
    w2 = sum(1 for _, _, o in sets if o.get("task") == "task2")
    bands = sorted({o.get("target_band") for _, _, o in sets if o.get("module") == "speaking"})
    floors = {"speaking_part1": p1, "speaking_part2": p2, "listening": li, "reading": re_,
              "writing_task1": w1, "writing_task2": w2}
    for key, floor in FLOORS.items():
        if floors[key] < floor:
            rep.err("CONTENT_FLOORS", "%s=%d 低于首轮下限 %d" % (key, floors[key], floor))
    for band in (5.5, 6.5, 7.5):
        if band not in bands:
            rep.err("CONTENT_FLOORS", "口语 target_band 需要覆盖 5.5/6.5/7.5，缺 %s（现有 %s）" % (band, bands))

    if not args.quiet or rep.errors:
        print("题库目录：%s" % data_dir)
        print("文件数：%d（口语 %d / 听力 %d / 阅读 %d / 写作 %d）"
              % (len(sets), len(by_module.get("speaking", [])), li, re_,
                 len(by_module.get("writing", []))))
        print("首轮下限：Part1 话题 %d(≥12) · Part2 题卡 %d(≥6) · 听力 set %d(≥2) · 阅读 set %d(≥2) · "
              "写作 Task1 %d(≥3) Task2 %d(≥3)"
              % (p1, p2, li, re_, w1, w2))
    for line in rep.warnings:
        print(line)
    for line in rep.errors:
        print(line)
    if rep.errors:
        print("校验失败：%d 个错误、%d 个警告" % (len(rep.errors), len(rep.warnings)))
        return 1
    print("校验通过：%d 个 set，0 错误，%d 警告" % (len(sets), len(rep.warnings)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
