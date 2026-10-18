/**
 * 异步批改任务的 msw 替身（契约 §1 #11b/#21b/#22b、§10.6）。
 *
 * 写作与口语共用同一套 `jobs` 端点，所以这里只实现一次：
 * - `create()` 造一个 `queued` 任务，返回值就是提交端点该回给前端的 JobView；
 * - 默认**首次轮询即落终态**，让面板测试不必等 2.5s 的真实轮询间隔；
 * - `autoSettle: false` 时任务停在「批改中」，由测试用 `settle()`/`fail()` 手动收尾，
 *   这样才能稳定断言「离开等待页 → 横幅出现报告入口」这条异步主线。
 */
import { HttpResponse, http } from 'msw';
import type { RequestHandler } from 'msw';
import type { GradingJob, ModuleReport } from '../../types/ielts';

const CREATED_AT = '2026-10-18T12:00:00Z';
const STARTED_AT = '2026-10-18T12:00:05Z';
const FINISHED_AT = '2026-10-18T12:00:30Z';

export interface JobMockOptions {
  /** API 前缀，如 `http://127.0.0.1:8765/api`。 */
  base: string;
  /** 默认 true：首次轮询即落终态。 */
  autoSettle?: boolean;
  /** 自动落成功时给出的报告。 */
  reportOf: () => ModuleReport;
  /** 设置后自动落终态即为失败，值即后端 `jobs.error` 原文。 */
  jobError?: string;
}

export interface JobMock {
  handlers: RequestHandler[];
  /** 每次 `GET /jobs/{id}` 轮询的 job_id（按顺序）。 */
  polls: string[];
  create<J extends GradingJob>(module: 'writing' | 'speaking', taskRef: string): J;
  /** 把最早的未结束任务落成 succeeded，返回它的 job_id。 */
  settle: (report?: ModuleReport) => string;
  /** 把最早的未结束任务落成 failed，`error` 为后端原文。 */
  fail: (error: string) => string;
}

export function createJobMock(options: JobMockOptions): JobMock {
  const autoSettle = options.autoSettle ?? true;
  const jobs = new Map<string, GradingJob>();
  const polls: string[] = [];
  let seq = 0;

  const errorResponse = (status: number, code: string, detail: string) =>
    HttpResponse.json({ detail, code }, { status });

  const unfinished = (): GradingJob | null => {
    for (const job of jobs.values()) {
      if (job.status === 'queued' || job.status === 'running') return job;
    }
    return null;
  };

  const settleWith = (job: GradingJob, report: ModuleReport): GradingJob => {
    const succeeded: GradingJob = {
      ...job,
      status: 'succeeded',
      attempt_id: report.attempt_id,
      report,
      degraded_reason: (report as { degraded_reason?: string | null }).degraded_reason ?? null,
      started_at: STARTED_AT,
      finished_at: FINISHED_AT,
    };
    jobs.set(job.job_id, succeeded);
    return succeeded;
  };

  const failWith = (job: GradingJob, error: string): GradingJob => {
    const failed: GradingJob = { ...job, status: 'failed', error, started_at: STARTED_AT, finished_at: FINISHED_AT };
    jobs.set(job.job_id, failed);
    return failed;
  };

  const settle = (report?: ModuleReport): string => {
    const job = unfinished();
    if (!job) throw new Error('测试写错了：当前没有未结束的批改任务');
    return settleWith(job, report ?? options.reportOf()).job_id;
  };

  const fail = (error: string): string => {
    const job = unfinished();
    if (!job) throw new Error('测试写错了：当前没有未结束的批改任务');
    return failWith(job, error).job_id;
  };

  const handlers: RequestHandler[] = [
    http.get(`${options.base}/jobs/:jobId`, ({ params }) => {
      const jobId = String(params.jobId ?? '');
      const job = jobs.get(jobId);
      if (!job) return errorResponse(404, 'not_found', `批改任务不存在：${jobId}`);
      polls.push(jobId);
      if (job.status === 'succeeded' || job.status === 'failed') return HttpResponse.json({ data: job });
      if (!autoSettle) return HttpResponse.json({ data: { ...job, status: 'running', started_at: STARTED_AT } });
      const settled = options.jobError ? failWith(job, options.jobError) : settleWith(job, options.reportOf());
      return HttpResponse.json({ data: settled });
    }),
    http.get(`${options.base}/jobs`, () =>
      HttpResponse.json({
        data: { items: [...jobs.values()].filter((job) => job.status === 'queued' || job.status === 'running') },
      }),
    ),
  ];

  function create<J extends GradingJob>(module: 'writing' | 'speaking', taskRef: string): J {
    seq += 1;
    const job: GradingJob = {
      job_id: `job_test_${seq}`,
      module,
      task_ref: taskRef,
      status: 'queued',
      attempt_id: null,
      report: null,
      error: null,
      degraded_reason: null,
      created_at: CREATED_AT,
      started_at: null,
      finished_at: null,
    };
    jobs.set(job.job_id, job);
    return job as J;
  }

  return { handlers, polls, create, settle, fail };
}
