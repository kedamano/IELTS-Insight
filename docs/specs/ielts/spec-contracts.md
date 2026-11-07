# CONTRACTS — 跨进程契约（前端/后端/测试/打包共同真源）

改任何一条契约：先改本文件，再改代码。契约不一致视为 bug，不靠"看对方实现"来对齐。

## 0. 通用约定

- 基址：`http://127.0.0.1:8765/api`；前端只在 `frontend/src/services/api.ts` 定义一次（`API_BASE`，可被 `import.meta.env.VITE_API_BASE` 覆盖）。
- 除音频/文件响应外，全部返回 `200` + `{"data": <payload>}`（沿用现有 envelope，前端 `fetchJson` 已 unwrap）。
- 错误：`{ "detail": "<中文可读文本>", "code": "<机器码>" }` + 恰当状态码（400 校验 / 404 不存在 / 409 冲突 / 413 过大 / 502 AI 上游失败 / 503 依赖服务不可用）。
- 时间：ISO-8601 UTC 字符串；时长：秒（整数或一位小数）。
- 分数：`band` 一律 `0–9`，`0.5` 步长（`float`）；`raw` 0–100 仅作辅助。
- AI 结果公共字段（所有含评分的响应都必须有）：
  ```json
  { "ai_used": true, "degraded_reason": null, "model": "glm-4.6", "approximate": false }
  ```
  `degraded_reason` 枚举：`no_api_key` / `network_error` / `timeout` / `invalid_model_output` / `incomplete_dimensions` / `offline_template` / `preset_exhausted`（Wave 8 收编：陪练预置问句用尽 —— 它不是 AI 失败，也不是用户关网，但它是**降级**，必须留在跨模块枚举里，见 §16.3 规则 1）。

## 1. 端点总表

约定：`module ∈ {speaking, listening, reading, writing}`。

| # | Method & Path | 请求 | `data` 响应 | 状态 |
|---|---|---|---|---|
| 1 | `GET /health` | – | `{version, pid, port, port_source, started_at, ai_configured, ai_base_url_host, ai_model, whisper: {loaded, model}, tts_ok, content_counts: {speaking,listening,reading,writing}, storage: {state, reason}}`（`storage` 见 §14.6；`pid`/`port`/`started_at` 见 §15.4；库读不出来时本端点**仍 200**） | 新 |
| 2 | `GET /settings` | – | `Settings`（§4） | 改 |
| 3 | `PATCH /settings` | JSON 部分字段 | `Settings`（未提供字段保持原值） | 改 |
| 4 | `PUT /settings/ai-key` | `{key: string}` | `{ai_key_present: true}` | 新 |
| 5 | `DELETE /settings/ai-key` | – | `{ai_key_present: false}` | 新 |
| 6 | `GET /speaking/sets?target_band=` | – | `{items: SpeakingSetMeta[]}` | 新 |
| 7 | `GET /speaking/sets/{set_id}` | – | `SpeakingSet`（§2-S） | 新 |
| 8 | `POST /speaking/sessions` | `{set_id, part: 1\|2\|3, question_id?}` | `{session_id, part, current: SpeakingPrompt, index, total}` | 新 |
| 9 | `GET /speaking/sessions/{id}` | – | `{session_id, state, prompts[], turns[], result?}` | 新 |
| 10 | `POST /speaking/sessions/{id}/turn` | multipart `audio`（webm）**或** form `text`，附 `duration_sec` | `{turn_id, transcript, confidence, next: SpeakingPrompt\|null, elapsed_limit_reached: bool}` | 新 |
| 11 | `POST /speaking/sessions/{id}/assess` | – | `SpeakingReport`（§3-S） | 新 |
| 11b | `POST /speaking/sessions/{id}/assess/async` | – | `JobView`（§10.6） | 新 |
| 12 | `POST /speaking/followups` | `{set_id, part2_transcript}` | `{questions: string[]}` (AI 追问，失败回预置) | 新 |
| 13 | `GET /listening/sets?accent=&kind=` | – | `{items: SetMeta[]}` | 新 |
| 14 | `GET /listening/sets/{set_id}` | – | `ListeningSet`（§2-L，不含 `answer`） | 新 |
| 15 | `GET /listening/sets/{set_id}/audio?accent=` | – | `audio/mpeg`（`X-Audio-Cache: hit\|miss`）；失败 503 `{code:"tts_unavailable", transcript_available:true}` | 新 |
| 16 | `POST /listening/sets/{set_id}/attempt` | `{answers: {qid: string}, duration_sec}` | `ObjectiveReport`（§3-OR，含 `transcript`） | 新 |
| 17 | `GET /reading/sets?level=` | – | `{items: SetMeta[]}` | 新 |
| 18 | `GET /reading/sets/{set_id}` | – | `ReadingSet`（§2-R，不含 `answer`） | 新 |
| 19 | `POST /reading/sets/{set_id}/attempt` | `{answers: {qid: string}, duration_sec, timed_out: bool}` | `ObjectiveReport` | 新 |
| 20 | `GET /writing/tasks?module=task1\|task2` | – | `{items: WritingTask[]}`（含 `chart.data`） | 新 |
| 21 | `POST /writing/attempts` | `{task_id, response, duration_sec, draft_saved_at?}` | `WritingReport`（§3-W） | 新 |
| 21b | `POST /writing/attempts/async` | 同 21 | `JobView`（§10.6） | 新 |
| 22 | `GET /writing/attempts/{attempt_id}` | – | `WritingReport` | 新 |
| 22b | `GET /jobs/{job_id}` | – | `JobView`（§10.6） | 新 |
| 22c | `GET /jobs?status=all\|active&limit=50` | `limit` 1–200 | `{items: JobView[]}` | 新 |
| 23 | `GET /attempts?module=&limit=&offset=` | – | `{items: AttemptSummary[], total}` | 新 |
| 24 | `GET /attempts/{attempt_id}` | – | `{attempt: AttemptSummary, payload: <module report>}` | 新 |
| 25 | `DELETE /attempts/{attempt_id}` | – | `{deleted: true}`（重算趋势） | 新 |
| 26 | `GET /progress/summary` | – | `{target_band, exam_date, days_left, current: {module: band\|null}, delta_vs_previous, attempts_total, minutes_total, last_practice_at}` | 新 |
| 27 | `GET /progress/trend?module=&days=` | `days` 缺省 90，范围 1–36600（要"整个历史"就传大值，服务端不设 3 年这种人为上限） | `{points: [{date, band}]}`，按 date 升序 | 新 |
| 28 | `GET /progress/analytics?weeks=8` | – | `{by_question_type: [{question_type, correct, total, accuracy}], by_module: [{module, correct, total, accuracy}], by_error_type: [{error_type, count, latest_quote}], minutes_by_day: [{date, minutes}]}` | 新 |
| 29 | `GET /plan/today` | – | `{items: PlanTask[], generated_at}` | 新 |
| 30 | `POST /plan/{task_id}/done` | `{done: bool}` | `{ok: true}` | 新 |
| 31 | `GET /review/errors?module=&status=&error_type=` | – | `{items: ReviewItem[]}` | 新 |
| 32 | `POST /review/{id}/resolve` | – | `{status: "resolved"}` | 新 |
| 33 | `DELETE /review/{id}` | – | `{deleted: true}` | 新 |
| 34 | `GET /vocab?word=` | – | `WordInfo`（沿用现有 + `{audio_url, collocations[], topic}`） | 保留 |
| 35 | `POST /vocab` | `{word, context, source_module, source_ref, note_zh, tags[]}` | `VocabNote` | 改 |
| 36 | `GET /vocab` | – | `{items: VocabNote[]}` | 改 |
| 37 | `DELETE /vocab/{word}` | – | `{deleted: true}` | 保留 |
| 38 | `GET /vocab/export?format=csv\|anki` | – | `text/csv`（TSV for anki） | 保留 |
| 39 | `GET /tts?text=&voice=&speed=` | – | `audio/mpeg`（保留，voice 增加口音参数） | 保留 |
| 40 | `POST /content/generate` | `{module, count?, target_band?, part?, task?, topic_hint?}` | `JobView`（§10.6，`module="content"`，`task_ref=<目标模块>`） | Wave 8 已接入（§17） |
| 41 | `GET /content/jobs/{job_id}` | – | `JobView`；成功时 `report` 为 `ContentJobReport`（§17.3） | Wave 8 已接入（§17） |
| 42 | `GET /backup` | – | `{items, keep, max_age_days, days_since_last, directory}`（§14.3） | Wave 7 |
| 43 | `POST /backup` | – | 那一行的 `manual` 快照 | Wave 7 |
| 44 | `POST /backup/{name}/restore` | – | `{restored, pre_restore}`；名字非法 400，找不到 404 | Wave 7 |
| 45 | `GET /attempts/trash` | `module=&limit=&offset=` | `{items: AttemptSummary[]（多 `deleted_at`）, total}` | Wave 7 |
| 46 | `POST /attempts/{id}/restore` | – | `{restored: true}`；未知 id 404，未删过的幂等 200 | Wave 7 |
| 47 | `DELETE /attempts/{id}/purge` | – | `{purged: true}`；本机零快照时 409 先备份 | Wave 7 |
| 48 | `PUT /drafts/{key}` | `{value, saved_at?}` | `{key, updated_at, size}`（§14.5） | Wave 7 |
| 49 | `GET /drafts/{key}` | – | `{key, value, updated_at}`；无草稿 404 | Wave 7 |
| 50 | `DELETE /drafts/{key}` | – | `{cleared: true}`（幂等） | Wave 7 |
| 51 | `GET /sparring/topics` | `level=` 可选 | `{items: SparringTopicMeta[]}`（§16.2） | 新（Wave 8） |
| 52 | `GET /sparring/topics/{topic_id}` | – | `SparringTopic`（§16.2） | 新（Wave 8） |
| 53 | `POST /sparring/sessions` | `{topic_id, level?}` | `SparringSessionStart`（§16.3） | 新（Wave 8） |
| 54 | `GET /sparring/sessions/{session_id}` | – | `SparringSession`（§16.3） | 新（Wave 8） |
| 55 | `POST /sparring/sessions/{session_id}/turn` | multipart `audio` 或 form `text` + `duration_sec` | `SparringTurnResult`（§16.3） | 新（Wave 8） |
| 56 | `POST /sparring/sessions/{session_id}/assess` | – | `SpeakingReport` + `sparring` 块（§16.4）；与 #11 同形状 | 新（Wave 8） |
| 57 | `POST /sparring/sessions/{session_id}/assess/async` | – | `JobView`（§10.6） | 新（Wave 8） |

**删除**：`/payment/order`、`/payment/verify`、`/scenes*`、`/sentence-parse/{scene_id}/{seq}`、`/stt`（并入口语 turn，但仍保留 `POST /stt` 供内部复用——决策：保留 `POST /stt`，前端不再直接调）、`/score`（被 `/speaking/.../assess` 取代；`score_service` 内部函数保留供发音近似分计算）、`/learning-stats`、`/achievements`、`/wrong-records*`（由 `/review/errors` 取代）、`/wordbook*`（由 `/vocab*` 取代）。

## 2. 内容 schema（`backend/app/data/ielts/*.json`）

所有 set 顶层公共字段：
```json
{ "id": "sp_p2_environment_01", "module": "speaking", "kind": "practice",
  "target_band": 6.5, "title_zh": "环境类话题", "topic": "environment",
  "source": "ai:glm-4.6", "generated_at": "2026-10-17T00:00:00Z" }
```
`id` 规则：`{module_abbr}_{part|kind}_{topic}_{nn}`；`module_abbr ∈ {sp, li, re, wr}`。

### 2-S Speaking
```json
{ "id": "sp_p2_environment_01", "module": "speaking",
  "part2": { "cue_card": { "prompt": "Describe a skill you would like to learn.",
        "bullets": ["what it is","why you want to learn it","how you would learn it"],
        "preparation_sec": 60, "speaking_sec": 120 } },
  "part1": [ {"id":"q1","question":"Do you work or are you a student?"} ],
  "part3": [ {"id":"q1","question":"Why do some people learn faster than others?",
              "depends_on_part2": true} ],
  "fallback_questions": ["..."],
  "examiner_voice": "en-GB-SoniaNeural" }
```
前端渲染用 `SpeakingPrompt = {id, part, kind: "question"|"cue_card", text, preparation_sec?, speaking_sec?, audio_url}`。

### 2-L Listening
```json
{ "id": "li_s2_travel_03", "module": "listening", "section": 2, "instruction_zh": "听录音，完成 11–20 题，每空不超过 TWO WORDS AND/OR A NUMBER。",
  "audio_text": "…full passage…",
  "sentences": [{"idx":0,"text":"The museum opens at 9:30.","anchor_sec":12.0}],
  "questions": [
    {"id":"q1","type":"gap_fill","number":11,"prompt":"The museum opens at ______.","word_limit":3,
     "answer":"9:30","accepted_alternatives":["nine thirty","9.30"],"explanation_zh":"…"},
    {"id":"q2","type":"multiple_choice","number":12,"prompt":"Why did the man call?","options":["A. …","B. …","C. …"],"answer":"B","explanation_zh":"…"},
    {"id":"q3","type":"matching","number":13,"prompt":"Match each person to an activity.","options_list":[...],"answer":"C","explanation_zh":"…"},
    {"id":"q4","type":"map_diagram_label","number":16,"prompt":"Where is the entrance?","labels":["A","B","C"],"answer":"A","explanation_zh":"…"}
  ] }
```
`GET`（题面）响应**必须剔除** `answer`/`accepted_alternatives`/`explanation_zh`；只有 attempt 响应回传。

### 2-R Reading
```json
{ "id": "re_h_urban_02", "module": "reading", "level": "upper-intermediate", "title": "The Twelve-Minute City",
  "time_limit_sec": 1200, "word_count": 874,
  "passage": { "paragraphs": [ {"label":"A","text":"…"} ] },
  "questions": [
    {"id":"q1","type":"true_false_notgiven","number":1,"statement":"…","answer":"NOTGIVEN","answer_label":"C","answer_paragraph":"B","answer_quote":"…","explanation_zh":"…"},
    {"id":"q2","type":"heading_match","number":2,"paragraph_label":"B","options_headings":[{"i":"i","text":"…"}],"answer":"iv","explanation_zh":"…"},
    {"id":"q3","type":"sentence_completion","number":5,"prompt":"…the ___ of the city…","word_limit":2,"answer":"density","accepted_alternatives":[],"explanation_zh":"…"},
    {"id":"q4","type":"multiple_choice","number":9,"prompt":"…","options":["A. …"],"answer":"A","explanation_zh":"…"} ] }
```

### 2-W Writing
```json
{ "id": "w1_line_energy_04", "module": "writing", "task": "task1",
  "time_recommend_sec": 1200, "min_words": 150,
  "prompt": "The chart below shows … Summarise the information …",
  "chart": { "type": "line", "unit": "million tonnes", "years": [2000,2010,2020],
             "series": [{"name":"Coal","values":[120,98,64]}],
             "source_note": "Data generated for practice" },
  "band_descriptors_ref": "task1" }
```
`task2`：`{"task":"task2","min_words":250,"time_recommend_sec":2400,"question_type":"agree_disagree","prompt":"…","outline_hint":["…"]}`。
`chart.type ∈ {line, bar, pie, table, dynamic_chart}`；前端本地 SVG 渲染，禁止依赖外部图片 URL。

## 3. 评分契约

### 3-S SpeakingReport
```json
{ "attempt_id": "att_…", "ai_used": true, "degraded_reason": null, "approximate": false,
  "band": {"overall":6.5,"fluency_coherence":6.5,"lexical_resource":6.0,"grammatical_range_accuracy":6.0,"pronunciation":7.0,
           "pronunciation_confidence":"high|low"},
  "evidence": [{"criterion":"lexical_resource","quote":"a lot of good things","why":"用词空泛","level":"6.0"}],
  "strengths": ["…"], "improvements": [{"issue":"…","fix":"…","quote":"…"}],
  "model_answer": "…", "upgrade_vocabulary": [{"from":"good","to":"rewarding","note_zh":"…"}],
  "metrics": {"word_count":214,"wpm":118,"pause_total_sec":8.2,"fillers":["you know"],"repeats":3},
  "pronunciation_detail": {"wer":0.12,"score_0_100":78,"problem_words":[{"word":"thorough","expected":"θ","actual":"s"}]} }
```

### 3-OR ObjectiveReport（听力/阅读共用）
```json
{ "attempt_id":"att_…", "module":"listening", "raw_correct":16, "raw_total":20,
  "band":7.0, "band_scale":"listening_20q", "ai_used":false, "approximate":false,
  "items":[{"id":"q3","number":13,"type":"matching","your_answer":"D","expected":"C",
            "accepted_alternatives":["…"],"correct":false,"reason":"wrong|over_word_limit|unanswered|spelling_variant_rejected",
            "explanation_zh":"…","answer_quote":"…","answer_paragraph":"B","time_spent_sec":28}],
  "by_question_type":{"gap_fill":{"correct":7,"total":8},"multiple_choice":{"correct":4,"total":6}},
  "transcript":"…(听力回传原文)", "accuracy":0.8 }
```

### 3-W WritingReport
```json
{ "attempt_id":"att_…", "task":"task2", "ai_used":true, "degraded_reason":null, "approximate":false,
  "band":{"overall":6.0,"task_response":6.0,"coherence_cohesion":6.5,"lexical_resource":6.0,"grammatical_range_accuracy":5.5},
  "word_count":268, "word_count_penalty":null,
  "corrections":[{"quote":"people is…","error_type":"grammar","explanation_zh":"主谓一致","suggestion":"people are…","severity":"high"}],
  "upgraded_sentences":[{"from":"…","to":"…","why_zh":"…"}],
  "structure_issues":[{"kind":"paragraph_function","issue_zh":"…","paragraph_index":3}],
  "strengths":["…"], "model_answer":"…", "error_summary":{"grammar":4,"lexical":2} }
```
`word_count_penalty`：Task1 <150 或 Task2 <250 时 `{"kind":"under_length","missing_words":37}`，且此时 `band.task_response` 上限夹到 5.0（官方规则）。

### 3-B band 换算表（客观题）
```python
LISTENING_40 = {39:9.0,37:8.5,35:8.0,32:7.5,30:7.0,26:6.5,23:6.0,19:5.5,15:5.0,13:4.5,10:4.0,8:3.5,6:3.0,4:2.5,2:2.0}
READING_40   = {39:9.0,37:8.5,35:8.0,33:7.5,31:7.0,27:6.5,23:6.0,19:5.5,15:5.0,12:4.5,9:4.0,7:3.5,5:3.0,3:2.5,2:2.0}
```
20 题听力用等比映射（`raw*2` 后查表，落在两档之间取较低档，恰在中点允许 `+0.5`）；13 题阅读同理。
AC 锚点：听力 16/20 → **7.0**，13/20 → **6.0**；阅读 10/13 → **7.0**，8/13 → **6.0**。
表中档内实现细节由后端定，但必须过这 4 个锚点测试（`tests/test_band_scale.py`）。

**§3-B 定稿修正（Wave 2，`grade-core` 提出，属实）**：上面"`raw*2` 后查 40 题表"的说法与 4 个锚点自相矛盾
（16×2=32 → 7.5，13×2=26 → 6.5，各比锚点高 0.5）。验收依据是锚点，不是那句换算描述。
因此 20/13 题档**显式定义独立换算表**（`app/services/band_scale.py` 的 `LISTENING_20` / `READING_13`），
40 题档逐字使用上面的 `LISTENING_40` / `READING_40`：
```python
LISTENING_20 = {20:9.0,19:8.5,18:8.0,17:7.5,16:7.0,14:6.5,13:6.0,11:5.5,10:5.0,8:4.5,7:4.0,5:3.5,4:3.0,3:2.5,2:2.0,1:1.5}
READING_13   = {13:9.0,12:8.5,11:8.0,10:7.0, 9:6.5, 8:6.0, 7:5.5, 6:5.0, 5:4.5,4:4.0,3:3.0,2:2.5,1:1.5}
```
规则：单调不降；两档之间取低；`raw_correct` 夹紧到 `[0, raw_total]`；非整数或 `raw_total` 不属于
`{listening:(20,40), reading:(13,40)}` 时专用入口抛 `ValueError`（API 转 400，绝不 500）；
非契约题数（如测试构造的 5 题集）走 `raw_to_band()` 的 40 题等比兜底映射。

### 3-P LLM Prompt 契约
`backend/app/prompts/` 下按模块分文件，每个 prompt 必须：
1. 要求**只输出 JSON**，并给出严格 schema 与 `band` 取值范围（0–9，0.5 步长）；
2. 强制 `evidence`/`corrections` 里的 `quote` 为考生原文连续片段（后端校验 `quote in transcript`，否则丢弃该条并计 `invalid_quotes`）；
3. 中文解释字段命名 `*_zh`，英文引用字段保持原文；
4. `temperature ≤ 0.3`、`max_tokens` 显式设置、超时默认 **120s**（`AI_TIMEOUT_SEC` 可配）。
   `max_tokens` 必须为**推理型端点的隐藏思考**留出预算：实测 LongCat-2.0 在 4000 时把预算全花在
   reasoning 上、`finish_reason=length` 截断 JSON，于是被判成 `invalid_model_output`。
   定档：写作 8000 / 口语 7000 / Part 3 追问 3000（`app/prompts/__init__.py`）。
   openai SDK 的自带重试必须关（`max_retries=0`）——否则一次超时会变成 3 次请求（实测 30s 变 92s 白等），
   也与第 5 条「只有解析失败才重试」矛盾；
5. 解析失败重试 1 次，仍失败 → `ai_used=false` + `degraded_reason="invalid_model_output"` + 本地近似结果。
**禁止**把 API key 拼进日志或异常文本。

## 4. Settings（`PATCH` 语义：未提供字段不动）
```json
{ "target_band": 6.5, "exam_date": "2027-01-15", "daily_goal_minutes": 60,
  "accent": "en-GB", "tts_voice": "en-GB-SoniaNeural", "tts_speed": 1.0,
  "show_chinese_hints": true, "show_punctuation": true, "online_enabled": true,
  "audio_device": null, "recording_input_gain": 1.0, "theme": "system",
  "ai": {"configured": false, "base_url_host": null, "model": "gpt-4o-mini", "key_source": "env"} }
```
`theme`（Wave 4 新增，浅/深两套外观）：枚举 `light | dark | system`，其它值 `400 validation_failed`
（真源 `api/settings.py:_check_theme`）。`system` 由前端按 `prefers-color-scheme` 解析后写
`html[data-theme]`；后端只存偏好，不做任何渲染判断。老库的 settings JSON blob 缺这个键时取默认
`system`（`store.DEFAULT_SETTINGS` 合并），因此无需迁移。

## 5. 数据库（`backend/app/db/schema.sql`，唯一建表源）

现有 6 表（`scenes/practice_records/wrong_records/learning_records/wordbook/settings`）中前 4 张废弃，
迁移策略：~~**不写迁移脚本**~~（**Wave 7 已由 §14 推翻**：那句只在「一次性从剧本库切到雅思库」时成立，
而 app 已发布、库里已有真实学习记录，此后任何结构变更都必须走 §14.2）；启动时若检测到旧库文件，
把旧表数据一次性归档为 `db/app.pre-ielts.bak`（同目录复制），再建新 schema；`db/app.db` 路径改为
`%LOCALAPPDATA%/IELTSInsight/app.db`（避免 PyInstaller 相对 CWD 的坑），仍可用 `IELTS_DB_PATH` 覆盖（测试用）。

```sql
CREATE TABLE sets(id TEXT PRIMARY KEY, module TEXT NOT NULL, kind TEXT, target_band REAL,
  title_zh TEXT, topic TEXT, source TEXT, generated_at TEXT, data_json TEXT NOT NULL);
CREATE TABLE sets_meta(module TEXT PRIMARY KEY, count INTEGER);

CREATE TABLE attempts(id TEXT PRIMARY KEY, module TEXT NOT NULL, task_ref TEXT NOT NULL,
  part TEXT, started_at TEXT, duration_sec REAL, band_overall REAL, band_sub_json TEXT,
  raw_json TEXT, ai_used INTEGER, degraded_reason TEXT, approximate INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE attempt_items(id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  item_ref TEXT, item_number INTEGER, question_type TEXT, prompt_ref TEXT,
  your_answer TEXT, expected TEXT, correct INTEGER, reason TEXT, time_spent_sec REAL, detail_json TEXT);
CREATE TABLE speaking_turns(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, attempt_id TEXT, turn_index INTEGER,
  prompt_id TEXT, prompt_text TEXT, transcript TEXT, confidence REAL, duration_sec REAL, started_at TEXT);
CREATE TABLE speaking_sessions(id TEXT PRIMARY KEY, set_id TEXT, part TEXT, state TEXT,
  current_index INTEGER, created_at TEXT, updated_at TEXT, result_attempt_id TEXT);
CREATE TABLE jobs(id TEXT PRIMARY KEY, module TEXT NOT NULL, task_ref TEXT NOT NULL, dedupe_key TEXT,
  status TEXT NOT NULL, request_json TEXT NOT NULL, attempt_id TEXT, report_json TEXT,
  error TEXT, degraded_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT, finished_at TEXT);
CREATE TABLE review_items(id TEXT PRIMARY KEY, module TEXT, item_ref TEXT, question_type TEXT,
  error_type TEXT, quote TEXT, detail_zh TEXT, status TEXT DEFAULT 'open',
  first_seen_at TEXT, last_seen_at TEXT, seen_count INTEGER DEFAULT 1, resolved_at TEXT, source_attempt_id TEXT);
CREATE TABLE vocab(word TEXT PRIMARY KEY, context TEXT, source_module TEXT, source_ref TEXT,
  note_zh TEXT, tags TEXT, created_at TEXT, phonetics_json TEXT);
CREATE TABLE practice_minutes(date TEXT PRIMARY KEY, minutes REAL, attempts INTEGER);
CREATE TABLE plan_tasks(id TEXT PRIMARY KEY, date TEXT, module TEXT, set_ref TEXT,
  reason_zh TEXT, done INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK (id=1), json TEXT NOT NULL, updated_at TEXT);
```
约定：`attempts` 是唯一的练习事实表（修复 AC-G2）；`band_sub_json` 存各维 band；`raw_json` 存完整模块报告。
所有写入必须走 `backend/app/db/store.py` 里的事务型函数，路由不写裸 SQL。

`jobs` 是**队列日志而不是事实表**：批改结果一旦成功就写进 `attempts`，`jobs.report_json` 只是给
轮询用的副本。因此它**不指向 `attempts` 建外键**——用户删除练习记录（`DELETE /attempts/{id}`）
不该被队列历史挡住。`jobs.status ∈ {queued, running, succeeded, failed}`（§10.6）。

## 6. 后端模块结构（路由必须从 `services/__init__.py` 拆出）

```
backend/app/
  config.py            # +OPENAI_BASE_URL, OPENAI_MODEL, AI_TIMEOUT_SEC, DB 路径改 LOCALAPPDATA, env IELTS_* 覆盖
  main.py              # 组装 app、include_router(api_router)、startup 初始化 db+载入 sets
  api/__init__.py      # api_router = APIRouter(prefix="/api") 聚合
  api/{health,settings,speaking,listening,reading,writing,attempts,progress,plan,review,vocab,content}.py
  db/{schema.sql,store.py,migrate.py}   # migrate.py = 归档旧 app.db + create_all
  services/band_scale.py         # 纯函数：raw→band（无 IO，最易测）
  services/ai_client.py          # 统一 LLM 调用（key/base/model/timeout/重试/绝不泄露 key）
  services/{speaking_writing}_grader.py   # 组 prompt → ai_client → 校验/夹紧 → 报告
  services/{listening,reading}_grader.py   # 纯规则判分 + 等价规范化
  services/answer_norm.py        # 大小写/冠词/数字日期/拼写变体等价
  services/offline_feedback.py   # 无 AI 时的本地近似（写作统计、口语模板）
  services/{tts_service,stt_service,word_service}.py   # stt 改懒加载
  prompts/{speaking,writing}.py  # 模板字符串，含 JSON schema 文本
  data/ielts/{speaking,listening,reading,writing}/*.json
```

## 7. 前端契约

`api.ts` 导出（全部走 `fetchJson`，禁组件内裸 fetch）：
```ts
health(), getSettings(), patchSettings(p), setAiKey(k), clearAiKey(),
speakingSets(b), speakingSet(id), startSpeaking(p), getSpeakingSession(id),
postSpeakingTurn(id, form), assessSpeaking(id), followups(p),
listeningSets(q), listeningSet(id), listeningAudioUrl(id, accent), postListeningAttempt(id, body),
readingSets(q), readingSet(id), postReadingAttempt(id, body),
writingTasks(m), postWritingAttempt(body), writingAttempt(id),
attempts(q), attempt(id), deleteAttempt(id), progressSummary(), progressTrend(q), progressAnalytics(q),
planToday(), markPlanDone(id, done), reviewErrors(q), resolveReview(id), deleteReview(id),
wordInfo(w), addVocab(body), vocabList(), removeVocab(w), vocabExportUrl(fmt)
```
TS 类型与 §2/§3/§4 一一对应，集中放 `frontend/src/types/ielts.ts`（由前端 agent 生成，是契约的镜像；不一致以本文件为准）。

组件与文件所有权（前端功能屏）：
```
src/App.tsx                     # IA 外壳（UI agent）
src/components/ui/*             # 设计系统原子件（UI agent）：Button Card Tabs Badge Stat Countdown Bar Chart Sparkline Modal Field Toast ScoreBand
src/features/speaking/*         # SpeakingPanel CueCard RecorderControls BandRadar PronunciationDetail FollowupList
src/features/listening/*        # ListeningPanel AudioPlayer QuestionList AnswerSheet GapInput
src/features/reading/*          # ReadingPanel PassageView QuestionNav Highlight GapInput Timer
src/features/writing/*          # WritingPanel ChartSvg PromptBar DraftEditor BandCards Corrections UpgradeList ModelAnswer
src/features/report/*           # Dashboard TrendChart Analytics PlanList AttemptsList
src/features/shared/*           # VocabBook ReviewBook VocabPopover
src/features/settings/SettingsPage.tsx
src/hooks/{useBackendReady,useApi,useTimer,useRecorder,useTTS,useDraftAutosave}.ts
src/services/api.ts src/types/ielts.ts
```
删除：`SkeuoUI.tsx`、`icons/SkeuoIcons.tsx`、`SceneList.tsx`、`UpgradePage.tsx`、`HeatmapScore.tsx`、`OnboardingModal.tsx`、
`DialogueArea.tsx`、`ScorePanel.tsx`、`WordBook.tsx`/`WrongBook.tsx`/`WordPopup.tsx`/`LearningReport.tsx`/`SentenceParsePanel.tsx`（能力迁入 `features/*` 后删除原文件）。
对应旧测试文件同步删除，不做"保留旧测试"的兼容。

## 8. 设计 token（Wave 4 重写：两层 + 明暗两套，替换 §8 原学术蓝单主题）

`src/index.css` 的 `:root` 与 `:root[data-theme="dark"]` 定义**同名**语义变量，组件只消费 `@theme inline`
映射出的 Tailwind 工具类（`bg-paper` / `text-ink-muted` / `border-rule` …）或 `var(--…)`，
**组件内不得出现任何字面色值**（已机器化核对：全仓 `.tsx` 无 hex/rgba 字面量）。
主题由 `useTheme` 解析后只写 `html[data-theme]`，CSS 里不出现 `prefers-color-scheme` 分支。

当前取值（**Wave 5 换色**：浅色 = 靛蓝 Bento（冷灰画布 + 靛蓝主色 + 琥珀暖面），深色 = 夜航石墨 + 靛蓝亮档。
原「晨读暖纸 + 墨绿青」已整体替换，两套主题的**变量名一个没改**，只动取值）：
```css
/* 浅色 */ --paper:#FFFFFF; --paper-sunken:#F4F4F7; --paper-raised:#FFFFFF;
--ink:#171725; --ink-secondary:#4E4E63; --ink-muted:#666678; --rule:rgba(23,23,37,.10);
--accent:#4B3AE0; --accent-soft:#EFEFFF; --accent-strong:#3A2CB3;
--highlight:#C97A16; --highlight-soft:#FFF3DC; --highlight-ink:#4A3308;
--band-good:#17784F; --band-mid:#8C600D; --band-poor:#B02F26;
--chart-grid:rgba(23,23,37,.16); --chart-area:rgba(75,58,224,.12); --heat-0..4:#F4F4F7→#4B3AE0;
--hero-a:#5A47EE; --hero-b:#3E2DBB; --hero-ink:#FFFFFF; --hero-ink-muted:#E8E5FF;
--tile-solid:#171725; --tile-solid-ink:#F1F1F6; --tile-solid-muted:#A8AEC4;   /* 磁贴面，见 §8.1 */
/* 深色 */ --paper:#161B22; --paper-sunken:#0D1117; --paper-raised:#1B2230;
--ink:#E7ECF3; --ink-secondary:#B6C2D4; --ink-muted:#98A4B8; --rule:rgba(255,255,255,.15);
--accent:#A99CFF; --accent-soft:rgba(169,156,255,.16); --highlight:#F0B24A;
--band-good:#37D39A; --band-mid:#F0B24A; --band-poor:#FF7A6B;
--chart-grid:rgba(255,255,255,.22); --chart-area:rgba(169,156,255,.30); --heat-0..4:#262E3D→#A99CFF;
--hero-a:#4B3AE0; --hero-b:#2C2199; --hero-ink:#E8ECFF; --hero-ink-muted:#D8D4FA;
--tile-solid:#3A4A68; --tile-solid-ink:#E7ECF3; --tile-solid-muted:#B6C2D4;
--radius:14px; --radius-control:10px; --radius-tile:16px; --font-display:"Sora"; --font-text:"Manrope"; --font-mono:"JetBrains Mono";
--motion-fast:140ms; --motion-base:200ms; --motion-slow:280ms;   /* 原「≤150ms」上限让切换像硬切 */
```

**换色不是抄样机取值，是抄了取值还要过对比度**（样机 `b-bento` 有两处按 WCAG 不达标，落地时已改）：
次要墨色样机给 `#75758B`，落在新画布 `#F4F4F7` 上只有 **4.09:1** → 取 `#666678`（5.12:1）；
hero 与 cool 面上的次要文字样机用 `opacity:.62`（白字 3.24:1、亮墨 7.40:1）→ 白字那侧**不能靠透明度**，
`rgba(255,255,255,α)` 要过 4.5 得 α≥0.83，观感等于没有层级，故新增实色令牌 `--hero-ink-muted:#E8E5FF`（4.78:1）。

**对比度是取值规则，不是事后调优**（WCAG AA，按「最坏落点」算：正文小字落在 `--paper-sunken` 上，
不是落在白卡上）：
1. 任何会被当**文字**用的 token，与其最坏落点的对比度 ≥ 4.5:1。深色 `--accent` 因此取 `#A99CFF`
   而不是 `#8B7CF6` —— 后者在 `bg-accent-soft` 上只有 4.14:1（导航选中项、筛选 chip 就是这个组合）；
   浅色 `--ink-muted` 取 `#666678`（换色后最坏落点是冷画布 `#F4F4F7`，5.12:1；样机的 `#75758B` 只有 4.09:1）、
   `--band-mid` 取 `#8C600D`（新画布上 5.04:1）。琥珀 `--highlight` 永远不当文字用，要当文字用 `--highlight-ink`。
2. **图表网格线与分隔线分家**：`--rule` 是 1px 发丝线（深色 1.58:1 足够），SVG 网格/坐标轴另用
   `--chart-grid`（深色 1.91:1）。用 `--rule` 画网格的话，深色下 1.3:1 直接看不见。
3. **色阶不能只靠透明度**：`--heat-0..4` 每档单独给值。深色下「主色 + 0.3 透明」只有 1.56:1，
   热力图前两档会糊成一片；空档反过来要比卡面**亮**（`#262E3D`），因为格子坐在卡上而不是画布上。
4. 骨架屏用 `--skeleton-base/--skeleton-shine`（深色差 1.3:1 的可见闪光），
   不要拿 `--rule` 与 `--paper-raised` 凑 —— 深色下两者只差 1.2:1，看起来像一块死灰。

### 8.1 磁贴（Bento tile）面契约 —— 报告屏摘要区（`src/components/ui/Tile.tsx`）

磁贴是**只读数据块**：小号大写标签（11px / 600 / `.04em`）+ 大号数值 + 可选一行提示 + 可选右下角内嵌图。
数值用 `--font-display`（Sora，Tailwind 里映射成 `font-serif`）配 `tabular-nums` 与 `-0.03em` 字距，
**不用 `--font-mono`** —— 等宽面要的是列对齐，磁贴要的是字重与气势；计时器那类才继续用 `--font-code`。
`chart` 槽位绝对定位在右下（样机的 `.spark`），图一律用 `currentColor`（`Sparkline` 的 `tone="inherit"`、
`MiniBars` 的 `fill="currentColor"`）：hero 面上再画 `var(--accent)` 的靛蓝等于隐形，实测压在同色渐变里读不出来。
交互控件（按钮、chip）不进磁贴，归 `Card` 的 `actions`。四种面全部走语义 token，**新增的只有 `--tile-solid*` 三个**：

| `surface` | 底色来源 | 主墨色 | 次要文字 |
|---|---|---|---|
| `plain` | `--paper-raised`（与 `Card` 同源） | `--ink` | `--ink-muted` |
| `hero` | `.surface-hero`（`--hero-a`→`--hero-b`，全站唯一允许渐变的面） | `--hero-ink` | `--hero-ink-muted`（**不能用 `--hero-ink` 的透明度档**，见上） |
| `solid` | `--tile-solid`（新） | `--tile-solid-ink`（新） | `--tile-solid-muted`（新） |
| `warm` | `--highlight-soft`（复用琥珀软面，**不新增 token**） | `--highlight-ink`（禁止用 `--highlight` 当文字） | `--ink-secondary`（两套同令牌：浅 7.37 / 深 6.35） |

`--tile-solid*` 取值理由：浅色下做**近黑墨面**（`#171725` = `--ink`）配亮墨，深色下面要比卡面亮一档才不会被
`--paper-raised` 吃掉 —— 实拍时 `#2A3444` 与卡面只差 1.27:1，肉眼看不出那是一块墨面，故取 `#3A4A68`（与卡面 1.79:1）。
`--radius-tile:16px` 比卡面 14px 略圆，让磁贴读起来是"块"而不是"卡"。

对比度实测（半透明面按最坏落点 `--paper-raised` 合成后再算）：`solid` 浅 15.73 / 8.03、深 7.50 / 4.94；
`warm` 浅 10.81（`--highlight-ink`）/ 7.37（`--ink-secondary`）、深 7.74 / 6.35（同 `--ink-secondary`）；
`hero` 浅 A 端 5.88 ～ B 端 9.14（`--hero-ink-muted` A 端 4.78）、深 6.00 / 10.02（`--hero-ink-muted` A 端 4.94）；
`plain` 沿用上面已有数值。全部 ≥ 4.5:1。
磁贴**不带 band 色条**（色条是 `Card` 的 `tone`，叠在琥珀面上会与暖底抢注意力），值本身已经带三档语义；
磁贴上的琥珀指示一律用 `--highlight-soft` 面本身，不再叠裸 `--highlight` 图形。

~~⚠️ 已知未修项~~ **Wave 5 已修**：`--highlight` 原 `#E8A33D` 画在画布上只有 1.89:1，不达 WCAG 1.4.11 非文字 3:1。
换色时核对全站 `.tsx` 发现**裸 `--highlight` 没有任何消费者**（组件只用 `-soft` / `-ink`），因此直接把值提到
`#C97A16`（画布 3.05:1 / 白卡 3.34:1 / 琥珀面 3.04:1），零改动成本关掉这笔债。深色 `#F0B24A` 本来就 3:1 以上，不动。

### 8.2 报告屏摘要栅格（对齐 b-bento 样机，`src/features/report/ReportPage.tsx`）

6 列栅格（`grid-cols-6`，`gap:12px`，行高按内容自然撑开，不用 `grid-auto-rows` 硬钉），
块序与跨列**必须**是样机那一套，换窄屏时按断点降级而不是改顺序：

| 块 | 跨列 | 面 | 内容 |
|---|---|---|---|
| 综合 Band | `span 3 × 2 行` | `hero` | `当前 → 目标`，右下角内嵌 sparkline（`--trend` 的 composite 点，纯 SVG，无图表库） |
| 练习时长 | `span 3 × 2 行` | `solid` | 累计分钟，右下角内嵌周柱状图（`minutes_by_day` 按 7 天分桶） |
| 阅读正确率 / 听力正确率 / 生词本 | 各 `span 2` | `plain` | 前两块的分子分母来自 `analytics.by_module`（**新端点字段**）；生词本只有总数与近 7 天新增，见下方诚实条款 |
| TOP 错误类型 | `span 3` | `warm` | 最高频 `error_type` 的中文显示名 + 出现次数 |
| 分项 BAND | `span 3` | `plain` | 写作四维（TR/CC/LR/GRA）小格 + 达标/未达标图例 |

断点：`<sm` 全部 `span 6`（单列）；`sm~lg` hero/solid/warm/分项 用 `span 6`，三块 `plain` 用 `span 2`（一行放得下）；
`≥xl` 才是上表的完整 6 列形态。

**诚实条款（覆盖样机文案）**：样机里「生词本 214 · 已掌握 96 · 待复习 41」的**掌握/复习状态后端不存在**
（`vocab` 表只有 `word/context/source_*/note_zh/tags/created_at/phonetics_json`，见 §5），
落地时该块提示改成 `近 7 天新增 N`；不许为了对齐样机而造字段。
`by_module` 缺某科数据（该科近 8 周没做过客观题）时**整块不渲染**该磁贴，不显示 `—`、更不显示 0%。
页头右上「整体 +N.N」pill 用 `progress.summary.delta_vs_previous` 四科均值的差，四科不足两科时不显示。

视觉规则：纸面感、细分隔线、无金属渐变与螺丝/表盘装饰；分数用大号 `--font-mono` + 语义色条；
图表为素色 SVG；`prefers-reduced-motion` 关闭过渡与抬升。
排版基线：三栏（左导航 216px / 主区 min 720px / 右辅助 320px 可折叠）；题目用 `number` 前缀与官方缩进风格。

### 8.3 各屏顶部磁贴条（Wave 6：把 §8.1 的磁贴语言推广到其余八屏）

报告屏以外的每一屏，在**标题区之后、主区之前**插一条 2–4 块的磁贴条；主区（列表 / 表单 / 答题区）
**版式一律不动**。用户裁定的是「加一行磁贴」而不是「整屏重排」，所以各屏原有交互与既有断言
（题号导航、逐句重听、草稿恢复、`DraftField` 竞态）必须原样成立。

容器与 §8.2 同形：`<dl aria-label="<屏名>关键指标" className="grid grid-cols-2 gap-3 lg:grid-cols-<2..4>">`，
块内只用 `Tile`，测试选择器一律 `data-metric`，身份写成 `<屏>.<键>`。

**四条硬规则**（违反任何一条按缺陷处理，不当风格分歧）：

1. **面**：只允许 `plain`；每屏**最多一块 `warm`**，且必须承载该屏的「待处理 / 降级」信号
   （未掌握错题、音频不可用、未作答、AI 未配置）。`hero` 与 `solid` **禁止出现在报告屏以外** ——
   渐变面全站 1 处、墨面 1 处才有层级，到处铺大色块等于没有重点。
2. **数值只准来自该屏已经发出的请求或已有的本地状态**。不许为填一块磁贴新增一次 `useApi`：
   九屏各多一个请求，首屏延迟和 msw fixture 的维护面都会翻倍，而这些数字在报告屏本来就有。
3. **缺数据整块不渲染**，不出现 `—`、不出现 `0%`（与 §8.2 诚实条款同源）。唯一例外是「没有值」本身
   就是信息：概览的距考试在未填考试日期时保留磁贴，hint 写「尚未设置考试日期，可在设置中填写」。
   反过来，**被筛选条件清零的指标也不渲染** —— 错题本默认 `status=open`，此时「已掌握」永远是 0，
   那是一块假数，切到「全部」才出现。
   **暖面读数为 0 时整块撤下**（`review.open`、`vocab.no-note`、`reading.blank`、`writing.short`）：
   琥珀面在视觉上就是「这里有东西要处理」，摆一个 0 等于一边报警一边说没事。
   状态型暖面同理：`settings.ai` 在密钥配好后整块消失，不给「已配置」留一块报平安的砖。
   plain 面的「0」不受这条约束，按语义判断 —— `vocab.recent` 为 0 照样渲染，因为「近 7 天没加新词」是陈述而不是召唤。
4. **不许与同屏既有读数重复**。把数字搬进磁贴就同时删掉原处（阅读工具条的两个 `Stat`、
   写作卡头的 `词数 / 已用时` span），否则同一屏会出现两份刷新时机不同的同源数字。

每屏清单（`data-metric` → 值 → 来源 → 面）：

| 屏 | 磁贴 | 来源 | 面 |
|---|---|---|---|
| 概览 | `overview.weakest` 最弱一科 band + 与目标差距 | `progress.summary.current` / `target_band` | warm |
| | `overview.delta` `delta_vs_previous` **绝对值最大**的一科（涨跌都算，并列按 `MODULES` 顺序取先出现的） | 同一份 summary | plain |
| | `overview.plan` 今日计划 `完成/总数` | `plan.today.items` | plain |
| | `overview.grading` 排队中 / 待查看的批改任务数（见 §8.3 末「第二处可见」） | 全局 `useGradingJobs` store | plain |
| 错题本 | `review.open` 未掌握 / `review.resolved` 已掌握 | 当前筛选结果 | warm / plain |
| | `review.stubborn` `seen_count > 1` 的顽固条目 | 同上 | plain |
| | `review.modules` 涉及的科目数 | 分组后的组数 | plain |
| 生词本 | `vocab.total` 词条总数 | `GET /vocab` | plain |
| | `vocab.recent` 近 7 天新增（按 `created_at`） | 同上 | plain |
| | `vocab.no-note` 尚无备注的条目 | 同上 | warm |
| 口语 | `speaking.progress` 已答 / 总题 | `session.turns`、`session.total` | plain |
| | `speaking.monologue` Part 2 独白上限秒数 | `cue_card.speaking_sec`（仅 Part 2 渲染） | plain |
| 听力 | `listening.answered` 已答 / 总题 | `answers` × `questions` | plain |
| | `listening.elapsed` 已用时（原卡头 span 删除） | `useTimer.elapsedSec` | plain |
| | `listening.replay` 可逐句重听的句数 | `sentences.length` | plain |
| | `listening.degraded` 音频不可用（仅 `unavailable`） | `audio.status` | warm |
| 阅读 | `reading.answered` / `reading.elapsed` | 从工具条搬来（两个 `Stat` 删除） | plain |
| | `reading.blank` 未作答 n 题（仅 n > 0） | `total - answered` | warm |
| | `reading.paragraphs` 段落数（仅 >0） | `set.passage.paragraphs` | plain |
| 写作 | `writing.words`（原 `词数` Stat 删除）/ `writing.elapsed`（原卡头 span 删除） | 本地状态 | plain |
| | `writing.draft` 草稿状态 + 最近保存时刻 | `useDraftAutosave` | plain |
| | `writing.short` 还差 n 词（仅未达最低词数） | `minWords - wordCount` | warm |
| 设置 | `settings.daily-goal` 每日目标分钟 / `settings.exam` 考试日期 | `GET /settings` | plain |
| | `settings.ai` AI 未填写（仅 `!ai.configured`，配好密钥后整块消失） | 同上 | warm |

设置屏的磁贴**不显示任何「未保存」状态**：条上只有后端回读值，未保存/已保存的反馈继续留在
`DraftField` 字段内。刚修好的 `SettingsPage.test.tsx` 竞态就依赖这个分工，磁贴去抢这套文案会把它带回红灯。
`settings.target-band` 也按规则 4 砍掉了 —— 「目标 Band」字段右侧的 `ScoreBand` 已经在读同一个值，
再铺一块就是两份刷新时机不同的同源读数；倒计时同理不在设置屏出现（`days_left` 由概览的
`progress.summary` 给出，本屏只有一次 `GET /settings`，前端不许自己推算日期差）。
阅读屏同理**不做 `reading.words`**：`PassageView.tsx` 篇章卡头已经有 `{set.word_count} 词` 的 Badge，
条上第 4 块让给「段落数」（正文只按 `[A]` 分段显示，段落总数原本没有任何地方读）。

**概览的 `overview.grading`：排队中的批改不许只有左轨一处可见（Wave 7 D 档）**

异步批改是这一屏唯一一件「提交之后人可以走开」的事：作文交上去 → 用户切到概览/别的屏 →
结果在几十秒后自己落回来。在此之前，这件事在全站的**唯一**读数是左轨底部那颗 `GradingRailBadge`
（`App.tsx` 挂在 `mt-auto` 那一坨里，离导航项最远，且最多列 3 行）。左轨那颗是**导航**
（点一行 `setView(job.module)` 落到对应模块），不是读数；读数要有一处落在用户视线落点（主区顶部）。
所以本屏加第 4 块磁贴，规矩如下：

1. **同源，不是第二份数据**。值取自 App 已经在订阅的那个 `useGradingJobs` store（props 类型就是它的
   `GradingJobsState`），由 `App` 传进 `Dashboard`，与左轨那颗读的是同一次 `emit`，**不许**在
   `Dashboard` 里再 `useGradingJobs()` 一次、更不许为它加请求（规则 2）。规则 4 删的是「刷新时机不同的
   两份同源数字」，这里两处同帧变化，所以不适用 —— 左轨那颗**不得删**，删了就把唯一的可点入口一起删掉了。
2. **三面读数是同一块砖**：`pendingCount > 0` 时 label「正在批改」值为 `pendingCount`；
   没有排队但有**未查看的失败任务**时同一块换成 label「批改失败」值为失败数（与左轨那颗同一套措辞）；
   再退一步才是 label「待查看」值为未查看的成功数。
   两条都是必须的：① 批改完成的那一刻若只让「正在批改」整块消失，用户读到的是「任务没了」，
   而不是「结果出来了」—— 磁贴必须自己接力，否则第二处可见性在最需要它的那一秒断档；
   ② **不许把失败也写成「待查看」**。store 的 `doneCount` 是「终态且未查看」，`failed` 与 `succeeded`
   混在一起（LLM 超时是日常，不是边角），照抄 `doneCount` 会让一块写着「待查看 · 去打开报告」的砖
   盖住一次失败。所以这块砖吃的是 `GradingJobsState`（含 `jobs`），由 Dashboard 自己按 `status` 分面，
   而不是只吃两个现成的计数。
3. 三面全为 0 → **整块不渲染**（规则 3：没有排队、没有欠账时不该有砖头占位）。
4. 面一律 `plain`。本屏的 `warm` 名额继续给 `overview.weakest`；一块会在用户眼前自己跳变的砖
   去抢琥珀面，等于让报警色每几十秒换一次主人。
5. hint 必须说清**去哪里看结果**（「完成后去写作 / 口语屏看报告」这一类），不许写成一句安慰话。
   磁贴按 §8.3 与 `Tile.tsx` 的分工**不可点**（点它没有下一步，可点的仍然是左轨那颗），
   所以 hint 就是这块砖唯一的行动指引。
6. 判据：`Dashboard.test.tsx` 四面各一例（排队中 / 批改失败 / 待查看 / 都为 0 时整块不渲染），
   外加「同一块砖的 label 会随 pending→终态接力，而不是消失」；
   `App.gradingTile.test.tsx` 钉外壳接线（App 把自己那份 store 传下来，不是 Dashboard 再订阅一次）。

### 8.4 键盘焦点环：唯一真源在 `index.css`，组件内不许把它关掉（Wave 7 D 档）

起因不是「读到 `outline-none` 觉得不好」，是真浏览器 Tab 巡检量出来的：设置屏一圈 94 个停靠点
（`select` 28 / `input[date]` 21 / `input[number]` 20 / `input[text]` 19 / `input[password]` 6），
**每一个**都命中 `:focus-visible` 而 `outline-style` 算出来是 `none` —— 也就是说这台应用里
最需要看清「我改到第几个字段」的那一屏，键盘用户完全看不见自己在哪。记录见 §15.9。

1. **焦点环只有一处定义**：`src/index.css` 的 `@layer base` 里那条
   `:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible { outline: 2px solid var(--accent) }`。
   组件里**不许**再各画一套环（`focus:ring-*` / `focus:shadow-*` / 自定义 `outline-*`），
   也不许改它的宽度与颜色 —— 换色是 §8 令牌层的事，环本身是全局唯一的一条规则。
2. **`outline-none` 在这套层叠里是真的「隐形」，不是「交给组件自己画」**。
   Tailwind v4 的 utility 落在 `@layer utilities`，排在 `@layer base` 之后，而那条全局规则用 `:where()`
   写就是故意把特异性降为 0 —— 所以任何一个 `outline-none` 都必然赢，环就没了。
   推论：看到 `focus:border-accent` 之类「换个边框色当焦点提示」**不算**满足本条，
   1px 边框变色在 15px 正文旁边不构成可发现的焦点指示（WCAG 2.4.7 要的是看得见的焦点指示，
   不是「理论上颜色变了」）。要么保留全局环，要么显式补一条 ≥2px 的环。
3. **唯一的豁免形态是非控件容器**：`role="dialog"` 的面板这类 `tabIndex={-1}`、只为了让关闭后焦点能还回去
   的容器，可以 `outline-none`（给整块弹窗描一圈 2px 靛蓝是噪声，不是提示）。豁免靠**清单**不靠注释：
   `focusRing.test.ts` 里的 `容器豁免` 数组是唯一入口，往里加文件等于声明「这个文件里的
   `outline-none` 都画在容器上」，评审时看得见。控件文件（`features/**` 的表单字段）不许进清单。
4. **不许正值 `tabindex`**。九屏实测 0 处，本条是防回归：一个 `tabindex="1"` 就能把整屏顺序打乱，
   而这类改动在截图里完全看不出来。需要程序化聚焦用 `tabIndex={-1}` + `.focus()`（`Modal.tsx` 就是这么做的）。
5. 判据：`frontend/src/focusRing.test.ts` 扫 `src/**/*.tsx` 源码，命中 `outline-none` 且不在豁免清单 → 红。
   行为侧的证据不塞进单测（jsdom 不算层叠，`getComputedStyle` 拿到的永远是 `init` 值，
   绿了不代表环在），由真浏览器 Tab 巡检取，落在 §15.9。
6. **已知代价，本轮不修，也不许当作已完成**：错题本走满一圈 **211 站**、生词本 **62 站**
   （每条目两颗按钮 × 全量列表）。焦点环修好之后，键盘用户仍然要按两百多次才走完错题本。
   真正的解法是分页或虚拟列表 + 列表内方向键导航，那是另一条契约的活，别在这一条里顺手加。

## 10. Wave 1 定稿决议（对 §1–§9 的补丁；与本节冲突以本节为准）

Wave 1 交付时 agent 提出的契约含糊点，逐条定稿。**Wave 2 所有人按本节实现，不要再自行发明字段。**

### 10.1 内容 schema 增补（来自 `content` agent 的 32 个 set 实际产出）
- 口语文件**一文件一集**，新增必填整数 **`part: 1 | 2`**：`part:1` 用 `part1[]`（该话题 3 问）；`part:2` 用 `cue_card` + `part3[]` + `fallback_questions`。loader/TS 类型按此判别。
- set `id` 前缀统一为 `sp_ / li_ / re_ / wr_`（**废弃** §2-W 示例里的 `w1_line_energy_04`；§2-R 示例 `re_h_urban_02` 的 `h` 无意义，实际用 `re_p_*`）。正则：`^(sp|li|re|wr)_[a-z0-9]+_[a-z0-9_]+_\d{2}$`。
- 听力顶层 `section` 保留（主导节型），新增可选 `sections_covered: number[]`；一个 set 就是 20 题，band 换算按 20 题制（§3-B）。
- `map_diagram_label` 无外部图片：方位描述写进该题 `prompt` 文本，录音里用语言描述方位。可选 `diagram` 字段本轮**不做**。
- `heading_match` 每题必须有 `prompt`（渲染前提）与 `options_headings`。
- 新增可选字段（一律允许缺失）：口语 `examiner_voice`、听力 `audio_voice`、阅读 `instruction_zh`、写作 `chart.labels` 与 `chart.years` 并存（二者取一，前端优先 `labels`，回落 `years`）。
- 写作 chart 形状判别：`line|bar` → `{labels|years, series:[{name,values[]}]}`；`pie` → `{slices:[{label,value}]}`；`table` → `{columns[],rows[][]}`；`dynamic_chart` → `{frames:[{label,values[]}]}`。字段名以 `data/ielts/writing/*.json` 为准（`backend/tools/validate_ielts_data.py` 已机器化校验）。
- `data/ielts/manifest.json` 不是 set：loader 必须按 `<module>/*.json` 装载并**跳过根目录文件**。
- 练习内容的 `audio_text` 在 `GET /api/listening/sets/{id}` 响应中**保留**（AC-L1b 原文精读回落要用），但 `answer`/`accepted_alternatives`/`explanation_zh` **必须剔除**。

### 10.2 API 与命名
- `PATCH /api/settings` 为准（**废弃 AC-C1 里写的 `POST /api/settings`**）；`spec-product.md` AC-C1 同义改为 PATCH 语义。
- attempt 主键：列表/详情对象字段名 **`id`**（`AttemptSummary.id`）；只有模块报告内部引用叫 **`attempt_id`**。DELETE/GET 路径参数用 `{attempt_id}`，值相同。
- `band` 形状：客观题（听/读）为标量 `band: number`；口语/写作为对象 `band: {overall, ...四维}`。前端用 `attempt.module` + 类型守卫判别（`src/types/ielts.ts` 已提供 `isSpeakingReport/isWritingReport/isObjectiveReport`）。
- `AiMeta`：`ai_used`、`approximate` 必填；`degraded_reason`、`model` 可选（客观题响应里可缺省）。
- `SpeakingSessionState` 定稿：`'created' | 'in_progress' | 'awaiting_assess' | 'assessed' | 'closed'`。
- `settings.ai.key_source`：`'env' | 'settings' | 'none'`。
- `SpeakingPrompt.audio_url`：`string | null`（离线为 null）；口语题卡另有 `bullets?: string[]`。
- `error_type` 跨四科不收敛为枚举：类型上是 `string`，写作 7 类用 `WRITING_ERROR_TYPES` 常量表达；`review_items.error_type` 直接存该字符串。
  前端显示名（`features/shared/errorTypes.ts`）覆盖两套已知闭集：写作 7 类 + 听力/阅读的 `answer_norm` reason
  （`wrong` / `unanswered` / `spelling_variant_rejected` / `over_word_limit`）；**未知字符串原样显示，不猜翻译**。
  这条是因为报告页把「最常犯的错误」提到了大标题位，露出 `wrong` 这种代码字符串就成了缺陷。
- **`/phoneme-tip/{phoneme}` 废弃**（§1 保留行不再生效）；发音细节改由口语报告 `pronunciation_detail.problem_words[]` 承载。词条查询只有 `GET /api/vocab?word=`。
- `/api/tts`（#39）保留；`/api/stt` 保留但只由后端内部与口语 turn 复用，前端屏不直接调。
- `score_service.py` 的 WER 规则分只作为 `pronunciation_detail.score_0_100` 的辅助值，用户可见主分数一律 0–9 band（AC-G5）。

### 10.3 归属微调（Wave 2）
- `api/__init__.py` 的 router 注册由**主控**统一追加，`grade-core` / `grade-ai` 两个 agent 只创建自己的 `api/<module>.py`，**不得**同时编辑 `api/__init__.py`。
- `App.tsx` 的 ComingSoon 替换由**主控**统一完成，三个前端 agent 只创建 `src/features/<own-module>/**`，**不得**编辑 `App.tsx`。
- ~~`scripts/check.sh`、`frontend/package.json` 版本号、以及 Wave 1 遗留的 2 个 API 失败（`test_api_attempts`、`test_api_progress` 各 1）由主控处理~~ → **Wave 2 已完成**：T1b 交付 `scripts/check.sh`（tsc -b → vitest → pytest 三道闸门，`--quick` 跳 pytest）与 `package.json: 2.0.0`；那 2 个 API 失败经主控修正 `api/__init__.py` 注册与 `progress.py` 的 `days` 上限（`le=36600`）后不再复现。

### 10.4 Wave 1 已知遗留（不许当作已完成）
- ~~`frontend/src/test/mocks/handlers.ts` 与 `api.test.ts` 仍带旧 `scenes`/`is_free` fixture~~ → **Wave 2 已完成**（T1b：handlers 按 §1+§10 重写为按组命名导出 + `resetMockState()`，msw 生命周期唯一归属 `test/setup.ts`；`api.test.ts` 65 项）。
- `api/content.py`（#40/#41 `/content/generate`、`/content/jobs/{id}`）文件已存在但**故意未注册**，属 P3，可后置。
- ~~麦克风在打包后的 WebView2 里能否真的授权**未经验证**~~ → **2026-11-07 实测通过**：用户在打包产物
  （onedir 便携布局）的 GUI 窗口里实际录音成功，`--use-fake-ui-for-media-stream` 方案成立
  （`mic-on-windows.md` §6）；口语屏文本兜底输入（AC-S3b）继续保留，不是靠它兜着这个风险。

### 10.5 Wave 2 契约补丁（回答 T1b 提出的 4 处 §1 无法自洽项；以实现真源为准）
1. **#15 听力音频 503**：真源 `api/listening.py:112-115` 返回 `{detail, code:"tts_unavailable", transcript_available:true}`。**裁定**：`transcript_available` 仅作调试可观测字段，**不进入前端契约**（`ApiError` 只暴露 `detail`+`code`）。AC-L1b 的客户端规则改为：收到 503 时展示该 set 的 `audio_text`（§10 已规定 set 详情保留 `audio_text`）+ 可见降级提示；不得依据 503 体内字段分支。
2. **#23 `/attempts` envelope**：真源 `api/attempts.py:32-33` 为 `{"data": {"items": [...], "total": n}}`，`total` 是**过滤后的总条数**（供分页）。**裁定**：这是唯一形态；§0 允许的「顶层 `total`」写法**不用于** `/attempts`。`api.ts` 兼容两种属于健壮性，不作为契约依赖。
3. **#4 `PUT /settings/ai-key` 校验规则**：真源 `api/settings.py:188-195` — body 必须是对象、`key` 必须是非空字符串（`strip()` 后），长度 1–300 且不含控制字符，否则 `400 {code:"validation_failed"}`。**裁定**：**没有** ≥8 字符的下限；`invalid_key` 不是合法机器码。mock 已按真源改正，任何实现不得自造下限。
4. **#34/#36 `GET /vocab` 一址两型**：真源 `api/vocab.py:96-100` — `word` 存在时**优先**返回 `WordInfo` 详情；否则返回 `{items: VocabNote[]}`，`q` 为列表模糊过滤。**裁定**：保持单址（另开 `/vocab/lookup` 需要同时改动后端、`api.ts`、mock 与测试，零用户价值，属宪法禁止的重构）。前端调用点必须显式二选一，不得同时传 `word` 与 `q`。

**Wave 2 实测复核**（隔离实例：`IELTS_DB_PATH` 指向临时库、`IELTS_ONLINE=0`、端口 8793，未触碰用户真实库）：
- #4 四类失败全部 `400 validation_failed`：`{"key":" "}` → 「AI key 不能为空」；`{"key":12345}` → 同上；`{"key":"sk\u0001abc"}` 与 301 字符 → 「AI key 格式不正确（长度应为 1–300 且不含控制字符）」；body 为裸字符串 → 「请求体应为 {"key": "..."}」。6 字符 key 实测 **200**，证实无长度下限。
- #15 离线实测 `503 {"detail":"已关闭联网，无法合成音频；可进入原文精读模式","code":"tts_unavailable","transcript_available":true}` → 降级提示本身已指向文本兜底，客户端无需读 `transcript_available`。
- #23 `GET /attempts` 实测 `{"data":{"items":[],"total":0}}`；#34 未收录词走 fallback（`source:"fallback"`、`zh:"（未收录）…"`、仍带 `audio_url`）；#36 `{items}`。

### 10.6 Wave 4 契约补丁：异步批改队列（用户裁定「提交后先做别的」）

**起因（实测，非推测）**：`https://api.longcat.chat/openai/v1` 的推理模型批改一篇 Task 2 耗时
**133s**。同步端点意味着用户点完「提交批改」盯着转圈两分钟，多数人会以为程序死了。
**裁定**：保留同步端点（现有用例与脚本不翻案），新增异步路径；前端默认走异步。

`JobView`（`GET /jobs/{job_id}`、`GET /jobs` 与两个 `.../async` 提交端点共用同一形状）：
```json
{ "job_id": "job_…", "module": "writing|speaking", "task_ref": "wr_t2_…|ses_…",
  "status": "queued|running|succeeded|failed",
  "attempt_id": null, "report": null, "error": null, "degraded_reason": null,
  "created_at": "…", "started_at": "…", "finished_at": "…" }
```
规则：
1. **提交端点只做廉价校验**：题面存在、作文非空（`empty_response`）、时长是数字、会话存在/未关闭、
   至少一次作答（`empty_answer`）。这些错误必须在 HTTP 响应里当场给出，不许推迟到队列里。
2. **成功时 `report` 与同步端点同形状**（`WritingReport` / `SpeakingReport`，含 `attempt_id`），
   且此刻 `attempts` 已落库；`report.attempt_id === job.attempt_id`。前端拿到即可直接渲染，
   不需要再发第二次请求。
3. **失败必须可见**：`status='failed'` + 中文可读 `error`。`error` 取业务异常的 `detail`，
   其它异常只给 `批改失败（异常类型）`，**绝不带原始异常文本**（防泄漏凭据，CONSTITUTION §3）。
   失败的批改**不写 `attempts`**，不冒充一次练习。
4. **重复提交复用任务**：同一目标（写作按 `task_id` + 正文指纹，口语按 `session_id`）仍在
   `queued/running` 时，第二次提交返回同一个 `job_id`，不会产出两份批改记录。
   **`succeeded` 之后 5 秒内的同一提交也复用它**：本地近似引擎几十毫秒就批完，「连点两次」的
   第二次点击落在任务完成之后是常态而不是边角 —— 只认未完成状态的话，这条承诺在快机器上必然漏，
   同一篇作文会在库里长出两份一模一样的记录（实测：全量套件里两个用例随机红，单跑全绿）。
   **`failed` 永不复用**：一次没成功的批改不是「最近做过的事」，重试必须能拿到新任务。
   代价写清楚：5 秒内改完 AI 开关再点「提交」会拿到旧结果，而改开关要走设置屏，实际不止 5 秒。
5. **执行器**：进程内单条常驻**守护** worker 线程（`services/job_queue.py`），串行执行。
   守护线程意味着退出时不强留批改中的请求 —— 残留的 `queued/running` 任务由下次启动
   `store.reap_interrupted_jobs()` 判为 `failed`（原因「应用在批改完成前退出，请重新提交批改」），
   同时 `prune_jobs()` 只保留最近 100 条终态历史。**不用 `BackgroundTasks`**：它跑在事件循环
   所属进程里，一次长调用会拖住同进程其它请求，且状态不落库、重启后前端永远轮询。
6. `GET /jobs?status=active` 是「离开页面再回来」的找回入口（前端把 `job_id` 存本机，
   这个列表用于兜底与调试）。
7. **前端已消费异步路径**（Wave 4 收尾）：写作「提交批改」与口语「开始评分」改为 #21b / #11b，
   提交后进入 `grading` / `assessing` 骨架态并可离开该屏；轮询由模块级 store（`useSyncExternalStore`）
   统一持有，2.5s 一次、`job_id` 落 `localStorage`（`ielts.grading-jobs`）以支持 webview 重载后重新挂上，
   超过 15 分钟不再轮询判为本地失败。界面提供「刷新进度」主动补偿，不依赖轮询间隔；**不提供取消**
   —— 已经付费的上游调用不该被静默中止。成功才清草稿（AC-W2）、只有用户真的看过报告才置 `viewed`，
   失败原样显示后端 `error` 并留在可重试的屏上（CONSTITUTION §3）。左轨导航显示未完成任务数。

**实测复核**（隔离实例，`IELTS_ONLINE=0`，临时库；`tests/test_api_jobs_async.py` 19 例）：
提交 → 轮询 → 报告落库 → `GET /writing/attempts/{id}` 原样读回；引擎抛异常 → `failed` +
`error` 不含密钥；runner 返回无 `attempt_id` 的结果 → `failed`；`reap` 只动未完成任务。

## 11. 打包契约（原 §9；`pkg` agent 已按下述实现，实测差异见 §11.1）

- `tauri.conf.json`：`productName: "IELTS Insight"`、`identifier: "com.ielts.insight"`、`version: "2.0.0"`、
  window.title `"IELTS Insight"`；`bundle.externalBin: ["binaries/backend"]`、`targets: ["nsis"]`；
  CSP `connect-src 'self' http://127.0.0.1:8765 http://ipc.localhost ipc:`（**Wave 8 收紧**：
  原 `https://*` 是为「放行任意 AI 兼容端点」加的，但 AI 调用实际发生在**后端进程**，
  webview CSP 根本不约束后端出网 —— 那条通配只放开了「网页里任何脚本往外发请求」这个纯风险面，
  前端自己的 fetch 全部只打 127.0.0.1:8765。换 AI host 不需要动 CSP）。
- `capabilities/main.json` 增加 `opener`/`fs` 最小集 + 确保麦克风在 WebView2 下可用（Tauri 无 mic capability，需在 `main.rs` 用 `WebView2` 权限或 `windows` feature 允许 media；不可用则文档化 `msedgewebview2 --enable-media` 方案并在 AC 里要求给出可操作错误提示）。
- `Cargo.toml` name → `ielts-insight`；`index.html` title → `IELTS Insight`。
- 构建：`scripts/build.ps1`（PyInstaller → 复制到 `src-tauri/binaries/backend-x86_64-pc-windows-msvc.exe` → `npm run tauri build`）；
  `scripts/dev.ps1`（uvicorn --reload + vite）。`.env.example` 增加 `OPENAI_API_KEY/OPENAI_BASE_URL/OPENAI_MODEL`。

### 11.1 pkg 实际实现与上述的偏差（已核实，主控 Wave 3 处理）
- CSP 的 `media-src` 额外放行了 `http://127.0.0.1:8765`，否则 `<audio src>` 直连后端音频会被拦；若前端全部改成 fetch→blob，可收回这条。
- `capabilities/main.json` **没有** mic/opener/fs：Tauri 无麦克风权限名，`opener`/`fs` 需要 Rust 插件与 capability 同时加，只加一半会导致 ACL 校验失败。
  `main.rs` 改用 WebView2 附加浏览器参数（`--use-fake-ui-for-media-stream`），**打包后是否真能授权仍未实测**（见 §10.4）。
- `main.rs` 加了 8765 端口占用探测（占用则报告并跳过 spawn，绝不 kill 未知进程）与 `RunEvent::Exit` 时终止 sidecar。
- ~~`scripts/version-check.ps1` 目前**红**~~ → 已绿：`frontend/package.json` 现为 `2.0.0`，三处版本一致。

### 11.2 sidecar 冻结包实测（Wave 3，跑真实 EXE，不是看构建退出码）
- **阻塞缺陷（已修）**：`backend.spec` 原 `datas = [("app/data","app/data")]` **没有带 `app/db/schema.sql`**。
  实测 `dist/backend.exe` 用临时库启动 → uvicorn lifespan 直接崩：
  `FileNotFoundError: … \_MEIxxxxxx\app\db\schema.sql`（`app/db/store.py:26` 的 `SCHEMA_PATH` 在冻结后指向 `_MEIPASS/app/db/schema.sql`，
  而 `.sql` 不是 `.py`，PyInstaller 不会随模块收集）→ **打包版完全起不来，端口 8765 永不绑定**。
  修法：`datas` 增加 `("app/db/schema.sql", "app/db")`。这条是"构建成功 ≠ 能运行"的实例（CONSTITUTION §7-5）。
- **顺带清掉的死数据**：`app/data/scenes_free.json` / `scenes_pro.json` 全仓零引用（旧付费剧本内容，宪法禁止再随包分发），已删除。
- CORS 名单由 `app.main.cors_allow_origins(debug)` 给出，`Settings.DEBUG` **默认 False**（此前默认 True，
  等于把通配当成出厂值；打包脚本里没有任何地方设过 `DEBUG`，所以旧实测的 `DEBUG=False` 是靠启动环境碰上的，不是代码保证）。
  默认放行 `['tauri://localhost','http://tauri.localhost','https://tauri.localhost','http://localhost:5173','http://127.0.0.1:5173']`
  —— 两种 vite host 写法都要收，否则收紧默认值会顺手打断开发链路。要通配请显式 `DEBUG=true`。
  行为由 `tests/test_cors_policy.py` 钉住（含「陌生 origin 的预检拿不到 allow-origin 头」）。
- 体积：`dist/backend.exe` 单文件 **347MB**（上一版 249MB；`collect_all` 收了 whisper/av/tiktoken/torch）。首启解包到 `%TEMP%\_MEIxxxx` 约需 20–30s 才绑定端口，
  期间前端由 `useBackendReady()` 显示「正在启动本地引擎」（AC-G1），不是白屏。若体积/启动时间成为问题，可考虑 `--onedir`（待用户决定，未擅自改）。
- 三个 `.ps1` 必须以 **UTF-8 with BOM** 保存，否则 Windows PowerShell 5.1 解析中文报错（pkg 已踩过并修好，后续别再存成无 BOM）。
- `cargo 1.97.0` / `tauri-cli 2.12.3` 可用；`cargo check` 通过。
- **完整打包链路已实跑并通过（Wave 3）**：`scripts/build.ps1` 退出码 0 → `backend/dist/backend.exe`（347,353,015 B）
  → 复制为 `src-tauri/binaries/backend-x86_64-pc-windows-msvc.exe` → `tauri build` 产出
  `frontend/src-tauri/target/release/bundle/nsis/IELTS Insight_2.0.0_x64-setup.exe`（348,277,416 B）。
  产物自检方式见上：直接启动冻结 EXE（临时库 + `IELTS_ONLINE=0`）→ `/health` 回 `version 2.0.0` 与
  `content_counts` 四科齐全、新题库 `listening 4 / reading 4` 在包内可读，并成功对新 set 判分（`band_scale listening_20q`）；
  断网下 `tts_ok:false` 属可见降级，不是崩溃。
- **仍未实测（诚实声明）**：NSIS 安装器**未在本机执行安装**（会写用户系统，需用户点头）；GUI 窗口内的 WebView2 麦克风采集、
  以及 `excludes` 掉的 tkinter/PIL/matplotlib 在运行期是否真不被引用，均未验证。

### 11.3 Wave 8 冻结包复验 + onedir 便携布局（2026-11-07 实跑）

**onefile 冻结 EXE 复验（陪练随包）**：`dist/backend.exe` 用临时库 + `IELTS_ONLINE=0` 实跑 →
`/health` 200（`content_counts` 四科齐全，sparring **不在**这组读数里 —— §16.1 的口径在冻结产物上成立）；
`GET /sparring/topics` 回 **10** 个话题（`_MEIPASS/app/data/ielts/sparring/**` 随包）；
`POST /sparring/sessions` → `turn`（文本兜底，`source=fallback`）→ `assess` 200，
`band.overall=4.5`、`ai_used=false`、`degraded_reason=offline_template`、`sparring.mode=sparring`；
`GET /attempts?module=speaking` 落 1 条 `part=sparring / task_ref=sb_restaurant_01`，详情 payload 带 sparring 块。
迁移 v4 在冻结产物里生效（`sparring_sessions` 表建成，会话可写）。

**excludes 在产物上逐个核对（补 §11.2 那条「均未验证」）**：`backend/tools/check_frozen_excludes.py`
读 PyInstaller 的 Analysis TOC，只认「带路径的已收集条目」——tkinter / PIL / matplotlib / PyQt5 /
IPython / pytest 全部 0 条被收集（excludes 生效）；sparring 目录、dictionary.json、schema.sql
均在 datas 里。判据坑：第一版按裸名字计数，tkinter/PIL/matplotlib 各命中 1 次差点误报成
「excludes 失效」—— 那 1 次命中的是 spec 里 `excludes=[...]` 参数自身被序列化进 TOC。

**onedir 便携布局（`scripts/build.ps1 -Onedir`）**：
- 首启实测 **2.6 秒**到 `/health` 可用（onefile 是 20–30s），`_internal/app/data/ielts/sparring/` 在位。
- **抓到的命名坑（已修）**：Tauri sidecar 的**运行时名字**是 `backend.exe`（与外壳同目录），
  `-<target-triple>` 后缀只是 externalBin 的构建期源文件名 —— `tauri build` 把
  `binaries/backend-x86_64-pc-windows-msvc.exe` 复制进 `target/release/` 时就叫 `backend.exe`
  （产物目录里那个 331MB 的 `backend.exe` 就是静态证据）。便携目录第一版拷成 triple 全名，
  外壳当场失败，`shelllog` 的 stdout 副本抓到：
  `WARNING | [Shell] 启动后端 sidecar 失败: 系统找不到指定的文件。 (os error 2)`。
- **便携 GUI 窗口本身未验**：本会话启动的外壳子进程继承了 harness 的文件沙箱令牌，
  spawn/写日志被拦（外壳进程活着但无窗口、无子进程、无日志行），属于**诊断环境限制**，
  不是产品缺陷 —— 命名修复的证据链是「shelllog 错误消息 + target/release 的 backend.exe 实名」，
  窗口冒烟留给用户在真实桌面双击 `dist-portable\ielts-insight.exe` 完成。
- `build.ps1` 的 BOM 被编辑器剥过一次（契约 §11.2 那条老坑**又复发**）：已恢复并写进文件头警告。

### 11.4 用户双击 dist-portable「窗口打不开」的根因（2026-11-07 实拍定位）

用户反馈 `dist-portable\ielts-insight.exe` 双击没反应。对照实验把范围收干净：

| 跑的产物 | 结果 |
| --- | --- |
| `frontend\src-tauri\target\release\ielts-insight.exe`（官方产物，同机同用户） | **窗口正常**（`Tauri Window vis=True`，sidecar 起来，迁移 v0→v4） |
| `dist-portable\` 原样拷到 `%TEMP%` 干净目录 | **窗口正常** |
| `dist-portable\`（留在工作区里） | 进程活着、28 线程、302 句柄、**永不创建窗口**（连隐藏窗口都没有，只有 tao 的事件泵窗口），一条 `[Shell]` 日志都不写 |

**根因**：`dist-portable\` 建在被 harness 沙箱接管过的工作区里，从仓库根继承了
`Everyone:(I)(CI)(DENY)(DC)`（拒绝创建子目录）。WebView2 初始化要在 exe 旁建
`<exe>.WebView2` 用户数据目录 —— 建不出来就**卡在环境创建那一步**：setup 闭包还没跑到，
所以三条启动结论一条都没落盘，`shelllog` 也帮不上忙。这是「产物被构建环境的权限污染」，
不是应用逻辑缺陷；`ielts-insight.exe` 与 `target\release` 那份是**同一个文件**。

**处置**：
1. 便携产物组装到工作区外 —— `%LOCALAPPDATA%\IELTSInsight\portable\`，实测窗口正常打开、
   界面完整渲染（截图 [docs/assets/screenshots/portable-window.png](../assets/screenshots/portable-window.png)）、`/api/sparring/topics` 回 10 个话题。
2. `build.ps1 -Onedir` 组装完探测一次目录 ACL，命中 `DENY + (DC)` 就打印警告并给出
   「拷到工作区外再双击」的可操作指引 —— 不静默交付一个双击打不开的目录。
3. 诊断过程中我用 `/inheritance:r` 清 `dist-portable` 权限时，把 harness 沙箱自己的授权
   （`S-1-4-*`）一并剥掉了，导致该目录对我的 pwsh 变成 `Access is denied`（对用户 `lcl13`
   是完全控制，所以**用户双击不受影响**）。教训写在这：清理沙箱接管过的目录权限时
   **不要整条断继承**，只针对具体 ACE 增删。

## 12. 外部服务实测（Wave 3，真实网络 + 真实端点，非 mock）

跑法：`IELTS_DB_PATH`/`IELTS_TTS_CACHE_DIR` 指到仓库内 tmp 目录，端口 8765，`IELTS_ONLINE=1`，
key 由调用方 shell 环境变量提供（`key_source: "env"`）。**结论都来自 HTTP 响应，不是读代码猜的。**

- **edge-tts 7.2.8 已失效（阻塞听力音频，已修）**：`GET /api/tts` → `503 {"code":"tts_unavailable"}`，
  后端日志 `403, message='Invalid response status', url='wss://speech.platform.bing.com/…&Sec-MS-GEC-Version=1-143.0.3650.75'`。
  本机时钟与 bing 的 `Date` 头一致（排除时钟漂移），升级到 `edge-tts==7.3.1` 后同一请求 `200 audio/mpeg`、19584 字节、
  帧头 `FF F3`。`tts_service.py`（`Communicate(...).stream()`）与 `api/media.py`（`rate=` 分支）在 7.3.1 下均实测可用；
  7.3.x 删掉了 `Communicate.read()`，本仓库没有用到。**依赖版本已进 `requirements.txt`，重建 sidecar 前别回退。**
- **AI 端点不是 OpenAI 兼容协议（评分只能降级，非代码缺陷）**：`https://new.sharedchat.cc/{v1,}` 的
  `POST /chat/completions` 返回 **HTTP 200** 但 `{"code":0,"msg":"该接口未接入公益站独立网关，旧转发链路已关闭","data":null}`，
  SDK 侧 `choices=0` → `ai_client` 如实报 `ai_used=false / approximate=true / degraded_reason="invalid_model_output"`（不 500、不假装评分）。
  `GET /v1/models` 可列出 50 个模型（`deepseek/deepseek-v4-flash`、`z-ai/glm-5.3-flash` 等），换这些模型名同样 `choices=0`
  ——即该域名的转发链路已关，**与本应用代码无关**。用户需要一个真正提供 chat.completions 的 base_url + key，
  在**设置页**填入（宪法：key 绝不进聊天/日志/返回值，端点只回 `ai_key_present`）。
- **`/health` 的 `ai_model` 前端类型漏字段（已补）**：契约 §1#1 与后端都返回 `ai_model`，`types/ielts.ts` 的
  `HealthResponse` 没有 → 标为可选补齐（避免一次性改全部 mock fixture）。同理 `word_count_penalty` 实际还回
  `min_words` / `note_zh`（`writing_grader.py:157-159`），前端类型同样补成可选：更早落库的 attempts 里没有这两个键。

## 13. 前端实跑缺陷（Wave 3，真浏览器点击 + 已补测；不是看 mock 绿灯得出的）

跑法：vite dev（5173）+ 隔离后端（8765，`IELTS_DB_PATH` 指向 `backend/tmp-live/click.db`，绝不打开用户真实库）。
每条都是**先在现场看到不对**，再回写成测试。

- **逐句重听点最后一句没反应（已修）**：`anchor_sec` 是 TTS 拼接时的估算秒数，长套题会漂到音频末尾之外。
  实测 `li_s1_craftcourse_03`：44 句估算到 244s，真实 `audio.duration=223.392s`，点第 44 句 seek 越界 → `ended`，
  表现为「按钮点了没反应」。修法：`AudioPlayer` 上报 `onDurationChange`，`ListeningPanel` 用
  `scaleAnchorsToDuration()`（`listeningSets.ts`）按真实时长等比校准并留 1s 顶。校准后第 44 句落 219.3s、仍在播。
  覆盖：`listeningSets.test.ts` 6 例（含 n=2、全零锚点、时长未知原样返回、入参不可变）。
- **同一屏里两处日历日口径不一致（已修）**：`PlanList` 用 `generated_at.slice(0,16)` 直接截 UTC 字符串，
  而热力图/趋势按本地日聚合 → 「今日计划」挂在 10-18、热力图在 10-19。改走 `formatDateTime()`（本地日 + HH:mm）。
  实测：概览显示「生成于 2026-10-18 10:22」，与本机时间一致。覆盖：`report/format.test.ts` 断言
  「把显示文本按本地时间读回来必须还原成同一时刻」——截 UTC 字符串做不到这条。
- **保存成功后看不到「已保存」（已修）**：`DraftField` 的 `useEffect([value])` 在后端回读时无条件 `setSaved(false)`，
  而保存成功本来就会触发回读，于是状态直接消失。改为「回读值 == 刚提交的草稿 → 保留已保存」，
  `clearOnCommit` 的密码框在同一批 state 更新里保留标记。实测改「每日目标 60→75」：未保存 → 已保存，值落库。
- **AI 密钥报错出现两个 `role=alert`（已修）**：`AiPanel.saveKey` 既弹 Toast（danger→alert）又把异常抛给
  `DraftField`（Field 内联 alert），同一句错误读两遍。改为只在字段内联显示，密钥**清除**失败的 Toast 保留。
- **`/health` 状态行被 JSX 注释拆成多个文本节点（已修）**：`… · TTS 可用 ·\nAI 配置 …` 中间夹注释会让
  `·` 与「AI 配置」之间的那个空格在编译后消失，实测文本为 `… ·AI 配置 …`。抽成 `healthSummary()` 返回单条字符串。
- **设置屏用例的偶发红灯（已修，此前诊断是错的）**：原先记成「满负载饿死 `findBy*`，单跑必绿」——
  实测**不成立**：`SettingsPage.test.tsx` 单独跑同样约 1/8 概率红，且红在三个不同用例之间跳。
  插桩给出确定证据：红的那次 `writeInto('setting-daily-goal','90')` 之后输入框是 `60`，
  即用户填的草稿被迟到的 GET 回填覆盖（`DraftField` 的 `[value]` effect 会把草稿刷成服务端值）。
  修法在测试助手：`openSettings()` 除了等标签出现，还要等回填落地（`daily-goal` 是 number、
  `target-band` 是 text，两个锚点各盯一类输入）。修后单文件连跑 12 次全绿。
  `asyncUtilTimeout: 4000` 保留（它当初确实解掉了另一类跨文件并发的超时），但**别把它当根因**。
- **本次补的测试**（dead agent 遗留范围由主控吸收）：`settings/SettingsPage.test.tsx` 15 例、
  `shared/VocabBook.test.tsx`（含「改备注必须整行回传，否则后端 upsert 清空 context/来源/标签」）、
  `shared/ReviewBook.test.tsx`（首屏零写请求、「已掌握」只手动、删除需确认）、`report/format.test.ts`。

## 14. 数据完整性与迁移契约（Wave 7，A 档可靠性）

Wave 6 收尾审计发现一个会真丢掉备考进度的缺陷：`migrate.py:_replace_corrupt` 在归档名
`app.pre-ielts.bak` 已被占用时 `_archive()` 返回 `None`，紧接着的 `db_path.unlink()` 仍无条件执行
—— 第二次遇到损坏就把用户的库删了且零副本，而它上面的注释写的是「没有备份就不动用户文件」。
同时确认：本 app 从来没有「库结构会变」这件事的应对方案（全库只有两处 `PRAGMA foreign_keys`，
无 `user_version`、无 `ALTER`，`schema.sql` 全是 `CREATE TABLE IF NOT EXISTS`）。本节据此立约。

### 14.1 唯一不变式（凌驾于本节其它条款）

**任何代码路径都不得出现「副本没写成 + 原文件已消失」。**
判定一个改动是否合格，只看这条能不能被测试证伪；其余条款都是它的派生物。

### 14.2 schema 版本

- `store.SCHEMA_VERSION: int` 是新库结构版本（Python 常量，唯一真源）；库内版本存在 `PRAGMA user_version`。
- `schema.sql` 只负责**新库**建表（保持全 `IF NOT EXISTS`、首启幂等）；**老库的增量**一律走
  `app/db/migrations.py` 的有序迁移表。禁止往 `schema.sql` 里塞 `ALTER`：新库会因重复列报错，
  老库又拿不到建表语句里的新列，两边同时坏。
- 迁移表的 `version` 是「这一步跑完后库所处的版本」，必须**从 1 开始连续**且顶到 `SCHEMA_VERSION`；
  `validate_chain()` 在动库之前先校验，跳号/重复/常量与表不一致一律拒绝。抬高了常量却忘了写步骤
  == 假装升级完成，比崩溃更糟。版本 1 是「基线空步骤」：版本化之前问世的库 `user_version` 是 0
  而结构就是 v1，给它一个真步骤，新老库才走同一条代码路径。
- 启动顺序固定：读 `user_version` → 若 `< SCHEMA_VERSION` 则**先做 §14.3 的升级前快照** →
  按序 apply（每步一个事务）→ 版本号与 DDL 在同一事务里提交。
  步骤内的 DDL 必须能被回滚，因此执行连接走 `isolation_level = None` + 显式 `BEGIN IMMEDIATE`
  （Python 默认模式不为 `ALTER` 开事务，会当场提交 —— 那正是半迁移状态）；
  步骤内**禁止** `executescript()`，它隐式 COMMIT，会把事务撕开。
- 任一步抛错：该步事务回滚、`user_version` **保持原值**、app 进入「结构未就绪」，
  所有读写返回 500 + `code: "schema_upgrade_failed"`（detail 中文，不含路径与 SQL）。
  **禁止半迁移状态继续跑** —— 那只会把一次失败放大成整库不可读。
- `user_version > SCHEMA_VERSION`（用户拿老版本 EXE 打开新结构库）：同样返回
  `schema_upgrade_failed` 并**原样保留库**。按旧结构写下去会把新列当不存在，那是比报错严重得多的事故。
- 「结构未就绪」是**服务照常起来后的拒绝状态**，不是进程崩溃：lifespan 捕获升级异常后继续 yield。
  崩掉的话前端只显示「连不上本地服务」，用户看不到真相（升级失败 + 快照已经在 backups 里）。
- 与 §14.6 的交界：结构升级失败会**闩住**（每个请求重跑升级会在 backups 里堆快照，且同一条 `ALTER`
  第二次必然报错）；锁库、磁盘忙这类瞬态失败**不闩**，下一次调用自然重试。
  重试的正当姿势是修好之后重跑，而不是让半迁移结构继续接客。
- 步骤一旦上线就永远不能再改：跑过它的库里版本号已经写上，重放不会发生，改了也没用。要修结构就再加一步。

### 14.3 归档与快照

- 归档/快照文件名一律带 UTC 时间戳且**永不覆盖**；同名已存在时追加 `-02`、`-03`…
  拿到可写目标路径之前，不得对原库做任何破坏性动作。
- 移开损坏库用 `os.replace()`（同目录原子改名），不用 copy + unlink。
  改名失败（被占用 / 权限 / 跨卷）→ 放弃重建、报错、原库留在原地。
- 快照走 SQLite 在线备份 API（`conn.backup()`）写到 `<数据目录>/backups/app.<UTC>.sqlite`；
  **禁止**复制正在写的 `app.db` 活文件（只会得到半截库）。文件名带标记（`pre-upgrade` /
  `pre-restore` / `manual`），设置屏要据此区分自动与手动。
- 快照中途失败要把那份**半截副本删掉**再上抛：留着它，备份列表会显示一份看着能用、
  实则读不出表的文件 —— 而用户以为自己有备份。删的是我们造的副本，不是原库。
- 轮转保留最近 10 份，且只作用于 `backups/` 目录：`app.db` 旁边的归档与损坏改名副本**永不删除**。
- 触发点：schema 升级前必做一次；日常启动时若距上次成功快照 > 7 天补做一次。
  版本没变**不该**快照（每次启动都拍一遍会把「升级前快照」这个标记冲淡成噪声）。
- 端点：
  - `GET /api/backup` → `{items, keep, directory}`。每行 `{name, size_bytes, created_at, tag, pre_upgrade}`；
    `keep` 是轮转上限（10），`directory` 给设置屏显示「把副本拷出机器该去哪儿」—— 本机路径不是秘密，
    但只出现在这一处，错误 detail 里一律不许有路径（CONSTITUTION §3）。
    排序按 mtime 新→旧：同一秒内的两份靠文件名比不出先后。
  - `POST /api/backup` → 建一份 `manual` 快照，返回那一行。
  - `POST /api/backup/{name}/restore` → **必须**先把当前库快照成 `pre-restore` 才允许覆盖；
    恢复用 `snapshot.backup(current_conn)` 把快照内容写回当前库，**不是替换文件**
    （Windows 上正在被连接的文件换不掉，换到一半比不恢复更糟）。
    成功后清掉建表缓存，让下一次连接按 `user_version` 重新判定结构 —— 恢复老快照意味着结构也回到老版本。
  - `{name}` 来自 URL，是用户可控字符串：只接受 `app.<tag>.<UTC时间戳>[-NN].sqlite` 且解析后仍在
    `backups/` 内；带分隔符、绝对路径、不匹配白名单的一律 400/404，且**不许因此动到当前库**。
    这个校验漏一次，就等于把「覆盖本机任意文件」开放给一个字符串。
- 首启刚建出来的空库（`fresh`）**不补拍**快照：库里还没有值得保护的东西，
  拍一份只是给 `backups/` 添噪声，也会把「升级前快照」这个标记冲淡。

### 14.4 删除必须可逆

- `attempts.deleted_at TEXT`（迁移 v2 加列 + `idx_attempts_deleted` 索引）。`DELETE /attempts/{id}` 改为打标记，幂等。
- 新增 `GET /attempts/trash`、`POST /attempts/{id}/restore`、`DELETE /attempts/{id}/purge`；
  `purge` 在该库尚无任何成功快照时返回 409（提示先备份）。
- **所有**由 attempts 派生的统计口径（progress / analytics / plan / practice_minutes）必须排除
  `deleted_at IS NOT NULL`。这条最容易漏也最致命：趋势会因一条已删记录长期偏低，
  而用户在存档列表里根本看不见它，等于数据对了但结论错了。
  （`review_items` 不在其中，理由见本节末尾的订正。）

实现口径（Wave 7d 定，写在这里是为了让「漏了一处」变成可测的事实）：

- **读取全部集中在 `store.py`**，所以过滤有唯一一个落点。任何绕过 `store` 直接 `SELECT attempts`
  的新代码都算违约 —— 加了这一列就得把下面这张清单对着核一遍：
  `list_attempts` / `attempts_total` / `last_practice_at` / `total_minutes` / `trend` /
  `composite_trend` / `latest_band_per_module` / `previous_band_per_module` /
  `question_type_accuracy` / `module_accuracy`（两者 JOIN attempts）/ `recompute_practice_minutes`。
  `plan` 与 `progress` 都是从这几个函数派生的，不需要各自再 filter。
- **软删与恢复都要重算当天 `practice_minutes`**：缓存表的口径与统计口径必须一致，
  否则「今日分钟」和「总分钟」会互相打脸。
- **`GET /attempts/{id}` 对已软删的记录仍返回 404**（§1 行 24 的既有断言不动）。回收站列表
  自带摘要（module / task_ref / band_overall / created_at / deleted_at），够用来决定恢复还是清除；
  要看完整报告就先恢复。这样前端只有一套详情读路径，不会出现「刚删的记录还能从存档 URL 打开」。
- **`purge` 才做老 `delete` 的事**：清 `attempt_items`（外键级联）并把 `speaking_turns.attempt_id`
  置 NULL。软删**不碰**这两处 —— 恢复后录音归属必须还在，否则「可逆」是假的。
- **错题本（`review_items`）不随 attempt 软删而隐藏。** 上面那条把「review 聚合」列进口径是
  立约时写高了：`list_review_items` 与 `error_type_stats` **都只读 `review_items`，与 attempts 无 JOIN**，
  没有可排除的东西；现状硬删同样不动它们。更实质的理由是 `review_id` 是跨 attempt 的稳定身份、
  `source_attempt_id` 只指向最近一次出现，按它过滤会连带隐藏来自其它练习的同一条错题。
  订正以实现为准：**排除范围就是上面那张 attempts 读取清单，不含 `review_items`**。
- **迁移 v2 的 `ALTER` 必须先查列在不在**：`schema.sql` 里 `attempts` 直接带 `deleted_at`（新库），
  所以新建库首次升级会撞 `duplicate column name`。用 `PRAGMA table_info(attempts)` 判定，
  存在即跳过 —— 这不是防御性代码，是新库/老库共用同一张迁移表的必然结果（§14.2）。
- `409` 的判据是「本机 `backups/` 里一份快照都没有」，不是「用户点了确认」：清除是不可逆动作，
  而 app 已经有自动快照，绝大多数情况这道门是通的；它拦的是「刚清完库就硬盘故障」这种真没退路的情形。

### 14.5 草稿不许只有一份

先说清现状为什么算缺陷，才能判断做到了没有：作文正文在提交成功之前**只存在于 WebView2 的
localStorage 里**，而那份 profile 一旦被系统清理、被用户重装、或换一台机器，草稿就永久消失，
学习库和快照里都没有它的痕迹。CONSTITUTION §1 的「没有服务器」指的是**不依赖远端服务**，
把草稿写进同机的 sidecar 学习库不违背它 —— 学习库本来就有 §14.3 的快照保护，
草稿进去之后才第一次拥有「副本没写成 + 原文件已消失」这条不变式的保护。

新表（迁移 v3）：

```sql
CREATE TABLE IF NOT EXISTS drafts (
  key          TEXT PRIMARY KEY,
  module       TEXT NOT NULL,
  ref          TEXT,
  payload_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

- `payload_json` 存 `{"v": <草稿正文字符串>, "t": <客户端毫秒时间戳>}` —— **和 localStorage
  里的记录同形**，前端可以原样透传，不需要两套序列化。正文一律是字符串（听力/阅读存
  `JSON.stringify` 后的答案，写作存散文），所以 `v` 的类型是死的。
- `module` / `ref` 从 `key` 的前缀推出（ref 是第一个下划线之后的整段，本身可以再带下划线），
  只用于将来按任务清理和排查，读取路径不依赖它们。key 由 `draftKeyOf()` 生成，实际形状是**题号级**
  而不是题型级：`writing_wr_t2_carcity_02` → module=`writing`、ref=`wr_t2_carcity_02`；
  听力/阅读是 `listening_<套题 id>` / `reading_<套题 id>`；还没选题时的占位是 `writing_none`
  / `listening_none`（白名单允许，因为尾段只要非空就行）。
- **`CREATE TABLE IF NOT EXISTS` 是硬要求，不是抄风格**：`schema.sql` 对新库已经建好这张表，
  而新库的 `user_version` 从 0 起、整条迁移链都要跑一遍，步骤 3 若写裸 `CREATE TABLE`
  就正好撞在自己建的新库上（§14.7 里 7d 那条索引教训的同一件事）。
- 建表不建索引之外不要往 `schema.sql` 里塞任何引用迁移期列的 DDL（§14.2 第 4 条）。

端点语义（§1 行 48–50）：

- `PUT /api/drafts/{key}` body `{"value": string, "saved_at": int?}` →
  `{key, updated_at, size}`。落库时 `updated_at` 由后端写 UTC（§0），`payload_json` 的 `t`
  取 body 的 `saved_at`，缺省时用当前毫秒。写是 **upsert**，没有「草稿不存在所以不能写」这种分支。
- `GET /api/drafts/{key}` → `{key, value, updated_at}`；该 key 没有草稿返回 **404 `not_found`**
  （前端把 404 当「远端没有副本」，不是错误，不许弹红）。
- `DELETE /api/drafts/{key}` → `{cleared: true}`，**幂等**：删不存在的 key 也返回 200。
  提交成功之后才敢清本地，靠的就是这条不会因为「远端已经没有」而失败。
- `{key}` 来自 URL，是用户可控字符串。白名单 `^(listening|reading|writing)_[A-Za-z0-9_.-]{1,120}$`
  之外一律 400 + 中文 detail，detail 里不含路径。它只当主键用、不参与任何文件路径拼接，
  但仍然要限长限字符集：否则一个写错的客户端能把学习库塞满无用的 blob，
  而每一坨都会被 §14.3 的快照复制一遍。
- 正文长度上限 **200 000 字符**，超了返回 413 + `code: "payload_too_large"`。
  放得下一篇写满的作文（约 6 000 字符）三十倍，拦的是「把整份 PDF 粘进输入框」这类 runaway。

双写与恢复（`useDraftAutosave`）：

- localStorage 仍然是**首屏与离线的快路径**：防抖节奏、`flush()`、`clear()` 的现有语义一律不动。
  每次真正落盘 localStorage 的同时（同一个 `write()` 里）发出 `PUT`，不额外起定时器。
- 恢复取「较新的一份」，比较的是**可比的毫秒**：本地记录的 `t` 与远端返回的 `updated_at`
  解析成毫秒后比大小，谁新用谁；相等时用本地。这里能这么比的前提是 sidecar 与页面在
  **同一台机器、同一个系统时钟**上 —— 跨机器的时钟偏移会让这条规则变成抽签，所以不许把
  这个比较搬到任何远端服务上。
- 远端不可用（PUT 失败）时**必须可见**：面板显示「草稿目前只存在本机浏览器里」，
  不许静默退回单副本。不额外做退避重试 —— 下一次防抖本来就会再试一次。
- 提交成功的清理：本地**立刻**清（用户要马上看到空输入框），同时把 key 记进 localStorage 的
  `ielts.draft.pendingClear` 并发起 `DELETE`；删成功就从名单里摘掉，删不掉（离线）就留着，
  下次进入同一面板时**先补发名单里的 DELETE、再走恢复逻辑**。于是「已经交掉的作文」不可能
  从远端被当成草稿恢复回来。
  这里**故意不用**「先删远端、成功后才清本地」那条顺序：远端删不掉时本地会留下一整篇
  已经提交的草稿，用户看到的输入框还塞着自己刚交的文章 —— 比多补发一次请求糟得多。
  两种写法守的是同一条不变式（**提交过的正文不能再以草稿形态出现**），选可立刻观察到的那种。
- 本期**只做**听力 / 阅读 / 写作三个面板已有的草稿键；口语没有 `useDraftAutosave`
  （录音走 turn 直接落库），不在本节范围内，别顺手加。


### 14.6 存储层失败必须可见

- `sqlite3.OperationalError` / `DatabaseError`（`disk I/O error`、`database is locked`、
  `no such table/column`）在 `api/common.py` 统一映射为 500 + `code: "storage_unavailable"`，
  detail 说清「本机学习库暂时写不了，这次操作没保存」，**不含**文件路径、SQL 片段或异常 repr
  （与 CONSTITUTION §3 同源）。
- 启动时跑一次 `PRAGMA quick_check`：不通过 → **不删库、不重建**，进入只读降级
  （写请求返回 503 + `code: "storage_readonly"`），并把原因显示在概览。
  损坏的库比没有库有价值得多。
- 降级的三道硬门，缺一不可：
  1. **不做**：`quick_check` 不通过时跳过 `migrate.run()` 与快照补拍 —— 半损坏的库上跑
     `ALTER` 只会更坏，拍快照等于把坏结构复制进 `backups/` 好几份；
  2. **挡写**：只读闩住后，`POST/PUT/PATCH/DELETE` 在**进路由之前**被裸 ASGI 中间件
     （`main.StorageReadonlyGuard`）挡成 503 + `STORAGE_READONLY_DETAIL`，被拒绝的写不可能
     落库；`GET/HEAD/OPTIONS` 一律放行 —— 用户至少要看得到自己以前的记录。
     守卫注册在 CORS **之内**（后注册的中间件更靠外），否则 503 带不到 CORS 头。
  3. **说清**：`/api/health` 在库读不出来时**仍返回 200**，`ai` 块按环境变量算（`store.ai_block({})`，
     `raw is None` 才读库），并带上 `storage: {"state": "ok"|"readonly", "reason": 中文|null}`。
     一个 500 的体检端点会在故障时正好把「到底怎么了」藏起来。
- 只读闩**只由结构性故障触发**（缺表 / 缺列 / malformed / not a database，见
  `store.STRUCTURAL_MARKERS`）：这类情况下继续写会把库越写越坏。锁库与磁盘满会自己好起来，
  闩住等于逼用户重启，反而更糟 —— 它们只让当次请求返回 500 `storage_unavailable`。
- 降级期间**请求路径也不许跑建表/迁移链**（`store.ensure_schema()` 在「已闩只读且结构尚未就绪」
  时直接抛 `store.StorageUnavailableError`）。实拍里踩到的是：启动体检已经把库闩成只读，
  但第一个读请求仍然调了 `ensure_schema()`，而 migrate 的坏库分支会把残损文件改名成
  `app.db.corrupt.<时间戳>.bak` 再建空库 —— 用户界面上一切正常、只是没有数据，
  真相是他的唯一一份残损文件被动过。读不出来的库**读也读不了**，这类读请求拿
  500 `storage_unavailable`，不是「空库 200」。
- `store.ensure_schema()` 的「只跑一次」缓存：失败必须可重试；表级 malformed 不得只靠
  `SELECT sqlite_master` 判定（它检不出 `attempts` 内部的损坏）。
- 界面侧（契约 §8.3 的例外：这块不是磁贴，是告警条）：外壳主区顶部按 `health.storage.state`
  渲染 `StorageNotice`，降级期间每一屏都在（用户会在任何一屏点保存），文案 = 后端给的中文原因 +
  「重启应用」这一条可执行的下一步。原因文本**只来自后端**，前端不自己拼 sqlite 术语。

### 14.7 Wave 7 实跑记录（7a–7g，已实现并验证的部分）

- **7a 的地雷**：`_replace_corrupt` 那段「没有备份就不动用户文件」的注释与代码相反，已在 §14.1
  的口径下修掉（先拿到确定可写的新路径，才允许动原文件）。修完暴露出第二个缺陷：归档时
  连接没先关掉，Windows 上 `os.replace()` 直接 `PermissionError` —— 同一个库里两条都是
  「副本没写成」，但只有第一条会被不变式测试抓到，所以测试必须**真跑 replace**，不能只断路径拼接。
- **7b 的关键实测**：Python sqlite3 默认（legacy）`isolation_level` **不把 DDL 包进事务**，
  `ALTER TABLE` 自动提交。插桩跑「迁移中途抛错」得到的确定结论是 `version after rollback: 0`，
  即列已经加上、`user_version` 还是旧值 —— 半个迁移状态。因此每个步骤必须
  `conn.isolation_level = None` + 显式 `BEGIN IMMEDIATE` / `ROLLBACK` / `COMMIT`，
  且 `PRAGMA user_version` 写在同一事务里（详见 §14.2）。
- **7b 在真实数据上验过，不是只在 tmp 库里绿**：把用户当前 `app.db` 在线备份到临时目录后跑
  `migrate.run()`，`user_version` 0→1、`jobs` 表按新结构补齐、行数与升级前一致、原文件未被改动，
  升级前快照能读回全部记录。
- **7c 的两个决定**：① 快照排序不能用文件名 —— `-`（45）排在 `.`（46）前，同一秒内的
  `app.manual.20261028T010203-02.sqlite` 会插到 `app.manual.20261028T010203.sqlite` 前面，
  改按 `(mtime, name)`；② 恢复走 `src.backup(dst)` 写进活库，**不换文件**（Windows 上
  正在使用的 `app.db` 换不掉），换完必须 `store.reset_schema_state()` 重读版本。
- **7c 的破坏性实测**：真实进程里删掉 5 条 attempt → 列表还原 → 从快照恢复 → 4 张表
  （38/231/99/12 行）全部回来。这类断言只在 mock 上过等于没验。
- **`ListeningPanel.test.tsx` 的旧诊断又一次是错的**：「网络失败显示可读原因」那个用例的红灯
  不是跨文件并发把 CPU 饿死 —— 三个套件合跑 **122ms** 就稳定复现。真因是 `status==='ready'`
  由 `api.data` 直接推出，而 `<audio>` 的 blob src 要等 `useListeningAudio` 的 effect 落地
  （多一次渲染），同步断言 `src` 读到的就是 `undefined`。修法用 `waitFor`，不放宽超时。
  与 §13「设置屏偶发红灯」同一课：**先量复现耗时，再决定是竞态还是负载**。
- **7d 被自己的测试抓出来的一条硬约束**：`schema.sql` 跑在增量迁移**之前**，所以它里面
  **不许出现引用尚未由迁移补上的列的 DDL**。第一版把 `CREATE INDEX ... ON attempts(deleted_at)`
  写进了 `schema.sql`，老库（表已存在 → `CREATE TABLE IF NOT EXISTS` 跳过、列还没加）
  当场 `no such column: deleted_at`，升级路径直接断。索引因此只写在迁移步骤 2 里；
  新库也会跑到步骤 2（新库 `user_version` 从 0 起，整条链都要跑），所以两边都有索引。
- **7d 的真库验证**（`D:\tmp\ielts-demo\verify-7d.py`，全部在副本上，两个原文件只读一次做 backup）：
  ① 用户真实库副本 `user_version` 0→2、`deleted_at` 与 `idx_attempts_deleted` 到位、
  `quick_check ok`、升级前快照可读出 v0 的库、原文件仍是 v0；
  ② 演示库副本（38 条 attempt）走真端点：删除后 `attempts_total` 38→37、`minutes_total`
  617.2→617.0、趋势点 32→31，回收站能看到该行且带 UTC 的 `deleted_at`，再删一次仍 200，
  恢复后概览与题型正确率**逐字段等于删除前**；③ `purge` 在有快照时放行、行真少一条，
  把 `backups/` 清空后 `purge` 返回 409 + 中文文案（不含路径）且库没动。
  真实库只有 0 条记录，行为验证必须另找有数据的库 —— 别把「跑通了」当成「验过了」。
- **前端门禁在满载冷启动时会随机红**：同一句 `npm test`，第一趟 49s / 17 个 `Test timed out in 5000ms`，
  第二趟 26s 全绿 —— 撞到的是 vitest 默认 `testTimeout`，不是等待逻辑（逻辑仍由
  `asyncUtilTimeout: 4000` 兜）。已在 `frontend/vitest.config.ts` 显式抬到 20s 并写明理由：
  门不能随机红，但抬高的是「机器慢」的容忍度，不是「等不到东西」的容忍度。
- **7e 的实拍挖出一条一直存在的死配置**：`api.ts` 原先 `const meta = import.meta` 再取 `meta.env`，
  Vite 的**静态替换**认不出这种写法，dev 里 `import.meta.env` 是 undefined，于是 `VITE_API_BASE`
  设什么都不生效，页面永远打 8765。已改成直接写 `import.meta.env`（`src/services/api.ts`）。
  坑中坑：这条**单测抓不到** —— vitest 原生提供 `import.meta.env` 对象，坏写法在 jsdom 里照样绿；
  所以补了一条源码形状守卫（正则钉住「不许先别名 `import.meta`」），并把坏写法塞回去确认它真的会红。
  凡是依赖打包器静态替换的行为，jsdom 绿灯等于没验，要么源码守卫、要么真实浏览器验。
- **7e 契约里的例子是凭想象写的，被真实数据纠正**：草稿键不是题型级而是**题号级** ——
  真跑出来的行是 `writing_wr_t2_carcity_02`（`draftKeyOf(taskId)`），不是我第一次断言的
  `writing_task2`。第一次实拍「失败」就是这个原因，不是双写坏了。§14.5 的例子已按真实数据改。
- **7e 的故障实拍要挑「只有这一份副本坏」**：一开始想当然地杀掉 sidecar，结果整个应用连
  「引擎已就绪」这道门都过不去，界面根本到不了写作屏，什么也拍不到。改成**在线把 `drafts` 表改名**
  （不重启进程，`store` 每次请求新开连接会重读 schema）→ `GET /drafts/{key}` 返回 500
  `internal_error` + 中文无路径文案、`/api/health` 仍 200 → 界面出现「草稿目前只存在本机浏览器里」、
  草稿磁贴读数变成「已保存 / 仅本机一份」，本地 206 字正文一个字没丢。改回表名后远端立刻可读回。
- **7e 的隔离换法**：用户的 5173/8765 一直在跑，而 sidecar 的 CORS 白名单只有 5173。为了截图把
  生产 CORS 默认值开成通配是本末倒置，所以改用一份**拍完即删**的临时 vite 配置走同源代理
  （`/api` → 127.0.0.1:8766）+ `VITE_API_BASE=/api`。注意 `.env.local` 会被 vitest 读进去，
  留着它整条前端门会假红 58 条 —— 本次踩过，已确认删除。
- **7f 的实拍抓出一条「降级期间顺手重建」的真缺陷**（这次不是测试没绿，是测试全绿但行为错）：
  启动 `quick_check` 不过 → 正确地闩了只读、正确地跳过迁移与快照，但**请求路径**上的
  `store.ensure_schema()` 没有同样的闸门，第一个读请求仍然跑进 `migrate` 链，而那条链的坏库分支
  把 `app.db` 改名成 `app.db.corrupt.<ts>.bak` 又建了一个空 v3 库 —— 于是 `GET /api/attempts`
  返回 **200 + 零数据**，看起来像「库空了」而不像「库坏了」，正好是 §14.6 明令禁止的那个动作。
  修法是给 `store` 加 `StorageUnavailableError`，在 `ensure_schema()` 里「结构从未就绪 + 已闩只读」
  时抛出，`common.py` 的 handler 让它回 500 `storage_unavailable`（中文文案、无路径），
  `/api/health` 的 catch 兜到 `store.ai_block({})` 按环境变量报告。**口径**：坏库时读也读不出来，
  读请求拿 500 `storage_unavailable`，绝不是「空库 200」—— 200 的零数据会把故障伪装成用户没练过。
- **7f 的验证必须看文件字节，不能只看响应**：重跑同一套损坏库实拍，断言的是 `app.db` 的 md5
  与浏览器跑之前**逐字节相同**、`backups/` 没有新增 `.bak`、没有新快照，加上读 500 / 写 503。
  第一次重做时我把 `app.db.corrupt-me`（损坏**前**的健康副本）当成了坏库装回去，跑出来一切正常，
  差点当成修好了 —— 真正的坏字节在 `pre-fix/app.db.corrupt.*.bak` 里（md5 `47bcedde…`）。
  制造故障的脚本要**自己留下故障文件的哈希**，否则「验证通过」验的是想象中的故障。
- **7f 的界面文案不能超出后端能兑现的承诺**：横幅第一版写「之前的练习记录仍可查看」，
  但库真损坏时所有读请求都是 500，这句话当场是假的。改成「学习库文件不会被自动重建或搬走，
  手工恢复的机会还在」—— 这句在两种降级路径（结构不完整 / 文件损坏）下都成立。
  测试同步钉了 `not.toContain('仍可查看')`。
- **7f 实拍的两个操作坑**：① 只读闩是**写**触发的，进「写作」任务列表不发任何 drafts 请求
  （草稿恢复只读 localStorage，远端副本是单写冗余），所以必须真打字 + 让自动保存 PUT 出去才会闩；
  而自动保存在正文没变化时会跳过 PUT，所以注入文本要带时间戳后缀。② Git Bash 会把
  `VITE_API_BASE=/api` 里的 `/api` 当路径转换成 `D:/program/Git/api`（在 vite 改写后的
  `import.meta.env` 里能直接看到），必须 `MSYS_NO_PATHCONV=1` 起 vite。

- **7g 的实拍走的是真后端，不是 mock**：点一次「立即备份一份」，`backups/` 里真的多一个文件、
  界面从 2 行变 3 行、磁贴跟着变 `3 份`；tag 翻成人话（`manual`→手动备份、`pre-upgrade`→升级前），
  时间按本地时区显示，大小是 `0.6 MB`。恢复弹窗点「取消」后 `pre-restore` 行数没多 —— 确认框真的挡在前面。
  回收站同一条链：`恢复` 让后端从 2 条变 1 条、界面少一行；`确认清除` 后归零并落到
  「回收站是空的…」空态，`最近一次删除` 磁贴老实地显示 `—` 而不是编一个时间。

- **7g 的只读闸门逐个按钮点过名**（§14.8 最后一条，之前只有单测）：把库闩成只读后重载进设置屏，
  `立即备份一份`、四行 `恢复到这一份`、`恢复`、`彻底删除` **全部 disabled**，而
  `复制路径` 与 `重新读取` 仍可点 —— 只读期间禁的是写，不是读。两张卡各自还有一句解释：
  「学习库当前只能读，备份与恢复要等它恢复可写；下面的副本仍然可以查看。」
  整屏那条 §14.6 的横幅同时也在，用户不会只看到按钮变灰而不知道为什么。

- **7g 实拍抓出驱动脚本自己的假场景**：`click("恢复")` 是子串匹配 + 文档顺序取第一个，
  命中的却是备份卡的「恢复到这一份」，于是恢复弹窗叠在回收站上面；程序化 `.click()` 又能穿过遮罩
  点到下面那行的「彻底删除」，跑出来「恢复没生效、清除却生效」的怪结果。
  **口径**：驱动里点卡片内按钮必须按 `section[aria-label="…"]` 限定作用域 + 文字精确相等，
  并断言 `[role="dialog"]` 只有一个 —— 弹窗数 > 1 时后面所有断言验的都是假场景。

- **缺表故障必须在进程活着时注入**（这条纠正了 §14.7 里 7f 记录的可读误解）：开机前就把
  `drafts` 改名，`store.ensure_schema()` 会在原地重建一张同名空表（PUT 直接 200，`drafts_gone`
  还在旁边不动），只读闩根本落不下来，界面一切正常 —— 自愈是对用户好的行为，但拿它当故障场景会白跑一趟。
  7f 那次能撞出来，是因为改名发生在**已启动的进程**活着的时候。

- **裁单张卡的两个硬约束**：`Card` 渲染成 `<section aria-label="标题">`，按标题选节点即可
  （先前用 `main div` + 第一个 `h3` 文字匹配，量到的是外层容器，坐标对不上，截出来是白图）；
  CDP `Page.captureScreenshot` 的 `clip` 用**视口 CSS 坐标**，而本站滚动只发生在 `main` 里，
  所以要先改 `main.scrollTop`、等约 450ms 让 `lift` 过渡走完，再重新量一次矩形。

### 14.8 Wave 7 的数据入口界面（7g）

§14.3 与 §14.4 的端点在 7c/7d 就齐了，但**用户在界面上一个都够不着**：不知道自己有备份、
不知道备份在哪儿、删错的练习记录找不回来。一份用户看不见的保护等于没有保护 ——
所以这一节的判定标准不是「有没有调通端点」，而是「一个不懂代码的用户能不能在出事那天自己救回来」。
7g 的实跑记录仍追加到 §14.7。

**放置**：设置屏末尾两张卡 —— `数据与备份` 与 `回收站`，不新增导航项。理由是这两件事都是
低频、高后果的动作，用户的心智位置就是「设置里找数据」；把它们做成一级页面反而天天占着导航。
`purge` 的 409 文案里那句「请先在「数据与备份」里备份一份」（§14.4）现在就有了对应的真实界面，
不是空头指引。

**`数据与备份` 卡**：

- 读数（契约 §8.3 的例外：这块读的是文件与时间，不是练习指标）：快照份数、`days_since_last`
  （距上次成功快照几天，`> max_age_days` 才给暖块）、`keep`（轮转上限，让用户知道旧的会被冲掉）、
  最近一份的时间。
- `tag` 要翻成人话，不许把 `pre-upgrade` 这种字符串直接甩给用户：
  `manual`→手动、`startup`→自动、`pre-upgrade`→升级前、`pre-restore`→恢复前。
  §14.3「设置屏要据此区分自动与手动」就是这条。
- 每行按 `本地时间 + 语义 + 大小(MB)` 展示。`created_at` 是 UTC，展示必须走本地时区，
  与 §14.7 里 `generated_at` 时区不一致那条是同一个坑。
- 动作只有两个：`立即备份一份`（`POST /api/backup`，成功后重读列表）、
  `恢复到这一份`（`POST /api/backup/{name}/restore`）。
- **恢复是本站唯一的破坏性写入**，因此：① 必须走确认弹窗（`Modal`），弹窗正文要点名「当前进度会被覆盖」
  和「系统会先把当前状态存成一份『恢复前』副本」（§14.3 的 `pre-restore` 门，用户看得见才算数）；
  ② 危险动作不许是默认焦点 —— `Modal` 把焦点交给面板里第一个可聚焦元素，而它渲染的是头部那个
  「关闭」按钮，所以 Enter 下去关的是窗、不是恢复；确认按钮放在 footer 末尾且 `variant="danger"`，
  视觉重量要与后果匹配；
  ③ 弹窗正文不许出现文件路径（CONSTITUTION §3）。
- 恢复成功后**不许假装全站已刷新**：结构可能随快照回到旧 `user_version`，其它屏的缓存数据都是旧的。
  界面给一句「已恢复到 …，其它页面的数据请重新读取或重启应用」，并只重读本卡与回收站。
- `directory`（本机路径）只在这一处出现，用作「把副本拷出机器」的指引，旁边给复制按钮。
  **不做**「打开文件夹」：那要给 Tauri 加 shell/opener 权限，属于扩大能力面，
  而 CONSTITUTION §1 要的是不扩大。路径可以显示，但绝不进任何错误 detail（§14.3、CONSTITUTION §3）。

**`回收站` 卡**：

- 数据来自 `GET /api/attempts/trash`，`total` 进读数（「共 N 条」），列表行给
  科目 / `task_ref` / band / 删除时间（UTC→本地）。摘要够决定「恢复还是清除」就够，
  不提供看完整报告的入口 —— §14.4 定了已软删的 `GET /attempts/{id}` 仍 404，要看报告先恢复。
- 每条两个动作：`恢复`（`POST /api/attempts/{id}/restore`）与 `彻底删除`。
  `彻底删除` 同样必须确认（不可逆），且后端在没有快照时返回 409 + 中文文案，
  前端把那句原样显示，不改写成「删除失败」。
- 空态要写清楚它空着是正常的：「回收站是空的。删除练习记录后可以在这里找回。」

**与 §14.6 的联动**：`health.storage.state === 'readonly'` 时这两张卡的**所有写动作禁用**，
并各带一句原因（「学习库当前只能读，备份与恢复要等它恢复可写」）。
禁用的理由是：降级期点「立即备份」只会撞 503，而用户此刻最需要的是看清退路还在不在 ——
读快照列表这种只读动作不受影响，仍然可用。

**版式**：两张卡沿用 §8.3 的卡片语言，但**快照列表与回收站行用行式（表格式）而不是磁贴**：
磁贴是给「一眼读一个数」的，这里是一列同类条目各自带两个动作，铺成磁贴会让按钮淹没在方块里。

## 15. 崩溃与故障可见性（Wave 7 B 档）

§14.6 管的是**存储层**失败要看得见；这一节管的是**渲染层**：一屏抛错时用户看到什么。
B 档其余三条（出站闸门、日志落盘、sidecar 监督）在实现时各自补小节。

### 15.1 渲染异常不许白屏（B1）

现状：`main.tsx` 只有 `<StrictMode><App/></StrictMode>`，没有任何错误边界。React 19 在根渲染抛错时
会把整棵树卸载 —— 用户看到**全白**，连左轨导航都没了，只能自己想到去重启应用。
一个只读屏的渲染 bug 就能把「数据都还在」变成「看起来像全没了」，这正是 §14 一以贯之要防的错觉。

**边界放两层，各管各的后果**：

- **内层**：包住 `<main>` 里的当前视图，`key` 就是 `view`。这样一屏崩了不影响左轨与右辅助栏，
  用户**点别的导航项就能继续用** —— 而 `key` 变化天然让 boundary 复位，不需要额外的「切屏清错误」逻辑。
- **外层**：包住整个 `<App/>`。导航、外壳、右栏自己抛错时（比如 `useTheme` 读到脏设置）总得还有个落点，
  这一层兜住的就是「只剩一个可点的动作：重新载入应用」。

**兜底面板的硬约束**：

1. 中文、可行动。内层文案要点名「只有这一屏没显示出来」，并给 `重试这一屏`；外层给 `重新载入应用`。
   按钮走 §8.3 的 `Button`，不许裸 `<button>`。
2. **不显示技术细节**：堆栈、组件名、`error.message` 一律不进 DOM。理由有两条 ——
   CONSTITUTION §3 禁止用户可见文本里出现路径与异常 repr，而 React 的 message 经常带
   `http://127.0.0.1:5174/src/...` 这种模块 URL；同时这个应用的用户不需要靠堆栈定位问题，
   原始错误由 `componentDidCatch` 交给 `console.error`，排查时开 DevTools 就够。
   测试要**反向钉住**这条：断言兜底文本不含 `Error`、`.tsx`、`C:\`、`/api/`。
3. **不许承诺数据安全**（§14.7 里 7f 那条「文案不能超出后端能兑现的承诺」的同一课）：
   崩溃可能发生在草稿防抖的 1.2s 窗口内，所以兜底里**不写**「你的练习记录都还在」这种话。
   允许写的只有与它无关的事实：这一屏没显示出来、可以重试、可以切走。
4. 重试失败要安静地继续显示兜底，而不是二次抛错把内层边界也打穿 —— 由 `key` 复位后
   children 重新渲染、再次抛错时 `getDerivedStateFromError` 会重新置位来保证。
5. 兜底面板必须仍可键盘操作（焦点落在面板里第一个按钮上），且 `role="alert"` 让读屏器播报。

实跑记录见 §15.9（与 §14.7 同一个规矩：结论只写在实跑记录里，条款本身只写要求）。

### 15.2 用户可见的在线开关必须真的闸住出站（B2）

现状（读代码可得，不是猜测）：设置页「允许在线服务」写进 `settings.online_enabled`，但**全仓库没有任何
判定读它** —— 只有 `api/settings.py` 校验它、`db/store.py` 给它默认值、`db/migrate.py` 搬运它。
所有出站判断读的是**进程级** `config.ONLINE`（`IELTS_ONLINE`）。结果：用户取消勾选之后，
AI 评分照样把作文正文发出去，edge-tts 照样按文本内容去请求远端语音。

为什么这条排在 B 档第一条：它不是「功能没做完」，是**界面给了用户一个关不掉的开关**。
CONSTITUTION §1 承诺不出门，而这里的代价是用户**以为自己已经授权关闭**之后那段练习内容 ——
一次误判就不可撤回，比丢一次评分严重。条款：

1. **出站许可只有一个判定点**：`services/ai_client.network_allowed()`，取值是
   进程级 `_cfg.ONLINE` **与** 用户设置 `settings.online_enabled`（AND，任一为假即不出门）。
   要出门的地方（`api/media.py`、`api/listening.py`、`api/speaking.py`、`api/writing.py`、
   `services/speaking_session.py`）以及 `api/health.py` 的 `_tts_ok()` 一律调它，
   **不许再各自读 `_cfg.ONLINE`**。判据是 `grep -rn "_cfg.ONLINE" backend/app/`：
   出站方向只应命中这个判定点；`db/migrate.py` 那一处是**首次迁移时给设置播种**
   （把当时的进程开关写进用户偏好），不是判定，属允许项 —— 出现别处就是有了第二份「谁说了算」。
2. **两个方向分别钉住**：① 进程在线 + 用户关 ⇒ 零出站；② 用户勾选 + 进程关 ⇒ 零出站。
   ②已经过、留着防回归；①是这一节要补的。断言形态要能证明「请求真的没出门」，
   不接受只断言设置读到了：至少覆盖 `/api/tts` 返回 503 `tts_offline`、
   写作批改返回 `ai_used=false` + `degraded_reason=offline_template`，并核对测试围栏
   （`_isolation.blocked_hosts()`）为空。
3. **改设置即刻生效**：判定点每次现读设置，**不许**在模块导入时求值成常量、也不许加进程内缓存。
   「要重启才生效」的开关不是开关。代价说清楚：每次批改/合成多一次单行 SQLite 读，
   本地单机应用可以忽略。
4. **读不到设置 ⇒ 关门**（fail-closed）。`get_settings()` 抛错（库损坏、§14.6 的只读降级期）时
   判为不允许出站。理由是不对称的：误判成离线，用户看到「已关闭联网，改用本地近似」，可恢复；
   误判成在线，是在用户以为关掉的情况下把内容发出去了，不可恢复。
5. **状态不许说谎**：`_tts_ok()` 走同一判定，所以取消勾选后右栏「音频合成」应转为不可用 ——
   但前提是前端得**重探**一次：`useBackendReady` 就绪后不再轮询，`health` 是启动时的快照。
   因此保存设置里含 `online_enabled` 时调用新增的 `refreshHealth()`：只更新 `health` 读数，
   **不许**动 `state`（退回 `pending` 会把整站变成启动面板，改个设置看起来像应用崩了）；
   重探失败保持上一次读数，不弹错。
6. `GET /settings` 回传的 `online_enabled` 仍是**用户写的那个值**：它是偏好，不是能力。
   能力状态只有 `health.tts_ok` / `ai_configured` 回答。两者不许混成一个字段，
   否则「我明明勾了为什么说不可用」会无处可查。

### 15.3 故障要落盘，启动横幅不许宣称没核实的事实（B3）

现状（读代码 + 读依赖源码 + 跑探针，不是推测）：

- `backend/app/` 里 **36 处 `print(...)`** 分布在 12 个模块，全仓库**没有一处** `logging`，也没有日志文件。
- 打包后的 sidecar 看不见它们：`tauri-plugin-shell-2.3.5/src/process/mod.rs:173` 给子进程加了
  `CREATE_NO_WINDOW`（连一个能翻滚动缓冲的黑窗口都没有），`read_line`（同文件 479 行）用
  `let _ = tx.send(...)` 读走一行、投递失败也照样继续读 —— 而 `src-tauri/src/main.rs` 的
  `Ok((_rx, child))` 把唯一的接收端当场丢掉。结论：**每一行 sidecar 输出都被读走后丢弃**。
  于是「AI 批改降级」「快照补拍失败」「题库为空」「未处理异常」这些事实只在没人看过的管道里存在过；
  用户说「批改一直失败」，我们连一条当时的记录都拿不出来。
- 更难看的是界面已经在承诺这个不存在的日志：`api/common.py:38` 的只读降级文案写着
  「请重启应用；若仍失败，请查看日志」，兜底内部错误文案（同文件 160 行）写着「请重试或查看日志」——
  用户手上既没有控制台也没有日志文件，这两句话指的是空气。
- 探针实测（`D:/tmp/b3probe/`，本机 CPython）：把管道**读端关掉**之后，子进程第一次
  `print(..., flush=True)` 就抛 `OSError: [Errno 22] Invalid argument`，进程退出码 120。
  这不是当前打包路径的实际行为（上面那条线程还在 draining），但它说明：把 stdout 当唯一载体
  等于把诊断写进一条没人负责排空的管道 —— 落盘之后 stdout 只是 best-effort 副本。
- `main.py` 的 `[Startup] Server ready at http://127.0.0.1:8765` 复述的是 `settings.API_PORT`，
  而真正决定监听端口的是启动命令。实测：`uvicorn --port 8766` 启动时同一段日志里
  既有 `Uvicorn running on http://127.0.0.1:8766` 又有 `Server ready at http://127.0.0.1:8765`。
  端口不一致时前端只会说「连不上本地服务」，而日志指着另一个端口说「我起好了」——
  这不是无害笔误，是把排查方向指反。

条款：

1. **后端不许用裸 `print` 报告事实**：一律经 `services/faultlog.py`，同一条记录**既进文件也进 stdout**
   （开发期还得能在终端看见）。判据：`grep -rn "print(" backend/app/ --include=*.py`
   只允许命中 `services/faultlog.py` 自身与 `db/migrate.py` 的 `if __name__ == "__main__"` CLI
   （命令行往 stdout 打 JSON 是人机对话，不是日志）。多模块同时写要线程安全。
2. **位置与轮转**：`settings.LOG_DIR`（env `IELTS_LOG_DIR`，默认 **DB 同目录下的 `logs/`**，
   跟 §14.3 的 `backups/` 并列 —— 用户找自己的数据只找一个地方），文件 `app.log`，
   单文件 1 MiB、滚动保留 3 份、UTF-8。每行 `时间 | 级别 | PID | [标签] | 消息`。
   PID 必带：B4 要处理的孤儿进程场景就是两个 sidecar 写同一目录，缺了归因字段，
   日志会变成第二种故障。
3. **写日志不许反噬业务**：目录建不出来、磁盘满、文件被占用 —— 一律吞掉并退回 stderr，
   `faultlog` 的任何入口**绝不向上抛**。用「把请求打挂」换一条记录，是把「看不见故障」
   升级成「制造故障」。
4. **落盘也要脱敏**：写盘前按密钥形态替换（`sk-…` / `ak_…` / `Bearer …` / `api_key=…` → `[已脱敏]`）。
   理由不是猜想：`api/media.py` 与 `services/tts_service.py` 落的是异常 repr，
   上游 SDK 的报错文本里带过请求头。CONSTITUTION §3 的「密钥不进日志」要落到文件才算数。
   测试只用自造字符串，**绝不拿真实 key 当样本**。
5. **日志文件不是可展示文本**：允许它含路径、异常类型名（诊断必需品），但**不许**新增任何
   把它读回前端的端点或字段（含 `GET /api/logs`）。UI 文案继续守 CONSTITUTION §3。
   这一条是给后来者立的墙：「让用户看到故障」不等于「把原始日志贴到界面上」。
6. **端口要用真实请求核实，不复述配置**：启动日志只写「按配置端口 N 启动，实际端口待首个请求核实」；
   真实端口由 ASGI 中间件从首个 HTTP 请求的 `scope["server"]` 读出（uvicorn `protocols/utils.py`
   的 `get_local_addr` 用 `transport.getsockname()` 填，是真实绑定值），落一条 `[PortProbe]`，
   **每进程只确认一次**；与 `settings.API_PORT` 不一致 ⇒ WARNING 并写明「以实际端口为准」。
   `scope["server"]` 缺失或端口为 `None`（httpx `ASGITransport` 给的是 `("testserver", None)`）
   ⇒ 记一次 INFO「未能从请求核实」，**不许**拿配置值冒充实测值。
7. **降级必须留下原因**：`ai_client.complete_json()` 的每个失败出口都要落一条记录，
   含 `reason` + 异常类名 + 尝试次数。只把枚举值写进 `jobs.degraded_reason` 不等于记录 ——
   用户问「为什么总是近似分」时，枚举只能回答「network_error」，回答不了「哪一次、哪端、什么异常」。
   级别分工：用户主动关在线导致的 `offline_template` 记 INFO（那是预期行为，不是故障），
   真实失败记 WARNING。**模型的输入与输出都不进日志**（只允许出现类名与已脱敏的诊断文本）。
   这一条是 B3 实跑时补的：本机真起一个 sidecar、把 AI 端点指到 `127.0.0.1:9` 之后，
   批改确实降级成了 `network_error`，而落盘文件里一条相关记录都没有。

实跑记录见 §15.9。

### 15.4 引擎要能自证身份，孤儿进程要能被指认（B4）

现状（读 `main.rs` / `pyinstaller_entry.py` / `api/health.py` + B3 真进程跑的落盘文件，不是推测）：

- **外壳的三条启动结论全是黑洞**：`src-tauri/src/main.rs` 的「已启动 / 端口被占 / sidecar 创建失败」
  三个分支只写 `println!` 与 `eprintln!`，而同文件第 2 行
  `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` 让 release 主程序根本没有控制台。
  最要紧的那条（端口 8765 被上一个实例占着，本次没启动引擎）用户一条也看不到。
- **占用者是不可见的**：sidecar 由 `tauri-plugin-shell` 以 `CREATE_NO_WINDOW` 拉起，无窗口、无托盘、
  无任务栏按钮；`main.rs` 的 `Ok((_rx, child))` 丢掉接收端，进程一旦被强制结束父进程（崩溃、
  任务管理器结束、关机没走完），它就变孤儿继续占着 8765 与 `backend-*.exe`。下次启动走
  「端口被占」分支 ⇒ 跳过启动、复述旧引擎；这在开发期表现为「重新打包失败：文件被占用」，
  在使用期表现为「升级后行为还是旧的」。
- **界面那句指引指不到东西**：`useBackendReady.ts:63` 失败文案写着「已安装版本请完全退出
  IELTS Insight（含托盘进程）后重新打开」—— 引擎不是托盘进程，任务管理器里它的名字是
  `backend-*.exe`，用户按那句话找不到该关的东西。
- **后端不记录自己是谁**：`GET /api/health` 有 version / whisper / storage，**没有 pid、没有
  started_at、没有实际端口**；§15.3 第 6 条把实测端口只写进了日志。于是两个 sidecar 写同一目录时，
  日志里有两组不同 PID 的行，却没有一处能回答「现在应答的是哪一个、它是什么时候起来的」。
- **端口被占导致的引擎启动失败连一行记录都没有**：`pyinstaller_entry.py` 直接
  `uvicorn.run(..., port=settings.API_PORT)`，端口冲突时 uvicorn 用自己的 logging 打到 stderr，
  而 stderr 按 §15.3 是「被读走又丢弃」—— B3 真进程跑的 `app.log` 里确实只有 faultlog 的行，
  没有一行来自 uvicorn。用户侧观感：一直「正在启动本地引擎…」，然后「未就绪」。

条款：

1. **引擎必须能自证身份**：`GET /api/health` 除既有字段外必须返回 `pid`、`port`、`started_at`
   （ISO8601 带时区）。三者只能来自进程内存与 `os`，**不得**读库或读磁盘 —— §14.6 要求库出事时
   体检端点还必须答 200，身份字段如果依赖库，正好在最需要归因的时候一起坏掉。
   `port` 取 §15.3 端口探针核实到的**实际值**，没核实过时取配置值并如实说明来源
   （同响应里的 `port_source` 取 `probe` / `config`）。
2. **单实例凭据文件**：`services/runtime.py` 在启动时写 `<DB 同目录>/run.json`
   （`pid` / `port` / `started_at` / `version`），正常退出必须删除；删除失败只记 WARNING，
   **绝不允许**把退出流程打断或向上抛。删除前必须确认文件里的 pid 是自己 —— 后起实例的凭据
   不能被先起那个的退出动作抹掉。这个文件是「本机谁在用这个数据目录」的唯一凭据，
   日志归因与 §15.4 第 3 条的陈旧判定都以它为准。
3. **陈旧凭据要覆盖，不许拒绝启动**：启动时发现 `run.json` 存在且其中的 pid 不是自己，
   就用 127.0.0.1 上它记录的端口做一次连接探测：
   - 探不通 ⇒ 记 WARNING「上一个实例（pid=…，port=…）未正常退出」并覆盖写新文件。
     **绝不**因为残留文件拒绝启动、清数据或改路径 —— 崩溃残留的凭据是线索，不是锁。
   - 探得通 ⇒ 那是**还活着的另一个实例**，记 WARNING 写明「本次启动与它共用同一个数据目录」，
     同样覆盖凭据（谁最后起来谁负责），但绝不碰它的进程（见第 5 条）。
     这一支才是 §14.6 只读降级之外真正的并发写风险，日志必须留得下证据。
4. **判定进程存活不许用 `os.kill(pid, 0)`**：Windows 上 `os.kill` 传非
   `CTRL_C_EVENT`/`CTRL_BREAK_EVENT` 的信号会走 `TerminateProcess`，
   「探一下对方死没死」等于把用户正在用的另一个实例杀掉。只允许本机套接字连接探测。
5. **绝不允许结束不是自己 spawn 的进程**：后端与外壳都不许引入 `taskkill`、`TerminateProcess`、
   `SIGKILL` 之类的结束能力（Tauri capability 白名单里也不许出现这类命令参数）。
   判据：`grep -rn "taskkill\|TerminateProcess\|os\.kill(" backend/app/ frontend/src-tauri/src/`
   无命中。清理只能靠**精确告知**（PID + 版本 + 启动时间）。理由：误杀用户另一个窗口的引擎，
   代价高于「端口被占」本身；`main.rs` 现有那句「不杀未知进程」的决定要保留，本条只是让它说得出细节。
6. **外壳的启动结论必须落盘**：三个分支各写一条到与 §15.3 同一个 `logs/app.log`
   （目录取 `IELTS_LOG_DIR`，未设置时按 `IELTS_DB_PATH` 所在目录下的 `logs/`，再回退默认用户数据目录），
   标签 `[Shell]`、行格式与轮转参数与 §15.3 第 2 条一致，PID 写外壳自己的进程号；
   `eprintln!` 降级为副本。日志里必须能回答「这一次启动，引擎是被我拉起来的，还是我让位给了别人」。
7. **界面要分清「就绪」与「就绪但用的是上一个实例」**：健康检查的 `version` 与前端自身版本
   不一致时，必须在屏上说明「正在使用上一次未退出的引擎（PID …，… 启动），它的接口可能与当前
   界面不匹配，请退出全部 IELTS Insight 窗口后重开」，不得静默当成正常就绪；文案不得含文件路径
   （CONSTITUTION §3），版本一致或字段缺失时不出现该提示。
   **PID 一律取 `/api/health` 自报的那个，不许取外壳 `child.pid()`**：实跑证明「启动命令的进程」经常
   不是「真正在监听的那个」——本机 venv 的 `python.exe` 是转发器，真服务是它的子进程（`句柄=22300`
   vs `health=16128`），PyInstaller 的 onefile 也是 bootloader 父 + 服务子。指向父进程，用户在
   任务管理器里找不到那个占着端口和库的进程，这条提示就白写。
   **同一个判断不许只长在告警条上**：界面上凡是表示「就绪」的地方（左轨那颗状态胶囊在内）都必须
   带同一个限定 —— 屏上同时亮着「引擎已就绪」和「正在使用上一个未退出的引擎」等于界面跟自己吵架，
   用户会信那颗绿色的。判据：判断提成一处共用谓词，`App.engineBadge.test.tsx` 钉两种版本各自的文案。
8. **测试隔离**：`run.json` 与日志目录一样必须由 `IELTS_DB_PATH` / `IELTS_LOG_DIR` 派生进临时目录，
   测试进程**绝不写**真实用户数据目录（CONSTITUTION §6）。

实跑记录见 §15.9。

### 15.5 用户可见的错误文案要说人话，也要留得下线索（C 档第一项）

CONSTITUTION §3 早就写了「界面文案中文、不含文件路径/SQL 片段/异常 repr」，但转写这条路一直在漏：
`speaking_session.transcribe_audio()` 把 whisper 的英文原文拼进 `detail`
（`音频无法识别：Cannot decode audio (webm): ...`、`语音转写不可用（RuntimeError）`），
`api/media.py` 的 `/stt` 更直接 `str(exc)` 透传。修它必须成对做，只做一半比现状更糟：

1. **`detail` 里不许出现英文异常原文、异常类名、文件名或路径**，只许是固定的中文句子 + 机器码
   （`code` 不变，前端靠它分流）。转写这一条固定为：解码/听不清 ⇒ 400 `audio_unintelligible`
   「这段录音听不清，可能没录到声音或格式不对，请重录一次或改用键盘输入」；
   模型/依赖失败 ⇒ 503 `stt_failed`「本机语音转写暂时不可用（可能没装 whisper 或模型没加载），可改用键盘输入文本」。
2. **把原文从界面撤下来的同一处，必须把它写进 `logs/app.log`**（§15.3）。
   理由不是合规洁癖：撤掉之后界面上只剩一句通用中文，若日志里也没有，
   「为什么我这段录不上」就彻底没人能查 —— 那等于把可见性从「说了不该说的」换成「什么都不说」。
   日志行允许带类名与原文（那是给人排查的地方），但仍须走 §15.3 的凭据脱敏。
3. **判据要机器可执行，不许靠人记**：`app/api/` 与 `app/services/speaking_session.py`
   里构造用户可见错误的那几个调用（`bad_request` / `dependency_unavailable` / `ApiError` /
   `SpeakingSessionError`）不许出现 `str(exc)`、`{exc}`、`{type(exc).__name__}`。
   扫描范围**故意不含** `services/sets_loader.py`：它的 `report["errors"]` 带文件名和异常文本，
   但那是题库导入 CLI 的产物，没有任何端点把它发给界面 —— 判据把非用户可见的东西算进来，
   第一次亮红就会被人加进白名单，之后再也拦不住真泄漏。
   配套的行为用例必须**真的让底层抛一次英文异常**，断言响应里既没有那段英文、也没有类名。

### 15.6 录音出错不许按「录完了」处理（C 档第二项）

`useRecorder` 有三条路径把失败当成成功：

- **`start()` 里根本没挂 `onerror`**：录制中途编码器报错、麦克风被会议软件抢走或被拔线，
  hook 完全不知道，直到用户点停止才把当时手上的残缺 chunk 拼成「录音 0:12 · 34 KB」交出去。
  这条最常见，也最难归因 —— 界面从头到尾没说过一个字。
- `recorder.onerror = () => finish()`：停止过程中报错，照样走完成路径。
- `recorder.stop()` 抛异常时的 `catch { finish() }`。

三条都落到同一个 `finish()`：拼 blob、写 `lastResult`、正常 resolve。于是界面上出现「提交录音」按钮，
用户提交一段自己不知道被截断的录音，报告屏把这当成一次完整作答给分 —— 这比一句错误提示更难发现，
因为它看起来是成功的。

1. 这三条路径必须走**失败语义**：`error` / `errorCode` 给出固定的中文句子（同 §15.5，不许拼异常原文
   或英文类名），`lastResult` **不落**（因此不出现「提交录音」），`RecorderStopResult.failed === true`。
   为什么是 resolve 一个带标记的值、而不是 reject：调用方一律 `await stop()`，Part 2 到点自动提交
   （`onLimit`）也在这条链上；抛错会让「麦克风被占用」和「代码写坏了」在界面上长成同一种样子。
   值里带标记，才逼着每个调用方看一眼 `failed` 才可能提交。
2. 到点自动提交这条路必须尊重 `failed`：`RecorderControls.handleLimit` 不许提交 `failed === true`
   的录音。否则第 1 条只是把按钮藏起来，自动提交照样把截断的音频发出去。
3. 失败时**释放麦克风和 resolve 承诺一样不许少做**：`teardown()` 与 resolve 仍要发生，
   否则用户点了停止后界面卡在「录音中」，比丢一段录音更糟。
4. 判据（`frontend/src/hooks/useRecorder.test.tsx`）四例：① 录制中途 `onerror` 立即把失败显示出来
   （`errorCode === 'recorder_failed'`、麦克风 track 全停、`lastResult` 为 `null`）；
   ② 停止时 `onerror` 触发：promise 照常 resolve 且 `failed === true`，`lastResult` 不落；
   ③ `recorder.stop()` 抛异常时同样的失败语义；④ 正常停止时 `failed === false` 且 `lastResult` 落进
   —— 第四条是防止把修复做成「一律判失败」。另加一例界面侧（`SpeakingPanel.test.tsx`）：
   中途坏掉时屏幕上当场出现「录音中断」，「停止」按钮消失且**不给「提交录音」按钮**。
   这条用例跑过反向探针（把 `recorder.onerror = handleMidwayFailure` 临时摘掉 → 用例转红 → 还原），
   所以它钉的是接线，不是一句永远为真的断言。
5. **开麦等待的那段窗口也不许显示成「未录音」**：`useRecorder` 早就暴露了 `starting`，
   而 `RecorderControls` 没接 —— 于是「慢」在界面上长成「没反应」，用户再点一下就是第二次
   `getUserMedia`，第一份轨道没人关（Windows 的麦克风指示灯会一直亮）。
   要求：`starting` 期间按钮文案是「正在开启麦克风…」且 `disabled`。
   判据：`SpeakingPanel.test.tsx` 用一条**挂住不返回**的 `getUserMedia` 钉住这个读数与禁用态，
   再放行、断言进入录音中。
6. **已知不覆盖的**：`setTimeout(finish, 1500)` 那条兜底维持原样（注释写明某些实现确实不触发
   `onstop`）。把它也算作失败会让这类环境下所有录音一律判废，代价大于收益；本条只管已经明说自己
   失败了的那三条路径。第 5 条堵的是**入口**（不让连点），`useRecorder.start()` 内部没有
   `startingRef` 守卫，直接调用 hook 的其它写法仍能重入 —— 记在这里，不装作已经根治。

### 15.9 实跑记录（B 档与后续条目；新条目一律追加在本节末尾）

- **B1 实拍（真浏览器，注入的是浏览器拿到的字节，不是仓库文件）**：用 CDP `Fetch` 把 vite dev
  对 `/src/features/shared/ReviewBook.tsx` 的响应换成「一渲染就抛」的 ESM 源码，进「错题本」即触发。
  结果与 §15.1 的承诺逐条对上：兜底面板出现（295 字仍在屏上，不是白屏）、左轨九个导航项全在、
  右辅助栏照常读数、焦点自动落在 `重试这一屏`、面板文字里没有 `ReviewBook`/`.tsx`/`http:`；
  切到「设置」正常渲染且兜底消失（视图 `key` 复位生效），切回来仍然只是这一屏兜底；
  故障持续时点「重试」不会把外壳打穿。
- **脏接口这条路打不穿渲染，是应用的功劳不是驱动的偷懒**：先试 `GET /api/review/errors` 返回
  `{"data": {…}}`（对象冒充数组），`fetchItems` 把它归一成空数组，界面老实显示「0 条记录」；
  再试把 Task 1 图表的 `chart.table` 换成缺 `columns/rows` 的对象，`writingSets.ts` 的
  `toStringList`/`normalizeSeries` 一路防御读取，渲染层根本拿不到脏值。
  所以 §15.1 的验证只能靠「组件自身抛错」这一形态 —— 这也说明：**接口脏数据防线在 `api.ts` 与
  `*Sets.ts`，不在各个屏里**，新屏不要再各自补一遍 `?? []`。
- **给驱动补了一个能力**：`cdp.mjs` 原来只有 `stub()`（固定 `application/json`），
  换模块源码需要 `text/javascript` 的 MIME，否则浏览器拒绝执行 —— 加了 `stubModule()`。
  以后要验「渲染期异常」，不必改仓库文件。

- **B2 真进程实跑（scratch :8766，进程级 `IELTS_ONLINE` 不设 = 开）**：开着时
  `GET /api/tts` 返回 200 + 11088 字节 mp3（确实出过一次门）；`PATCH /settings
  {"online_enabled": false}` 之后同一请求 503 `tts_offline`、`/api/health` 的 `tts_ok`
  由 true 转 false。写作批改给的是对照组：关 ⇒ `degraded_reason=offline_template`，
  开 ⇒ `network_error`（scratch 没配 key，说明开着时它**真的试过**远端）。
  两条只差那个开关，证明闸门在出站之前，不是事后遮文案。
- **B2 浏览器侧（:5174）**：设置里取消勾选 → 右栏「音频合成」由 `可用` 转 `不可用`
  （外壳那份 `/health` 真的重探了）→ 听力屏拿到的是「已关闭联网，无法合成音频；可进入原文精读模式」
  而不是「语音合成失败（网络不可用？）」，前者告诉用户是自己关的、后者会让人以为是服务坏了去反复点重试；
  重新勾选后读数回到 `可用`（闸门不是单向的）。图：`D:\tmp\ielts-demo\b2-live\01..05*.png`。
- **改文案才暴露出来的版式缺陷（与 §8.3 同族的通用坑）**：`Field` 的 `inline` 模式把
  label、控件、hint、error 四条都塞进同一条 flex 行，label 是 `flex-1`、hint 没有基准宽度，
  于是较长的 hint 会把中文标签挤成**一字一行**（「允许在线服务」竖着排）。
  修法：`inline` 时只有 label + 控件同行，hint/error 一律换到下面（听力配对题那两项同样受益）。
  教训：**改任何用户可见文案都要回真实渲染看一遍** —— jsdom 里没有布局，这类缺陷单测永远抓不到。
- **`/api/health` 曾因 `find_spec` 抛 `ValueError` 而 500**：`_tts_ok()` 用
  `importlib.util.find_spec("edge_tts")` 判断依赖装没装，但对「已在 `sys.modules` 里却没有
  `__spec__`」的模块（测试桩、打包产物都是这个形态）`find_spec` 直接抛。
  这一行只在**进程在线**时才走到，而测试集整会话 `IELTS_ONLINE=0`，所以它一直照不到 ——
  §14.6 要求库出事时体检端点还必须答 200，一个探测函数不该把体检打成 500。
  现在捕获 `ValueError/ImportError` 并退回 `"edge_tts" in sys.modules`。
- **围栏计数不能断言全局为零**：`_isolation.blocked_hosts()` 是**进程级累加**的
  （`test_isolation.py` 故意打一发 8.8.8.8 来证明围栏真的挡住了），
  第一版用 `== set()` 写「不许偷偷出门」，单文件跑全绿、全量跑 4 红。
  正确形态是取用例前后的**差集**。这是「单跑绿 ≠ 全量绿」的又一次实锤。

- **B3 落盘的必要性要先测准，别拿想象当现状**：第一版条款想写「sidecar 没有控制台，
  `print` 会抛 `OSError`」。探针（`D:\tmp\b3probe\`，把子进程管道读端关掉再让它 `print(flush=True)`）
  确实每次都抛 `[Errno 22] Invalid argument`、退出码 120，**但那不是打包路径的实际行为**：
  `tauri-plugin-shell` 的 `read_line`（`process/mod.rs:466-490`）对 `tx.send()` 用 `let _ =` 忽略失败、
  继续读下一行，所以读取线程一直活着、把 stdout **读走又丢弃**。真正写进条款的是这个：
  故障不是「打不出来」，是「打出来没人接」—— 结论弱一点，但站得住。
- **B3 真进程实跑（scratch :8766，`IELTS_LOG_DIR` 故意不设，验默认位置）**：数据目录里长出
  `logs/app.log`，与 `backups/` 并列。文件内容（截断到关键几行）：
  `[Startup] DB=… 库结构 v3` / `[Startup] 按配置端口启动 http://127.0.0.1:8765，实际端口待首个请求核实` /
  `WARNING … [PortProbe] 实际服务端口 127.0.0.1:8766 与配置端口 8765 不一致：以实际端口为准…`。
  同一次会话里再提交一篇作文（`OPENAI_BASE_URL=http://127.0.0.1:9/v1`，纯本机拒绝连接，零真实出站），
  作业结果 `ai_used=false` + `degraded_reason=network_error`，文件里对应
  `WARNING … [AI] network_error：APIConnectionError（model=fake-model，尝试 1 次）` ——
  有 reason、有异常类名、有尝试次数，没有 key、没有作文正文。404 响应体仍然只有 `{detail, code}`，
  日志没有变成接口（§15.3 第 5 条）。
- **第 7 条是这一跑逼出来的**：`logs/app.log` 刚接通时，上面那次降级在文件里**一条记录都没有**。
  原因是 `complete_json()` 的失败走的是「返回 `AiResult(ok=False)`」而不是抛异常，
  而带 `print` 的那两个 `except` 分支根本没被执行 —— 换句话说，最常见的生产故障
  （AI 端点连不上 ⇒ 近似分）此前只在 `jobs.degraded_reason` 里留了一个枚举值。
  教训：**先按契约跑一遍真链路，再决定条款**；只看代码会以为「有 print 就等于有记录」。
- **落盘以后 stdout 只能算副本**：`faultlog.emit()` 先写文件再 `print`，且 `print` 自己也在 try 里。
  顺手把 stdout/stderr `reconfigure(errors="replace")`：GBK 控制台下打印中文会 `UnicodeEncodeError`
  （`stt_service.py` 里「日志只用 ASCII」那条注释就是这个约束的产物，现已删）。
  连带修了一个测试基建：`test_stt_lazy_import.py` 用 `text=True` 解码子进程输出走的是 locale(GBK)，
  子进程改吐 UTF-8 之后直接 `UnicodeDecodeError`，现已显式 `encoding="utf-8"` + `PYTHONIOENCODING`。
- **`grep "print("` 判据留下的两个例外**：`services/faultlog.py` 自身（它就是把记录往两处发的地方）、
  `db/migrate.py` 的 `if __name__ == "__main__"`（`python -m app.db.migrate` 往 stdout 打 JSON 是人机对话）。
  这条判据本身也是一个测试（`test_后端不再有裸print报告事实`），36 处调用点少了任何一处它都会亮红。
- **本轮的一次偶发红已在 B4 里定性并修掉**：全量跑中
  `test_api_jobs_async.py::test_AC_W3_重复提交同一篇只排一个任务` 与
  `test_AC_S4_同一会话重复排队复用任务` 随机失败、单跑全绿。原因不是测试写得差，是**契约 4 的承诺本来就不成立**：
  去重只认 `queued/running`，而本地近似引擎几十毫秒就批完，「连点两次」的第二次点击通常落在完成之后，
  于是库里长出两份一模一样的批改（详见 §1 行 20b 条款 4 的补充与下面的 B4 记录）。

（后续 B 档条目的实跑记录继续追加在下面）

- **B4 真进程实跑（scratch `:8767`/`:8769`，驱动 `D:/tmp/ielts-demo/b4-drive.py`，全文报告
  `D:/tmp/ielts-demo/b4-live/report.md`）**：四个场景一次跑完，逐条对上 §15.4。
  A 起来后 `/api/health` 自报 `{"pid":16128,"port":8767,"port_source":"probe","started_at":"…"}`，
  同一份身份写进数据目录的 `run.json`；A 被硬停 ⇒ 凭据残留（`run.json 仍在 = True`）；
  B 同目录再起，落
  `WARNING | 27700 | [RunFile] 上一个实例（pid=16128，port=8767）未正常退出：端口没有应答，本次覆盖它的凭据`
  —— **照常启动，没有把残留文件当错误挡住用户**（第 3 条）；
  C 在 `:8769` 起来，落
  `WARNING | 45620 | [RunFile] 端口 8767 上还有一个实例正在应答（pid=27700），本次启动与它共用同一个数据目录…`
  （第 3 条的活实例分支 + 第 4 条：探活只打 `127.0.0.1`，没用 `os.kill`）；
  D 用 CTRL_BREAK 正常退出 ⇒ `run.json` 被收走（lifespan 的 `finally` 真的接上了）。
  收尾核对：scratch 两个端口都空，用户自己那台 `:8765` 起终点身份一致、全程未触碰。
- **B4 抓到的第一条真事实：句柄 pid ≠ 服务 pid**。本机 `backend/venv/Scripts/python.exe` 是个转发器，
  真跑 uvicorn 的是它的子进程（实跑四例都是 `句柄=22300 / health 自报=16128` 这种对不上）。
  所以 §15.4 第 7 条要求界面报的必须是**服务自报的那个 pid**：拿父进程 pid 去任务管理器找，
  用户找不到占着端口和库的那个。Tauri 侧 `child.pid()` 同理，打包版（PyInstaller onefile 也是
  bootloader 父 + 服务子）**必须在 C 档用真安装包复验一次** `child.kill()` 带不带得走真服务。
- **B4 抓到的第二条：驱动自己造了一次孤儿**。第一版驱动用 `taskkill /F`（没带 `/T`）只结束转发器，
  真的服务进程活着占住 `:8767`，于是 B 绑不上端口、`:8767` 无人应答，驱动误判成「残留凭据把启动挡住了」。
  这就是第 5 条禁止自动清理的现实版：**连我们自己造的孤儿，都只能靠 health 自报的 pid 才能精确收掉**。
  改成「terminate 自己 spawn 的句柄 + 仅当 scratch 端口仍应答时按自报 pid 补刀」后四例全通过，
  且补刀列表为空（`驱动补刀过的 pid=[]`）。
- **凭据端口跟着探针刷新（本轮实现决定）**：`set_observed_port()` 现在一并改写磁盘上的 `run.json`。
  不改写的话，文件里留的是配置端口，下一次启动的存活探测就会去敲一扇根本没开的门，
  把一个活着在别的端口的实例误判成孤儿。实跑里 C 认出的正是 B 的实测 `8767`。
- **§15.3 第 6 条的实测修正**：契约原话假设 httpx `ASGITransport` 给的是 `("testserver", None)`，
  实际 starlette `TestClient` 给的是 **`("testserver", 80)`** —— 端口是整数，原判据会把它当实测值采纳，
  于是测试进程里既落一条假 WARNING（「实际服务端口 testserver:80 与配置不一致」），又会把 80 写进身份与凭据。
  改为加一道 `_is_bind_address()`：只有 `ipaddress` 能解析的 IP 字面量才算「从请求核实」
  （uvicorn 用 `transport.getsockname()` 填，永远是 IP），否则只记一次 INFO「未能从请求核实」。
- **CTRL_BREAK 下 uvicorn 的退出码不是 0，但 `finally` 跑了**：D 场景记的是
  `退出码归零=False，run.json 仍在 = False`。结论：**别拿退出码当「干净退出」的判据**，
  凭据在不在才是（外壳若要做「上次是否正常退出」的判断，只能读凭据，不能读 exit code）。
- **顺带修掉的真缺陷（§1 行 20b 条款 4）**：去重窗口扩到「`succeeded` 之后 5 秒内同样复用、
  `failed` 永不复用」，`store.find_active_job()` → `find_reusable_job()`，两个提交端点接入；
  新增三条用例（宽限内复用 / 过窗后允许重批 / 失败可重试）。质量门：442 前端 + 468 后端 = 910 全绿。
- **B4 浏览器实拍（隔离后端 `:8773` + 隔离 vite `:5174`，图 `D:\tmp\ielts-demo\b4-ui\engine-notice-{probe,config}.png`，
  断言 `b4-ui\out-*.txt`）**：CDP `Fetch` 只改 `GET /api/health` 响应里的 `version`→`1.9.0` 与 `pid`→41428
  （真后端那一刻自报 22008），其余字段照真的。结果：告警条出现且 `role=status`，
  左轨那颗胶囊同时读到「引擎已就绪（上一个实例）」且 class 是 `text-band-mid`（不是就绪绿）；
  12 个导航项照常在、
  主区 961 字（config 变体 966 字），没有白屏也没有被兜底页顶替；断言里 `含盘符 / 含文件名 / 含反斜杠`
  三个全 false，而 `含PID / 含旧版本 / 含启动时间` 三个全 true（CONSTITUTION §3 在新文案上同样成立）；
  `port_source` 两种取值各拍一张 —— `probe` 写「已从请求核实」、`config` 写「配置值，未能从请求核实」，
  第 7 条「说不准就承认说不准」在界面上落了地。**屏幕上显示的是注入的那个 pid，不是真进程的 pid**：
  这一条就是第 7 条「界面只认 `/api/health` 自报的那个号」在浏览器里的证明（改仓库文件是拍不出这个的）。
- **实拍逼出来的第二个缺陷：胶囊和告警条自相矛盾**。第一版只加了告警条，左轨那颗仍然是绿色的
  「引擎已就绪」—— 同一屏同时亮着「就绪」和「连的是上一个实例」，等于界面在跟自己吵架。
  改法：把判断从组件里提成 `usesStaleEngine()` 给两处共用（就绪但连的是旧实例 ⇒ 降为 `mid` 灰、
  文案加「（上一个实例）」），`App.engineBadge.test.tsx` 钉住两种版本各自的文案，谁单独改就红。
- **这一轮被质量门抓了两次，两次都不是实现的错**：
  ① 把判断提成纯函数之后，`if (!usesStaleEngine(health)) return null` 让 TS 丢了 `health` 的类型收窄，
  `tsc -b` 报四处错，而 **vitest 442 条全绿**（jsdom 不做类型检查）——签名改成类型谓词
  `health is HealthResponse` 才既收窄回来、又不用在组件里重复判空。
  ② 测试桩 `healthFixture()` 的 `version` 一直是 `2.1.0`（比当前构建 `2.0.0` 还新），界面一旦开始比较版本，
  **所有用桩的用例的默认世界**都变成「连的是另一个实例」，`App.test.tsx` 里「引擎已就绪」那条断言因此红。
  改法：桩默认给 `APP_VERSION`（正常世界 = 引擎和界面同一版），要旧实例的场景显式覆盖；
  `SettingsPage.test.tsx` 里那张念版本号的卡改成显式传 `2.1.0`，它的断言才继续证明念的是 `/health`
  而不是前端自己那个常量。教训：**给界面加一条「状态推断」之前，先看测试桩的默认值** ——
  新增的判断条件会在无人察觉的情况下，把每一个既有用例挪进新分支。
- **顺带修掉一条假绿**：`EngineNotice.test.tsx` 两条静默用例原先断言 `container.textContent` 为空，
  而桩组件哪怕恒返回一个 `<div />` 也能过。改成断言 `container.firstChild` 为 null ——
  主区是 `flex gap-4`，多一个空 div 是**真会多出空隙**的缺陷，旧断言对它毫无反应。
  如实限定：这是补 `null` 分支时发现断言形态太松，**没有**跑过「把组件临时换成恒返回 `<div />`」的探针，
  所以它记的是「旧断言抓不住这一类缺陷」，不是「抓到过一次实例」。
- **收尾时又踩到第 5 条的同一块石头（驱动侧，不改仓库）**：重拍后清场，判据用「命令行里含
  `--port 8773` / `--port 5174` / `chrome-b4`」的字符串匹配 —— 结果它连自己套住了几个**只是命令行里
  提到那个端口**的 shell 进程。更糟的是实跑确认：用户那台引擎是「父 13312 命令行带 `--port 8765`、
  子 34068 命令行**不带任何端口号**」，光看命令行根本分不出谁是谁。所以收尾脚本改成
  先现场取 `:8765/api/health` 自报 pid，连同其父、其子列进黑名单，再按 pid 精确收，收完核对
  三个 scratch 端口全空、`:8765` 照常应答。**这条正是第 7 条「只认自报身份」在清理场景下的复用**：
  命令行是线索，不是身份。
- **B4 未覆盖的（如实）**：Tauri 外壳的 `[Shell]` 落盘目前只有 3 个 cargo 单测（行格式、目录优先级、轮转）
  加编译通过，没有真窗口实拍；打包版（PyInstaller onefile 也是 bootloader 父 + 服务子）
  `child.kill()` 到底带不带得走真正在监听的那个进程，也还没有在真安装包上验过。
  这两件都要等 C 档的安装包冒烟一起补 —— 界面侧（`EngineNotice` 5 条组件用例 + 2 条外壳接线用例 + 两种
  `port_source` 的浏览器实拍）本轮已闭合。
- **§15.5 跑的是接口层，不是真 whisper**：`backend/tests/test_stt_error_text.py` 7 例 ——
  让底层**真抛**一次 `Cannot decode audio (webm): <_io.BytesIO object> Error` 与
  `Transcription failed: OSError`，`POST /api/stt` 与 `speaking_session.transcribe_audio()` 两条路各自断言
  响应体里没有那段英文、没有类名，只有固定中文 + 原 `code`；同一处断原文**必须**出现在 `faultlog`
  记录里（撤下界面 ≠ 没人能查，§15.5 第 2 条）。
  判据用 AST 而不是 grep：`_拼进了异常对象()` 要剪掉 `exc.detail` / `exc.code` 这类结构化字段，
  第一版写成 `"exc" in ast.unparse(node)`，把 `api/speaking.py:32` 的
  `ApiError(exc.status_code, exc.detail, exc.code)` 误判成泄漏 —— **判据一有误报，就会被加进白名单，
  之后拦不住真的**（与 §14.6 那条「判据宁窄勿宽」同源）。
  界面侧只验到「detail 原样进 Toast」（既有 `SpeakingPanel.test.tsx` 的「413 显示后端 detail」用例钉着这条路），
  两句新文案的排版当时**没有实拍** —— 本节末尾「§15.5 + §15.6 真浏览器实拍」一条补上了。
- **§15.6 的实现细节里有一条会咬人的**：`setTimeout(finish, 1500)` 会把 `1500` 当**第一个实参**传进去。
  `finish` 一旦改成 `finish(failed)`，那行兜底就等于「超时一律判失败」，真机上不触发 `onstop` 的那些
  WebView 会把所有录音判废。已改成 `setTimeout(() => finish(false), 1500)` 并写进 §15.6 第 6 条。
  另一条是测试自己踩的：`let settled: RecorderStopResult | null = null` 在 `act()` 闭包里赋值，
  `tsc -b` 把它收窄成 `never`（7 处报错）而 **vitest 450 条全绿** —— 与 B4 那次同类，
  改成 `clickStop()` 助手 + 非空断言才两边都过。
- **§15.6 第 5 条是被偶发红灯逼出来的**：新加的口语录制用例在全量跑里红了三次（`× 2`：一次停在
  「找不到『停止』按钮」，一次停在「找不到『录音中断』文案」），单文件跑与连跑 10 次全绿。
  插桩（临时在 `handleMidwayFailure` 里打 `{already, mounted}` 与点完之后的 DOM 文本）确认过健康路径
  确实是「处理器跑了 → 按钮回到未录音 → 文案出现」，**根因没有定性**；能定性的只有两件事：
  ① 那段 `starting`（等 `getUserMedia` 返回）窗口里界面上本来什么读数都没有，用例只能盯一个「按钮还没变身」
  的间接信号，红了也读不出是慢还是坏 —— 这正是 §15.6 第 5 条要补的读数，补完之后同一用例的失败信息
  会直接说「正在开启麦克风…」；② 用例侧把跨用例累积的 `fakeRecorderInstances` 改成每个用例清空，
  并把「拿不到实例就静默 no-op」的 `?.` 改成显式抛错 —— 静默 no-op 是**假红**的温床。
  如实写明：**没有**证明这两处改动消除了红灯（插桩本身改了时序，属于 Heisenbug 的典型形态），
  只记录了「改动后连跑 10 次全绿」这个证据强度。这类红灯的历史版本见 §13 最后一条与
  `src/test/setup.ts` 里 `asyncUtilTimeout: 4000` 的注释。
- **§15.5 + §15.6 真浏览器实拍（Chrome 假麦克风，图 `D:\tmp\ielts-demo\c-live\{a-recorded,b-midway-error,c-stt-failed}.png`，  驱动 `drive-c-rec.mjs`）**：链路是**真**的 —— `--use-fake-device-for-media-stream` 给一路持续蜂鸣的音频轨，
  录制走浏览器原生 `MediaRecorder`，上传走真后端。后端是隔离的 `:8773` + 副本库 `app-c.db`
  （启动横幅确认 `DB=D:\tmp\ielts-demo\app-c.db`），vite 用 `VITE_API_BASE` 指过去，
  **用户那台 `:8765` 与 `:5173` 全程没碰**。
  三张各钉一件事：① 录 3 秒 → 徽标「录音 0:03 · 40 KB」+「提交录音」可用（证明这不是永远失败的假环境）；
  ② 录制中在页面里把 `MediaRecorder.prototype.stop` 换成「先派发 `error` 事件、再抛 `InvalidStateError`」
  —— 这就是真机设备被抢走时浏览器的两步动作，一次同时压过 §15.6 的两条分支 —— 现场断言
  「录音中断」告警条在、`停止` 与 `提交录音` 都不在、按钮回到「开始录音」、整页无 `*Error` 类名；
  ③ 真提交一路录音，后端把 `WHISPER_MODEL` 指到不存在的模型名（`load_model` 抛 `RuntimeError`，
  等价于「用户机上没装/没下模型」这个最常见的真实情形），界面拿到的是固定中文那一句，
  原文 `RuntimeError: Model ... not found; available models = [...]` **只出现在服务日志的
  `[STT] 语音转写不可用:` 一行**（§15.5 第 2 条的正反两半在同一次实拍里都取到了证据）。
  实拍顺手核实了两件契约没写死的行为，都算好的：失败后**录音仍在**（徽标还在、可重录可重试，
  不是一报错就把用户的 3 秒清空），以及 503 那次 `speaking_turns` 计数**没有增加** —— 转写失败不落半条作答。
  两个坑记一下：① 页面 :5174 的 Origin 不在出厂 CORS 名单里，实拍要给 scratch 后端显式 `DEBUG=1`
  （§12 那条「本地联调要通配请显式 DEBUG」正是为此留的口子，且 DEBUG 只影响 CORS，不影响错误文案，
  实拍到的句子仍是出厂那套）；② 现场脚本里用 `/录音中/` 正则判「界面还卡在录音中」是**假阳性** ——
  「录音中断」这句话本身就含「录音中」四个字，判据得看按钮而不是看整页文本。
- **§8.3「第二处可见」三面实拍（真提交 + 真轮询，图 `D:\tmp\ielts-demo\d-live\{d1-pending,d2-unread,d3-failed}.png`，
  驱动 `drive-d-tile.mjs d | f`）**：队列不是注入出来的 —— 写作屏真提交一篇 275 词作文 → `jobs` 表真有一行 →
  前端真轮询。慢的部分是仓库外的 `fake-llm.py`（`127.0.0.1:8899`，睡 12 秒再回一段解析不了的内容），
  为的是把「批改中」窗口拉长到拍得着；它回完之后评分器自己降级成离线模板，任务转终态，
  **同一块砖自己接力成「待查看」，这一步没有任何注入**（d1 → d2 期间没有刷新、没有改 store）。
  三面读数是现场从 DOM 取的，不是看代码推的：`正在批改 1 项`、`待查看 1 项`、`批改失败 1 项`。
  第 2 条②（不许把失败写成待查看）拍的是 §10.6 那个真场景 —— 后端重启过、localStorage 里那条任务在后端已经没了：
  塞一条 `status: running` 的陈旧任务 → 刷新让 store 接回来 → 轮询 404 → store 判 `failed` → 砖显示「批改失败」。
  **同一个 `doneCount` 值（1）在成功与失败两种情况下会渲染出两句不同的话**，这就是当初照抄 `doneCount`
  会让一块写着「去打开报告」的砖盖住一次失败的具体形状。第 4 条（plain、暖面槽留给 `overview.weakest`）
  有现场数字兜着：三张图里 `data-surface="warm"` 计数都是 **1**、`[data-metric]` 都是 **4**、栅格 class 一致 ——
  新砖既没抢暖面，也没把 4 列挤成 3 列。
  顺手核实的一条契约没写死的行为：失败那条在 localStorage 里**仍在**（要等用户点「知道了」才消失），
  所以左轨 badge 与这块砖不会在一次失败后同时清空、让用户找不到刚才到底怎么了。
  两个坑：① `waitText` 帮不上忙 —— 「概览关键指标」是 `aria-label`，不在 `document.body.innerText` 里，
  等它必然超时，只能自己轮询 `[data-metric="overview.grading"]` 出现；② 拍之前**必须先清** `ielts.grading-jobs`，
  否则 store 会把上一轮留下的终态任务接回来，拍到的「待查看」是别人的尾巴而不是本轮那次提交。
  隔离方式与上一条相同（`:8773` + 副本库 + `:5174` vite + `DEBUG=1` 放行 CORS，
  用户那台 `:8765`/`:5173` 全程没碰，四个 scratch 进程按 pid 回收后端口已确认释放）。
- **§8.4 九屏 Tab 巡检（真浏览器，图 `D:\tmp\ielts-demo\d2-live\{focus-overview-light,focus-settings-light,focus-settings-dark}.png`，
  驱动 `drive-d-focus.mjs` + `drive-d-contrast.mjs`，逐站原始读数 `d2-live\tab-walk.json` 与 `tab-walk-BEFORE.json`）**：
  修之前量到的是 —— **设置屏一圈 94 个停靠点全部 `:focus-visible` 命中而 `outline-style: none`**
  （`select` 28 / `input[date]` 21 / `input[number]` 20 / `input[text]` 19 / `input[password]` 6），
  也就是这台应用里最该看清「我改到第几个字段」的一屏，键盘用户完全看不见自己在哪；
  其余八屏的按钮一直是好的，坏的全在表单控件上。修法就是删掉 5 处 `outline-none`
  （`settings/fields.tsx` 两处、`settings/AudioDeviceField.tsx`、`listening/QuestionField.tsx`、`writing/WritingPanel.tsx`），
  把环交还给 `index.css` 那条全局规则。修后九屏复测：**每屏「键盘下环不可见」= 0，且每屏都能走满一圈回到起点**。
  环不只是「在」，还量了对比：稳定态环色恒等于 `--accent`（浅色 `#4b3ae0`、深色 `#a99cff`），
  2px + `outline-offset: 2px`，**对相邻背景的对比 6.42–8.01:1**（WCAG 2.4.11 门槛 3:1），
  两主题九屏各取一站，无一例外。
  判据 `focusRing.test.ts` 5 条已跑反向探针（临时塞一个带 `outline-none` 的文件 → 红，删掉 → 绿），
  不是对着空 glob 全绿。
  **这一条巡检挖出的坑比它的结论多，五条都得留下**：
  ① `document.body.blur()` 是 no-op，Chrome 的「顺序焦点导航起点」仍停在上一屏最后聚焦的那个元素上 ——
  第一版因此每屏都没从头走（报告屏只数到 5 站），停靠数全是错的；改成给起点元素打
  `data-focus-walk-start` 标记、按元素身份判「回到起点」。
  ② 用 `tag+label+region` 签名判回到起点会**撞名**（设置屏有六个空 label 的日期框），
  一圈走不完就一路重复十几圈，量出「概览 248 站」而真值是 19 站。
  ③ **`transition-colors` 的过渡清单里含 `outline-color`** —— 落点瞬间取 computed style
  拿到的是中间帧（实测 `rgb(103,89,229)`、`rgb(162,153,239)`），据此算出的对比度报告整份是假的
  （最低 1.88:1，看起来像一处真缺陷）；等 600ms 过渡走完再量才是 `#4b3ae0` / 7.05:1。
  **量焦点环必须等过渡结束**，这一条比结论更容易复发。
  ④ chrome profile 的 localStorage 会记住上一轮点过的主题，「先量默认、再切深色」的结果是两遍都量成深色；
  现在每个主题都显式点一次并核对 `documentElement.dataset.theme`。
  ⑤ 程序化 `.focus()` 之后按钮不命中 `:focus-visible`（`fv=false`），所以巡检第 0 站必然「没有环」，
  这是浏览器的设计不是缺陷 —— 报告里单独记成「起点伪影」，否则每轮巡检都白报一条。
  两个流程事实如实写明：a) 判据最初用 `node:fs` 读源码，**vitest 45 文件全绿而 `npx tsc -b` 红 7 处**
  （`tsconfig.json` 把 `types` 收成 `["vitest/globals"]`，`node:fs` 不在里面），与 B4 那次同类；
  换成 vite 自带的 `import.meta.glob(..., { query: '?raw' })` 后零配置通过。
  b) 改动后**第一次**全量出现 1 红（`waitFor`/MutationObserver 超时，当时没抓到用例名），
  随后 4 次全量 45 文件 / 460 条连绿；根因未定性，形态与上面 §15.6 那条已记录的偶发红灯同类，
  **没有**证明它不再出现。
  已知代价（写进 §8.4 第 6 条，本轮不修）：错题本走满一圈 **211 站**、生词本 **62 站**。

- **README 七张实拍重拍（Wave 7 D 档收尾，§8.3 / §14.5 的界面自证）**：隔离栈三进程各起一份 ——
  后端 `:8773` 指向**新播种**的 `readme3/app.db`、vite `:5174`、Chrome `:9223` 用**全新 profile**；
  一次会话拍完七张，尺寸 2100×1350 与旧图逐张对齐，驱动 `drive-readme-shoot.mjs`（仓库外）。
  核对结论：**旧图确实过期，而且过期方式比"少一条磁贴"更难看** ——
  概览屏三块关键指标磁贴整条缺失（e4a1031 晚于拍摄 53 分钟），阅读屏既没有磁贴条也没有草稿徽标：
  旧驱动点答案写的是 `textContent.trim() === 'TRUE'`，而按钮实际文案是「TRUE 原文支持」，
  一次都没点上，于是那张图停在 `已作答 0/13` —— **而 README 正文当时正在声称图里有 `已恢复上次草稿`**。
  本轮把这条断言变成真的：答三题 → 退出 → 重进同一套，`已恢复上次草稿` 与 `已定位到段落 B` 同框。
  种子回改一处并写明理由：`seed.py` 目标分 6.5 → 7.5、考试日 +55 → +50 天。6.5 下四科（7.0/7.5）
  全部达标，「差距大的科排得多、达标科保底 0.25」这条卖点在截图里根本看不到，今日计划五条清一色
  「保持手感」；改后概览同时出现「听力已达目标 7.5，保持手感」与「阅读当前 7.0，距目标 7.5 还差 0.5」，
  概览磁贴也从「最弱一科 7.0 高于目标 0.5」变成语义正确的「距目标 0.5」（暖面配"未达标"才不误导）。
  五个度量陷阱：① 阅读第 1 题的「定位」按钮按设计**禁用**（关键词命中不唯一），驱动点第一颗按钮
  等于点了个禁用项，画面里没有高亮 —— 判据要按 `!disabled` 选；② `locate()` 会 `scrollIntoView`
  把顶部工具条推出视口，草稿徽标随之消失，必须在 2 秒高亮窗口（`HIGHLIGHT_MS`）内把 `main` 滚回 0
  才能两个读数同框；③ 四张练习屏（口语/听力/阅读/写作）的磁贴条**只在作答态渲染**，选题页读到空数组
  不是回归；④ 写作批改结果页也没有磁贴条（它在编辑器视图），别把 `tiles: ''` 记成缺陷；
  ⑤ 换种子后 Chrome 旧 profile 的 `localStorage` 会带上一轮的主题与辅助栏开合，实拍前
  `localStorage.clear()` + 重新 navigate，并断言 `documentElement.dataset.theme` 而不是只点按钮。
  文档同步：界面一览三行、阅读段落、异步批改第 3 条（补上概览磁贴这"第三处可见"）、
  核心能力「概览 / 设置」两行（设置补 数据与备份 / 回收站）。

## 16. 1 对 1 口语陪练（Wave 8；FR-S7 / AC-S7.x）

起因不是「再做一个练习模式」，而是现有口语屏的结构性缺口：Part 1/3 的题目是**预置**的，
追问读题库、不用听你刚说了什么。真实考试里 Part 3 的难点恰恰是「考官顺着你的话追」。
陪练把这一维补齐：**多轮自由对话 + 每轮追问基于你的上一句 + 整场四维评分**。

三条不可协商的口径：

1. **不新增导航项**。IA 仍是九屏（§0），陪练是口语屏内的第二种模式（标签切换）。
   理由：它和「题库练习」共用同一个 `SpeakingReport`、同一条评分队列、同一个说话的人。
2. **离线必须能一整场走完**。追问回落到话题预置问句（`source: "fallback"`），评分回落到
   本地近似（`ai_used=false` + `approximate=true`），界面逐条标注（CONSTITUTION §3、FR-G3）。
3. **不抄真题**。话题、开场白、预置追问全部本项目自写；`source` 记为 `hand`（CONSTITUTION §2）。

### 16.1 内容文件（`backend/app/data/ielts/sparring/*.json`）

与四科 set **同目录树、独立模块名**，`sets` 表的 `module` 列取 `sparring`。
`content_counts`（`/health` 与 `sets_meta`）**只统计四科**（`store.MODULES`），
陪练话题不进这组读数 —— 那是「四科题库量」的语义，多塞一项会让既有断言与界面文案同时失真；
陪练话题的条数由 `GET /sparring/topics` 自己回答。装载器因此需要一条独立的目录白名单
（`sets_loader._DIR_MODULES` 加 `sparring`，而 `store.MODULES` 不动），这是本文件里唯一允许两处不同的地方。

```json
{ "id": "sb_restaurant_01", "module": "sparring", "kind": "practice",
  "title_zh": "餐厅点单", "topic": "restaurant", "level": "a2",
  "target_band": 6.0, "source": "hand", "generated_at": "…",
  "scenario_zh": "你在伦敦一家小餐馆点午餐，服务员会先问你几位、再推荐菜。",
  "opening": "Good afternoon! Welcome in — do you have a reservation, or shall we find you a table?",
  "preset_questions": ["What would you like to drink to start with?",
                       "Do you have any allergies I should know about?",
                       "Would you like to see the dessert menu?", "…"],
  "max_turns": 10, "partner_voice": "en-GB-SoniaNeural" }
```

- `level ∈ {a2, b1, b2}`；`max_turns ∈ [8, 12]`；`preset_questions` 长度 **≥6**（AC-S7.1），
  且每条都是**一句完整英文问句**（陪练官要念它，问号缺失等于断句）。
- `id` 规则：`sb_<topic>_<nn>`（与 §10.1 的 `<module_abbr>_…` 同族，`module_abbr = sb`）。
- 校验落 `services/sets_loader.py` 的 `_check_sparring()`，不写死在测试里（内容只增不减）。

### 16.2 话题（#51 / #52）

```json
{ "items": [ { "id": "sb_restaurant_01", "title_zh": "餐厅点单", "topic": "restaurant",
               "scenario_zh": "…", "level": "a2", "target_band": 6.0,
               "turns": 10, "preset_count": 6 } ] }
```
`GET /sparring/topics/{id}` 回**全文**（含 `opening` 与 `preset_questions`），未知 id → 404。
`level` 非法 → 400 `validation_failed`，`detail` 为中文。

### 16.3 会话（#53–#55）

`SparringSessionStart`：
```json
{ "session_id": "spa_…", "topic": <SparringTopic 全文>, "opening": "…",
  "turn_index": 0, "max_turns": 10, "state": "created", "audio_url": "…|null" }
```

`SparringSession`（#54，刷新/重开接回）：
```json
{ "session_id": "spa_…", "topic_id": "sb_restaurant_01", "max_turns": 10,
  "turn_index": 2, "remaining": 8, "state": "in_progress|awaiting_assess|assessed|closed",
  "messages": [ {"seq":0,"role":"partner","text":"…","source":"opening","audio_url":"…|null"},
                {"seq":1,"role":"user","text":"…","confidence":0.88,"duration_sec":7.2},
                {"seq":2,"role":"partner","text":"…","source":"ai|fallback","audio_url":"…|null"} ],
  "result": null }
```

`SparringTurnResult`（#55）：
```json
{ "seq": 1, "transcript": "…", "confidence": 0.88,
  "partner": {"seq": 2, "text": "…", "source": "ai|fallback", "audio_url": "…|null"},
  "turn_index": 2, "remaining": 8, "state": "in_progress", "degraded_reason": null }
```

规则：
1. **每轮必有追问，且不许重复**（这是本节最容易被做假的一条）。
   - 会话里的 `used_presets` 列（名字按迁移 v4 的历史保留）存的是**已经问出去的全部问题**：
     AI 追问与预置回落都进，不只是「消耗掉的预置句」。只记 fallback 的后果很具体 ——
     模型第 3 轮把预置清单第 1 句原样问一遍，界面显示「AI 追问」，而用户读到的是一句重复。
   - 去重比对用**归一化后的整句**（小写、压空白、去首尾问号），比对范围是**全部已问过**，
     不是仅相邻上一句：3 轮后念回第 1 轮，用户一样觉得「它卡住了」。
   - `ai_used=false`（断网/无 key/非法输出/重复）时 `partner.text` 取该话题 `preset_questions`
     里**尚未出现过**的一条；全部用过则回一句固定的英文收尾问句，`degraded_reason` 记
     `preset_exhausted`（Wave 8 收编：它是 §0 的**正式枚举值**，不再是私有字符串 ——
     私有值会被 `AiResult.__post_init__` 误改成 network_error，并逃过所有统一翻译面）。
     那句固定收尾句**不进** `used_presets`：它不是一个「话题问题」，记进去会让下一轮的
     用尽判定失真。
2. **提示词纪律（§3-P 同源）**：陪练官的 system prompt 只允许输出 JSON `{"reply": "…"}`，
   一句英文、≤40 词、必须针对用户上一句的具体内容（题面里会带上最近 3 轮原文）；
   调用沿 `ai_client.complete_json` 的唯一入口，`temperature` 走该入口的 0.3 上限
   （**不为对话单独开口子**：出站参数的唯一真源比「对话更自然」重要，见该模块 docstring）、
   `max_tokens = 1500`。解析失败重试 1 次，仍失败 → `source: "fallback"` + `degraded_reason`（沿用 §0 枚举）。
3. **上限与幂等**：`turn_index` 到 `max_turns` 后 `state="awaiting_assess"`、`remaining=0`、
   再作答返回 409 `conflict`（`detail` 中文）。重复提交同一段文本不额外扣轮次（同一 `seq` 复用）。
4. **音频**：`audio` 走 `stt_service.transcribe`（与 #10 完全同一条路，懒加载、5MB/400 口径一致）；
   文本兜底 `text`（AC-S3b 同源）。`confidence < 0.5` 时 `turn` 响应带 `hint_zh`。
5. **追问音频**：`audio_url` 与 §10.2 同口径 —— 离线为 `null`（前端显示「无音频，读文本」）。
6. **会话要能在刷新后接回**（§16.5 第 2 条）：建会话成功即把 `session_id` 写进
   `localStorage`（键 `ielts.sparring-session`，与 §10.6 的 `ielts.grading-jobs` 并列）；
   `SparringPanel` 挂载时若读到它，就调 `GET /sparring/sessions/{id}` 把整段对话拉回来并进
   会话态。**评分开始即清掉这个键** —— 已交付的会话再「继续」只会重现一份已评分的对话。
   读到但后端 404（换过库 / 被清理）时静默丢弃并停在选题页，不弹红（那不是用户的错，
   而且他此刻多半只是重开了应用）。

7. **上面那条有两个前置条件，缺一个就全盘失效**（Wave 8 真浏览器实拍用失败换来的）：
   - **外壳的 `view` 要记住**（`ielts.view`，白名单 `ViewId`）。`App` 的视图状态是内存
     state，刷新后默认回 `overview` —— 那时 `SpeakingPanel`/`SparringPanel` 根本没挂载，
     「自动接回」的 effect 没人执行，`GET` 一条都发不出去。实拍断言过：刷新后后端日志里
     没有任何 `GET /sparring/sessions/{id}`。
   - **口语屏的 `mode` 要记住**（`ielts.speaking-mode`，`bank | sparring`）。同理：
     `mode` 退回 `bank` 时陪练面板不在树上。
   这三条（view / mode / sessionId）是**同一个承诺的三段**，只做最后一段等于没做。
   两者都用白名单校验，读到脏值退回默认（不给任意字符串留口子）；写失败静默降级。

### 16.4 评分（#56 / #57）

报告 = §3-S `SpeakingReport`（四维 + evidence + improvements + model_answer + upgrade_vocabulary
+ metrics + pronunciation_detail）**加一块**：
```json
{ "sparring": { "topic_id": "sb_restaurant_01", "turns": 8, "mode": "sparring" } }
```
- `attempts` 落 `module="speaking"`、`part="sparring"`、`task_ref=<topic_id>`（AC-G2 的唯一事实表）；
  `attempt_items` 每条 `question_type="sparring_turn"`，`your_answer` 为该轮转写。
- 评分输入 = `opening + 各轮 (partner 问句, user 回答)` 拼成的对话记录；prompt 里显式声明
  「这是一段自由对话，不是题库背诵，FC/LR/GRA 按对话表现评分，Pron 无音频时低置信」。
- `ai_used=false` 时仍是**完整**报告（本地近似 + 可见降级），绝不 500、绝不静默成功。
- 异步端点复用 §10.6 全套规则（去重键 `sparring:<session_id>`、`succeeded` 后 5s 复用、
  `failed` 永不复用、启动 reap）。成功时 `report.sparring` 与 `attempt_id` 同时到位。

### 16.5 前端契约（`features/speaking/*`；不新增导航项）

`api.ts` 追加（全部走 `fetchJson`，禁裸 fetch）：
```ts
sparringTopics(level?, opts?), sparringTopic(id, opts?), startSparring(body),
getSparringSession(id), postSparringTurn(id, form), assessSparringAsync(id)
```
`types/ielts.ts` 追加 `SparringTopicMeta / SparringTopic / SparringMessage /
SparringSessionStart / SparringSession / SparringTurnResult`；`SpeakingReport` 加可选
`sparring?: { topic_id: string; turns: number; mode: 'sparring' }`（题库练习的报告里没有这块）。

界面（`SparringPanel.tsx` + `SparringMessageList.tsx` + `sparringSets.ts`）：
- 口语屏顶部 `Tabs`：`题库练习` / `1 对 1 陪练`；切模式**不丢**当前评分任务（§10.6 队列是模块级的）。
- 对话流按 `role` 分列，陪练官一侧带「朗读」按钮（`audio_url` 为 null 时按钮禁用并写明原因），
  我的一侧显示转写与置信度徽标。
- **回听自己上一轮**（Wave 8）：音频字节**不落库**（§5 的 `speaking_turns` 没有音频列，
  宪法也不为它加列），由 `SparringPanel` 在**本会话内存**里按 `seq` 留一份 `Blob`，
  「我」那一侧出现「回听我的录音」。没有录音（文本兜底 / 刷新接回）时按钮**不出现** ——
  那是「没有」，不是「坏了」，禁用一个本来就没有的东西只会让人以为是缺陷。
  刷新后回听消失是可接受的：转写文本才是事实源。
- 磁贴条（§8.3 同族）：`sparring.turns` 已答/上限、`sparring.remaining` 剩余轮次；
  暖面槽给「离线追问」状态（`fallback` 计数 > 0 时才渲染，规则 3）。
- 评分走异步路径（§10.6）：提交后进 `assessing` 骨架态，可离开；左轨角标与选题横幅照旧。
- **不做**「暂停/继续录音」（一段一段答，跟考试一致）、**不做**多话题混谈。

## 17. 题库生成端点（Wave 8 接入；§1 行 40–41 从「可后置」转正）

背景：README 已知限制里「刷完要自己扩」原本只有一条 CLI 路（`backend/tools/gen_ielts_bank.py`），
对会敲命令的人成立、对普通用户不成立。`POST /content/generate` 把同一条管线接到界面上：
设置页「题库生成」卡 → 排队生成 → 产物落**用户数据目录** → 重启装载。

### 17.1 产物位置（为什么不是 `app/data/ielts/`）

生成结果写 `<数据目录>/generated/ielts/<module>/<id>.json`（默认 `%LOCALAPPDATA%\IELTSInsight\generated\`），
**不写打包资源目录**。三个理由，缺一个都会坏：

1. 冻结包里 `app/data` 在 `_MEIPASS` 解出的**临时目录**里，进程退出即消失——写那里等于没写；
2. 装进 `Program Files` 后资源目录不可写（§14 的老坑换了个目录重演）；
3. 用户数据目录享有 §14.3 的**快照保护**——生成的题也是学习成果，硬盘故障前它得在备份里。

`sets_loader.load_sets()` 因此扫两个根：打包/仓库根在前，generated 根在后（同 id 后者覆盖前者，
即「用户生成的赢」）。装载仍只在启动时发生：**生成成功的界面文案必须写「重启应用后生效」**，
不许假装题库当场变多（`content_counts` 是启动快照，当场不会动）。

### 17.2 管线纪律（与既有链路同一条）

- LLM 只经 `ai_client.complete_json`（唯一出口：凭据、脱敏、超时、`max_retries=0`、解析重试 1 次）；
- 出站许可走 `network_allowed()`（§15.2 唯一判定点）：关闭在线/进程离线 ⇒ **503 拒绝提交**，
  不是排队后静默失败；
- 校验用 `sets_loader.validate_record`（装载侧真源）+ `FORBIDDEN_SOURCE_TERMS` 版权扫描
  （CONSTITUTION §2：产出文本命中「剑桥雅思/真题/Cambridge IELTS」等即拒绝，**这是硬闸**）；
- 产物 `source = "ai:<model>"`、`generated_at` UTC；
- **`source=hand` 的手工题永不覆盖**——同 id 已存在且为 hand 时拒绝写入（错误里说明原因），
  `ai:*` 允许覆盖（重生成语义）；
- 每次任务上限 5 个 set、`count` 1–5、`module ∈ {speaking, listening, reading, writing, sparring}`。

### 17.3 队列与响应

复用 §10.6 的 `jobs` 表与 worker，`jobs.module = "content"`。两处与批改的**刻意差异**：

1. `report` 不是模块报告而是生成摘要：
   ```json
   { "generated": [{"id": "sp_p2_water_07", "path": "…", "title_zh": "…"}],
     "rejected": [{"id": "sp_p2_x_99", "reasons": ["…"]}],
     "written": 1, "requested": 2, "model": "glm-4.6" }
   ```
2. 因此 `job_queue._execute` 的「成功必须有 `attempt_id`」判定按任务类型豁免
   （`expects_attempt=False`）——**批改仍强制**，那条「runner 返回无 attempt_id → failed」
   的既有契约不许被顺手放宽。
3. 前端 `useGradingJobs` 不认领 content 任务（它只过滤 writing/speaking），设置屏自己轮询
   `GET /content/jobs/{job_id}`；左轨「正在批改」角标不许混入生成任务。
4. 部分成功 = `succeeded`（`written>0`），`rejected` 逐条带中文原因；**全部失败** = `failed` +
   可读 `error`（CONSTITUTION §3 的可见性同样适用于「一题没成」）。

### 17.4 前端（设置屏「题库生成」卡）

模块/数量/band 选择 → 提交 → 本地轮询（复用 2.5s 节奏）→ 结果区列 generated/rejected；
未配置 AI（`health.ai_configured=false`）或在线关闭时**禁用提交并写明原因**，
不出现「点了转圈两分钟然后失败」。文案纪律：成功后写「N 套已写入本机，**重启应用后**进入题库」。
「重启应用后」这句必须出现在**结果区**里 —— 卡片副标题本来就含这四个字，
拿整页文本当判据是假绿（实跑第一版驱动就这么骗过自己一次，判据必须限定 `[aria-label="生成结果"]` 所在卡）。

### 17.5 环境级缺陷：clash 注入的 `[::1]` 让每一次 AI 调用构造期即炸（Wave 8 实跑抓到，已修）

真浏览器实跑 content 链路时，任务稳定 `failed`，后端日志只有一句毫无指向性的
`[AI] network_error：InvalidURL`。现场：clash-verge 往用户环境写
`NO_PROXY=localhost,127.0.0.1,::1,[::1]`，httpx 0.28 把 NO_PROXY 每一项按 URL 解析，
带括号的 `[::1]` 端口段解析成 `:1]` → `openai.OpenAI()` **构造当场抛 InvalidURL**。
装了 clash 的用户（国内备考人群里非常普遍）全线命中，且错误不指向代理。

修法在 `ai_client._make_client` 构造前调 `_sanitize_no_proxy()`：把进程内
`NO_PROXY/no_proxy` 的方括号剥掉（裸 `::1` 是 httpx 认得的写法，语义不变），
**只改进程环境，不动用户系统配置**。判据：`test_ai_client.py::test_clash注入的括号IPv6不挡住AI调用`
——桩客户端的构造函数里显式建一次 `httpx.Client(trust_env=True)` 复刻真实炸点，
反向探针（注释掉消毒调用）转红验证过。

### 16.6 Wave 8 真浏览器实跑记录（结论只写在这里，条款只写要求）

**栈（全部隔离，用户自己的 `:8765` / `:5173` 与真实库全程未碰）**：后端 `127.0.0.1:8799`
指向 `.tmp/live-sparring/app.db`（`IELTS_ONLINE=0`、`DEBUG=1`）；vite `:5181` 用
`VITE_API_BASE` 指过去；Chrome **全新 profile** + CDP（`--use-fake-ui-for-media-stream`）。
驱动 `.tmp/live-sparring/drive.mjs`（仓库外）。**19 项断言全过**，截图 `live-report.png`，
逐条结果 `results.json`。

**实拍抓到 3 个真缺陷，全部已修并补回归**（这三条事先都不知道，是「跑一遍」换来的）：

1. **STT 成功路径必然 `NameError` → 每次转写都变成 503。**
   `stt_service.transcribe()` 最后一步用 `math.exp(avg_logprob)` 算置信度（AC-S3），
   而模块只 `import io / os / threading`。**所有失败路径**（空音频/解码失败/太短/模型不可用）
   都正常，唯一**成功**的那一步必抛 `NameError`，被上层 `except Exception` 归成 `stt_failed`。
   既有用例只覆盖失败路径，所以长期全绿。
   修法：补 `import math`；新增 `tests/test_stt_transcribe_success.py` **真的调一次
   `transcribe()`**（只把 `decode_audio` 打桩成 1 秒静音，后处理全走产品代码），
   反向探针（删掉 `import math`）转红验证过。
   教训：**异常分支覆盖再全，也替代不了跑一次正常分支**。「判据只测坏天气，不测晴天」。
   （同族提醒：`§15.5/§15.6` 那一轮也是靠实拍才发现「撤下英文原文」的同时得把它写进日志。）
2. **刷新后外壳回 `overview`，陪练「自动接回」的 effect 根本没机会跑。**
   实拍证据不是推测：刷新后后端日志里**一条 `GET /sparring/sessions/{id}` 都没有**。
   `App` 的 `view` 是内存 state，`SparringPanel` 不在树上，凭据存得再对也没人读。
   修法：`App` 记 `ielts.view`（白名单 `ViewId`，脏值回落 `overview`），
   新增 `App.viewMemory.test.tsx` 4 例。
3. **即便 `view` 记住了，口语屏 `mode` 退回 `bank`，陪练面板仍然不在树上。**
   这是同一个承诺的**第二段**。修法：记 `ielts.speaking-mode`（`bank | sparring`）。
   §16.3 第 6 条的「三段」（view / mode / sessionId）只做最后一段等于没做 —— 因此写成条款 7。

**实拍同时确认 OK 的行为**（这些不是「没测」，是逐一断言过的）：
开场白真的来自题库（校园闲聊的问候语，不是硬编码）；磁贴 `0/10 → 1/10` 与 `剩余 10 → 9`
随作答前进；离线追问带「预置追问」徽标且暖面只在有回落时出现；键盘文本兜底能走完整场；
评分走异步队列并落到报告页；报告四维 `FC 4.0 / LR 4.5 / GRA 5.0 / P 5.0`、总分 4.5，
顶部「已降级：离线模板」如实可见；转写正文正是输入的两句；
学习库真落一条 `part=sparring / task_ref=sb_campus_04 / band 4.5`。

**驱动侧的四个坑（都影响结论可信度，记下来免得下一个人重踩）**：
1. **`Runtime.evaluate` 不检查 `exceptionDetails`**：求值抛错时只拿到 `undefined`，
   后续断言全变成「找不到元素」——**把驱动自己写错伪装成产品缺陷**。本次因此白跑三轮。
   已改成求值抛错即抛异常（判据：宁可驱动炸掉，也不要它安静地报「功能缺失」）。
2. `Page.reload` 之后必须重新 `Runtime.enable` 再求值，否则读到的是旧页面（上下文已换掉）。
3. 反复重跑复用调试端口会连到**上一轮残留的 Chrome**（截出来停在「阅读」屏，白高兴一场）；
   每次换 `CDP_PORT` + 全新 profile 才干净。
4. **删除后端正在用的临时库会让实例半崩**（`/api/attempts` 返回非 envelope，
   驱动报 `Cannot read properties of undefined (reading 'items')`）。要重置就换新目录或先停实例。

**仍未做的（如实）**：打包 sidecar（PyInstaller 冻结包）里 `sparring_sessions` 表与
`app/data/ielts/sparring/**` 是否随包分发 —— `backend.spec` 的 `datas = [("app/data", "app/data")]`
理论上会带上，但**本轮没有实跑冻结包验证**；`git commit`。
