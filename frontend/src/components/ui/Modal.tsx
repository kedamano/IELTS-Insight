import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';
import { Button } from './Button';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeLabel?: string;
  dismissOnBackdrop?: boolean;
  className?: string;
};

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 模态：role=dialog + aria-modal，Escape 关闭，Tab 焦点循环，关闭后焦点还原 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeLabel = '关闭',
  dismissOnBackdrop = true,
  className,
}: ModalProps) {
  const ids = useId();
  const titleId = `modal-title-${ids}`;
  const descId = `modal-desc-${ids}`;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      const target = restoreRef.current;
      if (target && document.contains(target)) target.focus();
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--scrim)' }}
      onMouseDown={dismissOnBackdrop ? (event) => { if (event.target === event.currentTarget) onClose(); } : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description != null ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          'flex w-full flex-col gap-3 rounded-card border border-rule bg-paper-raised',
          'shadow-elevated outline-none',
          SIZE[size],
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 px-4 pt-4">
          <h2 id={titleId} className="font-serif text-base text-ink">
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={closeLabel}>
            {closeLabel}
          </Button>
        </header>
        {description != null ? (
          <p id={descId} className="px-4 text-sm text-ink-secondary">
            {description}
          </p>
        ) : null}
        {children != null ? <div className="px-4 text-sm text-ink">{children}</div> : null}
        {footer != null ? (
          <footer className="flex justify-end gap-2 border-t border-rule px-4 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

export default Modal;
