#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""增量生成 IELTS 题库 set（OpenAI 兼容端点），离线优先：不调网时可用 --dry-run / --mock。

用法：
    cd backend
    export OPENAI_API_KEY=...            # 只从环境读取，绝不写日志、绝不回显
    export OPENAI_BASE_URL=https://...   # 可选，默认 https://api.openai.com/v1
    export OPENAI_MODEL=glm-4.6          # 可选
    python tools/gen_ielts_bank.py --module speaking --part 2 --count 2 --target-band 6.5
    python tools/gen_ielts_bank.py --module reading --count 1 --dry-run      # 只打印 prompt
    python tools/gen_ielts_bank.py --module writing --task task1 --mock one.json --out /tmp/x

行为约定（CONSTITUTION §2/§3、spec-contracts.md §2、§3-P）：
  * 每个 set 一个文件 `app/data/ielts/<module>/<id>.json`，2 空格缩进 + LF（由校验器把关）；
  * 写入前先用 validate_ielts_data 的同一套规则校验，不合格直接拒绝入库并打印原因；
  * 幂等：同 id 覆盖；`"source": "hand"` 的手工内容永不覆盖（--force 也不能）；
  * 产出统一记录 `source = "ai:<model>"` 与 `generated_at`（UTC ISO-8601）；
  * 解析失败重试 1 次；温度 0.3、max_tokens 显式、超时 30s；
  * 严禁复制剑桥雅思/官方真题：提示词里硬性要求原创，且产出文本命中禁用词即拒绝。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BACKEND, "tools"))
sys.path.insert(0, BACKEND)  # 仓库根：让 `app.*` 可导入
import validate_ielts_data as V  # noqa: E402  同目录工具，复用同一套 schema 规则
from app.prompts import content as P  # noqa: E402  schema 提示词唯一真源（契约 §17.2）

DEFAULT_OUT = os.path.join(BACKEND, "app", "data", "ielts")
DEFAULT_BASE_URL = "https://api.openai.com/v1"
TIMEOUT_SEC = 30
MAX_TOKENS = 6000
TEMPERATURE = 0.3

BANDS = P.BANDS

# schema 提示词全部来自 `app.prompts.content`（CLI 与端点共用，防漂移：两份规则各存一份
# 的结局是 CLI 生成的题过了更严的校验、端点生成的过不了装载，用户只看到「生成失败」）。
# 注意 §17.2 的「LLM 只经 ai_client」约束的是**端点路径**（进程内凭据与脱敏纪律）；
# CLI 跑在 app 进程外，保留 urllib 直连通道 —— 它读的是同一份提示词，不是同一个客户端。
LEGAL = P.LEGAL
OUTPUT_RULES = P.OUTPUT_RULES
COMMON_HEADER = P.COMMON_HEADER
SCHEMAS = P.SCHEMAS


def utc_now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_prompt(module, band, topic_hint, part=None, task=None):
    topic = ("Topic area: %s. " % topic_hint) if topic_hint else \
        "Choose a topic that no other set in this bank uses; vary the subject field.\n"
    extra = ""
    if module == "speaking":
        extra = "Generate a Part %s set. " % (part or 2)
    if module == "writing":
        extra = "Generate a Task %s. " % (task or "1")
    return (LEGAL + OUTPUT_RULES + COMMON_HEADER + SCHEMAS[module] + "\n"
            "TASK: %sTarget band %s (make the difficulty match that band; 7.5 sets need denser "
            "distractors and less signposted vocabulary). %sEmit only the JSON object."
            % (extra, band, topic))


def mask(text, key):
    if not key:
        return text
    return re.sub(re.escape(key), "***REDACTED***", str(text))


def chat(model, prompt, key, base_url):
    url = base_url.rstrip("/") + "/chat/completions"
    body = {"model": model, "temperature": TEMPERATURE, "max_tokens": MAX_TOKENS,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json",
                                        "Authorization": "Bearer %s" % key})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(mask("上游 HTTP %s（%s）" % (exc.code, exc.reason), key))
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(mask("网络失败：%s" % (exc.reason if isinstance(exc, urllib.error.URLError) else exc,), key))
    except ValueError as exc:
        raise RuntimeError(mask("上游返回不是 JSON：%s" % exc, key))
    try:
        return payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("上游响应缺少 choices[0].message.content")


def extract_json(text):
    """解析模型输出；容忍 ```json 围栏与前后杂句（但要求整体是单个对象）。"""
    s = (text or "").strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.S)
    start, end = s.find("{"), s.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("输出中没有 JSON 对象")
    return json.loads(s[start:end + 1])


def validate_candidate(obj, module, out_dir, model, rep):
    """用与 validate_ielts_data.py 完全相同的规则校验候选 set。不合格返回 None（不入库）。"""
    errors_before = len(rep.errors)
    if not isinstance(obj, dict):
        rep.err("-", "模型输出不是 JSON 对象")
        return None
    obj["module"] = module
    obj["kind"] = obj.get("kind") or "practice"
    obj["source"] = "ai:%s" % model
    obj["generated_at"] = utc_now()
    sid = str(obj.get("id", ""))
    if not sid:
        rep.err("-", "缺少 id，无法确定文件名")
        return None
    if not str(obj.get("topic", "")).strip():
        obj["topic"] = re.sub(r"^(sp_p[123]|li_[a-z0-9]+|re_[a-z0-9]+|wr_t[12])_", "", sid).rsplit("_", 1)[0]
    where, texts = V.check_common(module, os.path.join(out_dir, module, sid + ".json"), obj, rep)
    checker = {"speaking": V.check_speaking, "listening": V.check_listening,
               "reading": V.check_reading, "writing": V.check_writing,
               "sparring": V.check_sparring}[module]
    try:
        checker(where, obj, rep)
    except (KeyError, TypeError, AttributeError) as exc:
        rep.err(where, "结构异常：%s" % exc)
    blob = json.dumps(obj, ensure_ascii=False).lower()
    for term in V.FORBIDDEN:
        if term in blob:
            rep.err(where, "产出含禁用来源词 %r，拒绝入库（CONSTITUTION §2）" % term)
    if len(rep.errors) > errors_before:
        return None
    return sid


def write_set(obj, module, out_dir, force, rep):
    path = os.path.join(out_dir, module, obj["id"] + ".json")
    if os.path.exists(path):
        try:
            existing = json.loads(open(path, "rb").read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            rep.err(path, "同名文件已存在但无法解析，拒绝覆盖")
            return None
        if existing.get("source") == "hand" and not force:
            print("跳过 %s：手工撰写（source=hand）的内容不被生成器覆盖" % obj["id"])
            return None
        if existing.get("source") == "hand" and force:
            rep.err(path, "拒绝覆盖 source=hand 的手工内容（--force 对这类文件无效）")
            return None
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print("写入 %s" % path)
    return path


def from_mock(path):
    raw = open(path, "rb").read().decode("utf-8")
    data = json.loads(raw)
    return data if isinstance(data, list) else [data]


def main(argv=None):
    ap = argparse.ArgumentParser(description="按 spec-contracts.md §2 增量生成 IELTS set")
    # sparring 也在列：端点（§17）能生成陪练话题，CLI 不该是更窄的那条路
    ap.add_argument("--module", required=True, choices=(*V.MODULES, "sparring"))
    ap.add_argument("--count", type=int, default=1, help="生成几个 set")
    ap.add_argument("--target-band", type=float, dest="band", default=None)
    ap.add_argument("--topic", default=None, help="限定话题领域（英文 slug 或中文描述）")
    ap.add_argument("--part", type=int, choices=(1, 2, 3), default=None, help="口语：Part 1/2")
    ap.add_argument("--task", choices=("task1", "task2"), default=None, help="写作：Task 1/2")
    ap.add_argument("--out", default=DEFAULT_OUT, help="题库目录，默认 backend/app/data/ielts")
    ap.add_argument("--dry-run", action="store_true", help="只打印提示词，不调用网络、不写文件")
    ap.add_argument("--mock", default=None, help="从文件读取模型输出（单个对象或数组），离线测试用")
    ap.add_argument("--force", action="store_true", help="允许覆盖既有 ai:* 文件")
    ap.add_argument("--no-manifest", action="store_true", help="生成后不重写 manifest.json")
    args = ap.parse_args(argv)

    out_dir = os.path.abspath(args.out)
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    base_url = os.environ.get("OPENAI_BASE_URL", DEFAULT_BASE_URL)
    key = os.environ.get("OPENAI_API_KEY", "").strip()

    bands = [args.band] * args.count if args.band else [BANDS[i % 3] for i in range(args.count)]
    prompts = [build_prompt(args.module, b, args.topic, args.part, args.task) for b in bands]
    if args.dry_run:
        for i, p in enumerate(prompts, 1):
            print("---- prompt %d (%s, band %s) ----\n%s" % (i, args.module, bands[i - 1], p))
        print("（dry-run：未调用网络）模型=%s base_url_host=%s"
              % (model, re.sub(r"^https?://", "", base_url).split("/")[0]))
        return 0
    if not args.mock and not key:
        print("错误：未设置 OPENAI_API_KEY。离线时请用 --dry-run 或 --mock。")
        return 2

    rep = V.Report()
    written, candidates = [], []
    sources = from_mock(args.mock) if args.mock else None
    for i in range(args.count):
        obj = None
        if sources is not None:
            if i >= len(sources):
                continue
            obj = sources[i]
        else:
            for attempt in (1, 2):  # 解析失败重试 1 次（§3-P）
                try:
                    obj = extract_json(chat(model, prompts[i], key, base_url))
                    break
                except (ValueError, RuntimeError) as exc:
                    print("第 %d 个 set：第 %d 次尝试失败 -> %s" % (i + 1, attempt, mask(exc, key)))
                    obj = None
        if obj is None:
            rep.err(args.module, "第 %d 个 set 生成失败，跳过" % (i + 1))
            continue
        if validate_candidate(obj, args.module, out_dir, model, rep):
            candidates.append(obj)
        else:
            print("第 %d 个候选未通过契约校验，已拒绝写入" % (i + 1))

    for obj in candidates:
        path = write_set(obj, args.module, out_dir, args.force, rep)
        if path:
            written.append(path)

    if written and not args.no_manifest:
        sets = []
        # 与 V.MODULES + sparring 全部目录对齐（manifest 的语义是「题库目录的索引」，§16.1）
        for module in (*V.MODULES, "sparring"):
            d = os.path.join(out_dir, module)
            if not os.path.isdir(d):
                continue
            for name in sorted(os.listdir(d)):
                if name.endswith(".json"):
                    try:
                        sets.append((module, os.path.join(d, name),
                                     json.loads(open(os.path.join(d, name), "rb").read().decode("utf-8"))))
                    except (ValueError, UnicodeDecodeError):
                        pass
        print("已刷新 %s" % V.write_manifest(out_dir, sets))

    for line in rep.warnings:
        print(line)
    for line in rep.errors:
        print(line)
    print("完成：生成并通过校验 %d 个 set（请求 %d）" % (len(written), args.count))
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
