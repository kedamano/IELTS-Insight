import { cx } from './cx';
import { seriesColor } from './tokens';

export type ChartDatum = {
  /** x 轴刻度：题号 / 日期 / 年份 */
  label: string;
  value: number;
  /** 多序列（报告页每科一条）；单序列可不传 */
  series?: string;
};

export type ChartProps = {
  data: ReadonlyArray<ChartDatum>;
  type?: 'line' | 'bar';
  /** 逻辑宽度；容器更窄时由外层滚动，SVG 自身不缩放文字 */
  width?: number;
  height?: number;
  yDomain?: readonly [number, number];
  ariaLabel: string;
  /** 空数据必须给出明确文案，禁止 NaN 或空白图表（AC-P3） */
  emptyText?: string;
  valueFormat?: (value: number) => string;
  className?: string;
};

const SINGLE_SERIES = '__single__';

export function Chart({
  data,
  type = 'line',
  width = 480,
  height = 180,
  yDomain,
  ariaLabel,
  emptyText = '尚无数据',
  valueFormat = (value) => String(Math.round(value * 10) / 10),
  className,
}: ChartProps) {
  const finite = data.filter((d) => Number.isFinite(d.value));
  if (finite.length === 0) {
    return (
      <div
        data-empty="true"
        role="status"
        className={cx(
          'flex items-center justify-center rounded-card border border-dashed border-rule',
          'bg-paper-sunken px-4 py-6 text-sm text-ink-muted',
          className,
        )}
        style={{ minHeight: height }}
      >
        {emptyText}
      </div>
    );
  }

  const labels: string[] = [];
  for (const d of finite) if (!labels.includes(d.label)) labels.push(d.label);

  const seriesNames: string[] = [];
  for (const d of finite) {
    const name = d.series ?? SINGLE_SERIES;
    if (!seriesNames.includes(name)) seriesNames.push(name);
  }

  const valueOf = (seriesName: string, label: string): number | null => {
    const hit = finite.find((d) => (d.series ?? SINGLE_SERIES) === seriesName && d.label === label);
    return hit ? hit.value : null;
  };

  const values = finite.map((d) => d.value);
  const min = yDomain ? yDomain[0] : Math.min(...values, 0);
  const maxRaw = yDomain ? yDomain[1] : Math.max(...values);
  const max = maxRaw > min ? maxRaw : min + 1;
  const span = max - min || 1;

  const padLeft = 34;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 24;
  const plotW = Math.max(10, width - padLeft - padRight);
  const plotH = Math.max(10, height - padTop - padBottom);

  const xAt = (index: number) =>
    padLeft + (labels.length === 1 ? plotW / 2 : (index * plotW) / (labels.length - 1));
  const yAt = (value: number) => padTop + (1 - (value - min) / span) * plotH;

  const ticks = [min, min + span / 2, max];
  const showXLabels = labels.length <= 10;

  const gridY = (value: number) => yAt(value);
  const labelStep = type === 'bar' ? plotW / labels.length : 0;

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ maxWidth: '100%' }}
      >
        {/* 网格与坐标轴：用 --chart-grid（比 --rule 高一档，深色下 --rule 的网格线基本看不见） */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={padLeft + plotW}
              y1={gridY(tick)}
              y2={gridY(tick)}
              stroke="var(--chart-grid)"
              strokeWidth={1}
            />
            <text
              x={padLeft - 6}
              y={gridY(tick) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--ink-muted)"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {valueFormat(tick)}
            </text>
          </g>
        ))}
        <line
          x1={padLeft}
          x2={padLeft}
          y1={padTop}
          y2={padTop + plotH}
          stroke="var(--chart-grid)"
          strokeWidth={1}
        />

        {seriesNames.map((seriesName, sIndex) => {
          const color = seriesNames.length === 1 ? 'var(--accent)' : seriesColor(sIndex);
          if (type === 'bar') {
            const groupW = (labelStep * 0.7) / seriesNames.length;
            return labels.map((label, lIndex) => {
              const value = valueOf(seriesName, label);
              if (value === null) return null;
              const barH = Math.max(1, padTop + plotH - yAt(value));
              const x =
                padLeft + lIndex * labelStep + (labelStep - groupW * seriesNames.length) / 2 + sIndex * groupW;
              return (
                <rect
                  key={`${seriesName}-${label}`}
                  x={x}
                  y={yAt(value)}
                  width={Math.max(1, groupW - 1)}
                  height={barH}
                  fill={color}
                />
              );
            });
          }

          const pts: string[] = [];
          labels.forEach((label, lIndex) => {
            const value = valueOf(seriesName, label);
            if (value !== null) pts.push(`${xAt(lIndex).toFixed(1)},${yAt(value).toFixed(1)}`);
          });
          if (pts.length === 0) return null;

          return (
            <g key={seriesName}>
              <polyline
                points={pts.join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.length === 1 ? (
                <circle cx={pts[0].split(',')[0]} cy={pts[0].split(',')[1]} r={2.5} fill={color} />
              ) : null}
            </g>
          );
        })}

        {showXLabels
          ? labels.map((label, index) => (
              <text
                key={label}
                x={type === 'bar' ? padLeft + index * labelStep + labelStep / 2 : xAt(index)}
                y={padTop + plotH + 14}
                textAnchor="middle"
                fontSize={10}
                fill="var(--ink-secondary)"
              >
                {label}
              </text>
            ))
          : null}
      </svg>

      {seriesNames.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
          {seriesNames.map((name, index) => (
            <li key={name} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: seriesColor(index) }}
              />
              {name === SINGLE_SERIES ? ariaLabel : name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default Chart;
