import { useState } from 'react';
import {
  Badge,
  Card,
  ScoreBand,
  Sparkline,
  Stat,
  Tile,
  Toast,
  bandTone,
  cx,
} from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { planToday, progressSummary, progressTrend } from '../../services/api';
import {
  MODULES,
  MODULE_LABEL_ZH,
  formatBand,
  type Module,
  type TrendPoint,
} from '../../types/ielts';
import { PlanList } from './PlanList';
import { bandGapHint, examCountdown, formatDateTime, formatMinutes, safeNumber } from './format';

/** 概览迷你趋势取最近 90 天（FR-P1）。 */
const TREND_DAYS = 90;

export interface DashboardProps {
  className?: string;
}

/**
 * 概览页（FR-P1 / AC-P1 / AC-G2）。
 *
 * 三个数据源都在**挂载时各自拉一次**（`useApi` 的 effect 语义），所以刚做完一次练习
 * 回到概览就能立刻看到该科 band、`attempts_total` 与「最近练习」更新（AC-P1、AC-G2）；
 * 「刷新概览」按钮用同一个 refreshKey 重发三个请求。
 *
 * 分数显示只走 band（0–9），`current[module]` 为 null 时由 `ScoreBand` 渲染「尚无数据」，
 * 任何缺失数值都经 `format.ts` 兜底，页面上不可能出现 NaN（AC-P3）。
 */
export function Dashboard({ className }: DashboardProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const summary = useApi((options) => progressSummary(options), [refreshKey]);
  const plan = useApi((options) => planToday(options), [refreshKey]);
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

  const data = summary.data;
  const countdown = examCountdown(data?.days_left, data?.exam_date ?? null);
  const planTasks = plan.data?.items ?? [];
  const error = summary.error ?? plan.error ?? trends.error;
  const noDataAtAll = data != null && MODULES.every((module) => data.current[module] == null);

  // 磁贴条（契约 §8.3）只吃这份 summary / plan 里已有的数：不许为填一块磁贴多加一次请求。
  const scored = MODULES.map((module) => ({ module, band: data?.current[module] ?? null })).filter(
    (entry): entry is { module: Module; band: number } => entry.band != null,
  );
  const weakest = scored.length > 0 ? scored.reduce((low, entry) => (entry.band < low.band ? entry : low)) : null;
  const deltas = MODULES.map((module) => ({ module, delta: data?.delta_vs_previous[module] ?? null })).filter(
    (entry): entry is { module: Module; delta: number } => typeof entry.delta === 'number' && Number.isFinite(entry.delta),
  );
  // 涨跌都算，取绝对值最大的一科；`sort` 稳定，所以并列时保留 `MODULES` 里先出现的那一科。
  const lead = deltas.length > 0 ? [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] : null;
  const deltaCopy = lead == null ? null : lead.delta === 0 ? '0.0' : `${lead.delta > 0 ? '+' : '-'}${Math.abs(lead.delta).toFixed(1)}`;
  const doneTasks = planTasks.filter((task) => task.done).length;

  return (
    <div className={cx('flex flex-col gap-4', className)}>
      {error ? (
        <Toast tone="danger">{error}</Toast>
      ) : null}

      {/* hero：全站唯一的渐变面，只回答一个问题 —— 离目标还差多少、今天练了没有 */}
      <section aria-label="概览" className="surface-hero relative overflow-hidden rounded-card px-5 py-4">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -right-12 h-56 w-56 rounded-full opacity-30"
          style={{ backgroundImage: 'radial-gradient(circle, var(--highlight) 0%, transparent 68%)' }}
        />
        <div className="relative flex flex-wrap items-start gap-x-9 gap-y-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-medium tracking-[0.14em] text-hero-ink-muted">目标 Band</span>
            <span className="font-code text-[46px] leading-none">
              {data ? formatBand(data.target_band) : '—'}
            </span>
            <span className="text-xs text-hero-ink-muted">
              {data
                ? `最近练习 ${formatDateTime(data.last_practice_at)} · 共 ${safeNumber(data.attempts_total)} 次`
                : summary.loading
                  ? '正在读取本地练习记录…'
                  : '暂无概览数据'}
            </span>
          </div>

          {data ? (
            <div className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
              <Stat
                label={countdown.label}
                value={countdown.value}
                unit={countdown.value === '—' ? undefined : '天'}
                hint={countdown.hint}
                surface="hero"
              />
              <Stat
                label="累计练习"
                value={formatMinutes(data.minutes_total)}
                unit="分钟"
                hint="全部模块合计"
                surface="hero"
              />
              <Stat label="练习次数" value={String(safeNumber(data.attempts_total))} unit="次" surface="hero" />
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={summary.loading}
            className={cx(
              'press ml-auto h-8 shrink-0 rounded-control border border-hero-ink/25 px-3 text-xs font-medium',
              'bg-hero-ink/10 hover:bg-hero-ink/20 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {summary.loading ? '刷新中…' : '刷新概览'}
          </button>
        </div>
      </section>

      {/* 磁贴条（契约 §8.3）：暖面只给「最弱一科」，其余 plain；缺数的块整块不渲染。 */}
      {weakest != null || lead != null || planTasks.length > 0 ? (
        <dl aria-label="概览关键指标" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {weakest != null ? (
            <Tile
              metric="overview.weakest"
              surface="warm"
              label="最弱一科"
              value={formatBand(weakest.band)}
              unit={MODULE_LABEL_ZH[weakest.module]}
              hint={bandGapHint(weakest.band, data?.target_band)}
            />
          ) : null}
          {deltaCopy != null && lead != null ? (
            <Tile
              metric="overview.delta"
              label="最近变化"
              value={deltaCopy}
              unit={MODULE_LABEL_ZH[lead.module]}
              hint="四科里变动最大的一次"
            />
          ) : null}
          {planTasks.length > 0 ? (
            <Tile
              metric="overview.plan"
              label="今日计划"
              value={`${doneTasks}/${planTasks.length}`}
              unit="项"
              hint="勾选完成项会立即重算"
            />
          ) : null}
        </dl>
      ) : null}

      {noDataAtAll ? (
        <p className="text-xs text-ink-muted">
          四科都还没有记录：从左侧任选一个模块完成一次练习，概览与报告会立即反映。
        </p>
      ) : null}

      <section aria-label="四科当前 Band" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MODULES.map((module) => {
          const current = data?.current[module] ?? null;
          const delta = data?.delta_vs_previous?.[module] ?? null;
          const points = trends.data?.[module] ?? [];
          const tone = bandTone(current) ?? 'accent';
          return (
            <Card key={module} title={`${MODULE_LABEL_ZH[module]} · 当前 Band`} tone={bandTone(current) ?? undefined}>
              <div className="flex flex-col gap-3">
                <ScoreBand
                  band={current}
                  label={MODULE_LABEL_ZH[module]}
                  delta={delta}
                  hint={bandGapHint(current, data?.target_band)}
                  size="sm"
                />
                <div className="flex items-end justify-between gap-2">
                  <Sparkline
                    points={points.map((point) => point.band)}
                    domain={[0, 9]}
                    tone={tone}
                    ariaLabel={`${MODULE_LABEL_ZH[module]}近 ${points.length} 次 band 走势`}
                  />
                  <span className="shrink-0 font-code text-xs text-ink-muted">
                    {points.length > 0 ? `${points.length} 个数据点` : '暂无趋势'}
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </section>

      <Card
        title="今日计划"
        subtitle="按目标分与四科差距自动分配（差距大的科权重更高）"
        actions={
          planTasks.length > 0 ? (
            <Badge tone="accent">{`${planTasks.filter((task) => task.done).length}/${planTasks.length} 已完成`}</Badge>
          ) : null
        }
      >
        {plan.data == null ? (
          <p role="status" className="text-sm text-ink-muted">
            {plan.loading ? '正在生成今日计划…' : '暂无今日计划'}
          </p>
        ) : (
          <PlanList
            tasks={plan.data.items}
            generatedAt={plan.data.generated_at}
            onChanged={() => void plan.refetch()}
          />
        )}
      </Card>
    </div>
  );
}

export default Dashboard;
