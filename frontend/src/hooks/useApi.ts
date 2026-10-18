/**
 * useApi —— 通用「拉一次 + 可重拉」hook（契约 §7 的 api 函数都可直接传入）。
 *
 * 关注点：
 * - 卸载即 `abort()`，且**绝不**在卸载后 setState（React 19 会告警）。
 * - 并发只认最后一次：快速 `refetch()` 时旧响应被丢弃。
 * - 错误统一成中文字符串 + `errorCode`/`httpStatus`，界面可直接渲染 Toast。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, type ApiRequestOptions } from '../services/api';

export interface UseApiOptions {
  /** 传 false 时不发请求（例如后端还没就绪，AC-G1）。 */
  enabled?: boolean;
}

export interface UseApiResult<T> {
  data: T | null;
  /** 中文可读错误文本；无错误为 null。 */
  error: string | null;
  /** 后端机器码（如 `tts_unavailable`），供界面做差异化回落（AC-L1b）。 */
  errorCode: string | null;
  /** 0 = 没连上后端。 */
  httpStatus: number | null;
  loading: boolean;
  /** 重新拉取；返回本次结果（失败或被更新请求取代时返回 null）。 */
  refetch: () => Promise<T | null>;
}

interface InternalState<T> {
  data: T | null;
  error: string | null;
  errorCode: string | null;
  httpStatus: number | null;
  loading: boolean;
}

function describeError(error: unknown, statusHint: number | null, codeHint: string | null) {
  const message = error instanceof Error ? error.message : String(error ?? '加载失败');
  return {
    error: message || '加载失败，请重试',
    errorCode: codeHint,
    httpStatus: statusHint,
  };
}

/**
 * @param loader 通常写 `({ signal }) => api.readingSet(id)`；signal 必须透传给 api 函数才能取消。
 * @param deps   与 `useEffect` 依赖数组同语义；变化即重新请求。
 */
export function useApi<T>(
  loader: (options: ApiRequestOptions) => Promise<T>,
  deps: readonly unknown[] = [],
  options: UseApiOptions = {},
): UseApiResult<T> {
  const { enabled = true } = options;

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const [state, setState] = useState<InternalState<T>>(() => ({
    data: null,
    error: null,
    errorCode: null,
    httpStatus: null,
    loading: enabled,
  }));

  useEffect(() => {
    // 生命周期 effect 声明在请求 effect 之前，卸载时先置 false 再取消在途请求。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const run = useCallback(async (): Promise<T | null> => {
    generationRef.current += 1;
    const generation = generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null, errorCode: null, httpStatus: null }));
    try {
      const data = await loaderRef.current({ signal: controller.signal });
      if (!mountedRef.current || generation !== generationRef.current) return null;
      setState({ data, error: null, errorCode: null, httpStatus: null, loading: false });
      return data;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return null;
      if (!mountedRef.current || generation !== generationRef.current) return null;
      const hint =
        typeof error === 'object' && error !== null
          ? (error as { status?: number; code?: string })
          : undefined;
      setState((prev) => ({ ...prev, ...describeError(error, hint?.status ?? null, hint?.code ?? null), loading: false }));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      controllerRef.current?.abort();
      setState((prev) => (prev.loading ? { ...prev, loading: false } : prev));
      return;
    }
    void run();
    // 与 useApi 的契约：deps 长度必须稳定（同 useEffect）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return {
    data: state.data,
    error: state.error,
    errorCode: state.errorCode,
    httpStatus: state.httpStatus,
    loading: state.loading,
    refetch: run,
  };
}

export default useApi;
