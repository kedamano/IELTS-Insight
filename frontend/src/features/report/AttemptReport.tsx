import { Badge, Bar, Card, ScoreBand, cx } from '../../components/ui';
import {
  MODULE_LABEL_ZH,
  QUESTION_TYPE_LABEL_ZH,
  SPEAKING_CRITERIA,
  SPEAKING_CRITERION_LABEL,
  WRITING_CRITERIA,
  WRITING_CRITERION_LABEL,
  degradedLabelZh,
  formatBand,
  isObjectiveReport,
  isSpeakingReport,
  isWritingReport,
  type AiMeta,
  type ObjectiveItemReason,
  type ObjectiveReport,
  type SpeakingReport,
  type WritingErrorType,
  type WritingReport,
  type ModuleReport,
} from '../../types/ielts';

/** AI 元信息必须诚实（CONSTITUTION §3）：AI 评分 / 离线近似 / 降级原因都直接写出来。 */
export function AiMetaBadge({ meta, className }: { meta: AiMeta; className?: string }) {
  const label = degradedLabelZh(meta);
  const tone = meta.ai_used ? 'accent' : meta.approximate ? 'mid' : 'neutral';
  return (
    <span className={cx('flex flex-wrap items-center gap-1.5', className)}>
      <Badge tone={tone}>{label}</Badge>
      {meta.ai_used && meta.approximate ? <Badge tone="mid">近似分</Badge> : null}
      {meta.model ? <span className="font-code text-xs text-ink-muted">{meta.model}</span> : null}
    </span>
  );
}

const REASON_LABEL_ZH: Record<ObjectiveItemReason, string> = {
  wrong: '答案错误',
  over_word_limit: '超出字数上限',
  unanswered: '未作答',
  spelling_variant_rejected: '拼写变体未被接受',
};

/** 口语报告（契约 §3-S）：四维 band + 证据原句 + 改进 + 范文 + 发音细节折叠区（FR-V3）。 */
export function SpeakingReportView({ report }: { report: SpeakingReport }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ScoreBand band={report.band.overall} label="Overall 总分" size="lg" hint="四维平均后按 0.5 夹紧" />
        {SPEAKING_CRITERIA.map((criterion) => {
          const meta = SPEAKING_CRITERION_LABEL[criterion];
          return (
            <ScoreBand
              key={criterion}
              band={report.band[criterion]}
              label={`${meta.abbr} ${meta.zh}`}
              size="sm"
              hint={
                criterion === 'pronunciation' && report.band.pronunciation_confidence === 'low'
                  ? '无音频，由转写文本推断（低置信）'
                  : meta.full
              }
            />
          );
        })}
      </div>

      <section className="flex flex-col gap-2">
        <h4 className="font-serif text-sm text-ink">评分证据（考生原句）</h4>
        {report.evidence.length === 0 ? (
          <p className="text-sm text-ink-muted">本次报告没有可引用的原句证据。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.evidence.map((item, index) => (
              <li key={`${item.criterion}-${index}`} className="border-l-2 border-rule pl-2 text-sm">
                <span className="mr-2 font-code text-xs text-ink-muted">
                  {SPEAKING_CRITERION_LABEL[item.criterion]?.abbr ?? item.criterion}
                  {item.level ? ` · ${item.level}` : ''}
                </span>
                「{item.quote}」
                <p className="mt-0.5 text-xs text-ink-secondary">{item.why}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="font-serif text-sm text-ink">改进建议</h4>
        {report.improvements.length === 0 ? (
          <p className="text-sm text-ink-muted">未给出改进建议。</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {report.improvements.map((item, index) => (
              <li key={index} className="rounded-card border border-rule bg-paper-sunken px-2.5 py-2 text-sm">
                <p className="text-ink">问题：{item.issue}</p>
                <p className="mt-0.5 text-ink-secondary">改法：{item.fix}</p>
                {item.quote ? <p className="mt-0.5 text-xs text-ink-muted">原句：{item.quote}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {report.strengths.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="font-serif text-sm text-ink">做得好的地方</h4>
          <ul className="list-disc pl-5 text-sm text-ink-secondary">
            {report.strengths.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.upgrade_vocabulary.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="font-serif text-sm text-ink">词汇升级（FR-S5）</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {report.upgrade_vocabulary.map((item, index) => (
              <li key={`${item.from}-${index}`} className="flex flex-wrap items-baseline gap-2">
                <span className="font-code text-ink-muted">{item.from}</span>
                <span aria-hidden="true" className="text-ink-muted">
                  →
                </span>
                <span className="font-code text-ink">{item.to}</span>
                {item.note_zh ? <span className="text-xs text-ink-secondary">{item.note_zh}</span> : null}
                {item.source ? <span className="text-xs text-ink-muted">来源 {item.source}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="rounded-card border border-rule bg-paper-sunken px-2.5 py-2">
        <summary className="cursor-pointer text-sm text-ink">表达细节</summary>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-ink-muted">词数</dt>
            <dd className="font-code">{report.metrics.word_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">语速 WPM</dt>
            <dd className="font-code">{report.metrics.wpm}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">停顿合计</dt>
            <dd className="font-code">{report.metrics.pause_total_sec} 秒</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">重复次数</dt>
            <dd className="font-code">{report.metrics.repeats}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-ink-muted">填充词</dt>
            <dd className="text-ink-secondary">{report.metrics.fillers.join(' · ') || '未检出'}</dd>
          </div>
        </dl>
      </details>

      <details className="rounded-card border border-rule bg-paper-sunken px-2.5 py-2">
        <summary className="cursor-pointer text-sm text-ink">发音细节（折叠区，FR-V3）</summary>
        <p className="mt-2 text-xs text-ink-secondary">
          WER {(report.pronunciation_detail.wer * 100).toFixed(0)}% · 辅助分{' '}
          <span className="font-code">{report.pronunciation_detail.score_0_100}</span> / 100
          <span className="ml-1 text-ink-muted">（0–100 仅作辅助，主分数仍是 Band）</span>
        </p>
        {report.pronunciation_detail.problem_words.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {report.pronunciation_detail.problem_words.map((word, index) => (
              <li key={`${word.word}-${index}`} className="flex items-center gap-2">
                <span className="font-code text-ink">{word.word}</span>
                <span className="font-code text-xs text-ink-muted">
                  期望 {word.expected} · 实际 {word.actual}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">未检出问题词。</p>
        )}
      </details>

      {report.model_answer ? (
        <details className="rounded-card border border-rule px-2.5 py-2">
          <summary className="cursor-pointer text-sm text-ink">示范回答（高一档）</summary>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{report.model_answer}</p>
        </details>
      ) : null}
    </div>
  );
}

/** 写作报告（契约 §3-W）：四维 + 字数惩罚 + 逐句批改 + 结构问题 + 范文。 */
export function WritingReportView({ report }: { report: WritingReport }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <ScoreBand band={report.band.overall} label="Overall 总分" size="lg" />
        {WRITING_CRITERIA.map((criterion) => {
          const meta = WRITING_CRITERION_LABEL[criterion];
          return (
            <ScoreBand
              key={criterion}
              band={report.band[criterion]}
              label={`${meta.abbr} ${meta.zh}`}
              size="sm"
              hint={meta.full}
            />
          );
        })}
      </div>

      <p className="text-sm text-ink-secondary">
        {report.task === 'task1' ? 'Task 1' : 'Task 2'} · 字数 <span className="font-code">{report.word_count}</span>
        {report.word_count_penalty ? (
          <Badge tone="poor" className="ml-2">
            字数不足，缺 {report.word_count_penalty.missing_words} 词（TR 上限夹到 5.0）
          </Badge>
        ) : null}
      </p>

      <section className="flex flex-col gap-2">
        <h4 className="font-serif text-sm text-ink">逐句批改</h4>
        {report.corrections.length === 0 ? (
          <p className="text-sm text-ink-muted">本次没有检出需要修改的句子。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.corrections.map((item, index) => (
              <li key={index} className="rounded-card border border-rule bg-paper-sunken px-2.5 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.severity === 'high' ? 'poor' : item.severity === 'medium' ? 'mid' : 'neutral'}>
                    {item.severity === 'high' ? '高' : item.severity === 'medium' ? '中' : '低'}
                  </Badge>
                  <span className="font-code text-xs text-ink-muted">{item.error_type}</span>
                </div>
                <p className="mt-1 text-ink">原句：{item.quote}</p>
                <p className="mt-0.5 text-ink-secondary">建议：{item.suggestion}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{item.explanation_zh}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {Object.keys(report.error_summary).length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="font-serif text-sm text-ink">错误类型汇总</h4>
          <ul className="flex flex-col gap-2">
            {Object.entries(report.error_summary).map(([type, count]) => (
              <li key={type}>
                <Bar
                  value={count ?? 0}
                  max={Math.max(1, ...Object.values(report.error_summary).map((value) => value ?? 0))}
                  tone="accent"
                  label={type as WritingErrorType}
                  valueLabel={`${count ?? 0} 处`}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.upgraded_sentences.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="font-serif text-sm text-ink">高档改写</h4>
          <ul className="flex flex-col gap-2 text-sm">
            {report.upgraded_sentences.map((item, index) => (
              <li key={index} className="border-l-2 border-rule pl-2">
                <p className="text-ink-muted">原：{item.from}</p>
                <p className="mt-0.5 text-ink">改：{item.to}</p>
                <p className="mt-0.5 text-xs text-ink-secondary">{item.why_zh}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.structure_issues.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="font-serif text-sm text-ink">段落结构问题</h4>
          <ul className="list-disc pl-5 text-sm text-ink-secondary">
            {report.structure_issues.map((issue, index) => (
              <li key={index}>
                {issue.issue_zh}
                {issue.paragraph_index != null ? (
                  <span className="ml-1 font-code text-xs text-ink-muted">第 {issue.paragraph_index} 段</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.strengths.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h4 className="font-serif text-sm text-ink">优势</h4>
          <ul className="list-disc pl-5 text-sm text-ink-secondary">
            {report.strengths.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.model_answer ? (
        <details className="rounded-card border border-rule px-2.5 py-2">
          <summary className="cursor-pointer text-sm text-ink">范文</summary>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{report.model_answer}</p>
        </details>
      ) : null}
    </div>
  );
}

/** 客观题报告（听力/阅读共用，契约 §3-OR）：原始分是辅助，主视觉是 band。 */
export function ObjectiveReportView({ report }: { report: ObjectiveReport }) {
  const correct = report.raw_correct;
  const total = report.raw_total;
  const byType = Object.entries(report.by_question_type ?? {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <ScoreBand band={report.band} label={`${MODULE_LABEL_ZH[report.module]} Band`} size="lg" />
        <div className="w-48">
          <Bar
            value={correct}
            max={total > 0 ? total : 1}
            tone="accent"
            label="答对题数"
            valueLabel={`${correct}/${total}（${Math.round((report.accuracy || 0) * 100)}%）`}
          />
          <p className="mt-1 text-xs text-ink-muted">换算表：{report.band_scale}</p>
        </div>
      </div>

      {byType.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="font-serif text-sm text-ink">按题型</h4>
          <ul className="flex flex-col gap-2">
            {byType.map(([type, tally]) =>
              tally ? (
                <li key={type}>
                  <Bar
                    value={tally.correct}
                    max={tally.total > 0 ? tally.total : 1}
                    tone="accent"
                    label={QUESTION_TYPE_LABEL_ZH[type as keyof typeof QUESTION_TYPE_LABEL_ZH] ?? type}
                    valueLabel={`${tally.correct}/${tally.total}`}
                  />
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h4 className="font-serif text-sm text-ink">逐题结果</h4>
        {report.items.length === 0 ? (
          <p className="text-sm text-ink-muted">本次记录没有逐题明细。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.items.map((item) => (
              <li
                key={item.id}
                className={cx(
                  'rounded-card border bg-paper-sunken px-2.5 py-2 text-sm',
                  item.correct ? 'border-rule' : 'border-band-poor',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-code text-xs text-ink-muted">{item.number}.</span>
                  <Badge tone={item.correct ? 'good' : 'poor'}>{item.correct ? '正确' : '错误'}</Badge>
                  <span className="text-xs text-ink-secondary">
                    {QUESTION_TYPE_LABEL_ZH[item.type] ?? item.type}
                  </span>
                  {item.reason ? (
                    <span className="font-code text-xs text-ink-muted">
                      {REASON_LABEL_ZH[item.reason] ?? item.reason}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-ink">
                  你的答案：<span className="font-code">{item.your_answer || '（未作答）'}</span>
                  <span className="mx-2 text-ink-muted">|</span>
                  正确答案：<span className="font-code">{item.expected || '—'}</span>
                </p>
                {item.accepted_alternatives && item.accepted_alternatives.length > 0 ? (
                  <p className="mt-0.5 text-xs text-ink-muted">
                    可接受写法：{item.accepted_alternatives.join(' · ')}
                  </p>
                ) : null}
                {item.answer_quote ? (
                  <p className="mt-0.5 text-xs text-ink-secondary">
                    定位{item.answer_paragraph ? `（${item.answer_paragraph} 段）` : ''}：{item.answer_quote}
                  </p>
                ) : null}
                {!item.correct && item.explanation_zh ? (
                  <p className="mt-1 text-xs text-ink-secondary">{item.explanation_zh}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {'transcript' in report && report.transcript ? (
        <details className="rounded-card border border-rule px-2.5 py-2">
          <summary className="cursor-pointer text-sm text-ink">听力原文（精读模式）</summary>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{report.transcript}</p>
        </details>
      ) : null}
    </div>
  );
}

/**
 * 按 payload 形状选报告变体（契约 §10.2：客观题 `band` 是标量、口语/写作是对象）。
 * 判别一律用 `types/ielts.ts` 的类型守卫，不在组件里重新发明字段判断。
 */
export function AttemptReport({ report }: { report: ModuleReport }) {
  if (isSpeakingReport(report)) return <SpeakingReportView report={report} />;
  if (isWritingReport(report)) return <WritingReportView report={report} />;
  if (isObjectiveReport(report)) return <ObjectiveReportView report={report} />;
  return (
    <Card title="报告格式无法识别">
      <p className="text-sm text-ink-secondary">
        该记录缺少 band 字段，无法渲染评分报告。可能是后端旧数据；可在「练习存档」中删除这条记录。
      </p>
    </Card>
  );
}

/** 列表行的分数：客观/主观统一从 `band_overall` 取，null → `—`（不出现 NaN）。 */
export function attemptBandLabel(band: number | null | undefined): string {
  return formatBand(band);
}

export default AttemptReport;
