/**
 * Dashboard（FR-P1 / AC-P1 / AC-G2 / AC-P2）行为测试。
 *
 * 关心四件事：
 * 1. 挂载就真的各拉一次（刚做完练习回到概览必须立刻反映，AC-P1）；
 * 2. null band 走「尚无数据」，页面上不出现 NaN / Invalid Date（AC-P3、AC-G5）；
 * 3. band 三档语义色只按 `ui/tokens.ts` 的阈值出现（≥7 good / ≥5.5 mid / 其余 poor）；
 * 4. 勾选今日任务时 `POST /plan/{id}/done` 的 id 与 done 值都对得上（AC-P2）。
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { install } from '../shared/testKit';
import { Dashboard } from './Dashboard';
import {
  EMPTY_SUMMARY,
  REPORT_PLAN,
  REPORT_SUMMARY,
  createReportSpies,
  reportHandlers,
  type ReportSpies,
} from './testHandlers';
import type { PlanTodayResult } from '../../types/ielts';

/**
 * 磁贴条（契约 §8.3）只按 `data-metric` 取块：class 与文案都会随设计改动，
 * 磁贴身份不会。
 */
async function metric(name: string): Promise<HTMLElement> {
  const grid = await screen.findByLabelText('概览关键指标');
  const node = grid.querySelector<HTMLElement>(`[data-metric="${name}"]`);
  if (!node) throw new Error(`找不到 data-metric="${name}" 的磁贴`);
  return node;
}

describe('Dashboard 概览页', () => {
  let spies: ReportSpies;

  beforeEach(() => {
    spies = createReportSpies();
  });

  it('挂载即拉取概览、今日计划与四科趋势（AC-P1 / AC-G2）', async () => {
    install(...reportHandlers(spies, { summary: structuredClone(REPORT_SUMMARY) }));
    render(<Dashboard />);

    expect(await screen.findByText('目标 Band')).toBeInTheDocument();
    expect(spies.summaryCalls).toBe(1);
    // 四科各一条 trend 请求，days=90 由概览页决定（FR-P1 迷你趋势）
    expect([...spies.trendQueries].sort()).toEqual(['listening', 'reading', 'speaking', 'writing']);
    expect(screen.getByText('距考试（天）')).toBeInTheDocument();
    expect(screen.getByText('59')).toBeInTheDocument();
    expect(screen.getByText('340')).toBeInTheDocument();
  });

  it('刚完成一次练习后重新挂载，数值立刻是新值（AC-P1）', async () => {
    // 先以「全空」状态挂载，再模拟后端出现了新记录
    install(...reportHandlers(spies, { summary: structuredClone(EMPTY_SUMMARY) }));
    const first = render(<Dashboard />);
    expect(await screen.findAllByText('尚无数据')).toHaveLength(4);
    expect(screen.getByText(/四科都还没有记录/)).toBeInTheDocument();
    first.unmount();

    install(...reportHandlers(spies, { summary: structuredClone(REPORT_SUMMARY) }));
    const second = render(<Dashboard />);
    await waitFor(() => expect(screen.getByText('7.5')).toBeInTheDocument());
    expect(spies.summaryCalls).toBe(2);
    // 听力 4.5 现在同时出现在「最弱一科」磁贴和听力卡片上，断言必须落在卡片里，
    // 否则 getByText 会因为两处同值而报 multiple matches。
    const listening = second.container.querySelector<HTMLElement>('section[aria-label="听力 · 当前 Band"]');
    if (!listening) throw new Error('找不到听力当前 Band 卡片');
    expect(within(listening).getByText('4.5')).toBeInTheDocument();
  });

  it('null band 显示「尚无数据」，整页没有 NaN / Invalid Date（AC-P3 / AC-G5）', async () => {
    const summary = structuredClone(REPORT_SUMMARY);
    summary.current.writing = null;
    summary.delta_vs_previous.writing = null;
    summary.last_practice_at = null;
    summary.minutes_total = Number.NaN;
    summary.days_left = null;
    summary.exam_date = null;
    install(...reportHandlers(spies, { summary }));
    render(<Dashboard />);

    await screen.findByText('目标 Band');
    // 四科里只有写作是 null → 一处「尚无数据」
    expect(screen.getByText('尚无数据')).toBeInTheDocument();
    // 倒计时缺考试日期：整页可能有多处 '—'（最近练习、时长同走该兜底），
    // 所以断言必须落在倒计时这个 Stat 上，并确认它给出的是「去设置」的可读提示。
    const countdownStat = screen.getByText('距考试（天）').closest('div');
    if (!countdownStat) throw new Error('找不到倒计时 Stat');
    expect(within(countdownStat).getByText('—')).toBeInTheDocument();
    expect(within(countdownStat).getByText('尚未设置考试日期，可在「设置」中填写')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Invalid Date|undefined/);
  });

  it('band 阈值配色：≥7 good、5.5–6.5 mid、≤5 poor、无数据 none', async () => {
    install(...reportHandlers(spies, { summary: structuredClone(REPORT_SUMMARY) }));
    const { container } = render(<Dashboard />);
    await screen.findByText('目标 Band');

    const findSection = (title: string) =>
      waitFor(() => {
        const node = container.querySelector<HTMLElement>(`section[aria-label="${title}"]`);
        if (!node) throw new Error(`找不到卡片 ${title}`);
        return node;
      });

    const toneOf = async (title: string): Promise<string | null> => {
      const card = await findSection(title);
      return card.querySelector('[data-band-tone]')?.getAttribute('data-band-tone') ?? null;
    };

    expect(await toneOf('阅读 · 当前 Band')).toBe('good'); // 7.5
    expect(await toneOf('口语 · 当前 Band')).toBe('mid'); // 6.0
    expect(await toneOf('听力 · 当前 Band')).toBe('poor'); // 4.5
    expect(await toneOf('写作 · 当前 Band')).toBe('none'); // null
  });

  it('勾选今日任务：POST 带对的 task id，完成后徽标变成 2/2（AC-P2）', async () => {
    const user = userEvent.setup();
    install(...reportHandlers(spies, { plan: structuredClone(REPORT_PLAN) }));
    render(<Dashboard />);

    const first = await screen.findByRole('checkbox', { name: /听力与目标差/ });
    const already = screen.getByRole('checkbox', { name: /写作尚无评分/ });
    expect(first).not.toBeChecked();
    expect(already).toBeChecked();

    await user.click(first);

    await waitFor(() => expect(spies.planDone).toEqual([{ id: 'task-1', done: true }]));
    // 勾选前 fixture 已是 task-2 done → 「已完成 1/2」；点 task-1 并重拉后两条都完成。
    expect(await screen.findByText(/^已完成 2\/2/)).toBeInTheDocument();
    expect(first).toBeChecked();
    // 只发了这一个 id，没有把别的任务一起提交
    expect(spies.planDone.map((item) => item.id)).toEqual(['task-1']);
  });

  it('概览请求失败时中文错误可见，不静默留白（CONSTITUTION §3）', async () => {
    install(...reportHandlers(spies, { summaryFailure: '概览统计读取失败' }));
    render(<Dashboard />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('概览统计读取失败');
  });

  it('趋势缺失时显示「暂无趋势」而不是空图（FR-P1）', async () => {
    install(...reportHandlers(spies, { summary: structuredClone(REPORT_SUMMARY) }));
    const { container } = render(<Dashboard />);
    await screen.findByText('目标 Band');

    const writing = await waitFor(() => {
      const node = container.querySelector<HTMLElement>('section[aria-label="写作 · 当前 Band"]');
      if (!node) throw new Error('找不到写作卡片');
      return node;
    });
    expect(within(writing).getByText('暂无趋势')).toBeInTheDocument();

    const speaking = container.querySelector<HTMLElement>('section[aria-label="口语 · 当前 Band"]');
    expect(speaking ? within(speaking).getByText('3 个数据点') : null).toBeInTheDocument();
  });

  // ---------- 磁贴条（契约 §8.3）----------

  it('磁贴条给出最弱一科的差距、变动最大的一科与今日计划完成度', async () => {
    install(...reportHandlers(spies, { summary: structuredClone(REPORT_SUMMARY) }));
    render(<Dashboard />);
    await screen.findByText('目标 Band');

    // 听力 4.5 是四科里唯一的最低值（写作为 null 不参与）
    const weakest = await metric('overview.weakest');
    expect(within(weakest).getByText('4.5')).toBeInTheDocument();
    expect(within(weakest).getByText('听力')).toBeInTheDocument();
    expect(within(weakest).getByText('距目标 2.5')).toBeInTheDocument();

    // 口语 +0.5 与听力 -0.5 绝对值并列，按 MODULES 顺序取先出现的口语
    const delta = await metric('overview.delta');
    expect(within(delta).getByText('+0.5')).toBeInTheDocument();
    expect(within(delta).getByText('口语')).toBeInTheDocument();

    const plan = await metric('overview.plan');
    expect(within(plan).getByText('1/2')).toBeInTheDocument();
  });

  it('整条只有「最弱一科」一块暖面；渐变面与墨面禁止走出报告屏（§8.3 规则 1）', async () => {
    install(...reportHandlers(spies, { summary: structuredClone(REPORT_SUMMARY) }));
    render(<Dashboard />);

    const grid = await screen.findByLabelText('概览关键指标');
    expect(grid.querySelectorAll('[data-surface="warm"]')).toHaveLength(1);
    expect(grid.querySelectorAll('[data-surface="hero"], [data-surface="solid"]')).toHaveLength(0);
  });

  it('四科无记录且今日计划为空时整条不渲染，不摆 0 或 —（§8.3 规则 3）', async () => {
    const emptyPlan: PlanTodayResult = { items: [], generated_at: '2026-10-18T07:30:00Z' };
    install(...reportHandlers(spies, { summary: structuredClone(EMPTY_SUMMARY), plan: emptyPlan }));
    render(<Dashboard />);
    await screen.findByText('目标 Band');

    expect(screen.queryByLabelText('概览关键指标')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Invalid Date|undefined/);
  });
});
