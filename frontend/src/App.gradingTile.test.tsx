/**
 * 外壳接线（契约 §8.3「第二处可见」第 1 条）：`Dashboard` 那块「正在批改」磁贴吃的是
 * **App 已经在订阅的那份队列 store**，不是它自己再去订阅一遍。
 *
 * 这条只能在外壳层钉：`Dashboard.test.tsx` 是手动塞 props 的，塞错了也能绿；
 * 真机上「左轨有数、概览没数」的形态就是 App 忘了往下传。
 * 单独一个文件同 `App.engineBadge.test.tsx` 的理由 —— `App.test.tsx` 把 Dashboard mock 成会抛。
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it } from 'vitest';
import App from './App';
import { resetGradingJobs, trackJob } from './hooks/useGradingJobs';
import { API_BASE } from './services/api';
import type { WritingGradingJob } from './types/ielts';
import { server } from './test/mocks/server';

const JOB_ID = 'job_shell_0001';

function queued(): WritingGradingJob {
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

beforeEach(() => {
  // 队列 store 是模块级的，`emit()` 会直接打到 App 的订阅上：不清干净就会串下一个用例，
  // 不清在 act 里就会留下「update not wrapped in act」的告警。
  act(() => resetGradingJobs());
  // 轮询要有家可回：一直 404 会被 store 判失败，pendingCount 归 0，测的就不是排队中了。
  server.use(
    http.get(`${API_BASE}/jobs/:jobId`, () => HttpResponse.json({ data: queued() })),
  );
});

afterEach(() => {
  cleanup();
  act(() => resetGradingJobs());
});

it('提交批改后，概览磁贴条与左轨读的是同一份队列状态（§8.3 第 1 条）', async () => {
  render(<App />);
  await screen.findByLabelText('概览关键指标', {}, { timeout: 10000 });

  // 轮询的 fetch 要跨几个宏任务才落地，不等到家就会在 act 外面 setState（React 告警）。
  // 与 useGradingJobs.test.tsx 的 settlePolls 同一个道理。
  await act(async () => {
    trackJob(queued(), '写作 · 远程办公');
    for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const grid = await screen.findByLabelText('概览关键指标');
  const tile = grid.querySelector<HTMLElement>('[data-metric="overview.grading"]');
  if (!tile) throw new Error('概览磁贴条里没有排队中的批改读数（App 没把队列状态传下来）');
  expect(within(tile).getByText('正在批改')).toBeInTheDocument();
  expect(within(tile).getByText('1')).toBeInTheDocument();
}, 20000);
