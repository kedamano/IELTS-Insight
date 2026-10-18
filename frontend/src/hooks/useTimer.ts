/**
 * useTimer —— 无漂移倒计时（AC-S2 口语 60s/120s、AC-R3 阅读 20min）。
 *
 * 实现要点：不累加 `setInterval` 步长（那种写法在后台标签页/卡顿时会漂），
 * 而是记住「截止时刻 = 单调时钟 + 剩余毫秒」，每次 tick 用 `performance.now()` 反推剩余，
 * 因此 `onExpire` 只会在真正到点时触发**一次**。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseTimerOptions {
  /** 初始时长（秒）。也可以之后用 `start(sec)` 覆盖。 */
  durationSec?: number;
  /** UI 刷新粒度（毫秒）。剩余时间仍按单调时钟计算，不受此值影响。 */
  tickMs?: number;
  /** 挂载即开始计时。 */
  autoStart?: boolean;
  /** 到点回调，每次计时只调用一次。 */
  onExpire?: () => void;
}

export interface UseTimerResult {
  /** 总时长（毫秒）。 */
  durationMs: number;
  /** 剩余（毫秒，0–durationMs）。 */
  remainingMs: number;
  /** 已用（毫秒）。 */
  elapsedMs: number;
  /** 向上取整的剩余秒数，适合直接显示。 */
  remainingSec: number;
  /** 向下取整的已用秒数，适合提交 `duration_sec`。 */
  elapsedSec: number;
  running: boolean;
  expired: boolean;
  /** 从头开始计时（默认用上一次的时长；传 sec 同时设置新时长）。 */
  start: (sec?: number) => void;
  pause: () => void;
  resume: () => void;
  toggle: () => void;
  /** 停止并回到（可指定的）初始时长，`expired` 复位。 */
  reset: (sec?: number) => void;
  /** 等价于 `reset()`。 */
  stop: () => void;
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/** 秒 → `m:ss`（口语「已用时 2:00」这类文案用，AC-S2）。 */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 毫秒 → `m:ss`。 */
export function formatClockMs(ms: number): string {
  return formatClock(ms / 1000);
}

export function useTimer(options: UseTimerOptions = {}): UseTimerResult {
  const { durationSec = 0, tickMs = 100, autoStart = false } = options;

  const onExpireRef = useRef(options.onExpire);
  onExpireRef.current = options.onExpire;

  const durationRef = useRef(Math.max(0, durationSec) * 1000);
  const remainingRef = useRef(durationRef.current);
  const deadlineRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const expireFiredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(false);

  const [snapshot, setSnapshot] = useState(() => ({
    durationMs: durationRef.current,
    remainingMs: remainingRef.current,
    running: false,
    expired: false,
  }));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const clearTicker = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const publish = useCallback(() => {
    const next = {
      durationMs: durationRef.current,
      remainingMs: remainingRef.current,
      running: runningRef.current,
      expired: expireFiredRef.current,
    };
    setSnapshot((prev) =>
      prev.durationMs === next.durationMs &&
      prev.remainingMs === next.remainingMs &&
      prev.running === next.running &&
      prev.expired === next.expired
        ? prev
        : next,
    );
  }, []);

  const tick = useCallback(() => {
    if (!runningRef.current || deadlineRef.current === null) return;
    const left = Math.max(0, deadlineRef.current - now());
    remainingRef.current = left;
    if (left <= 0) {
      deadlineRef.current = null;
      runningRef.current = false;
      clearTicker();
      const firstTime = !expireFiredRef.current;
      expireFiredRef.current = true;
      publish();
      if (firstTime && mountedRef.current) onExpireRef.current?.();
      return;
    }
    publish();
  }, [clearTicker, publish]);

  const startTicker = useCallback(() => {
    clearTicker();
    timerRef.current = setInterval(tick, Math.max(20, tickMs));
  }, [clearTicker, tick, tickMs]);

  const start = useCallback(
    (sec?: number) => {
      if (typeof sec === 'number' && Number.isFinite(sec) && sec >= 0) {
        durationRef.current = sec * 1000;
      }
      remainingRef.current = durationRef.current;
      expireFiredRef.current = false;
      if (durationRef.current <= 0) {
        runningRef.current = false;
        deadlineRef.current = null;
        clearTicker();
        setSnapshot((prev) => ({ ...prev, durationMs: durationRef.current, remainingMs: 0, running: false, expired: false }));
        return;
      }
      deadlineRef.current = now() + durationRef.current;
      runningRef.current = true;
      startTicker();
      publish();
    },
    [clearTicker, publish, startTicker],
  );

  const pause = useCallback(() => {
    if (!runningRef.current) return;
    if (deadlineRef.current !== null) remainingRef.current = Math.max(0, deadlineRef.current - now());
    deadlineRef.current = null;
    runningRef.current = false;
    clearTicker();
    publish();
  }, [clearTicker, publish]);

  const resume = useCallback(() => {
    if (runningRef.current) return;
    if (remainingRef.current <= 0) return;
    deadlineRef.current = now() + remainingRef.current;
    runningRef.current = true;
    startTicker();
    publish();
  }, [publish, startTicker]);

  const reset = useCallback(
    (sec?: number) => {
      if (typeof sec === 'number' && Number.isFinite(sec) && sec >= 0) {
        durationRef.current = sec * 1000;
      }
      remainingRef.current = durationRef.current;
      deadlineRef.current = null;
      runningRef.current = false;
      expireFiredRef.current = false;
      clearTicker();
      setSnapshot({ durationMs: durationRef.current, remainingMs: durationRef.current, running: false, expired: false });
    },
    [clearTicker],
  );

  const toggle = useCallback(() => {
    if (runningRef.current) pause();
    else if (remainingRef.current > 0) resume();
    else start();
  }, [pause, resume, start]);

  // durationSec 变化时（切题）重新设定总时长，但不自动开始。
  useEffect(() => {
    const next = Math.max(0, durationSec) * 1000;
    if (next === durationRef.current) return;
    if (runningRef.current) return;
    reset(next / 1000);
  }, [durationSec, reset]);

  useEffect(() => {
    if (autoStart) start();
    // 只在建挂载时决定是否自动开始
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elapsedMs = Math.max(0, snapshot.durationMs - snapshot.remainingMs);
  return {
    durationMs: snapshot.durationMs,
    remainingMs: snapshot.remainingMs,
    elapsedMs,
    remainingSec: Math.ceil(snapshot.remainingMs / 1000),
    elapsedSec: Math.floor(elapsedMs / 1000),
    running: snapshot.running,
    expired: snapshot.expired,
    start,
    pause,
    resume,
    toggle,
    reset,
    stop: reset,
  };
}

export default useTimer;
