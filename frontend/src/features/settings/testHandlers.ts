/**
 * settings/testHandlers.ts —— 设置屏自己的 msw 处理器（契约 §1 行 2–5、§4、§10.5 裁定 4）。
 *
 * 与 `src/test/mocks/handlers.ts` 保持独立（那个文件由他人并发维护），但规则按后端
 * `backend/app/api/settings.py` 复刻：
 * - `PATCH /settings` 只覆盖请求体里出现的键（未提供即不动，AC-C1），可写键白名单外一律 400；
 * - `ai` 子块只接受 `base_url` / `model`，回读时只暴露 `base_url_host`（AC-C2 的最小暴露）；
 * - `PUT /settings/ai-key` 无最短长度，规则只有非空 / ≤300 / 不含控制字符，机器码恒为
 *   `validation_failed`；响应只有 `ai_key_present`，绝不回传明文。
 *
 * 7g 追加 `createDataHandlers`（§14.3 / §14.4 / §14.8）：镜像 `api/backup.py` 与
 * `api/attempts.py` 的行为，包括「恢复前先落一份 pre-restore」「无快照时 purge 给 409」
 * 这两条安全门 —— mock 里不复刻它们，界面测试就是在测一个不存在的后端。
 */
import { HttpResponse, http } from 'msw';
import type { RequestHandler } from 'msw';
import { API_BASE } from '../../services/api';
import { APP_VERSION } from '../../version';
import type {
  AttemptSummary,
  BackupList,
  HealthResponse,
  Settings,
  SnapshotRow,
  TrashItem,
} from '../../types/ielts';

function ok<T>(data: T) {
  return HttpResponse.json({ data });
}

function fail(status: number, detail: string, code: string) {
  return HttpResponse.json({ detail, code }, { status });
}

export const WRITABLE_KEYS: readonly string[] = [
  'target_band',
  'exam_date',
  'daily_goal_minutes',
  'accent',
  'tts_voice',
  'tts_speed',
  'show_chinese_hints',
  'show_punctuation',
  'online_enabled',
  'audio_device',
  'recording_input_gain',
  'theme',
];

const NUMERIC_RULES: Readonly<Record<string, { min: number; max: number; integer?: boolean }>> = {
  target_band: { min: 0, max: 9 },
  daily_goal_minutes: { min: 5, max: 720, integer: true },
  tts_speed: { min: 0.5, max: 1.5 },
  recording_input_gain: { min: 0.5, max: 2 },
};

export function settingsFixture(): Settings {
  return {
    target_band: 6.5,
    exam_date: '2027-01-15',
    daily_goal_minutes: 60,
    accent: 'en-GB',
    tts_voice: 'en-GB-SoniaNeural',
    tts_speed: 1,
    show_chinese_hints: true,
    show_punctuation: true,
    online_enabled: true,
    audio_device: null,
    recording_input_gain: 1,
    theme: 'system',
    ai: { configured: false, base_url_host: null, model: 'gpt-4o-mini', key_source: 'none' },
  };
}

export function healthFixture(): HealthResponse {
  return {
    // 默认桩代表「引擎和界面同一版」的正常世界：版本不一致会让外壳亮出 §15.4 第 7 条的
    // 「上一个实例」告警，那个状态必须是显式覆盖出来的，不能是所有用例的默认背景。
    version: APP_VERSION,
    // §15.4 引擎自证身份：mock 也要带齐，界面才分得清「就绪」与「连的是上一个实例」
    pid: 4321,
    port: 8765,
    port_source: 'probe',
    started_at: '2026-10-30T21:10:00+08:00',
    ai_configured: false,
    ai_base_url_host: null,
    whisper: { loaded: false, model: 'base' },
    tts_ok: true,
    content_counts: { speaking: 6, listening: 4, reading: 3, writing: 6 },
    storage: { state: 'ok', reason: null },
  };
}

/** 与后端 `put_ai_key` 同规则（§10.5 裁定 4：没有最短长度）。 */
export function isKeyAccepted(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const value = raw.trim();
  if (value.length > 300) return false;
  return ![...value].some((char) => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127);
}

function applyPatch(state: Settings, body: Record<string, unknown>): Settings {
  const next: Settings = { ...state };
  for (const [key, value] of Object.entries(body)) {
    if (key === 'ai') continue;
    (next as unknown as Record<string, unknown>)[key] = value;
  }
  const block = body.ai as { base_url?: string | null; model?: string | null } | undefined;
  if (block && typeof block === 'object') {
    const ai: Settings['ai'] = { ...state.ai };
    if ('base_url' in block) ai.base_url_host = block.base_url ? new URL(block.base_url).host : null;
    if ('model' in block) ai.model = block.model ?? null;
    next.ai = ai;
  }
  return next;
}

function validatePatch(body: Record<string, unknown>): string | null {
  const unknown = Object.keys(body).filter((key) => key !== 'ai' && !WRITABLE_KEYS.includes(key));
  if (unknown.length) return `设置不支持的字段：${unknown.join(', ')}`;
  for (const [key, rule] of Object.entries(NUMERIC_RULES)) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${key} 需要是一个数字`;
    if (rule.integer && !Number.isInteger(value)) return `${key} 需要是整数`;
    if (value < rule.min || value > rule.max) return `${key} 应在 ${rule.min} 到 ${rule.max} 之间`;
  }
  if ('accent' in body && body.accent !== 'en-GB' && body.accent !== 'en-US') return 'accent 只能是 en-GB 或 en-US';
  // 与后端 `_check_theme` 同规则（契约 §4）：枚举值写错要 400，不许静默收下。
  if ('theme' in body && !['light', 'dark', 'system'].includes(String(body.theme))) {
    return 'theme 只能是 light / dark / system（浅色 / 深色 / 跟随系统）';
  }
  if ('exam_date' in body && body.exam_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.exam_date))) {
    return 'exam_date 应为 YYYY-MM-DD';
  }
  if ('tts_voice' in body && typeof body.tts_voice !== 'string') return 'tts_voice 需要是字符串';
  if ('audio_device' in body && body.audio_device !== null && typeof body.audio_device !== 'string') {
    return 'audio_device 需要是设备 ID 或 null';
  }
  const block = body.ai;
  if (block !== undefined) {
    if (!block || typeof block !== 'object') return 'ai 配置必须是一个对象，可包含 base_url 与 model';
    const keys = Object.keys(block as Record<string, unknown>);
    const bad = keys.filter((key) => key !== 'base_url' && key !== 'model');
    if (bad.length) return `ai 配置不支持的字段：${bad.join(', ')}`;
  }
  return null;
}

export interface SettingsHandlerOptions {
  settings?: Settings;
  health?: HealthResponse;
  /** 让 PATCH 一律失败（模拟后端校验/落库错误）。 */
  patchError?: { status: number; code: string; detail: string };
  /** 让 PUT /settings/ai-key 失败；`echoKey` 用于证明前端会把泄漏的明文脱敏。 */
  aiKeyError?: { status: number; code: string; detail: string };
  /** PATCH 成功后是否把返回体里的其余字段抹掉（模拟后端「未提供即重置」的旧 bug）。 */
  resetOmittedFields?: boolean;
  /** 7g 两张卡的初始数据；默认带上一份空态，否则设置屏的用例会去打真实 8765。 */
  data?: DataHandlerOptions;
}

export interface SettingsTestContext {
  handlers: readonly RequestHandler[];
  /** 每次 PATCH 的原始请求体（键集合就是客户端发出的键集合）。 */
  patchBodies: Record<string, unknown>[];
  putKeyBodies: Record<string, unknown>[];
  deleteCalls: number;
  getCalls: number;
  snapshot: () => Settings;
  setPatchError: (error: { status: number; code: string; detail: string } | null) => void;
  setAiKeyError: (error: { status: number; code: string; detail: string } | null) => void;
  setHealth: (next: HealthResponse) => void;
  /** 数据与备份 / 回收站两张卡的状态（§14.8）。 */
  data: DataTestContext;
}

export function createSettingsHandlers(options: SettingsHandlerOptions = {}): SettingsTestContext {
  let state = options.settings ?? settingsFixture();
  let healthValue = options.health ?? healthFixture();
  let patchError = options.patchError ?? null;
  let aiKeyError = options.aiKeyError ?? null;
  const patchBodies: Record<string, unknown>[] = [];
  const putKeyBodies: Record<string, unknown>[] = [];
  const counters = { deleteCalls: 0, getCalls: 0 };
  // 设置屏挂载时会同时渲染两张新卡，所以它们的端点也要有镜像：
  // 漏了的话，全部既有设置屏用例会去打真实 sidecar（慢且不稳）。
  const data = createDataHandlers(options.data ?? { items: [], trash: [], daysSinceLast: null });

  const handlers: RequestHandler[] = [
    http.get(`${API_BASE}/health`, () => ok(healthValue)),

    http.get(`${API_BASE}/settings`, () => {
      counters.getCalls += 1;
      return ok(state);
    }),

    http.patch(`${API_BASE}/settings`, async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      patchBodies.push(body);
      if (patchError) return fail(patchError.status, patchError.detail, patchError.code);
      const invalid = validatePatch(body);
      if (invalid) return fail(400, invalid, 'validation_failed');
      state = options.resetOmittedFields
        ? { ...applyPatch(settingsFixture(), body), ai: body.ai ? applyPatch(state, body).ai : state.ai }
        : applyPatch(state, body);
      return ok(state);
    }),

    http.put(`${API_BASE}/settings/ai-key`, async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      putKeyBodies.push(body);
      if (aiKeyError) return fail(aiKeyError.status, aiKeyError.detail, aiKeyError.code);
      if (!isKeyAccepted(body.key)) {
        return fail(400, 'AI key 格式不正确（长度应为 1–300 且不含控制字符）', 'validation_failed');
      }
      state = { ...state, ai: { ...state.ai, configured: true, key_source: 'settings' } };
      return ok({ ai_key_present: true });
    }),

    http.delete(`${API_BASE}/settings/ai-key`, () => {
      counters.deleteCalls += 1;
      state = { ...state, ai: { ...state.ai, configured: false, key_source: 'none' } };
      return ok({ ai_key_present: false });
    }),
  ];

  return {
    handlers: [...handlers, ...data.handlers],
    patchBodies,
    putKeyBodies,
    get deleteCalls() {
      return counters.deleteCalls;
    },
    get getCalls() {
      return counters.getCalls;
    },
    snapshot: () => state,
    setPatchError: (error) => {
      patchError = error;
    },
    setAiKeyError: (error) => {
      aiKeyError = error;
    },
    setHealth: (next) => {
      healthValue = next;
    },
    data,
  };
}

// ============================================================
// 7g：/backup 与 /attempts/trash（契约 §14.3、§14.4、§14.8）
// ============================================================

/** 与后端 `_NAME_RE` 同形状的名字，否则 restore 会被白名单挡掉（§14.3）。 */
export function snapshotFixture(tag = 'manual', stamp = '20261029T010203'): SnapshotRow {
  return {
    name: `app.${tag}.${stamp}.sqlite`,
    size_bytes: 1_572_864,
    created_at: '2026-10-29T01:02:03+00:00',
    tag,
    pre_upgrade: tag === 'pre-upgrade',
  };
}

export function trashFixture(overrides: Partial<TrashItem> = {}): TrashItem {
  const base: AttemptSummary = {
    id: 'att_li_trash_1',
    module: 'listening',
    task_ref: 'li_s2_travel_03',
    part: null,
    title_zh: '博物馆参观',
    topic: 'travel',
    band_overall: 6.5,
    band_sub: null,
    raw_correct: 15,
    raw_total: 20,
    duration_sec: 900,
    started_at: '2026-10-18T01:00:00Z',
    created_at: '2026-10-18T01:15:00Z',
    ai_used: false,
    approximate: false,
  };
  return { ...base, deleted_at: '2026-10-27T22:41:00+00:00', ...overrides };
}

/** 只用于断言「路径不许出现在弹窗与错误里」，本身长得像真路径。 */
export const MOCK_BACKUP_DIR = 'C:\Users\mock\AppData\Local\IELTSInsight\backups';

const SNAPSHOT_NAME = /^app\.([a-z][a-z-]{0,20})\.(\d{8}T\d{6}(?:-\d{2})?)\.sqlite$/;

export interface DataHandlerOptions {
  items?: SnapshotRow[];
  trash?: TrashItem[];
  /** 回收站总数；缺省 = trash.length（两者不等时界面必须用 total）。 */
  total?: number;
  daysSinceLast?: number | null;
  directory?: string;
}

export interface DataTestContext {
  handlers: readonly RequestHandler[];
  /** 当前快照行（新→旧），用于断言「恢复前先落了 pre-restore」。 */
  rows: () => SnapshotRow[];
  trash: () => TrashItem[];
  totals: () => { trash: number };
  restoreCalls: string[];
  restoreAttemptCalls: string[];
  purgeCalls: string[];
  backupCalls: number;
  setBackupCreateError: (error: { status: number; code: string; detail: string } | null) => void;
  setRestoreError: (error: { status: number; code: string; detail: string } | null) => void;
  setPurgeError: (error: { status: number; code: string; detail: string } | null) => void;
}

export function createDataHandlers(options: DataHandlerOptions = {}): DataTestContext {
  let rows = options.items ?? [snapshotFixture('startup', '20261029T010203')];
  let trash = options.trash ?? [];
  let total = options.total ?? trash.length;
  let daysSinceLast = options.daysSinceLast ?? 1;
  const directory = options.directory ?? MOCK_BACKUP_DIR;
  type Injected = { status: number; code: string; detail: string } | null;
  let backupCreateError: Injected = null;
  let restoreError: Injected = null;
  let purgeError: Injected = null;
  const restoreCalls: string[] = [];
  const restoreAttemptCalls: string[] = [];
  const purgeCalls: string[] = [];
  const counters = { backupCalls: 0, seq: 0 };

  /** 同一秒内的多份靠 `-02` 区分（§14.3「永不覆盖」）。 */
  const nextStamp = () => {
    counters.seq += 1;
    return `20261029T01020${counters.seq % 10}`;
  };

  const handlers: RequestHandler[] = [
    http.get(`${API_BASE}/backup`, () =>
      ok<BackupList>({
        items: rows,
        keep: 10,
        max_age_days: 7,
        days_since_last: daysSinceLast,
        directory,
      }),
    ),

    http.post(`${API_BASE}/backup`, () => {
      counters.backupCalls += 1;
      if (backupCreateError) return fail(backupCreateError.status, backupCreateError.detail, backupCreateError.code);
      const row = snapshotFixture('manual', nextStamp());
      rows = [row, ...rows];
      daysSinceLast = 0;
      return ok(row);
    }),

    http.post(`${API_BASE}/backup/:name/restore`, ({ params }) => {
      const name = String(params.name);
      restoreCalls.push(name);
      if (restoreError) return fail(restoreError.status, restoreError.detail, restoreError.code);
      // 与 `resolve_snapshot()` 同规则：名字不在白名单里就拒绝，且不动当前库。
      if (!SNAPSHOT_NAME.test(name)) return fail(400, '这份备份的名字不是本机快照文件名，已拒绝，当前库没有改动。', 'validation_failed');
      if (!rows.some((row) => row.name === name)) return fail(404, '本机找不到这份备份，可能已被轮转删掉。列表里最新的一份总是安全的。', 'not_found');
      const safety = snapshotFixture('pre-restore', nextStamp());
      rows = [safety, ...rows];
      return ok({ restored: name, pre_restore: safety.name });
    }),

    http.get(`${API_BASE}/attempts/trash`, () => ok({ items: trash, total })),

    http.post(`${API_BASE}/attempts/:id/restore`, ({ params }) => {
      const id = String(params.id);
      restoreAttemptCalls.push(id);
      if (!trash.some((item) => item.id === id)) return fail(404, '练习记录不存在', 'not_found');
      trash = trash.filter((item) => item.id !== id);
      total = Math.max(0, total - 1);
      return ok({ restored: true });
    }),

    http.delete(`${API_BASE}/attempts/:id/purge`, ({ params }) => {
      const id = String(params.id);
      purgeCalls.push(id);
      if (purgeError) return fail(purgeError.status, purgeError.detail, purgeError.code);
      if (!trash.some((item) => item.id === id)) return fail(404, '练习记录不存在', 'not_found');
      trash = trash.filter((item) => item.id !== id);
      total = Math.max(0, total - 1);
      return ok({ purged: true });
    }),
  ];

  return {
    handlers,
    rows: () => rows,
    trash: () => trash,
    totals: () => ({ trash: total }),
    restoreCalls,
    restoreAttemptCalls,
    purgeCalls,
    get backupCalls() {
      return counters.backupCalls;
    },
    setBackupCreateError: (error) => {
      backupCreateError = error;
    },
    setRestoreError: (error) => {
      restoreError = error;
    },
    setPurgeError: (error) => {
      purgeError = error;
    },
  };
}
