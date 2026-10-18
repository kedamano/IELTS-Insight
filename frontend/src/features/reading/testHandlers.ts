/**
 * 阅读测试的 msw handlers（Wave 2 规则：基线 handlers 由他人并发重写，
 * 所以每个 feature 自带夹具 + `server.use(...)`，只依赖 `src/test/mocks/server`）。
 *
 * 端点按契约 §1 #17/#18/#19 与 #35（POST /vocab）、#2（GET /settings）实现，
 * `data` envelope 与后端 `ok()` 一致（§0）。
 */
import { http, HttpResponse } from 'msw';
import type { Settings, VocabAddBody, VocabNote } from '../../types/ielts';
import { API_BASE } from '../../services/api';
import {
  FIXTURE_READING_SET,
  FIXTURE_REPORT,
  FIXTURE_SET_METAS,
  FIXTURE_SHORT_SET,
  FIXTURE_TIMEOUT_SET,
} from './testFixtures';

const ALL_FIXTURE_SETS = [FIXTURE_READING_SET, FIXTURE_SHORT_SET, FIXTURE_TIMEOUT_SET];

export const readingTestState = {
  attemptBodies: [] as { set: string; body: Record<string, unknown> }[],
  vocabBodies: [] as VocabAddBody[],
  vocabShouldFail: false,
  attemptShouldFail: false,
  showChineseHints: true,
  reset(): void {
    this.attemptBodies = [];
    this.vocabBodies = [];
    this.vocabShouldFail = false;
    this.attemptShouldFail = false;
    this.showChineseHints = true;
  },
};

const SETTINGS_FIXTURE: Settings = {
  target_band: 6.5,
  exam_date: '2027-01-15',
  daily_goal_minutes: 60,
  accent: 'en-GB',
  tts_voice: 'en-GB-SoniaNeural',
  tts_speed: 1,
  show_chinese_hints: true,
  show_punctuation: true,
  online_enabled: false,
  audio_device: null,
  recording_input_gain: 1,
    theme: 'system',
  ai: { configured: false, base_url_host: null, model: 'glm-4.6', key_source: 'none' },
};

export const readingHandlers = [
  http.get(`${API_BASE}/reading/sets`, () => HttpResponse.json({ data: { items: FIXTURE_SET_METAS } })),

  http.get(`${API_BASE}/reading/sets/:setId`, ({ params }) => {
    const id = String(params.setId ?? '');
    const found = ALL_FIXTURE_SETS.find((item) => item.id === id);
    if (!found) {
      return HttpResponse.json({ detail: `阅读套题不存在：${id}`, code: 'not_found' }, { status: 404 });
    }
    return HttpResponse.json({ data: found });
  }),

  http.post(`${API_BASE}/reading/sets/:setId/attempt`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    readingTestState.attemptBodies.push({ set: String(params.setId ?? ''), body });
    if (readingTestState.attemptShouldFail) {
      return HttpResponse.json({ detail: '判分服务暂不可用（测试注入）', code: 'db_error' }, { status: 500 });
    }
    // 后端按提交体回填 timed_out（§1 #19 → §3-OR），讲评卡要能复现「到时自动提交」徽标
    return HttpResponse.json({ data: { ...FIXTURE_REPORT, timed_out: body.timed_out === true } });
  }),

  http.post(`${API_BASE}/vocab`, async ({ request }) => {
    const body = (await request.json()) as VocabAddBody;
    readingTestState.vocabBodies.push(body);
    if (readingTestState.vocabShouldFail) {
      return HttpResponse.json({ detail: '生词本写入失败（测试注入）', code: 'db_error' }, { status: 500 });
    }
    const note: VocabNote = {
      word: body.word,
      context: body.context,
      // VocabAddBody.source_module 是 `Module | string`，VocabNote 收窄为 `Module | null`
      source_module: body.source_module as VocabNote['source_module'],
      source_ref: body.source_ref,
      note_zh: body.note_zh ?? '',
      tags: body.tags ?? [],
      created_at: '2026-10-18T00:00:00Z',
    };
    return HttpResponse.json({ data: note });
  }),

  http.get(`${API_BASE}/settings`, () =>
    HttpResponse.json({ data: { ...SETTINGS_FIXTURE, show_chinese_hints: readingTestState.showChineseHints } }),
  ),
];
