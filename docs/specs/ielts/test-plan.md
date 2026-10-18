# TEST PLAN — TDD 分层与执行顺序

配套 `spec-product.md`（AC-*）与 `spec-contracts.md`（§1–§9）。
**执行顺序：先红灯 → 记录失败 → 实现 → 绿 → 真实环境手跑一次**（CONSTITUTION §5、§7）。

## 0. 运行入口

```bash
# 后端
cd backend && python -m pytest -q                 # 全量（默认跳过 integration）
cd backend && python -m pytest -q -m "not integration"
cd backend && RUN_INTEGRATION=1 python -m pytest -q -m integration   # 真 LLM，需 .env
# 前端
cd frontend && npm test                            # vitest run
cd frontend && npx tsc -b                          # 类型门禁
# 双端就绪
bash scripts/check.sh                              # 本计划要求新增
```
`backend/requirements.txt` 缺 `pytest`/`httpx` → 必须补（当前测试根本装不出来）。
另需 `requirements-dev.txt`：`pytest`、`pytest-asyncio`、`httpx`。

## 1. 必须先修的测试基建（P0，任何人写业务测试之前）

| 缺陷 | 现状 | 修法 | 验证 |
|---|---|---|---|
| DB 隔离失效 | `tests/test_scene_service.py:7` 在 `Settings` 已导入后才改 `DB_PATH`；`main.py:29` startup 调 `load_scenes_to_db()` | `conftest.py` 顶部（**在任何 `import app.*` 之前**）设 `os.environ["IELTS_DB_PATH"]=tmp_path/"app.db"`、`IELTS_TTS_CACHE_DIR`、`IELTS_ONLINE=0`；用 `pytest.fixture(autouse=True, scope="session")` | 跑测试前后对 `backend/db/app.db`、根 `db/app.db` 做 sha256 比对，必须一致（写一个 `test_no_production_db_write` 守卫） |
| import 即加载 whisper+torch | `stt_service.py:7` 模块级 `whisper.load_model` | 懒加载 `_get_model()`；测试用 fake model 注入 | `python -c "import app.main"` 不应出现 torch 且耗时 <2s |
| 测试打真网络 | `test_api.py` 的 `/api/tts`、batch TTS 走 edge-tts | 单测全部 mock `tts_service.synthesize`；真实合成标记 `@pytest.mark.integration` | `-m "not integration"` 在断网下全绿 |
| 断言过死 | 精确断言 20 个 scene、5 free/15 pro、`free_01` 4 行 | 题库测试改为断言不变量（每 set 题目数、字段完整、字数区间），不断言具体条数 | 内容增删不导致测试红 |
| 假绿 | `test_update_partial_settings` 因端点重置默认值而"碰巧通过" | PATCH 语义测试必须显式断言未传字段保持原值（AC-C1） | 旧实现下该测试必须红 |
| 前端 msw 覆盖不全 + 生命周期位置怪 | `testUtils.tsx:6-8` 挂 server 生命周期，`api.test.ts` 又重复声明 | 统一 `setup.ts` 管 server；handler 按 §1 契约端点全量重写；删除 payment handler | 每个 api.ts 导出函数都有对应测试 |

## 2. 后端测试矩阵

### L1 纯函数（最快、覆盖业务规则核心）
- `test_band_scale.py`：§3-B 锚点（听 16/20→7.0、13/20→6.0；阅 10/13→7.0、8/13→6.0）、0/满、边界两档之间取低、越界输入夹紧、非法输入抛 `ValueError`。
- `test_answer_norm.py`：大小写、首尾空格、`a/an/the`、`9:30`/`nine thirty`、日期 3 种写法、连字符、`over_word_limit`、空答案→`unanswered`。
- `test_grade_objective.py`：20 题/13 题全对全错、部分对、`by_question_type` 聚合正确、响应不含 `answer` 泄漏（题面接口必须剔除答案 — AC §2-L）。
- `test_speaking_metrics.py`：wpm、pause、fillers、repeats 从 transcript+时长计算。
- `test_offline_feedback.py`：无 AI 时写作统计（字数/段落/句长/重复词/连接词）与口语近似报告，且 `approximate=true`。

### L2 AI 契约（全部 mock `ai_client`）
- `test_ai_client.py`：key 缺失→`no_api_key`；超时→`timeout`；HTTP 5xx→`network_error`；异常文本不含 key（断言 `"sk-" not in str(exc)`）；重试 1 次；`base_url/model` 来自配置。
- `test_speaking_grader.py`：合法 JSON→四维+overall 夹紧；band=12→夹到 9 且 `ai_used=false`+`invalid_model_output`；缺 2 个维度→`incomplete_dimensions` 且缺失维度为 `null`；`quote` 不在 transcript→丢弃并计 `invalid_quotes`；非 JSON→降级。
- `test_writing_grader.py`：AC-W3 全部 + `word_count_penalty`（Task1 149 词→有 penalty 且 `task_response ≤5.0`；150 词→无 penalty）+ `error_summary` 聚合。
- `test_prompts.py`：每个 prompt 模板含 "只输出 JSON"、band 范围声明、`*_zh` 字段、`temperature` ≤0.3（AC §3-P）。

### L3 API 契约（TestClient + tmp db）
覆盖 §1 表全部端点，每个至少：状态码、envelope `{data:...}`、错误体 `{detail,code}`、空态（无数据时返回空列表而非 500）。
关键路径：
- AC-G2：`POST /listening/sets/{id}/attempt` 后 `GET /attempts?module=listening` 有 1 条，`GET /progress/summary` 计数 +1。
- AC-C1：`PATCH /settings` 只传 `target_band`，其余字段原值保持。
- AC-C2：`PUT /settings/ai-key` 后所有 GET 响应不含明文 key（对响应文本做 `assert key not in body`）。
- 删除项 AC-X1：`GET /api/payment/order` → 404（防回归）。
- 413：turn 音频 >5MB；400：无 audio 无 text。

### L4 迁移/存储
- `test_migrate.py`：旧 6 表库 → 归档为 `app.pre-ielts.bak` + 新 schema 建成 + 不崩；空目录首启可用。
- `test_store.py`：事务写入 `attempts`/`attempt_items` 级联删除（`ON DELETE CASCADE`）、`review_items` upsert 累加 `seen_count`。
- `test_sets_loader.py`：`data/ielts/**` 全量 schema 校验（必填字段、id 规则、题型枚举、听力有 `sentences`、Task1 有 `chart.data`、阅读 800–950 词、Part1/2/3 数量下限 AC-S1）；**含版权守卫**：正则检查篇章文本不含 "Cambridge IELTS"、"Official IELTS" 等来源标注（AC 见 CONSTITUTION §2）。

## 3. 前端测试矩阵（vitest + msw）

- `services/api.test.ts`：§7 全部导出函数（URL、method、body、unwrap `data`、错误文案含中文）。
- `hooks/`：`useBackendReady`（就绪前 false、重试次数、超时错误文本）、`useTimer`（倒计时到 0 回调一次）、`useRecorder`（无麦克风时 error 状态、stop 返回 blob+durationMs）、`useDraftAutosave`（ debounce 写 localStorage、恢复、提交后清除 — AC-W2）。
- `features/writing/ChartSvg.test.tsx`：5 种 chart.type 渲染出 series 数量与轴标签（AC-W1）；空数据渲染空态。
- `features/speaking/*`：CueCard 60s/120s 到点回调、录音状态机（idle→recording→done）、BandRadar 四维标签、文本兜底输入提交（AC-S3b）。
- `features/listening/*`：AnswerSheet 提交 FormData/JSON、GapInput 字数上限提示、播放器倍速与逐句重听触发（mock Audio）。
- `features/reading/*`：定位高亮（AC-R2）、到点自动提交（AC-R3）、题号导航滚动。
- `features/report/*`：空态文案无 NaN（AC-P3）、四科 band 卡片、趋势点渲染数量。
- `ui/*`：Button/Card/Tabs/Modal/Field/Toast 的键盘可访问性（Enter/Escape 关闭、aria）、`ScoreBand` 三档配色（≥7 good / 5.5–6.5 mid / ≤5 poor）。
- IA 守卫：`App.test.tsx` 断言左导航 9 项存在且无 PRO 徽章、无升级入口（AC-X2）。

## 4. 端到端验收（真实环境，CONSTITUTION §7-5）

由我在最后一步执行（agent 不能替代）：
1. `bash scripts/check.sh`（tsc + 双端测试）全绿；
2. 起后端 + Vite，用 browser MCP 走完：改目标分与考试日 → 口语 Part2 全流程（录音用文本兜底）→ 听力一套（音频来自 TTS）→ 阅读一套（限时）→ 写作 Task1（含 SVG 图表）→ 概览页四科 band 与趋势更新 → 错题本/生词本出现本次条目 → 报告页分析正确；
3. AI 相关：配置 key 后 `health.ai_configured=true`，评分返回 `ai_used=true`；故意填错 base_url 时结果标记 `degraded_reason` 且 UI 显示「离线近似」；
4. `npm run tauri build` 产出 EXE 且双击可跑（打包 agent 负责，我复核）。
任何一步报错：当场修，不允许只报告。

## 5. 覆盖优先级（如果时间不够，按此砍）

P0 band_scale/answer_norm/客观判分/落库/隔离/AI 降级可见 → P1 四科流程 API+UI → P2 报告/计划/词汇错题 → P3 内容生成端点 `/content/generate`。
砍内容数量（每科先 3–5 set）可以，砍 P0 不行。

## 6. 状态注记（qa-completion，2026-10-18；仅注记，不改动上方计划正文）

已完成（本项遗留整改）：
- §1「前端 msw 覆盖不全」行：**已修**。`src/test/mocks/handlers.ts` 按契约 §1（含 §10 定稿）逐端点组重写，
  payment/scene/wordbook/wrong-records/learning-stats/achievements/sentence-parse/phoneme-tip 全部删除；
  按组导出（`healthHandlers`/`settingsHandlers`/`speakingHandlers`…）供 feature 测试 `server.use` 选挂。
  msw server 生命周期统一收敛到 `src/test/setup.ts`（`testUtils.tsx` 与 `api.test.ts` 不再重复 listen/reset/close）。
- §3 `services/api.test.ts`：**已重写**，65 例覆盖 §7 全部导出（URL/method/body、`{data}`+`{total}` unwrap、
  ApiError 中文文案、setAiKey 失败脱敏、abort 透传、turn multipart、听力音频 blob 与 503、图表归一化、
  `API_BASE` 单一来源）。注：jsdom 限制 —— 含 Blob 部件的 FormData 无法经 undici fetch 真实发出，
  音频上传两例改用 fetch spy 断言请求形态，feature 作者写录音流程时同样要避开真实 multipart 上行。
- §0 `bash scripts/check.sh`：**已实现**（gate1 tsc → gate2 vitest → gate3 pytest；`--quick` 跳过 pytest；
  首个失败即非零退出）。注意 `backend/pytest.ini` addopts 已含 `-q` 与 `-m "not integration"`，
  命令行重复传 `-q` 会变成 `-qq` 并吞掉 "N passed" 摘要行，check.sh 因此只调 `python -m pytest`。
- `frontend/package.json` → 2.0.0（`scripts/version-check.ps1` 三处一致通过）；新增 `test:ci`
  （vitest 4 已移除 `basic` reporter，改用 `dot`）。

最近一次实测（2026-10-18，供复核）：
- `cd backend && venv/Scripts/python.exe -m pytest` → **274 passed**（not integration，Wave 1 遗留的 2 个红已不复现）。
- `cd frontend && npm test` → 146 passed / 3 failed；失败全部位于 `src/features/speaking/SpeakingPanel.test.tsx`
  （speaking feature agent 在写文件，收敛中：同轮次先 7 红后 3 红）。qa 自有范围（ui 75 例 + api 65 例）全绿。
- `npx tsc -b` 红：13 处错误全部位于 `src/features/{reading,speaking,shared}/**`，为并发 feature agent 在写代码，
  `src/test/**` 与 `src/services/api.test.ts` 无类型错误。
- §1 表中 #40/#41 `/content/*` 未写 handler（§10.4 定为 P3 且后端故意未注册，属可后置）。

### 6.1 最终实测（2026-10-18，Wave 3 主控，覆盖上方"最近一次实测"）

§4 七步端到端逐条结果：
1. **`bash scripts/check.sh` 全绿**：gate1 tsc 无错误 → gate2 vitest 29 文件 / **311 用例** → gate3 pytest **274 用例**。
   期间修掉一处系统性 flake（满负载下 `findBy*` 的 1s 默认上限饿死，改为在 `src/test/setup.ts`
   `configure({ asyncUtilTimeout: 4000 })`，只放宽等待上限、**未放宽任何断言**）。
2. **浏览器实跑**：起后端 + Vite，用真实 DOM 点击走完四科与报告/词汇/设置。上面 146/3 的 speaking 红灯与 13 处 tsc 错误
   均已不复现。真点击额外发现 3 个 mock 绿灯看不到的缺陷（逐句重听锚点溢出、生词本 UTC 日期、设置页「已保存」被回读冲掉 +
   重复 `role=alert`），逐个当场修掉并补测，详见 `spec-contracts.md` §13。
3. **AI 相关（部分未完成，诚实声明）**：`ai_configured=true` 与「填错端点 → `degraded_reason` + UI 显示离线近似」两条均已实证；
   但 `ai_used=true` **无法验证** —— 当前设置里的 base_url 指向的中转域名不提供 `chat.completions`，
   写作/口语评分实际走本地近似。需用户在设置页换一个真正可用的 base_url + key 后复跑本步（key 绝不进聊天/日志/返回值）。
4. **打包**：`scripts/build.ps1` 退出码 0，产出 NSIS 安装包；冻结 sidecar 用临时库实跑通过 `/health` 与判分。
   **"双击可跑"未验证** —— 安装器会写入用户系统，需用户同意后再实装；GUI 窗口内的 WebView2 麦克风采集同样待实装后验证。
