/**
 * useBackendReady —— Tauri 启动的 PyInstaller sidecar 就绪轮询（FR-G1 / AC-G1）。
 *
 * 抽自旧 `SceneList.tsx` 的 15×2s 重试循环，改成共享 hook + 指数退避（首屏更快就绪、总时长不缩短）。
 * 失败态必须给出**可操作**的中文文案与「重试」入口（AC-G1），不允许白屏或只有 "Failed to fetch"。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { health, isAbortError, type ApiRequestOptions } from '../services/api';
import type { HealthResponse } from '../types/ielts';

export type BackendReadyState = 'pending' | 'ready' | 'failed';

export interface UseBackendReadyOptions {
  /** 最多轮询次数（旧实现 15 次）。 */
  maxAttempts?: number;
  /** 首次重试前的等待时长（毫秒），之后按 2 倍退避。 */
  initialDelayMs?: number;
  /** 退避上限。 */
  maxDelayMs?: number;
  /** false 时不自动开始，只能手动 `retry()`。 */
  auto?: boolean;
  /** 自定义探活函数（默认 `api.health()`），便于测试注入。 */
  probe?: (options: ApiRequestOptions) => Promise<HealthResponse>;
}

export interface UseBackendReadyResult {
  state: BackendReadyState;
  /** `state === 'ready'` 的便捷别名；模块入口据此禁用（AC-G1）。 */
  ready: boolean;
  /** 就绪后的健康检查结果（可用于显示 whisper 真实加载状态，AC-C3）。 */
  health: HealthResponse | null;
  attempts: number;
  maxAttempts: number;
  /** 最后一次失败的中文错误文本。 */
  lastError: string | null;
  /** 可直接渲染的中文提示：pending 显示进度、failed 显示可操作指引。 */
  message: string;
  /** 手动重试（清空计数重新开始）。 */
  retry: () => void;
}

const DEFAULTS = {
  maxAttempts: 12,
  initialDelayMs: 700,
  maxDelayMs: 2500,
} as const;

export const BACKEND_PENDING_TEXT = '正在启动本地引擎…';

/** 就绪前的进度文案（AC-G1 要求可见等待过程）。 */
export function pendingMessage(attempt: number, maxAttempts: number): string {
  return `${BACKEND_PENDING_TEXT}（第 ${attempt}/${maxAttempts} 次尝试，首次启动需加载语音模型，可能较慢）`;
}

/** 失败文案：说明原因 + 下一步能做什么（AC-G1 的「可操作」要求）。 */
export function failedMessage(attempts: number, lastError: string | null): string {
  const reason = lastError ?? '后端无响应';
  return (
    `本地引擎在 ${attempts} 次尝试后仍未就绪。最后错误：${reason}。` +
    '请点「重试」；若持续失败，开发环境请运行 bash scripts/dev.ps1 启动后端，' +
    '已安装版本请完全退出 IELTS Insight（含托盘进程）后重新打开。'
  );
}

export function useBackendReady(options: UseBackendReadyOptions = {}): UseBackendReadyResult {
  const {
    maxAttempts = DEFAULTS.maxAttempts,
    initialDelayMs = DEFAULTS.initialDelayMs,
    maxDelayMs = DEFAULTS.maxDelayMs,
    auto = true,
    probe = health,
  } = options;

  const [state, setState] = useState<BackendReadyState>('pending');
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const mountedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const probeRef = useRef(probe);
  probeRef.current = probe;
  const timingRef = useRef({ maxAttempts, initialDelayMs, maxDelayMs });
  timingRef.current = { maxAttempts, initialDelayMs, maxDelayMs };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const retry = useCallback(() => {
    controllerRef.current?.abort();
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!auto) {
      setState('pending');
      return;
    }
    const timing = timingRef.current;
    let cancelled = false;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timerRef.current = setTimeout(resolve, ms);
      });

    setState('pending');
    setAttempts(0);
    setLastError(null);
    setHealthData(null);

    (async () => {
      for (let attempt = 0; attempt <= timing.maxAttempts; attempt += 1) {
        if (cancelled || !mountedRef.current) return;
        const controller = new AbortController();
        controllerRef.current = controller;
        try {
          const data = await probeRef.current({ signal: controller.signal });
          if (cancelled || !mountedRef.current) return;
          setHealthData(data);
          setAttempts(attempt + 1);
          setLastError(null);
          setState('ready');
          return;
        } catch (error) {
          if (cancelled || isAbortError(error) || controller.signal.aborted) return;
          if (!mountedRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          setAttempts(attempt + 1);
          setLastError(message);
          if (attempt === timing.maxAttempts) {
            setState('failed');
            return;
          }
          setState('pending');
          await sleep(Math.min(timing.initialDelayMs * 2 ** attempt, timing.maxDelayMs));
        }
      }
      if (!cancelled && mountedRef.current) setState('failed');
    })();

    return () => {
      cancelled = true;
      controllerRef.current?.abort();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [auto, nonce]);

  const message =
    state === 'ready'
      ? '本地引擎已就绪'
      : state === 'failed'
        ? failedMessage(attempts || maxAttempts, lastError)
        : pendingMessage(attempts, maxAttempts);

  return {
    state,
    ready: state === 'ready',
    health: healthData,
    attempts,
    maxAttempts,
    lastError,
    message,
    retry,
  };
}

export default useBackendReady;
