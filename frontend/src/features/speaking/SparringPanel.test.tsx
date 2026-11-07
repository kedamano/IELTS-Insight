/**
 * 1 对 1 口语陪练的界面行为测试（契约 §16、FR-S7、AC-S7.1–S7.6）。
 *
 * 钉的是「用户能否真的把一场陪练走完」这条主线，而不是组件内部实现：
 * 选话题 → 逐轮作答（含键盘兜底）→ 离线追问逐条标注 → 到上限禁用发送 → 排队评分 → 出报告；
 * 外加三条降级承诺：引擎未就绪（AC-G1）、后端 400 可读、评分失败可见（CONSTITUTION §3）。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetGradingJobs } from '../../hooks/useGradingJobs';
import { server } from '../../test/mocks/server';
import SparringPanel from './SparringPanel';
import { SPARRING_SESSION_STORAGE_KEY } from './sparringSets';
import { createSparringHandlers, interviewMeta, restaurantMeta, sparringReport } from './sparringHandlers';

const TEXT_LABEL = /直接输入这句英文/;

const fakeRecorderInstances: { failMidway: () => void }[] = [];

function fakeRecorder() {
  class FakeMediaRecorder {
    static isTypeSupported() {
      return true;
    }
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      fakeRecorderInstances.push(this);
    }
    start() {
      this.state = 'recording';
      this.ondataavailable?.({ data: new Blob(['webm-bytes'], { type: 'audio/webm' }) });
    }
    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
    failMidway() {
      this.onerror?.();
    }
  }
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
}

function mockMic() {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
  });
}

async function metric(name: string): Promise<HTMLElement> {
  const grid = await screen.findByLabelText('陪练关键指标');
  const node = grid.querySelector<HTMLElement>(`[data-metric="${name}"]`);
  if (!node) throw new Error(`找不到 data-metric="${name}" 的磁贴`);
  return node;
}

async function startRestaurant(): Promise<void> {
  await screen.findByText(restaurantMeta.title_zh);
  fireEvent.click(screen.getByRole('button', { name: `开始陪练 ${restaurantMeta.title_zh}` }));
}

async function answer(value: string): Promise<void> {
  const box = await screen.findByRole('textbox', { name: TEXT_LABEL });
  fireEvent.change(box, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '提交文本答案' }));
}

beforeAll(() => {
  fakeRecorder();
  mockMic();
});

beforeEach(() => {
  fakeRecorderInstances.length = 0;
  // 会话接回的凭据是跨用例共享的 localStorage：不清掉，前一个用例的 session_id
  // 会让后一个用例的 `SparringPanel` 挂载时就去 resume，直接跑进别人的世界里。
  localStorage.removeItem(SPARRING_SESSION_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetGradingJobs();
});

describe('SparringPanel', () => {
  it('引擎未就绪时不出话题清单，给出可点的重试（AC-G1）', () => {
    const ctx = createSparringHandlers();
    server.use(...ctx.handlers);
    render(<SparringPanel ready={false} />);
    expect(screen.getByText('引擎启动中')).toBeInTheDocument();
    expect(screen.getByText(/就绪前不能进入陪练/)).toBeInTheDocument();
    expect(screen.queryByText(restaurantMeta.title_zh)).not.toBeInTheDocument();
  });

  it('话题按难度分档，每张卡写明场景与轮次（AC-S7.1）', async () => {
    const ctx = createSparringHandlers();
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);

    expect(await screen.findByText(restaurantMeta.title_zh)).toBeInTheDocument();
    expect(screen.getByText(interviewMeta.title_zh)).toBeInTheDocument();
    expect(screen.getByText(restaurantMeta.scenario_zh)).toBeInTheDocument();
    expect(screen.getByText(/A2 · 基础日常/)).toBeInTheDocument();
    expect(screen.getByText(/B2 · 抽象与假设/)).toBeInTheDocument();
    expect(ctx.topicCalls).toContain(null);
  });

  it('开局显示开场白与两块磁贴读数（AC-S7.2 / FR-S7.6）', async () => {
    const ctx = createSparringHandlers();
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();

    expect(await screen.findByText(/Good afternoon, welcome in!/)).toBeInTheDocument();
    expect((await metric('sparring.turns')).textContent).toContain('0/10');
    expect((await metric('sparring.remaining')).textContent).toContain('10');
    expect(ctx.sessionBodies[0]).toMatchObject({ topic_id: restaurantMeta.id });
  });

  it('键盘文本兜底可走完一轮，我的作答与追问都进对话流（AC-S7.3b/c）', async () => {
    const ctx = createSparringHandlers();
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();
    await answer('I would like a table for two, please.');

    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));
    expect(ctx.turnCalls[0].text).toBe('I would like a table for two, please.');
    expect(ctx.turnCalls[0].audioBytes).toBe(0);
    const list = await screen.findByRole('list', { name: '陪练对话' });
    expect(list.textContent).toContain('I would like a table for two, please.');
    expect((await metric('sparring.turns')).textContent).toContain('1/10');
  });

  it('离线追问逐条标注「预置追问」，暖面磁贴读数是回落条数（AC-S7.6a）', async () => {
    const ctx = createSparringHandlers({ source: 'fallback' });
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();
    await answer('A table for two would be great.');

    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));
    const list = await screen.findByRole('list', { name: '陪练对话' });
    expect(list.textContent).toContain('预置追问');
    const tile = await metric('sparring.fallback');
    expect(tile.textContent).toContain('1');
    expect(tile.getAttribute('data-surface')).toBe('warm');
  });

  it('AI 可用时追问标注「AI 追问」，且不出现暖面（AC-S7.6a 的对照组）', async () => {
    const ctx = createSparringHandlers({ source: 'ai' });
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();
    await answer('I prefer a quiet corner if possible.');

    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));
    const list = await screen.findByRole('list', { name: '陪练对话' });
    expect(list.textContent).toContain('AI 追问');
    const tile = await metric('sparring.fallback');
    expect(tile.textContent).toContain('0');
    expect(tile.getAttribute('data-surface')).toBe('plain');
  });

  it('到轮次上限后发送入口消失、给出可读原因并可评分（AC-S7.4 / AC-S7.6b）', async () => {
    const ctx = createSparringHandlers({ maxTurns: 2 });
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();

    for (let index = 0; index < 2; index += 1) {
      await answer(`answer ${index + 1}`);
      await waitFor(() => expect(ctx.turnCalls).toHaveLength(index + 1));
    }

    expect(await screen.findByText(/已到这个话题的轮次上限/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: TEXT_LABEL })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '评分这场对话' })).toBeEnabled();
    expect((await metric('sparring.remaining')).textContent).toContain('0');
  });

  it('评分走异步路径，成功后渲染同形状报告（AC-S7.5a / §10.6）', async () => {
    const ctx = createSparringHandlers({ maxTurns: 2, report: sparringReport() });
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();
    await answer('I would like a table for two.');
    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '结束并评分' }));
    await waitFor(() => expect(ctx.assessAsyncCalls).toEqual(['spa_test_1']));

    expect(await screen.findByText('口语评分结果')).toBeInTheDocument();
    expect(screen.getByText(/证据引用/)).toBeInTheDocument();
  });

  it('评分失败原样显示后端 error，且可回到对话继续（CONSTITUTION §3）', async () => {
    const ctx = createSparringHandlers({ maxTurns: 2, jobError: '上游端点超时，请重试' });
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();
    await answer('A short answer.');
    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '结束并评分' }));
    await waitFor(() => expect(ctx.assessAsyncCalls).toHaveLength(1));
    expect(await screen.findByText('上游端点超时，请重试')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '结束并评分' })).toBeEnabled();
  });

  it('提交失败时显示后端 detail，不白屏也不丢已答内容（AC-S7.3a）', async () => {
    const ctx = createSparringHandlers({
      turnError: { status: 400, code: 'empty_answer', detail: '这段录音听不清，可改用键盘输入' },
    });
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();
    await answer('Something I said.');

    expect(await screen.findByText('这段录音听不清，可改用键盘输入')).toBeInTheDocument();
    expect(screen.getByText(/Good afternoon, welcome in!/)).toBeInTheDocument();
  });

  it('陪练要能离开等待页去做别的，回来仍可查看报告（§10.6）', async () => {
    const ctx = createSparringHandlers({ maxTurns: 2, jobAutoSettle: false });
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();
    await answer('I would like the lamb.');
    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: '结束并评分' }));
    await waitFor(() => expect(ctx.assessAsyncCalls).toHaveLength(1));
    expect(await screen.findByText('陪练评分中')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '离开等待，去选题' }));
    expect(await screen.findByText(restaurantMeta.title_zh)).toBeInTheDocument();

    await act(async () => {
      ctx.settleJob(sparringReport());
    });
    expect(await screen.findByRole('button', { name: '查看报告' })).toBeInTheDocument();
  });

  it('建会话即把 session_id 落本地，刷新后能自动接回整段对话（§16.3 第 6 条）', async () => {
    const ctx = createSparringHandlers();
    server.use(...ctx.handlers);
    const first = render(<SparringPanel ready />);
    await startRestaurant();
    await answer('A table for two, please.');
    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));
    expect(localStorage.getItem(SPARRING_SESSION_STORAGE_KEY)).toBe('spa_test_1');

    // 模拟 webview 刷新：卸载重挂，本地凭据还在，后端会话也还在
    first.unmount();
    render(<SparringPanel ready />);

    const list = await screen.findByRole('list', { name: '陪练对话' });
    expect(list.textContent).toContain('A table for two, please.');
    expect(screen.getByText(/Good afternoon, welcome in!/)).toBeInTheDocument();
    expect((await metric('sparring.turns')).textContent).toContain('1/10');
  });

  it('凭据指向已不存在的会话时静默丢弃，不弹红（换库/清理都不算用户的错）', async () => {
    localStorage.setItem(SPARRING_SESSION_STORAGE_KEY, 'spa_gone');
    const ctx = createSparringHandlers({ sessionsGone: true });
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);

    expect(await screen.findByText(restaurantMeta.title_zh)).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(SPARRING_SESSION_STORAGE_KEY)).toBeNull());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('提交评分后清掉本地凭据，避免把已交付的对话再拉回来', async () => {
    const ctx = createSparringHandlers({ maxTurns: 2 });
    server.use(...ctx.handlers);
    render(<SparringPanel ready />);
    await startRestaurant();
    await answer('I would like the lamb.');
    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));
    expect(localStorage.getItem(SPARRING_SESSION_STORAGE_KEY)).toBe('spa_test_1');

    fireEvent.click(screen.getByRole('button', { name: '结束并评分' }));
    await waitFor(() => expect(ctx.assessAsyncCalls).toHaveLength(1));
    await waitFor(() => expect(localStorage.getItem(SPARRING_SESSION_STORAGE_KEY)).toBeNull());
  });
});
