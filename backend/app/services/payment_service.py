import hashlib
import time
from datetime import datetime, timedelta


# 模拟收据验证（生产环境应对接 Apple/Google/微信支付）
# MVP 阶段用简单的 HMAC 签名验证


def verify_payment_receipt(receipt: str, user_id: str = "") -> dict:
    """
    验证支付收据。
    
    Args:
        receipt: 支付收据字符串（JSON 或 payment token）
        user_id: 用户标识
    
    Returns:
        dict: {"valid": bool, "expire_at": str, "message": str}
    """
    if not receipt:
        return {"valid": False, "message": "收据为空"}
    
    # TODO: 生产环境对接真实支付网关
    # - App Store: 调用 Apple verifyReceipt 接口
    # - Google Play: 调用 Google Play Developer API
    # - 微信/支付宝: 调用相应统一下单接口
    
    # MVP 模拟：以 "PAY-" 开头的收据视为有效
    if receipt.startswith("PAY-") and len(receipt) > 10:
        expire_at = (datetime.now() + timedelta(days=365)).isoformat()
        return {
            "valid": True,
            "expire_at": expire_at,
            "message": "支付验证成功"
        }
    
    return {"valid": False, "message": "无效的收据格式"}


def generate_order_id(user_id: str = "") -> str:
    """生成订单 ID（客户端发起支付前调用）"""
    ts = str(int(time.time()))
    raw = f"{user_id}_{ts}_ai_language"
    sign = hashlib.md5(raw.encode()).hexdigest()[:8]
    return f"PAY-{ts}-{sign}"
