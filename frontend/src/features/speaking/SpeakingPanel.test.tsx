import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetGradingJobs } from '../../hooks/useGradingJobs';
import { server } from '../../test/mocks/server';
import type { SpeakingPrompt } from '../../types/ielts';
import SpeakingPanel from './SpeakingPanel';
import { createSpeakingHandlers, part1Meta, part2Meta, speakingReport, turnResult } from './testHandlers';

/**
 * 口语屏行为测试：
 * AC-G1（就绪前入口禁用 + 可操作重试）、FR-S1（target_band/Part 过滤）、
 * 契约 §10.2（audio_url=null 显示「无音频」）、AC-S3b（无麦克风也能用文本走完）、
 * AC-S3（400/413 显示后端 detail；置信度 <0.5 给专门提示）、CONSTITUTION §3（降级可见）、
 * §1 #11b + §10.6（评分排队：提交即拿 job_id，可离开等待页，轮询到终态才出报告）。
 */

const TEXT_LABEL = /直接输入答案文本/;

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
}

function mockMic(impl?: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(impl ?? (async () => ({ getTracks: () => [] }))),
    },
  });
}

async function startPart1() {
  await screen.findByRole('tab', { name: 'Part 1' });
  fireEvent.click(screen.getByRole('button', { name: /开始 烹饪/ }));
  return screen.findByText('Do you enjoy cooking meals at home?');
}

async function answerWithText(value: string) {
  const box = await screen.findByRole('textbox', { name: TEXT_LABEL });
  fireEvent.change(box, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '提交文本答案' }));
}

/** Part 1 三问走完并按「开始评分」（§1 #11b）。 */
async function assess(ctx: ReturnType<typeof createSpeakingHandlers>) {
  for (let index = 0; index < 3; index += 1) {
    await answerWithText(`cooking answer ${index + 1}`);
    await waitFor(() => expect(ctx.turnCalls).toHaveLength(index + 1));
  }
  fireEvent.click(await screen.findByRole('button', { name: '开始评分' }));
  await waitFor(() => expect(ctx.assessAsyncCalls).toEqual(['ses_test_0001']));
}

beforeAll(() => {
  fakeRecorder();
  mockMic();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  // 批改队列是模块级的（跨面板共享），不清掉会把任务带进下一个用例。
  resetGradingJobs();
});

describe('SpeakingPanel', () => {
  it('引擎未就绪：模块入口不可进入，并给出可点的重试（AC-G1）', () => {
    const ctx = createSpeakingHandlers();
    server.use(...ctx.handlers);
    render(<SpeakingPanel ready={false} />);
    expect(screen.getByText('引擎启动中')).toBeInTheDocument();
    expect(screen.getByText(/就绪前不能进入口语练习/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
    expect(screen.queryByText(part1Meta.title_zh)).not.toBeInTheDocument();
  });

  it('按 target_band 与 Part 过滤套题，并创建 Part 2 会话（FR-S1/S2）', async () => {
    const ctx = createSpeakingHandlers();
    server.use(...ctx.handlers);
    render(<SpeakingPanel ready />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Part 2' }));
    expect(await screen.findByText(part2Meta.title_zh)).toBeInTheDocument();
    expect(screen.queryByText(part1Meta.title_zh)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '5.5' }));
    await waitFor(() => expect(screen.queryByText(part2Meta.title_zh)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '6.5' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Part 1' }));
    expect(await screen.findByText(part1Meta.title_zh)).toBeInTheDocument();
    expect(screen.queryByText(part2Meta.title_zh)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /开始 烹饪/ }));
    await waitFor(() =>
      expect(ctx.sessionBodies[0]).toMatchObject({ set_id: 'sp_p1_cooking_04', part: 1 }),
    );
  });

  it('离线 audio_url=null 时显示「无音频」，播放按钮禁用而不是渲染坏音频（契约 §10.2）', async () => {
    const ctx = createSpeakingHandlers();
    server.use(...ctx.handlers);
    render(<SpeakingPanel ready />);
    await startPart1();
    expect(screen.getByText('无音频')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '听考官提问' })).toBeDisabled();
    expect(ctx.handlers.length).toBeGreaterThan(0);
  });

  it('麦克风被拒绝时仍能走完：文本兜底提交不含音频（AC-S3b）', async () => {
    const next2: SpeakingPrompt = { id: 'q2', part: 1, kind: 'question', text: 'Who taught you to cook?', audio_url: null };
    const next3: SpeakingPrompt = { id: 'q3', part: 1, kind: 'question', text: 'Would you like to learn another cuisine?', audio_url: null };
    const ctx = createSpeakingHandlers({
      turns: [turnResult({ next: next2 }), turnResult({ next: next3 }), turnResult({ next: null })],
    });
    server.use(...ctx.handlers);
    mockMic(async () => {
      throw new DOMException('Permission denied', 'NotAllowedError');
    });

    render(<SpeakingPanel ready />);
    await startPart1();

    // 先试麦克风：被拒后原因必须可见（AC-S3），但不能拦住文本兜底流程（AC-S3b）
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }));
    expect(await screen.findByText(/麦克风权限被拒绝/)).toBeInTheDocument();

    await answerWithText('My grandmother taught me and I still use her recipes.');

    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));
    expect(ctx.turnCalls[0].audioBytes).toBe(0);
    expect(ctx.turnCalls[0].text).toBe('My grandmother taught me and I still use her recipes.');

    // #10 的 `next` 是下一题：第 2 问同样只用文本走完
    await answerWithText('Sketching, mostly from photographs on the street.');
    await waitFor(() => expect(ctx.turnCalls).toHaveLength(2));
    expect(ctx.turnCalls[1].audioBytes).toBe(0);

    expect(await screen.findByText('Would you like to learn another cuisine?')).toBeInTheDocument();
    // 麦克风失败的中文原因仍然可见（AC-S3），但不阻塞流程
    expect(screen.getByText(/麦克风权限被拒绝/)).toBeInTheDocument();

    mockMic();
  });

  it('turn 返回 413 时把后端 detail 原文显示出来（AC-S3）', async () => {
    const ctx = createSpeakingHandlers({
      turnError: { status: 413, code: 'audio_too_large', detail: '音频过大（上限 5MB），请分段录制后重试' },
    });
    server.use(...ctx.handlers);
    render(<SpeakingPanel ready />);
    await startPart1();
    await answerWithText('an answer');
    expect(await screen.findByRole('alert')).toHaveTextContent('音频过大（上限 5MB），请分段录制后重试');
  });

  it('置信度 < 0.5 时提示可重录或改用文本输入（AC-S3）', async () => {
    const ctx = createSpeakingHandlers({ turns: [turnResult({ confidence: 0.31, next: null })] });
    server.use(...ctx.handlers);
    render(<SpeakingPanel ready />);
    await startPart1();
    await answerWithText('a mumbled answer');
    expect(await screen.findByText(/转写置信度较低/)).toBeInTheDocument();
    await waitFor(() => expect(ctx.turnCalls).toHaveLength(1));
  });

  it('Part 1 三问走完 → 排队评分 → 结果视图（AC-S4 前端侧，契约 §10.6）', async () => {
    const ctx = createSpeakingHandlers();
    server.use(...ctx.handlers);
    const onAttemptRecorded = vi.fn();
    render(<SpeakingPanel ready onAttemptRecorded={onAttemptRecorded} />);
    await startPart1();

    await assess(ctx);

    expect(await screen.findByText('口语评分结果')).toBeInTheDocument();
    expect(onAttemptRecorded).toHaveBeenCalledTimes(1);
    expect(ctx.jobPolls.length).toBeGreaterThan(0);
    expect(ctx.assessCalls).toEqual([]);
  });

  it('评分中可以离开，完成后从选题页横幅进入报告（FR-S4 先做别的）', async () => {
    const ctx = createSpeakingHandlers({ jobAutoSettle: false });
    server.use(...ctx.handlers);
    const onAttemptRecorded = vi.fn();
    render(<SpeakingPanel ready onAttemptRecorded={onAttemptRecorded} />);
    await startPart1();
    await assess(ctx);

    expect(await screen.findByRole('heading', { name: '评分中' })).toBeInTheDocument();
    expect(screen.getByText('推理模型批改通常要 1–2 分钟，期间可以继续练别的。')).toBeInTheDocument();
    expect(screen.queryByText('口语评分结果')).not.toBeInTheDocument();
    expect(onAttemptRecorded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '离开等待，去选题' }));
    expect(await screen.findByRole('button', { name: /开始 烹饪/ })).toBeInTheDocument();
    expect(screen.getByText('刷新进度')).toBeInTheDocument();

    ctx.settleJob();
    fireEvent.click(screen.getByRole('button', { name: '刷新进度' }));

    fireEvent.click(await screen.findByRole('button', { name: '查看报告' }));
    expect(await screen.findByText('口语评分结果')).toBeInTheDocument();
    // 落库通知与用户当前在哪个界面无关：任务终态就该刷新概览（AC-G2）
    expect(onAttemptRecorded).toHaveBeenCalledTimes(1);
  });

  it('异步评分失败时显示后端 error 原文并留在会话里可重试（CONSTITUTION §3）', async () => {
    const ctx = createSpeakingHandlers({ jobAutoSettle: false });
    server.use(...ctx.handlers);
    render(<SpeakingPanel ready />);
    await startPart1();
    await assess(ctx);

    ctx.failJob('AI 上游返回失败，稍后可直接重试');
    fireEvent.click(await screen.findByRole('button', { name: '刷新进度' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('AI 上游返回失败，稍后可直接重试');
    expect(screen.queryByText('口语评分结果')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始评分' }));
    await waitFor(() => expect(ctx.assessAsyncCalls).toHaveLength(2));
  });

  it('ai_used=false 的报告显示「降级」标记，不把近似分当真分（CONSTITUTION §3）', async () => {
    const ctx = createSpeakingHandlers({
      report: speakingReport({ ai_used: false, approximate: true, degraded_reason: 'no_api_key' }),
    });
    server.use(...ctx.handlers);
    render(<SpeakingPanel ready />);
    await startPart1();
    await assess(ctx);
    expect(await screen.findByText(/已降级：未配置 AI 密钥/)).toBeInTheDocument();
    expect(screen.getByText(/这不是 AI 精确评分/)).toBeInTheDocument();
  });

  it('Part 3：followups 返回 ai_used=false 时改用预置追问（AC-S6）', async () => {
    const ctx = createSpeakingHandlers({
      prompts: [
        { id: 'q1', part: 3, kind: 'question', text: 'Why do some people learn faster than others?', audio_url: null },
        { id: 'q2', part: 3, kind: 'question', text: 'Can anyone learn a difficult skill later in life?', audio_url: null },
      ],
      followupsResponse: { questions: [], ai_used: false, degraded_reason: 'offline_template' },
    });
    server.use(...ctx.handlers);
    render(<SpeakingPanel ready initialPart={3} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Part 3' }));
    fireEvent.click(screen.getByRole('button', { name: /开始 想学的技能/ }));

    // #12 被调用；Part 2 转写为空时后端直接回落，本屏也用预置追问
    await waitFor(() => expect(ctx.followupCalls).toHaveLength(1));
    expect(ctx.followupCalls[0]).toMatchObject({ set_id: 'sp_p2_skill_01', part2_transcript: '' });
    expect(await screen.findByText('Part 3 考官追问')).toBeInTheDocument();
    expect(screen.getByText('降级 · 离线模板')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Is talent more important than practice\?/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Why do some people learn faster than others?')).not.toBeInTheDocument();
  });
});
