/**
 * 逐题作答控件（FR-R1 的五类阅读题型；契约 §2-R + §10.1）。
 *
 * 取值口径与后端 `answer_norm.judge_choice` 对齐，避免「显示了但对不上」：
 * - `true_false_notgiven` → `TRUE` / `FALSE` / `NOTGIVEN`（术语保留英文，FR-G4）；
 * - `heading_match` → 罗马数字本身（`iv`），选项**可重复使用**（FR-R4），因此不做「已用即禁用」；
 * - `multiple_choice` → 选项前缀字母（`A`），显示整条文本；
 * - `sentence_completion` / `gap_fill` → 文本 + 词数提醒（见 GapInput）。
 */
import { Badge, Button, cx } from '../../components/ui';
import type { HeadingOption, ReadingQuestionPublic } from '../../types/ielts';
import { GapInput } from './GapInput';

export const TFNG_OPTIONS: readonly { value: string; zh: string }[] = [
  { value: 'TRUE', zh: '原文支持' },
  { value: 'FALSE', zh: '原文反驳' },
  { value: 'NOTGIVEN', zh: '未提及' },
];

/** `"A. They must…"` → `A`；没有前缀时按序号补字母。 */
export function optionLetter(option: string, index: number): string {
  const matched = /^\s*([A-Za-z])[\s.)、：:]/.exec(option);
  if (matched) return matched[1].toUpperCase();
  return String.fromCharCode(65 + index);
}

export function optionBody(option: string, index: number): string {
  const stripped = option.replace(/^\s*[A-Za-z][\s.)、：:]\s*/, '');
  return stripped || option || optionLetter(option, index);
}

function headingText(option: HeadingOption): string {
  return `${option.i}. ${option.text}`;
}

export type QuestionInputProps = {
  question: ReadingQuestionPublic;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

export function QuestionInput({ question, value, onChange, disabled = false }: QuestionInputProps) {
  switch (question.type) {
    case 'true_false_notgiven':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label={`第 ${question.number} 题判断`}
            className="inline-flex overflow-hidden rounded-card border border-rule"
          >
            {TFNG_OPTIONS.map((option, index) => {
              const selected = value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  title={option.zh}
                  onClick={() => onChange(option.value)}
                  className={cx(
                    'h-8 min-w-[86px] px-2.5 text-xs font-medium',
                    'transition-colors duration-[var(--motion-fast)]',
                    index > 0 && 'border-l border-rule',
                    selected
                      ? 'bg-accent-soft text-accent'
                      : 'bg-paper text-ink-secondary hover:bg-paper-sunken',
                    disabled && 'cursor-not-allowed opacity-45',
                  )}
                  style={selected ? { boxShadow: 'inset 0 -2px 0 var(--accent)' } : undefined}
                >
                  <span className="font-code">{option.value}</span>
                  <span className="ml-1 font-sans text-[11px] text-ink-muted">{option.zh}</span>
                </button>
              );
            })}
          </div>
          {value ? <ClearButton onChange={onChange} disabled={disabled} /> : null}
        </div>
      );

    case 'heading_match': {
      const options = question.options_headings ?? [];
      return (
        <div className="flex flex-col gap-1">
          <select
            aria-label={`第 ${question.number} 题标题选项`}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className={cx(
              'h-8 max-w-full rounded-card border border-rule bg-paper px-2 text-sm text-ink',
              'focus:border-accent',
            )}
          >
            <option value="">请选择标题（选项可重复使用）</option>
            {options.map((option) => (
              <option key={option.i} value={option.i}>
                {headingText(option)}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">
            对应段落 <span className="font-code text-accent">{question.paragraph_label}</span>
            {'·'}标题与选项可重复选用（FR-R4）
          </p>
        </div>
      );
    }

    case 'multiple_choice':
      return (
        <div role="radiogroup" aria-label={`第 ${question.number} 题选择`} className="flex flex-col gap-1">
          {(question.options ?? []).map((option, index) => {
            const letter = optionLetter(option, index);
            const selected = value === letter;
            return (
              <label
                key={`${letter}-${index}`}
                className={cx(
                  'flex cursor-pointer items-start gap-2 rounded-card border px-2 py-1.5 text-sm',
                  'transition-colors duration-[var(--motion-fast)]',
                  selected ? 'border-accent bg-accent-soft text-ink' : 'border-rule bg-paper text-ink-secondary',
                  disabled && 'cursor-not-allowed opacity-45',
                )}
              >
                <input
                  type="radio"
                  className="mt-1 shrink-0"
                  name={`mc-${question.id}`}
                  value={letter}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onChange(letter)}
                />
                <span className="font-code text-xs leading-6">{letter}.</span>
                <span className="min-w-0 flex-1">{optionBody(option, index)}</span>
              </label>
            );
          })}
        </div>
      );

    case 'sentence_completion':
    case 'gap_fill':
      return (
        <GapInput
          number={question.number}
          questionId={question.id}
          value={value}
          onChange={onChange}
          wordLimit={question.word_limit}
          disabled={disabled}
        />
      );

    default:
      return (
        <Badge tone="mid">
          暂不支持的题型：{String((question as { type?: string }).type ?? 'unknown')}
        </Badge>
      );
  }
}

function ClearButton({
  onChange,
  disabled,
}: {
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange('')}>
      清除
    </Button>
  );
}

export default QuestionInput;
