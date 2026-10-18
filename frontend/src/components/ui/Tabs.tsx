import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export type TabItem<T extends string = string> = {
  id: T;
  label: ReactNode;
  /** 右侧小计数，如未解决错题数 */
  count?: number;
  disabled?: boolean;
};

export type TabsProps<T extends string = string> = {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** 屏幕阅读器对整组 tab 的命名 */
  ariaLabel: string;
  /** 传入则 tab/panel 的 DOM id 稳定可预测，便于 TabPanel 关联 */
  id?: string;
  size?: 'sm' | 'md';
  className?: string;
};

export type TabPanelProps = {
  baseId: string;
  tabId: string;
  children: ReactNode;
  className?: string;
};

export function tabDomId(baseId: string, tabId: string): string {
  return `${baseId}-tab-${tabId}`;
}

export function panelDomId(baseId: string, tabId: string): string {
  return `${baseId}-panel-${tabId}`;
}

/** APG tablist：role=tab + aria-selected + roving tabindex + ←/→/Home/End */
export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  id,
  size = 'md',
  className,
}: TabsProps<T>) {
  const autoId = useId();
  const baseId = id ?? `tabs-${autoId}`;
  const listRef = useRef<HTMLDivElement | null>(null);

  const focusTab = (tabId: string) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    const target = buttons ? Array.from(buttons).find((node) => node.id === tabDomId(baseId, tabId)) : undefined;
    target?.focus();
  };

  const move = (delta: 1 | -1) => {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) return;
    const currentIndex = enabled.findIndex((item) => item.id === value);
    const from = currentIndex < 0 ? 0 : currentIndex;
    const next = enabled[(from + delta + enabled.length) % enabled.length];
    onChange(next.id);
    requestAnimationFrame(() => focusTab(next.id));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(-1);
        break;
      case 'Home': {
        event.preventDefault();
        const first = items.find((item) => !item.disabled) ?? items[0];
        if (first) {
          onChange(first.id);
          requestAnimationFrame(() => focusTab(first.id));
        }
        break;
      }
      case 'End': {
        event.preventDefault();
        const last = [...items].reverse().find((item) => !item.disabled) ?? items[0];
        if (last) {
          onChange(last.id);
          requestAnimationFrame(() => focusTab(last.id));
        }
        break;
      }
      default:
        break;
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cx('flex items-stretch gap-1 border-b border-rule', className)}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tabDomId(baseId, item.id)}
            aria-selected={selected}
            aria-controls={panelDomId(baseId, item.id)}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cx(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 font-medium',
              size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm',
              selected
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-secondary hover:text-ink',
              item.disabled && 'cursor-not-allowed opacity-45',
            )}
            style={selected ? { borderBottomColor: 'var(--accent)' } : undefined}
          >
            {item.label}
            {item.count != null ? (
              <span className="font-code text-xs text-ink-muted">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** 与 Tabs 配对的面板；hidden 时保留可访问名但移出朗读顺序 */
export function TabPanel({ baseId, tabId, children, className }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={panelDomId(baseId, tabId)}
      aria-labelledby={tabDomId(baseId, tabId)}
      tabIndex={-1}
      className={cx('pt-3', className)}
    >
      {children}
    </div>
  );
}

export default Tabs;
