/**
 * 异步批改队列（契约 §10.6）的行为测试。守的是四条真会伤害用户的规则：
 * 1. 提交后必须看得见任务并被轮询到终态，报告要能落到 job.report（不然「提交后什么都没发生」）；
 * 2. 后端重启导致任务消失（404）要显式失败，不能无限转圈；其余错误（后端还没起来）保持等待；
 * 3. webview 刷新后从 localStorage 接回未结束的任务，等待不因刷新丢失；
 * 4. 超过 15 分钟仍未终态就停手并给出下一步（练习记录），不假装还在算。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API_BASE } from '../services/api';
import { writingReport } from '../features/writing/testHandlers';
import { server } from '../test/mocks/server';
import type { WritingGradingJob } from '../types/ielts';
import {
  GRADING_JOBS_STORAGE_KEY,
  forgetJob,
  resetGradingJobs,
  trackJob,
  useGradingJobs,
} from './useGradingJobs';

const JOB_ID = 'job_hooks_0001';

function queuedJob(): WritingGradingJob {
  return {
    job_id: JOB_ID,
    module: 'writing',
    task_ref: 'wr_t2_remotework_01',
    status: 'queued',
    attempt_id: null,
    report: null,
    error: null,
    degraded_reason: null,
    created_at: '2026-10-18T12:00:00Z',
    started_at: null,
    finished_at: null,
  };
}

/** 让 `GET /jobs/{id}` 按可变状态应答，模拟后端批改进度。 */
function mockJob(next: () => WritingGradingJob | { status: number; detail: string }) {
  const polls: string[] = [];
  server.use(
    http.get(`${API_BASE}/jobs/:jobId`, ({ params }) => {
      polls.push(String(params.jobId));
      const value = next();
      if ('status' in value && typeof value.status === 'number') {
        return HttpResponse.json({ detail: value.detail, code: 'not_found' }, { status: value.status });
      }
      return HttpResponse.json({ data: value });
    }),
  );
  return polls;
}

/** 轮询的 fetch 要跨几个宏任务才落地，不等到家就会在 `act` 外面 setState（React 会告警）。 */
async function settlePolls() {
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetGradingJobs();
});

afterEach(() => {
  cleanup();
  resetGradingJobs();
  server.resetHandlers();
});

describe('useGradingJobs', () => {
  it('认领任务后立即轮询，成功时报告与待查看计数一起到位', async () => {
    let phase = 'running';
    const succeeded: WritingGradingJob = {
      ...queuedJob(),
      status: 'succeeded',
      attempt_id: 'att_1',
      report: writingReport({ attempt_id: 'att_1' }),
      finished_at: '2026-10-18T12:01:30Z',
    };
    const polls = mockJob(() => (phase === 'succeeded' ? succeeded : { ...queuedJob(), status: 'running' }));

    const { result } = renderHook(() => useGradingJobs());
    await act(async () => {
      trackJob(queuedJob(), '写作 · 远程办公');
      await settlePolls();
    });

    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0]).toMatchObject({ job_id: JOB_ID, label: '写作 · 远程办公', module: 'writing' });
    expect(polls).toEqual([JOB_ID]);
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.doneCount).toBe(0);

    phase = 'succeeded';
    await act(async () => {
      result.current.refresh();
      await settlePolls();
    });

    expect(result.current.jobs[0].status).toBe('succeeded');
    expect(result.current.jobs[0].attempt_id).toBe('att_1');
    expect(result.current.jobs[0].report).toMatchObject({ task: 'task2' });
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.doneCount).toBe(1);

    act(() => {
      result.current.markViewed(JOB_ID);
    });
    expect(result.current.doneCount).toBe(0);
  });

  it('任务在后端已不存在（404）时显式失败，不在界面上无限等待', async () => {
    mockJob(() => ({ status: 404, detail: `批改任务不存在：${JOB_ID}` }));
    const { result } = renderHook(() => useGradingJobs());
    await act(async () => {
      trackJob(queuedJob(), '写作 · 远程办公');
      await settlePolls();
    });

    expect(result.current.jobs[0].status).toBe('failed');
    expect(result.current.jobs[0].error).toContain('批改任务已不存在');
    expect(result.current.pendingCount).toBe(0);
  });

  it('后端暂时不可用（非 404）时保持等待，不误报失败', async () => {
    mockJob(() => ({ status: 500, detail: '数据库被占用' }));
    const { result } = renderHook(() => useGradingJobs());
    await act(async () => {
      trackJob(queuedJob(), '写作 · 远程办公');
      await settlePolls();
    });

    expect(result.current.jobs[0].status).toBe('queued');
    expect(result.current.pendingCount).toBe(1);
  });

  it('webview 刷新后从 localStorage 接回未结束的任务并继续等', async () => {
    localStorage.setItem(
      GRADING_JOBS_STORAGE_KEY,
      JSON.stringify([
        {
          ...queuedJob(),
          status: 'running',
          label: '写作 · 远程办公',
          submitted_at: Date.now() - 30_000,
          viewed: false,
        },
      ]),
    );
    let phase = 'running';
    const polls = mockJob(() =>
      phase === 'succeeded' ? { ...queuedJob(), status: 'succeeded', report: writingReport() } : { ...queuedJob(), status: 'running' },
    );

    const { result } = renderHook(() => useGradingJobs());
    await act(async () => {
      result.current.refresh();
      await settlePolls();
    });

    expect(polls).toEqual([JOB_ID]);
    expect(result.current.jobs[0]).toMatchObject({ label: '写作 · 远程办公', status: 'running' });

    phase = 'succeeded';
    await act(async () => {
      result.current.refresh();
      await settlePolls();
    });
    expect(result.current.jobs[0].status).toBe('succeeded');
  });

  it('等待超过 15 分钟就停手，并说明去哪里确认结果', async () => {
    localStorage.setItem(
      GRADING_JOBS_STORAGE_KEY,
      JSON.stringify([
        {
          ...queuedJob(),
          status: 'running',
          label: '写作 · 远程办公',
          submitted_at: Date.now() - 16 * 60 * 1000,
          viewed: false,
        },
      ]),
    );
    const polls = mockJob(() => ({ ...queuedJob(), status: 'running' }));

    const { result } = renderHook(() => useGradingJobs());
    await act(async () => {
      result.current.refresh();
      await settlePolls();
    });

    expect(polls).toEqual([]);
    expect(result.current.jobs[0].status).toBe('failed');
    expect(result.current.jobs[0].error).toContain('15 分钟');
  });

  it('移除任务后不再轮询，也不留在本机记录里', async () => {
    const polls = mockJob(() => ({ ...queuedJob(), status: 'running' }));
    renderHook(() => useGradingJobs());
    await act(async () => {
      trackJob(queuedJob(), '写作 · 远程办公');
      await settlePolls();
    });
    expect(polls).toEqual([JOB_ID]);
    expect(JSON.parse(localStorage.getItem(GRADING_JOBS_STORAGE_KEY) ?? '[]')).toHaveLength(1);

    act(() => {
      forgetJob(JOB_ID);
    });
    expect(JSON.parse(localStorage.getItem(GRADING_JOBS_STORAGE_KEY) ?? '[]')).toHaveLength(0);

    // 再挂一个订阅者并手动刷新：队列为空就不该再发任何轮询请求
    const second = renderHook(() => useGradingJobs());
    await act(async () => {
      second.result.current.refresh();
      await settlePolls();
    });
    expect(polls).toEqual([JOB_ID]);
  });
});
