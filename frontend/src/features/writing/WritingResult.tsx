/**
 * WritingResult —— §3-W / FR-W3 / AC-W3 的批改视图。
 *
 * 视觉优先级：降级标记 → 总分 band → 四维（TR/CC/LR/GRA）→ 字数与惩罚 → 逐句批改 →
 * 句子升级 → 段落结构 → 优点 → 范文。
 * CONSTITUTION §3：`ai_used === false`（含 `approximate`）时顶部与标题行同时挂「降级」标记，
 * 并明说这是近似分，绝不把本地模板结果表述成真实 AI 评分（AC-G3/AC-G5）。
 * AC-W3b：`word_count_penalty` 与 `band.task_response ≤ 5.0` 是同一条规则的两侧，这里并列显示。
 */
import { Bar, Badge, Button, Card, ScoreBand, Stat, Toast, bandTone } from '../../components/ui';
import type {
  CorrectionSeverity,
  WritingCriterion,
  WritingErrorType,
  WritingReport,
  WritingTask,
} from '../../types/ielts';
import {
  WRITING_CRITERIA,
  WRITING_CRITERION_LABEL,
  WRITING_ERROR_LABEL_ZH,
  degradedLabelZh,
  formatBand,
} from '../../types/ielts';
import { STRUCTURE_ISSUE_KIND_LABEL_ZH, TASK2_QUESTION_TYPE_LABEL_ZH, penaltyDetailOf } from './writingSets';

export type WritingResultProps = {
  report: WritingReport;
  /** 用来解释 `min_words` 与 Task 1/2 差异；为 null 时只按报告自身渲染。 */
  task: WritingTask | null;
  onPracticeAgain?: () => void;
  onChangeTask?: () => void;
};

const SEVERITY_TONE: Record<CorrectionSeverity, 'poor' | 'mid' | 'neutral'> = {
  high: 'poor',
  medium: 'mid',
  low: 'neutral',
};

const SEVERITY_LABEL_ZH: Record<CorrectionSeverity, string> = {
  high: '必改',
  medium: '建议改',
  low: '可优化',
};

const CRITERION_HINT_ZH: Record<WritingCriterion, string> = {
  task_response: '是否覆盖任务要求、立场与主要特征',
  coherence_cohesion: '分段、指代与连接手段是否自然',
  lexical_resource: '用词宽度、搭配与准确性',
  grammatical_range_accuracy: '句式多样度与错误密度',
};

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}|\r\n\r\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function WritingResult({ report, task, onPracticeAgain, onChangeTask }: WritingResultProps) {
  const degraded = report.ai_used === false || report.approximate === true;
  const label = degradedLabelZh(report);
  const penalty = penaltyDetailOf(report.word_count_penalty);
  const minWords = task?.min_words ?? penalty?.minWords ?? 0;
  const taskResponse = report.band.task_response;
  const summary = Object.entries(report.error_summary) as [WritingErrorType, number][];
  const kindLabel = report.task === 'task2' ? 'Task 2' : 'Task 1';
  const questionTypeLabel = task && task.task === 'task2' ? TASK2_QUESTION_TYPE_LABEL_ZH[task.question_type] : null;
  const subtitle = [kindLabel, questionTypeLabel, `attempt ${report.attempt_id}`].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-3">
      {degraded ? (
        <Toast tone="warn">
          <span className="font-medium">已降级：{label}</span>
          <span className="text-ink-secondary">
            {' '}
            —— 以下四维与总分是<strong>近似分</strong>（由本地规则估算，不是 AI 精确评分），请勿当作真实 band 记录。
          </span>
        </Toast>
      ) : null}

      <Card
        title="写作批改结果"
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {degraded ? (
              <Badge tone="mid" dot title={report.degraded_reason ?? undefined}>
                降级 · {label}
              </Badge>
            ) : (
              <Badge tone="good" dot>
                AI 评分{report.model ? ` · ${report.model}` : ''}
              </Badge>
            )}
            {onChangeTask ? (
              <Button size="sm" variant="ghost" onClick={onChangeTask}>
                换一题
              </Button>
            ) : null}
            {onPracticeAgain ? (
              <Button size="sm" variant="outline" onClick={onPracticeAgain}>
                再练一次
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="flex flex-wrap items-start gap-6">
          <ScoreBand
            band={report.band.overall}
            label="总分 Band"
            size="lg"
            hint={degraded ? '近似总分，非 AI 精确评分' : '四维平均后按 0.5 夹紧'}
          />
          <ul className="flex min-w-64 flex-1 flex-col gap-2.5">
            {WRITING_CRITERIA.map((criterion: WritingCriterion) => {
              const meta = WRITING_CRITERION_LABEL[criterion];
              const value = report.band[criterion];
              const tone = bandTone(value);
              return (
                <li key={criterion} className="flex flex-col gap-1.5 border-b border-rule pb-2 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-baseline gap-2">
                      <span className="font-code text-xs text-accent">{meta.abbr}</span>
                      <span className="text-sm text-ink">{meta.zh}</span>
                      <span className="text-xs text-ink-muted">{meta.full}</span>
                    </span>
                    <ScoreBand band={value} label="" showAxis={false} size="sm" />
                  </div>
                  {value === null || value === undefined ? (
                    <p className="text-xs text-ink-muted">该维度本次没有评分（{label}）。</p>
                  ) : (
                    <Bar value={value} max={9} tone={tone ?? 'accent'} valueLabel={`${formatBand(value)} / 9.0`} />
                  )}
                  <p className="text-xs text-ink-muted">{CRITERION_HINT_ZH[criterion]}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      <Card title="字数与硬性规则" subtitle={minWords ? `本任务最低 ${minWords} 词（FR-W2 / AC-W3b）` : '字数规则'}>
        <div className="flex flex-wrap items-start gap-6">
          <Stat label="词数" value={report.word_count} unit="词" mono size="md" tone={penalty ? 'poor' : 'good'} />
          {minWords ? (
            <div className="min-w-52 flex-1">
              <Bar
                value={Math.min(report.word_count, minWords)}
                max={minWords}
                tone={penalty ? 'poor' : 'good'}
                label={`达线进度 ${Math.min(report.word_count, minWords)}/${minWords}`}
                valueLabel={`${Math.min(100, Math.round((report.word_count / minWords) * 100))}%`}
              />
            </div>
          ) : null}
        </div>

        {penalty ? (
          <div className="mt-3 flex flex-col gap-1.5 rounded-card border border-rule bg-paper-sunken px-3 py-2">
            <Badge tone="poor" dot title={penalty.kind}>
              字数惩罚 · 未达线
            </Badge>
            <p className="text-sm" style={{ color: 'var(--band-poor)' }}>
              未达最低字数：{penalty.missingWords !== null ? <>还差 {penalty.missingWords} 词。</> : '官方下限在本任务说明中给出。'}
            </p>
            {penalty.noteZh ? <p className="text-xs text-ink-secondary">{penalty.noteZh}</p> : null}
            <p className="text-xs text-ink-secondary">
              后端在调用 AI 之前就给出本条硬性提示（AC-W3b），并按官方规则把
              <span className="font-code"> task_response </span>
              上限夹到 5.0 —— 当前显示 {formatBand(taskResponse)}。补齐字数后重交即可解除该上限。
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-secondary">字数已达线，未触发字数惩罚。</p>
        )}
      </Card>

      <Card title="逐句批改" subtitle={`错误按 FR-W4 七类归入错题本 · 共 ${report.corrections.length} 条`}>
        {report.corrections.length ? (
          <ol className="flex flex-col gap-2">
            {report.corrections.map((item, index) => (
              <li key={`${item.quote}-${index}`} className="flex flex-col gap-1.5 rounded-control bg-paper-sunken px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{WRITING_ERROR_LABEL_ZH[item.error_type] ?? item.error_type}</Badge>
                  <Badge tone={SEVERITY_TONE[item.severity]} variant="outline">
                    {SEVERITY_LABEL_ZH[item.severity]}
                  </Badge>
                </div>
                <p className="font-serif text-sm text-ink">
                  <span className="text-ink-muted line-through">{item.quote}</span>
                  <span aria-hidden="true" className="mx-2 text-ink-muted">
                    →
                  </span>
                  <span style={{ color: 'var(--band-good)' }}>{item.suggestion}</span>
                </p>
                <p className="text-xs text-ink-secondary">{item.explanation_zh}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-muted">本次没有逐句错误批改（离线近似批改通常不产出该项，属正常降级）。</p>
        )}

        {summary.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-2">
            <span className="text-xs text-ink-muted">错误类型分布</span>
            {summary.map(([type, count]) => (
              <Badge key={type} variant="outline">
                {WRITING_ERROR_LABEL_ZH[type] ?? type} {count}
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>

      <Card title="句子升级" subtitle={`高档改写（FR-W3 要求 ≥3 句，本次 ${report.upgraded_sentences.length} 句）`}>
        {report.upgraded_sentences.length ? (
          <ul className="flex flex-col gap-2">
            {report.upgraded_sentences.map((item, index) => (
              <li key={`${item.from}-${index}`} className="rounded-card border border-rule bg-paper px-3 py-2">
                <p className="font-serif text-sm text-ink">
                  <span className="text-ink-muted">{item.from}</span>
                  <span aria-hidden="true" className="mx-2 text-ink-muted">
                    →
                  </span>
                  <span className="text-accent">{item.to}</span>
                </p>
                <p className="mt-1 text-xs text-ink-secondary">{item.why_zh}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">本次没有可展示的升级句。</p>
        )}
      </Card>

      <Card title="段落结构" subtitle="是否回应题目、连接是否机械（FR-W3）">
        {report.structure_issues.length ? (
          <ul className="flex flex-col gap-2">
            {report.structure_issues.map((item, index) => (
              <li key={`${item.kind}-${index}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Badge tone="mid" title={item.kind}>
                  {STRUCTURE_ISSUE_KIND_LABEL_ZH[item.kind] ?? item.kind}
                </Badge>
                {item.paragraph_index != null ? (
                  <span className="font-code text-xs text-ink-muted">第 {item.paragraph_index} 段</span>
                ) : null}
                <span className="text-ink">{item.issue_zh}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">没有段落层面的结构问题。</p>
        )}
      </Card>

      {report.strengths.length ? (
        <Card title="做得好的地方" subtitle={`共 ${report.strengths.length} 条`}>
          <ul className="list-disc pl-5 text-sm text-ink-secondary">
            {report.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="范文"
        subtitle={
          report.task === 'task2'
            ? `Task 2 参考范文（FR-W3：≥260 词）${
                task && task.task === 'task2' ? ` · ${TASK2_QUESTION_TYPE_LABEL_ZH[task.question_type]}` : ''
              }`
            : 'Task 1 参考范文（FR-W3：≥150 词）'
        }
      >
        {report.model_answer ? (
          <div className="flex flex-col gap-2">
            {paragraphsOf(report.model_answer).map((paragraph, index) => (
              <p key={index} className="font-serif text-sm leading-relaxed text-ink">
                {paragraph}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">（无范文{degraded ? '：降级结果不产出范文' : ''}）</p>
        )}
      </Card>

      <p className="text-xs text-ink-muted">
        总分由四维平均后按 0.5 夹紧（FR-G5），当前 {formatBand(report.band.overall)}；
        错误句由后端写入错题本，可在错题本按类型看跨次趋势（AC-W4）。
      </p>
    </div>
  );
}

export default WritingResult;
