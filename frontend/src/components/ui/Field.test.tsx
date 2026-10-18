import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Field } from './Field';

describe('Field', () => {
  it('label 与控件通过 htmlFor/id 关联', () => {
    render(
      <Field label="目标 band" htmlFor="target-band" hint="0–9，步长 0.5">
        <input id="target-band" />
      </Field>,
    );
    expect(screen.getByLabelText('目标 band')).toHaveAttribute('id', 'target-band');
  });

  it('children 函数形式自动注入 aria 属性', () => {
    render(
      <Field label="考试日期" htmlFor="exam-date" hint="格式 YYYY-MM-DD">
        {(aria) => <input {...aria} />}
      </Field>,
    );
    const input = screen.getByLabelText('考试日期');
    expect(input).toHaveAttribute('id', 'exam-date');
    expect(input).toHaveAttribute('aria-describedby', screen.getByText('格式 YYYY-MM-DD').id);
  });

  it('error 时控件 aria-invalid，且错误文本可被朗读', () => {
    render(
      <Field label="考试日期" htmlFor="exam-date" error="日期需晚于今天">
        {(aria) => <input {...aria} />}
      </Field>,
    );
    const input = screen.getByLabelText('考试日期');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('日期需晚于今天');
    expect(input.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
  });

  it('无 error 时不带 aria-invalid', () => {
    render(
      <Field label="每日目标" htmlFor="goal" hint="分钟">
        {(aria) => <input {...aria} />}
      </Field>,
    );
    expect(screen.getByLabelText('每日目标')).not.toHaveAttribute('aria-invalid');
  });

  it('required 显示必填标记并把控件置为必填', () => {
    render(
      <Field label="考试日期" htmlFor="exam-date" required>
        {(aria) => <input {...aria} />}
      </Field>,
    );
    expect(screen.getByLabelText('考试日期')).toBeRequired();
    expect(screen.getByLabelText(/考试日期/)).toBeInTheDocument();
  });

  it('必填标记不污染无障碍名，键盘可正常输入', async () => {
    const user = userEvent.setup();
    const onType = vi.fn();
    render(
      <Field label="AI 模型名" htmlFor="model" required>
        {(aria) => <input {...aria} onChange={onType} />}
      </Field>,
    );
    const input = screen.getByLabelText('AI 模型名');
    await user.type(input, 'glm-4.6');
    expect(onType).toHaveBeenCalled();
    expect(input).toHaveValue('glm-4.6');
  });
});
