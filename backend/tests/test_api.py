"""
TDD 测试 — 故意让预期与实际不符，验证测试能捕获 bug
纠正后，预期 → 实际，测试通过
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


class TestSceneAPIs:
    """场景库 API 测试（TDD：红→绿）"""

    def test_scene_list_returns_20_scenes(self, client: TestClient):
        """TDD 第一步：故意错，预期 20，实际可能是 5 或更多"""
        response = client.get("/api/scenes")
        assert response.status_code == 200
        data = response.json()["data"]
        # 初始预期：20 个场景（5 免费 + 15 Pro）
        # 如果场景数量不足 20，测试将失败 → 需要增加场景
        assert len(data) == 20, f"Expected 20 scenes, got {len(data)}"

    def test_scene_list_has_5_free_15_pro(self, client: TestClient):
        """验证免费/Pro 场景比例"""
        response = client.get("/api/scenes")
        data = response.json()["data"]
        free_count = sum(1 for s in data if s["is_free"])
        pro_count = sum(1 for s in data if not s["is_free"])
        assert free_count == 5, f"Expected 5 free scenes, got {free_count}"
        assert pro_count == 15, f"Expected 15 Pro scenes, got {pro_count}"

    def test_scene_detail_returns_dialogues(self, client: TestClient):
        """验证场景详情包含对话"""
        response = client.get("/api/scenes/free_01")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["id"] == "free_01"
        assert len(data["dialogues"]) >= 4

    def test_scene_not_found_returns_404(self, client: TestClient):
        """验证不存在的场景返回 404"""
        response = client.get("/api/scenes/nonexistent")
        assert response.status_code == 404


class TestTTSApis:
    """TTS API 测试（TDD）"""

    def test_tts_returns_mp3(self, client: TestClient):
        """TTS 端点应返回 MP3 格式"""
        response = client.get("/api/tts?text=Hello+world&voice=en-US")
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/mpeg"
        assert len(response.content) > 1000

    def test_tts_caching(self, client: TestClient):
        """第二次请求应使用缓存（返回相同响应）"""
        r1 = client.get("/api/tts?text=Cache+test+sentence&voice=en-US")
        r2 = client.get("/api/tts?text=Cache+test+sentence&voice=en-US")
        assert r1.content == r2.content

    def test_batch_tts_returns_all_files(self, client: TestClient):
        """批量预生成应覆盖所有句子"""
        response = client.get("/api/scenes/free_01/tts/batch?voice=en-US")
        data = response.json()["data"]
        # free_01 有 4 句
        assert len(data) == 4


class TestScoreApis:
    """评分 API 测试（TDD）"""

    def test_perfect_score(self, client: TestClient):
        """原文完全正确应得高分"""
        response = client.post("/api/score", data={
            "original": "Hello world",
            "user_transcription": "Hello world",
            "duration_ms": "1000",
        })
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["completeness_score"] == 100
        assert data["overall_score"] >= 90

    def test_partial_score(self, client: TestClient):
        """部分正确应得中等分数"""
        response = client.post("/api/score", data={
            "original": "Hello world",
            "user_transcription": "Hullo ward",
            "duration_ms": "1000",
        })
        data = response.json()["data"]
        assert data["completeness_score"] < 50
        assert data["overall_score"] < 50

    def test_score_text_length_limit(self, client: TestClient):
        """超长文本应返回 400"""
        long_text = "a " * 600
        response = client.post("/api/score", data={
            "original": long_text,
            "user_transcription": long_text,
        })
        assert response.status_code == 400


class TestPaymentApis:
    """支付 API 测试（TDD）"""

    def test_create_order(self, client: TestClient):
        """应生成订单 ID"""
        response = client.get("/api/payment/order")
        data = response.json()["data"]
        assert "order_id" in data
        assert data["order_id"].startswith("PAY-")

    def test_verify_valid_receipt(self, client: TestClient):
        """有效收据应返回 valid=True"""
        response = client.post("/api/payment/verify", data={
            "receipt": "PAY-1234567890-abcdef"
        })
        data = response.json()["data"]
        assert data["valid"] is True

    def test_verify_invalid_receipt(self, client: TestClient):
        """无效收据应返回 valid=False"""
        response = client.post("/api/payment/verify", data={
            "receipt": "INVALID"
        })
        data = response.json()["data"]
        assert data["valid"] is False
