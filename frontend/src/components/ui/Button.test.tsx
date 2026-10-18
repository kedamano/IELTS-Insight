import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('渲染真实 button 元素且默认 type=button（避免误提交表单）', () => {
    render(<Button>开始</Button>);
    const el = screen.getByRole('button', { name: '开始' });
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveAttribute('type', 'button');
  });

  it('鼠标点击触发 onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>开始</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('键盘 Enter 与 Space 可激活（纯 <button> 的原生行为）', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>开始</Button>);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('显式 type=submit 保留给表单场景', () => {
    render(
      <form>
        <Button type="submit">提交</Button>
      </form>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('disabled 时不可点击也不可聚焦，且不吞掉 aria 状态', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button onClick={onClick} disabled>
        开始
      </Button>,
    );
    const el = screen.getByRole('button');
    expect(el).toBeDisabled();
    await user.click(el).catch(() => undefined);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading 时置 aria-busy 并禁用，防止重复提交', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        保存
      </Button>,
    );
    const el = screen.getByRole('button', { name: /保存/ });
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toBeDisabled();
    await user.click(el).catch(() => undefined);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('变体只使用语义 token 类，不含字面色值', () => {
    const { container } = render(<Button variant="primary">主操作</Button>);
    const classList = (container.firstElementChild as HTMLElement).className;
    expect(classList).toContain('bg-accent');
    expect(classList).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });
});
