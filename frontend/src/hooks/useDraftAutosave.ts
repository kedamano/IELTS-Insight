/**
 * useDraftAutosave —— 写作/听力/阅读草稿的自动保存（FR-W2 / AC-W2 + 契约 §14.5）。
 *
 * 两份副本，各有各的活法：
 * - **localStorage** 是首屏与离线的快路径：防抖节奏、`flush()`、卸载前补写，全部保持原样。
 *   WebView2 profile 被清理它就没了，所以它不能是唯一的副本。
 * - **学习库 `drafts` 表**（`PUT /drafts/{key}`）是第二份：它享有 §14.3 的快照保护，
 *   换 profile、重装、从备份恢复都还在。
 *
 * 恢复时取「较新的一份」，比的是可比的毫秒：本地记录的 `t` 与远端 `updated_at` 解析成
 * 毫秒后比大小，相等用本地。能这么比的前提是 sidecar 与页面在**同一台机器同一个时钟**上；
 * 这条规则不许搬到任何远端服务去。
 *
 * 提交后的清理顺序见下面的 `clear()`：本地立刻清（用户要马上看到空输入框），远端删不掉时
 * 记进 `pendingClear` 名单，下次挂载先补发 —— 保证「已经交掉的作文」不会再以草稿形态回来。
 *
 * 远端不可达是**必须可见**的状态（§14.5）：`remoteState === 'unavailable'`，界面要说
 * 「草稿目前只存在本机浏览器里」，不许静默退回单副本。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDraft, getDraft, isNotFound, putDraft } from '../services/api';

export const DRAFT_KEY_PREFIX = 'ielts.draft.';

export const PENDING_CLEAR_STORAGE_KEY = `${DRAFT_KEY_PREFIX}pendingClear`;
/** 提交/另起一篇时远端没删掉的 key。下次挂载先补发 DELETE，再决定恢复什么。 */

/** 草稿副本的可达状态。`unknown` = 本次挂载还没确认过。 */
export type DraftRemoteState = 'unknown' | 'available' | 'unavailable';

/** 全应用统一的草稿存储键；其它模块（如恢复提示）可用它直接读。 */
export function draftStorageKey(key: string): string {
  return key.startsWith(DRAFT_KEY_PREFIX) ? key : `${DRAFT_KEY_PREFIX}${key}`;
}

interface DraftRecord {
  v: string;
  /** Date.now()，用于 `draft_saved_at`（契约 §1 #21）与「取较新的一份」的比较。 */
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

/** 把一份正文写进本地存储（恢复远端副本时也要回填，否则下次断网就退回旧的那份）。 */
function persistLocal(key: string, value: string, t: number): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(draftStorageKey(key), JSON.stringify({ v: value, t } satisfies DraftRecord));
  } catch {
    /* 本地写不下不影响远端副本已经是第二份 */
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

function readPending(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(PENDING_CLEAR_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 名单是「跨挂载」的，所以每次都重新读一遍再改：并发 clear 两个面板时，
 * 拿旧快照覆盖回去会把另一个还没补发的 key 悄悄忘掉。
 */
function editPending(key: string, add: boolean): void {
  const store = storage();
  if (!store) return;
  const current = readPending();
  const next = add ? [...new Set([...current, key])] : current.filter((k) => k !== key);
  if (next.length === current.length && !add) return;
  try {
    if (next.length === 0) store.removeItem(PENDING_CLEAR_STORAGE_KEY);
    else store.setItem(PENDING_CLEAR_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 记不上名单 == 下次可能恢复出一篇已提交的稿子，属于可容忍的小烦人，不阻断提交 */
  }
}

/** 待补发清除的 key（测试与「数据与备份」区块用）。 */
export function readPendingClears(): string[] {
  return readPending();
}

export interface UseDraftAutosaveOptions {
  /** 停止输入多久后落盘（毫秒）。 */
  delayMs?: number;
  /** false 时完全不读写本地存储，也不碰网络。 */
  enabled?: boolean;
  /** false 时只写本地（默认双写）。 */
  remote?: boolean;
}

export interface UseDraftAutosaveResult {
  value: string;
  setValue: (next: string | ((prev: string) => string)) => void;
  /** 本次挂载是否恢复出了草稿（本地或远端任一来源）。 */
  restored: boolean;
  /** 最近一次落盘时间（毫秒时间戳），未保存为 null。 */
  savedAt: number | null;
  /** 有未落盘的改动。 */
  dirty: boolean;
  /** localStorage 是否可用（隐私模式为 false，界面需提示）。 */
  available: boolean;
  /** 第二份副本（学习库）的可达状态；`unavailable` 时界面必须说明只在本机浏览器里。 */
  remoteState: DraftRemoteState;
  error: string | null;
  /** 立即落盘（提交前、离开页面前调用）。 */
  flush: () => void;
  /** 取消待写入并清除两边的草稿（提交成功后调用）。 */
  clear: () => void;
  /** 清掉两份存储、保留当前输入（「另起一篇」用）。 */
  discardStorage: () => void;
}

export function useDraftAutosave(
  key: string,
  initial = '',
  options: UseDraftAutosaveOptions = {},
): UseDraftAutosaveResult {
  const { delayMs = 800, enabled = true, remote = true } = options;

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
  const [remoteState, setRemoteState] = useState<DraftRemoteState>('unknown');

  const valueRef = useRef(state.value);
  valueRef.current = state.value;
  const keyRef = useRef(key);
  keyRef.current = key;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const remoteRef = useRef(enabled && remote);
  remoteRef.current = enabled && remote;
  /** 本次挂载内用户是否改过：远端返回得晚时靠它决定「不许盖掉正在打的字」。 */
  const editedRef = useRef(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  const available = enabled && storeRef.current !== null;

  /** 发一次远端副本写入。失败只改状态，不重试、不打断输入 —— 本地那份已经落盘了。 */
  const pushRemote = useCallback(async (targetKey: string, value: string, t: number) => {
    try {
      await putDraft(targetKey, value, t);
      if (mountedRef.current && keyRef.current === targetKey) setRemoteState('available');
    } catch {
      if (mountedRef.current && keyRef.current === targetKey) setRemoteState('unavailable');
    }
  }, []);

  const write = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!enabledRef.current) return;
    const targetKey = keyRef.current;
    const store = storage();
    if (!store) {
      setState((prev) => (prev.error ? prev : { ...prev, error: '本地草稿存储不可用（浏览器隐私模式或空间不足）', dirty: false }));
      return;
    }
    const record: DraftRecord = { v: valueRef.current, t: Date.now() };
    try {
      store.setItem(draftStorageKey(targetKey), JSON.stringify(record));
      if (mountedRef.current) setState((prev) => ({ ...prev, savedAt: record.t, dirty: false, error: null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, dirty: false, error: `本地草稿保存失败：${message}` }));
      }
    }
    if (remoteRef.current) void pushRemote(targetKey, record.v, record.t);
  }, [pushRemote]);

  const schedule = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(write, Math.max(0, delayMs));
  }, [delayMs, write]);

  const setValue = useCallback(
    (next: string | ((prev: string) => string)) => {
      // 先更新 valueRef 再 setState：React 的 updater 要到渲染时才跑，
      // 而 `flush()`（提交前、卸载前）立刻就要读最新值 —— 挂在 updater 里会存下上一个版本。
      const resolved = typeof next === 'function' ? (next as (prev: string) => string)(valueRef.current) : next;
      if (resolved === valueRef.current) return;
      valueRef.current = resolved;
      editedRef.current = true;
      setState((prev) => (prev.value === resolved ? prev : { ...prev, value: resolved, dirty: true }));
      schedule();
    },
    [schedule],
  );

  const flush = useCallback(() => {
    write();
  }, [write]);

  /** 「删远端」这件事不能只靠一次请求：删不掉就记账，下次挂载补发。 */
  const requestRemoteClear = useCallback((targetKey: string) => {
    if (!remoteRef.current) return;
    editPending(targetKey, true);
    void deleteDraft(targetKey)
      .then(() => editPending(targetKey, false))
      .catch(() => {
        /* 留在名单里 */
      });
  }, []);

  const discardStorage = useCallback(() => {
    const targetKey = keyRef.current;
    clearDraft(targetKey);
    requestRemoteClear(targetKey);
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (mountedRef.current) setState((prev) => ({ ...prev, savedAt: null, dirty: false }));
  }, [requestRemoteClear]);

  const clear = useCallback(() => {
    const targetKey = keyRef.current;
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    requestRemoteClear(targetKey);
    clearDraft(targetKey);
    if (mountedRef.current) {
      valueRef.current = '';
      editedRef.current = false;
      setState({ value: '', savedAt: null, dirty: false, error: null, restored: false });
    }
  }, [requestRemoteClear]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 卸载前把未落盘的输入写完（AC-W2「刷新后能恢复」；远端那份也跟着写一次）
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        write();
      }
    };
  }, [write]);

  // key / enabled 变化（切换任务）：丢弃旧定时器，本地先恢复，再让远端副本参与比较
  useEffect(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (!enabled) {
      setRemoteState('unknown');
      return;
    }
    editedRef.current = false;
    const record = readRecord(key);
    valueRef.current = record ? record.v : initial;
    setState({
      value: record ? record.v : initial,
      savedAt: record?.t ? record.t : null,
      dirty: false,
      error: null,
      restored: record !== null,
    });

    if (!remote) {
      setRemoteState('unknown');
      return;
    }
    setRemoteState('unknown');
    let cancelled = false;
    void (async () => {
      // 先补发上次没删掉的（含当前 key）：删成之后下面的 GET 自然是 404，恢复不回来
      for (const pending of readPending()) {
        try {
          await deleteDraft(pending);
          editPending(pending, false);
        } catch {
          /* 还是连不上，留给下次 */
        }
      }
      const local = readRecord(key);
      const localMs = local?.t ?? 0;
      try {
        const copy = await getDraft(key);
        if (cancelled) return;
        setRemoteState('available');
        const remoteMs = Date.parse(copy.updated_at);
        if (!Number.isFinite(remoteMs) || editedRef.current || remoteMs <= localMs) return;
        valueRef.current = copy.value;
        persistLocal(key, copy.value, remoteMs);
        setState((prev) => ({
          ...prev,
          value: copy.value,
          savedAt: localMs || remoteMs,
          dirty: false,
          restored: true,
        }));
      } catch (error) {
        if (cancelled) return;
        // 404 是「远端还没有副本」的正常答案：可达、无需恢复、不许报错
        setRemoteState(isNotFound(error) ? 'available' : 'unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只在 key / enabled / remote 变化时重跑；initial 不作为依赖（调用方传的是常量或受控值）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, remote]);

  return {
    value: state.value,
    setValue,
    restored: state.restored,
    savedAt: state.savedAt,
    dirty: state.dirty,
    available,
    remoteState,
    error: state.error,
    flush,
    clear,
    discardStorage,
  };
}

export default useDraftAutosave;
