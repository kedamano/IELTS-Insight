/**
 * settings/testHandlers.ts —— 设置屏自己的 msw 处理器（契约 §1 行 2–5、§4、§10.5 裁定 4）。
 *
 * 与 `src/test/mocks/handlers.ts` 保持独立（那个文件由他人并发维护），但规则按后端
 * `backend/app/api/settings.py` 复刻：
 * - `PATCH /settings` 只覆盖请求体里出现的键（未提供即不动，AC-C1），可写键白名单外一律 400；
 * - `ai` 子块只接受 `base_url` / `model`，回读时只暴露 `base_url_host`（AC-C2 的最小暴露）；
 * - `PUT /settings/ai-key` 无最短长度，规则只有非空 / ≤300 / 不含控制字符，机器码恒为
 *   `validation_failed`；响应只有 `ai_key_present`，绝不回传明文。
 */
import { HttpResponse, http } from 'msw';
import type { RequestHandler } from 'msw';
import { API_BASE } from '../../services/api';
import type { HealthResponse, Settings } from '../../types/ielts';

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
    version: '2.1.0',
    ai_configured: false,
    ai_base_url_host: null,
    whisper: { loaded: false, model: 'base' },
    tts_ok: true,
    content_counts: { speaking: 6, listening: 4, reading: 3, writing: 6 },
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
}

export function createSettingsHandlers(options: SettingsHandlerOptions = {}): SettingsTestContext {
  let state = options.settings ?? settingsFixture();
  let healthValue = options.health ?? healthFixture();
  let patchError = options.patchError ?? null;
  let aiKeyError = options.aiKeyError ?? null;
  const patchBodies: Record<string, unknown>[] = [];
  const putKeyBodies: Record<string, unknown>[] = [];
  const counters = { deleteCalls: 0, getCalls: 0 };

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
    handlers,
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
  };
}
