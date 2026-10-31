/**
 * 「回收站」卡（契约 §14.4 / §14.8；Wave 7 的 7g）。
 *
 * §14.4 让删除变成可逆，但用户看不见回收站就等于没可逆 —— 所以这里的重心是：
 * 摘要够不够做决定（科目 / 题号 / band / 何时删的）、`total` 用的是后端的数而不是当前页条数、
 * 彻底删除前必须确认、后端 409 那句「先备份」要原样到达用户、已删记录不给报告入口。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../test/testUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/mocks/server';
import { createDataHandlers, trashFixture, MOCK_BACKUP_DIR } from './testHandlers';
import TrashPanel from './TrashPanel';

function localText(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function open(options = {}) {
  const ctx = createDataHandlers(options);
  server.use(...ctx.handlers);
  render(<TrashPanel />);
  return ctx;
}

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});

describe('回收站（§14.8）', () => {
  it('行给「科目 + 题号 + band + 删除时间（本地）」，够决定恢复还是清除', async () => {
    open({
      trash: [
        trashFixture(),
        trashFixture({
          id: 'att_wr_trash_2',
          module: 'writing',
          task_ref: 'wr_t2_carcity_02',
          band_overall: 6.0,
          title_zh: null,
          deleted_at: '2026-10-26T23:10:00+00:00',
        }),
      ],
    });

    const list = await screen.findByRole('list', { name: '回收站里的练习记录' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('听力');
    expect(rows[0].textContent).toContain('li_s2_travel_03');
    expect(rows[0].textContent).toContain(localText('2026-10-27T22:41:00+00:00'));
    expect(rows[1].textContent).toContain('写作');
    expect(rows[1].textContent).toContain('6.0');
    // 摘要自带 deleted_at，界面上不出现原始 UTC 串
    expect(list.textContent).not.toMatch(/\+00:00|T\d{2}:\d{2}/);
  });

  it('条数用后端的 total，超过本页时说明只列出最近若干条', async () => {
    open({ trash: [trashFixture()], total: 137 });
    const grid = await screen.findByLabelText('回收站关键指标');
    const count = grid.querySelector('[data-metric="trash.count"]');
    if (!count) throw new Error('找不到条数读数');
    expect(count.textContent).toContain('137');
    await screen.findByText(/只列出最近 50 条/);
  });

  it('空态说清「删了能在这儿找回」，而不是留一片空白', async () => {
    open({ trash: [], total: 0 });
    const empty = await screen.findByText(/回收站是空的/);
    expect(empty.textContent).toContain('找回');
    expect(screen.queryByRole('list', { name: '回收站里的练习记录' })).toBeNull();
  });

  it('恢复：发 POST /attempts/{id}/restore，行随之从列表消失', async () => {
    const ctx = open({ trash: [trashFixture(), trashFixture({ id: 'att_rd_3', module: 'reading', task_ref: 'rd_s1_01' })] });
    await screen.findByRole('list', { name: '回收站里的练习记录' });

    const row = within(screen.getByRole('list', { name: '回收站里的练习记录' })).getAllByRole('listitem')[0];
    fireEvent.click(within(row).getByRole('button', { name: /恢复/ }));

    await waitFor(() => expect(ctx.restoreAttemptCalls).toEqual(['att_li_trash_1']));
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: '回收站里的练习记录' })).getAllByRole('listitem')).toHaveLength(1),
    );
    expect(ctx.totals().trash).toBe(1);
  });

  it('彻底删除要先确认，确认后才发 purge', async () => {
    const ctx = open({ trash: [trashFixture()] });
    await screen.findByRole('list', { name: '回收站里的练习记录' });

    fireEvent.click(screen.getByRole('button', { name: /彻底删除/ }));
    expect(ctx.purgeCalls).toEqual([]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/无法撤回|不可恢复/);
    expect(dialog.textContent).not.toMatch(/AppData|\.sqlite/);
    fireEvent.click(within(dialog).getByRole('button', { name: /确认清除/ }));

    await waitFor(() => expect(ctx.purgeCalls).toEqual(['att_li_trash_1']));
    await screen.findByText(/回收站是空的/);
  });

  it('没有快照时后端给 409，那句「先备份」原样到达用户且行还在', async () => {
    const ctx = open({ trash: [trashFixture()] });
    await screen.findByRole('list', { name: '回收站里的练习记录' });
    ctx.setPurgeError({
      status: 409,
      code: 'conflict',
      detail: '本机还没有任何学习库快照，清除后就无法撤回。请先在「数据与备份」里备份一份，再执行清除。',
    });

    fireEvent.click(screen.getByRole('button', { name: /彻底删除/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /确认清除/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('请先在「数据与备份」里备份一份');
    expect(alert.textContent).not.toMatch(/AppData|backups|409/);
    // 被拦住了就是没删掉
    expect(ctx.trash()).toHaveLength(1);
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: '回收站里的练习记录' })).getAllByRole('listitem')).toHaveLength(1),
    );
  });

  it('已软删的记录不给报告入口（§14.4：要看报告先恢复）', async () => {
    open({ trash: [trashFixture()] });
    await screen.findByRole('list', { name: '回收站里的练习记录' });
    expect(screen.queryByRole('button', { name: /报告|查看|打开/ })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('只读降级时恢复与清除都禁用并说明原因，列表仍可读（§14.6）', async () => {
    const ctx = createDataHandlers({ trash: [trashFixture()] });
    server.use(...ctx.handlers);
    render(<TrashPanel storageReadonly />);

    const list = await screen.findByRole('list', { name: '回收站里的练习记录' });
    const row = within(list).getAllByRole('listitem')[0];
    expect(within(row).getByRole('button', { name: /恢复/ })).toBeDisabled();
    expect(within(row).getByRole('button', { name: /彻底删除/ })).toBeDisabled();
    expect(document.body.textContent).toContain('学习库当前只能读');
    expect(document.body.textContent).not.toContain(MOCK_BACKUP_DIR);
  });
});
