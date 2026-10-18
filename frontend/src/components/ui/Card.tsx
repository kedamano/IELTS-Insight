import type { ReactNode } from 'react';
import { cx } from './cx';
import { TONE_VAR, type Tone } from './tokens';

export type CardProps = {
  /** 卡片标题（纸面风格用衬线字体，不放大段装饰） */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** 标题行右侧操作区 */
  actions?: ReactNode;
  children?: ReactNode;
  /** 底部分隔线以下内容 */
  footer?: ReactNode;
  padded?: boolean;
  /** 顶部 3px 色条：给同屏多卡做出层次，色值仍只来自 band 令牌 */
  tone?: Tone | 'accent';
  /** 传了 title 时容器带 aria-label，方便屏幕阅读器区分卡片 */
  className?: string;
};

export function Card({
  title,
  subtitle,
  actions,
  children,
  footer,
  padded = true,
  tone,
  className,
}: CardProps) {
  const hasHeader = title != null || actions != null || subtitle != null;
  return (
    <section
      aria-label={typeof title === 'string' ? title : undefined}
      className={cx(
        'lift relative flex flex-col rounded-card border border-rule bg-paper-raised shadow-elevated',
        className,
      )}
    >
      {tone != null ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px] rounded-t-card"
          style={{ backgroundColor: tone === 'accent' ? 'var(--accent)' : TONE_VAR[tone] }}
        />
      ) : null}
      {hasHeader ? (
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
          <div className="min-w-0">
            {title != null ? (
              <h3 className="font-serif text-[15px] leading-snug text-ink truncate">{title}</h3>
            ) : null}
            {subtitle != null ? (
              <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
            ) : null}
          </div>
          {actions != null ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {hasHeader && children != null ? <div className="rule" role="presentation" /> : null}
      {children != null ? (
        <div className={cx('flex-1', padded && 'px-4 py-3.5')}>{children}</div>
      ) : null}
      {footer != null ? (
        <>
          <div className="rule" role="presentation" />
          <footer className="px-4 py-3 text-xs text-ink-secondary">{footer}</footer>
        </>
      ) : null}
    </section>
  );
}

export default Card;
