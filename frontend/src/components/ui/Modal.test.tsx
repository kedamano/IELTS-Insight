import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function Harness({ onEscape }: { onEscape?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      {onEscape != null ? (
        <Modal open onClose={onEscape} title="确认删除" description="该练习记录会被移除并重算趋势">
          <button type="button">确定</button>
        </Modal>
      ) : (
        <Modal open={open} onClose={() => setOpen(false)} title="确认删除" description="该练习记录会被移除并重算趋势">
          <button type="button">确定</button>
          <button type="button">稍后再说</button>
        </Modal>
      )}
    </>
  );
}

describe('Modal', () => {
  it('未打开时不渲染任何对话框', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('打开后聚焦落在对话框内，并提供 aria-modal 与标题关联', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '打开' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAccessibleName('确认删除');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape 关闭对话框', async () => {
    const onClose = vi.fn();
    render(<Harness onEscape={onClose} />);
    const dialog = screen.getByRole('dialog');
    dialog.focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab 在对话框内循环，不会跑到背景内容', async () => {
    const onClose = vi.fn();
    render(<Harness onEscape={onClose} />);
    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: '关闭' });
    const inside = screen.getByRole('button', { name: '确定' });

    closeBtn.focus();
    await userEvent.tab();
    expect(inside).toHaveFocus();

    // 从最后一个可聚焦元素继续 Tab 回到第一个
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(closeBtn);
  });

  it('关闭后焦点还原到触发按钮', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('点击遮罩关闭，点击面板内部不关闭', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onEscape={onClose} />);
    await user.click(screen.getByRole('button', { name: '确定' }));
    expect(onClose).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    const scrim = dialog.parentElement as HTMLElement;
    await user.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
