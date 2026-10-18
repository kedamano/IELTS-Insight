import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import { TONE_VAR, type Tone } from './tokens';

export type BadgeTone = 'neutral' | 'accent' | Tone;
export type BadgeVariant = 'soft' | 'outline';

export type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  /** 前置色点，用于图例/状态 */
  dot?: boolean;
  className?: string;
  title?: string;
};

const TEXT_TONE: Record<BadgeTone, string> = {
  neutral: 'text-ink-secondary',
  accent: 'text-accent',
  good: 'text-band-good',
  mid: 'text-band-mid',
  poor: 'text-band-poor',
};

/** 纯语义标签（题型、状态、degraded_reason）；不含任何锁定/付费含义（AC-X2） */
export function Badge({ children, tone = 'neutral', variant = 'soft', dot, className, title }: BadgeProps) {
  const color: CSSProperties =
    tone === 'neutral' || tone === 'accent' ? {} : { color: TONE_VAR[tone] };
  return (
    <span
      title={title}
      style={variant === 'outline' ? color : undefined}
      className={cx(
        'inline-flex items-center gap-1 rounded-card px-1.5 py-0.5 text-xs font-medium leading-4',
        variant === 'soft' && cx('bg-paper-sunken', TEXT_TONE[tone]),
        variant === 'outline' && 'border border-rule bg-transparent',
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: tone === 'neutral' ? 'var(--ink-muted)' : tone === 'accent' ? 'var(--accent)' : TONE_VAR[tone] }}
        />
      ) : null}
      {children}
    </span>
  );
}

export default Badge;
