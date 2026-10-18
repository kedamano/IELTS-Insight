import { cx } from './cx';
import { TONE_LABEL_ZH, TONE_VAR, bandTone, formatBand } from './tokens';

export type ScoreBandProps = {
  /** 0–9、0.5 步长；null / undefined / NaN 一律渲染「尚无数据」（AC-G5） */
  band: number | null | undefined;
  label?: string;
  /** 与上次相比的变化（单位同为 band），仅作辅助小字 */
  delta?: number | null;
  /** 0–9 语义色条 */
  showAxis?: boolean;
  size?: 'sm' | 'md' | 'lg';
  hint?: string;
  className?: string;
};

const VALUE_SIZE: Record<NonNullable<ScoreBandProps['size']>, string> = {
  sm: 'text-lg',
  md: 'text-3xl',
  lg: 'text-5xl',
};

/** band 主视觉：大号等宽数字 + 三档语义色条（≥7 / 5.5–6.5 / ≤5） */
export function ScoreBand({
  band,
  label = 'Band',
  delta = null,
  showAxis = true,
  size = 'md',
  hint,
  className,
}: ScoreBandProps) {
  const tone = bandTone(band);

  if (tone === null) {
    return (
      <div
        data-band-tone="none"
        className={cx('flex flex-col gap-1', className)}
      >
        <span className="text-xs text-ink-muted">{label}</span>
        <span className="font-code text-sm text-ink-muted">尚无数据</span>
      </div>
    );
  }

  const safeBand = Math.min(9, Math.max(0, band as number));
  const color = TONE_VAR[tone];
  const deltaValue = delta == null || !Number.isFinite(delta) || delta === 0 ? null : delta;
  const deltaText =
    deltaValue == null ? null : `${deltaValue > 0 ? '+' : '−'}${formatBand(Math.abs(deltaValue))}`;
  const deltaColor = deltaValue != null && deltaValue > 0 ? TONE_VAR.good : TONE_VAR.poor;

  return (
    <div data-band-tone={tone} className={cx('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-ink-muted">{label}</span>
        <span className="sr-only">{TONE_LABEL_ZH[tone]}</span>
        <span
          style={{ color }}
          className={cx('font-code leading-none', VALUE_SIZE[size])}
        >
          {formatBand(safeBand)}
        </span>
        {deltaText != null ? (
          <span
            className="font-code text-xs"
            style={{ color: deltaColor }}
          >
            {deltaText}
          </span>
        ) : null}
      </div>

      {showAxis ? (
        <div
          aria-hidden="true"
          className="relative h-1.5 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: 'var(--rule)' }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${(safeBand / 9) * 100}%`, backgroundColor: color }}
          />
          {/* 5.5 与 7.0 两条档位分界（与三档规则一致） */}
          {[5.5 / 9, 7 / 9].map((tick) => (
            <div
              key={tick}
              className="absolute inset-y-0 w-px"
              style={{ left: `${tick * 100}%`, backgroundColor: 'var(--paper)' }}
            />
          ))}
        </div>
      ) : null}

      {hint != null ? <span className="text-xs text-ink-secondary">{hint}</span> : null}
    </div>
  );
}

export default ScoreBand;
