/**
 * speaking/sparringHandlers.ts —— 1 对 1 陪练的 msw 处理器（契约 §1 #51–#57、§16）。
 *
 * 与 `speaking/testHandlers.ts` 同一套路：自备 fixture（内容为本文件自写的占位，不含真题），
 * 由测试用 `server.use(...)` 注册；异步评分复用 `src/test/mocks/gradingJobs`。
 *
 * 三个可观测钩子（测试靠它们断言接线，不靠文案）：
 * - `topicCalls`：`GET /sparring/topics` 的 level 查询串；
 * - `turnCalls`：每轮提交的 text / audio 字节数 / duration；
 * - `assessAsyncCalls`：排队评分的会话 id。
 */
import { HttpResponse, http } from 'msw';
import type { RequestHandler } from 'msw';
import { createJobMock } from '../../test/mocks/gradingJobs';
import type {
  HealthResponse,
  Settings,
  SpeakingGradingJob,
  SpeakingReport,
  SparringMessage,
  SparringTopic,
  SparringTopicMeta,
  SparringTurnResult,
} from '../../types/ielts';

const BASE = 'http://127.0.0.1:8765/api';

function ok<T>(data: T, init?: ResponseInit) {
  return HttpResponse.json({ data }, init);
}

export const sparringHealth: HealthResponse = {
  version: '2.0.0',
  pid: 4321,
  port: 8765,
  port_source: 'probe',
  started_at: '2026-11-06T21:00:00+08:00',
  ai_configured: true,
  ai_base_url_host: 'api.example.test',
  whisper: { loaded: true, model: 'base' },
  tts_ok: true,
  content_counts: { speaking: 18, listening: 4, reading: 4, writing: 10 },
  storage: { state: 'ok', reason: null },
};

export const sparringSettings: Settings = {
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
  ai: { configured: true, base_url_host: 'api.example.test', model: 'glm-4.6', key_source: 'env' },
};

const restaurant: SparringTopic = {
  id: 'sb_restaurant_01',
  module: 'sparring',
  kind: 'practice',
  target_band: 5.5,
  title_zh: '餐厅点单',
  topic: 'restaurant',
  scenario_zh: '你在伦敦一家小餐馆点午餐，服务员会先问几位、再推荐菜。',
  level: 'a2',
  source: 'hand',
  generated_at: '2026-11-06T00:00:00Z',
  opening: 'Good afternoon, welcome in! Do you have a booking, or would you like me to find you a table?',
  preset_questions: [
    'How many people will be joining you today?',
    'Would you like to sit by the window or near the back?',
    'Can I start you off with something to drink?',
    'Do you have any allergies or dietary requirements I should know about?',
    'How would you like the steak cooked?',
    'Shall I bring you the dessert menu now?',
  ],
  max_turns: 10,
  partner_voice: 'en-GB-SoniaNeural',
  turns: 10,
  preset_count: 6,
};

const interview: SparringTopic = {
  ...restaurant,
  id: 'sb_interview_03',
  title_zh: '求职面试',
  topic: 'interview',
  level: 'b2',
  target_band: 7.0,
  scenario_zh: '你正在应聘市场助理岗位，面试官会追问经历、动机与团队协作。',
  opening: 'Thanks for making time today. Could you tell me a little about yourself?',
  max_turns: 10,
};

function meta(doc: SparringTopic): SparringTopicMeta {
  return {
    id: doc.id,
    title_zh: doc.title_zh,
    topic: doc.topic,
    scenario_zh: doc.scenario_zh,
    level: doc.level,
    target_band: doc.target_band,
    turns: doc.max_turns,
    preset_count: doc.preset_questions.length,
  };
}

export const restaurantMeta = meta(restaurant);
export const interviewMeta = meta(interview);

export function sparringReport(partial: Partial<SpeakingReport> = {}): SpeakingReport {
  return {
    attempt_id: 'att_sparring_0001',
    ai_used: true,
    degraded_reason: null,
    approximate: false,
    model: 'glm-4.6',
    band: {
      overall: 6.0,
      fluency_coherence: 6.0,
      lexical_resource: 5.5,
      grammatical_range_accuracy: 6.0,
      pronunciation: 6.5,
      pronunciation_confidence: 'high',
    },
    evidence: [{ criterion: 'fluency_coherence', quote: 'I would like a table for two', why: '回答直接切题', level: '6.0' }],
    strengths: ['回答直接、礼貌'],
    improvements: [
      { issue: '回答偏短', fix: '补一句原因或细节', quote: 'I would like a table for two' },
      { issue: '连接词单一', fix: '用 besides / as a result 串联' },
      { issue: '时态混用', fix: '描述计划用 would + 原形' },
    ],
    model_answer: 'I would like a table for two, ideally by the window if one is free.',
    upgrade_vocabulary: [{ from: 'want', to: 'would like', note_zh: '更礼貌的表达', source: 'ai:glm-4.6' }],
    metrics: { word_count: 38, wpm: 96, pause_total_sec: 4.2, fillers: [], repeats: 0 },
    pronunciation_detail: { wer: 0.08, score_0_100: 82, problem_words: [] },
    sparring: { topic_id: restaurant.id, turns: 2, mode: 'sparring' },
    ...partial,
  };
}

export interface SparringTurnCall {
  audioBytes: number;
  text: string | null;
  durationSec: string | null;
  sessionId: string;
}

export interface SparringTestContext {
  handlers: RequestHandler[];
  topicCalls: (string | null)[];
  sessionBodies: { topic_id: string; level?: string }[];
  turnCalls: SparringTurnCall[];
  assessAsyncCalls: string[];
  /** 把最早的未结束评分任务落成 succeeded */
  settleJob: (report?: SpeakingReport) => string;
  failJob: (error: string) => string;
  /** 把某个会话的下一轮追问改成离线回落 */
  nextSource: 'ai' | 'fallback';
}

export interface SparringHandlerOptions {
  topics?: SparringTopic[];
  /** 让 `POST /sparring/sessions` 失败（AC-S7.2 的可读错误） */
  startError?: { status: number; code: string; detail: string };
  /** 让 `POST .../turn` 失败（400/413 口径） */
  turnError?: { status: number; code: string; detail: string };
  /** 追问来源：默认 fallback（离线世界），可切 ai */
  source?: 'ai' | 'fallback';
  /** `assess/async` 失败 */
  assessError?: { status: number; code: string; detail: string };
  /** 轮次上限（默认取话题的 max_turns） */
  maxTurns?: number;
  report?: SpeakingReport;
  jobAutoSettle?: boolean;
  jobError?: string;
  settings?: Settings;
  /** 音频：ok = 返回可播字节，unavailable = 503 */
  tts?: 'ok' | 'unavailable';
  /** 让 `GET /sparring/sessions/{id}` 一律 404（模拟换库 / 会话被清理，§16.3 第 6 条） */
  sessionsGone?: boolean;
}

function audioBytesOf(value: FormDataEntryValue | null): number {
  return typeof (value as Blob | null)?.size === 'number' ? (value as Blob).size : 0;
}

export function createSparringHandlers(options: SparringHandlerOptions = {}): SparringTestContext {
  const topics = options.topics ?? [restaurant, interview];
  const topicCalls: (string | null)[] = [];
  const sessionBodies: { topic_id: string; level?: string }[] = [];
  const turnCalls: SparringTurnCall[] = [];
  const assessAsyncCalls: string[] = [];
  let nextSource: 'ai' | 'fallback' = options.source ?? 'fallback';
  let seq = 0;
  const perSession = new Map<string, { messages: SparringMessage[]; presetCursor: number }>();

  const jobs = createJobMock({
    base: BASE,
    autoSettle: options.jobAutoSettle ?? true,
    reportOf: () => options.report ?? sparringReport(),
    jobError: options.jobError,
  });

  function docOf(topicId: string): SparringTopic | undefined {
    return topics.find((item) => item.id === topicId);
  }

  function openingMessage(doc: SparringTopic): SparringMessage {
    return { seq: 0, role: 'partner', text: doc.opening, source: 'opening', audio_url: null };
  }

  async function turnResponse(form: FormData, sessionId: string) {
    turnCalls.push({
      audioBytes: audioBytesOf(form.get('audio')),
      text: typeof form.get('text') === 'string' ? (form.get('text') as string) : null,
      durationSec: form.get('duration_sec') ? String(form.get('duration_sec')) : null,
      sessionId,
    });
    if (options.turnError) {
      return HttpResponse.json(
        { detail: options.turnError.detail, code: options.turnError.code },
        { status: options.turnError.status },
      );
    }

    const doc = docOf([...sessionBodies].pop()?.topic_id ?? restaurant.id) ?? restaurant;
    const state = perSession.get(sessionId) ?? { messages: [openingMessage(doc)], presetCursor: 0 };
    seq += 1;
    const mine: SparringMessage = {
      seq,
      role: 'user',
      text: typeof form.get('text') === 'string' ? (form.get('text') as string) : '（这段来自音频）',
      confidence: form.get('audio') ? 0.91 : null,
      duration_sec: form.get('duration_sec') ? Number(form.get('duration_sec')) : null,
    };
    const maxTurns = options.maxTurns ?? doc.max_turns;
    const answered = state.messages.filter((item) => item.role === 'user').length + 1;
    const remaining = Math.max(0, maxTurns - answered);
    const reply =
      nextSource === 'ai'
        ? 'You mentioned a quiet corner — would that still suit you if the restaurant gets busy?'
        : doc.preset_questions[state.presetCursor % doc.preset_questions.length];
    seq += 1;
    const partner: SparringMessage = {
      seq,
      role: 'partner',
      text: reply,
      source: nextSource,
      audio_url: null,
    };
    state.messages = [...state.messages, mine, partner];
    state.presetCursor += 1;
    perSession.set(sessionId, state);

    const result: SparringTurnResult = {
      seq: mine.seq,
      transcript: mine.text,
      confidence: mine.confidence ?? null,
      partner,
      turn_index: answered,
      remaining,
      state: remaining === 0 ? 'awaiting_assess' : 'in_progress',
      source: nextSource,
      degraded_reason: nextSource === 'fallback' ? 'offline_template' : null,
    };
    return ok(result);
  }

  const handlers: RequestHandler[] = [
    http.get(`${BASE}/health`, () => ok(sparringHealth)),
    http.get(`${BASE}/settings`, () => ok(options.settings ?? sparringSettings)),

    http.get(`${BASE}/sparring/topics`, ({ request }) => {
      const level = new URL(request.url).searchParams.get('level');
      topicCalls.push(level);
      const items = topics.filter((doc) => level === null || doc.level === level).map(meta);
      return ok({ items });
    }),

    http.get(`${BASE}/sparring/topics/:id`, ({ params }) => {
      const doc = docOf(String(params.id));
      if (!doc) return HttpResponse.json({ detail: '陪练话题不存在', code: 'not_found' }, { status: 404 });
      return ok(doc);
    }),

    http.post(`${BASE}/sparring/sessions`, async ({ request }) => {
      const body = (await request.json()) as { topic_id: string; level?: string };
      sessionBodies.push(body);
      if (options.startError) {
        return HttpResponse.json(
          { detail: options.startError.detail, code: options.startError.code },
          { status: options.startError.status },
        );
      }
      const doc = docOf(body.topic_id) ?? restaurant;
      const sessionId = `spa_test_${sessionBodies.length}`;
      const messages = [openingMessage(doc)];
      perSession.set(sessionId, { messages, presetCursor: 0 });
      return ok({
        session_id: sessionId,
        topic: doc,
        opening: doc.opening,
        turn_index: 0,
        max_turns: options.maxTurns ?? doc.max_turns,
        state: 'created',
        audio_url: null,
        messages,
      });
    }),

    http.get(`${BASE}/sparring/sessions/:id`, ({ params }) => {
      const sessionId = String(params.id);
      if (options.sessionsGone) {
        return HttpResponse.json({ detail: '陪练会话不存在', code: 'not_found' }, { status: 404 });
      }
      const state = perSession.get(sessionId);
      const maxTurns = options.maxTurns ?? restaurant.max_turns;
      const used = state?.messages.filter((item) => item.role === 'user').length ?? 0;
      return ok({
        session_id: sessionId,
        topic_id: restaurant.id,
        level: restaurant.level,
        max_turns: maxTurns,
        turn_index: used,
        remaining: Math.max(0, maxTurns - used),
        state: used >= maxTurns ? 'awaiting_assess' : 'in_progress',
        messages: state?.messages ?? [openingMessage(restaurant)],
        result: null,
      });
    }),

    http.post(`${BASE}/sparring/sessions/:id/turn`, async ({ request, params }) =>
      turnResponse(await request.formData(), String(params.id)),
    ),

    http.post(`${BASE}/sparring/sessions/:id/assess/async`, ({ params }) => {
      const sessionId = String(params.id);
      assessAsyncCalls.push(sessionId);
      if (options.assessError) {
        return HttpResponse.json(
          { detail: options.assessError.detail, code: options.assessError.code },
          { status: options.assessError.status },
        );
      }
      return ok(jobs.create<SpeakingGradingJob>('speaking', sessionId));
    }),

    ...jobs.handlers,

    http.get(`${BASE}/tts`, () => {
      if (options.tts === 'unavailable') {
        return HttpResponse.json({ detail: '语音合成服务不可用（离线）', code: 'tts_unavailable' }, { status: 503 });
      }
      return new HttpResponse(new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x01]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    }),
  ];

  return {
    handlers,
    topicCalls,
    sessionBodies,
    turnCalls,
    assessAsyncCalls,
    settleJob: (report?: SpeakingReport) => jobs.settle(report),
    failJob: jobs.fail,
    get nextSource() {
      return nextSource;
    },
    set nextSource(value: 'ai' | 'fallback') {
      nextSource = value;
    },
  };
}
