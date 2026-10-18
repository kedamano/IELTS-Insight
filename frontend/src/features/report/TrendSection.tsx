import { Badge } from '../../components/ui';
import { MODULE_LABEL_ZH, type Module, type TrendPoint } from '../../types/ielts';
import { TrendChart } from './TrendChart';

export interface TrendSectionProps {
  /** `progressTrend({module, days})` 按科聚合的结果。 */
  trends: Readonly<Partial<Record<Module, ReadonlyArray<TrendPoint>>>>;
  module: Module;
  days?: number;
}

/**
 * 单科 band 趋势（FR-P3 报告页 / FR-P1 概览页共用）。
 *
 * y 轴固定 0–9（FR-G5），三档语义阈值 5.5 / 7.0 作为参考标注在图旁，
 * 使「当前档」与「目标档」在同一坐标系里可比。
 */
export function TrendSection({ trends, module, days }: TrendSectionProps) {
  const points = trends[module] ?? [];
  const bands = points.map((point) => point.band);
  const last = bands.length > 0 ? bands[bands.length - 1] : null;
  const best = bands.length > 0 ? Math.max(...bands) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-serif text-sm text-ink">{MODULE_LABEL_ZH[module]}趋势</h3>
        <span className="font-code text-xs text-ink-muted">
          {points.length} 个数据点{days ? ` · 近 ${days} 天` : ''}
        </span>
      </div>
      <TrendChart points={points} label={MODULE_LABEL_ZH[module]} />
      <div className="flex flex-wrap items-center gap-1.5">
        {last != null ? <Badge>最近 {last.toFixed(1)}</Badge> : <Badge>尚无数据</Badge>}
        {best != null ? <Badge>最高 {best.toFixed(1)}</Badge> : null}
      </div>
    </div>
  );
}

/** 多科趋势的分面（facet）布局：每科一条独立 0–9 轴，避免量纲混淆。 */
export function TrendFacets({
  trends,
  modules,
  days,
}: {
  trends: Readonly<Partial<Record<Module, ReadonlyArray<TrendPoint>>>>;
  modules: readonly Module[];
  days?: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* 三档阈值四科通用，只在分面上方说明一次；每张图各重复一遍就成了噪音 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="good">≥ 7.0 已达目标档</Badge>
        <Badge tone="mid">5.5–6.5 中间档</Badge>
        <Badge tone="poor">≤ 5.0 需重点提升</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {modules.map((module) => (
          <TrendSection key={module} trends={trends} module={module} days={days} />
        ))}
      </div>
    </div>
  );
}

export default TrendSection;
