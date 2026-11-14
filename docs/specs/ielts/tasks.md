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

---

## Wave 8 第五轮（2026-11-07）：题库生成端点转正（契约 §17 / FR-CT）

用户追问「题库可以接入真实的题库吗」→ 答案是不能接真题（CONSTITUTION §2），但
「刷完要自己扩」的 CLI 门槛可以拆掉：`api/content.py`（§1 行 40–41，此前故意未注册）转正。

| 项 | 落点 |
| --- | --- |
| 规格 | `spec-product.md` FR-CT / AC-CT-1–5 |
| 契约 | `spec-contracts.md` §17（产物落点、管线纪律、队列差异、前端面、§17.5 环境缺陷） |
| 后端 | `services/content_gen.py`（生成管线）、`prompts/content.py`（schema 提示词唯一真源，CLI 改 import 它防漂移）、`sets_loader.generated_root()/load_roots()`（双根装载，generated 赢）、`job_queue` 泛化 `expects_attempt`、`api/content.py` 实现并注册 |
| 前端 | `features/settings/ContentPanel.tsx` + api/types；设置页接进 AI 卡之后 |
| 测试 | 后端 `test_api_content.py` 15 例 + `test_ai_client.py` clash 判据 1 例；前端 `ContentPanel.test.tsx` 8 例 |

**实跑抓到并修掉的真缺陷（§17.5）**：clash-verge 注入的 `NO_PROXY=[::1]` 让
`openai.OpenAI()` **构造期即抛 InvalidURL**，每一次 AI 调用都变 network_error，日志里只有
光秃秃一句 `InvalidURL`。装了 clash 的用户全线命中。修法：`ai_client._sanitize_no_proxy()`
构造前剥方括号（只动进程环境）；判据用「桩构造函数里真建一次 `httpx.Client(trust_env=True)`」
复刻炸点，反向探针（注释消毒）转红验证过。

**实跑同时抓到自己两个测试假象（都改掉了）**：①驱动扫整页文本找「重启应用后」——卡片
副标题本来就含这四个字，永远命中，判据改为限定在结果卡内；②驱动无条件点在线开关——
第二轮把上一轮点开的那个又关了，改为读状态幂等处理。

**端到端证据链（隔离栈 :8799 临时库 + fake LLM :8899 + vite :5182 + Chrome CDP）**：
UI 提交 → job succeeded → 产物 `generated/ielts/sparring/sb_atm_31.json`（source=ai:）→
**重启后端** → `[Sets] 文件 53 个，装载 53 条` → `GET /sparring/topics` 回 11 个话题
（「重启应用后生效」第一次被真跑证实，不是文案）。

质量门（第五轮）：后端 **524 passed**；前端 **49 文件 / 496 用例**（SettingsPage 那条
「两张卡」断言如实改为「三张写卡」并补 §17.4 依据）；`tsc -b` 无错误；内容校验 52 set。

**实跑范围（如实）**：端到端验过 sparring（UI 全链路 6/6）+ speaking/writing（API 直连，
产物重启后分别出现在 `speaking/sets` 23、`writing/tasks` 13、`sparring/topics` 11）；
**listening/reading 没真跑**——同一管线同一校验器，但这两种 schema 最重（20 题/13 题 +
篇章字数），模型输出不合格的概率也最高，`rejected` 路径恰好被它们喂了假合格产物之外的
真实样本还没测过。`git commit` 由主控处理。

**实跑同时抓到一条环境级真缺陷（§17.5，已修）**：clash-verge 注入的
`NO_PROXY=[::1]` 让 `openai.OpenAI()` 构造期即抛 InvalidURL，AI 调用全线变
network_error 且日志毫无指向性。修法为进程内消毒 + 复刻炸点的判据（反向探针验证过）。

---

## Wave 9 第六轮（2026-11-12）：mock_test 模拟卷 + 生成管线重 schema 真跑

用户点名「先做 mock_test 内容 + 前端闭环，再补 listening/reading 生成端点真跑」。

### ① mock_test 模拟卷（契约 §2-L / FR-L2 / AC-L2a、AC-L2b）

**阻塞点**：`validate_ielts_data.py` 的 `check_common` 显式拒绝 `kind != "practice"`
（文案还写着「mock_test 预留」），而 `sets_loader` 早已接受 `mock_test` —— 两边规则漂移。

| 项 | 落点 | 状态 |
| --- | --- | --- |
| 契约 | `spec-contracts.md` §2-L 新增「两种形状」表（practice/mock_test 的 section、题数、词数、句数、band 表）；§3-B 补 mock_test 换算；§10.1 改「一个 set 是 20 或 40 题」；`spec-product.md` FR-L2 增 AC-L2a/AC-L2b | ✅ |
| 校验脚本 | `validate_ielts_data.py`：`KINDS` 常量 + mock_test 分支（40 题 / 1100–1400 词 / 60–90 句 / `sections_covered=[1,2,3,4]`） | ✅ |
| 装载器 | `sets_loader._check_listening` 加 mock_test 不变量（题数/sections_covered/词数） | ✅ |
| 内容 | `li_mock_campus_01.json`：4 section × 40 题 / 90 句 / 1100 词，四种题型齐全 | ✅ |
| 前端 | `listeningSets.LISTENING_KINDS` 标签更新、`sectionsCoveredOf`、`ListeningSetPicker` 显示 `Section 1–2–3–4` 与 40 题、`testHandlers` 加 mock_test fixture 与 `mockBandForRaw`（LISTENING_40）、`types` 加 `sections_covered` | ✅ |
| 测试 | 后端 `test_validate_ielts_data.py` 6 例 + `test_sets_loader_mock.py` 5 例；前端 `ListeningPanel.test.tsx` 新增 3 例（列表筛选 / 40 题渲染 / 40 题档 band） | ✅ |
| E2E | `drive-four-skills.mjs` 第 11 项：切「模拟卷」→ 列表出现 40 题 → 进入渲染 40 题（**16/16 全过**） | ✅ |

**E2E 脚本自身修掉的 4 个坑**（跑起来才发现，都是既有问题）：
1. `APP` 常量写 5183 而 `run-e2e.sh` 起 5173；
2. 健康检查路径 `/api/health` 写成 `/health`（404）；
3. Windows 原生 curl 的 `-s` 退出码不可靠 → 改用 `-w '%{http_code}'`；
4. `IELTS_DB_PATH` 传了 MSYS 相对路径（`/tmp/...`），`store.quick_check()` 的
   `path.as_uri()` 直接 ValueError → 用 `cygpath -m -w` 转 Windows 绝对路径；
5. 清理逻辑 `Get-Process chrome | Stop-Process` 会杀掉用户自己的浏览器 → 改为按
   `--user-data-dir` 的 profile 精确匹配进程；
6. chunk 监听挂在 CDP 会话建立之前（否则前面几屏已加载完，判据必红）。

### ② listening/reading 生成端点真跑（§17）

**栈**：DSH 本地网关 `127.0.0.1:8326`（OpenAI 兼容）+ 临时库 + 隔离端口 8798；
脚本 `scripts/e2e/run-content-gen.sh`（提交 → 等终态 → **重启后端** → 验证 `content_counts`）。

| 模块 | 结果 | 证据 |
| --- | --- | --- |
| listening | ✅ succeeded，重启后 4→5 | 产物 `li_s2_green_haven_garden_01.json`，20 题 / 30 句，校验通过 |
| reading | ✅ succeeded，重启后 4→5 | 产物 `re_p_biomimetic_architecture_01.json`，914 词（声明=实际）、13 题、4 题型 |
| rejected 路径 | ✅ 真实样本 | reading 候选被拒：`word_count` 声明 836 实际 621（差 >15%）+ 题号缺失 |

**真跑抓到的两个环境级缺陷（都已修 + 补测）**：
1. **`MAX_TOKENS=8000` 对推理型端点是致命的**。gemini-3.8-flash 把隐藏思考算进
   `max_tokens`，8000 的预算整篇被切在 reasoning 阶段 → `finish_reason=length` → 全批
   rejected。修法：`content_gen.max_tokens_for(module)`，listening/reading 提到 30000
   （`test_api_content.py::test_重schema的生成预算大于轻schema`）。
2. **失败任务的 `report` 不落库**。`mark_job_failed` 只存一句「没有生成出任何合格的题目」，
   `rejected` 里逐条的中文原因全丢了，用户无从下手。修法：`mark_job_failed(..., report=...)`
   写 `report_json`（`test_api_content.py::test_生成全部失败时report含rejected原因`）。

**没通的部分（如实）**：`AI_TIMEOUT_SEC` 默认 120 对 reading 不够（实测 300s 才稳），
本轮靠环境变量绕过，**没有把默认值改成 300** —— 那会影响所有 AI 评分路径的等待上限，
属于需要单独权衡的取舍（见 README 已知限制 #5）。

---

## Wave 9 第七轮（2026-11-14）：内容扩产的吞吐修复

**问题**：内容量是最大短板（53 套），而扩题被三件事卡住：

1. **`content_gen` 调 `complete_json` 时没传 `timeout`** → reading 被全局
   `AI_TIMEOUT_SEC=120` 截断（实测 300s 才稳）。修法：`content_gen.timeout_for(module)`，
   listening/reading → 300s；**不动全局默认**（那会放宽所有批改路径）。
   判据：`test_api_content.py::test_重schema的生成超时大于全局默认`。
2. **没有批量扩题通道** → 一次点 5 套、手动等、手动拷产物、手动重建 manifest。
   修法：`scripts/e2e/bulk-gen.sh <module> <目标数>` —— 循环提交、失败重试、
   产物归集到仓库题库目录、重建 manifest、跑校验、报告成功率。
3. **模型输出偶发不合格**：`target_band` 被写成字符串 `"6.5"`、`id` 里带连字符。
   - `sets_loader._check_common` 原来只检查「数值时才越界」，字符串直接放行 →
     改为**必须数值**（判据：`test_sets_loader_mock.py::test_target_band是字符串时被拒`）；
   - `validate_ielts_data.py` 的 `bands` 排序遇到 str/float 混合会 `TypeError` 崩溃，
     把一条内容错误变成脚本自身崩溃 → 改为只收集数值型再排序。

**真跑结果**：`bulk-gen.sh speaking 20` —— 首轮 5 套里 2 套合格入库（22→24），
3 套被校验拒收（字符串 band / 连字符 id），后续轮次继续补足目标。
**这正说明「校验器是第二道闸」的价值：不合格产物不会进仓库题库。**
