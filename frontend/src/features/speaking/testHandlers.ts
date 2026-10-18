/**
 * speaking/testHandlers.ts —— 口语屏自己的 msw 处理器（Wave 2 约定）。
 *
 * 基础 handlers 正由 qa 并行重写，所以本文件**不依赖** `src/test/mocks/handlers.ts` 的内容，
 * 只按契约 §1 #6–#12、#11b/#22b 的响应形状自备 fixture，由各测试用 `server.use(...)` 注册；
 * 异步评分的 `jobs` 端点复用 `src/test/mocks/gradingJobs.ts`。
 * fixture 文本是本文件自写的占位内容（不含任何真题/教材原文）。
 */
import { HttpResponse, http } from 'msw';
import type { RequestHandler } from 'msw';
import { createJobMock } from '../../test/mocks/gradingJobs';
import type {
  FollowupsResult,
  HealthResponse,
  Settings,
  SpeakingGradingJob,
  SpeakingPrompt,
  SpeakingReport,
  SpeakingSet,
  SpeakingSetMeta,
  SpeakingTurnResult,
} from '../../types/ielts';

const BASE = 'http://127.0.0.1:8765/api';

function ok<T>(data: T, init?: ResponseInit) {
  return HttpResponse.json({ data }, init);
}

export const speakingHealth: HealthResponse = {
  version: '2.0.0',
  ai_configured: true,
  ai_base_url_host: 'api.example.test',
  whisper: { loaded: true, model: 'base' },
  tts_ok: true,
  content_counts: { speaking: 6, listening: 2, reading: 2, writing: 6 },
};

export const speakingSettings: Settings = {
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

export const part1Prompt: SpeakingPrompt = {
  id: 'q1',
  part: 1,
  kind: 'question',
  text: 'Do you enjoy cooking meals at home?',
  // 离线场景：audio_url 为 null（契约 §10.2），界面必须显示「无音频」
  audio_url: null,
};

const part1Prompt2: SpeakingPrompt = { ...part1Prompt, id: 'q2', text: 'Who taught you to cook?' };
const part1Prompt3: SpeakingPrompt = { ...part1Prompt, id: 'q3', text: 'Would you like to learn another cuisine?' };

export const cueCardPrompt: SpeakingPrompt = {
  id: 'cue_card',
  part: 2,
  kind: 'cue_card',
  text: 'Describe a skill you would like to learn.',
  bullets: ['what it is', 'why you want it', 'how you would learn it'],
  preparation_sec: 60,
  speaking_sec: 120,
  audio_url: null,
};

export const part1Set: SpeakingSet = {
  id: 'sp_p1_cooking_04',
  module: 'speaking',
  kind: 'practice',
  target_band: 6.5,
  title_zh: '烹饪',
  topic: 'cooking',
  source: 'hand',
  generated_at: '2026-10-17T12:00:00Z',
  // §10.1 一文件一 part：part:1 的文件没有 part2/part3
  part2: { cue_card: { prompt: '', bullets: [], preparation_sec: 60, speaking_sec: 120 } },
  part1: [
    { id: 'q1', question: part1Prompt.text },
    { id: 'q2', question: part1Prompt2.text },
    { id: 'q3', question: part1Prompt3.text },
  ],
  part3: [],
  fallback_questions: ['Should schools teach cooking to every student?'],
  examiner_voice: 'en-GB-SoniaNeural',
};

export const part2Set: SpeakingSet = {
  ...part1Set,
  id: 'sp_p2_skill_01',
  title_zh: '想学的技能',
  topic: 'skill',
  part2: {
    cue_card: {
      prompt: cueCardPrompt.text,
      bullets: cueCardPrompt.bullets ?? [],
      preparation_sec: 60,
      speaking_sec: 120,
    },
  },
  part1: [],
  part3: [
    { id: 'q1', question: 'Why do some people learn faster than others?', depends_on_part2: true },
    { id: 'q2', question: 'Can anyone learn a difficult skill later in life?', depends_on_part2: true },
  ],
  fallback_questions: ['Is talent more important than practice?', 'What is the hardest skill to master?'],
};

export const part1Meta: SpeakingSetMeta & { part?: number } = {
  id: part1Set.id,
  module: 'speaking',
  kind: 'practice',
  target_band: 6.5,
  title_zh: part1Set.title_zh,
  topic: part1Set.topic,
  source: 'hand',
  generated_at: part1Set.generated_at,
  // 契约 §10.1：`part: 1|2` 是必填整数，part:1 的文件只有 part1[]
  part: 1,
};

export const part2Meta: SpeakingSetMeta & { part?: number } = {
  ...part1Meta,
  id: part2Set.id,
  title_zh: part2Set.title_zh,
  topic: part2Set.topic,
  // 契约 §10.1：后端实际下发 `part`（types 里是 `parts?`），两种都要能被选择器读懂
  part: 2,
};

export function turnResult(partial: Partial<SpeakingTurnResult> = {}): SpeakingTurnResult {
  return {
    turn_id: 'turn_1',
    transcript: 'I would like to learn because it helps me every day.',
    confidence: 0.91,
    next: null,
    elapsed_limit_reached: false,
    ...partial,
  };
}

export function speakingReport(partial: Partial<SpeakingReport> = {}): SpeakingReport {
  return {
    attempt_id: 'att_speaking_0001',
    ai_used: true,
    degraded_reason: null,
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
      {
        criterion: 'lexical_resource',
        quote: 'it helps me every day',
        why: '用词偏日常，可换成更具体的搭配',
        level: '6.0',
      },
    ],
    strengths: ['回答完整覆盖了题卡的三个提示点'],
    improvements: [
      { issue: '例子太笼统', fix: '加一个具体场景与结果', quote: 'I would like to learn' },
      { issue: '连接词单一', fix: '用 besides / as a result 串联' },
      { issue: '时态混用', fix: '描述计划用 would + 动词原形' },
    ],
    model_answer: 'A skill I would love to learn is photo editing, because…',
    upgrade_vocabulary: [{ from: 'helps me', to: 'saves me time', note_zh: '更具体的收益表达', source: 'ai:glm-4.6' }],
    metrics: { word_count: 42, wpm: 112, pause_total_sec: 6.4, fillers: ['you know'], repeats: 2 },
    pronunciation_detail: {
      wer: 0.12,
      score_0_100: 78,
      problem_words: [{ word: 'think', expected: 'θ', actual: 's' }],
    },
    ...partial,
  };
}

export interface SpeakingTurnCall {
  /** multipart 里的音频字节长度（0 = 文本路径） */
  audioBytes: number;
  text: string | null;
  durationSec: string | null;
  sessionId: string;
}

/** `FormData.get('audio')` 在不同实现下是 jsdom File 或 undici File，只能按大小写探测。 */
function audioBytesOf(value: FormDataEntryValue | null): number {
  return typeof (value as Blob | null)?.size === 'number' ? (value as Blob).size : 0;
}

export interface SpeakingTestContext {
  handlers: RequestHandler[];
  turnCalls: SpeakingTurnCall[];
  sessionBodies: { set_id: string; part: number; question_id?: string }[];
  /** 同步端点 `POST /speaking/sessions/{id}/assess` 的会话 id。 */
  assessCalls: string[];
  /** 异步端点 `POST /sessions/{id}/assess/async` 的会话 id（§1 #11b）。 */
  assessAsyncCalls: string[];
  /** 每次 `GET /jobs/{id}` 轮询的 job_id（§1 #22b）。 */
  jobPolls: string[];
  /** 把最早的未结束评分任务落成 succeeded。 */
  settleJob: (report?: SpeakingReport) => string;
  /** 落成 failed，`error` 即后端 `jobs.error` 原文。 */
  failJob: (error: string) => string;
  followupCalls: { set_id: string; part2_transcript: string }[];
  /**
   * 带音频的 turn 无法经过 msw：jsdom FormData 的 Blob 部件在 undici 序列化时被 File 品牌校验拒掉
   * （同一限制已记录在 `src/services/api.test.ts`）。这里在 fetch 出口按**完全相同**的口径记录
   * multipart 字段并应答，其余请求原样交给 msw，所以 `turnCalls` 的断言口径不随传输路径变化。
   * 返回还原函数，测试需在 `afterEach` 里调用。
   */
  captureTurns: () => () => void;
}

export interface SpeakingHandlerOptions {
  /** 依次返回的 turn 响应；用尽后返回最后一项 */
  turns?: SpeakingTurnResult[];
  /** 指定状态码的 turn 失败（AC-S3：400/413 要显示 detail） */
  turnError?: { status: number; code: string; detail: string };
  /** `assess` 响应；传 Error 对象则返回该状态码错误 */
  report?: SpeakingReport;
  assessError?: { status: number; code: string; detail: string };
  /** 首次轮询即落终态（默认 true）；false 时任务停在「评分中」，等 `settleJob`/`failJob`。 */
  jobAutoSettle?: boolean;
  /** 让异步评分任务自动落终态即为失败，值即后端 `jobs.error` 原文。 */
  jobError?: string;
  /** `startSpeaking` 返回的题面序列（默认 Part 1 三问 / Part 2 题卡） */
  prompts?: SpeakingPrompt[];
  followupsResponse?: FollowupsResult;
  followupsError?: { status: number; code: string; detail: string };
  sets?: SpeakingSetMeta[];
  /** 音频（#39）：ok = 返回可播字节，503 = tts_unavailable */
  tts?: 'ok' | 'unavailable';
  settings?: Settings;
  /** 会话创建失败（AC-G1 之外的可读错误） */
  startError?: { status: number; code: string; detail: string };
}

const defaultFollowups: FollowupsResult = {
  questions: ['Who usually teaches these skills in your country?', 'Do you think practice matters more than talent?'],
  ai_used: true,
  degraded_reason: null,
};

export function createSpeakingHandlers(options: SpeakingHandlerOptions = {}): SpeakingTestContext {
  const turnQueue = options.turns ?? [
    turnResult({ next: part1Prompt2 }),
    turnResult({ next: part1Prompt3 }),
    turnResult({ next: null }),
  ];
  const prompts = options.prompts ?? [part1Prompt, part1Prompt2, part1Prompt3];
  const turnCalls: SpeakingTurnCall[] = [];
  const sessionBodies: { set_id: string; part: number; question_id?: string }[] = [];
  const assessCalls: string[] = [];
  const assessAsyncCalls: string[] = [];
  const followupCalls: { set_id: string; part2_transcript: string }[] = [];
  let turnIndex = 0;

  const jobs = createJobMock({
    base: BASE,
    autoSettle: options.jobAutoSettle ?? true,
    reportOf: () => options.report ?? speakingReport(),
    jobError: options.jobError,
  });

  /** #10 的响应与记录：msw 路径与 fetch 捕获路径共用同一份逻辑。 */
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
    const next = turnQueue[Math.min(turnIndex, turnQueue.length - 1)];
    turnIndex += 1;
    return ok({ ...next, turn_id: `turn_${turnIndex}` });
  }

  const turnUrl = /^http:\/\/127\.0\.0\.1:8765\/api\/speaking\/sessions\/([^/]+)\/turn$/;

  const handlers: RequestHandler[] = [
    http.get(`${BASE}/health`, () => ok(speakingHealth)),
    http.get(`${BASE}/settings`, () => ok(options.settings ?? speakingSettings)),
    http.get(`${BASE}/speaking/sets`, ({ request }) => {
      // 契约 §1 #6：`?target_band=` 由服务端过滤，mock 同样按查询串过滤
      const band = new URL(request.url).searchParams.get('target_band');
      const items = (options.sets ?? [part1Meta, part2Meta]).filter(
        (meta) => band === null || String(meta.target_band) === band,
      );
      return ok({ items });
    }),
    http.get(`${BASE}/speaking/sets/:id`, ({ params }) => {
      const id = String(params.id);
      const doc = id === part2Set.id ? part2Set : id === part1Set.id ? part1Set : part2Set;
      return ok<SpeakingSet>(doc);
    }),

    http.post(`${BASE}/speaking/sessions`, async ({ request }) => {
      const body = (await request.json()) as { set_id: string; part: number; question_id?: string };
      sessionBodies.push(body);
      if (options.startError) {
        return HttpResponse.json(
          { detail: options.startError.detail, code: options.startError.code },
          { status: options.startError.status },
        );
      }
      const chosenPart = body.part === 2 ? 2 : body.part === 3 ? 3 : 1;
      const list = options.prompts ?? (chosenPart === 2 ? [cueCardPrompt] : prompts);
      return ok({
        session_id: 'ses_test_0001',
        part: chosenPart,
        current: list[0],
        index: 0,
        total: list.length,
      });
    }),

    http.post(`${BASE}/speaking/sessions/:id/turn`, async ({ request, params }) =>
      turnResponse(await request.formData(), String(params.id)),
    ),

    http.post(`${BASE}/speaking/sessions/:id/assess`, ({ params }) => {
      assessCalls.push(String(params.id));
      if (options.assessError) {
        return HttpResponse.json(
          { detail: options.assessError.detail, code: options.assessError.code },
          { status: options.assessError.status },
        );
      }
      return ok<SpeakingReport>(options.report ?? speakingReport());
    }),

    // §1 #11b：排队评分，提交即返回 job_id（契约 §10.6）
    http.post(`${BASE}/speaking/sessions/:id/assess/async`, ({ params }) => {
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

    http.post(`${BASE}/speaking/followups`, async ({ request }) => {
      const body = (await request.json()) as { set_id: string; part2_transcript: string };
      followupCalls.push(body);
      if (options.followupsError) {
        return HttpResponse.json(
          { detail: options.followupsError.detail, code: options.followupsError.code },
          { status: options.followupsError.status },
        );
      }
      return ok<FollowupsResult>(options.followupsResponse ?? defaultFollowups);
    }),

    http.get(`${BASE}/tts`, () => {
      if (options.tts === 'unavailable') {
        return HttpResponse.json(
          { detail: '语音合成服务不可用（离线）', code: 'tts_unavailable' },
          { status: 503 },
        );
      }
      return new HttpResponse(new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x01]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    }),
  ];

  function captureTurns(): () => void {
    const previous = globalThis.fetch;
    const patched = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (typeof input === 'string' || input instanceof URL ? 'GET' : input.method)) ?? 'GET';
      const matched = turnUrl.exec(url);
      if (!matched || method.toUpperCase() !== 'POST') return previous(input as RequestInfo, init);
      if (!(init?.body instanceof FormData)) {
        return HttpResponse.json({ detail: 'turn 需要 multipart 表单', code: 'missing_input' }, { status: 400 });
      }
      return turnResponse(init.body, decodeURIComponent(matched[1]));
    };
    globalThis.fetch = patched;
    return () => {
      globalThis.fetch = previous;
    };
  }

  return {
    handlers,
    turnCalls,
    sessionBodies,
    assessCalls,
    assessAsyncCalls,
    jobPolls: jobs.polls,
    settleJob: (report?: SpeakingReport) => jobs.settle(report),
    failJob: jobs.fail,
    followupCalls,
    captureTurns,
  };
}
