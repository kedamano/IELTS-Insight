"""生词本端点（契约 §1 行 34–38；FR-V1 / AC-V1）。

注意：契约把「查词」和「列出生词」都写成 `GET /vocab`，这里按是否带 `word` 参数区分：
- `GET /vocab?word=abandon` → 词典详情（WordInfo，含 `audio_url`/`collocations`/`topic`）
- `GET /vocab` → `{items: VocabNote[]}`
"""

from __future__ import annotations

import csv
import io
from typing import Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from app.api.common import bad_request, not_found, ok
from app.db import store
from app.services.word_service import get_word_detail

router = APIRouter(tags=["vocab"])

_EXPORT_FORMATS = ("csv", "anki")


def _audio_url(word: str) -> str:
    voice = store.get_settings().get("tts_voice") or "en-GB-SoniaNeural"
    return f"/api/tts?text={quote(word)}&voice={quote(voice)}"


def _word_info(word: str) -> dict[str, Any]:
    """契约 §1 行 34：沿用现有 WordInfo，并补 audio_url / collocations / topic。"""
    info = dict(get_word_detail(word))
    info["audio_url"] = _audio_url(info.get("word") or word)
    info.setdefault("collocations", [])
    info.setdefault("topic", None)
    return info


def _validate_tags(tags: Any) -> list[str]:
    if tags is None:
        return []
    if not isinstance(tags, list) or any(not isinstance(t, str) or not t.strip() for t in tags):
        raise bad_request("tags 应为非空字符串组成的数组")
    return [t.strip() for t in tags]


@router.get("/vocab/export")
def export_vocab(format: str = Query("csv")):
    """导出 CSV / Anki TSV（保留旧 wordbook 导出能力）。"""
    fmt = (format or "csv").strip().lower()
    if fmt not in _EXPORT_FORMATS:
        raise bad_request(f"format 只能是 {', '.join(_EXPORT_FORMATS)}")
    items = store.list_vocab()

    buffer = io.StringIO()
    if fmt == "csv":
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(["word", "phonetic", "zh", "context", "note_zh", "tags", "source_module", "created_at"])
        for item in items:
            writer.writerow(
                [
                    item.get("word", ""),
                    item.get("phonetic", ""),
                    item.get("zh", ""),
                    item.get("context", ""),
                    item.get("note_zh", ""),
                    " ".join(item.get("tags") or []),
                    item.get("source_module", ""),
                    item.get("created_at", ""),
                ]
            )
        filename = "ielts-vocab.csv"
        body = "\ufeff" + buffer.getvalue()  # BOM：Excel 打开中文不乱码
    else:
        writer = csv.writer(buffer, delimiter="\t", lineterminator="\n", quoting=csv.QUOTE_NONE, escapechar="\\")
        for item in items:
            back_parts = [
                str(item.get("phonetic") or ""),
                str(item.get("zh") or ""),
                str(item.get("note_zh") or ""),
                str(item.get("context") or ""),
            ]
            writer.writerow([item.get("word", ""), " | ".join(p for p in back_parts if p)])
        filename = "ielts-vocab.anki.tsv"
        body = buffer.getvalue()

    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/vocab")
def vocab(word: Optional[str] = Query(None), q: Optional[str] = Query(None)):
    if word:
        return ok(_word_info(word))
    return ok({"items": store.list_vocab(q)})


@router.post("/vocab")
async def add_vocab(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise bad_request("请求体应为合法 JSON") from None
    if not isinstance(body, dict):
        raise bad_request("请求体应为 JSON 对象")

    word = (body.get("word") or "").strip()
    if not word:
        raise bad_request("word 不能为空")
    source_module = body.get("source_module")
    if source_module not in (None, "") and source_module not in store.MODULES:
        raise bad_request(f"source_module 只能是 {', '.join(store.MODULES)}")

    phonetics = get_word_detail(word)
    note = store.add_vocab(
        word,
        context=body.get("context") or "",
        source_module=source_module or "",
        source_ref=body.get("source_ref") or "",
        note_zh=body.get("note_zh") or "",
        tags=_validate_tags(body.get("tags")),
        phonetics={
            "phonetic": phonetics.get("phonetic", ""),
            "zh": phonetics.get("zh", ""),
            "difficulty": phonetics.get("difficulty", 1),
            "examples": phonetics.get("examples", []),
            "pronunciation_tips": phonetics.get("pronunciation_tips", []),
        },
    )
    return ok(note)


@router.delete("/vocab/{word}")
def remove_vocab(word: str):
    if not store.delete_vocab(word):
        raise not_found("生词不在生词本中")
    return ok({"deleted": True})
