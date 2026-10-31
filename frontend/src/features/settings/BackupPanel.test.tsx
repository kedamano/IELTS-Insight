/**
 * 「数据与备份」卡（契约 §14.3 / §14.8；Wave 7 的 7g）。
 *
 * 这一屏的判定标准是「用户在出事那天能不能自己救回来」，所以断言的重心不是控件存在，而是：
 * - 机器名（`pre-upgrade` / 文件名）不许甩给用户，文件名里也不该有 —— 用户要靠时间和语义认副本；
 * - UTC 必须转本地（§14.7 里 `generated_at` 那条时区坑不许再犯）；
 * - 恢复是破坏性动作：确认弹窗要说清「会被覆盖」+「先留一份恢复前副本」，且默认焦点不是恢复；
 * - 本机路径只在这一处显示，绝不进弹窗与错误文案（CONSTITUTION §3）；
 * - 只读降级时写动作禁用（§14.6：点了只会撞 503，不如先说清）。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../test/testUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/mocks/server';
import { createDataHandlers, snapshotFixture, MOCK_BACKUP_DIR } from './testHandlers';
import BackupPanel from './BackupPanel';

/** 用UTC 时刻算出**本地**应显示的 `YYYY-MM-DD HH:mm`，与组件各算各的才算真验证。 */
function localText(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function open(options = {}) {
  const ctx = createDataHandlers(options);
  server.use(...ctx.handlers);
  render(<BackupPanel />);
  return ctx;
}

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});

describe('数据与备份（§14.8）', () => {
  it('每行给「本地时间 + 中文语义 + 大小」，不出现机器名与文件名', async () => {
    open({
      items: [
        snapshotFixture('manual', '20261029T010203'),
        snapshotFixture('pre-upgrade', '20261028T010203'),
        snapshotFixture('startup', '20261027T010203'),
        snapshotFixture('pre-restore', '20261026T010203'),
      ],
    });

    const list = await screen.findByRole('list', { name: '本机快照' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(list.textContent).toContain(localText('2026-10-29T01:02:03+00:00'));
    expect(list.textContent).toContain('手动备份');
    expect(list.textContent).toContain('升级前');
    expect(list.textContent).toContain('自动备份');
    expect(list.textContent).toContain('恢复前');
    expect(list.textContent).toContain('1.5 MB');
    // 机器名与文件名是给后端的，用户不需要辨认 `app.` 前缀
    expect(list.textContent).not.toMatch(/pre-upgrade|pre-restore|app\.|\.sqlite/);
    // UTC 尾巴也不许出现
    expect(list.textContent).not.toContain('+00:00');
  });

  it('距上次备份超过 max_age_days 才提示，未超过不打扰', async () => {
    open({ items: [snapshotFixture('startup')], daysSinceLast: 1 });
    await screen.findByRole('list', { name: '本机快照' });
    expect(document.body.textContent).not.toContain('天没有备份');
    cleanup();
    server.resetHandlers();

    open({ items: [snapshotFixture('startup')], daysSinceLast: 12 });
    // 陈旧提醒用 warn（Toast 的 danger 才占 role=alert，别把「该备份了」冒充成故障）
    const warn = await screen.findByText(/天没有备份/);
    expect(warn.textContent).toContain('12');
  });

  it('份数与轮转上限是后端给的读数，并写清超过上限会被冲掉', async () => {
    open({ items: [snapshotFixture('manual'), snapshotFixture('startup', '20261028T010203')] });
    const grid = await screen.findByLabelText('备份关键指标');
    const count = grid.querySelector('[data-metric="backup.count"]');
    if (!count) throw new Error('找不到份数读数');
    expect(count.textContent).toContain('2');
    // keep 由后端给（本机轮转上限 10），前端不许自己写死一个数
    expect(grid.textContent).toContain('10');
  });

  it('副本目录显示在这一处并可复制（拷出机器用）', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    open({ items: [snapshotFixture()] });

    const row = await screen.findByText(MOCK_BACKUP_DIR);
    const block = row.closest('div');
    if (!block) throw new Error('目录没有渲染');
    fireEvent.click(within(block as HTMLElement).getByRole('button', { name: /复制路径/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MOCK_BACKUP_DIR));
  });

  it('点「立即备份一份」→ POST /backup，成功后列表里就多一份手动备份', async () => {
    const ctx = open({ items: [snapshotFixture('startup', '20261028T010203')] });
    await screen.findByRole('list', { name: '本机快照' });

    fireEvent.click(screen.getByRole('button', { name: /立即备份一份/ }));

    await waitFor(() => expect(ctx.backupCalls).toBe(1));
    const list = await screen.findByRole('list', { name: '本机快照' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(list.textContent).toContain('手动备份');
  });

  it('备份失败时原样显示后端中文原因，列表不假装成功', async () => {
    const ctx = open({ items: [snapshotFixture('startup')] });
    await screen.findByRole('list', { name: '本机快照' });
    ctx.setBackupCreateError({
      status: 500,
      code: 'storage_unavailable',
      detail: '本机学习库当前无法写入，这份副本没有生成。请重启应用后再试。',
    });

    fireEvent.click(screen.getByRole('button', { name: /立即备份一份/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('这份副本没有生成');
    // 错误文案里不许出现本机目录（CONSTITUTION §3：路径只在列表那一处出现）
    expect(alert.textContent).not.toMatch(/AppData|backups/);
    expect(ctx.rows()).toHaveLength(1);
  });

  it('恢复要先确认：弹窗点名「会被覆盖」与「先留一份恢复前副本」，且不含路径', async () => {
    const ctx = open({
      items: [snapshotFixture('manual', '20261029T010203'), snapshotFixture('startup', '20261020T010203')],
    });
    await screen.findByRole('list', { name: '本机快照' });

    const list = screen.getByRole('list', { name: '本机快照' });
    const older = within(list).getAllByRole('listitem')[1];
    fireEvent.click(within(older).getByRole('button', { name: /恢复到这一份/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('当前进度会被覆盖');
    expect(dialog.textContent).toContain('恢复前');
    expect(dialog.textContent).not.toContain(MOCK_BACKUP_DIR);
    // 默认焦点必须是「退出这个动作」的那一侧：Modal 把焦点给面板里第一个可聚焦元素（头部关闭），
    // 所以 Enter 下去关的是窗，不是恢复。
    expect(document.activeElement?.textContent).toBe('关闭');
    expect(ctx.restoreCalls).toEqual([]);
  });

  it('确认后才发 restore；成功后说明其它页面要重新读取，并列出那份恢复前副本', async () => {
    const ctx = open({
      items: [snapshotFixture('manual', '20261029T010203'), snapshotFixture('startup', '20261020T010203')],
    });
    await screen.findByRole('list', { name: '本机快照' });

    const older = within(screen.getByRole('list', { name: '本机快照' })).getAllByRole('listitem')[1];
    fireEvent.click(within(older).getByRole('button', { name: /恢复到这一份/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /确认恢复/ }));

    await waitFor(() => expect(ctx.restoreCalls).toEqual(['app.startup.20261020T010203.sqlite']));
    const done = await screen.findByRole('status');
    expect(done.textContent).toContain('已恢复');
    expect(done.textContent).toMatch(/重新读取|重启/);
    // 后端在恢复前拍了 pre-restore，界面上要看得见（§14.3 的门要用户可见）
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: '本机快照' })).getByText('恢复前')).toBeTruthy(),
    );
  });

  it('关闭弹窗 = 取消，一个写请求都不发', async () => {
    const ctx = open({ items: [snapshotFixture('startup', '20261020T010203')] });
    await screen.findByRole('list', { name: '本机快照' });

    fireEvent.click(screen.getByRole('button', { name: /恢复到这一份/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ctx.restoreCalls).toEqual([]);
  });

  it('只读降级期间写动作全部禁用并说明原因，列表仍可读（§14.6）', async () => {
    const ctx = createDataHandlers({ items: [snapshotFixture('manual')] });
    server.use(...ctx.handlers);
    render(<BackupPanel storageReadonly />);

    const list = await screen.findByRole('list', { name: '本机快照' });
    expect(within(list).getByText('手动备份')).toBeTruthy();

    const backupButton = screen.getByRole('button', { name: /立即备份一份/ });
    expect(backupButton).toBeDisabled();
    expect(within(list).getByRole('button', { name: /恢复到这一份/ })).toBeDisabled();
    expect(document.body.textContent).toContain('学习库当前只能读');
    // 禁用 ≠ 藏起来：用户仍要能找到出口，所以按钮还在 DOM 里
    expect(ctx.rows()).toHaveLength(1);
  });
});
