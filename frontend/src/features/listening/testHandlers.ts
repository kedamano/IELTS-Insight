/**
 * listening/testHandlers.ts —— 听力屏自己的 msw 处理器（Wave 2 约定）。
 *
 * 基础 handlers 由 qa 并行重写，所以本文件**不依赖** `src/test/mocks/handlers.ts`，
 * 只按契约 §1 #13–#16 的响应形状自备 fixture，由测试用 `server.use(...)` 注册。
 * fixture 文本均为本文件自写的占位内容，不含任何真题或教材原文。
 */
import { HttpResponse, http } from 'msw';
import type { RequestHandler } from 'msw';
import type {
  AnswerMap,
  HealthResponse,
  ListeningObjectiveReport,
  ListeningQuestionWithAnswers,
  ListeningSet,
  ListeningSetMeta,
  ListeningQuestionPublic,
  ObjectiveItemReason,
  ObjectiveReportItem,
  QuestionType,
  QuestionTypeTally,
  Settings,
} from '../../types/ielts';

const BASE = 'http://127.0.0.1:8765/api';

function ok<T>(data: T, init?: ResponseInit) {
  return HttpResponse.json({ data }, init);
}

export const listeningHealth: HealthResponse = {
  version: '2.0.0',
  ai_configured: false,
  ai_base_url_host: null,
  whisper: { loaded: false, model: 'base' },
  tts_ok: true,
  content_counts: { speaking: 6, listening: 2, reading: 2, writing: 6 },
};

export const listeningSettings: Settings = {
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
  ai: { configured: false, base_url_host: null, model: null, key_source: 'none' },
};

export const listeningSetId = 'li_s2_travel_03';

/** 20 题（2 section × 10，官方题号 11–30，FR-L2）；题面不带答案（§2-L）。 */
export const listeningQuestions: ListeningQuestionPublic[] = [
  { id: 'q1', type: 'gap_fill', number: 11, prompt: 'The museum opens at ______.', word_limit: 3 },
  { id: 'q2', type: 'gap_fill', number: 12, prompt: 'Visitors must leave their bags at the ______.' },
  { id: 'q3', type: 'gap_fill', number: 13, prompt: 'The guided tour starts on the ______ floor.', word_limit: 2 },
  { id: 'q4', type: 'multiple_choice', number: 14, prompt: 'Why did the man call the museum?', options: ['A. To change his ticket', 'B. To ask about parking', 'C. To book a tour'] },
  { id: 'q5', type: 'multiple_choice', number: 15, prompt: 'What is free for students?', options: ['A. The audio guide', 'B. The café lunch', 'C. The map'] },
  { id: 'q6', type: 'matching', number: 16, prompt: 'Match each person to an activity.', options_list: ['A. pottery workshop', 'B. fossil talk', 'C. night tour'] },
  { id: 'q7', type: 'matching', number: 17, prompt: 'Match each person to an activity.', options_list: ['A. pottery workshop', 'B. fossil talk', 'C. night tour'] },
  { id: 'q8', type: 'map_diagram_label', number: 18, prompt: 'Where is the new entrance?', labels: ['A', 'B', 'C'], diagram_note: '北角为礼品店，东侧为展厅。' },
  { id: 'q9', type: 'map_diagram_label', number: 19, prompt: 'Where is the café?', labels: ['A', 'B', 'C'] },
  { id: 'q10', type: 'gap_fill', number: 20, prompt: 'The last bus leaves at ______.', word_limit: 3 },
  { id: 'q11', type: 'gap_fill', number: 21, prompt: 'The workshop costs ______ pounds.', word_limit: 2 },
  { id: 'q12', type: 'multiple_choice', number: 22, prompt: 'What should visitors bring?', options: ['A. A photo ID', 'B. A raincoat', 'C. A pen'] },
  { id: 'q13', type: 'gap_fill', number: 23, prompt: 'Group bookings close ______ days in advance.', word_limit: 2 },
  { id: 'q14', type: 'matching', number: 24, prompt: 'Match each item to its rule.', options_list: ['A. no flash', 'B. keep distance', 'C. staff only'] },
  { id: 'q15', type: 'map_diagram_label', number: 25, prompt: 'Where is the exit?', labels: ['A', 'B', 'C'] },
  { id: 'q16', type: 'gap_fill', number: 26, prompt: 'Members get a ______ discount.', word_limit: 2 },
  { id: 'q17', type: 'multiple_choice', number: 27, prompt: 'How long is the tour?', options: ['A. 45 minutes', 'B. 90 minutes', 'C. 2 hours'] },
  { id: 'q18', type: 'gap_fill', number: 28, prompt: 'The talk is about local ______.', word_limit: 2 },
  { id: 'q19', type: 'matching', number: 29, prompt: 'Match each item to its rule.', options_list: ['A. no flash', 'B. keep distance', 'C. staff only'] },
  { id: 'q20', type: 'gap_fill', number: 30, prompt: 'Open every day except ______.', word_limit: 1 },
];

/** 答案键只在测试里存在（真实后端才持有；GET 响应必须剔除）。 */
export const listeningAnswerKey: Record<string, string> = {
  q1: '9:30',
  q2: 'left desk',
  q3: 'ground',
  q4: 'B',
  q5: 'A',
  q6: 'C',
  q7: 'A',
  q8: 'A',
  q9: 'B',
  q10: '6 pm',
  q11: '12',
  q12: 'A',
  q13: 'seven',
  q14: 'A',
  q15: 'C',
  q16: 'fifty',
  q17: 'B',
  q18: 'plants',
  q19: 'B',
  q20: 'Monday',
};

export const listeningSetDoc: ListeningSet = {
  id: listeningSetId,
  module: 'listening',
  kind: 'practice',
  target_band: 6.5,
  title_zh: '博物馆参观（自写练习）',
  topic: 'travel',
  source: 'hand',
  generated_at: '2026-10-17T12:00:00Z',
  section: 2,
  instruction_zh: '听录音，完成 11–30 题，每空不超过 TWO WORDS AND/OR A NUMBER。',
  // AC-L1b：题面接口保留 audio_text 供精读回落
  audio_text:
    'Welcome to the city museum. The museum opens at 9:30 and the last bus leaves at 6 pm. ' +
    'Visitors must leave their bags at the left desk. The guided tour starts on the ground floor. ' +
    'Please note that flash photography is not allowed in the main hall.',
  sentences: [
    { idx: 0, text: 'Welcome to the city museum.', anchor_sec: 0 },
    { idx: 1, text: 'The museum opens at 9:30.', anchor_sec: 12 },
    { idx: 2, text: 'Visitors must leave their bags at the left desk.', anchor_sec: 26.5 },
    { idx: 3, text: 'The guided tour starts on the ground floor.', anchor_sec: 41 },
  ],
  questions: listeningQuestions,
  accent: 'en-GB',
};

export const listeningMeta: ListeningSetMeta = {
  id: listeningSetDoc.id,
  module: 'listening',
  kind: 'practice',
  target_band: 6.5,
  title_zh: listeningSetDoc.title_zh,
  topic: listeningSetDoc.topic,
  source: 'hand',
  generated_at: listeningSetDoc.generated_at,
  question_count: listeningQuestions.length,
  section: 2,
  accent: 'en-GB',
};

export const mockTestMeta: ListeningSetMeta = {
  ...listeningMeta,
  id: 'li_s4 campus_01'.replace(' ', ''),
  kind: 'mock_test',
  title_zh: '模拟卷（预留）',
  topic: 'campus',
};

// ============================================================
// §3-B 的 20 题换算表（测试端复刻，锚点 16→7.0、13→6.0）
// ============================================================

const LISTENING_20: readonly [number, number][] = [
  [20, 9.0], [19, 8.5], [18, 8.0], [17, 7.5], [16, 7.0], [14, 6.5], [13, 6.0], [11, 5.5],
  [10, 5.0], [8, 4.5], [7, 4.0], [5, 3.5], [4, 3.0], [3, 2.5], [2, 2.0], [1, 1.5],
];

export function bandForRaw(rawCorrect: number, total = 20): number {
  if (total !== 20) return rawCorrect >= total ? 9 : 0;
  const clamped = Math.max(0, Math.min(total, rawCorrect));
  let band = 0;
  for (const [raw, value] of LISTENING_20) {
    if (clamped >= raw) {
      band = value;
      break;
    }
  }
  return band;
}

/** 与后端一致的宽松判分（忽略大小写/前后空格），超限与未答各有独立 reason（FR-L3）。 */

/**
 * 复刻 `app/services/answer_norm.py` 的 `judge_choice`：非填空题型把整条选项文本
 * （`"B. To ask about parking"`）归约为首字母，与题库 `answer` 的字面等价。
 * 归约前是 `judge_fill` 的口径（FR-L3：大小写/前后空格宽松 + `word_limit`）。
 */
function optionLetter(value: string): string {
  const matched = /^([a-p])[.)\s]/i.exec(value.trim());
  return matched ? matched[1].toLowerCase() : value.toLowerCase();
}

function gradeItem(
  question: ListeningQuestionWithAnswers,
  value: string | undefined,
): ObjectiveReportItem {
  const trimmed = (value ?? '').trim();
  const expected = listeningAnswerKey[question.id] ?? '';
  // 只有填空题带 `word_limit`，联合类型上必须先收窄再取（选择题没有这个字段）。
  const limit = 'word_limit' in question && typeof question.word_limit === 'number' ? question.word_limit : null;
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const isChoice = question.type !== 'gap_fill';

  let reason: ObjectiveItemReason | null = null;
  if (!trimmed) reason = 'unanswered';
  else if (limit !== null && words > limit) reason = 'over_word_limit';
  else if (isChoice) {
    reason = optionLetter(trimmed) === optionLetter(expected) ? null : 'wrong';
  } else if (trimmed.toLowerCase() !== expected.toLowerCase()) reason = 'wrong';

  return {
    id: question.id,
    number: question.number,
    type: question.type,
    your_answer: trimmed || null,
    expected,
    accepted_alternatives: [],
    correct: reason === null,
    reason,
    explanation_zh: reason === null ? undefined : `第 ${question.number} 题自写解析占位。`,
    answer_quote: reason === null ? undefined : expected,
    answer_paragraph: reason === null ? undefined : 'B',
    time_spent_sec: 20,
  };
}

export function listeningReport(partial: Partial<ListeningObjectiveReport> = {}): ListeningObjectiveReport {
  return {
    attempt_id: 'att_listening_0001',
    module: 'listening',
    ai_used: false,
    degraded_reason: null,
    approximate: false,
    raw_correct: 16,
    raw_total: 20,
    band: 7,
    band_scale: 'listening_20q',
    accuracy: 0.8,
    transcript: 'Welcome to the city museum. The museum opens at 9:30.',
    items: listeningQuestions.map((question) => gradeItem({ ...question, answer: listeningAnswerKey[question.id] }, listeningAnswerKey[question.id])),
    by_question_type: tallyOf(listeningQuestions.map((question) => question.type)),
    ...partial,
  };
}

function tallyOf(types: QuestionTypeTallyKey[]): Partial<Record<string, QuestionTypeTally>> {
  const counts: Record<string, QuestionTypeTally> = {};
  for (const type of types) {
    counts[type] = { correct: (counts[type]?.correct ?? 0) + 1, total: (counts[type]?.total ?? 0) + 1 };
  }
  return counts;
}

// 报告里的 `by_question_type` 键是完整 `QuestionType`（含 true_false_notgiven），
// 而题面联合 `ListeningQuestionPublic['type']` 少了它 —— 用前者，否则 item.type 索引不进去。
type QuestionTypeTallyKey = QuestionType;

// ============================================================
// handlers
// ============================================================

export interface ListeningAttemptCall {
  setId: string;
  answers: AnswerMap;
  durationSec: number | null;
  timedOut: boolean | null;
}

/** 原始请求记录（契约断言用：方法 / 完整 URL / 未经解析的 body 键）。 */
export interface ListeningRequestRecord {
  method: string;
  url: string;
  /** attempt 的 JSON body 原样（键集合就是客户端发出的键集合）。 */
  body?: Record<string, unknown>;
}

export interface ListeningTestContext {
  handlers: readonly RequestHandler[];
  attemptCalls: ListeningAttemptCall[];
  /** #15 的可用性可在测试中途改写（模拟后端恢复后点「重试音频」）。 */
  setAudioMode: (mode: 'ok' | 'unavailable' | 'network-error') => void;
  /** #16 的失败可在测试中途撤掉（模拟后端恢复后重试提交，CONSTITUTION §3）。 */
  setAttemptError: (error: { status: number; code: string; detail: string } | null) => void;
  requests: ListeningRequestRecord[];
  audioCalls: { setId: string; accent: string | null }[];
  setCalls: string[];
  listQueries: { accent: string | null; kind: string | null }[];
}

export interface ListeningHandlerOptions {
  /** #13 列表 */
  sets?: ListeningSetMeta[];
  /** #14 题面文档 */
  set?: ListeningSet;
  /** 题面接口失败（例如 404） */
  setError?: { status: number; code: string; detail: string };
  /** #15 音频：ok = 可播字节，unavailable = 503 tts_unavailable（AC-L1b） */
  audio?: 'ok' | 'unavailable' | 'network-error';
  /**
   * 503 响应体（契约 §1 #15）。默认带 `transcript_available`，
   * 测试可传不含该字段的体来证明客户端不依赖它（§10.5 裁定 1）。
   */
  audio503Body?: { detail: string; code: string; transcript_available?: boolean };
  /** #16 批改响应；缺省时按答案键真实判分生成 */
  report?: ListeningObjectiveReport;
  /** 覆盖 attempt 的判分输入（默认用提交上来的 answers 逐题判分） */
  grade?: boolean;
  attemptError?: { status: number; code: string; detail: string };
  settings?: Settings;
  health?: HealthResponse;
}

const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x04]);

export function createListeningHandlers(options: ListeningHandlerOptions = {}): ListeningTestContext {
  const doc = options.set ?? listeningSetDoc;
  const attemptCalls: ListeningAttemptCall[] = [];
  const audioCalls: ListeningTestContext['audioCalls'] = [];
  const setCalls: string[] = [];
  const requests: ListeningRequestRecord[] = [];
  const listQueries: ListeningTestContext['listQueries'] = [];
  let audioMode = options.audio ?? 'ok';
  let attemptError = options.attemptError ?? null;

  const handlers: RequestHandler[] = [
    http.get(`${BASE}/health`, () => ok(options.health ?? listeningHealth)),
    http.get(`${BASE}/settings`, () => ok(options.settings ?? listeningSettings)),

    http.get(`${BASE}/listening/sets`, ({ request }) => {
      const url = new URL(request.url);
      listQueries.push({ accent: url.searchParams.get('accent'), kind: url.searchParams.get('kind') });
      const accent = url.searchParams.get('accent');
      const kind = url.searchParams.get('kind');
      const all = options.sets ?? [listeningMeta, mockTestMeta];
      const items = all.filter(
        (meta) => (!accent || meta.accent === accent) && (!kind || meta.kind === kind),
      );
      return ok({ items });
    }),

    http.get(`${BASE}/listening/sets/:id`, ({ params }) => {
      setCalls.push(String(params.id));
      if (options.setError) {
        return HttpResponse.json(
          { detail: options.setError.detail, code: options.setError.code },
          { status: options.setError.status },
        );
      }
      // 题面响应必须剔除答案（§2-L）：这里返回的就是无答案文档
      return ok<ListeningSet>(doc);
    }),

    http.get(`${BASE}/listening/sets/:id/audio`, ({ request, params }) => {
      const url = new URL(request.url);
      const isFirstFetch = audioCalls.length === 0;
      audioCalls.push({ setId: String(params.id), accent: url.searchParams.get('accent') });
      requests.push({ method: 'GET', url: url.toString() });
      if (audioMode === 'unavailable') {
        const body503 =
          options.audio503Body ?? {
            detail: '语音合成不可用（离线）',
            code: 'tts_unavailable',
            transcript_available: true,
          };
        return HttpResponse.json(body503, { status: 503 });
      }
      if (audioMode === 'network-error') return HttpResponse.error();
      // AC-L1：同一 set 的第二次取音频命中缓存
      return new HttpResponse(AUDIO_BYTES, {
        headers: { 'Content-Type': 'audio/mpeg', 'X-Audio-Cache': isFirstFetch ? 'miss' : 'hit' },
      });
    }),

    http.post(`${BASE}/listening/sets/:id/attempt`, async ({ request, params }) => {
      const body = (await request.json()) as {
        answers?: AnswerMap;
        duration_sec?: number;
        timed_out?: boolean;
      };
      requests.push({ method: 'POST', url: request.url, body });
      const call: ListeningAttemptCall = {
        setId: String(params.id),
        answers: body.answers ?? {},
        durationSec: typeof body.duration_sec === 'number' ? body.duration_sec : null,
        timedOut: typeof body.timed_out === 'boolean' ? body.timed_out : null,
      };
      attemptCalls.push(call);

      if (attemptError) {
        return HttpResponse.json(
          { detail: attemptError.detail, code: attemptError.code },
          { status: attemptError.status },
        );
      }
      if (options.report) return ok<ListeningObjectiveReport>(options.report);
      if (options.grade === false) return ok<ListeningObjectiveReport>(listeningReport());

      const items = doc.questions.map((question) =>
        gradeItem({ ...question, answer: listeningAnswerKey[question.id] } as ListeningQuestionWithAnswers, call.answers[question.id]),
      );
      const rawCorrect = items.filter((item) => item.correct).length;
      const byType: Partial<Record<QuestionTypeTallyKey, QuestionTypeTally>> = {};
      for (const item of items) {
        const bucket = byType[item.type] ?? { correct: 0, total: 0 };
        bucket.total += 1;
        if (item.correct) bucket.correct += 1;
        byType[item.type] = bucket;
      }
      return ok<ListeningObjectiveReport>({
        attempt_id: 'att_listening_test',
        module: 'listening',
        ai_used: false,
        degraded_reason: null,
        approximate: false,
        raw_correct: rawCorrect,
        raw_total: items.length,
        band: bandForRaw(rawCorrect, items.length),
        band_scale: 'listening_20q',
        accuracy: items.length ? rawCorrect / items.length : 0,
        transcript: doc.audio_text,
        items,
        by_question_type: byType,
      });
    }),
  ];

  return {
    handlers,
    attemptCalls,
    audioCalls,
    setCalls,
    listQueries,
    requests,
    setAudioMode: (mode) => {
      audioMode = mode;
    },
    setAttemptError: (error) => {
      attemptError = error;
    },
  };
}
