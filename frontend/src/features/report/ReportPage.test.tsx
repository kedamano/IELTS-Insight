/**
 * ReportPage 摘要区（FR-P3 / AC-P3b / 契约 §8.1 + §8.2 的 bento 版式）行为测试。
 *
 * 版式对齐 `Direction B · Bento 数据块`样机：两块大 hero（综合 band + 练习时长，块内嵌图表）、
 * 三块分科白卡（听力/阅读正确率、生词本）、琥珀宽卡（TOP 错误类型）+ 分项 BAND 卡。
 *
 * 但**样机是静态图，数字是编的**；这里守的是落地后的数据诚实（AC-P3b）：
 * - 分科正确率只能用新加的 `analytics.by_module`，缺哪科就不渲染哪块，不显示 0%；
 * - 生词本没有「已掌握/待复习」字段（`vocab` 表只有 `created_at`），提示只能是「近 7 天新增」；
 * - 「整体 ±N.N」用 `delta_vs_previous` 的非空均值，两科以下不显示。
 *
 * 选择器一律走 `data-metric`（磁贴身份）与 `<dl>/<dt>`（语义），不依赖 class。
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { install } from '../shared/testKit';
import { ReportPage } from './ReportPage';
import {
  EMPTY_ANALYTICS,
  EMPTY_COMPOSITE,
  EMPTY_SUMMARY,
  EMPTY_TRENDS,
  REPORT_ANALYTICS,
  REPORT_COMPOSITE,
  REPORT_SETTINGS,
  REPORT_SUMMARY,
  REPORT_TRENDS,
  REPORT_VOCAB,
  createReportSpies,
  reportHandlers,
  type ReportSpies,
} from './testHandlers';

type Metric =
  | 'overall'
  | 'minutes'
  | 'accuracy-listening'
  | 'accuracy-reading'
  | 'vocab'
  | 'top-error'
  | 'criteria';

/** 取某一块磁贴：先等摘要区出现（首帧数据未到），再按 `data-metric` 取。 */
async function metric(name: Metric): Promise<HTMLElement> {
  const grid = await screen.findByLabelText('报告摘要');
  const node = grid.querySelector<HTMLElement>(`[data-metric="${name}"]`);
  if (!node) throw new Error(`找不到 data-metric="${name}" 的磁贴`);
  return node;
}

/** 页头（标题 + meta + 整体变化）不是磁贴，单独取。 */
async function header(): Promise<HTMLElement> {
  const node = await screen.findByRole('heading', { name: /^近 8 周走势$/ });
  const head = node.closest('header');
  if (!head) throw new Error('页头标题没有被包在 <header> 里');
  return head as HTMLElement;
}

describe('ReportPage bento 摘要区', () => {
  let spies: ReportSpies;

  beforeEach(() => {
    spies = createReportSpies();
  });

  it('页头给出标题、meta 行与整体变化 pill', async () => {
    install(...reportHandlers(spies, { summary: structuredClone(REPORT_SUMMARY) }));
    render(<ReportPage />);

    const head = await header();
    // meta 行只用 summary 已有字段：次数、分钟、目标分
    expect(within(head).getByText(/12 次练习/)).toBeInTheDocument();
    expect(within(head).getByText(/340 分钟/)).toBeInTheDocument();
    expect(within(head).getByText(/目标 Band 7/)).toBeInTheDocument();
    // delta = mean(0.5, -0.5, 0) = 0 → 说「持平」而不是「+0.0」
    expect(within(head).getByText('整体 持平')).toBeInTheDocument();
  });

  it('两块大磁贴：综合 band（hero 面 + 内嵌折线）与练习时长（墨面 + 内嵌柱状）', async () => {
    install(
      ...reportHandlers(spies, {
        summary: structuredClone(REPORT_SUMMARY),
        trends: structuredClone(REPORT_TRENDS),
        composite: structuredClone(REPORT_COMPOSITE),
        analytics: structuredClone(REPORT_ANALYTICS),
        settings: structuredClone(REPORT_SETTINGS),
        vocab: structuredClone(REPORT_VOCAB),
      }),
    );
    render(<ReportPage />);

    // 综合 band = 已评分三科的均值 (6 + 4.5 + 7.5) / 3 = 6.0，箭头指向目标 7.0
    const overall = await metric('overall');
    expect(overall.getAttribute('data-surface')).toBe('hero');
    expect(within(overall).getByText('6.0')).toBeInTheDocument();
    expect(within(overall).getByText('→ 7.0')).toBeInTheDocument();
    expect(within(overall).getByText('3 科均值 · 59 天后考试')).toBeInTheDocument();
    // sparkline 画的是综合走势，不是四科拼起来的假线
    expect(within(overall).getByRole('img', { name: /综合/ })).toBeInTheDocument();

    // 练习时长用分钟原值（不再换算成小时），日均与达标天数都来自 minutes_by_day
    const minutes = await metric('minutes');
    expect(minutes.getAttribute('data-surface')).toBe('solid');
    expect(within(minutes).getByText('340')).toBeInTheDocument();
    expect(within(minutes).getByText('分钟')).toBeInTheDocument();
    expect(within(minutes).getByText('日均 58 分钟 · 1 天达目标 60')).toBeInTheDocument();
    expect(within(minutes).getByRole('img', { name: /练习时长/ })).toBeInTheDocument();
  });

  it('三块分科白卡用 by_module 与生词本，缺哪科就不摆哪科', async () => {
    const analytics = structuredClone(REPORT_ANALYTICS);
    // 只做过听力：阅读那块必须整块消失，而不是显示 0% 或「—」
    analytics.by_module = [{ module: 'listening', correct: 18, total: 20, accuracy: 0.9 }];
    install(
      ...reportHandlers(spies, {
        summary: structuredClone(REPORT_SUMMARY),
        trends: structuredClone(REPORT_TRENDS),
        analytics,
        vocab: structuredClone(REPORT_VOCAB),
      }),
    );
    render(<ReportPage />);

    const listening = await metric('accuracy-listening');
    expect(listening.getAttribute('data-surface')).toBe('plain');
    expect(within(listening).getByText('90%')).toBeInTheDocument();
    expect(within(listening).getByText('18/20 题')).toBeInTheDocument();

    const grid = await screen.findByLabelText('报告摘要');
    expect(grid.querySelector('[data-metric="accuracy-reading"]')).toBeNull();
    expect(screen.queryByText('阅读正确率')).not.toBeInTheDocument();
    // 断言的是「0%」这个整块数值，不是任意位置的字串（`90%` 里也含 `0%`）
    expect(grid.textContent).not.toMatch(/(^|[^0-9])0%/);

    // 生词本：3 条，其中 2 条建于近 7 天内（fixture 用相对日期）
    const vocab = await metric('vocab');
    expect(within(vocab).getByText('3')).toBeInTheDocument();
    expect(within(vocab).getByText('近 7 天新增 2')).toBeInTheDocument();
  });

  it('琥珀宽卡给 TOP 错误类型，分项 BAND 卡给四维并标达标图例', async () => {
    install(
      ...reportHandlers(spies, {
        summary: structuredClone(REPORT_SUMMARY),
        trends: structuredClone(REPORT_TRENDS),
        analytics: structuredClone(REPORT_ANALYTICS),
        settings: structuredClone(REPORT_SETTINGS),
      }),
    );
    render(<ReportPage />);

    const topError = await metric('top-error');
    expect(topError.getAttribute('data-surface')).toBe('warm');
    expect(within(topError).getByText('拼写')).toBeInTheDocument();
    expect(within(topError).getByText('近 8 周 2 类错误共 6 次')).toBeInTheDocument();

    // fixture 里最近一次是口语（写作没练过）→ 四维是 FC/LR/GRA/P，不许凭空摆 TR/CC
    const criteria = await metric('criteria');
    expect(within(criteria).getByText('FC')).toBeInTheDocument();
    expect(within(criteria).getByText('GRA')).toBeInTheDocument();
    expect(within(criteria).queryByText('TR')).not.toBeInTheDocument();
    expect(within(criteria).getByText('口语 · 最近一次')).toBeInTheDocument();
    // 目标 7.0：只有发音 7.0 达标
    expect(criteria.querySelectorAll('[data-reached="true"]')).toHaveLength(1);
    expect(criteria.querySelectorAll('[data-reached="false"]')).toHaveLength(3);
    expect(within(criteria).getByText('达标')).toBeInTheDocument();
    expect(within(criteria).getByText('未达标')).toBeInTheDocument();
  });

  it('客观题错因的中文显示名仍在大块位生效（不能露出 reason 代码）', async () => {
    const analytics = structuredClone(REPORT_ANALYTICS);
    analytics.by_error_type = [
      { error_type: 'wrong', count: 14, latest_quote: 'Q7 写成 Monday，原文 Friday' },
      { error_type: 'spelling_variant_rejected', count: 3, latest_quote: 'environment' },
    ];
    install(
      ...reportHandlers(spies, {
        summary: structuredClone(REPORT_SUMMARY),
        trends: structuredClone(REPORT_TRENDS),
        analytics,
      }),
    );
    render(<ReportPage />);
    const topError = await metric('top-error');
    expect(within(topError).getByText('答案不正确')).toBeInTheDocument();
    expect(within(topError).queryByText('wrong')).not.toBeInTheDocument();
  });

  it('两科以下时不给「整体」结论，且无考试日期时 hero 提示说清去哪填', async () => {
    const summary = structuredClone(REPORT_SUMMARY);
    summary.current = { speaking: null, listening: 4.5, reading: null, writing: null };
    summary.delta_vs_previous = { speaking: null, listening: 0.5, reading: null, writing: null };
    summary.exam_date = null;
    summary.days_left = null;
    install(
      ...reportHandlers(spies, {
        summary,
        trends: structuredClone(REPORT_TRENDS),
        composite: structuredClone(REPORT_COMPOSITE),
        analytics: structuredClone(REPORT_ANALYTICS),
      }),
    );
    render(<ReportPage />);

    const head = await header();
    expect(within(head).queryByText(/^整体 /)).not.toBeInTheDocument();
    const overall = await metric('overall');
    // 只有一科有分 → 均值就是它自己，但提示必须说「1 科均值」而不是假装四科齐
    expect(within(overall).getByText('4.5')).toBeInTheDocument();
    expect(within(overall).getByText('1 科均值 · 尚未设置考试日期')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Invalid Date|undefined/);
  });

  it('综合走势为空时不画折线，也不留一个空 svg（AC-P3）', async () => {
    install(
      ...reportHandlers(spies, {
        summary: structuredClone(REPORT_SUMMARY),
        trends: structuredClone(REPORT_TRENDS),
        composite: EMPTY_COMPOSITE,
        analytics: structuredClone(REPORT_ANALYTICS),
      }),
    );
    render(<ReportPage />);
    const overall = await metric('overall');
    expect(within(overall).queryByRole('img')).toBeNull();
  });

  it('报告页会拉取概览摘要与生词本各一次（磁贴的数据源）', async () => {
    install(...reportHandlers(spies, { summary: structuredClone(REPORT_SUMMARY) }));
    render(<ReportPage />);
    await metric('overall');
    expect(spies.summaryCalls).toBe(1);
    expect(spies.vocabCalls).toBe(1);
  });

  it('全部无数据时不渲染数字墙，保留原空态文案（AC-P3）', async () => {
    install(
      ...reportHandlers(spies, {
        summary: structuredClone(EMPTY_SUMMARY),
        trends: structuredClone(EMPTY_TRENDS),
        composite: EMPTY_COMPOSITE,
        analytics: structuredClone(EMPTY_ANALYTICS),
        attempts: [],
        vocab: [],
      }),
    );
    render(<ReportPage />);

    expect(await screen.findByText(/尚无练习数据/)).toBeInTheDocument();
    expect(document.querySelector('dl[aria-label="报告摘要"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|Invalid Date|undefined/);
  });

  it('明细全空时宁可整块不显示，也不给一个 0% 正确率（AC-P3）', async () => {
    install(
      ...reportHandlers(spies, {
        // 概览有数（设了目标分），但趋势/正确率/错误/时长/四维全空 = 还没做过任何练习。
        summary: structuredClone(REPORT_SUMMARY),
        trends: structuredClone(EMPTY_TRENDS),
        composite: EMPTY_COMPOSITE,
        analytics: structuredClone(EMPTY_ANALYTICS),
        attempts: [],
        vocab: [],
      }),
    );
    render(<ReportPage />);
    await screen.findByText(/尚无练习数据/);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(document.querySelector('dl[aria-label="报告摘要"]')).toBeNull();
  });

  it('摘要区不吃掉下方明细（趋势/题型/错因/热力图仍在）', async () => {
    install(...reportHandlers(spies, { summary: structuredClone(REPORT_SUMMARY) }));
    const { container } = render(<ReportPage />);
    await metric('overall');
    for (const label of ['Band 趋势', '题型正确率', '错误类型分布', '练习时长']) {
      expect(container.querySelector(`section[aria-label="${label}"]`)).toBeInTheDocument();
    }
  });
});
