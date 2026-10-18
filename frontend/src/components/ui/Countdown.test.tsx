import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Countdown } from './Countdown';

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('按秒递减并显示 m:ss', () => {
    render(<Countdown seconds={125} />);
    expect(screen.getByRole('timer')).toHaveTextContent('2:05');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('2:00');
  });

  it('到点时 onExpire 只触发一次', () => {
    const onExpire = vi.fn();
    render(<Countdown seconds={3} onExpire={onExpire} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('到点后进入「已用时」状态且不再走表（AC-S2）', () => {
    const onExpire = vi.fn();
    render(<Countdown seconds={120} onExpire={onExpire} />);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('已用时 2:00');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('running=false 时不计时', () => {
    const onExpire = vi.fn();
    render(<Countdown seconds={2} running={false} onExpire={onExpire} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onExpire).not.toHaveBeenCalled();
    expect(screen.getByRole('timer')).toHaveTextContent('0:02');
  });

  it('剩余 ≤ warnAt 时切到提醒色（AC-R3）', () => {
    render(<Countdown seconds={200} warnAt={180} />);
    const timer = screen.getByRole('timer');
    expect(timer.getAttribute('data-warned')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(timer.getAttribute('data-warned')).toBe('true');
    expect(timer.getAttribute('style') ?? '').toContain('var(--band-poor)');
  });

  it('seconds 变化视为新一轮计时', () => {
    const onExpire = vi.fn();
    const { rerender } = render(<Countdown seconds={1} onExpire={onExpire} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);

    rerender(<Countdown seconds={2} onExpire={onExpire} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onExpire).toHaveBeenCalledTimes(2);
  });
});
