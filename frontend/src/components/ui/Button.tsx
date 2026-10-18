import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'default' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 加载中：置灰并置 aria-busy，避免重复提交 */
  loading?: boolean;
  disabled?: boolean;
  /** 行首图标（调用方提供 aria-hidden 的 SVG） */
  icon?: ReactNode;
  trailing?: ReactNode;
  /** 撑满父容器宽度 */
  block?: boolean;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-paper border border-transparent hover:brightness-95',
  default: 'bg-paper-raised text-ink border border-rule hover:bg-accent-soft',
  outline: 'bg-transparent text-accent border border-accent hover:bg-accent-soft',
  ghost: 'bg-transparent text-ink-secondary border border-transparent hover:bg-paper-sunken hover:text-ink',
  danger: 'bg-transparent text-band-poor border border-band-poor hover:bg-paper-sunken',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

/** 真实 `<button>`：默认 type=button，键盘 Enter/Space 走原生激活 */
export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  trailing,
  block = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-card font-medium',
        'transition-colors duration-[var(--motion-fast)] select-none',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        block && 'w-full',
        isDisabled && 'cursor-not-allowed opacity-45',
        className,
      )}
      {...rest}
    >
      {loading ? <span aria-hidden="true" className="font-code">···</span> : icon}
      {children}
      {trailing}
    </button>
  );
}

export default Button;
