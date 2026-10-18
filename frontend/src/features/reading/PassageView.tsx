/**
 * 篇章视图（FR-R2 左栏）。
 *
 * 排版按契约 §8 的「学术考试风」：正文用 `--font-display` 衬线、段首用官方 `[A]` 标记、
 * 细分隔线而非卡片阴影；高亮只允许 `--accent-soft` + `--accent` 左边线（见 Highlight.tsx）。
 *
 * 选中任意文字 → 浮层「加入生词本」（AC-V1）；失败必须可见（CONSTITUTION §3）。
 */
import { useRef, useState } from 'react';
import { Badge, Button, Card, cx, Toast } from '../../components/ui';
import {
  HighlightedParagraph,
} from './Highlight';
import { SelectionVocabPopover, useSelectionVocab } from './SelectionVocab';
import type { ReadingSetView } from './readingDraft';
import { QUESTION_TYPE_LABEL_ZH } from '../../types/ielts';

export type PassageViewProps = {
  set: ReadingSetView;
  /** 当前高亮段落 label（AC-R2）。 */
  activeLabel: string | null;
  /** 讲评态：段落仍要滚动定位，但不再显示作答相关提示。 */
  reviewMode?: boolean;
  className?: string;
};

const LEVEL_LABEL_ZH: Record<string, string> = {
  beginner: '入门',
  intermediate: '中级',
  'upper-intermediate': '中高级',
  advanced: '高级',
};

export function PassageView({ set, activeLabel, reviewMode = false, className }: PassageViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; tone: 'good' | 'danger' } | null>(null);

  const vocab = useSelectionVocab({
    setId: set.id,
    rootRef,
    onFeedback: (message, tone) => setFeedback({ message, tone }),
  });

  const questionTypes = Array.from(new Set(set.questions.map((q) => q.type)));

  return (
    <Card
      className={cx('min-h-0', className)}
      title={
        <span className="flex flex-wrap items-baseline gap-2">
          <span>{set.title || set.title_zh}</span>
          <span className="font-code text-xs text-ink-muted">{set.id}</span>
        </span>
      }
      subtitle={set.title && set.title_zh ? set.title_zh : undefined}
      actions={
        <div className="flex items-center gap-1.5">
          {set.level ? <Badge tone="accent">{LEVEL_LABEL_ZH[set.level] ?? set.level}</Badge> : null}
          {set.word_count ? <Badge>{set.word_count} 词</Badge> : null}
        </div>
      }
      footer={
        <div className="flex flex-col gap-1.5">
          {questionTypes.length > 0 ? (
            <p className="text-xs text-ink-muted">
              题型：{questionTypes.map((type) => QUESTION_TYPE_LABEL_ZH[type] ?? type).join(' · ')}
            </p>
          ) : null}
          <p className="text-xs text-ink-muted">选中篇章中的单词或搭配（4 词以内），可加入生词本。</p>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-2">
        {set.instruction_zh ? (
          <p className="rounded-card bg-paper-sunken px-2.5 py-2 text-xs text-ink-secondary">
            {set.instruction_zh}
          </p>
        ) : null}

        {feedback ? (
          <Toast tone={feedback.tone} onDismiss={() => setFeedback(null)}>
            {feedback.message}
          </Toast>
        ) : null}

        {vocab.error ? (
          <p role="alert" className="text-xs" style={{ color: 'var(--band-poor)' }}>
            {vocab.error}
          </p>
        ) : null}

        {vocab.added ? (
          <p className="text-xs text-ink-muted">
            最近加入生词本：<span className="font-code text-accent">{vocab.added}</span>
          </p>
        ) : null}

        <div
          ref={rootRef}
          data-testid="passage-scroll"
          className={cx(
            'relative min-h-0 flex-1 overflow-y-auto rounded-card border border-rule bg-paper px-3 py-2',
            'font-serif text-[15px] leading-[1.75] text-ink',
          )}
          onMouseUp={(event) => vocab.capture(event)}
          onKeyUp={(event) => vocab.capture(event)}
        >
          {vocab.snapshot ? (
            <SelectionVocabPopover
              snapshot={vocab.snapshot}
              adding={vocab.adding}
              onAdd={() => {
                void vocab.confirmAdd();
              }}
              onDismiss={vocab.dismiss}
            />
          ) : null}

          {set.passage?.paragraphs?.length ? (
            set.passage.paragraphs.map((paragraph) => (
              <HighlightedParagraph
                key={paragraph.label}
                label={paragraph.label}
                setId={set.id}
                active={activeLabel === paragraph.label}
              >
                <p className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="shrink-0 font-code text-xs leading-[1.75] text-accent"
                  >
                    [{paragraph.label}]
                  </span>
                  <span data-paragraph-text className="min-w-0 flex-1">
                    {paragraph.text}
                  </span>
                </p>
              </HighlightedParagraph>
            ))
          ) : (
            <p className="text-sm text-ink-muted">篇章为空（内容未加载）。</p>
          )}
        </div>

        {reviewMode ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted">讲评模式：点击题目区的「定位到原文」跳转对应段落。</span>
            <Button variant="ghost" size="sm" onClick={vocab.dismiss}>
              清除高亮
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export default PassageView;
