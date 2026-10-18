/**
 * 设置页的表单控件（契约 §4）。
 *
 * 两条硬规则决定了这里的形状：
 * 1. AC-C1：`PATCH /settings` 是部分更新 —— 每个控件**只提交自己那一个键**，
 *    绝不把整张表单打包成一个 body（那正是旧实现把未传字段重置回默认值的根源）。
 * 2. AC-C2：AI key 只写不回读 —— `clearOnCommit` 的输入框提交后立刻清空，
 *    后端也永远不会把它回传（`services/api.ts` 还会把它从错误文本里抹掉）。
 *
 * 失败一律就地可见（CONSTITUTION §3）：控件内联中文错误 + `role=alert`（由 `Field` 提供）。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Field } from '../../components/ui';

/** 提交回调：抛错即视为失败，控件负责把中文错误显示出来。 */
export type FieldCommit = (raw: string) => Promise<void>;

export interface DraftFieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** 后端已保存的值（字符串形态；`null` 请传空串）。 */
  value: string;
  onCommit: FieldCommit;
  type?: 'text' | 'number' | 'date' | 'password';
  /** 本地校验：返回中文错误即不发送请求。 */
  validate?: (raw: string) => string | null;
  step?: number | string;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  /** 提交成功后清空输入框（AI key 用）。 */
  clearOnCommit?: boolean;
  commitLabel?: string;
  inputMode?: 'numeric' | 'decimal' | 'text';
  autoComplete?: 'off' | 'new-password';
}

/**
 * 文本/数字/日期输入：草稿态本地持有，只有点「保存」或按 Enter 才发 PATCH，
 * 且 body 只含该字段（AC-C1）。值与后端一致时不显示保存按钮，避免空提交。
 */
export function DraftField({
  id,
  label,
  hint,
  value,
  onCommit,
  type = 'text',
  validate,
  step,
  min,
  max,
  placeholder,
  disabled = false,
  clearOnCommit = false,
  commitLabel = '保存',
  inputMode,
  autoComplete,
}: DraftFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 草稿与「已保存」标记放在同一个 state 里：后端回读（value 变化）时既要同步输入框，
  // 又要判断这次同步的是不是刚保存的那个值 —— 分两次 setState 拿不到配对的前值。
  const [state, setState] = useState<{ draft: string; saved: boolean }>({ draft: value, saved: false });
  const draftRef = useRef(value);
  const setDraft = useCallback((next: string): void => {
    draftRef.current = next;
    setState({ draft: next, saved: false });
  }, []);
  const draft = state.draft;
  const saved = state.saved;

  // 后端值变化（首屏加载 / 保存成功回读）时同步草稿；用户正在编辑时不打断。
  useEffect(() => {
    setError(null);
    setState((prev) => ({
      draft: prev.draft === value ? prev.draft : value,
      // 回读值仍是用户刚提交的那个 → 保留「已保存」；否则说明值真变了 → 状态清零。
      saved: prev.saved && draftRef.current === value,
    }));
  }, [value]);

  const dirty = type === 'password' ? draft.trim().length > 0 : draft !== value;

  const commit = async (): Promise<void> => {
    if (type !== 'password' && !dirty) return;
    const invalid = validate?.(draft) ?? null;
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCommit(draft);
      setState((prev) => ({ ...prev, saved: true }));
      if (clearOnCommit) {
        // AC-C2：密钥只写不回读，提交成功后立刻清空输入框，但「已保存」提示要留着。
        draftRef.current = '';
        setState({ draft: '', saved: true });
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '保存失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field
      label={label}
      htmlFor={id}
      hint={hint}
      error={error}
      className={type === 'password' ? undefined : 'min-w-0'}
    >
      {(aria) => (
        <div className="flex flex-col items-stretch gap-1">
          <div className="flex items-center gap-2">
            <input
              {...aria}
              id={id}
              type={type}
              className="h-9 min-w-0 flex-1 rounded-card border border-rule bg-paper px-2.5 text-sm text-ink outline-none focus:border-[var(--accent)]"
              value={draft}
              step={step}
              min={min}
              max={max}
              inputMode={inputMode}
              placeholder={placeholder}
              disabled={disabled || busy}
              // AC-C2：密码框禁用自动填充，也永远不回填后端值。
              autoComplete={type === 'password' ? (autoComplete ?? 'new-password') : (autoComplete ?? 'off')}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commit();
                }
              }}
            />
            {dirty || saved ? (
              <span className="shrink-0 text-xs text-ink-muted" aria-live="polite">
                {busy ? '保存中…' : saved ? '已保存' : '未保存'}
              </span>
            ) : null}
            <Button size="sm" variant="outline" loading={busy} disabled={disabled || !dirty} onClick={() => void commit()}>
              {commitLabel}
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}

export interface ChoiceFieldProps<T extends string> {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => Promise<void>;
  disabled?: boolean;
}

/** 下拉选择：改动即提交（只发该字段）。 */
export function ChoiceField<T extends string>({
  id,
  label,
  hint,
  value,
  options,
  onChange,
  disabled = false,
}: ChoiceFieldProps<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: T): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onChange(next);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '保存失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      {(aria) => (
        <select
          {...aria}
          id={id}
          className="h-9 w-full rounded-card border border-rule bg-paper px-2 text-sm text-ink outline-none focus:border-[var(--accent)]"
          value={value}
          disabled={disabled || busy}
          onChange={(event) => void change(event.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export interface ToggleFieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => Promise<void>;
  disabled?: boolean;
}

/** 开关：布尔项改动即提交。 */
export function ToggleField({ id, label, hint, checked, onChange, disabled = false }: ToggleFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onChange(next);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '保存失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} inline>
      {(aria) => (
        <span className="flex items-center justify-end gap-2">
          {busy ? <span className="font-code text-xs text-ink-muted">保存中…</span> : null}
          <input
            {...aria}
            id={id}
            type="checkbox"
            className="h-4 w-4 accent-[var(--accent)]"
            checked={checked}
            disabled={disabled || busy}
            onChange={(event) => void change(event.target.checked)}
          />
        </span>
      )}
    </Field>
  );
}

/**
 * 数字校验（与后端 `app/api/settings.py` 的范围一致，避免把注定 400 的请求发出去）。
 */
export function numberRule(opts: {
  label: string;
  min: number;
  max: number;
  integer?: boolean;
  allowEmpty?: boolean;
}): (raw: string) => string | null {
  return (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return opts.allowEmpty ? null : `${opts.label}需要填一个数字`;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return `${opts.label}必须是数字`;
    if (opts.integer && !Number.isInteger(value)) return `${opts.label}必须是整数`;
    if (value < opts.min || value > opts.max) {
      return `${opts.label}应在 ${opts.min} 到 ${opts.max} 之间`;
    }
    return null;
  };
}
