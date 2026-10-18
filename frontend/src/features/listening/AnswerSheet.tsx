/**
 * AnswerSheet —— 听力答题区（FR-L2 题型 + FR-L3 字数上限 + AC-L4 面板常驻）。
 *
 * 这里是**作答**视图，绝不出现对错：反馈只在提交后拿到 §3-OR 报告时出现（FR-L4）。
 * 未答题与超限题只做「提醒」，不做「判分」。
 */
import { Badge, Button, Card, Toast } from '../../components/ui';
import type { AnswerMap, ListeningQuestionPublic } from '../../types/ielts';
import { answeredCount, numberLabel, overLimitNumbers, unansweredNumbers } from './listeningSets';
import QuestionField from './QuestionField';

export type AnswerSheetProps = {
  instruction: string;
  questions: ListeningQuestionPublic[];
  answers: AnswerMap;
  onChange: (questionId: string, next: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
  /** 提交按钮之外的阻断原因（例如尚无题目） */
  disabled?: boolean;
  /** 播放中：仍然允许作答（FR-L4 要求面板常驻），但要说明「不显示答案」 */
  playingNote?: boolean;
  /** 草稿状态文案（useDraftAutosave 提供） */
  draftText?: string | null;
  errorText?: string | null;
  onDismissError?: () => void;
};

export default function AnswerSheet({
  instruction,
  questions,
  answers,
  onChange,
  onSubmit,
  submitting = false,
  disabled = false,
  playingNote = false,
  draftText,
  errorText,
  onDismissError,
}: AnswerSheetProps) {
  const done = answeredCount(questions, answers);
  const missing = unansweredNumbers(questions, answers);
  const over = overLimitNumbers(questions, answers);
  const total = questions.length;

  return (
    <Card
      title="答题"
      subtitle={instruction}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={done === total && total > 0 ? 'good' : 'neutral'}>
            已答 {done} / {total}
          </Badge>
          {draftText ? <Badge tone="accent" variant="outline">{draftText}</Badge> : null}
        </div>
      }
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={disabled || submitting || !total} loading={submitting} onClick={onSubmit}>
              提交批改
            </Button>
            {playingNote ? <span className="text-xs text-ink-muted">播放中不显示答案，可边听边填（FR-L4）。</span> : null}
          </div>
          {missing.length ? (
            <p className="text-xs" style={{ color: 'var(--band-mid)' }}>
              未作答：{missing.map((number) => numberLabel(number)).join(' ')}；提交后会被记为
              <span className="font-code"> unanswered</span>。
            </p>
          ) : null}
          {over.length ? (
            <p className="text-xs" style={{ color: 'var(--band-mid)' }}>
              超出字数上限：{over.map((number) => numberLabel(number)).join(' ')}；后端会判
              <span className="font-code"> over_word_limit</span>。
            </p>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {errorText ? (
          <Toast tone="danger" onDismiss={onDismissError}>{errorText}</Toast>
        ) : null}

        {!total ? <p className="text-sm text-ink-muted">这套题没有可作答的题目。</p> : null}

        {questions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            value={answers[question.id] ?? ''}
            onChange={(next) => onChange(question.id, next)}
            disabled={disabled || submitting}
          />
        ))}
      </div>
    </Card>
  );
}
