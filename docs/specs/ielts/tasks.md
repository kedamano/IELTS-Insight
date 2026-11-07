# TASKS — Agent 任务板与文件所有权

规则（CONSTITUTION §4）：**只改分配给自己的文件**。需要越界时先说明再动手。
每个 agent 交付时必须附：改了哪些文件、实际运行的命令与输出、仍未通过/未覆盖的点（不许隐瞒）。
禁止 `git commit`/`git push`（由主控在验收后统一处理）。

依赖波次：Wave 1（并行 6 个）→ Wave 2（并行 3 个）→ Wave 3（主控集成 + QA 转绿 + 打包）。

---

## Wave 1

### T1 `qa` — 测试基建 + 契约红灯（Task #6）
**owns**: `backend/tests/**`、`backend/conftest.py`、`backend/pytest.ini`、`backend/requirements-dev.txt`、
`frontend/src/test/**`、`frontend/vitest.config.ts`、`frontend/package.json`(仅 scripts/devDeps)、`scripts/check.sh`
**do**:
1. 落地 `test-plan.md §1` 六项基建修复。首要：`conftest.py` 在 import `app.*` 之前用 `IELTS_DB_PATH`/`IELTS_TTS_CACHE_DIR`/`IELTS_ONLINE` 环境变量指向 tmp；
   加守卫测试断言跑测试前后 `backend/db/app.db` 与根 `db/app.db` 的 sha256 不变（**当前它们每次 pytest 都被写脏**）。
2. 写 `test-plan.md §2` L1/L2 的**红灯测试**（允许因实现缺失而 fail，但不能因测试自身错误而 error）；
   文件头标注对应 `AC-*`。AI 全 mock，网络全禁。
3. 重写 `frontend/src/test/mocks/handlers.ts` 覆盖新契约端点，删除 payment/scene 相关 handler 与旧断言。
4. `scripts/check.sh`：`tsc -b` + `npm test` + `pytest -m "not integration"`，任一红即退出非 0。
**don't**: 不改 `backend/app/**`、不改 `frontend/src/{App.tsx,components,services,hooks,features}`。

### T2 `backend-core` — 配置/存储/API 骨架 + 删除死链路（Task #2 前半）
**owns**: `backend/app/config.py`、`main.py`、`api/**`（除 `api/{speaking,listening,reading,writing}.py` 留给 T8）、
`db/**`、`services/{scene_service,audio_service,payment_service}.py`(删除)、`models/**`(清理)、
`backend/requirements.txt`、`backend/app/services/__init__.py`（拆解后删除路由，只保留必要导出或直接删）
**do**:
1. `config.py`：补 `OPENAI_BASE_URL`/`OPENAI_MODEL`/`AI_TIMEOUT_SEC`；支持 `IELTS_DB_PATH`/`IELTS_TTS_CACHE_DIR`/`IELTS_ONLINE` env 覆盖；
   DB 默认路径改 `%LOCALAPPDATA%/IELTSInsight/app.db`（回退 `~/.ielts-insight/`），修掉相对 CWD 的坑。
2. `db/schema.sql` + `db/migrate.py`（旧库归档 `app.pre-ielts.bak` 后建新表）+ `db/store.py`（事务型 CRUD，路由不写裸 SQL）。
3. 路由从 `services/__init__.py`(514 行单文件) 拆到 `api/*.py`；实现
   `health / settings(GET,PATCH) / settings/ai-key(PUT,DELETE) / attempts(GET,DELETE) / progress(summary,trend,analytics) / plan(today,done) / review(errors,resolve,delete) / vocab(GET,POST,DELETE,export)`。
   PATCH 语义 = 未传字段保持原值（AC-C1）；key 永不明文回传（AC-C2）。
4. `services/sets_loader.py`：加载 `data/ielts/**` 进 `sets` 表 + 结构校验（不变量断言，不写死条数）。
5. 删除 `payment_service.py` + 两个端点（AC-X1）、`audio_service.py`（AC-X3）、`models/wrong_record.py:45`/`learning_record.py:36` 重复建表 SQL。
6. `api/{speaking,listening,reading,writing}.py` 先不建（T8 建）；但 `api/__init__.py` 里以注释外的正式方式聚合：
   用 `try: from api import speaking ... except ImportError: pass` **禁止**（会掩盖未完成）。
   改为：`api/__init__.py` 只聚合已存在的 8 个模块，T8 交付时由 T8 在同一文件追加 4 行 include（在 T8 的 owns 里明确授权）。
**don't**: 不碰 `tests/`（qa owns）、不碰 `data/ielts/**`（content owns）、不碰前端。

### T3 `content` — 雅思四科题库 + AI 生成管线（Task #3）
**owns**: `backend/app/data/ielts/**`、`backend/tools/**`、`docs/specs/ielts/content-notes.md`
**do**:
1. `backend/tools/gen_ielts_bank.py`：调 OpenAI 兼容端点按 `spec-contracts.md §2` 生成 set JSON，含 schema 自校验 + 字数/数量下限 + 失败重试 + 幂等（同 id 覆盖）；
   输出 `source`/`generated_at`。
2. 无 key 时的产出路径：手工撰写**原创**内容种子（Part 1 40 话题×3 问、Part 2 20 题卡+Part 3 各 3 追问、
   听力 6 set×20 题（含 `sentences[]` 与 `accepted_alternatives`）、阅读 6 set×13 题（800–950 词原创篇章）、
   写作 10 Task1（各带 `chart.data`）+ 10 Task2）。先交最低可跑量：口语 5 话题、听力 2 set、阅读 2 set、写作 Task1 2 + Task2 2，其余用脚本增量生成。
3. 严禁复制剑桥/官方真题原文（CONSTITUTION §2）；自查并在 content-notes.md 记录来源与校准状态。
4. 听力文本要适合 edge-tts 朗读（无特殊符号、数字可念），阅读篇章带段落 `label`。
**don't**: 不改任何 `.py` 业务代码（除 `backend/tools/**`）。

### T4 `ui` — 学术考试风设计系统 + IA 外壳（Task #4）
**owns**: `frontend/src/index.css`、`frontend/src/components/ui/**`、`frontend/src/App.tsx`、`frontend/src/main.tsx`、`frontend/index.html`、`frontend/src/components/**`（删除旧文件）
**do**:
1. `index.css` 换成 `spec-contracts.md §8` token；删掉 skeuo 全套类与装饰（螺丝/VU 表/黄铜按钮）。
2. `components/ui/*` 产出契约 §7 列出的原子件（`Button Card Tabs Badge Stat Countdown Bar Chart Sparkline ScoreBand Modal Field Toast`），
   每个都要有明确 props 类型 + 无障碍属性 + 只消费 token（组件内不写死 hex）。
3. `App.tsx` 重写为左轨 9 项 IA；未实现模块渲染 `<ComingSoon module=.../>`（Wave 2 会逐个替换）；
   删除 free/pro 门控、PRO 徽章、`UpgradePage`、`OnboardingModal` 假下载（AC-X1/X2、AC-C3）。
4. 删除被取代的旧组件与其测试：`SkeuoUI.tsx`/`SkeuoIcons.tsx`/`SceneList.tsx`/`UpgradePage.tsx`/`DialogueArea.tsx`/`ScorePanel.tsx`/`HeatmapScore.tsx`/`LearningReport.tsx`/`WrongBook.tsx`/`WordBook.tsx`/`WordPopup.tsx`/`SentenceParsePanel.tsx` 及同名 `.test.tsx`。
5. `index.html` title → `IELTS Insight`。
**don't**: 不改 `services/api.ts`、`hooks/**`、`src/test/**`、`src-tauri/**`。
**质量门**: `npx tsc -b` 通过；新 ui 组件有 vitest 测试（放 `src/components/ui/*.test.tsx`，这是你唯一可写的测试目录）。

### T5 `frontend-core` — 类型镜像 + API 客户端 + hooks（Task #5 前半）
**owns**: `frontend/src/types/ielts.ts`、`frontend/src/services/api.ts`、`frontend/src/hooks/**`
**do**:
1. `types/ielts.ts`：`spec-contracts.md §2/§3/§4` 的 TS 镜像（含 `band` 0–9 类型、`degraded_reason` 枚举、题型联合类型）。
2. `api.ts`：§7 列出的函数全部实现；`API_BASE` 单点定义（`import.meta.env.VITE_API_BASE` 可覆盖）；删 payment/scene 函数；
   保留 `fetchJson` 的中文错误文案与 `{data,total}` unwrap。
3. hooks：新增 `useBackendReady`（抽自 SceneList 重试逻辑，AC-G1）、`useApi`、`useTimer`、`useDraftAutosave`（AC-W2）、
   `useRecorder`（改：真实 `deviceId` 传入 getUserMedia，AC-C4；错误状态可理解中文）、`useTTS`（走 api.ts，支持 speed/accent）。
4. 移除对已删除组件的引用（若有）。
**don't**: 不碰组件、不碰 `src/test/**`（qa owns，但可新增 `hooks/*.test.ts` 之外的你自己的 `services/api.test.ts`? 否 — api.test.ts 由 qa 写，你只写实现）。

### T6 `pkg` — Tauri 改名/权限/CSP + 构建脚本（Task #7）
**owns**: `frontend/src-tauri/**`（除 `binaries/*.exe` 二进制不动）、`scripts/build.ps1`、`scripts/dev.ps1`、`.env.example`、`README.md`、`backend/pyinstaller_entry.py`、`backend/*.spec`、`.gitignore`
**do**:
1. `tauri.conf.json`：productName `IELTS Insight`、identifier `com.ielts.insight`、version `2.0.0`、window title、`targets:["nsis"]`、CSP 放行 `https://*`（README 说明如何收紧到具体 AI host）。
2. `Cargo.toml` name→`ielts-insight`；sidecar 启动保持 `shell().sidecar("backend")`，加进程退出清理与端口占用检测（避免旧 exe 锁死）。
3. `capabilities/main.json`：核对麦克风在 WebView2 下的可用性；Tauri 无 mic capability 时，写 `docs/specs/ielts/mic-on-windows.md` 给出可操作方案（含失败时前端提示文案），不要假装加一个不存在的权限名。
4. `scripts/build.ps1`：PyInstaller（`--add-data` 带 `app/data`）→ 复制 sidecar → `npm run tauri build`；含"exe 被占用则先结束进程"的安全处理（只结束本项目进程）。
5. `.env.example` 补 `OPENAI_API_KEY/OPENAI_BASE_URL/OPENAI_MODEL/IELTS_DB_PATH`；根 `README.md` 从零写（首次运行、dev 起法、打包、测试命令）。
**don't**: 不改 `frontend/index.html`（ui owns）、不改业务代码、不实际执行完整 EXE 打包（Wave 3 做）。

---

## Wave 2（Wave 1 落地后）

### T7 `frontend-screens-A`
`src/features/speaking/**`、`src/features/listening/**`：口语全流程（题卡/双重计时/录音+文本兜底/四维雷达/发音细节折叠区 AC-V3/追问）、
听力（播放器 倍速 逐句重听/答题/检查/降级到原文精读 AC-L1b）。替换 App.tsx 中对应 ComingSoon（**授权追加/修改 App.tsx 内这两条路由的 import**）。
删除对应 ComingSoon；跑 `tsc -b` + `npm test`。

### T8 `backend-grade` — 评分引擎
`backend/app/services/{band_scale,answer_norm,ai_client,speaking_grader,listening_grader,reading_grader,writing_grader,offline_feedback,speaking_metrics}.py`、
`backend/app/prompts/**`、`backend/app/api/{health? no}` + **新建 `api/{speaking,listening,reading,writing}.py`** 并在 `api/__init__.py` 追加 4 行 include（明确授权）。
`stt_service.py` 改懒加载（test-plan §1）。实现 §3 全部评分契约、§3-B band 表（过 4 个锚点）、§3-P prompt 规则。
落地 AC-S2/S4/S5/S6、AC-L2/L3/L5、AC-R4/R5、AC-W3/W3b/W4/W5。T1 的红灯必须转绿。

### T9 `frontend-screens-B`
`src/features/reading/**`、`src/features/writing/**`（含 `ChartSvg.tsx` 五种图表）、`src/features/report/**`（概览/趋势/分析/计划/历史 attempt）、
`src/features/shared/**`（生词本、错题本、选词浮层）、`src/features/settings/SettingsPage.tsx`。
同样授权替换 App.tsx 中 5 条 ComingSoon。

## Wave 3（主控）
集成实跑（test-plan §4 七步）、残余红灯逐个修、`npm run tauri build` 出 EXE、真实浏览器点完四科、更新 `spec-product.md` 状态标记、提交。

**Wave 3 执行结果（2026-10-18）**：
- 前端 `tsc --noEmit` 无错误，vitest 29 文件 / 311 用例通过；后端 pytest 274 用例通过（`-m "not integration"`）。
- `scripts/build.ps1` 退出码 0，产出 NSIS 安装包；冻结 sidecar 用临时库实跑通过（`/health` + 新 set 判分），详见 `spec-contracts.md` §11.2。
- 真浏览器点击发现并修掉的缺陷记录在 `spec-contracts.md` §13（逐句重听时间轴、UTC 日期、设置页两处提示），均已补测试。
- **未做（需用户点头）**：安装器实装、GUI 窗口运行、`git commit`。T4–T7 的产出由主控在 agent 中止后接管完成，故本板任务以 TaskList 状态为准。

---

## Wave 8：1 对 1 口语陪练（FR-S7 / 契约 §16）

**为什么排在口语而不是新开一屏**：现有口语屏的追问来自题库，听不到考生刚说的话，
而 Part 3 最难的一维就是「顺着你的话追」。补的是口语屏内的第二种模式，不是第十个导航项。

| 项 | 落点 |
| --- | --- |
| 规格 | `spec-product.md` FR-S7 / AC-S7.1–S7.6 |
| 契约 | `spec-contracts.md` §16（端点 #51–#57、内容 schema、会话/评分形状、前端面） |
| 内容 | `backend/app/data/ielts/sparring/*.json` 6 个原创话题（A2×2 / B1×2 / B2×2） |
| 后端 | `services/sparring.py`（会话推进 + 追问回落 + 评分）、`api/sparring.py`、`prompts/speaking.py` 的陪练模板、`store.py` 的 `sparring_sessions` CRUD、迁移 v4 |
| 前端 | `features/speaking/SparringPanel.tsx` + `SparringTopicPicker` + `SparringMessageList` + `sparringSets.ts`；口语屏顶部 `Tabs` 切模式 |
| 测试 | 后端 `tests/test_api_sparring.py` 23 例；前端 `SparringPanel.test.tsx` 11 例 + `api.test.ts` 6 例 |

**执行结果（2026-11-06）**：
- 后端 `pytest -m "not integration"`：**498 passed**（新增 23）。
- 前端 `tsc -b` 无错误；`npm test`：**46 文件 / 477 用例通过**（新增 17）。
- 内容校验：`python tools/validate_ielts_data.py` 通过（42 个 set，其中陪练 6，0 错误 0 警告）；
  校验脚本已扩到第五个目录，并守住「预置追问必须是完整问句」这条离线兜底的前提。

**本轮顺带改掉的既有口径（不是新增功能）**：
- `test_drafts_api.py` 里 `store.SCHEMA_VERSION == 3` 是循环论证（多一次结构变更就得改这句），
  改成对着迁移表核「常量必须有一条同名步骤」，`test_迁移表连续且最后一步是草稿` 同步改成
  「草稿必须是第 3 步（已上线的步骤号不许挪）」。
- `RecorderControls` 新增 `textLabel` / `textPlaceholder` 两个可选 prop：陪练是**多轮**对话，
  而那个组件内部有「只能提交一次」的闸门；统一文案还会让两个模式在界面上长得一模一样。

**未做（如实）**：真浏览器点完一整场陪练（本轮只有 jsdom + 契约测试，没有实拍截图）；
打包 sidecar 里 `sparring_sessions` 表与内容目录是否随包分发（`backend.spec` 的
`datas = [("app/data", "app/data")]` 会带上，但没实跑验证）；`git commit`。

**Wave 8 第二轮（2026-11-06，收上一轮复盘里的 4 条）**：
- **去重范围太窄（真实缺陷）**：原来只比「与相邻上一句完全相同」，且 `used_presets` 只累积
  **fallback** 的追问。后果是模型第 3 轮可以把预置清单第 1 句原样再问一遍，界面显示「AI 追问」，
  用户只读到一句重复。改为：AI 与预置都进「已问过」集合，去重比对**全部已问过**的归一化整句。
  新增 3 条后端用例（念回更早问题 → `invalid_model_output`；AI 问过的句子进集合；预置用尽 → 固定收尾句）。
- **刷新丢会话**：`SparringPanel` 原来只在内存里存 `session_id`，webview 一刷新那场对话就找不回来。
  按契约 §16.3 第 6 条落 `localStorage`（`ielts.sparring-session`），挂载自动 `GET` 接回；
  404 静默丢弃；提交评分后清凭据。新增 3 条前端用例（接回 / 404 静默 / 评分后清）。
- **陪练评分口径未区分**：`speaking_grader` 原来题库与陪练共用同一段 `BAND_RULES`，
  模型会拿「没覆盖题卡三个提示点」扣 FC —— 而陪练里根本没有题卡。加
  `SPARRING_SCORING_RULES`，只在 `part="sparring"` 时追加。新增 1 条用例（正反两向都断言）。
- **顺手修**：`sparringHandlers.ts` 的 `SparringTopic` fixture 缺 `turns`/`preset_count`
  （`tsc` 报错，vitest 绿 —— 又一例「jsdom 不做类型检查」）；测试用例间共享 `localStorage` 导致
  后一个用例被前一个的 `session_id` 拖去 resume，`beforeEach` 里清掉。

质量门（第二轮）：后端 **502 passed**（+4）；前端 **46 文件 / 480 用例**（+3）；`tsc -b` 无错误。

**Wave 8 第三轮（2026-11-06，真浏览器整场实跑 D 档）**：
本项目的 DoD 第 5 项要求「在真实环境跑过一次」，本轮补上。栈全隔离（后端 `:8799` 临时库 +
vite `:5181` + Chrome 全新 profile + CDP），驱动 `drive.mjs` 在仓库外，**19 项断言全过**。

实拍**抓到 3 个真缺陷**（都不是测试能抓到的形态，全已修 + 补回归）：
1. **`stt_service` 用 `math.exp` 却没 `import math`** → 所有失败路径正常、**唯一成功的那一步
   必抛 `NameError`**，被归成 503「本机语音转写暂时不可用」。用户录音转写长期是坏的，
   而单测全绿（只覆盖失败分支）。修 + 新增 `test_stt_transcribe_success.py`（真的跑一次成功转写，
   反向探针验证过）。
2. **刷新后外壳回 `overview`** → 陪练「自动接回」的 effect 根本没挂载（后端日志实证：
   刷新后零条 `GET /sparring/sessions/{id}`）。修：记 `ielts.view`。
3. **口语屏 `mode` 退回 `bank`** → 同一承诺的第二段同样失效。修：记 `ielts.speaking-mode`。

质量门（第三轮）：后端 **505 passed**（+3）；前端 **47 文件 / 484 用例**（+4）；`tsc -b` 无错误。
实跑细节（含驱动侧四个坑与「为什么单测没抓到」）写进 `spec-contracts.md` §16.6。

---

## Wave 8 第四轮（2026-11-07）：用户遗留清单逐项修复

用户把复盘清单原样贴回并说「这些都帮我修复下」。逐项：

| # | 项 | 落点 | 状态 |
| --- | --- | --- | --- |
| ① | `preset_exhausted` 升为正式枚举 | 契约 §0 + `ai_client.REASON_PRESET_EXHAUSTED` + `types/ielts.ts` 的 `DegradedReason`/`DEGRADED_REASON_LABEL_ZH` + `test_ai_client.py` 枚举逐字相等守卫（防「实现私自加值」漂移） | ✅ |
| ② | CSP 收紧 | `tauri.conf.json` 去掉 `https://*`（AI 出网在后端进程，webview CSP 从来管不着它，通配只白放开网页侧出站面）；契约 §11 + README 同步 | ✅ |
| ③ | 回听自己上一轮 | `SparringPanel` 会话内存 `playback: seq→Blob`，`SparringMessageList` 的「回听我的录音」；音频**不落库**（宪法不为此加列），刷新后按钮不出现=「没有」而非「坏了」；契约 §16.5 + `SparringMessageList.test.tsx` 4 例 | ✅ |
| ④ | 陪练话题 6→10 | 新增外卖/银行/问路/主持会议（a2×3 / b1×3 / b2×2… 覆盖三档），`validate_ielts_data.py` 纳入下限与 `sb_` id 规则，manifest 收录 sparring | ✅ |
| ⑤ | 冻结包实跑 | `dist/backend.exe` 临时库实跑：10 话题随包、迁移 v4 建表、turn→assess→attempts 全链路 200；`tools/check_frozen_excludes.py` 逐个核对 excludes（判据坑：裸名字会误报，见 §11.3） | ✅ |
| ⑥ | 扩题库 | speaking +4（Part1 14 / Part2 8）、writing +2（Task1 6 / Task2 6），校验通过 52 set | ✅ |
| ⑦ | dictionary.json 来源 | `tools/rebuild_dictionary.py --check` 实测：词表 391/392 在 ECDICT（MIT），释义 170/231 逐字命中、61 条同义改写、音标为人工 IPA 规范化；`docs/specs/dictionary-provenance.md` + LICENSE-CONTENT §3 改写 | ✅ |
| ⑧ | onedir 布局 | `backend.spec` 认 `IELTS_PYI_LAYOUT`；`build.ps1 -Onedir` 产 `dist-portable\`，实测首启 **2.6s**；抓到并修掉 sidecar 运行时命名坑（`backend.exe` 而非 triple 全名，外壳 shelllog 实证）；build.ps1 的 BOM 又丢过一次、已恢复并在文件头写警告 | ✅（GUI 窗口冒烟留给用户双击） |

质量门（第四轮实测）：后端 **506 passed**（新增枚举守卫 1 例）；前端 **48 文件 / 488 用例**
（新增 `SparringMessageList.test.tsx` 4 例）；`tsc -b` 无错误；
内容校验 52 set 0 错误；`check_frozen_excludes.py` 全绿。

**仍未做（需用户点头）**：NSIS 安装器实装（会写用户系统）；`git commit`。
**已闭合**：打包版 GUI 麦克风——用户 2026-11-07 在便携布局里实测录音成功，
`--use-fake-ui-for-media-stream` 方案在真实窗口下成立（mic-on-windows.md 的悬案）。

---

## Wave 8 第五轮（2026-11-07）：用户报「dist-portable 双击打不开窗口」

对照实验定位根因（同一份 exe，三种位置两种结果）：留在工作区的 `dist-portable` 卡死
（进程活着、永不建窗口、`[Shell]` 一条不写）；`target\release` 与 `%TEMP%` 副本都正常。
**根因是目录权限**：便携目录从被 harness 沙箱接管过的工作区继承了
`Everyone:(I)(CI)(DENY)(DC)`，WebView2 在 exe 旁建不出用户数据目录，卡在环境创建。
处置：便携产物组装到 `%LOCALAPPDATA%\IELTSInsight\portable\`（实测窗口正常、渲染完整、
10 话题随包，截图 `docs/assets/screenshots/portable-window.png`）；`build.ps1 -Onedir`
加 ACL 探测警告；根因与实验写进契约 §11.4。

诊断中自己踩的坑也记在 §11.4：`icacls /inheritance:r` 会把 harness 沙箱自己的授权一并剥掉
（之后我的工具对该目录 Access denied，用户账户不受影响）——清权限只针对具体 ACE 增删。
