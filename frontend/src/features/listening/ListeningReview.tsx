/**
 * ListeningReview —— 听力批改视图（契约 §3-OR、AC-L2、AC-L4、AC-G5）。
 *
 * 主视觉只有一个 0–9 band（AC-G5）；`raw_correct/raw_total`、正确率、题型分布都是辅助信息。
 * 中文解析（`explanation_zh`）仅在 `settings.show_chinese_hints` 为真时出现（AC-L4）。
 * 错题进错题本由后端在 attempt 落库时完成（FR-V2），前端不再重复写。
 */
import { Badge, Bar, Button, Card, ScoreBand, Stat, cx } from '../../components/ui';
import type { ListeningObjectiveReport, ObjectiveReportItem } from '../../types/ielts';
import { formatBand } from '../../types/ielts';
import DegradationNotice from '../speaking/DegradationNotice';
import {
  accuracyPercent,
  bandScaleLabel,
  numberLabel,
  reasonLabelZh,
  tallyList,
  typeLabel,
} from './listeningSets';

export type ListeningReviewProps = {
  report: ListeningObjectiveReport;
  /** `settings.show_chinese_hints` */
  showChineseHints: boolean;
  onPracticeAgain?: () => void;
  /** 题面（用于把 `expected` 显示在对应题型旁，可缺省） */
  questionsPrompt?: (itemId: string) => string | null;
};

const TONE_BY_CORRECT = { good: '对', poor: '错' } as const;

function itemTone(correct: boolean) {
  return correct ? 'good' : 'poor';
}

function ItemRow({
  item,
  showChineseHints,
  prompt,
}: {
  item: ObjectiveReportItem;
  showChineseHints: boolean;
  prompt: string | null;
}) {
  const reason = reasonLabelZh(item.reason);
  const alternatives = (item.accepted_alternatives ?? []).filter(Boolean);

  return (
    <li className="flex flex-col gap-1.5 rounded-control bg-paper-sunken px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-code text-sm text-ink-secondary">{numberLabel(item.number)}</span>
        <Badge tone={itemTone(item.correct)} dot>
          {TONE_BY_CORRECT[item.correct ? 'good' : 'poor']}
        </Badge>
        <Badge variant="outline">{typeLabel(item.type)}</Badge>
        {reason ? <Badge tone={item.correct ? 'neutral' : 'mid'}>{reason}</Badge> : null}
        {typeof item.time_spent_sec === 'number' ? (
          <span className="font-code text-xs text-ink-muted">{item.time_spent_sec}s</span>
        ) : null}
      </div>

      {prompt ? <p className="text-sm leading-snug text-ink">{prompt}</p> : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-xs text-ink-muted">你的答案</dt>
        <dd className={cx('min-w-0 break-words', item.correct ? 'text-ink' : 'text-ink-secondary')}>
          {item.your_answer && item.your_answer.trim() ? item.your_answer : <span className="text-ink-muted">（未作答）</span>}
        </dd>

        {!item.correct ? (
          <>
            <dt className="text-xs text-ink-muted">正确答案</dt>
            <dd className="min-w-0 break-words text-ink">
              <span className="font-code">{item.expected ?? '—'}</span>
              {alternatives.length ? (
                <span className="ml-2 text-xs text-ink-muted">也可接受：{alternatives.join(' / ')}</span>
              ) : null}
            </dd>
          </>
        ) : null}

        {item.answer_paragraph ? (
          <>
            <dt className="text-xs text-ink-muted">出处</dt>
            <dd className="text-sm text-ink-secondary">
              {item.answer_paragraph ? <span className="font-code">段落 {item.answer_paragraph}</span> : null}
              {item.answer_quote ? <span className="ml-2">“{item.answer_quote}”</span> : null}
            </dd>
          </>
        ) : null}
      </dl>

      {!item.correct && showChineseHints && item.explanation_zh ? (
        <p className="rounded-card bg-paper-sunken px-2 py-1.5 text-xs text-ink-secondary">{item.explanation_zh}</p>
      ) : null}
      {!item.correct && !showChineseHints ? (
        <p className="text-xs text-ink-muted">中文解析已按设置关闭（可在设置页打开「显示中文提示」）。</p>
      ) : null}
    </li>
  );
}

export default function ListeningReview({
  report,
  showChineseHints,
  onPracticeAgain,
  questionsPrompt,
}: ListeningReviewProps) {
  const percent = accuracyPercent(report.accuracy);
  const tallies = tallyList(report.by_question_type);
  const wrong = report.items.filter((item) => !item.correct);
  const transcript = typeof report.transcript === 'string' ? report.transcript.trim() : '';

  return (
    <div className="flex flex-col gap-3">
      <DegradationNotice
        meta={report}
        detail="客观题分数由本地判分规则给出，不依赖 AI；若为近似分请以「降级」标记为准。"
      />

      <Card
        title="听力批改结果"
        subtitle={`attempt ${report.attempt_id} · ${bandScaleLabel(report.band_scale)}`}
        actions={
          onPracticeAgain ? (
            <Button size="sm" variant="outline" onClick={onPracticeAgain}>
              再练一次
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-start gap-6">
          <ScoreBand band={report.band} label="Listening Band" size="lg" hint="0–9，步长 0.5（AC-G5）" />
          <Stat label="正确题数" value={`${report.raw_correct}`} unit={`/ ${report.raw_total}`} mono />
          <Stat label="正确率" value={`${percent}`} unit="%" mono tone={percent >= 70 ? 'good' : percent >= 50 ? 'accent' : 'poor'} />
          <div className="flex min-w-40 flex-1 flex-col gap-2">
            <span className="text-xs text-ink-muted">按题型正确率</span>
            {tallies.length ? (
              tallies.map((tally) => (
                <Bar
                  key={tally.type}
                  label={tally.label}
                  value={tally.correct}
                  max={tally.total}
                  valueLabel={`${tally.correct}/${tally.total} · ${Math.round(tally.accuracy * 100)}%`}
                  tone={tally.accuracy >= 0.7 ? 'good' : tally.accuracy >= 0.4 ? 'mid' : 'poor'}
                />
              ))
            ) : (
              <p className="text-xs text-ink-muted">这份报告没有题型分布数据。</p>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="逐题对照"
        subtitle={`共 ${report.items.length} 题，其中 ${wrong.length} 题需要回看`}
        footer={
          <p className="text-xs text-ink-secondary">
            错题由后端在提交时写入错题本（FR-V2），可在「错题本」按模块与题型筛选复习；本页不再重复记录。
          </p>
        }
      >
        <ul className="flex flex-col gap-2">
          {report.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              showChineseHints={showChineseHints}
              prompt={questionsPrompt ? questionsPrompt(item.id) : null}
            />
          ))}
        </ul>
      </Card>

      <Card
        title="原文精读"
        subtitle="提交后可对照原文逐句复盘（AC-L2 的回传 transcript）"
        actions={<Badge tone="neutral">{transcript ? `${transcript.length} 字符` : '无原文'}</Badge>}
      >
        {transcript ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{transcript}</p>
        ) : (
          <p className="text-sm text-ink-muted">
            本次响应没有回传原文（{formatBand(report.band)} band 记录仍已保存）。可回到练习页用「看原文精读」查看题面自带原文。
          </p>
        )}
      </Card>
    </div>
  );
}
