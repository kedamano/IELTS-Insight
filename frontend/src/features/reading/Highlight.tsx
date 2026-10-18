/**
 * 段落高亮 + 滚动到可视区（AC-R2：「点击题号『定位』后对应段落高亮 2s 且滚动到可视区」）。
 *
 * 高亮状态放在做题面板（ReadingPanel），因为触发方（题目列表）与被作用方（篇章）是兄弟节点。
 * `locate(label)` 同时负责：置高亮 → 滚动 → `durationMs` 后自动撤高亮。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cx } from '../../components/ui';

/** AC-R2 指定的 2s。 */
export const HIGHLIGHT_MS = 2000;

export interface ParagraphHighlight {
  /** 当前高亮的段落 label；无则 null。 */
  activeLabel: string | null;
  /**
   * 高亮并滚动到该段落。label 为空/未知时返回 false（调用方可据此提示）。
   * 重复点击同一段落会重新计时，而不是取消高亮。
   */
  locate: (label: string | null | undefined) => boolean;
  clear: () => void;
}

export function paragraphDomId(setId: string, label: string): string {
  return `passage-${setId}-p-${label}`;
}

export function useParagraphHighlight(
  rootRef?: RefObject<HTMLElement | null>,
  durationMs: number = HIGHLIGHT_MS,
): ParagraphHighlight {
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setActiveLabel(null);
  }, []);

  const locate = useCallback(
    (label: string | null | undefined): boolean => {
      if (!label) return false;
      const root: ParentNode = rootRef?.current ?? document;
      const node = root.querySelector<HTMLElement>(`[data-paragraph-label="${label}"]`);
      if (!node) return false;
      // jsdom 没有 scrollIntoView；真实浏览器一定有。缺实现时只高亮不滚动，绝不抛错。
      if (typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
      setActiveLabel(label);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setActiveLabel(null);
      }, Math.max(0, durationMs));
      return true;
    },
    [durationMs, rootRef],
  );

  return { activeLabel, locate, clear };
}

export type HighlightedParagraphProps = {
  label: string;
  setId: string;
  active: boolean;
  children: ReactNode;
};

/** 段落外壳：`data-paragraph-label` 是 locate 的查询锚点，`data-highlighted` 供测试与样式使用。 */
export function HighlightedParagraph({ label, setId, active, children }: HighlightedParagraphProps) {
  return (
    <div
      id={paragraphDomId(setId, label)}
      data-paragraph-label={label}
      data-highlighted={active ? 'true' : 'false'}
      className={cx(
        'scroll-mt-2 rounded-card px-2 py-1',
        'transition-colors duration-[var(--motion-fast)]',
      )}
      style={
        active
          ? { backgroundColor: 'var(--accent-soft)', boxShadow: 'inset 2px 0 0 var(--accent)' }
          : undefined
      }
    >
      {children}
    </div>
  );
}
