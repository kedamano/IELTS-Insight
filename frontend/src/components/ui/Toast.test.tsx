import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

describe('Toast', () => {
  it('默认走 polite 状态播报，不打断屏幕阅读器', () => {
    render(<Toast>已加入生词本</Toast>);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('已加入生词本');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('danger 用 role=alert 立即播报（CONSTITUTION §3 失败可见）', () => {
    render(<Toast tone="danger">音频不可用，可看原文精读模式</Toast>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent('音频不可用');
  });

  it('左侧色条只用语义变量', () => {
    const { container } = render(<Toast tone="warn">离线近似分</Toast>);
    const style = (container.firstElementChild as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain('var(--band-mid)');
    expect(style).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('提供关闭按钮时点击回调 onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Toast tone="info" onDismiss={onDismiss}>
        草稿已恢复
      </Toast>,
    );
    await user.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('onDismiss 可挂在操作区（如「重试」）', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <Toast tone="danger" action={<button type="button" onClick={onRetry}>重试</button>}>
        后端无响应
      </Toast>,
    );
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  describe('自动消失', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('普通提示按 autoDismissMs 关闭', () => {
      const onDismiss = vi.fn();
      render(
        <Toast onDismiss={onDismiss} autoDismissMs={1000}>
          已保存
        </Toast>,
      );
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('danger 默认不自动消失，避免吞掉失败信息', () => {
      const onDismiss = vi.fn();
      render(
        <Toast tone="danger" onDismiss={onDismiss}>
          评分失败
        </Toast>,
      );
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('卸载时清理定时器', () => {
      const onDismiss = vi.fn();
      const { unmount } = render(
        <Toast onDismiss={onDismiss} autoDismissMs={1000}>
          已保存
        </Toast>,
      );
      unmount();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(onDismiss).not.toHaveBeenCalled();
    });
  });
});
