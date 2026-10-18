/**
 * useDraftAutosave —— 写作草稿的本地自动保存（FR-W2 / AC-W2）。
 *
 * 行为：挂载时从 localStorage 恢复；输入停止 `delayMs` 后落盘；提交后 `clear()` 清草稿；
 * 卸载/切页前 `flush()` 把最后一次输入写进去（防崩也不丢正在打的字）。
 * 只存本机（CONSTITUTION §1：无账号、无上传）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const DRAFT_KEY_PREFIX = 'ielts.draft.';

/** 全应用统一的草稿存储键；其它模块（如恢复提示）可用它直接读。 */
export function draftStorageKey(key: string): string {
  return key.startsWith(DRAFT_KEY_PREFIX) ? key : `${DRAFT_KEY_PREFIX}${key}`;
}

interface DraftRecord {
  v: string;
  /** Date.now()，用于 `draft_saved_at`（契约 §1 #21）。 */
  t: number;
}

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = `${DRAFT_KEY_PREFIX}__probe__`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    // 隐私模式/配额异常时静默不可用，界面显示「本地草稿不可用」
    return null;
  }
}

function readRecord(key: string): DraftRecord | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(draftStorageKey(key));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof (parsed as DraftRecord).v === 'string') {
      return parsed as DraftRecord;
    }
    // 兼容早期/手写的纯字符串草稿
    return { v: raw, t: 0 };
  } catch {
    return null;
  }
}

/** 不挂 hook 的读取（用于进入模块时判断「是否已有草稿」）。 */
export function readDraft(key: string): { value: string; savedAt: number } | null {
  const record = readRecord(key);
  return record ? { value: record.v, savedAt: record.t } : null;
}

/** 不挂 hook 的清除（提交成功后调用，AC-W2）。 */
export function clearDraft(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(draftStorageKey(key));
  } catch {
    /* 忽略：清不掉也不该影响提交流程 */
  }
}

export interface UseDraftAutosaveOptions {
  /** 停止输入多久后落盘（毫秒）。 */
  delayMs?: number;
  /** false 时完全不读写本地存储。 */
  enabled?: boolean;
}

export interface UseDraftAutosaveResult {
  value: string;
  setValue: (next: string | ((prev: string) => string)) => void;
  /** 本次挂载是否恢复出了草稿（用于「已恢复上次草稿」提示）。 */
  restored: boolean;
  /** 最近一次落盘时间（毫秒时间戳），未保存为 null。 */
  savedAt: number | null;
  /** 有未落盘的改动。 */
  dirty: boolean;
  /** localStorage 是否可用（隐私模式为 false，界面需提示）。 */
  available: boolean;
  error: string | null;
  /** 立即落盘（提交前、离开页面前调用）。 */
  flush: () => void;
  /** 取消待写入并清除该 key 的草稿（提交成功后调用）。 */
  clear: () => void;
  /** 仅清空本地存储，保留当前输入（「另起一篇」用）。 */
  discardStorage: () => void;
}

export function useDraftAutosave(
  key: string,
  initial = '',
  options: UseDraftAutosaveOptions = {},
): UseDraftAutosaveResult {
  const { delayMs = 800, enabled = true } = options;

  const storeRef = useRef<Storage | null>(null);
  if (storeRef.current === null && enabled) storeRef.current = storage();

  const [state, setState] = useState<{
    value: string;
    savedAt: number | null;
    dirty: boolean;
    error: string | null;
    restored: boolean;
  }>(() => {
    if (!enabled) return { value: initial, savedAt: null, dirty: false, error: null, restored: false };
    const record = readRecord(key);
    return {
      value: record ? record.v : initial,
      savedAt: record?.t ? record.t : null,
      dirty: false,
      error: null,
      restored: record !== null,
    };
  });

  const valueRef = useRef(state.value);
  valueRef.current = state.value;
  const keyRef = useRef(key);
  keyRef.current = key;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  const available = enabled && storeRef.current !== null;

  const write = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!enabledRef.current) return;
    const store = storage();
    if (!store) {
      setState((prev) => (prev.error ? prev : { ...prev, error: '本地草稿存储不可用（浏览器隐私模式或空间不足）', dirty: false }));
      return;
    }
    const record: DraftRecord = { v: valueRef.current, t: Date.now() };
    try {
      store.setItem(draftStorageKey(keyRef.current), JSON.stringify(record));
      if (mountedRef.current) setState((prev) => ({ ...prev, savedAt: record.t, dirty: false, error: null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, dirty: false, error: `本地草稿保存失败：${message}` }));
      }
    }
  }, []);

  const schedule = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(write, Math.max(0, delayMs));
  }, [delayMs, write]);

  const setValue = useCallback(
    (next: string | ((prev: string) => string)) => {
      setState((prev) => {
        const resolved = typeof next === 'function' ? (next as (prev: string) => string)(prev.value) : next;
        if (resolved === prev.value) return prev;
        valueRef.current = resolved;
        return { ...prev, value: resolved, dirty: true };
      });
      schedule();
    },
    [schedule],
  );

  const flush = useCallback(() => {
    write();
  }, [write]);

  const discardStorage = useCallback(() => {
    clearDraft(keyRef.current);
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (mountedRef.current) setState((prev) => ({ ...prev, savedAt: null, dirty: false }));
  }, []);

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    clearDraft(keyRef.current);
    if (mountedRef.current) {
      valueRef.current = '';
      setState({ value: '', savedAt: null, dirty: false, error: null, restored: false });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 卸载前把未落盘的输入写完（AC-W2「刷新后能恢复」）
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        write();
      }
    };
  }, [write]);

  // key 变化（切换任务）：丢弃旧定时器并尝试恢复新 key 的草稿
  useEffect(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!enabled) return;
    const record = readRecord(key);
    valueRef.current = record ? record.v : initial;
    setState({
      value: record ? record.v : initial,
      savedAt: record?.t ? record.t : null,
      dirty: false,
      error: null,
      restored: record !== null,
    });
    // 只在 key / enabled 变化时重跑；initial 不作为依赖（调用方传的是常量或受控值）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return {
    value: state.value,
    setValue,
    restored: state.restored,
    savedAt: state.savedAt,
    dirty: state.dirty,
    available,
    error: state.error,
    flush,
    clear,
    discardStorage,
  };
}

export default useDraftAutosave;
