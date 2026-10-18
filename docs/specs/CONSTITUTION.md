# CONSTITUTION — 项目不可协商原则

本文件是 `D:\work\项目\kecheng`（IELTS Insight 个人雅思备考桌面应用）的最高约束。
任何规格、代码、测试、构建与之冲突时，以本文件为准。修改本文件需要用户明确同意。

## 1. 产品定位

- **单人本地使用**。没有账号、没有多用户、没有服务器、没有遥测。
- **不做付费/会员/解锁**。原 v1.5 的 `payment_service`（`receipt.startswith("PAY-")` 即通过的假收据校验）
  与前端 `UpgradePage.tsx`（未被任何地方引用的死代码）属于本次要删除的范围，不保留、不改造、不加开关。
- 价值排序以「能否真的提高雅思分数」为唯一标准；不好用、看着爽的功能一律砍掉。

## 2. 内容合法性（硬约束）

- **严禁复制或改写剑桥雅思（Cambridge IELTS）、官方样题、真题的原文、听力录音文本、阅读篇章、写作任务题干**。
  题库必须为 AI 生成的原创内容，题型与难度对齐官方格式（Section/Part 结构、题目类型、字数、时间）。
- 引用官方 Band Descriptors 时只表述能力描述，不逐字搬运 PDF 原文。
- 生成脚本产出的每个 set 必须记录 `source`（如 `ai:glm-4.6`）与 `generated_at`，便于人工校准。

## 3. 本地优先 + 失败可见

- 核心流程（做题、计时、存记录、看趋势）在**无网络**下必须可用。AI 能力是增强，不是前提。
- **任何 AI 失败不允许被 `except` 静默吞掉后伪装成正常结果**。现有
  `backend/app/services/ai_review_service.py:126,155` 读取 `settings.OPENAI_BASE_URL/OPENAI_MODEL`
  （`config.py` 从未定义这两个字段）→ AttributeError 被吞 → 深度点评永远走离线模板，这就是反面教材。
  规则：降级可以，但结果对象必须带 `ai_used: false` 与 `degraded_reason`，UI 必须显示「近似分/离线模板」。
- AI 凭据（key/base_url/model）从 `.env` 读取，可被设置页覆盖存 `settings` 表；**绝不写日志、绝不出现在任何返回值或错误信息里**。

## 4. SDD 流程

- 无规格不编码。功能以 `docs/specs/ielts/spec-product.md` 的 `FR-n`/`AC-n` 为唯一验收依据；
  跨进程契约以 `docs/specs/ielts/spec-contracts.md` 为准，前端与后端**同时按契约实现**，不互相等待、也不互相猜测。
- 契约要改：先改 `spec-contracts.md`，再改代码，否则视为破坏契约。
- 每个 agent 只能改任务板（`tasks.md`）里分配给自己的文件；越界需先说明。

## 5. TDD 流程

- 每个可测的 AC 先写**失败测试**（红灯），记录失败输出，再实现到绿。禁止先实现后补测试来充当 TDD。
- 测试断言行为与契约，不断言实现细节（不测私有函数、不做快照大截图）。
- 评分/批改这类 AI 输出：契约测试 mock LLM 返回固定 JSON，只断言解析、校验、夹紧、降级路径；
  真实 LLM 质量单独用 `@pytest.mark.integration`（默认跳过，需 `RUN_INTEGRATION=1`）。

## 6. 测试隔离（曾因踩坑而升级为硬规则）

- **禁止让测试写入 `backend/db/app.db` 或根目录 `db/app.db`**。当前 `conftest.py` 在 `Settings` 已被导入后
  才设 `DB_PATH`，隔离是无效的；`load_scenes_to_db()` 在 startup 事件里跑，导致每次 `pytest` 都改真实数据。
  必须改为：`conftest.py` 在 **import `app.*` 之前**通过环境变量 `IELTS_DB_PATH`/`IELTS_TTS_CACHE_DIR` 指向 tmp 路径。
- 单测不得访问网络（edge-tts、OpenAI、模型下载）。`stt_service.py` 在模块导入时 `whisper.load_model()`
  必须改成懒加载（首次使用时才加载），否则 import 即拖入 torch。
- 写类断言永远跑在临时数据库/临时副本上，绝不跑在用户线上实例或用户真实数据上。

## 7. 完成定义（Definition of Done）

一个功能只有同时满足才算完成：
1. 对应 AC 的测试存在且通过（附实际命令与输出）；
2. `cd backend && python -m pytest -q` 与 `cd frontend && npm test` 全绿；
3. 无网络时可运行（AI 部分走可见降级）；
4. 用户可见文案为简体中文，术语（band/Part/Task 1）保持英文原样；
5. **在真实环境跑过一次**：启动后端 + Vite，实际点完该流程；不能只凭类型检查和测试通过宣称"能用"。

## 8. 不做的事

- 不引入新框架/新构建体系（保持 Tauri 2 + React 19 + Vite + Tailwind 4；FastAPI + 标准库 sqlite3）。
- 不为"未来可能"抽象；不留兼容壳、不留注释掉的旧代码、不留 `_unused`。
- 不把练习数据上传到任何地方。
