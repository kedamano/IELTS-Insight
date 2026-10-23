/**
 * 生词本行为测试（FR-V1 / AC-V1、AC-X4；CONSTITUTION §3）。
 *
 * 断言重点不是「列表渲染了」，而是三条容易做错的契约：
 * 1. 每行必须带 `context` + 来源科目（AC-V1 的目的就是「想起这个词在哪句里遇到的」）；
 * 2. 行内改备注 = 重新 `POST /vocab`（后端同 word 覆盖），所以 **context / source_module /
 *    source_ref / tags 必须原样回传**，漏一个就会被后端清空；
 * 3. 导出是 `<a href>`，地址由 `services/api.ts` 拼（测试侧也不写端口字面量）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, type RequestHandler } from 'msw';
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../test/testUtils';
import { server } from '../../test/mocks/server';
import { API_BASE } from '../../services/api';
import { localDateKey } from '../report/format';
import type { VocabNote } from '../../types/ielts';
import VocabBook, { type VocabRow } from './VocabBook';

function row(overrides: Partial<VocabRow> = {}): VocabRow {
  return {
    word: 'plausible',
    context: 'The figures look plausible but the sample is tiny.',
    source_module: 'reading',
    source_ref: 're_p_iceharvest_03:q4',
    note_zh: '看起来合理的（阅读里常修饰论点）',
    tags: ['collocation'],
    // 后端返回的是带 `+00:00` 的时间戳；显示的那天必须是**本地**那天（东八区这里是 10-19）。
    created_at: '2026-10-18T17:30:00+00:00',
    ...overrides,
  };
}

export interface VocabTestContext {
  addBodies: Record<string, unknown>[];
  deleteWords: string[];
  listCalls: number;
}

/** 只装本文件的 handler（基线 handlers 由他人并发维护，形状与此处断言无关）。 */
function installVocab(list: VocabNote[], options: { listError?: boolean } = {}): VocabTestContext {
  const ctx: VocabTestContext = { addBodies: [], deleteWords: [], listCalls: 0 };
  const handlers: RequestHandler[] = [
    http.get(`${API_BASE}/vocab`, () => {
      ctx.listCalls += 1;
      if (options.listError) {
        return Response.json({ detail: '生词本读取失败：本机数据库被占用', code: 'internal_error' }, { status: 500 });
      }
      return Response.json({ data: list });
    }),
    http.post(`${API_BASE}/vocab`, async ({ request }) => {
      ctx.addBodies.push((await request.json()) as Record<string, unknown>);
      return Response.json({ data: list[0] });
    }),
    http.delete(`${API_BASE}/vocab/:word`, ({ params }) => {
      ctx.deleteWords.push(String(params.word));
      return Response.json({ data: { deleted: true } });
    }),
  ];
  server.use(...handlers);
  return ctx;
}

async function openBook(list: VocabRow[], options = {}): Promise<VocabTestContext> {
  const ctx = installVocab(list, options);
  render(<VocabBook />);
  await screen.findByText(list[0].word);
  return ctx;
}

/**
 * 磁贴条（契约 §8.3）只按 `data-metric` 取块：class 与文案都会随设计改动，磁贴身份不会。
 */
async function metric(name: string): Promise<HTMLElement> {
  const grid = await screen.findByLabelText('生词本关键指标');
  const node = grid.querySelector<HTMLElement>(`[data-metric="${name}"]`);
  if (!node) throw new Error(`找不到 data-metric="${name}" 的磁贴`);
  return node;
}

/** 顶部磁贴条容器（可能整条不渲染时用 query 版本自行判定）。 */
async function grid(): Promise<HTMLElement> {
  return screen.findByLabelText('生词本关键指标');
}

/** 相对「今天」往前 N 天的 ISO 串：让「近 7 天」读数与测试运行时刻无关。 */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString();
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.unstubAllGlobals();
});

describe('AC-V1 生词本列表', () => {
  it('每条都带上出处句子与来源科目，而不是只有单词', async () => {
    await openBook([row({ phonetic: '/ˈplɔːzəbl/', zh: '看起来合理的' })]);

    const item = screen.getByText('plausible').closest('li') as HTMLElement;
    expect(within(item).getByText(/The figures look plausible/)).toBeInTheDocument();
    expect(within(item).getByText('阅读')).toBeInTheDocument();
    expect(within(item).getByText('re_p_iceharvest_03:q4')).toBeInTheDocument();
    expect(within(item).getByText('/ˈplɔːzəbl/')).toBeInTheDocument();
    // 标签走中文映射（collocation → 搭配）
    expect(within(item).getByText('搭配')).toBeInTheDocument();
    // 日期取本地那天，不是截 UTC 字符串（2026-10-18T17:30Z 在东八区是 10-19 凌晨 1:30）
    expect(within(item).getByText(localDateKey(new Date('2026-10-18T17:30:00+00:00')))).toBeInTheDocument();
  });

  it('搜索命中出处句子与中文备注；无命中时说明是筛选导致而不是空库', async () => {
    await openBook([row(), row({ word: 'sample', context: 'a small sample', note_zh: '' })]);

    const search = screen.getByLabelText('搜索');

    // 命中 context（不是词头）
    fireEvent.change(search, { target: { value: 'tiny' } });
    expect(await screen.findByText('plausible')).toBeInTheDocument();
    expect(screen.queryByText('sample')).not.toBeInTheDocument();

    // 命中另一个词的 context
    fireEvent.change(search, { target: { value: 'small' } });
    expect(await screen.findByText('sample')).toBeInTheDocument();
    expect(screen.queryByText('plausible')).not.toBeInTheDocument();

    // 命中中文备注
    fireEvent.change(search, { target: { value: '看起来合理' } });
    expect(await screen.findByText('plausible')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText(/没有符合条件的生词/)).toBeInTheDocument();
  });

  it('排序在本地完成：最近加入 / 最早加入 / 词序 A–Z', async () => {
    await openBook([
      row({ word: 'alpha', created_at: '2026-10-01T09:00:00' }),
      row({ word: 'zeta', created_at: '2026-10-09T09:00:00' }),
    ]);

    const order = (): string[] =>
      within(screen.getByText('zeta').closest('ul') as HTMLElement)
        .getAllByRole('listitem')
        .map((node) => within(node).getByText(/alpha|zeta/).textContent as string);

    fireEvent.change(screen.getByLabelText('排序'), { target: { value: 'oldest' } });
    expect(order()).toEqual(['alpha', 'zeta']);

    fireEvent.change(screen.getByLabelText('排序'), { target: { value: 'recent' } });
    expect(order()).toEqual(['zeta', 'alpha']);

    fireEvent.change(screen.getByLabelText('排序'), { target: { value: 'word' } });
    expect(order()).toEqual(['alpha', 'zeta']);
  });

  it('标签筛选只留带该标签的行，点「全部」复原', async () => {
    await openBook([
      row(),
      row({ word: 'topic', tags: ['topic'] }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: '话题词' }));
    expect(await screen.findByText('topic')).toBeInTheDocument();
    expect(screen.queryByText('plausible')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(await screen.findByText('plausible')).toBeInTheDocument();
  });
});

describe('AC-V1 备注与删除', () => {
  it('保存备注回传完整行（context / 来源 / 标签一个都不能少），并重新拉列表', async () => {
    const ctx = await openBook([row()]);

    fireEvent.click(screen.getByRole('button', { name: '编辑备注' }));
    const area = screen.getByLabelText('plausible 的中文备注');
    fireEvent.change(area, { target: { value: '改过的备注' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(ctx.addBodies).toHaveLength(1));
    expect(ctx.addBodies[0]).toEqual({
      word: 'plausible',
      context: 'The figures look plausible but the sample is tiny.',
      source_module: 'reading',
      source_ref: 're_p_iceharvest_03:q4',
      note_zh: '改过的备注',
      tags: ['collocation'],
    });
    await waitFor(() => expect(ctx.listCalls).toBeGreaterThanOrEqual(2));
  });

  it('备注保存失败时错误可见，编辑框不会被悄悄关掉', async () => {
    installVocab([row()]);
    server.use(
      http.post(`${API_BASE}/vocab`, () =>
        Response.json({ detail: '生词写不进去：磁盘只读', code: 'internal_error' }, { status: 500 }),
      ),
    );
    render(<VocabBook />);
    await screen.findByText('plausible');

    fireEvent.click(screen.getByRole('button', { name: '编辑备注' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('生词写不进去：磁盘只读');
    expect(screen.getByLabelText('plausible 的中文备注')).toBeInTheDocument();
  });

  it('删除要先确认；取消不发请求，确认才走 DELETE', async () => {
    const ctx = await openBook([row()]);

    fireEvent.click(screen.getByRole('button', { name: '删除 plausible' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(ctx.deleteWords).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '删除 plausible' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(ctx.deleteWords).toEqual(['plausible']));
    await waitFor(() => expect(ctx.listCalls).toBeGreaterThanOrEqual(2));
  });

  it('生词本为空时给可操作说明，而不是空白页', async () => {
    installVocab([]);
    render(<VocabBook />);

    expect(await screen.findByText(/生词本还是空的/)).toBeInTheDocument();
  });

  it('列表读取失败显示后端 detail，不白屏', async () => {
    installVocab([], { listError: true });
    render(<VocabBook />);

    expect(await screen.findByRole('alert')).toHaveTextContent('生词本读取失败：本机数据库被占用');
  });
});

describe('AC-X4 导出', () => {
  it('导出链接指向 API_BASE，两种 format 分开', async () => {
    installVocab([]);
    render(<VocabBook />);
    await screen.findByText(/生词本还是空的/);

    const csv = screen.getByRole('link', { name: '导出 CSV' });
    const anki = screen.getByRole('link', { name: '导出 Anki' });
    expect(csv).toHaveAttribute('href', `${API_BASE}/vocab/export?format=csv`);
    expect(anki).toHaveAttribute('href', `${API_BASE}/vocab/export?format=anki`);
    expect(csv).toHaveAttribute('download');
  });
});

describe('生词本顶部磁贴条（契约 §8.3）', () => {
  it('磁贴读数正确：总数按全量、近 7 天新增按 created_at、尚无备注计数', async () => {
    await openBook([
      row({ word: 'plausible', created_at: daysAgo(1), note_zh: '' }),
      row({ word: 'sample', context: 'a small sample', created_at: daysAgo(30), note_zh: '有备注' }),
    ]);

    // 总数是全量 rows.length（2），不是筛后的 visible.length
    const total = await metric('vocab.total');
    expect(within(total).getByText('2')).toBeInTheDocument();
    expect(within(total).getByText(/当前显示 2 条/)).toBeInTheDocument();
    // 只有 1 天那条落在最近 7 个自然日内
    expect(within(await metric('vocab.recent')).getByText('1')).toBeInTheDocument();
    // plausible 备注为空 → 尚无备注 1 条
    expect(within(await metric('vocab.no-note')).getByText('1')).toBeInTheDocument();
  });

  it('整条只有一块暖面（尚无备注），渐变面与墨面禁止走出报告屏（§8.3 规则 1）', async () => {
    await openBook([row({ word: 'plausible', note_zh: '' }), row({ word: 'sample', context: 'a small sample' })]);
    const strip = await grid();

    expect(strip.querySelectorAll('[data-surface="warm"]')).toHaveLength(1);
    expect(strip.querySelectorAll('[data-surface="hero"], [data-surface="solid"]')).toHaveLength(0);
  });

  it('全部词条都有备注时不渲染 vocab.no-note，但总数/近 7 天仍在', async () => {
    await openBook([row({ word: 'plausible' }), row({ word: 'sample', context: 'a small sample' })]);
    const strip = await grid();

    expect(strip.querySelector('[data-metric="vocab.no-note"]')).toBeNull();
    expect(strip.querySelector('[data-metric="vocab.total"]')).not.toBeNull();
    expect(strip.querySelector('[data-metric="vocab.recent"]')).not.toBeNull();
  });

  it('近 7 天没有新增时该块照样渲染并给出说明（本契约唯一例外）', async () => {
    await openBook([row({ word: 'plausible', created_at: daysAgo(30) })]);
    const recent = await metric('vocab.recent');

    expect(within(recent).getByText('0')).toBeInTheDocument();
    expect(within(recent).getByText('最近 7 天没有新增')).toBeInTheDocument();
  });
});

