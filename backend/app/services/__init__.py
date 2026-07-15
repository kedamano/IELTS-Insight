from fastapi import APIRouter, Query, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from . import scene_service
from app.services.tts_service import generate_tts, batch_pre_generate
from app.services.stt_service import transcribe
from app.services.score_service import score_with_ai, score
from app.services.payment_service import verify_payment_receipt, generate_order_id

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
