/**
 * 分项 Band（spec §4.2 报告页的第二项）。
 *
 * 客观题（听力 / 阅读）只有一个标量 band，它的「分项」就是题型正确率（见 `Analytics`）；
 * 真正有四维度的是口语与写作（契约 §3-S / §3-W），所以这里只渲染这两科最近一次评分的四维。
 *
 * 数据来源是诚实的：`GET /attempts?module=&limit=1` 拿到最近一条，
 * 列表里若带 `band_sub` 就直接用，否则回读 `GET /attempts/{id}` 的报告对象。
 * 拿不到就是 `null` → `ScoreBand` 显示「尚无数据」，绝不猜分、也绝不出现 NaN。
 */
import { Badge, Card, ScoreBand } from '../../components/ui';
import { attempt, attempts } from '../../services/api';
import type { ApiRequestOptions } from '../../services/api';
import {
  MODULES,
  MODULE_LABEL_ZH,
  SPEAKING_CRITERIA,
  SPEAKING_CRITERION_LABEL,
  WRITING_CRITERIA,
  WRITING_CRITERION_LABEL,
  isSpeakingReport,
  isWritingReport,
  type AiMeta,
  type Module,
  type NullableBand,
} from '../../types/ielts';
import { AiMetaBadge } from './AttemptReport';
import { formatDateTime } from './format';

export interface CriterionBandItem {
  key: string;
  zh: string;
  abbr: string;
  band: NullableBand;
}

export interface CriterionEntry {
  module: Module;
  attemptId: string;
  title: string;
  createdAt: string;
  overall: NullableBand;
  items: CriterionBandItem[];
  meta: AiMeta;
  /** 口语无音频时发音分由转写推断（FR-S4），如实标注。 */
  pronunciationConfidence: 'high' | 'low' | null;
}

function toBand(value: unknown): NullableBand {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 四维列表按各自的 criterion 联合类型取标签；分开两条分支才能让 `labels[key]` 通过索引检查。 */
function criterionItems<K extends string>(
  criteria: readonly K[],
  labels: Record<K, { abbr: string; zh: string }>,
  source: Record<string, unknown>,
): CriterionBandItem[] {
  return criteria.map((key) => ({
    key,
    zh: labels[key].zh,
    abbr: labels[key].abbr,
    band: toBand(source[key]),
  }));
}

/** 最近一次的口语 / 写作四维（其余两科没有维度分，跳过）。 */
export async function loadCriterionBands(options: ApiRequestOptions): Promise<CriterionEntry[]> {
  const lists = await Promise.all(
    MODULES.map((module) => attempts({ module, limit: 1, offset: 0 }, options).catch(() => null)),
  );

  const entries: CriterionEntry[] = [];
  for (const list of lists) {
    const summary = list?.items?.[0];
    if (!summary || (summary.module !== 'speaking' && summary.module !== 'writing')) continue;

    const speaking = summary.module === 'speaking';

    let source: Record<string, unknown> = {};
    const sub = summary.band_sub;
    if (sub && typeof sub === 'object') source = { ...sub };
    let pronunciationConfidence: 'high' | 'low' | null = null;

    // 列表未带维度（当前后端 `_attempt_summary` 就省略了 band_sub）→ 回读详情报告。
    if (Object.keys(source).length === 0) {
      try {
        const detail = await attempt(summary.id, options);
        if (isSpeakingReport(detail.payload)) {
          source = { ...detail.payload.band };
          pronunciationConfidence = detail.payload.band.pronunciation_confidence ?? null;
        } else if (isWritingReport(detail.payload)) {
          source = { ...detail.payload.band };
        }
      } catch {
        // 详情失败：四维全部显示「尚无数据」，总分仍来自列表，不做任何猜测。
      }
    }

    entries.push({
      module: summary.module,
      attemptId: summary.id,
      title: summary.title_zh ?? summary.topic ?? summary.task_ref,
      createdAt: summary.created_at,
      overall: toBand(summary.band_overall),
      items: speaking
        ? criterionItems(SPEAKING_CRITERIA, SPEAKING_CRITERION_LABEL, source)
        : criterionItems(WRITING_CRITERIA, WRITING_CRITERION_LABEL, source),
      meta: {
        ai_used: summary.ai_used,
        approximate: summary.approximate,
        degraded_reason: summary.degraded_reason ?? undefined,
        model: summary.model ?? null,
      },
      pronunciationConfidence,
    });
  }
  return entries;
}

export interface CriterionBandsProps {
  entries: ReadonlyArray<CriterionEntry>;
  loading: boolean;
  error: string | null;
  className?: string;
}

export function CriterionBands({ entries, loading, error, className }: CriterionBandsProps) {
  return (
    <Card
      title="分项 Band"
      subtitle="口语 / 写作四维，取各科最近一次评分"
      className={className}
    >
      {error ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--band-poor)' }}>
          {error}
        </p>
      ) : loading && entries.length === 0 ? (
        <p role="status" className="text-sm text-ink-muted">
          正在读取最近一次评分…
        </p>
      ) : entries.length === 0 ? (
        <p role="status" className="text-sm text-ink-secondary">
          尚无口语或写作评分：完成一次口语或写作练习后，四个维度的 band 会自动出现在这里。
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map((entry) => (
            <div key={entry.attemptId} className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{MODULE_LABEL_ZH[entry.module]}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.title}</span>
                <AiMetaBadge meta={entry.meta} />
                <span className="font-code text-xs text-ink-muted">{formatDateTime(entry.createdAt)}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <ScoreBand band={entry.overall} label="Overall 总分" size="sm" />
                {entry.items.map((item) => (
                  <ScoreBand
                    key={item.key}
                    band={item.band}
                    label={`${item.zh} ${item.abbr}`}
                    size="sm"
                    hint={
                      item.key === 'pronunciation' && entry.pronunciationConfidence === 'low'
                        ? '未取到音频，发音分由转写推断'
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-ink-muted">
            听力与阅读是客观题，只有单一 band；它们的分项表现即下方「题型正确率」。
          </p>
        </div>
      )}
    </Card>
  );
}

export default CriterionBands;
