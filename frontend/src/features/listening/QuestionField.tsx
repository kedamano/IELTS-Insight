/**
 * QuestionField —— 按 `QuestionType` 判别渲染的作答控件（FR-L2 / FR-L3）。
 *
 * 四种听力题型各自的下发字段不同（§2-L），这里用判别联合收窄，不额外发明字段：
 * - `gap_fill` → 文本框 + 字数上限提示 + 实时词数（超限**当场可见**，不等到批改）
 * - `multiple_choice` → 单选（`options` 已是 `"A. …"` 全文）
 * - `matching` → 下拉（选项可重复使用）
 * - `map_diagram_label` → 下拉（`labels` 为 A/B/C 集合，方位描述在 `prompt` 里，无外链图片）
 */
import { Badge, Field, cx } from '../../components/ui';
import type { ListeningQuestionPublic } from '../../types/ielts';
import { countWords, isOverWordLimit, numberLabel, wordLimitHint } from './listeningSets';

export type QuestionFieldProps = {
  question: ListeningQuestionPublic;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** 已提交时用于回显（本屏不显示对错，仅回显所选文本） */
  readOnly?: boolean;
};

const inputClass =
  'h-9 w-full rounded-card border border-rule bg-paper px-2 text-sm text-ink outline-none focus:border-accent';

function wordCountText(question: ListeningQuestionPublic, value: string) {
  const limit = wordLimitHint(question);
  const used = countWords(value);
  return limit ? `${used} 词 · ${limit}` : `${used} 词`;
}

export default function QuestionField({ question, value, onChange, disabled = false, readOnly = false }: QuestionFieldProps) {
  const blocked = disabled || readOnly;
  const fieldId = `listening-answer-${question.id}`;
  const overLimit = isOverWordLimit(question, value);

  return (
    <div className="flex flex-col gap-2 rounded-card border border-rule bg-paper px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="font-code shrink-0 pt-0.5 text-sm text-ink-secondary">{numberLabel(question.number)}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-ink">{question.prompt}</p>
          {question.type === 'map_diagram_label' && question.diagram_note ? (
            <p className="mt-1 text-xs text-ink-muted">{question.diagram_note}</p>
          ) : null}
        </div>
      </div>

      <div className="pl-0 sm:pl-7">
        {question.type === 'gap_fill' ? (
          <Field
            label="你的答案"
            htmlFor={fieldId}
            inline
            hint={wordLimitHint(question) ?? '按录音填写'}
            error={overLimit ? `已超出 ${String(countWords(value))} 词，超过上限会被判 over_word_limit` : undefined}
          >
            {(aria) => (
              <div className="flex w-full items-center gap-2">
                <input
                  {...aria}
                  id={fieldId}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={blocked}
                  value={value}
                  placeholder={wordLimitHint(question) ?? '填写答案'}
                  onChange={(event) => onChange(event.currentTarget.value)}
                  className={cx(inputClass, overLimit && 'border-[var(--band-mid)]')}
                />
                <span className={cx('font-code shrink-0 text-xs', overLimit ? 'text-band-mid' : 'text-ink-muted')}>
                  {wordCountText(question, value)}
                </span>
              </div>
            )}
          </Field>
        ) : null}

        {question.type === 'multiple_choice' ? (
          <div role="radiogroup" aria-label={`${numberLabel(question.number)} 选项`} className="flex flex-col gap-1.5">
            {question.options.map((option, index) => {
              const checked = value !== '' && option === value;
              const optionId = `${fieldId}-${index}`;
              return (
                <label key={option} htmlFor={optionId} className="flex items-start gap-2 text-sm text-ink">
                  <input
                    id={optionId}
                    type="radio"
                    name={fieldId}
                    value={option}
                    disabled={blocked}
                    checked={checked}
                    onChange={() => onChange(option)}
                    className="mt-1 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1">{option}</span>
                </label>
              );
            })}
          </div>
        ) : null}

        {question.type === 'matching' ? (
          <Field label="选择配对项" htmlFor={fieldId} inline hint="选项可重复使用">
            {(aria) => (
              <select
                {...aria}
                id={fieldId}
                disabled={blocked}
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className={cx(inputClass, 'h-9')}
              >
                <option value="">请选择</option>
                {question.options_list.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}

        {question.type === 'map_diagram_label' ? (
          <Field label="选择标签" htmlFor={fieldId} inline hint="方位已在题干描述，无外部图片">
            {(aria) => (
              <div className="flex w-full items-center gap-2">
                <select
                  {...aria}
                  id={fieldId}
                  disabled={blocked}
                  value={value}
                  onChange={(event) => onChange(event.currentTarget.value)}
                  className={cx(inputClass, 'h-9')}
                >
                  <option value="">请选择</option>
                  {question.labels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
                {value ? <Badge tone="accent">{value}</Badge> : <Badge>未选</Badge>}
              </div>
            )}
          </Field>
        ) : null}
      </div>
    </div>
  );
}
