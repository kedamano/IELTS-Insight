/**
 * 题目列表（FR-R2 右栏，契约 §8 的官方排版：`number.` 前缀 + 缩进题干 + 细分隔线）。
 *
 * 「定位」按钮（AC-R2）：
 * - `heading_match` 用题目自带的 `paragraph_label`（官方就是为段落选标题）；
 * - 其余题型在**题面没有段落信息**（后端把 `answer_paragraph` 当泄漏字段剔除了），
 *   所以退化为题干实词的关键词定位，命中不唯一就禁用按钮（见 locate.ts 的说明）。
 */
import { Badge, Button, Card, cx } from '../../components/ui';
import type { AnswerMap, ReadingQuestionPublic } from '../../types/ielts';
import { QUESTION_TYPE_LABEL_ZH } from '../../types/ielts';
import { locateParagraph, locateTitleZh, questionStemText, type LocateResult } from './locate';
import { QuestionInput } from './QuestionInput';
import { answeredCount, type ReadingSetView } from './readingDraft';

export type QuestionNavProps = {
  set: ReadingSetView;
  answers: AnswerMap;
  onAnswer: (questionId: string, value: string) => void;
  /** 由面板持有高亮状态（篇章与题目是兄弟节点，状态必须在共同父级）。 */
  onLocate: (label: string | null, question: ReadingQuestionPublic) => void;
  disabled?: boolean;
  className?: string;
};

export function QuestionNav({
  set,
  answers,
  onAnswer,
  onLocate,
  disabled = false,
  className,
}: QuestionNavProps) {
  const paragraphs = set.passage?.paragraphs ?? [];
  const total = set.questions.length;
  const answered = answeredCount(answers);

  return (
    <Card
      className={cx('min-h-0', className)}
      title={
        <span className="flex items-baseline gap-2">
          <span>题目</span>
          <span className="font-code text-xs text-ink-muted">
            {answered}/{total} 已作答
          </span>
        </span>
      }
      subtitle="每题为「定位」可高亮并滚动到对应段落"
    >
      <div
        data-testid="questions-scroll"
        className="min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <ol className="flex flex-col">
          {set.questions.map((question, index) => {
            const value = answers[question.id] ?? '';
            const located: LocateResult = locateParagraph(question, paragraphs);
            const stem = questionStemText(question);
            return (
              <li
                key={question.id}
                data-question-id={question.id}
                className={cx(
                  'flex flex-col gap-2 border-b border-rule py-3',
                  index === set.questions.length - 1 && 'border-b-0',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-code text-sm text-accent">{question.number}.</span>
                  <Badge tone="neutral">{QUESTION_TYPE_LABEL_ZH[question.type] ?? question.type}</Badge>
                  {value.trim() ? <Badge tone="good" dot>已作答</Badge> : <Badge dot>未作答</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={disabled || !located.label}
                    title={locateTitleZh(located)}
                    aria-label={`定位第 ${question.number} 题到段落`}
                    onClick={() => onLocate(located.label, question)}
                  >
                    定位
                  </Button>
                </div>

                <p className="pl-6 text-sm leading-6 text-ink">
                  {question.type === 'heading_match' ? (
                    <>
                      {stem}
                      <span className="ml-1 text-xs text-ink-muted">
                        （段落 <span className="font-code text-accent">{question.paragraph_label}</span>）
                      </span>
                    </>
                  ) : (
                    stem
                  )}
                </p>

                <div className="pl-6">
                  <QuestionInput
                    question={question}
                    value={value}
                    disabled={disabled}
                    onChange={(next) => onAnswer(question.id, next)}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}

export default QuestionNav;
