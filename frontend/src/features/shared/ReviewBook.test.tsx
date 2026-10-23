/**
 * 错题本行为测试（FR-V2 / AC-V2、AC-X1/X4；CONSTITUTION §3）。
 *
 * 三条容易做错的契约：
 * 1. 默认视图只看 `status=open`（与后端默认一致），筛选变化要把参数真的带到 query 里；
 * 2. 「已掌握」是**手动**动作 → `POST /review/{id}/resolve`：没有任何自动推断，
 *    所以首屏渲染本身绝不能发出 resolve/delete 请求；
 * 3. 删除是 `DELETE /review/{id}`，且必须先经确认弹窗，取消不发请求。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { http, type RequestHandler } from 'msw';
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../test/testUtils';
import { server } from '../../test/mocks/server';
import { API_BASE } from '../../services/api';
import type { ReviewItem } from '../../types/ielts';
import ReviewBook from './ReviewBook';

function item(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'rv_1',
    module: 'listening',
    item_ref: 'li_s1_craftcourse_03:q7',
    question_type: 'gap_fill',
    error_type: 'spelling',
    quote: 'The workshop starts on Thursday.',
    detail_zh: '答案要求单词原样抄写，注意首字母大写。',
    status: 'open',
    first_seen_at: '2026-10-08T20:00:00',
    last_seen_at: '2026-10-15T20:00:00',
    seen_count: 2,
    resolved_at: null,
    source_attempt_id: 'at_1',
    ...overrides,
  };
}

export interface ReviewTestContext {
  queries: URLSearchParams[];
  resolveIds: string[];
  deleteIds: string[];
  listCalls: number;
}

function installReview(list: ReviewItem[], options: { listError?: boolean } = {}): ReviewTestContext {
  const ctx: ReviewTestContext = { queries: [], resolveIds: [], deleteIds: [], listCalls: 0 };
  const handlers: RequestHandler[] = [
    http.get(`${API_BASE}/review/errors`, ({ request }) => {
      ctx.listCalls += 1;
      const params = new URL(request.url).searchParams;
      ctx.queries.push(params);
      if (options.listError) {
        return Response.json({ detail: '错题本读取失败：本机数据库被占用', code: 'internal_error' }, { status: 500 });
      }
      // 与后端 `_STATUSES` 一致：status 三档 + module + error_type 过滤。
      const status = params.get('status') ?? 'open';
      const module = params.get('module');
      const errorType = params.get('error_type');
      const rows = list.filter(
        (entry) =>
          (status === 'all' || entry.status === status) &&
          (!module || entry.module === module) &&
          (!errorType || entry.error_type === errorType),
      );
      return Response.json({ data: rows });
    }),
    http.post(`${API_BASE}/review/:id/resolve`, ({ params }) => {
      ctx.resolveIds.push(String(params.id));
      return Response.json({ data: { status: 'resolved' } });
    }),
    http.delete(`${API_BASE}/review/:id`, ({ params }) => {
      ctx.deleteIds.push(String(params.id));
      return Response.json({ data: { deleted: true } });
    }),
  ];
  server.use(...handlers);
  return ctx;
}

async function openBook(list: ReviewItem[], options = {}): Promise<ReviewTestContext> {
  const ctx = installReview(list, options);
  render(<ReviewBook />);
  await screen.findByText('The workshop starts on Thursday.');
  return ctx;
}

/**
 * 磁贴条（契约 §8.3）只按 `data-metric` 取块：class 与文案都会随设计改动，磁贴身份不会。
 * 取不到时抛错，方便定位是「该渲染的没渲染」而不是断言静默通过。
 */
async function metric(name: string): Promise<HTMLElement> {
  const grid = await screen.findByLabelText('错题本关键指标');
  const node = grid.querySelector<HTMLElement>(`[data-metric="${name}"]`);
  if (!node) throw new Error(`找不到 data-metric="${name}" 的磁贴`);
  return node;
}

/** 顶部磁贴条容器（可能整条不渲染时用 query 版本自行判定）。 */
async function grid(): Promise<HTMLElement> {
  return screen.findByLabelText('错题本关键指标');
}

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

describe('AC-V2 默认视图与筛选', () => {
  it('首屏只请求未掌握（status=open），且不发出任何写请求', async () => {
    const ctx = await openBook([item()]);

    expect(ctx.queries[0]?.get('status')).toBe('open');
    expect(ctx.queries[0]?.get('module')).toBeNull();
    expect(ctx.resolveIds).toHaveLength(0);
    expect(ctx.deleteIds).toHaveLength(0);
  });

  it('按科目分组显示计数，未分类科目单独成组', async () => {
    await openBook([
      item(),
      item({ id: 'rv_2', module: 'writing', quote: 'It is a important issue.', error_type: 'article' }),
      item({ id: 'rv_3', module: 'other' as ReviewItem['module'], quote: '未归类的记录' }),
    ]);

    // 「写作」同时出现在科目下拉与分组标题里，所以按 heading 定位。
    const headings = screen.getAllByRole('heading').map((node) => node.textContent ?? '');
    expect(headings.filter((text) => text.startsWith('写作'))).toHaveLength(1);
    expect(headings.some((text) => text.startsWith('听力'))).toBe(true);
    expect(await screen.findByText('未分类')).toBeInTheDocument();
    expect(within(screen.getByLabelText('听力错题')).getAllByRole('listitem')).toHaveLength(1);
  });

  it('切换科目/状态/错误类型都会带参数重新请求', async () => {
    const ctx = await openBook([item()]);

    fireEvent.change(screen.getByLabelText('科目'), { target: { value: 'reading' } });
    await waitFor(() => expect(ctx.queries.at(-1)?.get('module')).toBe('reading'));

    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'all' } });
    await waitFor(() => expect(ctx.queries.at(-1)?.get('status')).toBe('all'));

    fireEvent.change(screen.getByLabelText('错误类型'), { target: { value: 'spelling' } });
    await waitFor(() => expect(ctx.queries.at(-1)?.get('error_type')).toBe('spelling'));
  });

  it('未掌握/已掌握两个计数按当前列表如实统计', async () => {
    const ctx = await openBook([item(), item({ id: 'rv_2', status: 'resolved', quote: 'another' })]);

    // 默认视图只有未掌握那一条 → 切到「全部」才能同时看到两类，计数才可比。
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'all' } });
    await waitFor(() => expect(ctx.queries.at(-1)?.get('status')).toBe('all'));
    await screen.findByText('another');

    // 这两个读数原先挂在 Card 内的 `<Stat>` 上，§8.3 规则 4 去重后搬进了磁贴条，
    // 断言随之收紧到对应 `data-metric` 的块内（期望值不变，只是换了读数位置）。
    expect(within(await metric('review.open')).getByText('1')).toBeInTheDocument();
    expect(within(await metric('review.resolved')).getByText('1')).toBeInTheDocument();
  });

  it('已掌握的行不再提供「已掌握」按钮', async () => {
    const ctx = installReview([item({ status: 'resolved' })]);
    render(<ReviewBook />);
    await waitFor(() => expect(ctx.listCalls).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'all' } });
    await screen.findByText('The workshop starts on Thursday.');

    expect(screen.queryByRole('button', { name: '已掌握' })).not.toBeInTheDocument();
  });
});

describe('AC-V2 手动动作', () => {
  it('点「已掌握」只对该 id 发 resolve，成功后重新拉列表', async () => {
    const ctx = await openBook([item(), item({ id: 'rv_9', quote: 'second row' })]);

    const first = screen.getAllByRole('listitem')[0] as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: '已掌握' }));
    await waitFor(() => expect(ctx.resolveIds).toEqual(['rv_1']));
    await waitFor(() => expect(ctx.listCalls).toBeGreaterThanOrEqual(2));
  });

  it('删除要先确认；取消不发请求，确认才走 DELETE', async () => {
    const ctx = await openBook([item()]);

    fireEvent.click(screen.getByRole('button', { name: '删除该错题' }));
    expect(await screen.findByText('删除这条错题？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(ctx.deleteIds).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '删除该错题' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(ctx.deleteIds).toEqual(['rv_1']));
  });

  it('每条给出原句、中文解析、出现次数与最近出现时间（跨 attempt 由后端累加）', async () => {
    await openBook([item({ last_seen_at: '2026-10-15T20:00:00' })]);

    expect(await screen.findByText(/出现 2 次/)).toBeInTheDocument();
    expect(screen.getByText('答案要求单词原样抄写，注意首字母大写。')).toBeInTheDocument();
    expect(screen.getByText(/li_s1_craftcourse_03:q7/)).toBeInTheDocument();
    // 时间必须按本地时区显示，不能是 UTC 原文
    const line = screen.getByText(/最近出现/).textContent ?? '';
    expect(line).toMatch(/^最近出现 2026-10-1[56] \d{2}:\d{2}/);
  });

  it('操作失败时中文错误可见，不把失败吞掉', async () => {
    installReview([item()]);
    server.use(
      http.post(`${API_BASE}/review/:id/resolve`, () =>
        Response.json({ detail: '这条错题已经不存在了', code: 'not_found' }, { status: 404 }),
      ),
    );
    render(<ReviewBook />);
    await screen.findByText('The workshop starts on Thursday.');

    fireEvent.click(screen.getByRole('button', { name: '已掌握' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('这条错题已经不存在了');
  });

  it('列表读取失败显示后端 detail，不白屏', async () => {
    installReview([], { listError: true });
    render(<ReviewBook />);

    expect(await screen.findByRole('alert')).toHaveTextContent('错题本读取失败：本机数据库被占用');
  });
});

describe('错题本顶部磁贴条（契约 §8.3）', () => {
  it('磁贴读数正确：未掌握/已掌握/顽固错误/涉及科目', async () => {
    // rv_1 听力未掌握 seen 2（顽固），rv_2 写作已掌握 seen 1（不顽固）——切到全部后两科齐活。
    const ctx = await openBook([
      item(),
      item({ id: 'rv_2', module: 'writing', error_type: 'article', status: 'resolved', quote: 'another', seen_count: 1 }),
    ]);
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'all' } });
    await waitFor(() => expect(ctx.queries.at(-1)?.get('status')).toBe('all'));
    await screen.findByText('another');

    expect(within(await metric('review.open')).getByText('1')).toBeInTheDocument();
    expect(within(await metric('review.resolved')).getByText('1')).toBeInTheDocument();
    expect(within(await metric('review.stubborn')).getByText('1')).toBeInTheDocument();
    const modules = await metric('review.modules');
    expect(within(modules).getByText('2')).toBeInTheDocument();
    expect(within(modules).getByText('科')).toBeInTheDocument();
    expect(within(modules).getByText(/听力/)).toBeInTheDocument();
    expect(within(modules).getByText(/写作/)).toBeInTheDocument();
  });

  it('整条只有一块暖面（未掌握），渐变面与墨面禁止走出报告屏（§8.3 规则 1）', async () => {
    await openBook([item()]);
    const strip = await grid();

    expect(strip.querySelectorAll('[data-surface="warm"]')).toHaveLength(1);
    expect(strip.querySelectorAll('[data-surface="hero"], [data-surface="solid"]')).toHaveLength(0);
  });

  it('默认 status=open 时「已掌握」永远是 0，属假数，整块不渲染（§8.3 规则 3）', async () => {
    await openBook([item()]);
    const strip = await grid();

    expect(strip.querySelector('[data-metric="review.resolved"]')).toBeNull();
    // 未掌握是本屏唯一的待处理信号，默认视图必须有它
    expect(strip.querySelector('[data-metric="review.open"]')).not.toBeNull();
  });

  it('无顽固条目（全部 seen_count=1）时不渲染 review.stubborn', async () => {
    await openBook([item({ seen_count: 1 })]);
    const strip = await grid();

    expect(strip.querySelector('[data-metric="review.stubborn"]')).toBeNull();
  });

  it('筛到「已掌握」后未掌握读数为 0，暖面整块撤下（暖面是行动召唤，0 就不该召唤）', async () => {
    const ctx = await openBook([item(), item({ id: 'rv_2', status: 'resolved', quote: 'another' })]);

    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'resolved' } });
    await waitFor(() => expect(ctx.queries.at(-1)?.get('status')).toBe('resolved'));
    await screen.findByText('another');

    const strip = await grid();
    expect(strip.querySelector('[data-metric="review.open"]')).toBeNull();
    expect(strip.querySelectorAll('[data-surface="warm"]')).toHaveLength(0);
    // 同屏的 plain 读数照常工作，撤下的只是那块琥珀
    expect(within(await metric('review.resolved')).getByText('1')).toBeInTheDocument();
  });
});

