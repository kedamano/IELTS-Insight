/**
 * 阅读计时条（FR-R3 / AC-R3）。
 *
 * 计时状态一律来自 `hooks/useTimer`（本文件只负责显示与阈值配色，便于单测「剩 3 分钟变红」）：
 * `--band-poor` 只在 `remainingSec <= 180` 或到点后使用，字号与配色遵循契约 §8（大号 `--font-mono`）。
 */
import { cx, type Tone } from '../../components/ui';
import { TONE_VAR } from '../../components/ui/tokens';
import { formatClock } from '../../hooks/useTimer';

/** AC-R3：剩 3 分钟变红提醒。 */
export const TIMER_WARN_SEC = 180;

export type TimerTone = Tone | 'normal';

/**
 * 纯函数：剩余秒数 → 语义色。
 * 阈值**含等于**（便于测试 180/179/181）；`warnAtSec` 可被调用方覆盖，
 * 但红线以上的「黄档」始终是红线的两倍，保证同一套比例。
 */
export function timerTone(remainingSec: number, expired = false, warnAtSec: number = TIMER_WARN_SEC): TimerTone {
  if (expired) return 'poor';
  if (remainingSec <= warnAtSec) return 'poor';
  if (remainingSec <= warnAtSec * 2) return 'mid';
  return 'normal';
}

export type TimerProps = {
  /** `useTimer().remainingSec`。 */
  remainingSec: number;
  expired?: boolean;
  running?: boolean;
  label?: string;
  /** 覆盖阈值（默认 180s，AC-R3）。 */
  warnAtSec?: number;
  className?: string;
};

const TONE_TEXT_ZH: Record<TimerTone, string> = {
  good: '时间充裕',
  mid: '剩时不多',
  poor: '时间紧迫',
  normal: '正常计时',
};

export function Timer({
  remainingSec,
  expired = false,
  running = true,
  label = '剩余时间',
  warnAtSec = TIMER_WARN_SEC,
  className,
}: TimerProps) {
  const warned = expired || remainingSec <= warnAtSec;
  const tone = timerTone(remainingSec, expired, warnAtSec);
  const color = tone === 'normal' ? 'var(--ink)' : TONE_VAR[tone];

  return (
    <div
      className={cx('flex items-baseline gap-2', className)}
      data-warned={warned ? 'true' : 'false'}
      data-running={running ? 'true' : 'false'}
    >
      <span className="text-xs text-ink-muted">{label}</span>
      <span
        role="timer"
        aria-live={warned ? 'assertive' : 'off'}
        aria-label={`${label} ${expired ? '已用完' : formatClock(remainingSec)}，${TONE_TEXT_ZH[tone]}`}
        style={{ color }}
        className={cx('font-code text-2xl leading-none tabular-nums', expired && 'line-through')}
      >
        {expired ? '时间到' : formatClock(Math.max(0, remainingSec))}
      </span>
      {warned ? (
        <span className="text-xs font-medium" style={{ color: TONE_VAR.poor }}>
          {expired ? '已自动提交' : `剩 ${Math.max(1, Math.round(warnAtSec / 60))} 分钟内`}
        </span>
      ) : null}
    </div>
  );
}

export default Timer;
