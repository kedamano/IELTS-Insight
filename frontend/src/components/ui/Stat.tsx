import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import { TONE_VAR, type Tone } from './tokens';

export type StatProps = {
  label: ReactNode;
  value: ReactNode;
  /** 单位后缀，如 分钟 / band */
  unit?: ReactNode;
  hint?: ReactNode;
  tone?: Tone | 'accent' | 'default';
  /** 大数字：band、倒计时、字数走 --font-mono（§8 排版规则） */
  mono?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** `hero` = 放在渐变 hero 面上，文字改用 hero 墨色（否则深色底上不可读） */
  surface?: 'default' | 'hero';
  className?: string;
};

const VALUE_SIZE: Record<NonNullable<StatProps['size']>, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
};

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'default',
  mono = true,
  size = 'md',
  surface = 'default',
  className,
}: StatProps) {
  const hero = surface === 'hero';
  const color: CSSProperties | undefined =
    tone === 'accent'
      ? { color: hero ? undefined : 'var(--accent)' }
      : tone === 'default'
        ? undefined
        : { color: TONE_VAR[tone] };

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <span className={cx('text-xs', hero ? 'text-hero-ink-muted' : 'text-ink-muted')}>{label}</span>
      <span className="flex items-baseline gap-1">
        <span
          style={color}
          className={cx(
            'leading-none',
            hero ? 'text-hero-ink' : 'text-ink',
            mono && 'font-code',
            VALUE_SIZE[size],
          )}
        >
          {value}
        </span>
        {unit != null ? (
          <span className={cx('text-xs', hero ? 'text-hero-ink-muted' : 'text-ink-secondary')}>{unit}</span>
        ) : null}
      </span>
      {hint != null ? (
        <span className={cx('text-xs', hero ? 'text-hero-ink-muted' : 'text-ink-secondary')}>{hint}</span>
      ) : null}
    </div>
  );
}

export default Stat;
