# AI 英语对话应用 — TDD 全量测试计划

> **目标：** 对 AI 英语对话应用（后端 FastAPI + 前端 React）进行全覆盖测试，遵循 TDD 红-绿-重构循环。

**架构：** 分层测试 — 后端单元测试(服务层) → 后端集成测试(API端点) → 前端单元测试(组件渲染) → 前端集成测试(API调用)

**技术栈：** pytest + httpx (后端), vitest + @testing-library/react + msw (前端)

---

## 测试范围矩阵

| 层级 | 测试对象 | 数量 | 方式 |
|------|----------|------|------|
| 后端-服务层 | 10 个 service 文件 | ~30 测试 | pytest 单元测试 |
| 后端-API层 | 21 个 API 端点 | ~30 测试 | pytest + TestClient |
| 前端-服务层 | api.ts 20 个函数 | ~20 测试 | vitest + msw |
| 前端-组件层 | 9 个主要组件 | ~20 测试 | vitest + testing-library |
| 前端-Hooks | 2 个自定义 Hook | ~6 测试 | vitest + renderHook |

---

## Phase 1: 后端服务层测试

### Task 1: Scene Service 测试
- 文件: `backend/tests/test_scene_service.py`
- 测试项:
  1. load_scenes_to_db 加载 20 个场景
  2. get_scene_list 返回正确数量和字段
  3. get_scene_detail 返回完整 dialogues
  4. get_scene_detail 不存在场景返回 None

### Task 2: Score Service 测试
- 文件: `backend/tests/test_score_service.py`
- 测试项:
  1. _normalize 去标点+小写
  2. _wer 完全匹配返回 0
  3. _wer 完全错误返回 1
  4. _align_words 正确标注
  5. score 完美匹配得高分
  6. score 部分匹配得低分

### Task 3: Word Service 测试
- 文件: `backend/tests/test_word_service.py`
- 测试项:
  1. lookup_word 本地词典命中
  2. lookup_word 降级 fallback
  3. search_words 匹配英文
  4. search_words 匹配中文释义
  5. get_word_detail 含发音提示

### Task 4: AI Services 测试
- 文件: `backend/tests/test_ai_services.py`
- 测试项:
  1. ai_review_service.generate_offline_review 返回完整结构
  2. get_phoneme_tip 返回正确提示
  3. score_with_ai 离线降级正常工作

### Task 5: Payment Service 测试
- 文件: `backend/tests/test_payment_service.py`
- 测试项:
  1. generate_order_id 格式正确
  2. verify_payment_receipt 有效收据
  3. verify_payment_receipt 无效收据

### Task 6: Sentence Parse Service 测试
- 文件: `backend/tests/test_sentence_parse.py`
- 测试项:
  1. parse_sentence 预设数据命中
  2. parse_sentence fallback 降级
  3. _fallback_parse 字典查找

---

## Phase 2: 后端 API 层测试（扩展现有 tests/test_api.py）

### Task 7: 扩展 Scene APIs 测试
- 新增: 验证返回字段完整性、dialogue 结构

### Task 8: 扩展 Score APIs 测试
- 新增: 空文本、特殊字符、混合大小写

### Task 9: Word / Phoneme APIs 测试
- `GET /api/word/{word}` 
- `GET /api/phoneme-tip/{phoneme}`

### Task 10: Wrong Records APIs 测试
- `GET /api/wrong-records` 
- `GET /api/wrong-records/stats`
- `POST /api/wrong-records/mark-mastered`

### Task 11: Learning Stats / Achievements APIs 测试
- `GET /api/learning-stats`
- `GET /api/achievements`

### Task 12: WordBook APIs 测试
- `GET /api/wordbook`
- `POST /api/wordbook/add`
- `DELETE /api/wordbook/{word}`

### Task 13: Settings APIs 测试
- `GET /api/settings`
- `POST /api/settings`

### Task 14: Sentence Parse API 测试
- `GET /api/sentence-parse/{scene_id}/{seq}`

---

## Phase 3: 前端测试基础设施搭建

### Task 15: 安装前端测试依赖
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom msw
```

### Task 16: 配置 vitest
- 文件: `frontend/vitest.config.ts`
- 文件: `frontend/src/test/setup.ts`
- 更新 `tsconfig.json` 包含测试文件类型

### Task 17: 配置 MSW (Mock Service Worker)
- 文件: `frontend/src/test/mocks/handlers.ts`
- 文件: `frontend/src/test/mocks/server.ts`

---

## Phase 4: 前端服务层测试

### Task 18: api.ts 测试
- 文件: `frontend/src/services/api.test.ts`
- 覆盖所有 20 个 API 函数

---

## Phase 5: 前端组件测试

### Task 19: SceneList 测试
- 渲染场景列表、点击选择

### Task 20: DialogueArea 测试
- 场景加载、tab切换

### Task 21: LearningReport 测试
- 加载状态、空状态、数据展示

### Task 22: WrongBook 测试
- 统计展示、错题列表

### Task 23: WordBook 测试
- 单词列表、排序切换

### Task 24: ScorePanel / HeatmapScore 测试
- 分数展示、热力图

### Task 25: WordPopup / SentenceParsePanel / SettingsPage 测试
- 弹窗渲染、面板开关

---

## Phase 6: Hooks 测试

### Task 26: useRecorder / useTTS 测试
- Hook 状态管理
