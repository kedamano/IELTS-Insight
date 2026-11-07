/**
 * 「题库生成」卡（契约 §17.4）的行为测试。
 *
 * 重心不是控件存在，而是 §17 的三条承诺在界面上真的成立：
 * 1. 能力不足（未配 AI / 关在线 / 只读降级）时**禁用提交并写明原因**——
 *    点了撞 503 或排队两分钟才失败，都等于界面说谎；
 * 2. 成功后必须出现「重启应用后」字样（§17.1：装载只在启动时发生，
 *    当场宣称题库变多就是假话）；
 * 3. rejected 逐条带中文原因（§17.3 条款 4），部分成功照常显示。
 *
 * 轮询节奏 2.5s：mock 让**首次轮询即落终态**（startPolling 会先同步 poll 一次），
 * 用例不必等真实间隔，也不引入 fake timers 去测一个不存在的行为。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '../../test/testUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import type { RequestHandler } from 'msw';
import { API_BASE } from '../../services/api';
import { server } from '../../test/mocks/server';
import ContentPanel from './ContentPanel';
import type { ContentJob, ContentJobReport } from '../../types/ielts';

function ok<T>(data: T) {
  return HttpResponse.json({ data });
}

function jobFixture(status: ContentJob['status'], report: ContentJobReport | null = null, error: string | null = null): ContentJob {
  return {
    job_id: 'job_test_1',
    module: 'content',
    task_ref: 'sparring',
    status,
    attempt_id: null,
    report,
    error,
    degraded_reason: null,
    created_at: '2026-11-07T07:00:00Z',
    started_at: null,
    finished_at: null,
  };
}

const doneReport: ContentJobReport = {
  generated: [{ id: 'sb_shopping_11', title_zh: '超市购物', path: 'C:\\fakepath\\sb_shopping_11.json' }],
  rejected: [{ id: 'sb_bad_12', reasons: ['level 非法：c1（应为 a2/b1/b2）'] }],
  written: 1,
  requested: 2,
  model: 'glm-4.6',
};

export interface ContentTestContext {
  handlers: RequestHandler[];
  generateCalls: { module: string; count: number; target_band: number }[];
  /** 让 POST 返回 503 content_offline（模拟后端闸门，而不是前端没禁用） */
  offlineRefuse: () => void;
}

function createContentHandlers(
  created: ContentJob = jobFixture('queued'),
  polled: ContentJob = jobFixture('succeeded', doneReport),
): ContentTestContext {
  const generateCalls: ContentTestContext['generateCalls'] = [];
  let pollCount = 0;
  let refuseOffline = false;

  const handlers: RequestHandler[] = [
    http.post(`${API_BASE}/content/generate`, async ({ request }) => {
      const body = (await request.json()) as { module: string; count: number; target_band: number };
      generateCalls.push(body);
      if (refuseOffline) {
        return HttpResponse.json(
          { detail: '已关闭联网，无法生成题目；请在设置里开启在线服务后重试', code: 'content_offline' },
          { status: 503 },
        );
      }
      return ok(created);
    }),
    http.get(`${API_BASE}/content/jobs/:jobId`, () => {
      pollCount += 1;
      // 首次轮询即终态（组件 startPolling 里同步 poll 一次）
      return ok(polled);
    }),
  ];

  return {
    handlers,
    generateCalls,
    offlineRefuse: () => {
      refuseOffline = true;
    },
  };
}

function open(
  props: Partial<React.ComponentProps<typeof ContentPanel>> = {},
  ctx = createContentHandlers(),
) {
  server.use(...ctx.handlers);
  render(<ContentPanel aiConfigured onlineEnabled {...props} />);
  return ctx;
}

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});

describe('题库生成卡（§17.4）', () => {
  it('能力齐备时可提交，成功后列出产物并写明「重启应用后」生效', async () => {
    const ctx = open();
    const submit = await screen.findByRole('button', { name: '开始生成' });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    await waitFor(() => expect(ctx.generateCalls).toHaveLength(1));
    expect(ctx.generateCalls[0]).toMatchObject({ module: 'sparring', count: 1, target_band: 6.5 });

    const grid = await screen.findByLabelText('生成结果');
    expect(grid.textContent).toContain('1');
    expect(grid.textContent).toContain('2');
    expect(await screen.findByText('超市购物')).toBeInTheDocument();
    // §17.1 的诚实条款：装载在下次启动，不许宣称当场生效
    expect(document.body.textContent).toMatch(/重启应用后/);
  });

  it('被拒绝的候选逐条显示中文原因，部分成功照常落定', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }));
    const reason = await screen.findByText(/level 非法/);
    expect(reason.textContent).toContain('sb_bad_12');
  });

  it('未配置 AI：提交禁用并说明去 AI 卡配置（不出现点了才失败）', async () => {
    open({ aiConfigured: false });
    const submit = await screen.findByRole('button', { name: '开始生成' });
    expect(submit).toBeDisabled();
    expect(document.body.textContent).toContain('未配置 AI 端点');
  });

  it('关闭在线：提交禁用并指向在线开关', async () => {
    open({ onlineEnabled: false });
    const submit = await screen.findByRole('button', { name: '开始生成' }
    );
    expect(submit).toBeDisabled();
    expect(document.body.textContent).toContain('已关闭联网');
  });

  it('只读降级：生成要写文件，同样禁用并说清', async () => {
    open({ storageReadonly: true });
    const submit = await screen.findByRole('button', { name: '开始生成' });
    expect(submit).toBeDisabled();
    expect(document.body.textContent).toContain('只能读');
  });

  it('后端当场 503 时原样显示中文 detail，不假装排队成功', async () => {
    const ctx = createContentHandlers();
    ctx.offlineRefuse();
    open({}, ctx);
    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('已关闭联网');
    // 没有产物区（没排队成功就不该显示「已生成」）
    expect(screen.queryByLabelText('生成结果')).not.toBeInTheDocument();
  });

  it('任务 failed 时显示后端 error 而不是停在转圈', async () => {
    const ctx = createContentHandlers(
      jobFixture('queued'),
      jobFixture('failed', null, '没有生成出任何合格的题目，请检查 AI 端点后重试'),
    );
    open({}, ctx);
    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }));
    expect(await screen.findByText(/没有生成出任何合格的题目/)).toBeInTheDocument();
    expect(screen.queryByText('生成中')).not.toBeInTheDocument();
  });

  it('切目标模块会改提交体（sparring 缺省，点口语后传 speaking）', async () => {
    const ctx = open();
    fireEvent.click(await screen.findByRole('button', { name: '口语题库' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(ctx.generateCalls).toHaveLength(1));
    expect(ctx.generateCalls[0].module).toBe('speaking');
  });
});
