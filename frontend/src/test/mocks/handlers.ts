/**
 * test/mocks/handlers.ts —— msw handlers，按 `docs/specs/ielts/spec-contracts.md` §1
 * （含 §10 定稿决议）逐端点组编写；旧 app 的 payment/scene/wordbook/wrong-records/
 * learning-stats/achievements/sentence-parse/phoneme-tip handler 已全部删除（AC-X1/X4）。
 *
 * 设计原则（test-plan §1「前端 msw 覆盖不全」整改）：
 * - fixture 保持数据轻量：每端点一个最小可用响应，形态严格按 §1/§2/§3/§4。
 * - 基址单一来源：`API_BASE` 从 `services/api.ts` 导入，不在测试侧重复字面量化端口。
 * - 按组导出（`healthHandlers`、`settingsHandlers`…），feature 测试作者可用
 *   `server.use(...speakingHandlers)` 只挂载自己需要的组；`handlers` 为全量集合，
 *   仅供 `server.ts` 的默认 setup 使用。
 * - 有状态项：`PATCH /settings` 与 `PUT/DELETE /settings/ai-key` 修改模块内
 *   `settingsState`，测试间用 `resetMockState()`（setup.ts 的 afterEach 已挂）复位。
 */
import { http, HttpResponse } from 'msw';
import { API_BASE } from '../../services/api';
import type {
  AiKeyPresence,
  Analytics,
  AttemptDetail,
  AttemptSummary,
  HealthResponse,
  ListeningObjectiveReport,
  ListeningSet,
  ListeningSetMeta,
  PlanTask,
  PlanTodayResult,
  ProgressSummary,
  ProgressTrend,
  ReadingObjectiveReport,
  ReadingSet,
  ReadingSetMeta,
  ReviewItem,
  Settings,
  SpeakingPrompt,
  SpeakingReport,
  SpeakingSession,
  SpeakingSessionStart,
  SpeakingSet,
  SpeakingSetMeta,
  SpeakingTurnResult,
  FollowupsResult,
  VocabNote,
  WordInfo,
  WritingReport,
  WritingTask,
} from '../../types/ielts';

// ============================================================
// 通用小工具
// ============================================================

/** 契约 §0：`{"data": <payload>}` envelope（列表类顶层另带 `total` 时由调用方自拼）。 */
function ok(data: unknown, init?: ResponseInit) {
  return HttpResponse.json({ data }, init);
}

/** 契约 §0 错误体：`{ "detail": "<中文>", "code": "<机器码>" }`。 */
function fail(status: number, detail: string, code: string) {
  return HttpResponse.json({ detail, code }, { status });
}

/** 假 mp3 字节（前 10 字节是真实 ID3 头，后面是占位；测试只断言字节流可用）。 */
const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function audioResponse() {
  return new HttpResponse(AUDIO_BYTES, {
    headers: { 'Content-Type': 'audio/mpeg', 'X-Audio-Cache': 'hit' },
  });
}

// ============================================================
// #1 health
// ============================================================

const HEALTH: HealthResponse = {
  version: '2.0.0',
  ai_configured: false,
  ai_base_url_host: null,
  whisper: { loaded: false, model: 'small' },
  tts_ok: true,
  content_counts: { speaking: 8, listening: 8, reading: 8, writing: 8 },
};

export const healthHandlers = [
  http.get(`${API_BASE}/health`, () => ok(HEALTH)),
];

// ============================================================
// #2–#5 settings + ai-key（§4；PATCH 语义：未提供字段不动）
// ============================================================

const DEFAULT_SETTINGS: Settings = {
  target_band: 6.5,
  exam_date: '2027-01-15',
  daily_goal_minutes: 60,
  accent: 'en-GB',
  tts_voice: 'en-GB-SoniaNeural',
  tts_speed: 1.0,
  show_chinese_hints: true,
  show_punctuation: true,
  online_enabled: true,
  audio_device: null,
  recording_input_gain: 1.0,
  theme: 'system',
  ai: { configured: false, base_url_host: null, model: 'gpt-4o-mini', key_source: 'none' },
};

let settingsState: Settings = structuredClone(DEFAULT_SETTINGS);

/** 复位 handler 内部可变状态（setup.ts afterEach 调用）。 */
export function resetMockState() {
  settingsState = structuredClone(DEFAULT_SETTINGS);
}

export const settingsHandlers = [
  http.get(`${API_BASE}/settings`, () => ok(settingsState)),

  http.patch(`${API_BASE}/settings`, async ({ request }) => {
    const patch = (await request.json()) as Record<string, unknown>;
    // §4：只覆盖传入字段，`ai` 不接受 PATCH（key 走 #4/#5）。
    const merged: Record<string, unknown> = { ...settingsState };
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'ai') continue;
      merged[key] = value;
    }
    settingsState = merged as unknown as Settings;
    return ok(settingsState);
  }),

  http.put(`${API_BASE}/settings/ai-key`, async ({ request }) => {
    const body = (await request.json()) as { key?: string };
    // 与 `api/settings.py:188-195` 同规则：非字符串/空白/超 300/含控制字符 → 400 validation_failed
    const invalid =
      !body ||
      typeof body.key !== 'string' ||
      !body.key.trim() ||
      body.key.trim().length > 300 ||
      [...body.key.trim()].some((c) => c.codePointAt(0)! < 32);
    if (invalid) {
      return fail(400, 'AI key 格式不正确（长度应为 1–300 且不含控制字符）', 'validation_failed');
    }
    settingsState = {
      ...settingsState,
      ai: { ...settingsState.ai, configured: true, key_source: 'settings' },
    };
    const presence: AiKeyPresence = { ai_key_present: true };
    return ok(presence);
  }),

  http.delete(`${API_BASE}/settings/ai-key`, () => {
    settingsState = {
      ...settingsState,
      ai: { ...settingsState.ai, configured: false, key_source: 'none' },
    };
    const presence: AiKeyPresence = { ai_key_present: false };
    return ok(presence);
  }),
];

// ============================================================
// #6–#12 speaking（§2-S / §3-S）
// ============================================================

const SPEAKING_SET_META: SpeakingSetMeta = {
  id: 'sp_p2_environment_01',
  module: 'speaking',
  kind: 'practice',
  target_band: 6.5,
  title_zh: '环境类话题',
  topic: 'environment',
  parts: [1, 2],
};

const SPEAKING_SET: SpeakingSet = {
  id: 'sp_p2_environment_01',
  module: 'speaking',
  kind: 'practice',
  target_band: 6.5,
  title_zh: '环境类话题',
  topic: 'environment',
  source: 'ai:glm-4.6',
  generated_at: '2026-10-17T00:00:00Z',
  part1: [{ id: 'q1', question: 'Do you work or are you a student?' }],
  part2: {
    cue_card: {
      prompt: 'Describe a skill you would like to learn.',
      bullets: ['what it is', 'why you want to learn it', 'how you would learn it'],
      preparation_sec: 60,
      speaking_sec: 120,
    },
  },
  part3: [{ id: 'q1', question: 'Why do some people learn faster than others?', depends_on_part2: true }],
  fallback_questions: ['Do you think everyone should learn this skill?'],
  examiner_voice: 'en-GB-SoniaNeural',
};

const SPEAKING_PROMPT: SpeakingPrompt = {
  id: 'q1',
  part: 1,
  kind: 'question',
  text: 'Do you work or are you a student?',
  audio_url: null,
};

const SPEAKING_REPORT: SpeakingReport = {
  attempt_id: 'att_sp_mock_1',
  ai_used: false,
  degraded_reason: 'no_api_key',
  approximate: true,
  band: {
    overall: 6.0,
    fluency_coherence: 6.0,
    lexical_resource: 5.5,
    grammatical_range_accuracy: 6.0,
    pronunciation: 6.5,
    pronunciation_confidence: 'low',
  },
  evidence: [
    { criterion: 'lexical_resource', quote: 'a lot of good things', why: '用词空泛', level: '5.5' },
  ],
  strengths: ['回答完整覆盖了卡片要点'],
  improvements: [{ issue: '连接词单一', fix: '尝试 using however / on top of that', quote: 'and then' }],
  model_answer: 'A band 7 model answer about learning guitar.',
  upgrade_vocabulary: [{ from: 'good', to: 'rewarding', note_zh: '更有画面感' }],
  metrics: { word_count: 120, wpm: 105, pause_total_sec: 4.5, fillers: ['you know'], repeats: 1 },
  pronunciation_detail: {
    wer: 0.1,
    score_0_100: 80,
    problem_words: [{ word: 'thorough', expected: 'θ', actual: 's' }],
  },
};

export const speakingHandlers = [
  http.get(`${API_BASE}/speaking/sets`, () => ok({ items: [SPEAKING_SET_META] })),

  http.get(`${API_BASE}/speaking/sets/:setId`, () => ok(SPEAKING_SET)),

  http.post(`${API_BASE}/speaking/sessions`, async () => {
    const start: SpeakingSessionStart = {
      session_id: 'sess_sp_mock_1',
      part: 1,
      current: SPEAKING_PROMPT,
      index: 1,
      total: 1,
    };
    return ok(start);
  }),

  http.get(`${API_BASE}/speaking/sessions/:sessionId`, () => {
    const session: SpeakingSession = {
      session_id: 'sess_sp_mock_1',
      state: 'in_progress',
      prompts: [SPEAKING_PROMPT],
      turns: [],
      result: null,
    };
    return ok(session);
  }),

  // #10 multipart `audio` 或 form `text` + `duration_sec`
  http.post(`${API_BASE}/speaking/sessions/:sessionId/turn`, async ({ request }) => {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return fail(400, '缺少音频或文本输入', 'missing_input');
    }
    const form = await request.formData();
    const text = form.get('text');
    const transcript = typeof text === 'string' && text.trim() ? text.trim() : 'I work as an engineer.';
    const turn: SpeakingTurnResult = {
      turn_id: 'turn_mock_1',
      transcript,
      confidence: 0.9,
      next: null,
      elapsed_limit_reached: false,
    };
    return ok(turn);
  }),

  http.post(`${API_BASE}/speaking/sessions/:sessionId/assess`, () => ok(SPEAKING_REPORT)),

  http.post(`${API_BASE}/speaking/followups`, async () => {
    const followups: FollowupsResult = {
      questions: ['Why do some people learn faster than others?', 'Should schools teach this skill?'],
      ai_used: false,
      degraded_reason: 'no_api_key',
    };
    return ok(followups);
  }),
];

// ============================================================
// #13–#16 listening（§2-L / §3-OR；题面不含答案，audio_text 保留 —— §10.1）
// ============================================================

const LISTENING_SET_META: ListeningSetMeta = {
  id: 'li_s2_travel_03',
  module: 'listening',
  kind: 'practice',
  target_band: 6.5,
  title_zh: '博物馆参观',
  topic: 'travel',
  section: 2,
  accent: 'en-GB',
  question_count: 20,
};

const LISTENING_SET: ListeningSet = {
  id: 'li_s2_travel_03',
  module: 'listening',
  kind: 'practice',
  target_band: 6.5,
  title_zh: '博物馆参观',
  topic: 'travel',
  source: 'ai:glm-4.6',
  generated_at: '2026-10-17T00:00:00Z',
  section: 2,
  instruction_zh: '听录音，完成 11–20 题，每空不超过 TWO WORDS AND/OR A NUMBER。',
  audio_text: 'The museum opens at 9:30. The entrance is next to the fountain.',
  sentences: [
    { idx: 0, text: 'The museum opens at 9:30.', anchor_sec: 0 },
    { idx: 1, text: 'The entrance is next to the fountain.', anchor_sec: 4.5 },
  ],
  questions: [
    { id: 'q1', type: 'gap_fill', number: 11, prompt: 'The museum opens at ______.', word_limit: 3 },
    { id: 'q2', type: 'multiple_choice', number: 12, prompt: 'Why did the man call?', options: ['A. To book a ticket', 'B. To ask about opening hours', 'C. To cancel a visit'] },
  ],
};

const LISTENING_REPORT: ListeningObjectiveReport = {
  attempt_id: 'att_li_mock_1',
  module: 'listening',
  ai_used: false,
  approximate: false,
  raw_correct: 16,
  raw_total: 20,
  band: 7.0, // §3-B 锚点：16/20 → 7.0
  band_scale: 'listening_20q',
  items: [
    {
      id: 'q1',
      number: 11,
      type: 'gap_fill',
      your_answer: '9:30',
      expected: '9:30',
      accepted_alternatives: ['nine thirty'],
      correct: true,
    },
    {
      id: 'q2',
      number: 12,
      type: 'multiple_choice',
      your_answer: 'A',
      expected: 'B',
      correct: false,
      reason: 'wrong',
      explanation_zh: '原文中男士打电话是询问开放时间。',
    },
  ],
  by_question_type: { gap_fill: { correct: 9, total: 10 }, multiple_choice: { correct: 7, total: 10 } },
  accuracy: 0.8,
  transcript: 'The museum opens at 9:30. The entrance is next to the fountain.',
};

export const listeningHandlers = [
  http.get(`${API_BASE}/listening/sets`, () => ok({ items: [LISTENING_SET_META] })),

  http.get(`${API_BASE}/listening/sets/:setId`, () => ok(LISTENING_SET)),

  // #15 成功：audio/mpeg + X-Audio-Cache；503 场景留给 `server.use` 覆写（AC-L1b）
  http.get(`${API_BASE}/listening/sets/:setId/audio`, () => audioResponse()),

  http.post(`${API_BASE}/listening/sets/:setId/attempt`, () => ok(LISTENING_REPORT)),
];

// ============================================================
// #17–#19 reading（§2-R / §3-OR）
// ============================================================

const READING_SET_META: ReadingSetMeta = {
  id: 're_p_urban_02',
  module: 'reading',
  kind: 'practice',
  target_band: 6.5,
  title_zh: '十五分钟城市',
  topic: 'urban',
  level: 'upper-intermediate',
  question_count: 13,
};

const READING_SET: ReadingSet = {
  id: 're_p_urban_02',
  module: 'reading',
  kind: 'practice',
  target_band: 6.5,
  title_zh: '十五分钟城市',
  topic: 'urban',
  source: 'ai:glm-4.6',
  generated_at: '2026-10-17T00:00:00Z',
  level: 'upper-intermediate',
  title: 'The Twelve-Minute City',
  time_limit_sec: 1200,
  word_count: 874,
  passage: {
    paragraphs: [
      { label: 'A', text: 'Urban planners now imagine neighbourhoods where daily needs sit within a short walk.' },
      { label: 'B', text: 'Density matters more than distance when services are evenly distributed.' },
    ],
  },
  questions: [
    { id: 'q1', type: 'true_false_notgiven', number: 1, statement: 'The concept relies only on distance.' },
    { id: 'q3', type: 'sentence_completion', number: 3, prompt: '…the ______ of the city matters most.', word_limit: 2 },
  ],
};

const READING_REPORT: ReadingObjectiveReport = {
  attempt_id: 'att_re_mock_1',
  module: 'reading',
  ai_used: false,
  approximate: false,
  raw_correct: 10,
  raw_total: 13,
  band: 7.0, // §3-B 锚点：10/13 → 7.0
  band_scale: 'reading_13q',
  items: [
    {
      id: 'q1',
      number: 1,
      type: 'true_false_notgiven',
      your_answer: 'FALSE',
      expected: 'NOTGIVEN',
      correct: false,
      reason: 'wrong',
      explanation_zh: '原文未讨论“仅依赖距离”的说法。',
      answer_paragraph: 'B',
      answer_quote: 'Density matters more than distance',
    },
  ],
  by_question_type: { true_false_notgiven: { correct: 3, total: 5 }, sentence_completion: { correct: 7, total: 8 } },
  accuracy: 10 / 13,
  timed_out: false,
};

export const readingHandlers = [
  http.get(`${API_BASE}/reading/sets`, () => ok({ items: [READING_SET_META] })),

  http.get(`${API_BASE}/reading/sets/:setId`, () => ok(READING_SET)),

  http.post(`${API_BASE}/reading/sets/:setId/attempt`, () => ok(READING_REPORT)),
];

// ============================================================
// #20–#22 writing（§2-W / §3-W）
// ============================================================

const WRITING_TASKS: WritingTask[] = [
  {
    id: 'wr_t1_energy_04',
    module: 'writing',
    kind: 'practice',
    target_band: 6.5,
    title_zh: '能源折线图',
    topic: 'energy',
    source: 'ai:glm-4.6',
    generated_at: '2026-10-17T00:00:00Z',
    task: 'task1',
    prompt: 'The chart below shows energy production in million tonnes. Summarise the information.',
    min_words: 150,
    time_recommend_sec: 1200,
    chart: {
      type: 'line',
      unit: 'million tonnes',
      years: [2000, 2010, 2020],
      series: [{ name: 'Coal', values: [120, 98, 64] }],
      source_note: 'Data generated for practice',
    },
  },
  {
    id: 'wr_t2_tech_02',
    module: 'writing',
    kind: 'practice',
    target_band: 6.5,
    title_zh: '科技利弊讨论',
    topic: 'technology',
    source: 'ai:glm-4.6',
    generated_at: '2026-10-17T00:00:00Z',
    task: 'task2',
    prompt: 'Some people think technology isolates us. To what extent do you agree or disagree?',
    min_words: 250,
    time_recommend_sec: 2400,
    question_type: 'agree_disagree',
    outline_hint: ['Introduce your position', 'Give two reasons', 'Conclude'],
  },
];

const WRITING_REPORT: WritingReport = {
  attempt_id: 'att_wr_mock_1',
  task: 'task2',
  ai_used: false,
  degraded_reason: 'no_api_key',
  approximate: true,
  band: {
    overall: 6.0,
    task_response: 6.0,
    coherence_cohesion: 6.5,
    lexical_resource: 6.0,
    grammatical_range_accuracy: 5.5,
  },
  word_count: 268,
  word_count_penalty: null,
  corrections: [
    { quote: 'people is', error_type: 'grammar', explanation_zh: '主谓一致', suggestion: 'people are', severity: 'high' },
  ],
  upgraded_sentences: [{ from: 'Technology is good.', to: 'Technology offers tangible benefits.', why_zh: '更具体' }],
  structure_issues: [{ kind: 'paragraph_function', issue_zh: '第三段缺少主题句', paragraph_index: 3 }],
  strengths: ['论证结构清晰'],
  model_answer: 'A band 7 model essay on technology and isolation.',
  error_summary: { grammar: 1 },
};

export const writingHandlers = [
  http.get(`${API_BASE}/writing/tasks`, () => ok({ items: WRITING_TASKS })),

  http.post(`${API_BASE}/writing/attempts`, () => ok(WRITING_REPORT)),

  http.get(`${API_BASE}/writing/attempts/:attemptId`, () => ok(WRITING_REPORT)),
];

// ============================================================
// #23–#25 attempts（§10.2：列表/详情主键字段名是 `id`）
// ============================================================

const ATTEMPT_SUMMARY: AttemptSummary = {
  id: 'att_li_mock_1',
  module: 'listening',
  task_ref: 'li_s2_travel_03',
  part: null,
  title_zh: '博物馆参观',
  topic: 'travel',
  band_overall: 7.0,
  band_sub: null,
  raw_correct: 16,
  raw_total: 20,
  duration_sec: 900,
  started_at: '2026-10-18T01:00:00Z',
  created_at: '2026-10-18T01:15:00Z',
  ai_used: false,
  approximate: false,
};

export const attemptsHandlers = [
  // #23 data 为 `{items, total}`
  http.get(`${API_BASE}/attempts`, () => ok({ items: [ATTEMPT_SUMMARY], total: 1 })),

  // #24 `{attempt, payload}`
  http.get(`${API_BASE}/attempts/:attemptId`, () => {
    const detail: AttemptDetail = { attempt: ATTEMPT_SUMMARY, payload: LISTENING_REPORT };
    return ok(detail);
  }),

  http.delete(`${API_BASE}/attempts/:attemptId`, () => ok({ deleted: true })),
];

// ============================================================
// #26–#28 progress
// ============================================================

const PROGRESS_SUMMARY: ProgressSummary = {
  target_band: 6.5,
  exam_date: '2027-01-15',
  days_left: 90,
  current: { speaking: 6.0, listening: 7.0, reading: null, writing: null },
  delta_vs_previous: { speaking: 0.5, listening: 0, reading: null, writing: null },
  attempts_total: 12,
  minutes_total: 340,
  last_practice_at: '2026-10-18T01:15:00Z',
};

export const progressHandlers = [
  http.get(`${API_BASE}/progress/summary`, () => ok(PROGRESS_SUMMARY)),

  http.get(`${API_BASE}/progress/trend`, () => {
    const trend: ProgressTrend = {
      points: [
        { date: '2026-10-17', band: 6.5 },
        { date: '2026-10-18', band: 7.0 },
      ],
    };
    return ok(trend);
  }),

  http.get(`${API_BASE}/progress/analytics`, () => {
    const analytics: Analytics = {
      by_question_type: [
        { question_type: 'gap_fill', correct: 9, total: 10, accuracy: 0.9 },
        { question_type: 'multiple_choice', correct: 7, total: 10, accuracy: 0.7 },
      ],
      by_error_type: [{ error_type: 'grammar', count: 4, latest_quote: 'people is' }],
      minutes_by_day: [{ date: '2026-10-18', minutes: 45 }],
    };
    return ok(analytics);
  }),
];

// ============================================================
// #29–#30 plan
// ============================================================

export const planHandlers = [
  http.get(`${API_BASE}/plan/today`, () => {
    const task: PlanTask = {
      id: 'plan_mock_1',
      date: '2026-10-18',
      module: 'listening',
      set_ref: 'li_s2_travel_03',
      reason_zh: '选择题正确率最低，优先练 Section 2',
      done: false,
    };
    const result: PlanTodayResult = { items: [task], generated_at: '2026-10-18T00:05:00Z' };
    return ok(result);
  }),

  http.post(`${API_BASE}/plan/:taskId/done`, () => ok({ ok: true })),
];

// ============================================================
// #31–#33 review（取代旧 wrong-records）
// ============================================================

const REVIEW_ITEM: ReviewItem = {
  id: 'rev_mock_1',
  module: 'writing',
  item_ref: 'att_wr_mock_1:people-is',
  question_type: null,
  error_type: 'grammar',
  quote: 'people is',
  detail_zh: '主谓一致：people 是复数。',
  status: 'open',
  first_seen_at: '2026-10-17T10:00:00Z',
  last_seen_at: '2026-10-18T09:00:00Z',
  seen_count: 2,
  resolved_at: null,
  source_attempt_id: 'att_wr_mock_1',
};

export const reviewHandlers = [
  http.get(`${API_BASE}/review/errors`, () => ok({ items: [REVIEW_ITEM] })),

  http.post(`${API_BASE}/review/:reviewId/resolve`, () => ok({ status: 'resolved' })),

  http.delete(`${API_BASE}/review/:reviewId`, () => ok({ deleted: true })),
];

// ============================================================
// #34–#38 vocab（取代旧 wordbook）
// ============================================================

const VOCAB_NOTE: VocabNote = {
  word: 'rewarding',
  context: 'Learning a language is rewarding.',
  source_module: 'speaking',
  source_ref: 'sp_p2_environment_01',
  note_zh: '有回报的',
  tags: ['topic:education'],
  created_at: '2026-10-18T08:00:00Z',
};

function wordInfoFixture(word: string): WordInfo {
  return {
    word,
    phonetic: '/rɪˈwɔː.dɪŋ/',
    zh: '有回报的',
    difficulty: 3,
    examples: ['Teaching can be very rewarding.'],
    source: 'local',
    audio_url: `${API_BASE}/tts?text=${encodeURIComponent(word)}`,
    collocations: ['a rewarding experience'],
    topic: 'education',
  };
}

export const vocabHandlers = [
  // #34 GET /vocab?word= → WordInfo；#36 GET /vocab → {items}
  http.get(`${API_BASE}/vocab`, ({ request }) => {
    const word = new URL(request.url).searchParams.get('word');
    if (word) return ok(wordInfoFixture(word));
    return ok({ items: [VOCAB_NOTE] });
  }),

  http.post(`${API_BASE}/vocab`, async ({ request }) => {
    const body = (await request.json()) as Partial<VocabNote>;
    const note: VocabNote = {
      word: typeof body.word === 'string' ? body.word : 'unknown',
      context: body.context ?? '',
      source_module: (body.source_module as VocabNote['source_module']) ?? null,
      source_ref: body.source_ref ?? null,
      note_zh: body.note_zh ?? '',
      tags: body.tags ?? [],
      created_at: '2026-10-18T08:00:00Z',
    };
    return ok(note);
  }),

  http.delete(`${API_BASE}/vocab/:word`, () => ok({ deleted: true })),

  // #38 文件响应不走 envelope（CSV；anki 为 TSV）
  http.get(`${API_BASE}/vocab/export`, ({ request }) => {
    const format = new URL(request.url).searchParams.get('format') ?? 'csv';
    const separator = format === 'anki' ? '\t' : ',';
    const csv = [`word${separator}note_zh`, `rewarding${separator}有回报的`].join('\n');
    return new HttpResponse(csv, {
      headers: {
        'Content-Type': format === 'anki' ? 'text/tab-separated-values' : 'text/csv',
        'Content-Disposition': `attachment; filename="vocab.${format === 'anki' ? 'tsv' : 'csv'}"`,
      },
    });
  }),
];

// ============================================================
// #39 tts（保留；voice 支持口音参数）与 POST /stt（§10.2：前端不直调，兜底保留）
// ============================================================

export const ttsHandlers = [
  http.get(`${API_BASE}/tts`, ({ request }) => {
    const text = new URL(request.url).searchParams.get('text');
    if (!text) return fail(400, '缺少文本参数', 'missing_text');
    return audioResponse();
  }),
];

export const sttHandlers = [
  http.post(`${API_BASE}/stt`, () => ok({ text: 'hello world', confidence: 0.95 })),
];

// ============================================================
// 全量集合（server.ts 默认挂载用；feature 测试请优先按组 server.use）
// ============================================================

export const handlers = [
  ...healthHandlers,
  ...settingsHandlers,
  ...speakingHandlers,
  ...listeningHandlers,
  ...readingHandlers,
  ...writingHandlers,
  ...attemptsHandlers,
  ...progressHandlers,
  ...planHandlers,
  ...reviewHandlers,
  ...vocabHandlers,
  ...ttsHandlers,
  ...sttHandlers,
];
