/**
 * 报告页（spec §4.2 / FR-P3 / AC-P3）。
 *
 * 内容按 spec 逐项对齐：
 * - Band 趋势：每科一张 0–9 轴折线（`TrendFacets`），另有 sparkline 在概览页；
 * - 分项 band：口语 / 写作四维（`CriterionBands`）；
 * - 正确率：按题型（`Analytics` 的 Bar 列表）；
 * - 错误类型分布：按 `error_type` 计数 + 最近原句；
 * - 练习时长热力图：近 8 周（`MinutesHeatmap`）；
 * - 错题本入口：由 App 控制器注入回调（本屏不路由、不越界写别人的文件），
 *   未注入时不渲染按钮，避免出现点了没反应的死控件。
 *
 * 空态是显式的：数据全空时先给一段中文说明，再让各图表走自己的 `emptyText`，
 * 因此不会出现「空白图表」或 `NaN`（数值一律经 `format.ts` / `Chart` 过滤）。
 */
import { useState } from 'react';
import { Button, Card, cx } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { getSettings, progressAnalytics, progressTrend } from '../../services/api';
import { MODULES, type Module, type TrendPoint } from '../../types/ielts';
import { Analytics } from './Analytics';
import { CriterionBands, loadCriterionBands } from './CriterionBands';
import { MinutesHeatmap } from './MinutesHeatmap';
import { TrendFacets } from './TrendSection';

/** 报告页趋势窗口：比概览页长，用于看长期走势（FR-P3）。 */
const TREND_DAYS = 180;

export interface ReportPageProps {
  className?: string;
  /** 分析窗口（周），契约 §1 行 28 默认 8。 */
  weeks?: number;
  /** 错题本入口（spec §4.2）；控制器未提供时不渲染。 */
  onOpenReviewBook?: () => void;
  /** 生词本入口（spec §4.3 的兄弟页）；控制器未提供时不渲染。 */
  onOpenVocabBook?: () => void;
  /** 练习存档入口（FR-P4 删除记录）；控制器未提供时不渲染。 */
  onOpenAttempts?: () => void;
}

export function ReportPage({
  className,
  weeks = 8,
  onOpenReviewBook,
  onOpenVocabBook,
  onOpenAttempts,
}: ReportPageProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const analytics = useApi((options) => progressAnalytics({ weeks }, options), [refreshKey]);
  const settings = useApi((options) => getSettings(options), [refreshKey]);
  const criteria = useApi((options) => loadCriterionBands(options), [refreshKey]);
  const trends = useApi<Record<Module, TrendPoint[]>>(
    async (options) => {
      const entries = await Promise.all(
        MODULES.map(async (module) => {
          const trend = await progressTrend({ module, days: TREND_DAYS }, options);
          return [module, trend.points] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<Module, TrendPoint[]>;
    },
    [refreshKey],
  );

  const data = analytics.data;
  const trendMap: Partial<Record<Module, TrendPoint[]>> = trends.data ?? {};
  const trendCount = MODULES.reduce((sum, module) => sum + (trendMap[module]?.length ?? 0), 0);
  const hasAnyData =
    trendCount > 0 ||
    (data?.by_question_type?.length ?? 0) > 0 ||
    (data?.by_error_type?.length ?? 0) > 0 ||
    (data?.minutes_by_day?.length ?? 0) > 0 ||
    (criteria.data?.length ?? 0) > 0;
  const loading = (analytics.loading || trends.loading || criteria.loading) && !hasAnyData;
  const error = analytics.error ?? trends.error ?? settings.error;

  const links = [
    onOpenReviewBook ? { key: 'review', label: '错题本', onClick: onOpenReviewBook } : null,
    onOpenVocabBook ? { key: 'vocab', label: '生词本', onClick: onOpenVocabBook } : null,
    onOpenAttempts ? { key: 'attempts', label: '练习存档', onClick: onOpenAttempts } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; onClick: () => void }>;

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <Card
        title="学习报告"
        subtitle={`近 ${weeks} 周分析 · 趋势取近 ${TREND_DAYS} 天（band 轴固定 0–9）`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {links.map((link) => (
              <Button key={link.key} variant="outline" size="sm" onClick={link.onClick}>
                打开{link.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshKey((key) => key + 1)}
              loading={analytics.loading || trends.loading || criteria.loading}
            >
              刷新报告
            </Button>
          </div>
        }
      >
        {error ? (
          <p role="alert" className="text-sm" style={{ color: 'var(--band-poor)' }}>
            {error}
          </p>
        ) : loading ? (
          <p role="status" className="text-sm text-ink-muted">
            正在统计本地练习记录…
          </p>
        ) : !hasAnyData ? (
          <p role="status" className="text-sm text-ink-secondary">
            尚无练习数据：完成一次听力、阅读、写作或口语练习后，趋势、分项 band、正确率与练习时长会自动出现。
            删除某条记录（见「练习存档」）会即时重算这些数字。
          </p>
        ) : (
          <p className="text-sm text-ink-secondary">
            共 {trendCount} 个趋势数据点；所有分数均为 Band（0–9，步长 0.5）。
          </p>
        )}
      </Card>

      <Card title="Band 趋势" subtitle="每科一条独立 0–9 轴">
        <TrendFacets trends={trendMap} modules={MODULES} days={TREND_DAYS} />
      </Card>

      <CriterionBands entries={criteria.data ?? []} loading={criteria.loading} error={criteria.error} />

      <Analytics analytics={data} loading={analytics.loading} error={analytics.error} weeks={weeks} />

      <Card title="练习时长" subtitle={`近 ${weeks} 周热力（周一为一周起点）`}>
        <MinutesHeatmap
          days={data?.minutes_by_day ?? []}
          weeks={weeks}
          goalMinutes={settings.data?.daily_goal_minutes ?? null}
        />
      </Card>
    </div>
  );
}

export default ReportPage;
