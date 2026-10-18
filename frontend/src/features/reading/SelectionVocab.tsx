/**
 * 选中篇章文字 → 加入生词本（FR-R2 / FR-V1 / AC-V1）。
 *
 * 契约 §7 禁止组件内裸 fetch，所以写入只走 `services/api.addVocab`（#35）。
 * body 必须带 `context`（出处句子）+ `source_module:'reading'` + `source_ref: set.id`，
 * 这三项就是 AC-V1 的断言点。
 *
 * jsdom 没有真正的选区实现细节，`readSelection` 因此只依赖标准 API
 * （`window.getSelection()`、`rangeCount`、`toString()`、`getRangeAt`），并在任何缺失时返回 null。
 */
import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { addVocab, isApiError } from '../../services/api';
import { Badge, Button, cx } from '../../components/ui';
import type { VocabAddBody } from '../../types/ielts';

/** 最多取 4 个词：单词与常见搭配（FR-V1 的 collocation 标签口径）都够用，更长的是句子。 */
export const MAX_VOCAB_WORDS = 4;
export const MAX_VOCAB_CHARS = 60;

export interface SelectionSnapshot {
  word: string;
  /** 出处整句（AC-V1）。 */
  context: string;
  paragraphLabel: string;
  /** 相对篇章容器的定位。 */
  left: number;
  top: number;
}

export type SelectionRequest = {
  snapshot: SelectionSnapshot | null;
  error: string | null;
};

const WHITESPACE = /\s+/g;

function normalizeSelectionText(raw: string): string {
  return raw.replace(WHITESPACE, ' ').trim();
}

/** 用选中片段所在段落原文还原整句（找不到就退回段落首句）。 */
export function sentenceAround(paragraphText: string, selection: string): string {
  const text = paragraphText.replace(WHITESPACE, ' ').trim();
  if (!text) return selection;
  const needle = selection.toLowerCase().trim();
  const lower = text.toLowerCase();
  let index = needle ? lower.indexOf(needle) : -1;
  if (index < 0) {
    // 选区跨了换行/连字符时 indexOf 会失败：退到第一个词的位置
    const firstWord = needle.split(' ')[0] ?? '';
    index = firstWord ? lower.indexOf(firstWord) : -1;
  }
  if (index < 0) index = 0;

  const before = text.slice(0, index);
  const termStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'));
  const start = termStart >= 0 ? termStart + 1 : 0;

  const fromIndex = text.slice(start);
  const endMatch = /[.?!]/.exec(fromIndex);
  const end = start + (endMatch ? endMatch.index + 1 : fromIndex.length);

  const sentence = text.slice(start, end).replace(WHITESPACE, ' ').trim();
  return sentence || text;
}

/** 从当前浏览器选区构造请求；不合法（太长/跨段/空）时返回 error 说明。 */
export function readSelection(root: HTMLElement | null): SelectionRequest {
  const selection = typeof window !== 'undefined' ? window.getSelection?.() ?? null : null;
  if (!selection || selection.rangeCount === 0) return { snapshot: null, error: null };
  const raw = normalizeSelectionText(selection.toString());
  if (!raw) return { snapshot: null, error: null };

  const words = raw.split(' ');
  if (words.length > MAX_VOCAB_WORDS) {
    return { snapshot: null, error: `一次只能加入 ${MAX_VOCAB_WORDS} 个词以内的单词或搭配` };
  }
  if (raw.length > MAX_VOCAB_CHARS) {
    return { snapshot: null, error: '选中的文本过长，请缩短到词或搭配' };
  }

  const range = selection.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const anchorElement = anchor.nodeType === 1 ? (anchor as HTMLElement) : (anchor.parentElement as HTMLElement | null);
  const paragraph = anchorElement?.closest<HTMLElement>('[data-paragraph-label]');
  if (!paragraph || (root && !root.contains(paragraph))) {
    return { snapshot: null, error: '请在篇章段落内选中文字' };
  }
  const label = paragraph.dataset.paragraphLabel ?? '';
  const paragraphText = paragraph.querySelector('[data-paragraph-text]')?.textContent ?? paragraph.textContent ?? '';

  // jsdom 与部分 WebView 没实现 Range.getBoundingClientRect → 拿不到位置就退回段落右下角，
  // 但绝不能因此抛错把「加词」这条动作打断（浮层位置只是体验问题）。
  const measure = (target: { getBoundingClientRect?: () => DOMRect } | null): DOMRect | null =>
    target && typeof target.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : null;
  const rect = measure(range as unknown as { getBoundingClientRect?: () => DOMRect });
  const rootRect = measure(root);
  const left = Math.max(0, (rect?.left ?? 0) - (rootRect?.left ?? 0));
  const top = Math.max(0, (rect?.bottom ?? 0) - (rootRect?.top ?? 0));

  return {
    snapshot: { word: raw, context: sentenceAround(paragraphText, raw), paragraphLabel: label, left, top },
    error: null,
  };
}

export interface UseSelectionVocabOptions {
  setId: string;
  rootRef: RefObject<HTMLElement | null>;
  /** 成功/失败的一次性反馈文本（由 PassageView 渲染成 Toast/Badge）。 */
  onFeedback?: (message: string, tone: 'good' | 'danger') => void;
}

export interface UseSelectionVocabResult {
  snapshot: SelectionSnapshot | null;
  adding: boolean;
  added: string | null;
  error: string | null;
  /** 绑到篇章容器的 onMouseUp / onKeyUp。 */
  capture: (event: ReactMouseEvent<Element> | ReactKeyboardEvent<Element>) => void;
  dismiss: () => void;
  confirmAdd: () => Promise<void>;
}

export function useSelectionVocab({ setId, rootRef, onFeedback }: UseSelectionVocabOptions): UseSelectionVocabResult {
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<SelectionRequest>({ snapshot: null, error: null });

  const dismiss = useCallback(() => {
    setSnapshot(null);
    setError(null);
    try {
      window.getSelection?.()?.removeAllRanges();
    } catch {
      /* 某些 WebView 在没有选区时会抛错，忽略即可 */
    }
  }, []);

  const capture = useCallback(
    (event: ReactMouseEvent<Element> | ReactKeyboardEvent<Element>) => {
      if ('key' in event && event.key !== 'Shift' && event.key !== 'End' && event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
        return;
      }
      const request = readSelection(rootRef.current);
      requestRef.current = request;
      setError(request.error);
      setSnapshot(request.error ? null : request.snapshot);
    },
    [rootRef],
  );

  const confirmAdd = useCallback(async () => {
    const current = snapshot ?? requestRef.current.snapshot;
    if (!current || adding) return;
    setAdding(true);
    setError(null);
    const body: VocabAddBody = {
      word: current.word,
      context: current.context,
      source_module: 'reading',
      source_ref: setId,
    };
    try {
      const note = await addVocab(body);
      setAdded(note?.word || current.word);
      onFeedback?.(`已加入生词本：${current.word}`, 'good');
      setSnapshot(null);
      try {
        window.getSelection?.()?.removeAllRanges();
      } catch {
        /* ignore */
      }
    } catch (caught: unknown) {
      const message = isApiError(caught) ? caught.detail : caught instanceof Error ? caught.message : '加入生词本失败';
      // 失败只落这一个持久 surface（原文区 role="alert"）：Toast 会自动消失，
      // 而写库失败需要用户看清并重试；两处同时播报会让读屏重复同一条错误。
      setError(`加入生词本失败：${message}`);
    } finally {
      setAdding(false);
    }
  }, [adding, onFeedback, setId, snapshot]);

  return { snapshot, adding, added, error, capture, dismiss, confirmAdd };
}

export type SelectionVocabPopoverProps = {
  snapshot: SelectionSnapshot;
  adding: boolean;
  onAdd: () => void;
  onDismiss: () => void;
};

/** 小浮层：只显示「加词」这一个动作，不抢焦点（不阻断连续选中）。 */
export function SelectionVocabPopover({ snapshot, adding, onAdd, onDismiss }: SelectionVocabPopoverProps) {
  return (
    <div
      role="dialog"
      aria-label={`把 ${snapshot.word} 加入生词本`}
      className={cx(
        'absolute z-20 flex w-max max-w-[260px] flex-col gap-2 rounded-card border border-rule',
        'bg-paper-raised px-2.5 py-2 shadow-elevated',
      )}
      style={{ left: snapshot.left, top: snapshot.top }}
      onMouseUp={(event) => event.stopPropagation()}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-code text-sm text-ink">{snapshot.word}</span>
        <Badge tone="accent">段落 {snapshot.paragraphLabel}</Badge>
      </div>
      <p className="line-clamp-3 text-xs text-ink-muted">{snapshot.context}</p>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" loading={adding} onClick={onAdd}>
          加入生词本
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          取消
        </Button>
      </div>
    </div>
  );
}
