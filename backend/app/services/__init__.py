from fastapi import APIRouter, Query, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from . import scene_service
from app.services.tts_service import generate_tts, batch_pre_generate
from app.services.stt_service import transcribe
from app.services.score_service import score_with_ai, score
from app.services.payment_service import verify_payment_receipt, generate_order_id
from app.services.word_service import lookup_word, get_word_detail
from app.services.ai_review_service import generate_ai_review, get_phoneme_tip
from app.models.database import get_db
from app.models.wrong_record import WrongRecord, WrongStats
from app.models.learning_record import LearningRecord, LearningStats
import json
from datetime import date, datetime, timedelta

router = APIRouter()

# WebM 文件魔数（前 4 字节）
WEBM_MAGIC = b'\x1a\x45\xdf\xa3'

# 评分文本最大长度
MAX_SCORE_TEXT_LENGTH = 500


@router.get("/scenes")
async def list_scenes():
    scene_service.load_scenes_to_db()
    return {"data": scene_service.get_scene_list()}


@router.get("/scenes/{scene_id}")
async def get_scene(scene_id: str):
    scene_service.load_scenes_to_db()
    scene = scene_service.get_scene_detail(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    return {"data": scene}


@router.get("/tts")
async def tts(text: str = Query(...), voice: str = Query("en-US")):
    """生成句子级 TTS，返回 MP3 文件"""
    cache_path = await generate_tts(text, voice)
    if not cache_path:
        raise HTTPException(status_code=503, detail="TTS generation failed (network issue?)")
    return FileResponse(cache_path, media_type="audio/mpeg", filename="speech.mp3")


@router.get("/scenes/{scene_id}/tts/batch")
async def batch_tts(scene_id: str, voice: str = Query("en-US")):
    """批量预生成场景所有句子的 TTS"""
    scene_service.load_scenes_to_db()
    scene = scene_service.get_scene_detail(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    results = await batch_pre_generate([d.model_dump() for d in scene.dialogues], voice)
    return {"data": results}


@router.post("/stt")
async def stt(audio: UploadFile = File(...)):
    data = await audio.read()

    # 大小校验
    if len(data) > 5 * 1024 * 1024:  # 5MB 上限
        raise HTTPException(status_code=413, detail="Audio too large (max 5MB)")

    # 文件类型校验（魔数）
    if len(data) < 4 or data[:4] != WEBM_MAGIC:
        raise HTTPException(status_code=400, detail="Invalid audio format (expected WebM)")

    result = transcribe(data, "webm")
    return {"data": result}


@router.post("/score")
async def score_endpoint(
    original: str = Form(...),
    user_transcription: str = Form(...),
    duration_ms: int = Form(0),
    confidence: float = Form(0.0)
):
    # 长度限制，防止 O(n²) WER 计算超时
    if len(original) > MAX_SCORE_TEXT_LENGTH or len(user_transcription) > MAX_SCORE_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Text too long (max {MAX_SCORE_TEXT_LENGTH} chars)")
    result = score(original, user_transcription, duration_ms, confidence)
    return {"data": result.__dict__}


@router.get("/payment/order")
async def create_order():
    """生成订单 ID（客户端发起支付前调用）"""
    order_id = generate_order_id()
    return {"data": {"order_id": order_id}}


@router.post("/payment/verify")
async def verify_payment(receipt: str = Form(...)):
    """验证支付收据，返回 Pro 状态"""
    result = verify_payment_receipt(receipt)
    return {"data": result}


# ============================================================
# v1.1 新增 API
# ============================================================

@router.get("/word/{word}")
async def get_word_info(word: str):
    """查询单词详情（音标、释义、发音难点）"""
    detail = get_word_detail(word)
    return {"data": detail}


@router.get("/phoneme-tip/{phoneme}")
async def phoneme_tip(phoneme: str):
    """获取音素学习建议"""
    tip = get_phoneme_tip(f"/{phoneme}/")
    return {"data": {"phoneme": phoneme, "tip": tip}}


@router.get("/wrong-records")
async def list_wrong_records(
    scene_id: str = Query(None),
    mastered: bool = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """获取错题列表"""
    db = get_db()
    try:
        conditions = []
        params = []
        if scene_id:
            conditions.append("scene_id = ?")
            params.append(scene_id)
        if mastered is not None:
            conditions.append("mastered = ?")
            params.append(1 if mastered else 0)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = db.execute(
            f"SELECT * FROM wrong_records {where_clause} ORDER BY created_at DESC LIMIT ?",
            params + [limit],
        ).fetchall()
        return {"data": [dict(r) for r in rows], "total": len(rows)}
    finally:
        db.close()


@router.get("/wrong-records/stats")
async def wrong_records_stats():
    """错题统计：总数、掌握数、Top 错误音素"""
    db = get_db()
    try:
        total = db.execute("SELECT COUNT(*) FROM wrong_records").fetchone()[0]
        active = db.execute(
            "SELECT COUNT(*) FROM wrong_records WHERE mastered = 0"
        ).fetchone()[0]
        mastered = total - active

        # Top 错误音素
        phonemes = db.execute(
            """SELECT phonetic_expected, COUNT(*) as cnt 
               FROM wrong_records 
               WHERE mastered = 0 AND phonetic_expected != '' 
               GROUP BY phonetic_expected 
               ORDER BY cnt DESC LIMIT 5"""
        ).fetchall()

        return {
            "data": {
                "total_wrong": total,
                "active_wrong": active,
                "mastered": mastered,
                "top_phonemes": [
                    {"phoneme": p["phonetic_expected"], "count": p["cnt"]}
                    for p in phonemes
                ],
            }
        }
    finally:
        db.close()


@router.post("/wrong-records/mark-mastered")
async def mark_wrong_mastered(word: str = Form(...), scene_id: str = Form(None)):
    """标记错题为已掌握"""
    db = get_db()
    try:
        if scene_id:
            db.execute(
                """UPDATE wrong_records SET mastered = 1, updated_at = CURRENT_TIMESTAMP 
                   WHERE word = ? AND scene_id = ?""",
                (word, scene_id),
            )
        else:
            db.execute(
                """UPDATE wrong_records SET mastered = 1, updated_at = CURRENT_TIMESTAMP 
                   WHERE word = ?""",
                (word,),
            )
        db.commit()
        return {"data": {"success": True}}
    finally:
        db.close()


@router.get("/learning-stats")
async def get_learning_stats():
    """获取学习统计数据

    包含：今日统计、本周统计、7天趋势、连续天数、Top3错误音素、等级、成就
    """
    db = get_db()
    try:
        today_str = date.today().isoformat()
        week_ago = (date.today() - timedelta(days=6)).isoformat()

        # 今日统计
        today_row = db.execute(
            "SELECT * FROM learning_records WHERE date = ?", (today_str,)
        ).fetchone()
        today = dict(today_row) if today_row else {
            "duration_minutes": 0, "sentences_count": 0, "avg_score": 0
        }

        # 本周统计
        week_rows = db.execute(
            "SELECT * FROM learning_records WHERE date >= ? ORDER BY date",
            (week_ago,),
        ).fetchall()
        week_data = [dict(r) for r in week_rows]
        week_duration = sum(r["duration_minutes"] for r in week_data)
        week_sentences = sum(r["sentences_count"] for r in week_data)
        week_scores = [r["avg_score"] for r in week_data if r["avg_score"] > 0]
        week_avg = round(sum(week_scores) / len(week_scores), 1) if week_scores else 0

        # 7天趋势
        trend = []
        for i in range(6, -1, -1):
            d = (date.today() - timedelta(days=i)).isoformat()
            row = db.execute(
                "SELECT * FROM learning_records WHERE date = ?", (d,)
            ).fetchone()
            if row:
                trend.append({
                    "date": d,
                    "score": row["avg_score"] or 0,
                    "sentences": row["sentences_count"] or 0,
                })
            else:
                trend.append({"date": d, "score": 0, "sentences": 0})

        # 连续学习天数
        streak = 0
        for i in range(365):
            d = (date.today() - timedelta(days=i)).isoformat()
            row = db.execute(
                "SELECT id FROM learning_records WHERE date = ? AND sentences_count > 0",
                (d,),
            ).fetchone()
            if row:
                streak += 1
            else:
                break

        # Top3 错误音素
        top_phonemes = db.execute(
            """SELECT phonetic_expected, COUNT(*) as cnt 
               FROM wrong_records WHERE mastered = 0 AND phonetic_expected != '' 
               GROUP BY phonetic_expected ORDER BY cnt DESC LIMIT 3"""
        ).fetchall()
        top_errors = [
            {"phoneme": p["phonetic_expected"], "count": p["cnt"]}
            for p in top_phonemes
        ]

        # 学习等级（按设计文档第6.1节）
        total_sentences = db.execute(
            "SELECT COALESCE(SUM(sentences_count), 0) FROM learning_records"
        ).fetchone()[0]
        grade = _calculate_grade(total_sentences, streak, today.get("avg_score", 0))

        # 成就（按设计文档第6.2节）
        achievements = _calculate_achievements(db, total_sentences, streak)

        return {
            "data": {
                "today": today,
                "week": {
                    "duration_minutes": week_duration,
                    "sentences_count": week_sentences,
                    "avg_score": week_avg,
                },
                "trend": trend,
                "streak": streak,
                "top_errors": top_errors,
                "grade": grade,
                "achievements": achievements,
            }
        }
    finally:
        db.close()


@router.get("/achievements")
async def get_achievements():
    """获取所有成就及完成状态"""
    db = get_db()
    try:
        total_sentences = db.execute(
            "SELECT COALESCE(SUM(sentences_count), 0) FROM learning_records"
        ).fetchone()[0]
        streak = 0
        for i in range(365):
            d = (date.today() - timedelta(days=i)).isoformat()
            row = db.execute(
                "SELECT id FROM learning_records WHERE date = ? AND sentences_count > 0",
                (d,),
            ).fetchone()
            if row:
                streak += 1
            else:
                break

        achievements = _calculate_achievements(db, total_sentences, streak)
        return {"data": achievements}
    finally:
        db.close()


def _calculate_grade(total_sentences: int, streak: int, avg_score: float) -> dict:
    """计算学习等级"""
    if total_sentences < 20:
        level = 1
        name = "新手"
        desc = "注册即得"
    elif streak < 3:
        level = 2
        name = "入门"
        desc = "完成 20 句跟读"
    elif avg_score < 80:
        level = 3
        name = "熟练"
        desc = "连续练习 3 天"
    elif total_sentences < 100:
        level = 4
        name = "进阶"
        desc = "平均分 80+"
    else:
        level = 5
        name = "精通"
        desc = "完成全部免费课程"

    return {"level": level, "name": f"Lv{level} {name}", "description": desc}


def _calculate_achievements(db, total_sentences: int, streak: int) -> list[dict]:
    """计算已解锁的成就"""
    all_achievements = [
        {"id": "beginner", "name": "初学者", "icon": "🥇", "desc": "完成第一个场景",
         "condition": total_sentences >= 1},
        {"id": "streak_7", "name": "坚持 7 天", "icon": "🔥", "desc": "连续学习 7 天",
         "condition": streak >= 7},
        {"id": "streak_30", "name": "坚持 30 天", "icon": "💪", "desc": "连续学习 30 天",
         "condition": streak >= 30},
        {"id": "sentences_100", "name": "完成 100 句", "icon": "📝", "desc": "累计完成 100 句",
         "condition": total_sentences >= 100},
        {"id": "night_owl", "name": "夜猫子", "icon": "🌙", "desc": "22:00 后练习",
         "condition": False},  # 需要检查练习时间
    ]

    # 检查是否有 90+ 分的记录
    max_score_row = db.execute(
        "SELECT MAX(overall_score) FROM practice_records"
    ).fetchone()
    if max_score_row and max_score_row[0] and max_score_row[0] >= 90:
        all_achievements.append({
            "id": "first_90", "name": "第一次 90 分", "icon": "🌟",
            "desc": "单次评分 ≥ 90", "condition": True,
        })

    if max_score_row and max_score_row[0] and max_score_row[0] >= 100:
        all_achievements.append({
            "id": "perfect", "name": "完美主义者", "icon": "💯",
            "desc": "单句评分 100", "condition": True,
        })

    return all_achievements


# ============================================================
# v1.5 新增 API
# ============================================================

# --- 句子解析 ---
@router.get("/sentence-parse/{scene_id}/{seq}")
async def get_sentence_parse(scene_id: str, seq: int):
    """获取句子解析（词汇/固定表达/文化说明）"""
    from app.services.sentence_parse_service import parse_sentence
    
    db = get_db()
    try:
        scene = db.execute(
            "SELECT cultural_notes, dialogues FROM scenes WHERE id = ?", (scene_id,)
        ).fetchone()
        if not scene:
            raise HTTPException(status_code=404, detail="Scene not found")
        
        dialogues = json.loads(scene["dialogues"])
        target = next((d for d in dialogues if d.get("seq") == seq), None)
        if not target:
            raise HTTPException(status_code=404, detail="Sentence not found")
        
        result = parse_sentence(
            target["en"],
            cultural_notes=scene["cultural_notes"] or "",
            scene_id=scene_id,
        )
        return {"data": result}
    finally:
        db.close()


# --- 单词收藏 ---
@router.get("/wordbook")
async def get_wordbook():
    """获取单词本"""
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM wordbook ORDER BY created_at DESC").fetchall()
        return {"data": [dict(r) for r in rows]}
    finally:
        db.close()


@router.post("/wordbook/add")
async def add_to_wordbook(
    word: str = Form(...),
    phonetic: str = Form(""),
    zh: str = Form(""),
    example: str = Form(""),
):
    """收藏单词"""
    db = get_db()
    try:
        existing = db.execute("SELECT id FROM wordbook WHERE word = ?", (word.lower(),)).fetchone()
        if existing:
            return {"data": {"id": existing["id"], "already_exists": True}}
        db.execute(
            "INSERT INTO wordbook (word, phonetic, zh, example, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
            (word.lower(), phonetic, zh, example),
        )
        db.commit()
        row = db.execute("SELECT * FROM wordbook WHERE word = ?", (word.lower(),)).fetchone()
        return {"data": dict(row)}
    finally:
        db.close()


@router.delete("/wordbook/{word}")
async def remove_from_wordbook(word: str):
    """移除收藏"""
    db = get_db()
    try:
        db.execute("DELETE FROM wordbook WHERE word = ?", (word.lower(),))
        db.commit()
        return {"data": {"success": True}}
    finally:
        db.close()


# --- 设置 ---
@router.get("/settings")
async def get_settings():
    """获取用户设置"""
    db = get_db()
    try:
        row = db.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        return {"data": dict(row)} if row else {"data": {}}
    finally:
        db.close()


@router.post("/settings")
async def update_settings(
    practice_mode: str = Form("normal"),
    shadowing_delay: float = Form(0.5),
    playback_speed: float = Form(1.0),
    tts_voice: str = Form("en-US"),
    online_enabled: bool = Form(True),
):
    """更新用户设置"""
    db = get_db()
    try:
        db.execute(
            """UPDATE SETTINGS SET practice_mode=?, shadowing_delay=?, playback_speed=?,
               tts_voice=?, online_enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=1""",
            (practice_mode, shadowing_delay, playback_speed, tts_voice, 1 if online_enabled else 0),
        )
        db.commit()
        row = db.execute("SELECT * FROM settings WHERE id = 1").fetchone()
        return {"data": dict(row)}
    finally:
        db.close()
