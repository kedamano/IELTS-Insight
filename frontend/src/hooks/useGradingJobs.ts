/**
 * 异步批改任务的前端队列（契约 §10.6；FR-W3「提交后先做别的」）。
 *
 * 为什么是模块级 store 而不是 Context：批改任务属于整个应用而不是某个面板 ——
 * 提交后切去读阅读，左轨的「批改中」角标、写作页的「查看报告」横幅、完成提示
 * 必须看同一份状态；Context 会把状态锁在挂载子树里，切页即丢。
 *
 * 为什么再写一份 localStorage：Tauri webview 会刷新/重启，任务本体在后端 `jobs` 表里
 * 还活着，但前端若忘掉 `job_id`，用户看到的就是「提交后什么都没发生」。
 *
 * 不做取消：后端没有取消端点，也不该在用户看不见的时候掐掉已经花钱跑的批改。
 * 「知道了/查看过了」只是把任务从这份列表里摘掉。
 */
import { useCallback, useSyncExternalStore } from 'react';
import { gradingJob, isApiError } from '../services/api';
import { isJobSettled, type GradingJob, type GradingJobStatus, type ModuleReport } from '../types/ielts';

export interface TrackedJob {
  job_id: string;
  module: 'writing' | 'speaking';
  /** 写作是 task_id，口语是 session_id；面板用它认领自己的任务。 */
  task_ref: string;
  /** 提交时的题面标签，用于「批改完成 · 写作 Task 2 …」文案。 */
  label: string;
  status: GradingJobStatus;
  attempt_id: string | null;
  report: ModuleReport | null;
  error: string | null;
  degraded_reason: string | null;
  /** 本地提交时刻（毫秒），用于「已等 42 秒」。 */
  submitted_at: number;
  started_at: string | null;
  finished_at: string | null;
  /** 用户看过报告（或明确收起了失败提示）后不再计入「待查看」。 */
  viewed: boolean;
}

export interface GradingJobsState {
  jobs: ReadonlyArray<TrackedJob>;
  /** 仍在排队/批改中的数量（左轨角标）。 */
  pendingCount: number;
  /** 已完成但还没被查看的数量（完成提醒）。 */
  doneCount: number;
}

export const GRADING_JOBS_STORAGE_KEY = 'ielts.grading-jobs';
const POLL_INTERVAL_MS = 2500;
const MAX_TRACKED = 20;
/** 超过这个时长还没终态就不再等：后端 LLM 超时是 120s，正常不可能到这里。 */
const MAX_WAIT_MS = 15 * 60 * 1000;
const TIMEOUT_MESSAGE = '批改等待超过 15 分钟已停止；结果若稍后出现，可在「练习记录」里查看。';
const VANISHED_MESSAGE = '批改任务已不存在（后端可能重启过）；结果请在「练习记录」里确认。';

const listeners = new Set<() => void>();
let jobs: ReadonlyArray<TrackedJob> = [];
let state: GradingJobsState = { jobs, pendingCount: 0, doneCount: 0 };
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let restored = false;

function isPending(job: TrackedJob): boolean {
  return !isJobSettled(job.status);
}

/** 待查看 = 已终态但用户还没打开报告（左轨完成提醒）。 */
function doneCountOf(list: ReadonlyArray<TrackedJob>): number {
  return list.filter((job) => !isPending(job) && !job.viewed).length;
}

function recompute(next: ReadonlyArray<TrackedJob>): void {
  jobs = next;
  state = {
    jobs,
    pendingCount: jobs.filter(isPending).length,
    doneCount: doneCountOf(jobs),
  };
  persist();
  emit();
  ensureLoop();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(GRADING_JOBS_STORAGE_KEY, JSON.stringify(jobs.slice(0, MAX_TRACKED)));
  } catch {
    // 隐私模式/配额写不进去：内存态照旧工作，只是刷新后接不回任务。
  }
}

function restore(): void {
  restored = true;
  if (typeof localStorage === 'undefined') return;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(GRADING_JOBS_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  const list: TrackedJob[] = [];
  for (const item of parsed) {
    const job = reviveJob(item);
    if (job) list.push(job);
  }
  if (!list.length) return;
  jobs = list;
  state = { jobs, pendingCount: list.filter(isPending).length, doneCount: doneCountOf(list) };
  emit();
  ensureLoop();
}
function reviveJob(item: unknown): TrackedJob | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const jobId = typeof raw.job_id === 'string' ? raw.job_id : null;
  const module = raw.module === 'writing' || raw.module === 'speaking' ? raw.module : null;
  const status: GradingJobStatus | null =
    raw.status === 'queued' || raw.status === 'running' || raw.status === 'succeeded' || raw.status === 'failed'
      ? raw.status
      : 'queued';
  if (!jobId || !module || !status) return null;
  return {
    job_id: jobId,
    module,
    task_ref: typeof raw.task_ref === 'string' ? raw.task_ref : '',
    label: typeof raw.label === 'string' ? raw.label : '批改任务',
    status,
    attempt_id: typeof raw.attempt_id === 'string' ? raw.attempt_id : null,
    report: (raw.report ?? null) as ModuleReport | null,
    error: typeof raw.error === 'string' ? raw.error : null,
    degraded_reason: typeof raw.degraded_reason === 'string' ? raw.degraded_reason : null,
    submitted_at: typeof raw.submitted_at === 'number' ? raw.submitted_at : Date.now(),
    started_at: typeof raw.started_at === 'string' ? raw.started_at : null,
    finished_at: typeof raw.finished_at === 'string' ? raw.finished_at : null,
    viewed: raw.viewed === true,
  };
}

function fromApi(job: GradingJob, base: TrackedJob): TrackedJob {
  return {
    ...base,
    module: job.module,
    task_ref: job.task_ref,
    status: job.status,
    attempt_id: job.attempt_id,
    report: job.report,
    error: job.error,
    degraded_reason: job.degraded_reason,
    started_at: job.started_at,
    finished_at: job.finished_at,
  };
}

function ensureLoop(): void {
  const needed = jobs.some(isPending);
  if (!needed) {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    return;
  }
  if (timer === null) timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const now = Date.now();
    const staleIds = new Set<string>();
    const targets = jobs.filter((job) => {
      if (!isPending(job)) return false;
      if (now - job.submitted_at > MAX_WAIT_MS) {
        staleIds.add(job.job_id);
        return false;
      }
      return true;
    });

    const settled = jobs.map((job) =>
      staleIds.has(job.job_id) && isPending(job) ? { ...job, status: 'failed' as const, error: TIMEOUT_MESSAGE } : job,
    );
    if (staleIds.size) recompute(settled);

    const updates = await Promise.all(
      targets.map(async (job): Promise<{ id: string; next: GradingJob | null; vanished: boolean }> => {
        try {
          return { id: job.job_id, next: await gradingJob(job.job_id), vanished: false };
        } catch (error) {
          // 404：任务已不在后端（被清理/换了库）。其余错误（后端未就绪）保持等待，下一轮再试。
          return { id: job.job_id, next: null, vanished: isApiError(error) && error.status === 404 };
        }
      }),
    );

    let list = jobs;
    let changed = false;
    for (const update of updates) {
      if (update.next) {
        const fetched = update.next;
        list = list.map((job) => (job.job_id === update.id ? fromApi(fetched, job) : job));
        changed = true;
      } else if (update.vanished) {
        list = list.map((job) =>
          job.job_id === update.id ? { ...job, status: 'failed' as const, error: VANISHED_MESSAGE } : job,
        );
        changed = true;
      }
    }
    if (changed) recompute(list);
  } finally {
    inFlight = false;
    ensureLoop();
  }
}

/**
 * 清空模块级队列（含 localStorage 与轮询定时器）。
 * 供测试与「全部清除」类操作使用：队列属于整个应用，卸载面板不会重置它。
 */
export function resetGradingJobs(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  inFlight = false;
  restored = false;
  jobs = [];
  state = { jobs, pendingCount: 0, doneCount: 0 };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(GRADING_JOBS_STORAGE_KEY);
    } catch {
      // 读不到也写不到：内存态已清，够了。
    }
  }
  emit();
}

export function trackJob<R extends ModuleReport>(job: GradingJob<R>, label: string): void {
  const entry: TrackedJob = {
    job_id: job.job_id,
    module: job.module,
    task_ref: job.task_ref,
    label,
    status: job.status,
    attempt_id: job.attempt_id,
    report: job.report,
    error: job.error,
    degraded_reason: job.degraded_reason,
    submitted_at: Date.now(),
    started_at: job.started_at,
    finished_at: job.finished_at,
    viewed: false,
  };
  const next = [entry, ...jobs.filter((item) => item.job_id !== entry.job_id)].slice(0, MAX_TRACKED);
  recompute(next);
  if (isPending(entry)) void tick();
}

export function forgetJob(jobId: string): void {
  recompute(jobs.filter((job) => job.job_id !== jobId));
}

export function markJobViewed(jobId: string): void {
  recompute(jobs.map((job) => (job.job_id === jobId ? { ...job, viewed: true } : job)));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!restored) restore();
  ensureLoop();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): GradingJobsState {
  return state;
}

export interface UseGradingJobsResult extends GradingJobsState {
  /** 立刻拉一次后端状态（用户点「刷新」或回到面板时）。 */
  refresh: () => void;
  forget: (jobId: string) => void;
  markViewed: (jobId: string) => void;
}

export function useGradingJobs(): UseGradingJobsResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refresh = useCallback(() => {
    void tick();
  }, []);
  const forget = useCallback((jobId: string) => forgetJob(jobId), []);
  const markViewed = useCallback((jobId: string) => markJobViewed(jobId), []);
  return { ...snapshot, refresh, forget, markViewed };
}
