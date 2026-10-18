/**
 * 五类阅读题型的作答控件（FR-R1）。
 *
 * 取值必须与后端 `answer_norm.judge_choice` 对齐，否则「显示了但对不上」：
 * TFNG 用 TRUE/FALSE/NOTGIVEN、heading 用罗马数字本身、MC 用前缀字母。
 */
import { fireEvent, render, screen } from '../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import type { ReadingQuestionPublic } from '../../types/ielts';
import QuestionInput, { optionBody, optionLetter } from './QuestionInput';
import { FIXTURE_READING_SET } from './testFixtures';

const QUESTIONS = FIXTURE_READING_SET.questions;

function question(id: string): ReadingQuestionPublic {
  const found = QUESTIONS.find((item) => item.id === id);
  if (!found) throw new Error(`夹具缺少题目 ${id}`);
  return found;
}

describe('选项字母归一', () => {
  it('带前缀就用前缀，没带就按序号补', () => {
    expect(optionLetter('A. They must replace private cars to work.', 0)).toBe('A');
    expect(optionLetter('c) cheap', 2)).toBe('C');
    expect(optionLetter('They are inexpensive.', 1)).toBe('B');
  });

  it('正文去掉前缀，避免屏幕上出现两个字母', () => {
    expect(optionBody('B. They are inexpensive but limited.', 1)).toBe('They are inexpensive but limited.');
  });
});

describe('true_false_notgiven', () => {
  it('三段式单选：中文判别语挂在 title 上，术语保留英文（FR-G4）', () => {
    const onChange = vi.fn();
    render(<QuestionInput question={question('q1')} value="" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: '第 1 题判断' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);

    fireEvent.click(screen.getByRole('radio', { name: /NOTGIVEN/ }));
    expect(onChange).toHaveBeenCalledWith('NOTGIVEN');
  });

  it('已选中的 radio 报 aria-checked，并能清除作答', () => {
    const onChange = vi.fn();
    render(<QuestionInput question={question('q1')} value="FALSE" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: /FALSE/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /TRUE/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('heading_match', () => {
  it('下拉取值为罗马数字本身，且提示选项可重复使用（FR-R4）', () => {
    const onChange = vi.fn();
    render(<QuestionInput question={question('q6')} value="" onChange={onChange} />);
    const select = screen.getByLabelText('第 6 题标题选项');
    fireEvent.change(select, { target: { value: 'iv' } });
    expect(onChange).toHaveBeenCalledWith('iv');
    expect(screen.getByText(/可重复选用/)).toBeInTheDocument();
    expect(screen.getByText('B', { selector: '.text-accent' })).toBeInTheDocument();
  });

  it('选项不会被「已用即禁用」（标题可重复选）', () => {
    render(<QuestionInput question={question('q7')} value="i" onChange={() => {}} />);
    const disabled = Array.from(screen.getByLabelText('第 7 题标题选项').querySelectorAll('option')).filter(
      (option) => option.disabled,
    );
    expect(disabled).toHaveLength(0);
  });
});

describe('multiple_choice', () => {
  it('提交前缀字母 A/B/C，显示完整文本', () => {
    const onChange = vi.fn();
    render(<QuestionInput question={question('q13')} value="B" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: '第 13 题选择' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^B\./ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /^A\./ }));
    expect(onChange).toHaveBeenCalledWith('A');
  });
});

describe('sentence_completion / gap_fill', () => {
  it('复用 GapInput：显示词上限与计数', () => {
    render(<QuestionInput question={question('q10')} value="metres" onChange={() => {}} />);
    expect(screen.getByLabelText('第 10 题答案')).toHaveValue('metres');
    expect(screen.getByText('1/2 词')).toBeInTheDocument();
  });

  it('gap_fill 走同一控件（q12 限 1 词）', () => {
    render(<QuestionInput question={question('q12')} value="" onChange={() => {}} />);
    expect(screen.getByText('最多 1 词（NO MORE THAN 1 WORDS AND/OR A NUMBER）')).toBeInTheDocument();
  });
});

describe('未知题型', () => {
  it('不静默吞掉，明确显示暂不支持（CONSTITUTION §3）', () => {
    const weird = { id: 'q_x', type: 'matching', number: 99, prompt: 'x', options_list: ['a'] } as unknown as ReadingQuestionPublic;
    render(<QuestionInput question={weird} value="" onChange={() => {}} />);
    expect(screen.getByText(/暂不支持的题型/)).toBeInTheDocument();
  });
});
