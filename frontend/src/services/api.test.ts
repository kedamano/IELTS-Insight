/**
 * services/api.test.ts —— 契约 §7 全导出面守卫（AC-X4）。
 *
 * - msw server 生命周期由 src/test/setup.ts 统一挂载（test-plan §1），本文件不再 listen/close。
 * - 所有 URL 一律从 `API_BASE` 拼出，不在测试里二次字面量化 `8765`。
 * - 覆盖：URL/method/body、`{data}`+`{total}` unwrap、ApiError 中文文案、
 *   setAiKey 失败密钥脱敏、abort 透传、multipart turn、听力音频 blob 与 503、图表归一化。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import {
  API_BASE,
  ApiError,
  apiUrl,
  assessSpeaking,
  addVocab,
  attempt,
  attempts,
  buildSpeakingTurnForm,
  clearAiKey,
  deleteAttempt,
  deleteReview,
  fetchJson,
  fetchListeningAudio,
  fetchTtsAudio,
  followups,
  getSpeakingSession,
  getSettings,
  health,
  isAbortError,
  isApiError,
  isServiceUnavailable,
  listeningAudioUrl,
  listeningSet,
  listeningSets,
  markPlanDone,
  patchSettings,
  planToday,
  postListeningAttempt,
  postReadingAttempt,
  postSpeakingTurn,
  postStt,
  postWritingAttempt,
  progressAnalytics,
  progressSummary,
  progressTrend,
  readingSet,
  readingSets,
  removeVocab,
  resolveReview,
  resolveVoice,
  reviewErrors,
  setAiKey,
  speakingAudioUrl,
  speakingSet,
  speakingSets,
  startSpeaking,
  toReadableError,
  ttsUrl,
  vocabExportUrl,
  vocabList,
  wordInfo,
  writingAttempt,
  writingTasks,
  api as apiBundle,
} from './api';

// ============================================================
// 请求捕获基础设施
// ============================================================

interface Seen {
  url: string;
  method: string;
  contentType: string | null;
  json: unknown;
  form: FormData | null;
}

let seen: Seen[] = [];

beforeEach(() => {
  seen = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function last(): Seen {
  const entry = seen.at(-1);
  if (!entry) throw new Error('测试没有捕获到任何请求');
  return entry;
}

/** 断言 promise 失败且失败原因是 ApiError，返回该 ApiError。 */
async function expectApiError<T>(promise: Promise<T>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error, '错误应为 ApiError').toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('请求应当失败但没有失败');
}

type MethodKey = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** 在 API_BASE 上覆写一个返回 `{data}` envelope 的 handler，并记录请求细节。 */
function mockOnce(method: MethodKey, path: string, data: unknown) {
  server.use(
    http[method](`${API_BASE}${path}`, async ({ request }) => {
      const contentType = request.headers.get('content-type');
      const entry: Seen = { url: request.url, method: request.method, contentType, json: null, form: null };
      if (request.method !== 'GET' && request.method !== 'DELETE' && request.body !== null) {
        if (contentType?.includes('multipart/form-data')) {
          entry.form = await request.formData();
        } else {
          entry.json = await request.json();
        }
      }
      seen.push(entry);
      return HttpResponse.json({ data });
    }),
  );
}

// ============================================================
// 0. API_BASE 单一来源（AC-X4）
// ============================================================

describe('API_BASE 单一来源（AC-X4）', () => {
  it('基址是本地 sidecar 且带 /api 后缀，端口不在本测试文件字面量化', () => {
    expect(API_BASE).toMatch(/^https?:\/\/127\.0\.0\.1:\d+\/api$/);
    expect(apiBundle.API_BASE).toBe(API_BASE);
  });

  it('apiUrl 对带/不带前导斜杠的 path 都只拼一处基址', () => {
    expect(apiUrl('/health')).toBe(`${API_BASE}/health`);
    expect(apiUrl('health')).toBe(`${API_BASE}/health`);
    expect(apiUrl('/attempts/att_1')).toBe(`${API_BASE}/attempts/att_1`);
  });

  it('所有实际发出的请求 URL 均以 API_BASE 打头（抽查多端点）', async () => {
    mockOnce('get', '/health', { version: '2.0.0' });
    mockOnce('get', '/settings', { target_band: 6.5 });
    mockOnce('get', '/speaking/sets', { items: [] });
    mockOnce('get', '/listening/sets', { items: [] });
    mockOnce('get', '/review/errors', { items: [] });
    await health();
    await getSettings();
    await speakingSets();
    await listeningSets();
    await reviewErrors();
    expect(seen).toHaveLength(5);
    for (const entry of seen) {
      expect(entry.url.startsWith(API_BASE)).toBe(true);
    }
  });
});

// ============================================================
// 1. health / settings / ai-key（#1–#5）
// ============================================================

describe('health 与 settings', () => {
  it('health() GET /health 并 unwrap {data}', async () => {
    const payload = {
      version: '2.0.0',
      ai_configured: true,
      ai_base_url_host: 'api.example.com',
      whisper: { loaded: false, model: 'small' },
      tts_ok: true,
      content_counts: { speaking: 8, listening: 8, reading: 8, writing: 8 },
    };
    mockOnce('get', '/health', payload);
    const result = await health();
    expect(result).toEqual(payload);
    expect(last().url).toBe(`${API_BASE}/health`);
    expect(last().method).toBe('GET');
  });

  it('默认 mock handler 的 health 响应字段与契约 §1 #1 一致', async () => {
    const result = await health();
    expect(result).toMatchObject({
      version: expect.any(String),
      ai_configured: expect.any(Boolean),
      whisper: { loaded: expect.any(Boolean), model: expect.any(String) },
      tts_ok: expect.any(Boolean),
      content_counts: { speaking: expect.any(Number), listening: expect.any(Number), reading: expect.any(Number), writing: expect.any(Number) },
    });
  });

  it('patchSettings() 用 PATCH + JSON body，只提交传入字段', async () => {
    mockOnce('patch', '/settings', { target_band: 7 });
    await patchSettings({ target_band: 7 });
    const entry = last();
    expect(entry.method).toBe('PATCH');
    expect(entry.contentType).toContain('application/json');
    expect(entry.json).toEqual({ target_band: 7 });
  });

  it('PATCH 语义走真实 mock 状态：未提供字段保持原值（AC-C1 前端侧）', async () => {
    const before = await getSettings();
    await patchSettings({ target_band: 7.5 });
    const after = await getSettings();
    expect(after.target_band).toBe(7.5);
    expect(after.exam_date).toBe(before.exam_date);
    expect(after.accent).toBe(before.accent);
    expect(after.ai).toEqual(before.ai);
  });

  it('setAiKey() PUT JSON {key}，成功返回 {ai_key_present:true}', async () => {
    mockOnce('put', '/settings/ai-key', { ai_key_present: true });
    const result = await setAiKey('sk-abcdefghijklmno');
    expect(result.ai_key_present).toBe(true);
    expect(last().method).toBe('PUT');
    expect(last().json).toEqual({ key: 'sk-abcdefghijklmno' });
  });

  it('setAiKey() 失败时错误文本不含明文 key（AC-C2 脱敏）', async () => {
    const secret = 'ZebraKey-NoRedact-9f3a2b';
    server.use(
      http.put(`${API_BASE}/settings/ai-key`, () =>
        HttpResponse.json(
          { detail: `上游拒绝该密钥：${secret}，请检查`, code: 'network_error' },
          { status: 502 },
        ),
      ),
    );
    const error = await expectApiError(setAiKey(secret));
    expect(isApiError(error)).toBe(true);
    expect(error.status).toBe(502);
    expect(error.code).toBe('network_error');
    expect(error.message).toContain('[已隐藏]');
    expect(error.message).not.toContain(secret);
    expect(error.detail).not.toContain(secret);
  });

  it('sk- 形态的 key 即使调用方没传 redact 也会被通用模式替换', async () => {
    server.use(
      http.put(`${API_BASE}/settings/ai-key`, () =>
        HttpResponse.json({ detail: '上游报错 sk-abcdef123456', code: 'network_error' }, { status: 502 }),
      ),
    );
    const error = await expectApiError(setAiKey('anything'));
    expect(error.message).not.toContain('sk-abcdef123456');
  });

  it('clearAiKey() DELETE /settings/ai-key，返回 {ai_key_present:false}', async () => {
    mockOnce('delete', '/settings/ai-key', { ai_key_present: false });
    const result = await clearAiKey();
    expect(result.ai_key_present).toBe(false);
    expect(last().method).toBe('DELETE');
    expect(last().url).toBe(`${API_BASE}/settings/ai-key`);
  });
});

// ============================================================
// 2. speaking（#6–#12 + 保留的 #stt 兜底）
// ============================================================

describe('口语端点', () => {
  it('speakingSets(6.5) 带 target_band query；不传时无 query', async () => {
    mockOnce('get', '/speaking/sets', { items: [{ id: 'sp_p2_environment_01', module: 'speaking' }] });
    const withBand = await speakingSets(6.5);
    expect(last().url).toBe(`${API_BASE}/speaking/sets?target_band=6.5`);
    expect(withBand).toHaveLength(1);
    await speakingSets(null);
    expect(last().url).toBe(`${API_BASE}/speaking/sets`);
  });

  it('speakingSet(id) 走 /speaking/sets/{id}', async () => {
    mockOnce('get', '/speaking/sets/sp_p2_environment_01', { id: 'sp_p2_environment_01' });
    const result = await speakingSet('sp_p2_environment_01');
    expect(result.id).toBe('sp_p2_environment_01');
    expect(last().url).toBe(`${API_BASE}/speaking/sets/sp_p2_environment_01`);
  });

  it('startSpeaking() POST body 原样为 {set_id, part}', async () => {
    mockOnce('post', '/speaking/sessions', { session_id: 'sess_1', part: 2, index: 1, total: 1 });
    const result = await startSpeaking({ set_id: 'sp_p2_environment_01', part: 2 });
    expect(result.session_id).toBe('sess_1');
    const entry = last();
    expect(entry.method).toBe('POST');
    expect(entry.json).toEqual({ set_id: 'sp_p2_environment_01', part: 2 });
  });

  it('getSpeakingSession(id) GET /speaking/sessions/{id}', async () => {
    mockOnce('get', '/speaking/sessions/sess_1', { session_id: 'sess_1', state: 'in_progress', prompts: [], turns: [] });
    const result = await getSpeakingSession('sess_1');
    expect(result.state).toBe('in_progress');
    expect(last().url).toBe(`${API_BASE}/speaking/sessions/sess_1`);
  });

  it('buildSpeakingTurnForm：text + duration_sec 进 FormData', () => {
    const form = buildSpeakingTurnForm({ text: '  hello there  ', durationSec: 12.5 });
    expect(form.get('text')).toBe('  hello there  ');
    expect(form.get('duration_sec')).toBe('12.5');
    expect(form.get('audio')).toBeNull();
  });

  it('buildSpeakingTurnForm：audio 分支文件名 speech.webm（multipart 契约 #10）', () => {
    const blob = new Blob(['webmbytes'], { type: 'audio/webm' });
    const form = buildSpeakingTurnForm({ audio: blob, durationSec: 3 });
    const file = form.get('audio');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('speech.webm');
    expect(form.get('text')).toBeNull();
  });

  it('buildSpeakingTurnForm：无音频无文本 → ApiError 400 missing_input（中文文案）', () => {
    try {
      buildSpeakingTurnForm({} as Parameters<typeof buildSpeakingTurnForm>[0]);
      expect.unreachable('应抛出 ApiError');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.code).toBe('missing_input');
      expect(apiError.message).toBe('口语提交需要音频或文本二者之一');
    }
  });

  it('postSpeakingTurn(id, {text}) 发 multipart（不手动设 Content-Type）并 unwrap 结果', async () => {
    mockOnce('post', '/speaking/sessions/sess_1/turn', {
      turn_id: 'turn_1',
      transcript: 'I work as an engineer.',
      confidence: 0.9,
      next: null,
      elapsed_limit_reached: false,
    });
    const result = await postSpeakingTurn('sess_1', { text: 'I work as an engineer.', durationSec: 8 });
    expect(result.turn_id).toBe('turn_1');
    expect(result.next).toBeNull();
    const entry = last();
    expect(entry.method).toBe('POST');
    expect(entry.url).toBe(`${API_BASE}/speaking/sessions/sess_1/turn`);
    expect(entry.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(entry.form?.get('text')).toBe('I work as an engineer.');
    expect(entry.form?.get('duration_sec')).toBe('8');
  });

  it('postSpeakingTurn 兼容自组 FormData（契约 §7 form 形参）与音频 blob', async () => {
    // jsdom FormData 的 Blob 部件无法经 undici fetch 序列化（node File 校验），
    // 这里直接断言发给 fetch 的请求形态，这正是 turn multipart 的客户端契约。
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init: (init ?? {}) as RequestInit });
      return HttpResponse.json({
        data: {
          turn_id: 'turn_2',
          transcript: 'ok',
          confidence: 0.7,
          next: null,
          elapsed_limit_reached: true,
        },
      });
    });
    const form = new FormData();
    form.append('audio', new Blob(['abc'], { type: 'audio/webm' }), 'speech.webm');
    const result = await postSpeakingTurn('sess_2', form);
    expect(result.elapsed_limit_reached).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe(`${API_BASE}/speaking/sessions/sess_2/turn`);
    expect(call.init.method).toBe('POST');
    const body = call.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const file = body.get('audio') as File;
    expect(file.name).toBe('speech.webm');
    // 不手动设置 Content-Type（浏览器/undici 自己带 boundary）
    const headers = new Headers(call.init.headers as HeadersInit | undefined);
    expect(headers.get('content-type')).toBeNull();
  });

  it('assessSpeaking(id) POST 无 body，返回 §3-S 报告（band 为对象）', async () => {
    const report = {
      attempt_id: 'att_sp_1',
      ai_used: false,
      approximate: true,
      band: { overall: 6.0, fluency_coherence: 6.0, lexical_resource: 5.5, grammatical_range_accuracy: 6.0, pronunciation: 6.5 },
    };
    mockOnce('post', '/speaking/sessions/sess_1/assess', report);
    const result = await assessSpeaking('sess_1');
    expect(result.attempt_id).toBe('att_sp_1');
    expect(typeof result.band).toBe('object');
    expect(last().method).toBe('POST');
    expect(last().json).toBeNull();
  });

  it('followups() POST {set_id, part2_transcript} 返回 questions 数组', async () => {
    mockOnce('post', '/speaking/followups', { questions: ['Why?', 'How?'], ai_used: false, degraded_reason: 'no_api_key' });
    const result = await followups({ set_id: 'sp_p2_environment_01', part2_transcript: 'I want to learn guitar.' });
    expect(result.questions).toEqual(['Why?', 'How?']);
    expect(last().json).toEqual({ set_id: 'sp_p2_environment_01', part2_transcript: 'I want to learn guitar.' });
  });

  it('postStt() multipart 兜底通道仍在（§10.2 前端不直调但不删除）', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init: (init ?? {}) as RequestInit });
      return HttpResponse.json({ data: { text: 'hello world', confidence: 0.95 } });
    });
    const result = await postStt(new Blob(['abc'], { type: 'audio/webm' }));
    expect(result.text).toBe('hello world');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API_BASE}/stt`);
    const file = (calls[0].init.body as FormData).get('audio') as File;
    expect(file.name).toBe('speech.webm');
  });
});

// ============================================================
// 3. listening（#13–#16）
// ============================================================

describe('听力端点', () => {
  it('listeningSets 拼 accent 与 kind query；空对象不带 query', async () => {
    mockOnce('get', '/listening/sets', { items: [{ id: 'li_s2_travel_03', module: 'listening' }] });
    const items = await listeningSets({ accent: 'en-US', kind: 'practice' });
    const url = new URL(last().url);
    expect(url.searchParams.get('accent')).toBe('en-US');
    expect(url.searchParams.get('kind')).toBe('practice');
    expect(items).toHaveLength(1);
    await listeningSets();
    expect(last().url).toBe(`${API_BASE}/listening/sets`);
  });

  it('listeningSet(id) 题面接口走 /listening/sets/{id}', async () => {
    mockOnce('get', '/listening/sets/li_s2_travel_03', { id: 'li_s2_travel_03', module: 'listening' });
    const result = await listeningSet('li_s2_travel_03');
    expect(result.module).toBe('listening');
  });

  it('listeningAudioUrl 是纯 URL 字符串（给 <audio src>），不发请求', () => {
    expect(listeningAudioUrl('li_1')).toBe(`${API_BASE}/listening/sets/li_1/audio`);
    const withAccent = listeningAudioUrl('li_1', 'en-US');
    expect(new URL(withAccent).searchParams.get('accent')).toBe('en-US');
    expect(new URL(withAccent).pathname).toBe('/api/listening/sets/li_1/audio');
  });

  it('fetchListeningAudio 返回 blob 字节流（非 envelope）', async () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]);
    server.use(
      http.get(`${API_BASE}/listening/sets/:setId/audio`, () =>
        new HttpResponse(bytes, { headers: { 'Content-Type': 'audio/mpeg', 'X-Audio-Cache': 'miss' } }),
      ),
    );
    const blob = await fetchListeningAudio('li_1');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(8);
  });

  it('fetchListeningAudio 503 tts_unavailable → isServiceUnavailable（AC-L1b 精读回落）', async () => {
    server.use(
      http.get(`${API_BASE}/listening/sets/:setId/audio`, () =>
        HttpResponse.json(
          { detail: '音频服务暂不可用，可改用原文精读', code: 'tts_unavailable' },
          { status: 503 },
        ),
      ),
    );
    const error = await expectApiError(fetchListeningAudio('li_1'));
    expect(isApiError(error)).toBe(true);
    expect(error.status).toBe(503);
    expect(error.code).toBe('tts_unavailable');
    expect(isServiceUnavailable(error)).toBe(true);
    expect(error.message).toContain('原文精读');
  });

  it('postListeningAttempt POST {answers,duration_sec}，客观报告 band 为标量（§10.2）', async () => {
    const report = {
      attempt_id: 'att_li_1',
      module: 'listening',
      ai_used: false,
      approximate: false,
      raw_correct: 16,
      raw_total: 20,
      band: 7.0,
      band_scale: 'listening_20q',
      items: [],
      by_question_type: {},
      accuracy: 0.8,
      transcript: 'The museum opens at 9:30.',
    };
    mockOnce('post', '/listening/sets/li_1/attempt', report);
    const result = await postListeningAttempt('li_1', { answers: { q1: '9:30' }, duration_sec: 300 });
    expect(result.transcript).toContain('museum');
    expect(typeof result.band).toBe('number');
    const entry = last();
    expect(entry.method).toBe('POST');
    expect(entry.json).toEqual({ answers: { q1: '9:30' }, duration_sec: 300 });
  });
});

// ============================================================
// 4. reading（#17–#19）
// ============================================================

describe('阅读端点', () => {
  it('readingSets(level) 拼 level query', async () => {
    mockOnce('get', '/reading/sets', { items: [{ id: 're_p_urban_02', module: 'reading' }] });
    await readingSets({ level: 'advanced' });
    expect(new URL(last().url).searchParams.get('level')).toBe('advanced');
  });

  it('readingSet(id) 走 /reading/sets/{id}', async () => {
    mockOnce('get', '/reading/sets/re_p_urban_02', { id: 're_p_urban_02', module: 'reading' });
    const result = await readingSet('re_p_urban_02');
    expect(result.id).toBe('re_p_urban_02');
    expect(last().url).toBe(`${API_BASE}/reading/sets/re_p_urban_02`);
  });

  it('postReadingAttempt 支持 timed_out 自动提交标记（AC-R3）', async () => {
    const report = {
      attempt_id: 'att_re_1',
      module: 'reading',
      ai_used: false,
      approximate: false,
      raw_correct: 10,
      raw_total: 13,
      band: 7.0,
      band_scale: 'reading_13q',
      items: [],
      by_question_type: {},
      accuracy: 10 / 13,
      timed_out: true,
    };
    mockOnce('post', '/reading/sets/re_1/attempt', report);
    const result = await postReadingAttempt('re_1', { answers: { q1: 'NOTGIVEN' }, duration_sec: 1200, timed_out: true });
    expect(result.timed_out).toBe(true);
    expect(last().json).toEqual({ answers: { q1: 'NOTGIVEN' }, duration_sec: 1200, timed_out: true });
  });
});

// ============================================================
// 5. writing（#20–#22）
// ============================================================

describe('写作端点', () => {
  const task1 = {
    id: 'wr_t1_energy_04',
    module: 'writing',
    task: 'task1',
    prompt: 'The chart below shows …',
    min_words: 150,
    time_recommend_sec: 1200,
    chart: { type: 'line', years: [2000, 2010], series: [{ name: 'Coal', values: [120, 98] }] },
  };

  it('writingTasks 同时接受字符串与 {module} 对象 query 形态', async () => {
    mockOnce('get', '/writing/tasks', { items: [task1] });
    const byString = await writingTasks('task1');
    expect(new URL(last().url).searchParams.get('module')).toBe('task1');
    expect(byString).toHaveLength(1);
    await writingTasks({ module: 'task2' });
    expect(new URL(last().url).searchParams.get('module')).toBe('task2');
    await writingTasks();
    expect(last().url).toBe(`${API_BASE}/writing/tasks`);
  });

  it('writingTasks 归一化 chart.data 嵌套形态（§1 #20 含 chart.data）', async () => {
    const nested = {
      ...task1,
      chart: { data: { type: 'bar', columns: ['a'], rows: [[1]] }, source_note: 'x' },
    };
    mockOnce('get', '/writing/tasks', { items: [nested] });
    const tasks = await writingTasks('task1');
    expect(tasks[0]).toMatchObject({ chart: { type: 'bar' } });
  });

  it('postWritingAttempt POST {task_id,response,duration_sec} 返回 §3-W 报告', async () => {
    const report = {
      attempt_id: 'att_wr_1',
      task: 'task2',
      ai_used: true,
      approximate: false,
      band: { overall: 6.0, task_response: 6.0, coherence_cohesion: 6.5, lexical_resource: 6.0, grammatical_range_accuracy: 5.5 },
      word_count: 268,
      word_count_penalty: null,
      corrections: [],
      upgraded_sentences: [],
      structure_issues: [],
      strengths: [],
      model_answer: '…',
      error_summary: {},
    };
    mockOnce('post', '/writing/attempts', report);
    const result = await postWritingAttempt({ task_id: 'wr_t2_tech_02', response: 'essay text', duration_sec: 2400 });
    expect(result.attempt_id).toBe('att_wr_1');
    expect(last().json).toEqual({ task_id: 'wr_t2_tech_02', response: 'essay text', duration_sec: 2400 });
  });

  it('writingAttempt(id) GET /writing/attempts/{id}', async () => {
    mockOnce('get', '/writing/attempts/att_wr_1', { attempt_id: 'att_wr_1', task: 'task2' });
    const result = await writingAttempt('att_wr_1');
    expect(result.attempt_id).toBe('att_wr_1');
    expect(last().url).toBe(`${API_BASE}/writing/attempts/att_wr_1`);
  });
});

// ============================================================
// 6. attempts / progress / plan（#23–#30）
// ============================================================

describe('记录、进度与计划', () => {
  it('attempts() unwrap {data:{items,total}}，module/limit/offset 进 query', async () => {
    mockOnce('get', '/attempts', { items: [{ id: 'att_1', module: 'listening' }], total: 42 });
    const result = await attempts({ module: 'listening', limit: 10, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(42);
    const url = new URL(last().url);
    expect(url.searchParams.get('module')).toBe('listening');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('offset')).toBe('0');
  });

  it('attempts() 兼容 data 为裸数组 + 顶层 total 的形态', async () => {
    server.use(
      http.get(`${API_BASE}/attempts`, () =>
        HttpResponse.json({ data: [{ id: 'att_a' }, { id: 'att_b' }], total: 99 }),
      ),
    );
    const result = await attempts();
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(99);
  });

  it('attempts() 两处都无 total 时回落 items.length', async () => {
    server.use(http.get(`${API_BASE}/attempts`, () => HttpResponse.json({ data: { items: [{ id: 'att_c' }] } })));
    const result = await attempts();
    expect(result.total).toBe(1);
  });

  it('attempt(id) 返回 {attempt, payload}（§1 #24，列表主键字段名 id —— §10.2）', async () => {
    mockOnce('get', '/attempts/att_1', {
      attempt: { id: 'att_1', module: 'listening', band_overall: 7.0 },
      payload: { attempt_id: 'att_1', module: 'listening', raw_total: 20, items: [] },
    });
    const detail = await attempt('att_1');
    expect(detail.attempt.id).toBe('att_1');
    expect(detail.payload).toMatchObject({ attempt_id: 'att_1', module: 'listening' });
  });

  it('deleteAttempt(id) DELETE /attempts/{id} 返回 {deleted:true}', async () => {
    mockOnce('delete', '/attempts/att_1', { deleted: true });
    const result = await deleteAttempt('att_1');
    expect(result.deleted).toBe(true);
    expect(last().method).toBe('DELETE');
    expect(last().url).toBe(`${API_BASE}/attempts/att_1`);
  });

  it('progressSummary() 返回四科 current/delta（§1 #26）', async () => {
    mockOnce('get', '/progress/summary', {
      target_band: 6.5,
      exam_date: '2027-01-15',
      days_left: 90,
      current: { speaking: 6.0, listening: 7.0, reading: null, writing: null },
      delta_vs_previous: { speaking: 0.5, listening: 0, reading: null, writing: null },
      attempts_total: 12,
      minutes_total: 340,
      last_practice_at: null,
    });
    const result = await progressSummary();
    expect(result.current.reading).toBeNull();
    expect(result.attempts_total).toBe(12);
  });

  it('progressTrend 拼 module/days query，progressAnalytics 拼 weeks', async () => {
    mockOnce('get', '/progress/trend', { points: [{ date: '2026-10-18', band: 7.0 }] });
    const trend = await progressTrend({ module: 'listening', days: 30 });
    expect(trend.points).toHaveLength(1);
    const trendUrl = new URL(last().url);
    expect(trendUrl.searchParams.get('module')).toBe('listening');
    expect(trendUrl.searchParams.get('days')).toBe('30');

    mockOnce('get', '/progress/analytics', { by_question_type: [], by_error_type: [], minutes_by_day: [] });
    await progressAnalytics({ weeks: 8 });
    expect(new URL(last().url).searchParams.get('weeks')).toBe('8');
  });

  it('planToday() 返回 {items, generated_at}；markPlanDone POST {done}', async () => {
    mockOnce('get', '/plan/today', { items: [{ id: 'plan_1', done: false }], generated_at: '2026-10-18T00:05:00Z' });
    const plan = await planToday();
    expect(plan.items[0].id).toBe('plan_1');

    mockOnce('post', '/plan/plan_1/done', { ok: true });
    const result = await markPlanDone('plan_1', true);
    expect(result.ok).toBe(true);
    expect(last().json).toEqual({ done: true });
  });
});

// ============================================================
// 7. review / vocab / tts（#31–#39）
// ============================================================

describe('错题本与词汇', () => {
  it('reviewErrors 拼 module/status/error_type query（§1 #31）', async () => {
    mockOnce('get', '/review/errors', { items: [{ id: 'rev_1', status: 'open' }] });
    const items = await reviewErrors({ module: 'writing', status: 'open', error_type: 'grammar' });
    expect(items).toHaveLength(1);
    const url = new URL(last().url);
    expect(url.searchParams.get('module')).toBe('writing');
    expect(url.searchParams.get('status')).toBe('open');
    expect(url.searchParams.get('error_type')).toBe('grammar');
  });

  it('resolveReview POST /review/{id}/resolve；deleteReview DELETE /review/{id}', async () => {
    mockOnce('post', '/review/rev_1/resolve', { status: 'resolved' });
    const resolved = await resolveReview('rev_1');
    expect(resolved.status).toBe('resolved');
    expect(last().method).toBe('POST');

    mockOnce('delete', '/review/rev_1', { deleted: true });
    const removed = await deleteReview('rev_1');
    expect(removed.deleted).toBe(true);
  });

  it('wordInfo(w) GET /vocab?word=（#34，query 形态不是路径）', async () => {
    mockOnce('get', '/vocab', { word: 'rewarding', phonetic: '/rɪˈwɔː.dɪŋ/', zh: '有回报的', difficulty: 3, examples: [], source: 'local' });
    const result = await wordInfo('rewarding');
    expect(result.word).toBe('rewarding');
    expect(last().url).toBe(`${API_BASE}/vocab?word=rewarding`);
  });

  it('addVocab POST body 原样；vocabList unwrap {items}（#35/#36）', async () => {
    mockOnce('post', '/vocab', { word: 'rewarding', context: '…', source_module: 'speaking', source_ref: 'sp_1', note_zh: '有回报的', tags: [] });
    await addVocab({ word: 'rewarding', context: '…', source_module: 'speaking', source_ref: 'sp_1', tags: [] });
    expect(last().json).toEqual({ word: 'rewarding', context: '…', source_module: 'speaking', source_ref: 'sp_1', tags: [] });

    mockOnce('get', '/vocab', { items: [{ word: 'rewarding' }] });
    const notes = await vocabList();
    expect(notes[0].word).toBe('rewarding');
  });

  it('removeVocab DELETE /vocab/{word} 并对空格做编码（#37）', async () => {
    mockOnce('delete', '/vocab/a%20b', { deleted: true });
    await removeVocab('a b');
    expect(last().method).toBe('DELETE');
    expect(new URL(last().url).pathname).toBe('/api/vocab/a%20b');
  });

  it('vocabExportUrl 是纯 URL 字符串，默认 csv（#38）', () => {
    expect(vocabExportUrl()).toBe(`${API_BASE}/vocab/export?format=csv`);
    expect(vocabExportUrl('anki')).toBe(`${API_BASE}/vocab/export?format=anki`);
  });
});

describe('TTS（#39）', () => {
  it('resolveVoice：显式 voice 优先，否则由 accent 查表，都没有返回 undefined', () => {
    expect(resolveVoice({ voice: 'en-AU-OliviaNeural' })).toBe('en-AU-OliviaNeural');
    expect(resolveVoice({ accent: 'en-GB' })).toBe('en-GB-SoniaNeural');
    expect(resolveVoice({ accent: 'en-US' })).toBe('en-US-GuyNeural');
    expect(resolveVoice()).toBeUndefined();
  });

  it('ttsUrl 带 text/voice/speed 三参，voice 由 accent 推导', () => {
    const url = new URL(ttsUrl('hello world', { accent: 'en-GB', speed: 1.2 }));
    expect(url.searchParams.get('text')).toBe('hello world');
    expect(url.searchParams.get('voice')).toBe('en-GB-SoniaNeural');
    expect(url.searchParams.get('speed')).toBe('1.2');
    expect(`${url.origin}${url.pathname}`).toBe(`${API_BASE}/tts`);
  });

  it('fetchTtsAudio 返回 blob', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    server.use(http.get(`${API_BASE}/tts`, () => new HttpResponse(bytes, { headers: { 'Content-Type': 'audio/mpeg' } })));
    const blob = await fetchTtsAudio('hello');
    expect(blob.size).toBe(6);
  });

  it('fetchTtsAudio 503 tts_unavailable → isServiceUnavailable（离线可见降级）', async () => {
    server.use(
      http.get(`${API_BASE}/tts`, () =>
        HttpResponse.json({ detail: '语音合成服务不可用（离线）', code: 'tts_unavailable' }, { status: 503 }),
      ),
    );
    const error = await expectApiError(fetchTtsAudio('hello'));
    expect(isServiceUnavailable(error)).toBe(true);
    expect(error.message).toContain('语音合成服务不可用');
  });

  it('speakingAudioUrl 与 ttsUrl(prompt.text) 同源（§2-S audio_url）', () => {
    expect(speakingAudioUrl({ text: 'Do you work?' }, { accent: 'en-GB' })).toBe(
      ttsUrl('Do you work?', { accent: 'en-GB' }),
    );
  });
});

// ============================================================
// 8. 错误模型 / 网络 / abort
// ============================================================

describe('错误模型与 abort', () => {
  it('网络失败（后端未启动）→ ApiError status 0 + 中文可读文案', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await expectApiError(health());
    expect(isApiError(error)).toBe(true);
    expect(error.status).toBe(0);
    expect(error.code).toBe('network_error');
    expect(error.message).toBe('无法连接后端服务（后端未启动或请求被拦截）');
  });

  it('显式 abort 的 AbortError 原样透传，不包装成 ApiError', async () => {
    const abortError = new DOMException('The user aborted a request.', 'AbortError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);
    const controller = new AbortController();
    controller.abort();
    await expect(getSettings({ signal: controller.signal })).rejects.toBe(abortError);
  });

  it('signal.aborted 但 fetch 抛非标准错误时仍透传', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('signal aborted');
    });
    await expect(health({ signal: controller.signal })).rejects.toThrow('signal aborted');
  });

  it('HTTP 404 {detail,code} → ApiError 中文 detail，isServiceUnavailable=false（§0 错误体）', async () => {
    server.use(
      http.get(`${API_BASE}/attempts/:attemptId`, () =>
        HttpResponse.json({ detail: '练习记录不存在', code: 'not_found' }, { status: 404 }),
      ),
    );
    const error = await expectApiError(attempt('att_missing'));
    expect(error.status).toBe(404);
    expect(error.code).toBe('not_found');
    expect(error.detail).toBe('练习记录不存在');
    expect(error.message).toBe('请求失败 404：练习记录不存在');
    expect(isServiceUnavailable(error)).toBe(false);
  });

  it('错误响应体不是 JSON 时回落状态码文案不崩', async () => {
    server.use(
      http.get(`${API_BASE}/progress/summary`, () =>
        new HttpResponse('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
      ),
    );
    const error = await expectApiError(progressSummary());
    expect(error.status).toBe(502);
    expect(error.message).toContain('502');
  });

  it('200 但 body 非 JSON → invalid_json 中文错误（fetchJson 守卫）', async () => {
    server.use(http.get(`${API_BASE}/plan/today`, () => new HttpResponse('not-json', { status: 200 })));
    const error = await expectApiError(planToday());
    expect(error.code).toBe('invalid_json');
    expect(error.message).toContain('无法解析');
  });

  it('fetchJson 对不带 data 的裸响应直接透传（envelope 兼容）', async () => {
    server.use(http.get(`${API_BASE}/health`, () => HttpResponse.json({ bare: true })));
    const result = await fetchJson<{ bare: boolean }>(apiUrl('/health'));
    expect(result.bare).toBe(true);
  });

  it('toReadableError：AbortError 原样、ApiError 原样、普通 Error 中文包装 + 脱敏', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(toReadableError(abort)).toBe(abort);
    const apiError = new ApiError('原始', 400, 'x');
    expect(toReadableError(apiError)).toBe(apiError);
    const wrapped = toReadableError(new Error('socket hang up'));
    expect(isApiError(wrapped)).toBe(true);
    expect((wrapped as ApiError).message).toBe('请求失败：socket hang up');
    expect((wrapped as ApiError).status).toBe(0);
    const scrubbed = toReadableError(new Error('密钥 Sunflower-Secret-42 被拒'), ['Sunflower-Secret-42']);
    expect(scrubbed.message).toContain('[已隐藏]');
    expect(scrubbed.message).not.toContain('Sunflower-Secret-42');
  });

  it('isApiError / isAbortError 判别器行为正确', () => {
    expect(isApiError(new ApiError('x', 400))).toBe(true);
    expect(isApiError(new Error('x'))).toBe(false);
    expect(isAbortError(new DOMException('a', 'AbortError'))).toBe(true);
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new Error('AbortError'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

// ============================================================
// 9. §7 导出面守卫（旧 api.ts 上没有这些函数 → 本用例即红）
// ============================================================

describe('契约 §7 导出面', () => {
  const REQUIRED_FUNCTIONS = [
    'health', 'getSettings', 'patchSettings', 'setAiKey', 'clearAiKey',
    'speakingSets', 'speakingSet', 'startSpeaking', 'getSpeakingSession', 'postSpeakingTurn',
    'assessSpeaking', 'followups',
    'listeningSets', 'listeningSet', 'listeningAudioUrl', 'postListeningAttempt',
    'readingSets', 'readingSet', 'postReadingAttempt',
    'writingTasks', 'postWritingAttempt', 'writingAttempt',
    'attempts', 'attempt', 'deleteAttempt', 'progressSummary', 'progressTrend', 'progressAnalytics',
    'planToday', 'markPlanDone', 'reviewErrors', 'resolveReview', 'deleteReview',
    'wordInfo', 'addVocab', 'vocabList', 'removeVocab', 'vocabExportUrl',
  ] as const;

  it('api 汇总对象包含 §7 全部函数（无 payment/scene 残留）', () => {
    const bundle = apiBundle as unknown as Record<string, unknown>;
    for (const name of REQUIRED_FUNCTIONS) {
      expect(typeof bundle[name], `api.${name} 应为函数`).toBe('function');
    }
    const forbidden = ['scenes', 'scene', 'payment', 'wordbook', 'wrongRecords', 'learningStats', 'achievements', 'sentenceParse', 'phonemeTip'];
    for (const name of forbidden) {
      expect(bundle[name]).toBeUndefined();
    }
  });
});
