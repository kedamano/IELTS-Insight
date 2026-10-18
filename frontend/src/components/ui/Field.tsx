import { createContext, useContext, useId, type ReactNode } from 'react';
import { cx } from './cx';

/** 传给内部控件的无障碍属性：调用方可直接用 children 函数形式接收 */
export type FieldAria = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
};

export type FieldProps = {
  label: ReactNode;
  /** 与控件 id 对应；不传时用 children 函数形式自动注入 */
  htmlFor?: string;
  hint?: ReactNode;
  /** 有值即视为校验失败：控件得到 aria-invalid，且进入 aria-describedby */
  error?: ReactNode;
  required?: boolean;
  /** 标签与控件同行（设置页的开关/数值项） */
  inline?: boolean;
  children: ReactNode | ((aria: FieldAria) => ReactNode);
  className?: string;
};

const FieldContext = createContext<FieldAria>({});

/** 在 Field 内部自定义控件时使用，避免重复拼装 aria 属性 */
export function useFieldAria(): FieldAria {
  return useContext(FieldContext);
}

/** 表单字段外壳：label 关联 + hint/error 的 describedBy 串联 */
export function Field({ label, htmlFor, hint, error, required, inline, children, className }: FieldProps) {
  const uid = useId();
  const hintId = hint != null ? `field-hint-${uid}` : undefined;
  const errorId = error != null ? `field-error-${uid}` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const aria: FieldAria = {
    ...(htmlFor ? { id: htmlFor } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error != null ? { 'aria-invalid': true as const } : {}),
    ...(required ? { required: true } : {}),
  };

  const content = typeof children === 'function' ? children(aria) : children;

  return (
    <FieldContext.Provider value={aria}>
      <div className={cx('flex flex-col gap-1', inline && 'flex-row items-center justify-between gap-4', className)}>
        <label
          htmlFor={htmlFor}
          className={cx('text-xs font-medium text-ink-secondary', inline && 'flex-1')}
        >
          {label}
          {required ? <span aria-hidden="true" className="required-mark" /> : null}
        </label>
        <div className={cx('flex flex-col gap-1', inline && 'w-56 shrink-0')}>{content}</div>
        {hint != null ? (
          <span id={hintId} className="text-xs text-ink-muted">
            {hint}
          </span>
        ) : null}
        {error != null ? (
          <span id={errorId} role="alert" className="text-xs" style={{ color: 'var(--band-poor)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export default Field;
