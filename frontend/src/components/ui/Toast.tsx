import { useEffect, type ReactNode } from 'react';
import { cx } from './cx';
import { TONE_VAR } from './tokens';

export type ToastTone = 'info' | 'good' | 'warn' | 'danger';

export type ToastProps = {
  children: ReactNode;
  tone?: ToastTone;
  /** 关闭回调；传入时渲染关闭按钮 */
  onDismiss?: () => void;
  /** 右侧操作（如「重试」「查看原文」） */
  action?: ReactNode;
  /** 自动消失毫秒数；0 = 不自动消失。默认 danger 不自动消失，其余 6000ms */
  autoDismissMs?: number;
  closeLabel?: string;
  className?: string;
};

const BORDER: Record<ToastTone, string> = {
  info: 'var(--rule)',
  good: TONE_VAR.good,
  warn: TONE_VAR.mid,
  danger: TONE_VAR.poor,
};

/** 失败必须可见（CONSTITUTION §3）：danger 用 role=alert 立即朗读，其余 role=status */
export function Toast({
  children,
  tone = 'info',
  onDismiss,
  action,
  autoDismissMs,
  closeLabel = '关闭提示',
  className,
}: ToastProps) {
  const ttl = autoDismissMs ?? (tone === 'danger' ? 0 : 6000);

  useEffect(() => {
    if (!onDismiss || ttl <= 0) return;
    const id = window.setTimeout(onDismiss, ttl);
    return () => window.clearTimeout(id);
  }, [onDismiss, ttl]);

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      className={cx(
        'flex items-start gap-3 rounded-card border border-rule bg-paper-raised px-3 py-2 text-sm',
        'shadow-elevated',
        className,
      )}
      style={{ borderLeft: `3px solid ${BORDER[tone]}` }}
    >
      <div className="min-w-0 flex-1 text-ink">{children}</div>
      {action != null ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      {onDismiss != null ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={closeLabel}
          className="shrink-0 rounded-card px-1 text-ink-muted hover:text-ink"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}

export default Toast;
