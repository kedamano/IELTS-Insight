import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { formatSeconds } from './tokens';

export type CountdownProps = {
  /** 总时长（秒）；变化时重新计时（Part 2 的 60s 准备 / 120s 独白） */
  seconds: number;
  running?: boolean;
  /** 到点回调，保证只触发一次 */
  onExpire?: () => void;
  /** 每秒回调当前剩余秒数 */
  onChange?: (remainingSec: number) => void;
  /** 剩余秒数 ≤ warnAt 时转为提醒色（AC-R3 剩 3 分钟变红） */
  warnAt?: number;
  label?: ReactNode;
  /** 到点后的显示文案；默认「已用时 m:ss」（AC-S2） */
  expireText?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const SIZE: Record<NonNullable<CountdownProps['size']>, string> = {
  sm: 'text-sm',
  md: 'text-xl',
  lg: 'text-3xl',
};

export function Countdown({
  seconds,
  running = true,
  onExpire,
  onChange,
  warnAt = 180,
  label,
  expireText,
  size = 'md',
  className,
}: CountdownProps) {
  const initial = Math.max(0, Math.floor(seconds));
  const [remaining, setRemaining] = useState(initial);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onExpireRef.current = onExpire;
    onChangeRef.current = onChange;
  }, [onExpire, onChange]);

  // 计时目标变化 = 新一轮计时，允许再次过期
  useEffect(() => {
    expiredRef.current = false;
    setRemaining(Math.max(0, Math.floor(seconds)));
  }, [seconds]);

  useEffect(() => {
    if (!running || expiredRef.current) return;
    const id = window.setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, seconds]);

  useEffect(() => {
    if (remaining === 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpireRef.current?.();
    }
    onChangeRef.current?.(remaining);
  }, [remaining]);

  const expired = remaining === 0;
  const warned = !expired && remaining <= warnAt;
  const color = expired ? 'var(--ink-muted)' : warned ? 'var(--band-poor)' : 'var(--ink)';
  const text = expired ? (expireText ?? `已用时 ${formatSeconds(initial)}`) : formatSeconds(remaining);

  return (
    <div className={cx('flex items-baseline gap-2', className)}>
      {label != null ? <span className="text-xs text-ink-muted">{label}</span> : null}
      <span
        role="timer"
        aria-live={warned || expired ? 'assertive' : 'off'}
        data-expired={expired}
        data-warned={warned}
        style={{ color }}
        className={cx('font-code leading-none tabular-nums', SIZE[size])}
      >
        {text}
      </span>
    </div>
  );
}

export default Countdown;
