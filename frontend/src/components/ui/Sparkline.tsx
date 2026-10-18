import { cx } from './cx';
import { TONE_VAR, type Tone } from './tokens';

export type SparklineProps = {
  /** 按时间顺序的数值序列（如某科最近 N 次 band） */
  points: ReadonlyArray<number>;
  width?: number;
  height?: number;
  tone?: Tone | 'accent';
  /** 默认自动取 [min,max]；band 趋势建议传 [0,9] */
  domain?: readonly [number, number];
  ariaLabel?: string;
  className?: string;
};

/** 迷你趋势线：概览页四科一行一条，纯 SVG 无图表库 */
export function Sparkline({
  points,
  width = 96,
  height = 24,
  tone = 'accent',
  domain,
  ariaLabel,
  className,
}: SparklineProps) {
  const clean = points.filter((p) => Number.isFinite(p));
  const stroke = tone === 'accent' ? 'var(--accent)' : TONE_VAR[tone];

  if (clean.length === 0) {
    return (
      <span className={cx('font-code text-xs text-ink-muted', className)} aria-hidden="true">
        —
      </span>
    );
  }

  const pad = 2;
  const rawMin = domain ? domain[0] : Math.min(...clean);
  const rawMax = domain ? domain[1] : Math.max(...clean);
  const span = rawMax - rawMin || 1;
  const stepX = clean.length > 1 ? (width - pad * 2) / (clean.length - 1) : 0;

  const coords = clean.map((value, index) => {
    const x = pad + index * stepX;
    const y = pad + (1 - (value - rawMin) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const last = coords[coords.length - 1].split(',');

  if (clean.length === 1) {
    // 单点连不成走势：画一条虚线基准 + 居中圆点，否则看起来像渲染坏了
    return (
      <svg
        role="img"
        aria-label={ariaLabel ?? `只有 1 个数据点，当前 ${clean[0]}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
      >
        <line
          x1={pad}
          y1={Number(last[1])}
          x2={width - pad}
          y2={Number(last[1])}
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray="3 4"
          strokeLinecap="round"
          opacity={0.55}
        />
        <circle cx={width / 2} cy={Number(last[1])} r={2.5} fill={stroke} />
      </svg>
    );
  }

  return (
    <svg
      role="img"
      aria-label={ariaLabel ?? `${clean.length} 个数据点，末值 ${clean[clean.length - 1]}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2} fill={stroke} />
    </svg>
  );
}

export default Sparkline;
