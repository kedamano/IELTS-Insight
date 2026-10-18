/**
 * 填空/句子完成输入（FR-R1 的 `sentence_completion` 与 `gap_fill`）。
 *
 * 官方题规：`NO MORE THAN TWO WORDS AND/OR A NUMBER`，超限后端直接判 `over_word_limit`（FR-L3/§3-OR）。
 * 因此这里做「提示 + 计数 + 超限预警」，但**不阻断输入**：判分权在后端，前端只做提醒。
 */
import { cx } from '../../components/ui';
import { TONE_VAR } from '../../components/ui/tokens';

/** 英文单词按空白切分；雅思写作/阅读字数口径一致（数字与符号串算 1 词）。 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export type GapInputProps = {
  /** 题号，用于可访问名与测试定位。 */
  number: number;
  questionId: string;
  value: string;
  onChange: (next: string) => void;
  /** `word_limit`（缺省 = 不限，但仍显示词数）。 */
  wordLimit?: number;
  disabled?: boolean;
  className?: string;
};

export function GapInput({
  number,
  questionId,
  value,
  onChange,
  wordLimit,
  disabled = false,
  className,
}: GapInputProps) {
  const words = countWords(value);
  const over = typeof wordLimit === 'number' && wordLimit > 0 && words > wordLimit;
  const limitText =
    typeof wordLimit === 'number' && wordLimit > 0
      ? `最多 ${wordLimit} 词（NO MORE THAN ${wordLimit} WORDS AND/OR A NUMBER）`
      : '不限字数';

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <input
        type="text"
        id={`gap-input-${questionId}`}
        name={`gap-input-${questionId}`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`第 ${number} 题答案`}
        aria-describedby={`gap-hint-${questionId}`}
        aria-invalid={over || undefined}
        autoComplete="off"
        spellCheck={false}
        className={cx(
          'h-8 rounded-card border bg-paper px-2 text-sm text-ink',
          'transition-colors duration-[var(--motion-fast)]',
          over ? 'border-band-poor' : 'border-rule focus:border-accent',
        )}
        style={over ? { borderColor: TONE_VAR.poor } : undefined}
      />
      <div className="flex items-baseline justify-between gap-2">
        <span id={`gap-hint-${questionId}`} className="text-xs text-ink-muted">
          {limitText}
        </span>
        <span
          className="font-code text-xs tabular-nums"
          data-over={over ? 'true' : 'false'}
          style={{ color: over ? TONE_VAR.poor : 'var(--ink-secondary)' }}
        >
          {wordLimit ? `${words}/${wordLimit} 词` : `${words} 词`}
        </span>
      </div>
      {over ? (
        <span role="status" className="text-xs" style={{ color: TONE_VAR.poor }}>
          超出字数上限，判分会记为 over_word_limit（答案错误）
        </span>
      ) : null}
    </div>
  );
}

export default GapInput;
