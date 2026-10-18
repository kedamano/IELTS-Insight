import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { server } from '../../test/mocks/server';
import SpeakingPanel from './SpeakingPanel';
import { createSpeakingHandlers, turnResult } from './testHandlers';

/**
 * AC-S2：Part 2 的两段计时（60s 准备 + 120s 独白）。
 *
 * 断言的是行为而不是实现：
 * - 准备倒计时到点**只切一次**阶段（不会反复触发）；
 * - 独白倒计时到点自动停止录音、自动提交**只发生一次**；
 * - 提交出去的 `duration_sec` 就是实测时长（120s，误差 ≤1s）；
 * - 到点后界面进入「已用时 2:00」，续录按钮禁用。
 *
 * 时间用 vitest 虚拟时钟推进（`advanceTimersByTimeAsync` 会顺带排空 Promise 队列，
 * msw 的请求因此在虚拟时间里照常落地），所以 120s 不占用真实 120s。
 * `performance`/`Date` 一并 fake，实测时长（`useRecorder.elapsedMs`）与倒计时走同一条时间轴。
 */

const FAKED_TIMERS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'Date',
  'performance',
] as const;

beforeAll(() => {
  class FakeMediaRecorder {
    static isTypeSupported() {
      return true;
    }
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start() {
      this.state = 'recording';
      this.ondataavailable?.({ data: new Blob(['webm-bytes'], { type: 'audio/webm' }) });
    }
    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
  }
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
  });
});

let restoreTurnFetch: (() => void) | null = null;

afterEach(() => {
  restoreTurnFetch?.();
  restoreTurnFetch = null;
  cleanup();
  server.resetHandlers();
  vi.useRealTimers();
});

/** 让虚拟时间前进 ms，并把期间的 React 更新与在途请求排空。 */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function tickUntil(condition: () => boolean, label: string) {
  for (let step = 0; step < 20; step += 1) {
    await tick(50);
    if (condition()) return;
  }
  throw new Error(`虚拟时间推进完毕仍未满足条件：${label}`);
}

async function enterPart2() {
  render(<SpeakingPanel ready />);
  await tickUntil(() => screen.queryByRole('tab', { name: 'Part 2' }) !== null, 'Part 2 选项卡出现');
  fireEvent.click(screen.getByRole('tab', { name: 'Part 2' }));
  fireEvent.click(screen.getByRole('button', { name: /开始 想学的技能/ }));
  await tickUntil(
    () => screen.queryByText('Describe a skill you would like to learn.') !== null,
    'Part 2 题卡题面',
  );
}

it('60s 准备到点自动进入独白，120s 到点自动停止且只提交一次（AC-S2）', async () => {
  const ctx = createSpeakingHandlers({
    turns: [turnResult({ transcript: 'a two minute monologue', next: null, elapsed_limit_reached: true })],
  });
  server.use(...ctx.handlers);
  restoreTurnFetch = ctx.captureTurns();

  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
  await enterPart2();

  // 准备阶段：60s 倒计时走表
  expect(screen.getByRole('timer')).toHaveTextContent('1:00');
  await tick(59_000);
  expect(screen.getByRole('timer')).toHaveTextContent('0:01');

  await tick(1_000);
  // 到点：只切一次阶段（准备区收起，出现 120s 独白计时）
  expect(screen.getByText('准备结束')).toBeInTheDocument();
  expect(screen.getByRole('timer')).toHaveTextContent('2:00');

  fireEvent.click(screen.getByRole('button', { name: '开始录音' }));
  await tickUntil(() => screen.queryByText('停止') !== null, '录音中显示停止按钮');

  // 独白计时随录音走表（未开麦不计时）
  await tick(1_000);
  expect(screen.getByRole('timer')).toHaveTextContent('1:59');

  await tick(119_000);
  await tickUntil(() => ctx.turnCalls.length === 1, '到点自动提交 turn');

  // 到点自动提交：duration_sec 来自实测录音时长（AC-S2 ≤1s）
  expect(ctx.turnCalls).toHaveLength(1);
  expect(ctx.turnCalls[0].audioBytes).toBeGreaterThan(0);
  expect(Number(ctx.turnCalls[0].durationSec)).toBeGreaterThanOrEqual(119);
  expect(Number(ctx.turnCalls[0].durationSec)).toBeLessThanOrEqual(121);

  // 再继续走表：确认「只提交一次」不是巧合
  await tick(10_000);
  expect(ctx.turnCalls).toHaveLength(1);

  // UI 进入「已用时 2:00」，续录按钮禁用
  expect(screen.getByText('已用时 2:00')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '录音不可续' })).toBeDisabled();
});

it('准备阶段可以跳过（AC-S2「可跳过」）', async () => {
  const ctx = createSpeakingHandlers();
  server.use(...ctx.handlers);
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
  await enterPart2();

  fireEvent.click(screen.getByRole('button', { name: '跳过准备，直接开始' }));
  await tick(0);

  expect(screen.getByRole('timer')).toHaveTextContent('2:00');
  expect(screen.getByRole('button', { name: '开始录音' })).toBeEnabled();
  expect(ctx.turnCalls).toHaveLength(0);
});

it('未到点时手动停止可以提交录音，且时长取实测值（FR-S3）', async () => {
  const ctx = createSpeakingHandlers({
    turns: [turnResult({ transcript: 'short answer', next: null, elapsed_limit_reached: false })],
  });
  server.use(...ctx.handlers);
  restoreTurnFetch = ctx.captureTurns();
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
  await enterPart2();

  fireEvent.click(screen.getByRole('button', { name: '跳过准备，直接开始' }));
  await tick(0);
  fireEvent.click(screen.getByRole('button', { name: '开始录音' }));
  await tickUntil(() => screen.queryByText('停止') !== null, '录音中显示停止按钮');

  await tick(30_000);
  fireEvent.click(screen.getByRole('button', { name: '停止' }));
  await tick(0);
  fireEvent.click(screen.getByRole('button', { name: '提交录音' }));
  await tickUntil(() => ctx.turnCalls.length === 1, '手动停止后提交 turn');

  expect(Number(ctx.turnCalls[0].durationSec)).toBeCloseTo(30, 0);
  expect(ctx.turnCalls[0].audioBytes).toBeGreaterThan(0);
});
