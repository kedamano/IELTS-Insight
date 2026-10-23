/**
 * report 模块的 msw fixture + handler 工厂（自带 spy，便于断言「真正发了什么请求」）。
 *
 * 为什么不直接用 `src/test/mocks/handlers.ts` 的默认集合：
 * 那份基线由 qa agent 并行维护，内容随时在变；本屏需要的是**可控的数据**
 * （null band、空 analytics、分页 total、删除回包），所以按 test-plan 的约定
 * 在自己的 `testHandlers.ts` 里定义并用 `server.use()` 覆盖。
 */
import { http, type RequestHandler } from 'msw';
import { API_BASE } from '../../services/api';
import type {
  Analytics,
  AttemptDetail,
  AttemptSummary,
  Module,
  PlanTodayResult,
  ProgressSummary,
  Settings,
  TrendPoint,
  VocabNote,
} from '../../types/ielts';
import { envelope, fail } from '../shared/testKit';

// ============================================================
// fixtures
// ============================================================

/** 四个模块刻意覆盖四种色档：7.5 good / 6.0 mid / 4.5 poor / null 尚无数据。 */
export const REPORT_SUMMARY: ProgressSummary = {
  target_band: 7,
  exam_date: '2026-12-15',
  days_left: 59,
  current: { speaking: 6, listening: 4.5, reading: 7.5, writing: null },
  delta_vs_previous: { speaking: 0.5, listening: -0.5, reading: 0, writing: null },
  attempts_total: 12,
  minutes_total: 340,
  last_practice_at: '2026-10-17T09:00:00Z',
};

/** 全 null 的概览：AC-P1 的「新记录立刻反映」与「无 NaN」都要用到。 */
export const EMPTY_SUMMARY: ProgressSummary = {
  target_band: 6.5,
  exam_date: null,
  days_left: null,
  current: { speaking: null, listening: null, reading: null, writing: null },
  delta_vs_previous: { speaking: null, listening: null, reading: null, writing: null },
  attempts_total: 0,
  minutes_total: 0,
  last_practice_at: null,
};

export const REPORT_PLAN: PlanTodayResult = {
  items: [
    {
      id: 'task-1',
      date: '2026-10-18',
      module: 'listening',
      set_ref: 'ls_sec2_gap_03',
      reason_zh: '听力与目标差 2.5 分，优先补客观题',
      done: false,
    },
    {
      id: 'task-2',
      date: '2026-10-18',
      module: 'writing',
      set_ref: 'wr_task2_07',
      reason_zh: '写作尚无评分，先完成一篇 Task 2',
      done: true,
    },
  ],
  generated_at: '2026-10-18T07:30:00Z',
};

export const REPORT_TRENDS: Record<Module, TrendPoint[]> = {
  speaking: [
    { date: '2026-09-20', band: 5.5 },
    { date: '2026-10-04', band: 6 },
    { date: '2026-10-16', band: 6 },
  ],
  listening: [
    { date: '2026-09-28', band: 5 },
    { date: '2026-10-15', band: 4.5 },
  ],
  reading: [{ date: '2026-10-10', band: 7.5 }],
  writing: [],
};

export const EMPTY_TRENDS: Record<Module, TrendPoint[]> = {
  speaking: [],
  listening: [],
  reading: [],
  writing: [],
};

export const REPORT_ANALYTICS: Analytics = {
  by_question_type: [
    { question_type: 'gap_fill', correct: 18, total: 20, accuracy: 0.9 },
    { question_type: 'multiple_choice', correct: 7, total: 15, accuracy: 0.4667 },
  ],
  // 与上面同源的另一种切法（听力做了 gap_fill、阅读做了 multiple_choice）：
  // 两处的 correct/total 合计必须相等，否则分科磁贴与题型表会互相打脸。
  by_module: [
    { module: 'listening', correct: 18, total: 20, accuracy: 0.9 },
    { module: 'reading', correct: 7, total: 15, accuracy: 0.4667 },
  ],
  by_error_type: [
    { error_type: 'spelling', count: 4, latest_quote: '环境写成 environment' },
    { error_type: 'grammar', count: 2, latest_quote: 'He go to school every day.' },
  ],
  minutes_by_day: [
    { date: '2026-10-16', minutes: 35 },
    { date: '2026-10-17', minutes: 80 },
  ],
};

export const EMPTY_ANALYTICS: Analytics = {
  by_question_type: [],
  by_module: [],
  by_error_type: [],
  minutes_by_day: [],
};

export const REPORT_SETTINGS: Settings = {
  target_band: 7,
  exam_date: '2026-12-15',
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

export const SPEAKING_DETAIL: AttemptDetail = {
  attempt: {
    id: 'at-sp-1',
    module: 'speaking',
    task_ref: 'sp_p2_environment_01',
    part: '2',
    title_zh: 'Describe a place you like',
    band_overall: 6.5,
    band_sub: {
      fluency_coherence: 6.5,
      lexical_resource: 6,
      grammatical_range_accuracy: 6,
      pronunciation: 7,
    },
    duration_sec: 118,
    started_at: '2026-10-16T09:00:00Z',
    created_at: '2026-10-16T09:04:00Z',
    ai_used: true,
    approximate: false,
    model: 'glm-4.6',
  },
  payload: {
    attempt_id: 'at-sp-1',
    module: 'speaking',
    ai_used: true,
    approximate: false,
    model: 'glm-4.6',
    band: {
      overall: 6.5,
      fluency_coherence: 6.5,
      lexical_resource: 6,
      grammatical_range_accuracy: 6,
      pronunciation: 7,
      pronunciation_confidence: 'high',
    },
    evidence: [
      { criterion: 'lexical_resource', quote: 'a rewarding experience', why: '用词具体', level: '6.0' },
    ],
    strengths: ['节奏稳定，停顿自然'],
    improvements: [{ issue: '连接词单一', fix: '换用 however / moreover', quote: 'and and and' }],
    model_answer: 'I would talk about the riverside park, which is genuinely rewarding.',
    upgrade_vocabulary: [{ from: 'good', to: 'rewarding', note_zh: '更具体', source: 'ai:glm-4.6' }],
    metrics: { word_count: 210, wpm: 96, pause_total_sec: 4.5, fillers: ['um'], repeats: 2 },
    pronunciation_detail: {
      wer: 0.08,
      score_0_100: 88,
      problem_words: [{ word: 'thorough', expected: 'ˈθʌr.ə', actual: 'thorow' }],
    },
  },
};

export const LISTENING_DETAIL: AttemptDetail = {
  attempt: {
    id: 'at-lc-1',
    module: 'listening',
    task_ref: 'ls_sec2_gap_03',
    part: null,
    band_overall: 6.5,
    band_sub: null,
    raw_correct: 32,
    raw_total: 40,
    duration_sec: 600,
    started_at: '2026-10-15T10:00:00Z',
    created_at: '2026-10-15T10:12:00Z',
    ai_used: false,
    approximate: true,
  },
  payload: {
    attempt_id: 'at-lc-1',
    module: 'listening',
    ai_used: false,
    approximate: true,
    raw_correct: 32,
    raw_total: 40,
    band: 6.5,
    band_scale: 'listening_40q',
    accuracy: 0.8,
    items: [
      { id: 'q1', number: 1, type: 'gap_fill', your_answer: 'park', expected: 'park', correct: true },
      {
        id: 'q2',
        number: 2,
        type: 'gap_fill',
        your_answer: 'environment',
        expected: 'environment',
        correct: false,
        reason: 'spelling_variant_rejected',
        explanation_zh: '拼写缺了 n，作答与原文不一致，按规则不判对。',
        answer_quote: 'The environment programme starts next week.',
      },
    ],
    by_question_type: { gap_fill: { correct: 15, total: 20 } },
    transcript: 'The library opens at nine on weekdays.',
  },
};

/**
 * 列表 fixture：口语条目带 `band_sub`（列表即够），需要测「回读详情」这条路径时
 * 用 `attempts: [{...band_sub: null}]` 覆盖，即可断言 `GET /attempts/{id}` 真的发生了。
 */
export const REPORT_ATTEMPTS: AttemptSummary[] = [SPEAKING_DETAIL.attempt, LISTENING_DETAIL.attempt];

export const ALL_DETAILS: Record<string, AttemptDetail> = {
  'at-sp-1': SPEAKING_DETAIL,
  'at-lc-1': LISTENING_DETAIL,
};

/** `progressTrend()` 不带 module 时的综合走势（后端 `composite_trend`：四科按日均值）。 */
export const REPORT_COMPOSITE: TrendPoint[] = [
  { date: '2026-09-20', band: 5.5 },
  { date: '2026-10-04', band: 6 },
  { date: '2026-10-16', band: 6 },
];

export const EMPTY_COMPOSITE: TrendPoint[] = [];

/**
 * 生词本 fixture：`created_at` 用相对「今天」的偏移，否则「近 7 天新增」这条派生
 * 会在跨天后随机翻脸。
 */
const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

export const REPORT_VOCAB: VocabNote[] = [
  { word: 'environment', context: 'The environment programme…', source_module: 'listening', source_ref: 'ls_1', note_zh: '环境', tags: [], created_at: daysAgo(2) },
  { word: 'rewarding', context: 'a rewarding experience', source_module: 'speaking', source_ref: 'sp_1', note_zh: '有收获的', tags: [], created_at: daysAgo(1) },
  { word: 'however', context: 'however, …', source_module: 'writing', source_ref: 'wr_1', note_zh: '然而', tags: [], created_at: daysAgo(30) },
];

// ============================================================
// spies + handler 工厂
// ============================================================

export interface ReportSpies {
  planDone: Array<{ id: string; done: boolean }>;
  deletedAttempts: string[];
  attemptsQueries: Array<{ module: string | null; limit: string | null; offset: string | null }>;
  trendQueries: string[];
  detailFetches: string[];
  vocabCalls: number;
  summaryCalls: number;
  settingsCalls: number;
}

export function createReportSpies(): ReportSpies {
  return {
    planDone: [],
    deletedAttempts: [],
    attemptsQueries: [],
    trendQueries: [],
    detailFetches: [],
    vocabCalls: 0,
    summaryCalls: 0,
    settingsCalls: 0,
  };
}

export interface ReportFixtures {
  summary?: ProgressSummary;
  plan?: PlanTodayResult;
  trends?: Partial<Record<Module, TrendPoint[]>>;
  /** 综合走势（`GET /progress/trend` 不带 module）；缺省用 `REPORT_COMPOSITE`。 */
  composite?: TrendPoint[];
  analytics?: Analytics;
  vocab?: VocabNote[];
  settings?: Settings;
  attempts?: AttemptSummary[];
  attemptsTotal?: number;
  details?: Record<string, AttemptDetail>;
  /** 让某个端点固定失败，用于测失败可见（CONSTITUTION §3）。 */
  summaryFailure?: string;
}

/**
 * 组装本屏需要的全部 handler。
 * `attempts` 列表按 `module/limit/offset` 真实切片，分页测试才有意义。
 */
export function reportHandlers(spies: ReportSpies, fixtures: ReportFixtures = {}): RequestHandler[] {
  const summary = fixtures.summary ?? REPORT_SUMMARY;
  const plan = fixtures.plan ?? REPORT_PLAN;
  const trends = fixtures.trends ?? REPORT_TRENDS;
  const composite = fixtures.composite ?? REPORT_COMPOSITE;
  const analytics = fixtures.analytics ?? REPORT_ANALYTICS;
  const vocab = fixtures.vocab ?? REPORT_VOCAB;
  const settings = fixtures.settings ?? REPORT_SETTINGS;
  const attempts = fixtures.attempts ?? REPORT_ATTEMPTS;
  const details = fixtures.details ?? ALL_DETAILS;
  /** 计划要做成有状态的：`POST /plan/{id}/done` 之后重拉就该是 done=true，
   *  否则「乐观态 → 后端真值」这条链路在测试里看不出差别。 */
  const planState: PlanTodayResult = {
    ...plan,
    items: plan.items.map((task) => ({ ...task })),
  };

  return [
    http.get(`${API_BASE}/progress/summary`, () => {
      spies.summaryCalls += 1;
      if (fixtures.summaryFailure) return fail(500, fixtures.summaryFailure);
      return envelope(summary);
    }),

    http.get(`${API_BASE}/plan/today`, () => envelope(planState)),

    http.post(`${API_BASE}/plan/:taskId/done`, async ({ params, request }) => {
      const body = (await request.json()) as { done: boolean };
      const id = String(params.taskId);
      spies.planDone.push({ id, done: body.done });
      planState.items = planState.items.map((task) => (task.id === id ? { ...task, done: body.done } : task));
      return envelope({ ok: true });
    }),

    http.get(`${API_BASE}/progress/trend`, ({ request }) => {
      const url = new URL(request.url);
      const module = url.searchParams.get('module');
      spies.trendQueries.push(module ?? '');
      const points = module ? (trends[module as Module] ?? []) : composite;
      return envelope<{ points: TrendPoint[] }>({ points });
    }),

    http.get(`${API_BASE}/vocab`, () => {
      spies.vocabCalls += 1;
      return envelope({ items: vocab });
    }),

    http.get(`${API_BASE}/progress/analytics`, () => envelope(analytics)),

    http.get(`${API_BASE}/settings`, () => {
      spies.settingsCalls += 1;
      return envelope(settings);
    }),

    http.get(`${API_BASE}/attempts`, ({ request }) => {
      const url = new URL(request.url);
      const module = url.searchParams.get('module');
      const limit = url.searchParams.get('limit');
      const offset = url.searchParams.get('offset');
      spies.attemptsQueries.push({ module, limit, offset });
      const pool = module ? attempts.filter((item) => item.module === module) : attempts;
      const from = offset ? Number(offset) : 0;
      const size = limit ? Number(limit) : pool.length;
      const items = pool.slice(from, from + size);
      return envelope({ items, total: fixtures.attemptsTotal ?? pool.length });
    }),

    http.get(`${API_BASE}/attempts/:attemptId`, ({ params }) => {
      const id = String(params.attemptId);
      spies.detailFetches.push(id);
      const detail = details[id];
      if (!detail) return fail(404, '该练习记录不存在');
      return envelope(detail);
    }),

    http.delete(`${API_BASE}/attempts/:attemptId`, ({ params }) => {
      const id = String(params.attemptId);
      spies.deletedAttempts.push(id);
      return envelope({ deleted: true });
    }),
  ];
}
