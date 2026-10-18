import { cx } from './cx';
import { TONE_VAR, type Tone } from './tokens';

export type BarProps = {
  value: number;
  max?: number;
  /** 'accent' 用于进度类；Tone 用于正确率/分数类 */
  tone?: Tone | 'accent';
  /** 左侧说明 */
  label?: string;
  /** 右侧读数，默认百分比；0–9 分数请由调用方传 band 文本 */
  valueLabel?: string;
  height?: number;
  role?: 'progressbar' | 'meter';
  className?: string;
};

/** 单值横向条形（正确率 / 今日任务进度）；纯 SVG，轴与轨道用 --rule，填充用语义变量 */
export function Bar({
  value,
  max = 100,
  tone = 'accent',
  label,
  valueLabel,
  height = 8,
  role = 'progressbar',
  className,
}: BarProps) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const percent = Math.round(ratio * 100);
  const fill = tone === 'accent' ? 'var(--accent)' : TONE_VAR[tone];
  const text = valueLabel ?? `${percent}%`;

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {label != null || valueLabel != null ? (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-ink-secondary">{label ?? ''}</span>
          <span className="font-code text-ink">{text}</span>
        </div>
      ) : null}
      <svg
        role={role}
        aria-label={label ? undefined : text}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={Math.min(Math.max(value, 0), safeMax)}
        aria-valuetext={text}
        width="100%"
        height={height}
        preserveAspectRatio="none"
      >
        <rect x="0" y="0" width="100%" height={height} fill="var(--rule)" rx={height / 2} />
        <rect
          x="0"
          y="0"
          width={`${percent}%`}
          height={height}
          fill={fill}
          rx={height / 2}
        />
      </svg>
    </div>
  );
}

export default Bar;
