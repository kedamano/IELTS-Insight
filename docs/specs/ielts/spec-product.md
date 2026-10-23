# SPEC — IELTS Insight 产品规格（四科全量）

状态：已实现（Wave 3）。本文件仍是验收唯一依据。命名 `FR-<模块>-n` 需求 / `AC-<模块>-n` 验收标准。
> 质量门实测：前端 29 个文件 / 311 用例、后端 274 用例全绿，`tsc --noEmit` 无错误。
> 尚未实机验证的 AC（安装器实装后的 WebView2 麦克风采集）见 `README.md` §8 与 `spec-contracts.md` §11.2；
> 其余对外依赖（AI 端点、edge-tts）的实测结论在 `spec-contracts.md` §12–§13。
模块代号：`G` 全局、`S` 口语、`L` 听力、`R` 阅读、`W` 写作、`P` 报告与计划、`V` 词汇与错题、`C` 设置、`X` 移除项。

## 0. 目标与用户

唯一用户：本机用户本人，目标是在规定考试日期前把总分提到 `target_band`。
每日使用场景：打开应用 → 看今天要练什么 → 做一到两个模块 → 看 band 与错因 → 关掉。
软件替换掉原「跟着剧本读对话」的定位：**从"练发音"变成"练考试"**。
发音仍是口语的一维，但不再是产品中心。

IA（左侧竖轨，顺序即优先级）：
`概览` · `口语` · `听力` · `阅读` · `写作` · `生词本` · `错题本` · `报告` · `设置`

## FR-G 全局

- **FR-G1** 启动：Tauri 拉起 PyInstaller sidecar（127.0.0.1:8765），前端在就绪前回退重试并显示"正在启动本地引擎"。
  - AC-G1 `SceneList` 现有的 15×2s 重试逻辑抽成共享 `useBackendReady()`，所有模块入口在就绪前禁用；超时显示可点的「重试」并暴露最后一次错误文本。
- **FR-G2** 每个模块练习必须产生一条落库的 attempt 记录（修复当前"没有任何接口写 practice_records/wrong_records/learning_records，统计永远是 0"的硬伤）。
  - AC-G2 做完任一模块的一次练习后调用 `GET /api/progress/summary`，`attempts_total` 与对应模块计数 +1，`last_practice_at` 更新。
- **FR-G3** 无网络可用：题目、计时、存库、趋势全部本地；仅 AI 评分与 TTS 合成音频需要网络，且按 CONSTITUTION §3 可见降级。
  - AC-G3 断网下进入阅读/写作模块能完整做完一次并把分数（离线近似分，标注「离线近似」）存进库。
- **FR-G4** 简体中文界面；IELTS 术语保留英文：`Band`、`Part 1/2/3`、`Task 1/2`、`Fluency and Coherence` 等缩写 `FC/LR/GRA/P` 首次出现给中文注释。
- **FR-G5** 统一分数语义：所有 band 为 **0–9，步长 0.5**（写作/听力/阅读允许 0.5 插值），与总分四舍五入到最近 0.5 的规则一致。禁止再出现 0–100 作为用户可见主分数。
  - AC-G5 任一结果视图主视觉只显示 0–9 band；0–100 原始分若需展示只能作为辅助小字（如发音 WER 派生的 0–100）。

## FR-S 口语（雅思最吃 AI 的一科）

流程：选题 → Part 1 快问快答 / Part 2 题卡 1 分钟准备 + 2 分钟独白 / Part 3 追问 → AI 考官语音提问（TTS）→ 用户录音 → Whisper 转写 → band 四维评分 + 逐句改进。

- **FR-S1 题库**：`speaking` set 分三部分。目标量：Part 1 40 个话题×3 问、Part 2 20 张题卡（含 3 个提示点 + 时长）、Part 3 每张题卡配 3 个追问；难度分层 `target_band ∈ {5.5, 6.5, 7.5}`。
  首轮落地量（下限，测试按此断言，写在 `backend/tests/conftest.py` 的 `CONTENT_FLOORS` 里，后续只增不减）：
  Part 1 ≥12 话题、Part 2 ≥6 题卡（每张必须有 Part 3 的 3 个追问）、听力 ≥2 set、阅读 ≥2 set、写作 ≥3 Task1 + ≥3 Task2。
  - AC-S1 `GET /api/speaking/sets` 返回 ≥1 个 set 且每 set 满足 `CONTENT_FLOORS` 中该模块的数量下限与字段完整性；`GET /api/speaking/sets/{id}` 结构符合契约 §2-S。**测试不得断言具体总条数**（内容会增量增长）。
- **FR-S2 考官会话**：创建 session 后逐题推进；每题给考官提问文本 + 音频；Part 2 有 60s 准备倒计时（可跳过）与 120s 独白倒计时（到点自动停止录音并提示）。
  - AC-S2 Part 2 计时到 120s 时录音自动停止、录音不可再续，界面进入"已用时 2:00"状态；`POST .../assess` 的 `duration_sec` 与实际录音时长误差 ≤1s。
- **FR-S3 录音链路**：复用 `useRecorder`（MediaRecorder，audio/webm），上传 `POST /api/speaking/sessions/{id}/turn`（multipart `audio`），后端 whisper 转写并回传文本 + 置信度。
  - AC-S3 无音频或 >5MB 时返回 400/413 且界面显示可理解的中文错误；转写置信度 < 0.5 时提示"录音可能不清晰，可重录或改用键盘输入文本"。
  - AC-S3b 提供「直接输入答案文本」兜底输入框（麦克风不可用时的考试练习不中断）。
- **FR-S4 评分**：LLM 按官方四维 `FC / LR / GRA / Pronunciation`（发音维度在无音频时用转写文本推断并标注为低置信）各给 0–9 band + 证据引用（引用考生原句）+ 总分；总分 = 四维平均后按 0.5 夹紧规则。
  - AC-S4 mock LLM 返回固定 JSON 时，`assess` 响应四维齐全、`overall` 等于平均后夹紧值、`evidence` 每条含 `quote`；mock LLM 返回非法 JSON / 越界值（如 band=12）时，实现必须夹紧到 0–9 并置 `ai_used=false` + `degraded_reason="invalid_model_output"`，不得 500。
- **FR-S5 反馈内容**：至少包含 3 条 `improvements`（问题→改法，附原句）、1 段 `model_answer`（比考生高一档的示范回答，150 词内）、`upgrade_vocabulary`（把考生用过的平庸词替换为 6.5+/7.5+ 搭配，来源须标注）。
- **FR-S6 考官追问**：Part 3 追问基于考生 Part 2 回答由 LLM 动态生成（无网络时用题库预置追问）。
  - AC-S6 `ai_used=false` 时 session 仍能完整走完，使用预置 `fallback_questions`。

## FR-L 听力

- **FR-L1 音频来源**：听力篇章文本存于题库，音频由 **edge-tts 按篇章合成并缓存**（复用 `tts_service` 的 MD5 缓存），避免引入外部音频版权与体积。两种口音可选：`en-GB-SoniaNeural`（英音）/ `en-US-GuyNeural`（美音）。
  - AC-L1 同一 set 第二次请求音频命中缓存（`X-Audio-Cache: hit` 响应头或 `cache_hit` 字段）。
  - AC-L1b TTS 失败（断网）时返回 503，界面显示"音频不可用，可看原文精读模式"并提供进入 transcript 的按钮，而不是白屏。
- **FR-L2 题型**：支持 `gap_fill`（填空，含字数上限 `word_limit`）、`multiple_choice`（A/B/C）、`matching`（选项列表可重复使用）、`map_diagram_label`（对 A/B/C 标签选择）。每 set 40 题结构简化为 **2 个 section × 10 题**（自学短练），完整 4-section 模拟卷作为 `kind: mock_test` 预留。
  - AC-L2 `POST /api/listening/sets/{id}/attempt` 对 20 题全部判分，返回 `correct/total`、每题 `expected`（含可接受变体 `accepted_alternatives`）、每题 `question_type`。
- **FR-L3 判分规则**：填空忽略大小写、前后空格、`a/an/the` 前缀、数字与日期多种书写形式（`20 October 2026` / `20/10/2026`）；超出 `word_limit` 直接判错并给原因 `over_word_limit`。
  - AC-L3 单测覆盖上述每种等价与超限用例各 ≥1 条。
- **FR-L4 播放器**：暂停/继续/回退 5s/逐句重听（按 `sentences[]` 时间轴锚点）/倍速 0.75×–1.25×/进度条可拖；听力练习中题目面板始终可见，播放中不显示答案。
- **FR-L5 band 换算**：Listening raw score → band 使用官方 40 题对照表按 20 题等比折算的线性表（20 题正确数→band 映射写入契约，可配置）。
  - AC-L5 20 题对 16 题 → band 7.0；对 13 题 → band 6.0（与契约表一致）。

## FR-R 阅读

- **FR-R1 题库**：每 set 1 篇 800–950 词原创篇章 + 13 题（`true_false_notgiven`、`multiple_choice`、`heading_match`、`sentence_completion`、`gap_fill`），限时 20 分钟。
  - AC-R1 `GET /api/reading/sets/{id}` 返回 `passage.paragraphs[]`（带 `label: A/B/C...`）与 13 题；篇章字数在 800–950 之间（生成脚本校验，不合格则拒绝入库）。
- **FR-R2 界面**：左右分栏（篇章可滚动、题目可滚动），题目可点击"定位到段落"高亮对应段；支持选中篇章文字加入生词本/做标记。
  - AC-R2 点击题号「定位」后对应段落高亮 2s 且滚动到可视区。
- **FR-R3 计时**：20 分钟倒计时，剩 3 分钟变红提醒；到点自动提交当前作答。
  - AC-R3 到点自动 `attempt` 提交，未答题记为 `correct=false, reason="unanswered"`。
- **FR-R4 判分与解析**：`heading_match`/`matching` 类允许选项重复使用；每题返回 `answer_location`（段落 label + 原文引用句）+ 中文解析 `explanation_zh`；`true_false_notgiven` 必须区分"文中未提及"与"文中反驳"。
  - AC-R4 对 13 题中判错每题都有 `explanation_zh` 且非空。
- **FR-R5 band 换算**：同 FR-L5，Academic Reading 40 题表折算到 13 题（写入契约表）。

## FR-W 写作

- **FR-W1 任务**：Task 1（150 词，图表描述：`line`/`bar`/`pie`/`table`/`dynamic_chart` 五类，图表数据存于 set，由前端本地渲染 SVG 图表——**不依赖外部图片**）；Task 2（250 词，`agree_disagree`/`discuss_both_views`/`advantages_disadvantages`/`problem_solution`/`two_part_question` 五类）。
  - AC-W1 `GET /api/writing/tasks?module=task1` 返回的每个任务含 `chart.data`（series/labels/unit/years），前端 SVG 渲染无外部资源；Task 1 图例与轴标签与 data 一致。
- **FR-W2 编辑器**：纯 textarea + 实时字数、用时、建议用时（Task1 20min / Task2 40min）、最低字数达线提示；本地草稿自动保存（防崩），提交后清空草稿。
  - AC-W2 输入中断（刷新）后回到模块能恢复草稿；提交后草稿清除。
- **FR-W3 批改**：LLM 按 `Task Achievement/Response`、`Coherence & Cohesion`、`Lexical Resource`、`Grammatical Range & Accuracy` 四维给 band + 总分；返回逐句 `corrections`（`{quote, error_type, explanation_zh, suggestion}`）、`upgraded_sentences`（≥3 句高档改写）、`structure_issues`（段落层面：是否回应题目、连接是否机械）、`model_answer`（范文，Task1 ≥150 词，Task2 ≥260 词）。
  - AC-W3 mock LLM 固定返回时上述字段齐全；LLM 返回少于 4 个维度 → 补齐缺失维度为 `null` 并 `ai_used=false, degraded_reason="incomplete_dimensions"`，不 500。
  - AC-W3b 字数未达标（Task1 <150 / Task2 <250）时，后端在结果里给硬性提示 `word_count_penalty`，不额外调用 LLM。
- **FR-W4 错误归类**：把 `error_type` 归入 `grammar / lexical / collocation / punctuation / spelling / task_response / cohesion`，写入 `review_items` 供错题本按类型统计趋势。
  - AC-W4 连续两次写作后 `GET /api/review/errors?module=writing` 能看到跨次的同类错误计数与最近出现的句子。
- **FR-W5 离线兜底**：无 AI 时给本地可算的近似反馈（字数、段落数、句长分布、连接词清单命中、`the/a` 缺失、重复词 top10、简单语法启发式），主分数标记 `approximate: true`。

## FR-P 报告与计划

- **FR-P1 概览页**：目标分 `target_band`、考试日倒计时、四科当前 band（最近一次）+ 趋势迷你折线、今日任务清单、总练习时长。
  - AC-P1 完成一次练习后概览的该科 band 与"上次练习"立即反映（进入页面时重新拉取）。
- **FR-P2 计划引擎**：按 `target_band` 与四科当前 band 的差距生成每日任务（差距大的科权重高），每任务指向具体 set；完成后该任务标记 done，未完成顺延。
  - AC-P2 若口语落后目标 1.5、写作落后 0.5，则今日 5 个任务中 ≥2 个为口语；`GET /api/plan/today` 稳定可测（同输入同输出，日期为唯一变量）。
- **FR-P3 报告页**：band 趋势（每科一条，0–9 轴）、按题型正确率（听力/阅读）、按错误类型分布（写作/口语）、练习时长热力（近 8 周）、口语高频问题词/音。
  - AC-P3 空数据时报告显示明确的空态文案，不出现 NaN/空白图表。
  - AC-P3b 页首为**摘要磁贴区**（Bento 栅格，契约 §8.1）：只允许放 `progressAnalytics`/`progressTrend`/`progressSummary` **已经返回的数值**，不得为凑磁贴新增后端字段或前端造指标（`by_question_type` 无 `module`，因此不拆「听力正确率 / 阅读正确率」两块）。磁贴区下方保留原有五块明细。
- **FR-P4 存档**：所有 attempt 可回溯（列表 + 详情），可删除单条（会重算趋势）。

## FR-V 生词本与错题本

- **FR-V1 生词本**：任意模块选中单词 → 加入（复用 `dictionary.json` + 词详情弹窗）；新增 `context`（出处句子 + 模块 + set id）与 `note_zh`；按 `collocation`（搭配）、`topic`（话题词）打标签；导出 CSV/Anki TSV（保留现有能力）。
  - AC-V1 从阅读选中一个词加入后，生词本条目含 `context` 与 `source_module: reading`。
- **FR-V2 错题本**：听力/阅读错题、写作错误句、口语低分句统一进 `review_items`，字段含 `module`、`error_type`、`question_type`、`quote`、`detail_zh`；按科/类型筛选；"已掌握"标记（手动，不再用旧的"连续 3 次 80 分自动掌握"）。
  - AC-V2 `POST /api/review/{id}/resolve` 后该条 `status=resolved`，筛选默认只显示未解决。
- **FR-V3 保留**：发音层面的单词/音标能力（`/word/{w}`、`/phoneme-tip/{p}`）从主流程降级为口语结果页里的"发音细节"折叠区。

## FR-C 设置

字段：`target_band`（0–9, 0.5 步长）、`exam_date`、`daily_goal_minutes`、口音（英/美）、AI 配置（`ai_base_url`、`ai_model`、`ai_key_present` 只读状态 + 「已配置/未配置」，key 本体存 `.env`，不在设置页回显）、TTS 语速、`show_chinese_hints`（是否在题目/反馈里显示中文解析）、`show_punctuation`、录音输入设备。
- AC-C1 `POST /api/settings` 部分更新：未提供的字段保持原值（修掉当前"未提供字段被重置为默认值"的行为，`__init__.py:495-501`）。
- AC-C2 `PUT /api/settings/ai-key` 写入 key 后，任何 GET 返回都只含 `ai_key_present: true`，不含 key 明文。
- AC-C3 原 `OnboardingModal` 的假模型下载进度（`OnboardingModal.tsx:48-61` simulated progress）改为真实的 whisper 首次加载状态（真实懒加载事件）或干脆删掉该步骤。
- AC-C4 `audio_device` 必须真正传给 `getUserMedia({audio: {deviceId}})`（修掉当前"存了但从不使用"）。

## FR-X 移除项（必须删干净，不留兼容壳）

- AC-X1 删除 `backend/app/services/payment_service.py`、`/payment/order`、`/payment/verify`、`models` 中相关引用、前端 `UpgradePage.tsx`、`api.ts` 的 `getPaymentOrder/verifyPayment`、`msw handlers` 中 payment handler 及其测试。
- AC-X2 删除 `scenes_free/pro` 的 free/pro 门控语义：`is_free` 字段与 `SkeuoProBadge`、SceneList 的 disabled 锁逻辑；内容全部本地可用。
- AC-X3 删除死代码 `backend/app/services/audio_service.py`（shells out ffmpeg，未被调用）、`models/wrong_record.py:45` 与 `learning_record.py:36` 中从未使用的重复建表 SQL。
- AC-X4 组件内 3 处绕过 `api.ts` 的裸 `fetch` + 硬编码 `127.0.0.1:8765`（`SettingsPage.tsx:40,71`、`SentenceParsePanel.tsx:39`、`UpgradePage.tsx:13,15`）全部改走 `api.ts`，端口只在 `api.ts` 一处定义（并由 `import.meta.env` 可覆盖）。
- AC-X5 原「剧本跟读」模块不作为主页保留；其录音/评分能力并入口语 Part 2 的"逐句发音细节"。旧的 `scenes_*.json` 在口语题库落地后删除文件与 `scene_service` 装载逻辑。

## 非目标（本轮明确不做）

多用户/云同步、真实考试预约对接、真题还原、社区分享、多语言界面、机考模拟的全真 UI、口语真人对练、题库付费。

## 已知外部阻塞（实测于 2026-10-18，主控验证记录）

**AI 端点不兼容：这是当前唯一阻塞「真 AI 评分」的问题，代码侧无法绕过。**
本机环境提供的凭据是 `OPENAI_BASE_URL=https://new.sharedchat.cc/codex`（Codex 专用配额中转）：

- `POST /chat/completions` → HTTP 200 但 **0 个 choices**，`id/model/usage` 全为 `None`（等价于空响应）；
  默认模型名 `gpt-4o-mini` 该端点也不提供，其 `/models` 只有 `gpt-5.4 / gpt-5.4-mini / gpt-5.5 / gpt-6-* / gpt-image-2` 等。
- 改用 Responses API → **403 `codex_access_restricted`：「请使用最新版的 codex 客户端或 codex cli 调用」**。

结论：这个端点只服务 Codex 客户端。伪装 Codex 客户端头去绕过服务商的访问限制不在本项目的做法里，
所以 **口语/写作 AI 评分必须换一把标准 OpenAI 兼容 key**（官方 `https://api.openai.com/v1`，
或任何提供标准 `chat.completions` 的中转/Ollama/LM Studio 本地模型）。
换上之前，应用按宪法 §3 明确降级：`ai_used=false`、`approximate=true`、
`degraded_reason="invalid_model_output"`，`detail` 现在会写「端点返回空响应（choices=0），请检查 OPENAI_MODEL…」，
UI 显示「离线近似」，四科流程本身仍可完整跑通（已实测：落库、判分、band、趋势、计划全部正常）。

代码侧已做的应对（2026-10-18）：`ai_client.complete_json` 对空响应短路返回可操作诊断而非笼统的"输出不是 JSON"；
`GET /health` 增出 `ai_model`，便于在设置页一眼看出配的是哪个模型。

