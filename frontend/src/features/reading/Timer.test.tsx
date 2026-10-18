/**
 * 计时条单测（AC-R3 的「剩 3 分钟变红」阈值 + 到点文案）。
 *
 * 计时本身由 `hooks/useTimer` 负责（那里已测无漂移），这里只锁显示层：
 * 180 秒是**含等于**的红线，到点后显示「时间到」并转为 `--band-poor`。
 */
import { render, screen } from '../../test/testUtils';
import { describe, expect, it } from 'vitest';
import Timer, { TIMER_WARN_SEC, timerTone } from './Timer';

function styleOf(element: HTMLElement): string {
  return element.getAttribute('style') ?? '';
}

describe('timerTone', () => {
  it('红线含等于：180 与 179 都是 poor，181 才升档', () => {
    expect(TIMER_WARN_SEC).toBe(180);
    expect(timerTone(181)).toBe('mid');
    expect(timerTone(180)).toBe('poor');
    expect(timerTone(179)).toBe('poor');
    expect(timerTone(0)).toBe('poor');
  });

  it('360 以上正常，到点一律 poor', () => {
    expect(timerTone(361)).toBe('normal');
    expect(timerTone(360)).toBe('mid');
    expect(timerTone(1200)).toBe('normal');
    expect(timerTone(1200, true)).toBe('poor');
  });

  it('warnAtSec 覆盖后比例仍然一致（黄档 = 红线两倍）', () => {
    expect(timerTone(200, false, 60)).toBe('normal');
    expect(timerTone(120, false, 60)).toBe('mid');
    expect(timerTone(60, false, 60)).toBe('poor');
  });
});

describe('Timer', () => {
  it('剩余时间用 role=timer + 等宽 m:ss 显示', () => {
    render(<Timer remainingSec={1200} running />);
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent('20:00');
    expect(styleOf(timer)).toContain('var(--ink)');
    expect(timer.closest('[data-warned="false"]')).not.toBeNull();
    expect(timer.closest('[data-running="true"]')).not.toBeNull();
  });

  it('剩 180 秒即转 --band-poor 并给出提醒文案（AC-R3）', () => {
    render(<Timer remainingSec={TIMER_WARN_SEC} running />);
    const timer = screen.getByRole('timer');
    expect(styleOf(timer)).toContain('var(--band-poor)');
    expect(timer.closest('[data-warned="true"]')).not.toBeNull();
    expect(screen.getByText('剩 3 分钟内')).toBeInTheDocument();
    expect(timer).toHaveAttribute('aria-live', 'assertive');
  });

  it('到点显示「时间到」，不再显示剩余秒数', () => {
    render(<Timer remainingSec={0} expired running={false} />);
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent('时间到');
    expect(styleOf(timer)).toContain('var(--band-poor)');
    expect(screen.getByText('已自动提交')).toBeInTheDocument();
    expect(timer.closest('[data-running="false"]')).not.toBeNull();
  });

  it('负数剩余不显示 -1:00 这种脏值', () => {
    render(<Timer remainingSec={-3} />);
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
  });

  it('warnAtSec 可覆盖阈值（供其它模块复用）', () => {
    const { unmount } = render(<Timer remainingSec={200} warnAtSec={60} />);
    expect(styleOf(screen.getByRole('timer'))).toContain('var(--ink)');
    expect(screen.queryByText(/分钟内/)).not.toBeInTheDocument();
    unmount();

    render(<Timer remainingSec={50} warnAtSec={60} />);
    expect(styleOf(screen.getByRole('timer'))).toContain('var(--band-poor)');
    expect(screen.getByText('剩 1 分钟内')).toBeInTheDocument();
  });
});
