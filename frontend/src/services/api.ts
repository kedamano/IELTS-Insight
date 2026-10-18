/**
 * services/api.ts —— 前端唯一的后端出口（契约 §1 端点表 + §7 函数清单）。
 *
 * 规则（CONSTITUTION §3、AC-X4）：
 * - 端口/基址只在本文件出现一处（`API_BASE`），可被 `import.meta.env.VITE_API_BASE` 覆盖。
 * - 组件内禁止裸 `fetch`；音频/文件类也走本文件的 `fetchTtsAudio` / `fetchListeningAudio`。
 * - 后端统一 envelope `{"data": <payload>, "total"?: n}`，这里 unwrap；错误统一成 `ApiError`（中文文案）。
 * - 任何错误文本都会先做密钥脱敏，绝不把 AI key 带进 Error（契约 §3-P 末条、AC-C2）。
 */

import { ACCENT_VOICE } from '../types/ielts';
import type {
  AiKeyPresence,
  Analytics,
  AnalyticsQuery,
  AttemptDetail,
  AttemptListResult,
  AttemptSummary,
  AttemptsQuery,
  Band,
  ChartData,
  FollowupsBody,
  FollowupsResult,
  GradingJob,
  HealthResponse,
  ListeningObjectiveReport,
  ListeningSet,
  ListeningSetsQuery,
  ListeningSetMeta,
  ListResult,
  Module,
  ModuleReport,
  ObjectiveAttemptBody,
  PlanDoneBody,
  PlanTodayResult,
  ProgressSummary,
  ProgressTrend,
  ReadingObjectiveReport,
  ReadingSet,
  ReadingSetsQuery,
  ReadingSetMeta,
  ReviewItem,
  ReviewQuery,
  Settings,
  SettingsPatch,
  SpeakingPrompt,
  SpeakingGradingJob,
  SpeakingReport,
  SpeakingSession,
  SpeakingSessionStart,
  SpeakingSet,
  SpeakingSetMeta,
  SpeakingTurnInput,
  SpeakingTurnResult,
  StartSpeakingBody,
  TtsVoice,
  VocabAddBody,
  VocabExportFormat,
  VocabNote,
  WordInfo,
  Accent,
  WritingAttemptBody,
  WritingGradingJob,
  WritingReport,
  WritingTask,
  WritingTask1,
  WritingTaskKind,
  WritingTasksQuery,
} from '../types/ielts';

// ============================================================
// 基址（AC-X4：唯一一处端口）
// ============================================================

/** 默认本地 sidecar 地址。端口只在这里出现一次。 */
const DEFAULT_API_BASE = 'http://127.0.0.1:8765/api';

/**
 * `vite-env.d.ts` 不归本 agent，所以这里用局部 cast 读 env，不依赖 `ImportMetaEnv` 是否被加宽。
 * 若想让 `import.meta.env.VITE_API_BASE` 有强类型，请由 ui/pkg 在 `src/vite-env.d.ts` 追加：
 *   interface ImportMetaEnv { readonly VITE_API_BASE?: string }
 */
type AppEnv = { VITE_API_BASE?: string | undefined };

function readEnv(): AppEnv {
  const meta = import.meta as ImportMeta & { env?: AppEnv };
  return meta.env ?? {};
}

/** 允许传 `http://host:port` 或 `http://host:port/api`，统一补齐 `/api` 后缀。 */
function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE;
  return /\/api$/i.test(trimmed) ? trimmed : `${trimmed}/api`;
}

/** 全应用唯一基址。 */
export const API_BASE: string = normalizeBase(readEnv().VITE_API_BASE ?? '');

/** 拼绝对 URL（`apiUrl('/health')` → `${API_BASE}/health`）。 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

// ============================================================
// 错误
// ============================================================

/** HTTP/网络错误的统一表示；`message` 恒为简体中文可读文本。 */
export class ApiError extends Error {
  /** 0 = 没连上后端（网络/未启动）；其余为 HTTP 状态码。 */
  readonly status: number;
  /** 契约 §0 的机器码，如 `tts_unavailable`。 */
  readonly code: string | null;
  /** 后端 `detail` 原文（已脱敏）。 */
  readonly detail: string;

  constructor(message: string, status: number, code: string | null = null, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail ?? message;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  );
}

/** 音频/AI 依赖服务不可用（AC-L1b：界面显示「音频不可用，可看原文精读」）。 */
export function isServiceUnavailable(error: unknown): boolean {
  return isApiError(error) && (error.status === 503 || error.code === 'tts_unavailable' || error.code === 'audio_unavailable');
}

/** 密钥永远不得出现在错误里（契约 §3-P）。除通用形态外，还会替换调用方显式传入的值。 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_.\-]{4,}/gi,
  /Bearer\s+[A-Za-z0-9._\-]{4,}/gi,
  /((?:api[_-]?key|apikey|openai[_-]?key)["']?\s*[:=]\s*)["']?[^\s"',}]{4,}["']?/gi,
];

function scrubSecret(text: string, extra: readonly string[] = []): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_matched, p1?: string) => (p1 ? `${p1}[已隐藏]` : '[已隐藏]'));
  }
  for (const secret of extra) {
    if (typeof secret === 'string' && secret.length >= 4 && out.includes(secret)) {
      out = out.split(secret).join('[已隐藏]');
    }
  }
  return out;
}

/** 把任意异常转成中文可读的 Error（网络失败不给浏览器原文，AC-G1/AC-S3）。 */
export function toReadableError(error: unknown, redact: readonly string[] = []): Error {
  if (isAbortError(error)) return error as Error;
  if (error instanceof ApiError) return error;
  const raw = error instanceof Error ? error.message : String(error ?? '未知错误');
  return new ApiError(scrubSecret(`请求失败：${raw}`, redact), 0, null, scrubSecret(raw, redact));
}

// ============================================================
// fetch 基础设施（envelope unwrap + 中文错误）
// ============================================================

export interface ApiRequestOptions {
  signal?: AbortSignal;
  /** 需要额外从错误文本里抹掉的字符串（如用户刚提交的 AI key）。 */
  redact?: readonly string[];
}

const JSON_HEADERS: Readonly<Record<string, string>> = { 'Content-Type': 'application/json' };

async function send(url: string, init: RequestInit, opts?: ApiRequestOptions): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: opts?.signal });
  } catch (error) {
    if (isAbortError(error) || opts?.signal?.aborted) throw error;
    // 浏览器原生只给 "Failed to fetch"，对排查毫无帮助，这里换成可读的原因
    throw new ApiError('无法连接后端服务（后端未启动或请求被拦截）', 0, 'network_error', 'Failed to fetch');
  }
}

async function toApiError(res: Response, redact: readonly string[]): Promise<ApiError> {
  let detail = res.statusText || '请求失败';
  let code: string | null = null;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const rec = body as Record<string, unknown>;
      if (rec.detail !== undefined && rec.detail !== null) {
        detail = typeof rec.detail === 'string' ? rec.detail : JSON.stringify(rec.detail);
      }
      if (typeof rec.code === 'string') code = rec.code;
    }
  } catch {
    /* 响应体不是 JSON（如 502 的 HTML），保留 statusText */
  }
  const safeDetail = scrubSecret(detail, redact);
  return new ApiError(`请求失败 ${res.status}：${safeDetail}`, res.status, code, safeDetail);
}

/** 拿到未 unwrap 的 envelope，供需要顶层 `total` 的端点使用。 */
async function fetchEnvelope<T>(
  url: string,
  init: RequestInit = {},
  opts?: ApiRequestOptions,
): Promise<{ data: T; total?: number }> {
  const redact = opts?.redact ?? [];
  const res = await send(url, init, opts);
  if (!res.ok) throw await toApiError(res, redact);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(`请求失败 ${res.status}：后端返回了无法解析的内容`, res.status, 'invalid_json');
  }
  if (body && typeof body === 'object' && 'data' in body) {
    const env = body as { data: T; total?: number };
    return { data: env.data, total: typeof env.total === 'number' ? env.total : undefined };
  }
  return { data: body as T };
}

/** 契约 §0：除音频/文件外全部 `{data}`，这里统一 unwrap。 */
export async function fetchJson<T>(url: string, init: RequestInit = {}, opts?: ApiRequestOptions): Promise<T> {
  return (await fetchEnvelope<T>(url, init, opts)).data;
}

/** `data` 为 `{items,total}` 或直接是数组时统一取数组（后端两种都出现过，前端不该崩）。 */
async function fetchItems<T>(url: string, init: RequestInit = {}, opts?: ApiRequestOptions): Promise<T[]> {
  const data = await fetchJson<T[] | ListResult<T>>(url, init, opts);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as ListResult<T>).items)) {
    return (data as ListResult<T>).items;
  }
  return [];
}

async function fetchBlob(url: string, opts?: ApiRequestOptions): Promise<Blob> {
  const res = await send(url, { method: 'GET' }, opts);
  if (!res.ok) throw await toApiError(res, opts?.redact ?? []);
  return res.blob();
}

function postJson(body: unknown): RequestInit {
  return { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function patchJson(body: unknown): RequestInit {
  return { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function putJson(body: unknown): RequestInit {
  return { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) };
}

/** 只拼非空 query 参数。 */
function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const out = sp.toString();
  return out ? `?${out}` : '';
}

const enc = encodeURIComponent;

// ============================================================
// 1. 健康 / 设置 / AI 密钥（#1–#5）
// ============================================================

/** #1 `GET /health`。`useBackendReady` 用它轮询（AC-G1）。 */
export function health(opts?: ApiRequestOptions): Promise<HealthResponse> {
  return fetchJson<HealthResponse>(apiUrl('/health'), {}, opts);
}

/** #2 `GET /settings`。 */
export function getSettings(opts?: ApiRequestOptions): Promise<Settings> {
  return fetchJson<Settings>(apiUrl('/settings'), {}, opts);
}

/** #3 `PATCH /settings`：只提交传入字段，未提供字段保持原值（AC-C1）。 */
export function patchSettings(patch: SettingsPatch, opts?: ApiRequestOptions): Promise<Settings> {
  return fetchJson<Settings>(apiUrl('/settings'), patchJson(patch), opts);
}

/** #4 `PUT /settings/ai-key`：key 只发不回显（AC-C2）。 */
export function setAiKey(key: string, opts?: ApiRequestOptions): Promise<AiKeyPresence> {
  return fetchJson<AiKeyPresence>(
    apiUrl('/settings/ai-key'),
    putJson({ key }),
    { ...opts, redact: [...(opts?.redact ?? []), key] },
  );
}

/** #5 `DELETE /settings/ai-key`。 */
export function clearAiKey(opts?: ApiRequestOptions): Promise<AiKeyPresence> {
  return fetchJson<AiKeyPresence>(apiUrl('/settings/ai-key'), { method: 'DELETE' }, opts);
}

// ============================================================
// 2. 口语（#6–#12）
// ============================================================

/** #6 `GET /speaking/sets?target_band=`。 */
export function speakingSets(targetBand?: Band | null, opts?: ApiRequestOptions): Promise<SpeakingSetMeta[]> {
  return fetchItems<SpeakingSetMeta>(apiUrl(`/speaking/sets${qs({ target_band: targetBand })}`), {}, opts);
}

/** #7 `GET /speaking/sets/{id}`。 */
export function speakingSet(id: string, opts?: ApiRequestOptions): Promise<SpeakingSet> {
  return fetchJson<SpeakingSet>(apiUrl(`/speaking/sets/${enc(id)}`), {}, opts);
}

/** #8 `POST /speaking/sessions`。 */
export function startSpeaking(body: StartSpeakingBody, opts?: ApiRequestOptions): Promise<SpeakingSessionStart> {
  return fetchJson<SpeakingSessionStart>(apiUrl('/speaking/sessions'), postJson(body), opts);
}

/** #9 `GET /speaking/sessions/{id}`。 */
export function getSpeakingSession(id: string, opts?: ApiRequestOptions): Promise<SpeakingSession> {
  return fetchJson<SpeakingSession>(apiUrl(`/speaking/sessions/${enc(id)}`), {}, opts);
}

/** 结构化入参 → 契约要求的 multipart（`audio` 或 `text` + `duration_sec`）。 */
export function buildSpeakingTurnForm(input: SpeakingTurnInput): FormData {
  const form = new FormData();
  if (input.audio) {
    form.append('audio', input.audio, 'speech.webm');
  } else if (input.text !== undefined) {
    form.append('text', input.text);
  } else {
    throw new ApiError('口语提交需要音频或文本二者之一', 400, 'missing_input');
  }
  if (typeof input.durationSec === 'number') form.append('duration_sec', String(input.durationSec));
  return form;
}

/**
 * #10 `POST /speaking/sessions/{id}/turn`（multipart）。
 * 既接受自组 `FormData`（契约 §7 的 `form` 形参），也接受结构化 `SpeakingTurnInput`。
 * 无音频/超大会得到 400/413，文案已含中文 detail（AC-S3）。
 */
export function postSpeakingTurn(
  id: string,
  form: FormData | SpeakingTurnInput,
  opts?: ApiRequestOptions,
): Promise<SpeakingTurnResult> {
  const body = form instanceof FormData ? form : buildSpeakingTurnForm(form);
  return fetchJson<SpeakingTurnResult>(apiUrl(`/speaking/sessions/${enc(id)}/turn`), { method: 'POST', body }, opts);
}

/** #11 `POST /speaking/sessions/{id}/assess`。 */
export function assessSpeaking(id: string, opts?: ApiRequestOptions): Promise<SpeakingReport> {
  return fetchJson<SpeakingReport>(apiUrl(`/speaking/sessions/${enc(id)}/assess`), { method: 'POST' }, opts);
}

/** #11b `POST /speaking/sessions/{id}/assess/async`：排队评分，立即拿到 job_id（契约 §10.6）。 */
export function assessSpeakingAsync(id: string, opts?: ApiRequestOptions): Promise<SpeakingGradingJob> {
  return fetchJson<SpeakingGradingJob>(
    apiUrl(`/speaking/sessions/${enc(id)}/assess/async`),
    { method: 'POST' },
    opts,
  );
}

/** #12 `POST /speaking/followups`（失败时后端回落预置追问，AC-S6）。 */
export function followups(body: FollowupsBody, opts?: ApiRequestOptions): Promise<FollowupsResult> {
  return fetchJson<FollowupsResult>(apiUrl('/speaking/followups'), postJson(body), opts);
}

/** 契约 §1 说明：`POST /stt` 前端主流程不再直接调用，仅保留兜底复用。 */
export function postStt(blob: Blob, opts?: ApiRequestOptions): Promise<{ text: string; confidence: number }> {
  const form = new FormData();
  form.append('audio', blob, 'speech.webm');
  return fetchJson<{ text: string; confidence: number }>(apiUrl('/stt'), { method: 'POST', body: form }, opts);
}

// ============================================================
// 3. 听力（#13–#16）
// ============================================================

/** #13 `GET /listening/sets?accent=&kind=`。 */
export function listeningSets(query: ListeningSetsQuery = {}, opts?: ApiRequestOptions): Promise<ListeningSetMeta[]> {
  return fetchItems<ListeningSetMeta>(apiUrl(`/listening/sets${qs({ accent: query.accent, kind: query.kind })}`), {}, opts);
}

/** #14 `GET /listening/sets/{id}`（响应不含答案，契约 §2-L）。 */
export function listeningSet(id: string, opts?: ApiRequestOptions): Promise<ListeningSet> {
  return fetchJson<ListeningSet>(apiUrl(`/listening/sets/${enc(id)}`), {}, opts);
}

/** #15 音频 URL（给 `<audio src>` 用；无法暴露 503，播放失败请改用 `fetchListeningAudio`）。 */
export function listeningAudioUrl(id: string, accent?: Accent | null): string {
  return apiUrl(`/listening/sets/${enc(id)}/audio${qs({ accent })}`);
}

/** #15 音频字节流：503 时抛 `ApiError(code='tts_unavailable')`，供 AC-L1b 精读回落。 */
export function fetchListeningAudio(id: string, accent?: Accent | null, opts?: ApiRequestOptions): Promise<Blob> {
  return fetchBlob(listeningAudioUrl(id, accent), opts);
}

/** #16 `POST /listening/sets/{id}/attempt`（含 transcript）。 */
export function postListeningAttempt(
  id: string,
  body: ObjectiveAttemptBody,
  opts?: ApiRequestOptions,
): Promise<ListeningObjectiveReport> {
  return fetchJson<ListeningObjectiveReport>(apiUrl(`/listening/sets/${enc(id)}/attempt`), postJson(body), opts);
}

// ============================================================
// 4. 阅读（#17–#19）
// ============================================================

/** #17 `GET /reading/sets?level=`。 */
export function readingSets(query: ReadingSetsQuery = {}, opts?: ApiRequestOptions): Promise<ReadingSetMeta[]> {
  return fetchItems<ReadingSetMeta>(apiUrl(`/reading/sets${qs({ level: query.level })}`), {}, opts);
}

/** #18 `GET /reading/sets/{id}`（响应不含答案）。 */
export function readingSet(id: string, opts?: ApiRequestOptions): Promise<ReadingSet> {
  return fetchJson<ReadingSet>(apiUrl(`/reading/sets/${enc(id)}`), {}, opts);
}

/** #19 `POST /reading/sets/{id}/attempt`（到点自动提交时 `timed_out: true`，AC-R3）。 */
export function postReadingAttempt(
  id: string,
  body: ObjectiveAttemptBody,
  opts?: ApiRequestOptions,
): Promise<ReadingObjectiveReport> {
  return fetchJson<ReadingObjectiveReport>(apiUrl(`/reading/sets/${enc(id)}/attempt`), postJson(body), opts);
}

// ============================================================
// 5. 写作（#20–#22）
// ============================================================

/** 契约 §1 #20/AC-W1 写作 `chart.data`，§2-W 写作 `chart` 本身即数据；此处兼容两种形态。 */
function pickChartData(raw: unknown): ChartData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.type === 'string') return raw as ChartData;
  const nested = rec.data;
  if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).type === 'string') {
    return { ...rec, ...nested } as unknown as ChartData;
  }
  return undefined;
}

function normalizeWritingTask(task: WritingTask): WritingTask {
  if (task.task !== 'task1') return task;
  const chart = pickChartData(task.chart);
  if (!chart) return task;
  const normalized: WritingTask1 = { ...task, chart };
  return normalized;
}

/** #20 `GET /writing/tasks?module=task1|task2`。 */
export function writingTasks(query?: WritingTasksQuery, opts?: ApiRequestOptions): Promise<WritingTask[]> {
  const module: WritingTaskKind | undefined =
    typeof query === 'string' ? query : query && 'module' in query ? query.module : undefined;
  return fetchItems<WritingTask>(apiUrl(`/writing/tasks${qs({ module })}`), {}, opts).then((items) =>
    items.map(normalizeWritingTask),
  );
}

/** #21 `POST /writing/attempts`。 */
export function postWritingAttempt(body: WritingAttemptBody, opts?: ApiRequestOptions): Promise<WritingReport> {
  return fetchJson<WritingReport>(apiUrl('/writing/attempts'), postJson(body), opts);
}

/** #21b `POST /writing/attempts/async`：排队批改，立即拿到 job_id（契约 §10.6）。 */
export function postWritingAttemptAsync(
  body: WritingAttemptBody,
  opts?: ApiRequestOptions,
): Promise<WritingGradingJob> {
  return fetchJson<WritingGradingJob>(apiUrl('/writing/attempts/async'), postJson(body), opts);
}

/** #22b `GET /jobs/{job_id}`：轮询异步批改任务；成功时 `report` 即完整报告。 */
export function gradingJob<R extends ModuleReport = ModuleReport>(
  jobId: string,
  opts?: ApiRequestOptions,
): Promise<GradingJob<R>> {
  return fetchJson<GradingJob<R>>(apiUrl(`/jobs/${enc(jobId)}`), {}, opts);
}

/** #22c `GET /jobs?status=active`：仍未完成的批改任务（离开页面后找回用）。 */
export function gradingJobs(
  query: { status?: 'all' | 'active'; limit?: number } = {},
  opts?: ApiRequestOptions,
): Promise<GradingJob[]> {
  return fetchItems<GradingJob>(apiUrl(`/jobs${qs({ status: query.status, limit: query.limit })}`), {}, opts);
}

/** #22 `GET /writing/attempts/{id}`。 */
export function writingAttempt(id: string, opts?: ApiRequestOptions): Promise<WritingReport> {
  return fetchJson<WritingReport>(apiUrl(`/writing/attempts/${enc(id)}`), {}, opts);
}

// ============================================================
// 6. 记录 / 进度 / 计划（#23–#30）
// ============================================================

/** #23 `GET /attempts?module=&limit=&offset=`。 */
export async function attempts(query: AttemptsQuery = {}, opts?: ApiRequestOptions): Promise<AttemptListResult> {
  const { data, total } = await fetchEnvelope<AttemptSummary[] | ListResult<AttemptSummary>>(
    apiUrl(`/attempts${qs({ module: query.module, limit: query.limit, offset: query.offset })}`),
    {},
    opts,
  );
  const items = Array.isArray(data) ? data : data.items ?? [];
  const fromPayload = Array.isArray(data) ? undefined : data.total;
  return { items, total: fromPayload ?? total ?? items.length };
}

/** #24 `GET /attempts/{id}`。 */
export function attempt(id: string, opts?: ApiRequestOptions): Promise<AttemptDetail> {
  return fetchJson<AttemptDetail>(apiUrl(`/attempts/${enc(id)}`), {}, opts);
}

/** #25 `DELETE /attempts/{id}`（后端会重算趋势，FR-P4）。 */
export function deleteAttempt(id: string, opts?: ApiRequestOptions): Promise<{ deleted: boolean }> {
  return fetchJson<{ deleted: boolean }>(apiUrl(`/attempts/${enc(id)}`), { method: 'DELETE' }, opts);
}

/** #26 `GET /progress/summary`。 */
export function progressSummary(opts?: ApiRequestOptions): Promise<ProgressSummary> {
  return fetchJson<ProgressSummary>(apiUrl('/progress/summary'), {}, opts);
}

/** #27 `GET /progress/trend?module=&days=`。 */
export function progressTrend(query: { module?: Module; days?: number } = {}, opts?: ApiRequestOptions): Promise<ProgressTrend> {
  return fetchJson<ProgressTrend>(apiUrl(`/progress/trend${qs({ module: query.module, days: query.days })}`), {}, opts);
}

/** #28 `GET /progress/analytics?weeks=8`。 */
export function progressAnalytics(query: AnalyticsQuery = {}, opts?: ApiRequestOptions): Promise<Analytics> {
  return fetchJson<Analytics>(apiUrl(`/progress/analytics${qs({ weeks: query.weeks })}`), {}, opts);
}

/** #29 `GET /plan/today`。 */
export function planToday(opts?: ApiRequestOptions): Promise<PlanTodayResult> {
  return fetchJson<PlanTodayResult>(apiUrl('/plan/today'), {}, opts);
}

/** #30 `POST /plan/{task_id}/done`。 */
export function markPlanDone(id: string, done: boolean, opts?: ApiRequestOptions): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(apiUrl(`/plan/${enc(id)}/done`), postJson({ done } satisfies PlanDoneBody), opts);
}

// ============================================================
// 7. 错题本（#31–#33）
// ============================================================

/** #31 `GET /review/errors?module=&status=&error_type=`。 */
export function reviewErrors(query: ReviewQuery = {}, opts?: ApiRequestOptions): Promise<ReviewItem[]> {
  return fetchItems<ReviewItem>(
    apiUrl(`/review/errors${qs({ module: query.module, status: query.status, error_type: query.error_type })}`),
    {},
    opts,
  );
}

/** #32 `POST /review/{id}/resolve`（手动「已掌握」，FR-V2）。 */
export function resolveReview(id: string, opts?: ApiRequestOptions): Promise<{ status: string }> {
  return fetchJson<{ status: string }>(apiUrl(`/review/${enc(id)}/resolve`), { method: 'POST' }, opts);
}

/** #33 `DELETE /review/{id}`。 */
export function deleteReview(id: string, opts?: ApiRequestOptions): Promise<{ deleted: boolean }> {
  return fetchJson<{ deleted: boolean }>(apiUrl(`/review/${enc(id)}`), { method: 'DELETE' }, opts);
}

// ============================================================
// 8. 词汇（#34–#38）
// ============================================================

/** #34 `GET /vocab?word=`。 */
export function wordInfo(word: string, opts?: ApiRequestOptions): Promise<WordInfo> {
  return fetchJson<WordInfo>(apiUrl(`/vocab${qs({ word })}`), {}, opts);
}

/** #35 `POST /vocab`。 */
export function addVocab(body: VocabAddBody, opts?: ApiRequestOptions): Promise<VocabNote> {
  return fetchJson<VocabNote>(apiUrl('/vocab'), postJson(body), opts);
}

/** #36 `GET /vocab`。 */
export function vocabList(opts?: ApiRequestOptions): Promise<VocabNote[]> {
  return fetchItems<VocabNote>(apiUrl('/vocab'), {}, opts);
}

/** #37 `DELETE /vocab/{word}`。 */
export function removeVocab(word: string, opts?: ApiRequestOptions): Promise<{ deleted: boolean }> {
  return fetchJson<{ deleted: boolean }>(apiUrl(`/vocab/${enc(word)}`), { method: 'DELETE' }, opts);
}

/** #38 导出 URL（CSV / Anki TSV；文件响应不走 envelope）。 */
export function vocabExportUrl(format: VocabExportFormat = 'csv'): string {
  return apiUrl(`/vocab/export${qs({ format })}`);
}

// ============================================================
// 9. TTS（#39）
// ============================================================

export interface TtsOptions {
  voice?: TtsVoice | null;
  speed?: number | null;
  accent?: Accent | null;
}

/** `voice` 缺省时由 `accent` 推导默认音色（FR-L1 两种口音，映射表来自 types/ielts）。 */
export function resolveVoice(options: TtsOptions = {}): TtsVoice | undefined {
  if (options.voice) return options.voice;
  if (options.accent) return ACCENT_VOICE[options.accent];
  return undefined;
}

/** #39 `GET /tts?text=&voice=&speed=` 的 URL（不走 envelope，仅供 `<audio src>`）。 */
export function ttsUrl(text: string, options: TtsOptions = {}): string {
  return apiUrl(`/tts${qs({ text, voice: resolveVoice(options), speed: options.speed })}`);
}

/**
 * #39 音频字节流。合成失败（断网）时后端返回 503 `{code:"tts_unavailable"}`，
 * 这里抛 `ApiError`，调用方用 `isServiceUnavailable()` 判断并显示「音频不可用」（AC-L1b）。
 */
export function fetchTtsAudio(text: string, options: TtsOptions = {}, opts?: ApiRequestOptions): Promise<Blob> {
  return fetchBlob(ttsUrl(text, options), opts);
}

/** 题面音频 URL（口语考官提问，契约 §2-S `audio_url` 同源）。 */
export function speakingAudioUrl(prompt: Pick<SpeakingPrompt, 'text'>, options: TtsOptions = {}): string {
  return ttsUrl(prompt.text, options);
}

// ============================================================
// 汇总对象（方便 `api.xxx()` 调用与 mock 替换）
// ============================================================

export const api = {
  API_BASE,
  apiUrl,
  health,
  getSettings,
  patchSettings,
  setAiKey,
  clearAiKey,
  speakingSets,
  speakingSet,
  startSpeaking,
  getSpeakingSession,
  postSpeakingTurn,
  assessSpeaking,
  assessSpeakingAsync,
  followups,
  postStt,
  listeningSets,
  listeningSet,
  listeningAudioUrl,
  fetchListeningAudio,
  postListeningAttempt,
  readingSets,
  readingSet,
  postReadingAttempt,
  writingTasks,
  postWritingAttempt,
  postWritingAttemptAsync,
  gradingJob,
  gradingJobs,
  writingAttempt,
  attempts,
  attempt,
  deleteAttempt,
  progressSummary,
  progressTrend,
  progressAnalytics,
  planToday,
  markPlanDone,
  reviewErrors,
  resolveReview,
  deleteReview,
  wordInfo,
  addVocab,
  vocabList,
  removeVocab,
  vocabExportUrl,
  ttsUrl,
  fetchTtsAudio,
  speakingAudioUrl,
} as const;

export default api;
