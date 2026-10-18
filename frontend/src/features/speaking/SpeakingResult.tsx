/**
 * SpeakingResult —— 口语结果视图（契约 §3-S、FR-S4/S5、AC-S4/S5、AC-V3）。
 *
 * 视觉优先级（AC-V3）：总分 band → 四维 → 证据/改进/范文/替换词 → 指标 → 发音细节（折叠）。
 * 降级可见（CONSTITUTION §3）：`ai_used === false` 或 `approximate` 时，band 旁边与页面顶部
 * 都带「降级」标记，绝不把近似分说成真 band（AC-G5）。
 */
import { useMemo, useState } from 'react';
import { Bar, Badge, Button, Card, ScoreBand, Stat, cx } from '../../components/ui';
import type { SpeakingCriterion, SpeakingReport } from '../../types/ielts';
import { SPEAKING_CRITERIA, SPEAKING_CRITERION_LABEL, formatBand } from '../../types/ielts';
import BandRadar from './BandRadar';
import DegradationNotice from './DegradationNotice';
import PronunciationDetail from './PronunciationDetail';

export type SpeakingResultProps = {
  report: SpeakingReport;
  /** 考生全部 turn 的转写（evidence 的 quote 是它的连续片段，§3-P 规则 2） */
  transcript: string;
  onPracticeAgain?: () => void;
};

const REASON_LABEL_ZH: Record<SpeakingCriterion, string> = {
  fluency_coherence: '流利与连贯',
  lexical_resource: '词汇资源',
  grammatical_range_accuracy: '语法范围与准确度',
  pronunciation: '发音',
};

/** 把 quote 在 transcript 里高亮（大小写不敏感，逐次出现都标）。 */
function renderTranscript(transcript: string, quote: string | null) {
  if (!transcript.trim()) return <span className="text-ink-muted">（没有转写文本）</span>;
  if (!quote) return <span>{transcript}</span>;
  const needle = quote.trim();
  if (!needle) return <span>{transcript}</span>;
  const parts: { text: string; hit: boolean }[] = [];
  const lower = transcript.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let cursor = 0;
  let found = lower.indexOf(lowerNeedle, cursor);
  if (found < 0) return <span>{transcript}</span>;
  while (found >= 0) {
    if (found > cursor) parts.push({ text: transcript.slice(cursor, found), hit: false });
    parts.push({ text: transcript.slice(found, found + needle.length), hit: true });
    cursor = found + needle.length;
    found = lower.indexOf(lowerNeedle, cursor);
  }
  if (cursor < transcript.length) parts.push({ text: transcript.slice(cursor), hit: false });
  return (
    <span>
      {parts.map((part, index) =>
        part.hit ? (
          <mark key={index} className="bg-accent-soft text-ink">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}

export default function SpeakingResult({ report, transcript, onPracticeAgain }: SpeakingResultProps) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const criteria = useMemo<SpeakingCriterion[]>(() => [...SPEAKING_CRITERIA], []);
  const metrics = report.metrics;
  const overall = report.band.overall;

  return (
    <div className="flex flex-col gap-3">
      <DegradationNotice
        meta={report}
        detail={
          report.approximate
            ? '分数由本地近似规则估算（无 AI 或未配置密钥）。'
            : 'AI 评分未完成，以下为本地模板结果。'
        }
      />

      <Card
        title="口语评分结果"
        subtitle={`attempt ${report.attempt_id}`}
        actions={
          <div className="flex items-center gap-2">
            {report.ai_used && !report.approximate ? <Badge tone="good" dot>AI 评分</Badge> : null}
            <DegradationNotice meta={report} variant="badge" />
            {onPracticeAgain ? (
              <Button size="sm" variant="outline" onClick={onPracticeAgain}>
                再练一次
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="flex flex-wrap items-start gap-6">
          <ScoreBand band={overall} label="总分 Band" size="lg" hint="0–9 · 0.5 步长（四维平均后夹紧）" />
          <div className="min-w-52 flex-1">
            <BandRadar band={report.band} />
          </div>
          <ul className="flex min-w-64 flex-1 flex-col gap-2">
            {criteria.map((key) => {
              const meta = SPEAKING_CRITERION_LABEL[key];
              const value = report.band[key];
              return (
                <li key={key} className="flex items-center justify-between gap-3 border-b border-rule pb-1.5 last:border-b-0">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-code text-xs text-accent">{meta.abbr}</span>
                      <span className="text-sm text-ink">{meta.zh}</span>
                    </div>
                    <div className="text-xs text-ink-muted">{meta.full}</div>
                  </div>
                  <ScoreBand band={value} label="" showAxis={false} size="sm" />
                </li>
              );
            })}
            {report.band.pronunciation_confidence === 'low' ? (
              <li className="text-xs text-ink-muted">
                发音维度：无音频，由转写文本推断（FR-S4，低置信）。
              </li>
            ) : null}
          </ul>
        </div>
      </Card>

      <Card
        title="证据引用"
        subtitle="每条引用都是你原话里的连续片段；点击可在转写中高亮"
      >
        {report.evidence.length ? (
          <ul className="flex flex-col gap-2">
            {report.evidence.map((item, index) => (
              <li key={`${item.criterion}-${index}`}>
                <button
                  type="button"
                  onClick={() => setHighlight(item.quote)}
                  className={cx(
                    'flex w-full flex-col gap-1 rounded-card border px-3 py-2 text-left',
                    highlight === item.quote ? 'border-accent bg-accent-soft' : 'border-rule bg-paper hover:bg-paper-sunken',
                  )}
                >
                  <span className="flex items-center gap-2 text-xs text-ink-muted">
                    <Badge tone="accent">{REASON_LABEL_ZH[item.criterion]}</Badge>
                    {item.level ? <span className="font-code">档 {item.level}</span> : null}
                  </span>
                  <span className="font-serif text-sm text-ink">“{item.quote}”</span>
                  <span className="text-xs text-ink-secondary">{item.why}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">本次没有可展示的证据引用。</p>
        )}

        <div className="mt-3 rounded-card border border-rule bg-paper-sunken px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-ink-muted">你的转写文本</span>
            {highlight ? (
              <Button size="sm" variant="ghost" onClick={() => setHighlight(null)}>
                取消高亮
              </Button>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed text-ink">{renderTranscript(transcript, highlight)}</p>
        </div>
      </Card>

      <Card title="改进建议" subtitle={`问题 → 改法（FR-S5，共 ${report.improvements.length} 条）`}>
        {report.improvements.length ? (
          <ol className="flex flex-col gap-2">
            {report.improvements.map((item, index) => (
              <li key={`${item.issue}-${index}`} className="rounded-control bg-paper-sunken px-3 py-2">
                <div className="text-sm text-ink">
                  <span className="font-code text-xs text-ink-muted">{index + 1}. </span>
                  {item.issue}
                </div>
                <div className="mt-1 text-sm text-band-good">改法：{item.fix}</div>
                {item.quote ? (
                  <button
                    type="button"
                    className="mt-1 text-left text-xs text-ink-muted underline decoration-rule hover:text-accent"
                    onClick={() => setHighlight(item.quote ?? null)}
                  >
                    原句：“{item.quote}”
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-muted">暂无改进建议。</p>
        )}
        {report.strengths.length ? (
          <div className="mt-3">
            <div className="mb-1 text-xs text-ink-muted">做得好的地方</div>
            <ul className="list-disc pl-5 text-sm text-ink-secondary">
              {report.strengths.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card title="示范回答" subtitle="比当前档高一档的参考答案（FR-S5，150 词内）">
        <p className="font-serif text-sm leading-relaxed text-ink">{report.model_answer || '（无范文）'}</p>
      </Card>

      <Card title="替换词升级" subtitle="把你用过的平庸表达换成更高档搭配；来源已标注">
        {report.upgrade_vocabulary.length ? (
          <ul className="flex flex-col gap-2">
            {report.upgrade_vocabulary.map((item, index) => (
              <li key={`${item.from}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-muted line-through">{item.from}</span>
                <span aria-hidden="true">→</span>
                <span className="text-band-good">{item.to}</span>
                {item.note_zh ? <span className="text-xs text-ink-secondary">{item.note_zh}</span> : null}
                {item.source ? <Badge variant="outline">{item.source}</Badge> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">本次没有识别出需要替换的表达。</p>
        )}
      </Card>

      {metrics ? (
        <Card title="回答指标" subtitle="由转写与时间轴算出，用于解释 FC/LR">
          <div className="flex flex-wrap gap-6">
            <Stat label="语速" value={metrics.wpm} unit="wpm" mono size="sm" />
            <Stat label="停顿总时长" value={metrics.pause_total_sec.toFixed(1)} unit="秒" mono size="sm" />
            <Stat label="重复" value={metrics.repeats} unit="次" mono size="sm" />
            <Stat label="词数" value={metrics.word_count} unit="词" mono size="sm" />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">填充词</span>
              <span className="text-sm text-ink">{metrics.fillers.length ? metrics.fillers.join(' · ') : '无'}</span>
            </div>
          </div>
          <div className="mt-3">
            <Bar
              value={Math.min(9, metrics.wpm / 20)}
              max={9}
              tone={metrics.wpm >= 120 ? 'good' : 'mid'}
              label="语速对照（120–180 wpm 为常见自然区间）"
              valueLabel={`${metrics.wpm} wpm`}
            />
          </div>
        </Card>
      ) : null}

      <PronunciationDetail detail={report.pronunciation_detail} confidence={report.band.pronunciation_confidence} />

      <p className="text-xs text-ink-muted">
        总分 band 由四维平均后按 0.5 夹紧（FR-S4）；当前显示 {formatBand(overall)}。
        错题与低分句由后端写入错题本，无需在此页手动添加。
      </p>
    </div>
  );
}
