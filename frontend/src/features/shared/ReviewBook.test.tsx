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

/** Stat 的形状是「标签 span + 值 span」相邻；徽标里也有同名词，所以按兄弟节点取值。 */
function statValue(labelText: string): string {
  const label = screen
    .getAllByText(labelText)
    .find((node) => node.nextElementSibling != null && /^\d+$/.test(node.nextElementSibling.textContent ?? ''));
  if (!label) throw new Error(`${labelText} 的统计值没有渲染`);
  return (label.nextElementSibling?.textContent ?? '').trim();
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

    expect(statValue('未掌握')).toBe('1');
    expect(statValue('已掌握')).toBe('1');
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
