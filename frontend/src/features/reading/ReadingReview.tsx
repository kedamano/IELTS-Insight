/**
 * 阅读讲评（契约 §3-OR + FR-R4 / AC-R4）。
 *
 * 每条错题都给：`your_answer` / `expected` / `reason` / `answer_quote` + `answer_paragraph`（可跳转原文）
 * / `explanation_zh`（受 `settings.show_chinese_hints` 门控，FR-C）。
 *
 * FR-R4 硬要求：`true_false_notgiven` 必须区分「文中未提及」与「文中反驳」——
 * 单靠 TRUE/FALSE/NOTGIVEN 三个字母不足以表达这个差别，因此这里显式补一行中文判别语，
 * 并在考生把两者选反时点名「混淆点」。
 */
import { Badge, Bar, Button, Card, ScoreBand, Stat, cx, type Tone } from '../../components/ui';
import type {
  ObjectiveItemReason,
  ObjectiveReportItem,
  QuestionType,
  QuestionTypeTally,
  ReadingObjectiveReport,
} from '../../types/ielts';
import { QUESTION_TYPE_LABEL_ZH } from '../../types/ielts';
import type { ReadingSetView } from './readingDraft';

export const REASON_LABEL_ZH: Record<ObjectiveItemReason, string> = {
  wrong: '答案错误',
  over_word_limit: '超出字数上限',
  unanswered: '未作答',
  spelling_variant_rejected: '拼写变体未被接受',
};

export function reasonLabelZh(reason: ObjectiveItemReason | null | undefined): string | null {
  if (!reason) return null;
  return REASON_LABEL_ZH[reason] ?? String(reason);
}

/** 正确率 → 语义色档（讲评区的 Bar 配色）。 */
export function ratioTone(ratio: number): Tone {
  if (!Number.isFinite(ratio)) return 'poor';
  if (ratio >= 0.8) return 'good';
  if (ratio >= 0.5) return 'mid';
  return 'poor';
}

function upper(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

/** FR-R4：TRUE / FALSE / NOT GIVEN 的判别语（永远显示，与设置无关，因为它就是判分规则本身）。 */
export function tfngDistinctionZh(item: ObjectiveReportItem): string | null {
  if (item.type !== 'true_false_notgiven') return null;
  const expected = upper(item.expected);
  if (expected === 'NOTGIVEN' || expected === 'NOT GIVEN') {
    return 'NOT GIVEN ＝ 原文未提及该信息；不能因为「看起来不合理」就选 FALSE（那要求原文明确反驳）。';
  }
  if (expected === 'FALSE') {
    return 'FALSE ＝ 原文与该说法矛盾（明确反驳），不是未提及；对照下方引用句确认反驳点。';
  }
  if (expected === 'TRUE') {
    return 'TRUE ＝ 原文正面支持该说法（可用引用句逐字对应）。';
  }
  return null;
}

/** 考生混淆「未提及 / 反驳」时的点名提示（AC-R4 的错题解析必须能解释为什么错）。 */
export function tfngConfusionZh(item: ObjectiveReportItem): string | null {
  if (item.type !== 'true_false_notgiven' || item.correct) return null;
  const expected = upper(item.expected);
  const yours = upper(item.your_answer);
  const isNotGiven = (v: string) => v === 'NOTGIVEN' || v === 'NOT GIVEN';
  const both = [expected, yours].some(isNotGiven) && [expected, yours].some((v) => v === 'FALSE');
  if (!both) return null;
  const wrongChoice = isNotGiven(yours)
    ? '你把「原文反驳」当成了「未提及」：原文有 contradicting 表述，见引用句。'
    : '你把「未提及」当成了「原文反驳」：原文根本没有该信息，无法判定矛盾。';
  return `易错点：${wrongChoice}`;
}

export type ReadingReviewProps = {
  set: ReadingSetView;
  report: ReadingObjectiveReport;
  /** `settings.show_chinese_hints`（FR-C）。 */
  showChineseHints: boolean;
  onLocate: (label: string | null | undefined) => void;
  onExit?: () => void;
  className?: string;
};

const BAND_SCALE_LABEL_ZH: Record<string, string> = {
  reading_13q: '阅读 13 题制',
  reading_40q: '阅读 40 题制',
  listening_20q: '听力 20 题制',
  listening_40q: '听力 40 题制',
};

export function ReadingReview({
  set,
  report,
  showChineseHints,
  onLocate,
  onExit,
  className,
}: ReadingReviewProps) {
  const tallies = Object.entries(report.by_question_type ?? {}) as [QuestionType, QuestionTypeTally][];
  const scaleLabel = BAND_SCALE_LABEL_ZH[report.band_scale] ?? report.band_scale;
  const accuracyRatio = Number.isFinite(report.accuracy) ? report.accuracy : report.raw_total ? report.raw_correct / report.raw_total : 0;

  return (
    <div className={cx('flex min-h-0 flex-col gap-3', className)}>
      <Card
        title="本组成绩"
        subtitle={`${set.title_zh || set.title || set.id} · ${scaleLabel}`}
        actions={
          report.timed_out ? <Badge tone="poor">到时自动提交</Badge> : <Badge tone="good">正常提交</Badge>
        }
      >
        <div className="flex flex-wrap items-start gap-6">
          <ScoreBand band={report.band} label="Band" size="lg" hint={`${scaleLabel}对照表（§3-B）`} />
          <Stat label="正确题数" value={`${report.raw_correct}/${report.raw_total}`} size="sm" />
          <Stat
            label="正确率"
            value={Math.round(accuracyRatio * 100)}
            unit="%"
            size="sm"
            tone={ratioTone(accuracyRatio)}
          />
          {onExit ? (
            <Button variant="outline" size="sm" onClick={onExit}>
              再做一组
            </Button>
          ) : null}
        </div>
      </Card>

      {tallies.length > 0 ? (
        <Card title="按题型正确率" subtitle="同一套题内的分题型统计（FR-R4）">
          <div className="flex flex-col gap-2.5">
            {tallies.map(([type, tally]) => {
              const ratio = tally.total > 0 ? tally.correct / tally.total : 0;
              return (
                <Bar
                  key={type}
                  value={tally.correct}
                  max={Math.max(1, tally.total)}
                  tone={ratioTone(ratio)}
                  label={QUESTION_TYPE_LABEL_ZH[type] ?? type}
                  valueLabel={`${tally.correct}/${tally.total}（${Math.round(ratio * 100)}%）`}
                />
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card title="逐题解析" subtitle="错题给出中文解析与原文引用；点「定位到原文」跳转段落">
        <ol className="flex flex-col">
          {report.items.map((item, index) => {
            const answered = (item.your_answer ?? '').trim() !== '';
            const distinction = tfngDistinctionZh(item);
            const confusion = tfngConfusionZh(item);
            return (
              <li
                key={item.id}
                data-review-item={item.id}
                className={cx(
                  'flex flex-col gap-1.5 border-b border-rule py-3',
                  index === report.items.length - 1 && 'border-b-0',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-code text-sm text-accent">{item.number}.</span>
                  <Badge tone="neutral">{QUESTION_TYPE_LABEL_ZH[item.type] ?? item.type}</Badge>
                  {item.correct ? (
                    <Badge tone="good" dot>
                      正确
                    </Badge>
                  ) : (
                    <Badge tone="poor" dot>
                      错误
                    </Badge>
                  )}
                  {item.answer_paragraph ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      aria-label={`定位第 ${item.number} 题原文`}
                      onClick={() => onLocate(item.answer_paragraph)}
                    >
                      定位到原文（段落 {item.answer_paragraph}）
                    </Button>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-1 pl-6 text-sm sm:grid-cols-[auto_auto_1fr] sm:items-baseline sm:gap-3">
                  <span className="text-xs text-ink-muted">你的作答</span>
                  <span
                    className="font-code"
                    style={{ color: item.correct ? 'var(--band-good)' : 'var(--band-poor)' }}
                  >
                    {answered ? item.your_answer : '未作答'}
                  </span>
                  <span className="text-xs text-ink-secondary">
                    正确答案：<span className="font-code text-accent">{item.expected ?? '—'}</span>
                    {item.accepted_alternatives?.length ? (
                      <span className="ml-1 text-ink-muted">
                        （也可接受：{item.accepted_alternatives.join(' / ')}）
                      </span>
                    ) : null}
                  </span>
                </div>

                {item.correct ? null : (
                  <p className="pl-6 text-xs text-ink-secondary">
                    判分原因：{reasonLabelZh(item.reason) ?? '答案错误'}
                  </p>
                )}

                {distinction ? (
                  <p className="pl-6 text-xs text-ink-secondary" data-tfng-distinction="true">
                    判别：{distinction}
                  </p>
                ) : null}

                {confusion ? (
                  <p className="pl-6 text-xs" style={{ color: 'var(--band-mid)' }} data-tfng-confusion="true">
                    {confusion}
                  </p>
                ) : null}

                {item.answer_quote ? (
                  <blockquote className="ml-6 border-l-2 border-accent bg-paper-sunken px-2.5 py-1.5 text-xs italic text-ink-secondary">
                    <span className="mr-1 font-code not-italic text-accent">
                      {item.answer_paragraph ? `段落 ${item.answer_paragraph}：` : ''}
                    </span>
                    “{item.answer_quote}”
                  </blockquote>
                ) : null}

                {showChineseHints && item.explanation_zh ? (
                  <p className="pl-6 text-sm text-ink" data-explanation={item.id}>
                    {item.explanation_zh}
                  </p>
                ) : null}

                {!showChineseHints && !item.correct && item.explanation_zh ? (
                  <p className="pl-6 text-xs text-ink-muted">中文解析已按设置隐藏（设置 → 显示中文解析）。</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

export default ReadingReview;
