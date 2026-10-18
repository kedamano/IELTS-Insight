-- IELTS Insight — 唯一建表源（spec-contracts.md §5）
-- 列定义与契约一致；CREATE TABLE IF NOT EXISTS 仅为让 migrate 可重复执行（幂等）。
-- 任何路由/服务不得写裸 SQL：见 app/db/store.py。

PRAGMA foreign_keys = ON;

-- 题库（由 services/sets_loader.py 从 app/data/ielts/**/*.json 装载）
CREATE TABLE IF NOT EXISTS sets(
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  kind TEXT,
  target_band REAL,
  title_zh TEXT,
  topic TEXT,
  source TEXT,
  generated_at TEXT,
  data_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sets_meta(
  module TEXT PRIMARY KEY,
  count INTEGER
);

-- 唯一的练习事实表（修复 AC-G2「统计永远是 0」）
CREATE TABLE IF NOT EXISTS attempts(
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  task_ref TEXT NOT NULL,
  part TEXT,
  started_at TEXT,
  duration_sec REAL,
  band_overall REAL,
  band_sub_json TEXT,
  raw_json TEXT,
  ai_used INTEGER,
  degraded_reason TEXT,
  approximate INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attempt_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  item_ref TEXT,
  item_number INTEGER,
  question_type TEXT,
  prompt_ref TEXT,
  your_answer TEXT,
  expected TEXT,
  correct INTEGER,
  reason TEXT,
  time_spent_sec REAL,
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS speaking_turns(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  attempt_id TEXT,
  turn_index INTEGER,
  prompt_id TEXT,
  prompt_text TEXT,
  transcript TEXT,
  confidence REAL,
  duration_sec REAL,
  started_at TEXT
);

CREATE TABLE IF NOT EXISTS speaking_sessions(
  id TEXT PRIMARY KEY,
  set_id TEXT,
  part TEXT,
  state TEXT,
  current_index INTEGER,
  created_at TEXT,
  updated_at TEXT,
  result_attempt_id TEXT
);

-- 异步批改队列（契约 §1 行 20b/11b：提交即返回 job_id，用户可离开页面再回来轮询）
-- 不加指向 attempts 的外键：练习记录允许被用户删除，队列日志不该因此挡住删除。
CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  task_ref TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  attempt_id TEXT,
  report_json TEXT,
  error TEXT,
  degraded_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

-- 错题本（FR-V2）
CREATE TABLE IF NOT EXISTS review_items(
  id TEXT PRIMARY KEY,
  module TEXT,
  item_ref TEXT,
  question_type TEXT,
  error_type TEXT,
  quote TEXT,
  detail_zh TEXT,
  status TEXT DEFAULT 'open',
  first_seen_at TEXT,
  last_seen_at TEXT,
  seen_count INTEGER DEFAULT 1,
  resolved_at TEXT,
  source_attempt_id TEXT
);

-- 生词本（FR-V1）
CREATE TABLE IF NOT EXISTS vocab(
  word TEXT PRIMARY KEY,
  context TEXT,
  source_module TEXT,
  source_ref TEXT,
  note_zh TEXT,
  tags TEXT,
  created_at TEXT,
  phonetics_json TEXT
);

CREATE TABLE IF NOT EXISTS practice_minutes(
  date TEXT PRIMARY KEY,
  minutes REAL,
  attempts INTEGER
);

-- 计划引擎（FR-P2）
CREATE TABLE IF NOT EXISTS plan_tasks(
  id TEXT PRIMARY KEY,
  date TEXT,
  module TEXT,
  set_ref TEXT,
  reason_zh TEXT,
  done INTEGER DEFAULT 0,
  created_at TEXT
);

-- 设置（单行，id=1；json 内含私有字段 ai_key / ai_base_url / ai_model，永不回传）
CREATE TABLE IF NOT EXISTS settings(
  id INTEGER PRIMARY KEY CHECK (id=1),
  json TEXT NOT NULL,
  updated_at TEXT
);

-- 索引（非契约内容，纯查询性能；命名以 idx_ 前缀区分）
CREATE INDEX IF NOT EXISTS idx_attempts_module_created ON attempts(module, created_at);
CREATE INDEX IF NOT EXISTS idx_attempt_items_attempt ON attempt_items(attempt_id);
CREATE INDEX IF NOT EXISTS idx_sets_module ON sets(module);
CREATE INDEX IF NOT EXISTS idx_review_module_status ON review_items(module, status);
CREATE INDEX IF NOT EXISTS idx_plan_date ON plan_tasks(date);
CREATE INDEX IF NOT EXISTS idx_turns_session ON speaking_turns(session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key, status);
