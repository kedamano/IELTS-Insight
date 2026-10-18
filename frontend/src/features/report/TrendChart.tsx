import { Chart, type ChartDatum } from '../../components/ui';
import { type TrendPoint } from '../../types/ielts';

export interface TrendChartProps {
  /** `progressTrend` 的 `points`（每科一条，FR-P3）。 */
  points: ReadonlyArray<TrendPoint>;
  /** 空态/无障碍名前缀，如「口语」。 */
  label: string;
  width?: number;
  height?: number;
  /** 只画最近 N 个点（0 或不传 = 全部）。 */
  limit?: number;
}

/** `MM-DD` 短标签；非法日期原样显示，绝不产出 NaN。 */
function tickLabel(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
}

/**
 * 单科 band 趋势折线：y 轴固定 0–9（FR-G5），空数据交给 `Chart` 的空态。
 *
 * 注：0.5 步长的**取值域**由 `clampBand`/`BAND_STEPS` 保证（types/ielts.ts），
 * 轴上的 0.5 参考线在 `ui/Chart` 里没有 ticks 间隔 prop（只有 min/mid/max 三档刻度），
 * 因此这里用固定 domain + band 格式化，等 Wave 3 给 Chart 补 `ticks` 后再加密。
 */
export function TrendChart({ points, label, width = 330, height = 170, limit }: TrendChartProps) {
  const clean = points.filter((point) => Number.isFinite(point.band));
  const sliced = limit && limit > 0 ? clean.slice(-limit) : clean;
  const data: ChartDatum[] = sliced.map((point) => ({ label: tickLabel(point.date), value: point.band }));

  return (
    <Chart
      data={data}
      type="line"
      width={width}
      height={height}
      yDomain={[0, 9]}
      valueFormat={(value) => value.toFixed(1)}
      ariaLabel={`${label} band 趋势（0–9）`}
      emptyText={`${label}尚无练习记录`}
    />
  );
}

export default TrendChart;
