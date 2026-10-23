import { cx } from './cx';

export type MiniBarsProps = {
  /** 按时间顺序的数值（如逐日/逐周练习分钟）；非有限值与 0 不画柱，只留基线 */
  values: ReadonlyArray<number>;
  width?: number;
  height?: number;
  /** 目标线（如每日目标分钟），画在柱后；传 null 则不画 */
  goal?: number | null;
  ariaLabel?: string;
  className?: string;
};

/** 迷你柱状：磁贴块内嵌的那一层，纯 SVG、颜色跟随前景（`currentColor`），不引图表库。 */
export function MiniBars({
  values,
  width = 132,
  height = 44,
  goal = null,
  ariaLabel,
  className,
}: MiniBarsProps) {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  if (clean.length === 0) {
    return (
      <span className={cx('font-code text-xs opacity-60', className)} aria-hidden="true">
        —
      </span>
    );
  }

  const max = Math.max(...clean, goal ?? 0);
  const slot = width / clean.length;
  const barWidth = Math.max(2, slot * 0.6);

  return (
    <svg
      role="img"
      aria-label={ariaLabel ?? `${clean.length} 个数据点，峰值 ${max}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      {goal != null && goal > 0 ? (
        <line
          x1={0}
          x2={width}
          y1={height - (goal / max) * height}
          y2={height - (goal / max) * height}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.45}
        />
      ) : null}
      {clean.map((value, index) => {
        const barHeight = Math.max(2, (value / max) * height);
        return (
          <rect
            key={index}
            x={(slot - barWidth) / 2 + index * slot}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={2}
            fill="currentColor"
            opacity={index === clean.length - 1 ? 1 : 0.72}
          />
        );
      })}
    </svg>
  );
}

export default MiniBars;
