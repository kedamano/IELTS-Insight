import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readDraft } from '../../hooks/useDraftAutosave';
import { resetGradingJobs } from '../../hooks/useGradingJobs';
import { server } from '../../test/mocks/server';
import WritingPanelDefault, { WritingPanel } from './WritingPanel';
import { draftKeyOf } from './writingSets';
import {
  WRITING_BASE,
  createWritingHandlers,
  task1Line,
  task1Pie,
  task1Table,
  task2Agree,
  writingReport,
} from './testHandlers';

/**
 * 写作屏行为测试。覆盖：
 * FR-W1 / §1 #20（Task 1 与 Task 2 分页签，切换真的换 module 并隐藏另一类）、难度分层选题；
 * §1 #21b + §10.6（提交体只有 task_id/response/duration_sec/draft_saved_at；提交后先拿 job_id，
 * 可以离开等待页，轮询到终态才出报告）；
 * AC-W3b（未达字数 → 显示 word_count_penalty 与夹紧到 5.0 的 task_response）；
 * CONSTITUTION §3（ai_used=false 显式标「降级/近似」；后端 detail/error 原文可见 + 重试）；
 * AC-W2（草稿离开后恢复、批改成功后才清空）。
 */

const TEXTAREA = '正文（英文）';

function essay(words: number): string {
  return Array.from({ length: words }, (_, index) => `word${index}`).join(' ');
}

async function startTask(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
  return screen.findByRole('textbox', { name: TEXTAREA });
}

function writeText(box: HTMLElement, value: string) {
  fireEvent.change(box, { target: { value } });
}

afterEach(() => {
  cleanup();
  server.resetHandlers();
  // 批改队列是模块级的（跨面板共享），不清掉会把任务带进下一个用例。
  resetGradingJobs();
});

describe('WritingPanel', () => {
  it('默认导出与命名导出是同一个组件（契约 §7 的挂载点）', () => {
    expect(WritingPanelDefault).toBe(WritingPanel);
  });

  it('引擎未就绪时不进练习，并给出可点的重试（AC-G1）', () => {
    const ctx = createWritingHandlers();
    server.use(...ctx.handlers);
    render(<WritingPanel ready={false} />);
    expect(screen.getByText('引擎启动中')).toBeInTheDocument();
    expect(screen.getByText(/就绪前不能进入写作练习/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
    expect(screen.queryByText(task1Line.title_zh)).not.toBeInTheDocument();
  });

  it('Task 1 / Task 2 分签：切签真的换 module 参数并隐藏另一类任务（FR-W1）', async () => {
    const ctx = createWritingHandlers();
    server.use(...ctx.handlers);
    render(<WritingPanel ready />);

    expect(await screen.findByText(task1Line.title_zh)).toBeInTheDocument();
    expect(screen.queryByText(task2Agree.title_zh)).not.toBeInTheDocument();
    expect(ctx.taskRequests.at(-1)).toMatchObject({ module: 'task1' });
    expect(screen.getByRole('tabpanel', { name: /Task 1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Task 2' }));
    expect(await screen.findByText(task2Agree.title_zh)).toBeInTheDocument();
    expect(screen.queryByText(task1Line.title_zh)).not.toBeInTheDocument();
    await waitFor(() => expect(ctx.taskRequests.at(-1)).toMatchObject({ module: 'task2' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Task 1' }));
    expect(await screen.findByText(task1Line.title_zh)).toBeInTheDocument();
    expect(screen.queryByText(task2Agree.title_zh)).not.toBeInTheDocument();
  });

  it('按 target_band 分层选题，「全部」可回退（FR-W1 难度分层）', async () => {
    const ctx = createWritingHandlers({ tasks: [task1Line, task1Pie, task1Table] });
    server.use(...ctx.handlers);
    render(<WritingPanel ready />);

    await screen.findByText(task1Line.title_zh);
    fireEvent.click(screen.getByRole('button', { name: '7.5' }));
    expect(await screen.findByText(task1Table.title_zh)).toBeInTheDocument();
    expect(screen.queryByText(task1Line.title_zh)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(await screen.findByText(task1Line.title_zh)).toBeInTheDocument();
    expect(screen.getByText(task1Pie.title_zh)).toBeInTheDocument();
  });

  it('提交体严格是 §1 #21 的形状，走 #21b 异步端点并轮询到报告（契约 §10.6）', async () => {
    const ctx = createWritingHandlers();
    server.use(...ctx.handlers);
    render(<WritingPanel ready initialKind="task2" />);

    const text = essay(120);
    writeText(await startTask(new RegExp(`开始 ${task2Agree.title_zh}`)), text);
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));

    await waitFor(() => expect(ctx.attemptCalls).toHaveLength(1));
    const call = ctx.attemptCalls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe(`${WRITING_BASE}/writing/attempts/async`);
    expect(Object.keys(call.body).sort()).toEqual(['draft_saved_at', 'duration_sec', 'response', 'task_id']);
    expect(call.body.task_id).toBe(task2Agree.id);
    expect(call.body.response).toBe(text);
    expect(typeof call.body.duration_sec).toBe('number');
    expect(call.body.duration_sec).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(call.body.draft_saved_at as string))).toBe(false);

    expect(await screen.findByText('写作批改结果')).toBeInTheDocument();
    expect(ctx.jobPolls.length).toBeGreaterThan(0);
  });

  it('批改中可以离开去选题，任务完成后从横幅进入报告（FR-W3 先做别的）', async () => {
    const ctx = createWritingHandlers({ jobAutoSettle: false });
    server.use(...ctx.handlers);
    render(<WritingPanel ready initialKind="task2" />);

    const text = essay(270);
    writeText(await startTask(new RegExp(`开始 ${task2Agree.title_zh}`)), text);
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));

    await waitFor(() => expect(ctx.attemptCalls).toHaveLength(1));
    expect(await screen.findByText('已提交批改')).toBeInTheDocument();
    expect(screen.getByText('推理模型批改通常要 1–2 分钟，期间可以继续练别的。')).toBeInTheDocument();
    expect(screen.queryByText('写作批改结果')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '离开等待，去选题' }));
    expect(await screen.findByRole('button', { name: new RegExp(`开始 ${task2Agree.title_zh}`) })).toBeInTheDocument();
    expect(screen.getByText('刷新进度')).toBeInTheDocument();

    // 后端落终态后由前端主动拉一次，不等 2.5s 的轮询间隔
    ctx.settleJob();
    fireEvent.click(screen.getByRole('button', { name: '刷新进度' }));

    fireEvent.click(await screen.findByRole('button', { name: '查看报告' }));
    expect(await screen.findByText('写作批改结果')).toBeInTheDocument();
    // AC-W2：批改成功才清空草稿
    expect(readDraft(draftKeyOf(task2Agree.id))).toBeNull();
  });

  it('任务级批改失败：轮询到的 error 原文可见，草稿保留可重交（CONSTITUTION §3）', async () => {
    const ctx = createWritingHandlers({
      jobAutoSettle: false,
      report: writingReport({ ai_used: true }),
    });
    server.use(...ctx.handlers);
    render(<WritingPanel ready initialKind="task2" />);

    const text = essay(260);
    writeText(await startTask(new RegExp(`开始 ${task2Agree.title_zh}`)), text);
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));
    await waitFor(() => expect(ctx.attemptCalls).toHaveLength(1));

    ctx.failJob('AI 上游连续 3 次超时，批改没有完成');
    fireEvent.click(await screen.findByRole('button', { name: '刷新进度' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('AI 上游连续 3 次超时，批改没有完成');
    expect(ctx.attemptCalls).toHaveLength(1);
    expect(readDraft(draftKeyOf(task2Agree.id))).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(ctx.attemptCalls).toHaveLength(2));
    expect(ctx.attemptCalls[1].body.response).toBe(text);
  });


  it('未达字数时显示 word_count_penalty 与被夹到 5.0 的 task_response（AC-W3b）', async () => {
    const ctx = createWritingHandlers({
      report: writingReport({
        ai_used: false,
        approximate: true,
        degraded_reason: 'offline_template',
        task: 'task2',
        word_count: 114,
        word_count_penalty: { kind: 'under_length', missing_words: 136 },
        band: {
          overall: 5.5,
          task_response: 5,
          coherence_cohesion: 6,
          lexical_resource: 5.5,
          grammatical_range_accuracy: 5.5,
        },
      }),
    });
    server.use(...ctx.handlers);
    render(<WritingPanel ready initialKind="task2" />);

    writeText(await startTask(new RegExp(`开始 ${task2Agree.title_zh}`)), essay(114));
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));

    expect(await screen.findByText(/未达最低字数：还差 136 词/)).toBeInTheDocument();
    expect(screen.getByText('字数惩罚 · 未达线')).toBeInTheDocument();
    expect(screen.getByText(/达线进度 114\/250/)).toBeInTheDocument();
    expect(screen.getByText(/上限夹到 5\.0/)).toBeInTheDocument();
    const taskResponseRow = screen.getByText('任务回应').closest('li');
    expect(taskResponseRow).not.toBeNull();
    expect(taskResponseRow).toHaveTextContent('5.0');
  });

  it('ai_used=false 的报告显式标「降级 / 近似分」，不当真 AI 评分（CONSTITUTION §3）', async () => {
    const ctx = createWritingHandlers({
      report: writingReport({ ai_used: false, approximate: true, degraded_reason: 'invalid_model_output' }),
    });
    server.use(...ctx.handlers);
    render(<WritingPanel ready initialKind="task2" />);

    writeText(await startTask(new RegExp(`开始 ${task2Agree.title_zh}`)), essay(300));
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));

    expect(await screen.findByText(/已降级：AI 返回格式无效/)).toBeInTheDocument();
    expect(screen.getByText(/近似分/)).toBeInTheDocument();
    expect(screen.getByText(/降级 · AI 返回格式无效/)).toBeInTheDocument();
    expect(screen.queryByText(/AI 评分/)).not.toBeInTheDocument();
  });

  it('批改失败时显示后端 detail 原文，点重试会再发一次请求（CONSTITUTION §3）', async () => {
    const ctx = createWritingHandlers({
      attemptError: { status: 502, code: 'ai_upstream_failed', detail: 'AI 上游返回失败，稍后可直接重试' },
    });
    server.use(...ctx.handlers);
    render(<WritingPanel ready initialKind="task2" />);

    writeText(await startTask(new RegExp(`开始 ${task2Agree.title_zh}`)), essay(260));
    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('AI 上游返回失败，稍后可直接重试');
    expect(screen.queryByText('写作批改结果')).not.toBeInTheDocument();
    // 失败不清草稿（AC-W2：批改没成功，正文还得留着）
    expect(readDraft(draftKeyOf(task2Agree.id))).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(ctx.attemptCalls).toHaveLength(2));
    expect(ctx.attemptCalls[1].body.response).toBe(essay(260));
  });

  it('草稿：切走再回来能恢复，提交成功后清空（AC-W2）', async () => {
    const ctx = createWritingHandlers();
    server.use(...ctx.handlers);
    const text = 'Remote working gives families back the hours that commuting used to take.';

    const first = render(<WritingPanel ready initialKind="task2" />);
    writeText(await startTask(new RegExp(`开始 ${task2Agree.title_zh}`)), text);
    expect(await screen.findByText('已保存', {}, { timeout: 3000 })).toBeInTheDocument();

    first.unmount();
    render(<WritingPanel ready initialKind="task2" />);
    const box = await startTask(new RegExp(`开始 ${task2Agree.title_zh}`));
    expect(box).toHaveValue(text);
    expect(screen.getByText('已恢复上次草稿')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提交批改' }));
    await waitFor(() => expect(ctx.attemptCalls).toHaveLength(1));
    expect(ctx.attemptCalls[0].body.response).toBe(text);
    expect(await screen.findByText('写作批改结果')).toBeInTheDocument();
    expect(readDraft(draftKeyOf(task2Agree.id))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '换一题' }));
    const again = await startTask(new RegExp(`开始 ${task2Agree.title_zh}`));
    expect(again).toHaveValue('');
  });
});
