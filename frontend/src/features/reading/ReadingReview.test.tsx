/**
 * 阅读讲评（契约 §3-OR + FR-R4 / AC-R4）。
 *
 * 三条硬性展示要求逐条锁住：
 * 1. 错题必须有 `reason` 的中文判分原因（不能只说「错了」）；
 * 2. TRUE/FALSE/NOT GIVEN 必须区分「原文未提及」与「原文反驳」，混淆时点名（AC-R4）；
 * 3. `explanation_zh` 受 `settings.show_chinese_hints` 门控，隐藏时也要说明为什么没有（FR-C）。
 */
import { fireEvent, render, screen, within } from '../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import type { ReadingObjectiveReport } from '../../types/ielts';
import ReadingReview from './ReadingReview';
import { FIXTURE_READING_SET, FIXTURE_REPORT } from './testFixtures';

function renderReview(
  overrides: Partial<ReadingObjectiveReport> = {},
  props: { showChineseHints?: boolean; onLocate?: (label: string | null | undefined) => void } = {},
) {
  const onLocate = props.onLocate ?? vi.fn();
  render(
    <ReadingReview
      set={FIXTURE_READING_SET}
      report={{ ...FIXTURE_REPORT, ...overrides }}
      showChineseHints={props.showChineseHints ?? true}
      onLocate={onLocate}
    />,
  );
  return { onLocate };
}

describe('成绩卡', () => {
  it('band + 正确题数 + 正确率一起给出（AC-R4 的「分数档与逐题解析」）', () => {
    renderReview();
    expect(screen.getByText('本组成绩')).toBeInTheDocument();
    expect(screen.getByText('8/13')).toBeInTheDocument();
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText('唱得更响：城市噪音如何改变鸟鸣 · 阅读 13 题制')).toBeInTheDocument();
    expect(screen.getByText('正常提交')).toBeInTheDocument();
  });

  it('band 用 §3-B 定稿的 READING_13 锚点：8/13 → 6.0（不是 20 题制那套）', () => {
    renderReview();
    expect(screen.getByText('6.0')).toBeInTheDocument();
    expect(screen.getByText('阅读 13 题制对照表（§3-B）')).toBeInTheDocument();
  });

  it('到时自动提交要显式标出来，不能假装是正常交卷', () => {
    renderReview({ timed_out: true });
    expect(screen.getByText('到时自动提交')).toBeInTheDocument();
  });

  it('accuracy 缺失时按 raw_correct/raw_total 兜底', () => {
    renderReview({ accuracy: Number.NaN });
    expect(screen.getByText('62')).toBeInTheDocument();
  });
});

describe('分题型正确率', () => {
  it('五种题型的条都在，且带 correct/total 文本', () => {
    renderReview();
    const card = screen.getByText('按题型正确率').closest('section') as HTMLElement;
    expect(within(card).getByText('判断题（TRUE/FALSE/NOT GIVEN）')).toBeInTheDocument();
    expect(within(card).getByText('段落标题匹配')).toBeInTheDocument();
    expect(within(card).getByText('2/5（40%）')).toBeInTheDocument();
    expect(within(card).getByText('4/4（100%）')).toBeInTheDocument();
    expect(within(card).getByText('0/2（0%）')).toBeInTheDocument();
  });
});

describe('逐题解析', () => {
  it('每题一行，含你的作答与正确答案', () => {
    renderReview();
    expect(document.querySelectorAll('[data-review-item]')).toHaveLength(13);
    const q1 = document.querySelector('[data-review-item="q1"]') as HTMLElement;
    // 你的作答那一格（带内联判分色）
    expect(within(q1).getByText('TRUE', { selector: 'span[style]' })).toBeInTheDocument();
    expect(within(q1).getByText(/正确答案/)).toHaveTextContent('TRUE');
    expect(within(q1).getByText('正确')).toBeInTheDocument();
  });

  it('未作答显示「未作答」而不是空白，并给出 reason=unanswered 的中文', () => {
    renderReview();
    const q5 = document.querySelector('[data-review-item="q5"]') as HTMLElement;
    expect(within(q5).getByText('未作答')).toBeInTheDocument();
    expect(within(q5).getByText(/判分原因：未作答/)).toBeInTheDocument();
  });

  it('超字限与拼写变体各有专属原因文案（§3-OR 的 reason 枚举）', () => {
    renderReview();
    expect(document.querySelector('[data-review-item="q10"]')).toHaveTextContent('判分原因：超出字数上限');
    expect(document.querySelector('[data-review-item="q11"]')).toHaveTextContent('判分原因：拼写变体未被接受');
    expect(document.querySelector('[data-review-item="q11"]')).toHaveTextContent('也可接受：a rubberised');
  });

  it('AC-R4：NOT GIVEN ＝ 未提及，FALSE ＝ 原文反驳，两者都给判别语', () => {
    renderReview();
    const q3 = document.querySelector('[data-review-item="q3"]') as HTMLElement;
    const q4 = document.querySelector('[data-review-item="q4"]') as HTMLElement;
    const q3Line = q3.querySelector('[data-tfng-distinction="true"]');
    const q4Line = q4.querySelector('[data-tfng-distinction="true"]');
    expect(q3Line?.textContent).toContain('FALSE ＝ 原文与该说法矛盾');
    expect(q4Line?.textContent).toContain('NOT GIVEN ＝ 原文未提及该信息');
    // 答对的 TRUE 题也给判别语（规则本身与对错无关）
    const q1 = document.querySelector('[data-review-item="q1"]') as HTMLElement;
    expect(q1.querySelector('[data-tfng-distinction="true"]')?.textContent).toContain('TRUE ＝ 原文正面支持');
  });

  it('AC-R4：把「未提及」和「反驳」选反时点名混淆方向', () => {
    renderReview();
    const q3 = document.querySelector('[data-review-item="q3"]') as HTMLElement;
    const q4 = document.querySelector('[data-review-item="q4"]') as HTMLElement;
    // 你选 NOTGIVEN、应为 FALSE → 把「反驳」当成了「未提及」
    expect(q3.querySelector('[data-tfng-confusion="true"]')?.textContent).toContain(
      '你把「原文反驳」当成了「未提及」',
    );
    // 你选 FALSE、应为 NOTGIVEN → 把「未提及」当成了「反驳」
    expect(q4.querySelector('[data-tfng-confusion="true"]')?.textContent).toContain(
      '你把「未提及」当成了「原文反驳」',
    );
  });

  it('答对的判断题不出现混淆提示（只有真错才点名）', () => {
    renderReview();
    const q1 = document.querySelector('[data-review-item="q1"]') as HTMLElement;
    expect(q1.querySelector('[data-tfng-confusion="true"]')).toBeNull();
  });

  it('answer_quote 带段落号，点击「定位到原文」回传该段落（§3-OR 跳转）', () => {
    const { onLocate } = renderReview();
    const q2 = document.querySelector('[data-review-item="q2"]') as HTMLElement;
    const quote = q2.querySelector('blockquote');
    expect(quote?.textContent).toContain('段落 B：');
    expect(quote?.textContent).toContain('pitch rises up the page and time runs across it');
    fireEvent.click(within(q2).getByRole('button', { name: '定位第 2 题原文' }));
    expect(onLocate).toHaveBeenCalledWith('B');
  });

  it('没有 answer_paragraph 的题不给跳转按钮', () => {
    const report: ReadingObjectiveReport = {
      ...FIXTURE_REPORT,
      items: [{ id: 'qx', number: 1, type: 'gap_fill', your_answer: 'x', expected: 'y', correct: false, reason: 'wrong' }],
    };
    renderReview(report, {});
    expect(screen.queryByRole('button', { name: '定位第 1 题原文' })).not.toBeInTheDocument();
  });

  it('中文解析按设置显示', () => {
    renderReview();
    expect(screen.getByText('原文 A 段说明交通噪音在低频最厚。')).toBeInTheDocument();
  });

  it('设置关闭中文解析时隐藏正文，但说明去哪开（FR-C）', () => {
    renderReview({}, { showChineseHints: false });
    expect(screen.queryByText('原文 A 段说明交通噪音在低频最厚。')).not.toBeInTheDocument();
    expect(screen.getAllByText(/中文解析已按设置隐藏/).length).toBeGreaterThan(0);
  });

  it('再做一组走 onExit', () => {
    const onExit = vi.fn();
    render(
      <ReadingReview
        set={FIXTURE_READING_SET}
        report={FIXTURE_REPORT}
        showChineseHints
        onLocate={() => {}}
        onExit={onExit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '再做一组' }));
    expect(onExit).toHaveBeenCalled();
  });
});
