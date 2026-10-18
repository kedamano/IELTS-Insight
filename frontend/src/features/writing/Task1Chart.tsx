/**
 * Task1Chart —— FR-W1 / AC-W1：Task 1 图表由 `chart.data` 本地绘制。
 *
 * 只用内联 SVG + 现有设计 token（`--rule` 轴、`seriesColor()` 数据色），
 * 不引图片文件、不引图表库、不加新 token。五种 `chart.type` 都有画法：
 * `line`/`dynamic_chart` → 折线（动态图带点标记）、`bar` → 分组柱、`pie` → 扇形 + 图例、
 * `table` → 语义化 HTML 表格；**类型无法识别时退化为分组柱并说明原因，绝不画空框**。
 * 轴标签取 `labels` 优先、回落 `years`（契约 §10.1），图例文字就是 `series[].name`，
 * 二者与数据同源，满足 AC-W1「图例与轴标签与 data 一致」。
 */
import { Badge, Card, cx, seriesColor } from '../../components/ui';
import type { ChartData } from '../../types/ielts';
import {
  CHART_TYPE_LABEL_ZH,
  chartValueRange,
  chartViewOf,
  formatChartValue,
  niceCeil,
  type ChartView,
} from './writingSets';

export type Task1ChartProps = {
  chart: ChartData | null | undefined;
  className?: string;
};

const WIDTH = 560;
const HEIGHT = 270;
const PAD = { left: 52, right: 16, top: 16, bottom: 46 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

function valueText(value: number, unit: string | null): string {
  return unit ? `${formatChartValue(value)} ${unit}` : formatChartValue(value);
}

function domainOf(view: ChartView): { bottom: number; top: number } {
  const { min, max } = chartValueRange(view);
  const top = niceCeil(max);
  const bottom = min < 0 ? -niceCeil(-min) : 0;
  return { bottom, top: top === bottom ? bottom + 1 : top };
}

function xAt(index: number, count: number): number {
  if (count <= 1) return PAD.left + PLOT_W / 2;
  return PAD.left + (index * PLOT_W) / (count - 1);
}

function Legend({ names, unit }: { names: string[]; unit: string | null }) {
  if (!names.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
      {names.map((name, index) => (
        <li key={`${name}-${index}`} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: seriesColor(index) }} />
          {name}
        </li>
      ))}
      {unit ? <li className="text-xs text-ink-muted">单位：{unit}</li> : null}
    </ul>
  );
}

function Grid({ bottom, top }: { bottom: number; top: number }) {
  const marks = [top, (top + bottom) / 2, bottom];
  return (
    <g>
      {marks.map((mark, index) => {
        const y = PAD.top + PLOT_H * (1 - (mark - bottom) / (top - bottom));
        return (
          <g key={mark}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={index === marks.length - 1 ? 1.2 : 0.8} strokeDasharray={index === 0 || index === 1 ? '3 3' : undefined} />
            <text x={PAD.left - 8} y={y + 3.5} textAnchor="end" className="font-code" fontSize="10" fill="var(--ink-muted)">
              {formatChartValue(mark)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function AxisLabels({ labels }: { labels: string[] }) {
  return (
    <g>
      {labels.map((label, index) => (
        <text
          key={`${label}-${index}`}
          x={xAt(index, labels.length)}
          y={HEIGHT - PAD.bottom + 18}
          textAnchor="middle"
          fontSize="11"
          fill="var(--ink-secondary)"
        >
          {label}
        </text>
      ))}
    </g>
  );
}

function LineChart({ view, mode }: { view: ChartView; mode: 'line' | 'dynamic_chart' }) {
  const { bottom, top } = domainOf(view);
  const count = view.axisLabels.length;
  const yAt = (value: number) => PAD.top + PLOT_H * (1 - (value - bottom) / (top - bottom));

  return (
    <>
      <Grid bottom={bottom} top={top} />
      {view.series.map((series, seriesIndex) => {
        const color = seriesColor(seriesIndex);
        const segments: string[] = [];
        let current: string[] = [];
        series.values.forEach((value, index) => {
          if (value === null) {
            if (current.length > 1) segments.push(current.join(' '));
            current = [];
            return;
          }
          current.push(`${xAt(index, count)},${yAt(value)}`);
        });
        if (current.length > 1) segments.push(current.join(' '));
        return (
          <g key={series.name}>
            {segments.map((points, index) => (
              <polyline
                key={`${series.name}-${index}`}
                points={points}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ))}
            {series.values.map((value, index) =>
              value === null ? null : (
                <g key={`${series.name}-point-${index}`}>
                  <rect
                    x={xAt(index, count) - 3}
                    y={yAt(value) - 3}
                    width={mode === 'dynamic_chart' ? 6 : 5}
                    height={mode === 'dynamic_chart' ? 6 : 5}
                    fill={color}
                    rx={mode === 'dynamic_chart' ? 0 : 2.5}
                  >
                    <title>{`${series.name} · ${view.axisLabels[index]}：${valueText(value, view.unit)}`}</title>
                  </rect>
                  {mode === 'dynamic_chart' ? (
                    <text x={xAt(index, count)} y={yAt(value) - 8} textAnchor="middle" className="font-code" fontSize="9" fill="var(--ink-muted)">
                      {formatChartValue(value)}
                    </text>
                  ) : null}
                </g>
              ),
            )}
          </g>
        );
      })}
      <AxisLabels labels={view.axisLabels} />
    </>
  );
}

function BarChart({ view }: { view: ChartView }) {
  const { bottom, top } = domainOf(view);
  const groupCount = view.axisLabels.length || 1;
  const seriesCount = Math.max(1, view.series.length);
  const groupWidth = PLOT_W / groupCount;
  const barWidth = (groupWidth * 0.72) / seriesCount;
  const baseline = PAD.top + PLOT_H * (1 - (0 - bottom) / (top - bottom));

  return (
    <>
      <Grid bottom={bottom} top={top} />
      {view.axisLabels.map((label, groupIndex) => {
        const groupLeft = PAD.left + groupIndex * groupWidth + groupWidth * 0.14;
        return (
          <g key={`${label}-${groupIndex}`}>
            {view.series.map((series, seriesIndex) => {
              const value = series.values[groupIndex];
              if (value === null || value === undefined) return null;
              const y = PAD.top + PLOT_H * (1 - (value - bottom) / (top - bottom));
              const height = Math.max(1, Math.abs(baseline - y));
              return (
                <rect
                  key={`${series.name}-${groupIndex}`}
                  x={groupLeft + seriesIndex * barWidth}
                  y={Math.min(y, baseline)}
                  width={Math.max(1, barWidth * 0.86)}
                  height={height}
                  fill={seriesColor(seriesIndex)}
                  rx={1}
                >
                  <title>{`${series.name} · ${label}：${valueText(value, view.unit)}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
      <AxisLabels labels={view.axisLabels} />
    </>
  );
}

function PieChart({ view }: { view: ChartView }) {
  const slices = view.slices;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const cxValue = PAD.left + PLOT_W / 2;
  const cyValue = PAD.top + PLOT_H / 2;
  const radius = Math.min(PLOT_W, PLOT_H) / 2;

  let angle = -Math.PI / 2;
  return (
    <g>
      {slices.map((slice, index) => {
        const sweep = (slice.value / total) * Math.PI * 2;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        const color = seriesColor(index);
        const percent = Math.round((slice.value / total) * 100);
        const labelRadius = radius * 0.62;
        const mid = (start + end) / 2;
        const isWhole = sweep >= Math.PI * 2 - 0.0001;
        const x1 = cxValue + radius * Math.cos(start);
        const y1 = cyValue + radius * Math.sin(start);
        const x2 = cxValue + radius * Math.cos(end);
        const y2 = cyValue + radius * Math.sin(end);
        return (
          <g key={`${slice.label}-${index}`}>
            {isWhole ? (
              <circle cx={cxValue} cy={cyValue} r={radius} fill={color}>
                <title>{`${slice.label}：${valueText(slice.value, view.unit)}（100%）`}</title>
              </circle>
            ) : (
              <path
                d={`M ${cxValue} ${cyValue} L ${x1} ${y1} A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`}
                fill={color}
                stroke="var(--paper-raised)"
                strokeWidth={1}
              >
                <title>{`${slice.label}：${valueText(slice.value, view.unit)}（${percent}%）`}</title>
              </path>
            )}
            {sweep > 0.4 ? (
              <text
                x={cxValue + labelRadius * Math.cos(mid)}
                y={cyValue + labelRadius * Math.sin(mid) + 3}
                textAnchor="middle"
                className="font-code"
                fontSize="10"
                fill="var(--paper)"
              >
                {percent}%
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function PieLegend({ view }: { view: ChartView }) {
  const total = view.slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
      {view.slices.map((slice, index) => (
        <li key={`${slice.label}-${index}`} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: seriesColor(index) }} />
          {slice.label}
          <span className="font-code text-ink-muted">
            {total > 0 ? `${Math.round((slice.value / total) * 100)}%` : formatChartValue(slice.value)}
          </span>
        </li>
      ))}
      {view.unit ? <li className="text-xs text-ink-muted">单位：{view.unit}</li> : null}
    </ul>
  );
}

function TableView({ view }: { view: ChartView }) {
  const table = view.table;
  if (!table) return null;
  return (
    <div className="overflow-x-auto rounded-card border border-rule">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-paper-sunken text-left">
            {table.leadingLabel ? (
              <th scope="col" className="border-b border-rule px-2.5 py-1.5 text-xs font-medium text-ink-muted">
                {table.leadingLabel}
              </th>
            ) : null}
            {table.columns.map((column, index) => (
              <th key={`${column}-${index}`} scope="col" className="border-b border-rule px-2.5 py-1.5 text-xs font-medium text-ink-secondary">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => {
                const isRowHead = table.leadingLabel !== '' && cellIndex === 0;
                const className = cx(
                  'border-b border-rule px-2.5 py-1.5',
                  isRowHead ? 'text-left text-ink-secondary' : 'font-code text-ink',
                );
                return isRowHead ? (
                  <th key={`${rowIndex}-${cellIndex}`} scope="row" className={className}>
                    {cell}
                  </th>
                ) : (
                  <td key={`${rowIndex}-${cellIndex}`} className={className}>
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {view.unit ? <p className="px-2.5 py-1.5 text-xs text-ink-muted">单位：{view.unit}</p> : null}
    </div>
  );
}

function seriesNames(view: ChartView): string[] {
  return view.series.map((series) => series.name);
}

export function Task1Chart({ chart, className }: Task1ChartProps) {
  const view = chartViewOf(chart);
  const rawType = chart && typeof chart === 'object' ? (chart as { type?: unknown }).type : undefined;
  const kindLabel = view.type ? CHART_TYPE_LABEL_ZH[view.type] : '图表';
  const isPie = view.type === 'pie';
  const isTable = view.type === 'table' && view.table !== null;
  /** 未知类型：仍按分组柱把数据画出来，并说明是回落渲染（CONSTITUTION §3：不静默）。 */
  const isFallbackBars = view.type === null;
  const pieTotal = isPie ? view.slices.reduce((sum, slice) => sum + slice.value, 0) : 1;

  if (!view.hasData || (isPie && pieTotal <= 0)) {
    return (
      <div
        role="status"
        className={cx(
          'flex min-h-20 flex-col gap-1 rounded-card border border-dashed border-rule bg-paper-sunken px-3 py-2.5',
          className,
        )}
      >
        <span className="text-sm text-ink-secondary">本题没有可绘图的图表数据，请依据题干文字完成概述。</span>
        {rawType != null ? <span className="font-code text-xs text-ink-muted">chart.type = {String(rawType)}</span> : null}
      </div>
    );
  }

  const barLike = view.type === 'bar' || isFallbackBars;

  return (
    <div className={cx('flex flex-col', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={isFallbackBars ? 'mid' : 'accent'} variant="outline">
          {isFallbackBars ? `未知图表类型 ${String(rawType ?? '')}` : `${kindLabel}（本地绘制）`}
        </Badge>
        {view.unit ? <span className="font-code text-xs text-ink-muted">{view.unit}</span> : null}
      </div>

      {isTable ? (
        <div className="mt-2">
          <TableView view={view} />
        </div>
      ) : (
        <>
          <svg
            role="img"
            aria-label={`Task 1 ${kindLabel}：${view.axisLabels.join('、') || '数据图'}${view.unit ? `（单位 ${view.unit}）` : ''}`}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width="100%"
            height={HEIGHT}
            preserveAspectRatio="xMidYMid meet"
            className="mt-1 rounded-card border border-rule bg-paper"
          >
            {isPie ? (
              <PieChart view={view} />
            ) : barLike ? (
              <BarChart view={view} />
            ) : (
              <LineChart view={view} mode={view.type === 'dynamic_chart' ? 'dynamic_chart' : 'line'} />
            )}
          </svg>
          {isPie ? <PieLegend view={view} /> : <Legend names={seriesNames(view)} unit={view.unit} />}
        </>
      )}

      {isFallbackBars ? (
        <p className="mt-1 text-xs text-band-mid">图表类型无法识别，已按原始数值降级为柱状图显示，数据与后端下发一致。</p>
      ) : null}
      {view.sourceNote ? <p className="mt-1.5 text-xs text-ink-muted">{view.sourceNote}</p> : null}
    </div>
  );
}

export default Task1Chart;

/** 供面板在题面卡里复用同一套外壳（避免两处各写一遍标题栏）。 */
export function Task1ChartCard({ chart }: { chart: ChartData | null | undefined }) {
  const view = chartViewOf(chart);
  return (
    <Card
      title="图表数据"
      subtitle={
        view.type
          ? `${CHART_TYPE_LABEL_ZH[view.type]} · 由 chart.data 本地 SVG 渲染，无外部图片`
          : '图表类型无法识别 · 按原始数值降级渲染'
      }
    >
      <Task1Chart chart={chart} />
    </Card>
  );
}
