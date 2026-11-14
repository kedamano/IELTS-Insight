"""题库生成管线（契约 §17；CONSTITUTION §2/§3）。

CLI（`backend/tools/gen_ielts_bank.py`）与端点（`api/content.py`）共用本模块的
校验与写入纪律；schema 提示词共用 `app/prompts/content.py`。两份实现各留一份规则的
结局一定是漂移，所以这里只保留**一份**。

三条最容易做错、因此写死在这里的规则：

1. **产物写用户数据目录，不写打包资源目录**（§17.1）。冻结包里 `app/data` 在 `_MEIPASS`
   临时目录，进程退出即消失；且 `Program Files` 不可写。落 `<数据目录>/generated/ielts/`
   才同时满足「持久」与「被 §14.3 快照保护」。
2. **`source=hand` 的手工题永不覆盖**（CONSTITUTION §2 的溯源要求）。同 id 已存在
   且是 hand —— 无论 `--force` 还是端点重试，一律拒绝。
3. **版权扫描是硬闸**：产出文本命中禁用来源词即拒绝入库，与装载器同一套词表。
   提示词里的 LEGAL 段是最便宜的第一道防线，这里是第二道，两道都要过。
"""
from __future__ import annotations

import datetime as _dt
import json
import re
from pathlib import Path
from typing import Any, Optional

from app.config import settings as _cfg
from app.db import store
from app.prompts import content as content_prompts
from app.services import ai_client, faultlog, sets_loader

MODULE_CHOICES = ("speaking", "listening", "reading", "writing", "sparring")
MODULES_SET = set(MODULE_CHOICES)
MAX_COUNT = 5
MAX_TOKENS = 8000
"""生成一套完整 set（阅读含 900 词篇章）的输出预算。推理型端点要把思考预算也算进去
（§3-P 第 4 条的实测教训），给小了会 finish_reason=length 截断 JSON。"""

# 重 schema 的预算（实测 §17.5 同款）：listening 20 题 / reading 13 题 + 800–950 词篇章
# 的输出远长于 sparring/speaking，推理型端点的隐藏思考还会先吃掉一大块预算。
# 8000 在 gemini-3.8-flash 上必然截断（实测：整篇被切在 reasoning 阶段）。
HEAVY_SCHEMA_MAX_TOKENS = {
    "listening": 30000,
    "reading": 30000,
}


def max_tokens_for(module: str) -> int:
    """按模块给生成预算：重 schema 用大预算，其余用默认。"""
    return HEAVY_SCHEMA_MAX_TOKENS.get(module, MAX_TOKENS)


# 重 schema 的生成超时（秒）：实测 reading 生成 3–5 分钟，全局 AI_TIMEOUT_SEC=120
# 会把整篇截断（§17.6）。这里显式给更长超时，**不动全局默认**（那会放宽所有批改路径）。
HEAVY_SCHEMA_TIMEOUT_SEC = {
    "listening": 300,
    "reading": 300,
}


def timeout_for(module: str) -> int | None:
    """按模块给生成超时；None = 沿用全局 AI_TIMEOUT_SEC（轻 schema 与批改路径不变）。"""
    return HEAVY_SCHEMA_TIMEOUT_SEC.get(module)


class ContentError(Exception):
    """生成层的业务错误（api/content.py 转成契约 §0 的 {detail, code}）。"""

    def __init__(self, status_code: int, detail: str, code: str = "bad_request") -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code


# --------------------------------------------------------------------------
# 路径
# --------------------------------------------------------------------------

# 产物根的唯一权威在 `sets_loader.generated_root()`（装载侧与写入侧必须引用同一个函数，
# 否则「写到 A、从 B 读」这种漂移只有真跑一次才会暴露）；这里只是转发别名，
# 让调用方可以 `content_gen.generated_root()` 读代码时就近看到出处。
generated_root = sets_loader.generated_root


def _existing_source(set_id: str, module: str) -> Optional[str]:
    """同 id 现有内容的 source（先查打包根再查生成根；不存在返回 None）。"""
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", set_id) + ".json"
    for root in (sets_loader.data_root(), sets_loader.generated_root()):
        path = root / module / name
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return "unreadable"
        if isinstance(data, dict):
            return str(data.get("source") or "")
    return None


def write_set(record: dict[str, Any], module: str) -> Path:
    """写一个已通过校验的 set 到生成根（2 空格缩进 + LF + 末尾换行，与校验器口径一致）。"""
    set_id = str(record["id"])
    existing = _existing_source(set_id, module)
    if existing == "hand":
        raise ContentError(409, f"{set_id} 是手工撰写的题目（source=hand），生成器不覆盖它", "conflict")
    if existing == "unreadable":
        raise ContentError(409, f"{set_id} 的同名文件已存在但读不出来，拒绝覆盖", "conflict")
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", set_id)
    path = generated_root() / module / f"{safe}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(record, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(path)  # 原子替换：坏一半的文件不该留在题库目录里等下次启动去扫
    return path


# --------------------------------------------------------------------------
# 校验
# --------------------------------------------------------------------------

def validate_candidate(obj: Any, module: str, model: str) -> tuple[Optional[dict[str, Any]], list[str]]:
    """补齐公共字段 → 装载侧校验 → 版权扫描。返回 (可入库的记录, 拒绝原因列表)。

    模型偶发把 `id` 的 topic 段写成连字符（`neighbourhood-change`）或 `target_band`
    写成字符串（`"6.5"`）。前者静默纠正为下划线（保住一篇本来可用的内容），
    后者归一化为数值 —— 两者都在提示词里明令禁止，这里是第二道防线。
    """
    if not isinstance(obj, dict):
        return None, ["模型输出不是 JSON 对象"]
    record = dict(obj)
    record["module"] = module
    record["kind"] = record.get("kind") or "practice"
    record["source"] = "ai:%s" % model
    record["generated_at"] = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # 归一化 1：id 的连字符 → 下划线（只动 topic 段，前缀与序号保持）
    raw_id = str(record.get("id") or "").strip()
    if raw_id and "-" in raw_id:
        record["id"] = raw_id.replace("-", "_")

    # 归一化 2：target_band 字符串 → 数值（"6.5" → 6.5）
    raw_band = record.get("target_band")
    if isinstance(raw_band, str):
        try:
            record["target_band"] = float(raw_band)
        except ValueError:
            pass

    if not str(record.get("id", "")).strip():
        return None, ["缺少 id，无法确定文件名"]
    if not str(record.get("topic", "")).strip():
        sid = str(record["id"])
        record["topic"] = re.sub(r"^(sp_p[123]|li_[a-z0-9]+|re_[a-z0-9]+|wr_t[12]|sb)_[a-z0-9]*_", "", sid).rsplit("_", 1)[0] or sid
    problems = sets_loader.validate_record(record, module)
    blob = json.dumps(record, ensure_ascii=False).lower()
    for term in sets_loader.COPYRIGHT_MARKERS:
        if term in blob:
            problems.append(f"产出含禁用来源标记「{term}」，拒绝入库（CONSTITUTION §2）")
    if problems:
        return None, problems
    return record, []


def extract_json(text: Any) -> Optional[Any]:
    """宽容解析（围栏/前后杂句）；供 CLI 复用，端点路径不经过这里。"""
    parsed = ai_client.extract_json(text)
    return parsed if isinstance(parsed, dict) else None


# --------------------------------------------------------------------------
# 生成
# --------------------------------------------------------------------------

def generate(
    *,
    module: str,
    count: int = 1,
    target_band: Optional[float] = None,
    part: Optional[int] = None,
    task: Optional[str] = None,
    topic_hint: Optional[str] = None,
) -> dict[str, Any]:
    """执行一次生成任务（job runner 调它）。返回 §17.3 的 ContentJobReport。

    永不抛「模型不可用」这类上游异常：单个 set 失败记进 rejected 继续下一个，
    全部失败时由 job_queue 判 failed（错误可见，CONSTITUTION §3）。
    """
    if module not in MODULES_SET:
        raise ContentError(400, f"module 只能是 {', '.join(MODULE_CHOICES)}", "validation_failed")
    wanted = max(1, min(int(count or 1), MAX_COUNT))
    if not ai_client.network_allowed():
        raise ContentError(503, "已关闭联网，无法生成题目；请在设置里开启在线服务后重试", "content_offline")

    model = ai_client.resolve_model()
    bands = [target_band if target_band else content_prompts.BANDS[i % 3] for i in range(wanted)]
    generated: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    for index, band in enumerate(bands):
        prompt = content_prompts.build_prompt(module, band, topic_hint, part, task)
        result = ai_client.complete_json(
            prompt,
            system="你是一位雅思命题专家，只输出 JSON。",
            temperature=0.3,
            max_tokens=max_tokens_for(module),
            timeout=timeout_for(module),
            allow_network=True,
            require_api_key=False,  # 与评分链路同口径：本机兼容端点可以无凭据
        )
        if not result.ok:
            rejected.append({"reasons": [f"第 {index + 1} 个：上游失败（{result.reason}）"]})
            continue
        # `complete_json` 已经把输出解析成对象；非对象输出（数组/字符串）在这里拒绝，
        # 不替模型「猜」它想表达什么——猜出来的题进了库，用户刷到的是残次品。
        obj = result.data if isinstance(result.data, dict) else None
        if obj is None:
            rejected.append({"reasons": [f"第 {index + 1} 个：输出不是 JSON 对象"]})
            continue
        record, problems = validate_candidate(obj, module, model)
        if problems:
            rejected.append({"id": str(obj.get("id") or ""), "reasons": problems[:4]})
            faultlog.warn("Content", f"拒绝 {module} 候选：{'；'.join(problems[:3])}")
            continue
        try:
            path = write_set(record, module)
        except ContentError as exc:
            rejected.append({"id": str(record.get("id")), "reasons": [exc.detail]})
            continue
        generated.append(
            {
                "id": str(record["id"]),
                "title_zh": str(record.get("title_zh") or ""),
                "path": str(path),
            }
        )

    return {
        "generated": generated,
        "rejected": rejected,
        "written": len(generated),
        "requested": wanted,
        # model 名与 /health 的 ai_model 同口径直出（它来自配置，不是凭据；脱敏是 key 的纪律）
        "model": model or None,
    }
