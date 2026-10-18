"""服务层包。

路由已全部搬到 `app/api/*.py`（契约 §6）；本包只保留可复用的服务模块：
- `sets_loader.py` 装载并校验 `data/ielts/**/*.json`（本任务新增）
- `tts_service.py` / `stt_service.py` / `word_service.py` / `score_service.py` /
  `ai_service.py` / `ai_review_service.py`（沿用，评分相关由 T8 重写）
- T8 追加：`band_scale.py`、`answer_norm.py`、`ai_client.py`、`*_grader.py`、`offline_feedback.py`

已删除的死链路（CONSTITUTION §1 / AC-X1/X3/X5）：`payment_service.py`、`audio_service.py`、
`scene_service.py`、`sentence_parse_service.py`，以及旧的 514 行单文件路由。
"""
