/**
 * 填空/句子完成的字数提醒（FR-R1 + §3-OR 的 over_word_limit）。
 *
 * 前端只提醒不阻断：判分权在后端（`answer_norm`），但考生必须看得见「会判超限」。
 */
import { fireEvent, render, screen } from '../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import GapInput, { countWords } from './GapInput';

describe('countWords', () => {
  it('按空白切词，与雅思「ONE WORD AND/OR A NUMBER」口径一致', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('rubberised')).toBe(1);
    expect(countWords('a rubberised')).toBe(2);
    expect(countWords('  350   metres ')).toBe(2);
  });
});

describe('GapInput', () => {
  it('显示官方字数上限提示与实时计数', () => {
    render(<GapInput number={10} questionId="q10" value="a rubberised" onChange={() => {}} wordLimit={2} />);
    expect(screen.getByText('最多 2 词（NO MORE THAN 2 WORDS AND/OR A NUMBER）')).toBeInTheDocument();
    expect(screen.getByText('2/2 词')).toBeInTheDocument();
    expect(screen.getByLabelText('第 10 题答案')).toHaveAttribute('autocomplete', 'off');
  });

  it('没有 word_limit 时提示不限字数，仍显示词数', () => {
    render(<GapInput number={12} questionId="q12" value="carry" onChange={() => {}} />);
    expect(screen.getByText('不限字数')).toBeInTheDocument();
    expect(screen.getByText('1 词')).toBeInTheDocument();
  });

  it('超限：标记 data-over、aria-invalid 并说明判分后果（不阻断输入）', () => {
    const onChange = vi.fn();
    render(<GapInput number={10} questionId="q10" value="hundreds of metres extra" onChange={onChange} wordLimit={2} />);
    const input = screen.getByLabelText('第 10 题答案');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'gap-hint-q10');
    expect(screen.getByText('4/2 词')).toHaveAttribute('data-over', 'true');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('over_word_limit');
    expect(status).toHaveTextContent('超出字数上限');

    // 仍可继续输入（判分在后端，前端不吞键）
    fireEvent.change(input, { target: { value: 'metres' } });
    expect(onChange).toHaveBeenCalledWith('metres');
  });

  it('未超限时不出现判分警告', () => {
    render(<GapInput number={11} questionId="q11" value="metres" onChange={() => {}} wordLimit={2} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('1/2 词')).toHaveAttribute('data-over', 'false');
  });

  it('禁用态透传（提交中不可改答案）', () => {
    render(<GapInput number={10} questionId="q10" value="" onChange={() => {}} disabled />);
    expect(screen.getByLabelText('第 10 题答案')).toBeDisabled();
  });
});
