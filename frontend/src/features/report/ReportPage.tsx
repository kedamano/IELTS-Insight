/**
 * 报告页（spec §4.2 / FR-P3 / AC-P3 / AC-P3b / 契约 §8.2 的 Bento 版式）。
 *
 * 版面对齐样机：页头（标题 + meta + 整体变化）在上，下面是 6 列栅格 ——
 * 两块大磁贴（综合 band 走 hero 面并内嵌折线、练习时长走墨面并内嵌柱状），
 * 三块分科白卡（听力正确率 / 阅读正确率 / 生词本），琥珀宽卡给 TOP 错误类型，
 * 最后一块是分项 band。明细（趋势 / 题型 / 错因 / 热力图）继续在磁贴下方。
 *
 * 磁贴只做已有接口的派生（AC-P3b）：
 * - 分科正确率来自 `analytics.by_module`（后端与题型切法同源），缺哪科就整块不渲染，不给 0% 或「—」占位；
 * - 生词本没有掌握度字段（`vocab` 表只有 `created_at`），所以提示只能说「近 7 天新增 N」；
 * - 「整体 ±N.N」取 `delta_vs_previous` 非空均值，两科以下不足以支撑这个结论，直接不显示。
 * 数据全空时整块磁贴不渲染（宁可少版面，也不摆一排「—」冒充结论）。
 */
import { useState } from 'react';
import { Button, Card, MiniBars, Sparkline, Tile, cx, formatBand } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { getSettings, progressAnalytics, progressSummary, progressTrend, vocabList } from '../../services/api';
import {
  MODULES,
  MODULE_LABEL_ZH,
  type AccuracyByModule,
  type Module,
  type TrendPoint,
  type VocabNote,
} from '../../types/ielts';
import { errorTypeLabel } from '../shared/errorTypes';
import { Analytics } from './Analytics';
import { CriterionBands, loadCriterionBands } from './CriterionBands';
import { MinutesHeatmap, startOfWeek } from './MinutesHeatmap';
import { TrendFacets } from './TrendSection';
import { bandGapHint, examCountdown, formatDateTime } from './format';

/** 报告页趋势窗口：比概览页长，用于看长期走势（FR-P3）。 */
const TREND_DAYS = 180;

/** 分科正确率磁贴的顺序与文案（听力/阅读是客观题，才有逐题对错；顺序照样机：阅读在前）。 */
const ACCURACY_TILES: ReadonlyArray<{ module: AccuracyByModule['module']; label: string }> = [
  { module: 'reading', label: '阅读正确率' },
  { module: 'listening', label: '听力正确率' },
];

const NEARLY_A_WEEK_MS = 7 * 86_400_000;

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
  const summary = useApi((options) => progressSummary(options), [refreshKey]);
  const criteria = useApi((options) => loadCriterionBands(options), [refreshKey]);
  const vocab = useApi((options) => vocabList(options), [refreshKey]);
  /** 不带 module 的综合走势：后端按同一批记录聚合，磁贴里的折线画的就是它。 */
  const composite = useApi((options) => progressTrend({ days: TREND_DAYS }, options), [refreshKey]);
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
  const overview = summary.data;
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

  /* ---- 磁贴派生值：只用上面几个接口已经返回的数（AC-P3b 不许为凑版面造指标）---- */
  const scored = MODULES.map((module) => ({ module, band: overview?.current[module] ?? null })).filter(
    (item): item is { module: Module; band: number } => isFiniteNumber(item.band),
  );
  const targetBand = overview?.target_band ?? null;
  const overallBand = scored.length > 0 ? scored.reduce((sum, item) => sum + item.band, 0) / scored.length : null;
  // 同分时按 `MODULES` 顺序取第一科，保证「最弱一科」是确定值而不是遍历运气
  const weakest = scored.reduce<{ module: Module; band: number } | null>(
    (min, item) => (min == null || item.band < min.band ? item : min),
    null,
  );
  const countdown = examCountdown(overview?.days_left, overview?.exam_date ?? null);
  const examCopy =
    overview?.exam_date == null
      ? '尚未设置考试日期'
      : countdown.value === '—'
        ? '考试日期无法解析'
        : `${countdown.value} 天后考试`;

  const deltas = MODULES.map((module) => overview?.delta_vs_previous?.[module] ?? null).filter(isFiniteNumber);
  const deltaAvg = deltas.length >= 2 ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null;
  const deltaCopy =
    deltaAvg == null
      ? null
      : Math.abs(deltaAvg) < 0.05
        ? '持平'
        : `${deltaAvg > 0 ? '+' : '-'}${Math.abs(deltaAvg).toFixed(1)}`;

  const byModule = data?.by_module ?? [];
  const practiced = (data?.minutes_by_day ?? []).filter((day) => isFiniteNumber(day.minutes) && day.minutes > 0);
  const practicedMinutes = practiced.reduce((sum, day) => sum + day.minutes, 0);
  const goalMinutes = settings.data?.daily_goal_minutes ?? null;
  const reachedGoalDays = goalMinutes == null ? 0 : practiced.filter((day) => day.minutes >= goalMinutes).length;
  /** 柱状图按周合计（照样机那 7～8 根粗柱，而不是 31 根细丝）：同一批 `minutes_by_day` 的再聚合，不造数。 */
  const weeklyMinutes = (() => {
    const buckets = new Map<number, number>();
    for (const day of practiced) {
      const [y, m, d] = day.date.slice(0, 10).split('-').map(Number);
      if (!y || !m || !d) continue;
      const week = startOfWeek(new Date(y, m - 1, d)).getTime();
      buckets.set(week, (buckets.get(week) ?? 0) + day.minutes);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, total]) => total);
  })();
  const minutesTotal = overview && isFiniteNumber(overview.minutes_total) ? overview.minutes_total : null;
  const attemptsCount = overview && isFiniteNumber(overview.attempts_total) ? overview.attempts_total : null;
  const errorStats = data?.by_error_type ?? [];
  const topError = errorStats.reduce<{ error_type: string; count: number; latest_quote: string | null } | null>(
    (max, stat) =>
      max == null || stat.count > max.count
        ? { error_type: stat.error_type, count: stat.count, latest_quote: stat.latest_quote ?? null }
        : max,
    null,
  );
  const errorTotal = errorStats.reduce((sum, stat) => sum + (isFiniteNumber(stat.count) ? stat.count : 0), 0);
  const vocabNotes: VocabNote[] = vocab.data ?? [];
  const vocabRecent = vocabNotes.filter((note) => {
    const addedAt = note.created_at ? new Date(note.created_at).getTime() : Number.NaN;
    return Number.isFinite(addedAt) && Date.now() - addedAt <= NEARLY_A_WEEK_MS;
  }).length;
  const compositePoints = (composite.data?.points ?? []).map((point) => point.band).filter(isFiniteNumber);
  const criterionEntries = [...(criteria.data ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const leadCriterion = criterionEntries[0] ?? null;

  const metaItems = [
    attemptsCount != null ? `${attemptsCount} 次练习` : null,
    minutesTotal != null ? `${Math.round(minutesTotal)} 分钟` : null,
    targetBand == null ? null : `目标 Band ${targetBand}`,
    overview?.last_practice_at ? `最近练习 ${formatDateTime(overview.last_practice_at)}` : null,
  ].filter((text): text is string => text != null);

  const actions = [
    onOpenReviewBook ? { key: 'review', label: '错题本', onClick: onOpenReviewBook } : null,
    onOpenVocabBook ? { key: 'vocab', label: '生词本', onClick: onOpenVocabBook } : null,
    onOpenAttempts ? { key: 'attempts', label: '练习存档', onClick: onOpenAttempts } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; onClick: () => void }>;

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {error || loading || !hasAnyData ? (
        <Card
          title="学习报告"
          subtitle={`近 ${weeks} 周分析 · 趋势取近 ${TREND_DAYS} 天（band 轴固定 0–9）`}
        >
          {error ? (
            <p role="alert" className="text-sm" style={{ color: 'var(--band-poor)' }}>
              {error}
            </p>
          ) : loading ? (
            <p role="status" className="text-sm text-ink-muted">
              正在统计本地练习记录…
            </p>
          ) : (
            <p role="status" className="text-sm text-ink-secondary">
              尚无练习数据：完成一次听力、阅读、写作或口语练习后，趋势、分项 band、正确率与练习时长会自动出现。
              删除某条记录（见「练习存档」）会即时重算这些数字。
            </p>
          )}
        </Card>
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-[15px] font-semibold text-ink">近 {weeks} 周走势</h3>
          {metaItems.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
              {metaItems.map((text, index) => (
                <span key={text} className="flex items-center gap-x-2">
                  {index > 0 ? (
                    <span aria-hidden="true" className="opacity-50">
                      ·
                    </span>
                  ) : null}
                  <span>{text}</span>
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {deltaCopy != null ? (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent-strong">
              {`整体 ${deltaCopy}`}
            </span>
          ) : null}
          {actions.map((link) => (
            <Button key={link.key} variant="outline" size="sm" onClick={link.onClick}>
              打开{link.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRefreshKey((key) => key + 1)}
            loading={analytics.loading || trends.loading || criteria.loading || summary.loading}
          >
            刷新报告
          </Button>
        </div>
      </header>

      {/* 摘要磁贴（FR-P3 / 契约 §8.2）：6 列栅格，两块大磁贴各占 3 列 × 2 行。 */}
      {hasAnyData ? (
        <dl
          aria-label="报告摘要"
          className="grid grid-cols-2 gap-3 lg:grid-cols-6 lg:auto-rows-[minmax(104px,auto)]"
        >
          <Tile
            metric="overall"
            surface="hero"
            size="lg"
            label="综合 Band"
            value={overallBand == null ? '—' : formatBand(overallBand)}
            unit={targetBand == null ? undefined : `→ ${formatBand(targetBand)}`}
            hint={
              overallBand == null
                ? '完成一次评分后这里才有均值'
                : `${scored.length} 科均值 · ${examCopy}`
            }
            chart={
              compositePoints.length > 0 ? (
                <Sparkline
                  points={compositePoints}
                  tone="inherit"
                  domain={[0, 9]}
                  width={216}
                  height={72}
                  ariaLabel={`综合走势 ${compositePoints.length} 个点，最近 ${formatBand(compositePoints[compositePoints.length - 1])}`}
                />
              ) : null
            }
            className="col-span-2 lg:col-span-3 lg:row-span-2"
          >
            {weakest ? (
              <span className="text-xs text-hero-ink-muted">
                最弱一科 {MODULE_LABEL_ZH[weakest.module]} {formatBand(weakest.band)} ·{' '}
                {bandGapHint(weakest.band, targetBand)}
              </span>
            ) : null}
          </Tile>

          <Tile
            metric="minutes"
            surface="solid"
            size="lg"
            label="练习时长"
            value={isFiniteNumber(minutesTotal) ? String(Math.round(minutesTotal)) : '—'}
            unit={isFiniteNumber(minutesTotal) ? '分钟' : undefined}
            hint={
              practiced.length === 0
                ? `近 ${weeks} 周没有练习记录`
                : `日均 ${Math.round(practicedMinutes / practiced.length)} 分钟${
                    goalMinutes == null ? '' : ` · ${reachedGoalDays} 天达目标 ${goalMinutes}`
                  }`
            }
            chart={
              weeklyMinutes.length > 0 ? (
                <MiniBars
                  values={weeklyMinutes}
                  goal={goalMinutes == null ? null : goalMinutes * 7}
                  width={216}
                  height={64}
                  ariaLabel={`练习时长按周合计 ${weeklyMinutes.length} 周`}
                />
              ) : null
            }
            className="col-span-2 lg:col-span-3 lg:row-span-2"
          />

          {ACCURACY_TILES.map((tile) => {
            const row = byModule.find((item) => item.module === tile.module);
            // 没做过这一科 = 整块不显示（显示 0% 或「—」都是把「没数据」说成「数据是零」）
            if (!row || !isFiniteNumber(row.total) || row.total <= 0) return null;
            return (
              <Tile
                key={tile.module}
                metric={`accuracy-${tile.module}`}
                surface="plain"
                label={tile.label}
                value={`${Math.round((isFiniteNumber(row.accuracy) ? row.accuracy : 0) * 100)}%`}
                hint={`${row.correct}/${row.total} 题`}
                className="lg:col-span-2"
              />
            );
          })}

          <Tile
            metric="vocab"
            surface="plain"
            label="生词本"
            value={vocabNotes.length > 0 ? String(vocabNotes.length) : '—'}
            unit={vocabNotes.length > 0 ? '词' : undefined}
            hint={vocabNotes.length > 0 ? `近 7 天新增 ${vocabRecent}` : '还没有加入生词'}
            className="lg:col-span-2"
          />

          <Tile
            metric="top-error"
            surface="warm"
            label="最常犯的错误"
            value={topError ? errorTypeLabel(topError.error_type) : '—'}
            hint={
              topError ? `近 ${weeks} 周 ${errorStats.length} 类错误共 ${errorTotal} 次` : '暂无错误记录'
            }
            className="col-span-2 lg:col-span-3"
          >
            {topError?.latest_quote ? (
              <span className="line-clamp-2 text-xs text-ink-secondary">最近一次：{topError.latest_quote}</span>
            ) : null}
          </Tile>

          <Tile
            metric="criteria"
            surface="plain"
            label="分项 Band"
            value={leadCriterion?.overall != null ? formatBand(leadCriterion.overall) : '—'}
            unit={leadCriterion?.overall != null ? '总分' : undefined}
            hint={leadCriterion ? `${MODULE_LABEL_ZH[leadCriterion.module]} · 最近一次` : '尚无口语或写作评分'}
            className="col-span-2 lg:col-span-3"
          >
            {criterionEntries.length > 0 ? (
              <div className="flex flex-col gap-2">
                {criterionEntries.map((entry) => (
                  <div key={entry.attemptId} className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <span className="pt-1.5 text-xs text-ink-muted">{MODULE_LABEL_ZH[entry.module]}</span>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {entry.items.map((item) => (
                        <span
                          key={item.key}
                          data-reached={
                            item.band == null || targetBand == null
                              ? undefined
                              : String(item.band >= targetBand)
                          }
                          className="flex min-w-9 flex-col gap-0.5"
                          title={item.zh}
                        >
                          <span className="font-serif text-[22px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
                            {item.band == null ? '—' : formatBand(item.band)}
                          </span>
                          <span className="text-[11px] font-normal tracking-normal text-ink-muted">
                            {item.abbr}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {targetBand != null ? (
                  <span className="flex items-center gap-3 text-[11px] text-ink-muted">
                    <span className="flex items-center gap-1">
                      <span
                        aria-hidden="true"
                        className="inline-block size-2.5 rounded-full"
                        style={{ backgroundColor: 'var(--band-good)' }}
                      />
                      达标
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        aria-hidden="true"
                        className="inline-block size-2.5 rounded-full border border-rule"
                        style={{ backgroundColor: 'var(--paper-raised)' }}
                      />
                      未达标
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </Tile>
        </dl>
      ) : null}

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
