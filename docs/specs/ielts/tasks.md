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
