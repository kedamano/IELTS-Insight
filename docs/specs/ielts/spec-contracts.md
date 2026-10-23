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
  `degraded_reason` 枚举：`no_api_key` / `network_error` / `timeout` / `invalid_model_output` / `incomplete_dimensions` / `offline_template`。

## 1. 端点总表

约定：`module ∈ {speaking, listening, reading, writing}`。

| # | Method & Path | 请求 | `data` 响应 | 状态 |
|---|---|---|---|---|
| 1 | `GET /health` | – | `{version, ai_configured, ai_base_url_host, ai_model, whisper: {loaded, model}, tts_ok, content_counts: {speaking,listening,reading,writing}}` | 新 |
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
| 40 | `POST /content/generate` | `{module, count, target_band}` | `{job_id}` | 新，可后置 |
| 41 | `GET /content/jobs/{job_id}` | – | `{state, created, errors[]}` | 新，可后置 |

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
迁移策略：**不写迁移脚本**（个人本地数据，旧数据是剧本跟读记录，无保留价值）；启动时若检测到旧库文件，
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
- 麦克风在打包后的 WebView2 里能否真的授权**未经验证**（`docs/specs/ielts/mic-on-windows.md`），Wave 3 必须实测；口语屏必须有文本兜底输入（AC-S3b）以保证该风险不阻塞主流程。

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
  CSP `connect-src 'self' http://127.0.0.1:8765 https://<AI host>`（AI host 由构建期注入或写 `https://*` 并在 README 说明收紧方式）；
  `media-src 'self' blob:; img-src 'self' blob: data:; font-src 'self' data:`。
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
