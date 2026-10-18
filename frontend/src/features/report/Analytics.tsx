import { Bar, Badge, Card, cx } from '../../components/ui';
import { errorTypeLabel, accuracyTone } from '../shared/errorTypes';
import {
  QUESTION_TYPE_LABEL_ZH,
  type Analytics as AnalyticsData,
  type ErrorTypeStat,
  type QuestionType,
} from '../../types/ielts';

export interface AnalyticsProps {
  /** `progressAnalytics({weeks})` 的结果；null 表示还没拉到。 */
  analytics: AnalyticsData | null;
  loading?: boolean;
  error?: string | null;
  weeks?: number;
  className?: string;
}

/**
 * 题型正确率 + 错误类型分布（FR-P3 / 契约 §1 行 28）。
 *
 * 空态是硬性验收项（AC-P3）：两个区块各自给出中文文案，且整页不允许出现 `NaN`
 * 或空白图表；`by_question_type` 与 `by_error_type` 同时为空时给出统一的「先做一次练习」提示。
 */
export function Analytics({ analytics, loading = false, error = null, weeks = 8, className }: AnalyticsProps) {
  const byType = analytics?.by_question_type ?? [];
  const byError = analytics?.by_error_type ?? [];
  const isEmpty = !loading && error == null && byType.length === 0 && byError.length === 0;

  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {error ? (
        <Card title="分析数据读取失败">
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        </Card>
      ) : null}

      {isEmpty ? (
        <Card title="分析报告" subtitle={`近 ${weeks} 周`}>
          <p role="status" className="text-sm text-ink-secondary">
            近 {weeks} 周尚无练习记录。完成一次听力/阅读或写作练习后，这里会出现题型正确率与错误类型分布。
          </p>
        </Card>
      ) : null}

      {byType.length > 0 ? (
        <Card title="题型正确率" subtitle="听力 / 阅读（近 8 周累计）">
          <ul className="flex flex-col gap-3">
            {byType.map((row) => {
              const accuracy = Number.isFinite(row.accuracy) ? row.accuracy : 0;
              const percent = Math.round(accuracy * 100);
              const label =
                QUESTION_TYPE_LABEL_ZH[row.question_type as QuestionType] ?? row.question_type;
              return (
                <li key={row.question_type}>
                  <Bar
                    value={row.correct}
                    max={row.total > 0 ? row.total : 1}
                    tone={accuracyTone(accuracy)}
                    label={label}
                    valueLabel={`${percent}%（${row.correct}/${row.total}）`}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-ink-muted">
            色阶：≥80% 绿 · 60–79% 橙 · &lt;60% 红（正确率分档，与 band 三档无关）
          </p>
        </Card>
      ) : null}

      {byError.length > 0 ? (
        <ErrorDistribution stats={byError} weeks={weeks} />
      ) : null}
    </div>
  );
}

/** 错误类型分布：计数 + 最近一次原句（AC-W4 跨次累计由后端 `seen_count` 完成）。 */
export function ErrorDistribution({ stats, weeks }: { stats: ReadonlyArray<ErrorTypeStat>; weeks?: number }) {
  const total = stats.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0);
  const maxCount = stats.reduce((max, item) => Math.max(max, item.count), 0);

  return (
    <Card title="错误类型分布" subtitle={`近 ${weeks ?? 8} 周，共 ${total} 条`}>
      <ul className="flex flex-col gap-2.5">
        {stats.map((stat) => (
          <li key={stat.error_type} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <Badge tone={maxCount > 0 && stat.count >= maxCount ? 'poor' : 'neutral'}>
                {errorTypeLabel(stat.error_type)}
              </Badge>
              <span className="font-code text-xs text-ink-secondary">{stat.count} 次</span>
            </div>
            <Bar
              value={stat.count}
              max={maxCount > 0 ? maxCount : 1}
              tone="accent"
              valueLabel={`${stat.count}`}
              label="出现次数"
            />
            {stat.latest_quote ? (
              <blockquote className="border-l-2 border-rule pl-2 text-xs text-ink-secondary">
                最近一次：{stat.latest_quote}
              </blockquote>
            ) : (
              <span className="text-xs text-ink-muted">最近一次原句未记录</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default Analytics;
