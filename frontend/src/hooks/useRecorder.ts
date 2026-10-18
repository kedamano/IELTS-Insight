/**
 * useRecorder —— 口语录音链路（FR-S3 / AC-S3 / AC-S3b / AC-S2 / AC-C4）。
 *
 * 相比旧实现修掉的三件事：
 * 1. `settings.audio_device` 真正传进 `getUserMedia({ audio: { deviceId: { exact } } })`（AC-C4）。
 * 2. 权限被拒 / 没有设备 / 设备被占用是**三种不同**的中文提示，并带机器码供界面分支（AC-S3）。
 * 3. `stop()` 一定 resolve `{blob, durationMs}` 并释放麦克风轨道与 AudioContext（旧实现没录音时会抛 TypeError）。
 *
 * 计时用单调时钟（`performance.now()`），120s 自动停止时通过 `onLimit` 把结果交给调用方（AC-S2）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderErrorCode =
  | 'unsupported'
  | 'not_allowed'
  | 'not_found'
  | 'not_readable'
  | 'overconstrained'
  | 'security'
  | 'aborted'
  | 'unknown';

/** 每种失败都给「发生了什么 + 现在能做什么」（AC-S3 可理解中文）。 */
export const RECORDER_ERROR_TEXT: Record<RecorderErrorCode, string> = {
  unsupported: '当前环境不支持录音（WebView 未开放麦克风接口）。可改用「直接输入答案文本」完成口语练习。',
  not_allowed: '麦克风权限被拒绝：请在 Windows「设置 → 隐私与安全性 → 麦克风」中允许 IELTS Insight，然后点重试；也可改用文本输入继续练习。',
  not_found: '未检测到可用的麦克风：请插入或开启麦克风，再到「设置 → 录音输入设备」中选择设备；也可改用文本输入继续练习。',
  not_readable: '麦克风被其它程序占用或读取失败：请关闭会议/录音软件后重试。',
  overconstrained: '所选录音设备当前不可用：请在「设置 → 录音输入设备」重新选择设备，或使用默认设备。',
  security: '安全策略阻止了麦克风访问（需 HTTPS 或本地来源）。请从应用内打开，不要用 file:// 直接访问页面。',
  aborted: '录音请求被取消：请重新开始录音。',
  unknown: '录音启动失败，请检查麦克风后重试。',
};

function classifyMediaError(error: unknown): RecorderErrorCode {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'not_allowed';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'not_found';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'not_readable';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'overconstrained';
    case 'SecurityError':
      return 'security';
    case 'AbortError':
      return 'aborted';
    default:
      return 'unknown';
  }
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

/** 选一个浏览器真支持的 mimeType（Tauri/WebView2 一般是 audio/webm;codecs=opus）。 */
export function pickRecorderMimeType(preferred?: string | null): string {
  const candidates = preferred ? [preferred, ...MIME_CANDIDATES] : [...MIME_CANDIDATES];
  const supported =
    typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';
  for (const candidate of candidates) {
    try {
      if (!supported || MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      /* isTypeSupported 在部分实现里会抛，忽略继续试下一个 */
    }
  }
  return '';
}

/** 设置页的录音设备下拉用（AC-C4 需要先列出 deviceId）。 */
export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audioinput');
  } catch {
    return [];
  }
}

export interface RecorderStopResult {
  blob: Blob;
  /** 单调时钟测得的真实录音时长（AC-S2 要求与提交值误差 ≤1s）。 */
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
}

export interface UseRecorderOptions {
  /** `settings.audio_device`；null/undefined 时用系统默认（AC-C4）。 */
  deviceId?: string | null;
  /** 强制指定容器/编码（默认自动挑选 webm/opus）。 */
  mimeType?: string;
  /** 到点自动停止（口语 Part 2 = 120000，AC-S2）。 */
  maxDurationMs?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  /** 是否用 AudioContext 采音量（默认 true，环境不支持时自动关闭并返回 level=0）。 */
  trackLevel?: boolean;
  /** 音量刷新粒度。 */
  levelIntervalMs?: number;
  /** 达到 `maxDurationMs` 自动停止后的回调（此时录音不可再续）。 */
  onLimit?: (result: RecorderStopResult) => void;
  /** 出错回调（state.error 同时会被设置）。 */
  onError?: (code: RecorderErrorCode, message: string) => void;
}

export interface UseRecorderResult {
  recording: boolean;
  /** 正在申请麦克风权限（UI 可显示「正在开启麦克风…」）。 */
  starting: boolean;
  /** 已录时长（毫秒，单调时钟）。 */
  elapsedMs: number;
  /** 0–1 的输入电平；不可用时恒为 0。 */
  level: number;
  mimeType: string;
  /** 中文错误文本；无错误为 null。 */
  error: string | null;
  errorCode: RecorderErrorCode | null;
  /** 例如「指定设备不可用，已回退默认麦克风」——非致命。 */
  warning: string | null;
  /** 因达到时长上限被自动停止（AC-S2：此后不允许续录）。 */
  stoppedByLimit: boolean;
  lastResult: RecorderStopResult | null;
  start: () => Promise<void>;
  /** 永远 resolve；未在录音时返回空 blob + 0 时长。 */
  stop: () => Promise<RecorderStopResult>;
  /** 丢弃本次录音（不落 lastResult）。 */
  cancel: () => void;
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor });
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null;
}

export function useRecorder(options: UseRecorderOptions = {}): UseRecorderResult {
  const {
    deviceId = null,
    mimeType: preferredMime,
    echoCancellation = true,
    noiseSuppression = true,
    autoGainControl = true,
    trackLevel = true,
    levelIntervalMs = 100,
  } = options;
  // maxDurationMs / onLimit / onError 通过 optionsRef 每 tick 读取，改值无需重启录音

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;

  const [snapshot, setSnapshot] = useState<{
    recording: boolean;
    starting: boolean;
    elapsedMs: number;
    level: number;
    error: string | null;
    errorCode: RecorderErrorCode | null;
    warning: string | null;
    stoppedByLimit: boolean;
    mimeType: string;
  }>({
    recording: false,
    starting: false,
    elapsedMs: 0,
    level: 0,
    error: null,
    errorCode: null,
    warning: null,
    stoppedByLimit: false,
    mimeType: '',
  });
  const [lastResult, setLastResult] = useState<RecorderStopResult | null>(null);

  const mountedRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scratchRef = useRef<Uint8Array | null>(null);
  const recordingRef = useRef(false);
  const resultRef = useRef<RecorderStopResult | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopTickers();
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTickers() {
    if (tickerRef.current !== null) clearInterval(tickerRef.current);
    if (levelTickerRef.current !== null) clearInterval(levelTickerRef.current);
    tickerRef.current = null;
    levelTickerRef.current = null;
  }

  /** 释放麦克风与 AudioContext —— 任何路径（成功/失败/卸载）都必须走到这里。 */
  function teardown() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        /* 已断开 */
      }
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      void Promise.resolve(ctx.close()).catch(() => undefined);
    }
  }

  const apply = useCallback((patch: Partial<typeof snapshot>) => {
    if (!mountedRef.current) return;
    setSnapshot((prev) => ({ ...prev, ...patch }));
  }, []);

  const reportError = useCallback(
    (code: RecorderErrorCode, detail?: string) => {
      const message = detail ? `${RECORDER_ERROR_TEXT[code]}（${detail}）` : RECORDER_ERROR_TEXT[code];
      apply({ error: message, errorCode: code, recording: false, starting: false, level: 0 });
      optionsRef.current.onError?.(code, message);
    },
    [apply],
  );

  const beginLevel = useCallback(
    (stream: MediaStream) => {
      if (!trackLevel) return;
      const Ctor = getAudioContextCtor();
      if (!Ctor) return;
      try {
        const ctx = new Ctor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        scratchRef.current = new Uint8Array(analyser.fftSize);
        levelTickerRef.current = setInterval(() => {
          const node = analyserRef.current;
          const data = scratchRef.current;
          if (!node || !data) return;
          node.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const deviation = (data[i] - 128) / 128;
            sum += deviation * deviation;
          }
          const level = Math.min(1, Math.sqrt(sum / data.length) * 2);
          if (mountedRef.current) setSnapshot((prev) => (prev.level === level ? prev : { ...prev, level }));
        }, Math.max(50, levelIntervalMs));
      } catch {
        // 电平是「锦上添花」，失败就退回纯计时显示，不影响录音
        analyserRef.current = null;
        audioCtxRef.current = null;
      }
    },
    [levelIntervalMs, trackLevel],
  );

  const stop = useCallback((): Promise<RecorderStopResult> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || !recordingRef.current) {
        // 没在录音：不抛错，返回上一次结果或空结果（调用方可以安全 await）
        const empty: RecorderStopResult =
          resultRef.current ??
          { blob: new Blob([], { type: preferredMime ?? 'audio/webm' }), durationMs: 0, sizeBytes: 0, mimeType: preferredMime ?? 'audio/webm' };
        resolve(empty);
        return;
      }
      recordingRef.current = false;
      stopTickers();

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        const mime = recorder.mimeType || snapshot.mimeType || preferredMime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        const result: RecorderStopResult = {
          blob,
          durationMs: Math.round(elapsedRef.current),
          sizeBytes: blob.size,
          mimeType: mime,
        };
        resultRef.current = result;
        recorderRef.current = null;
        teardown();
        if (mountedRef.current) {
          setLastResult(result);
          setSnapshot((prev) => ({ ...prev, recording: false, starting: false, level: 0, mimeType: result.mimeType }));
        }
        resolve(result);
      };

      recorder.ondataavailable = null;
      recorder.onstop = finish;
      recorder.onerror = () => finish();
      try {
        recorder.stop();
      } catch {
        finish();
      }
      // 某些实现不触发 onstop：兜底 1.5s 后照样 resolve
      setTimeout(finish, 1500);
    });
  }, [preferredMime, snapshot.mimeType]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = useCallback(async (): Promise<void> => {
    if (recordingRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      reportError('unsupported');
      return;
    }

    chunksRef.current = [];
    resultRef.current = null;
    elapsedRef.current = 0;
    apply({ error: null, errorCode: null, warning: null, stoppedByLimit: false, starting: true, elapsedMs: 0, level: 0 });

    const constraints = (device?: string | null): MediaStreamConstraints => ({
      audio: device
        ? { deviceId: { exact: device }, echoCancellation, noiseSuppression, autoGainControl }
        : { echoCancellation, noiseSuppression, autoGainControl },
      video: false,
    });

    /** AC-C4：用户选定的设备必须真的传进去（`exact`，选错设备要能被发现）；被拔走时回落默认设备。 */
    const requestStream = async (): Promise<MediaStream | null> => {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints(deviceIdRef.current));
      } catch (error) {
        const code = classifyMediaError(error);
        const detail = error instanceof Error ? error.message : undefined;
        if (code === 'overconstrained' && deviceIdRef.current) {
          try {
            const fallback = await navigator.mediaDevices.getUserMedia(constraints(null));
            apply({ warning: '指定录音设备不可用，已回退到系统默认麦克风。' });
            return fallback;
          } catch (retryError) {
            reportError(classifyMediaError(retryError), retryError instanceof Error ? retryError.message : undefined);
            return null;
          }
        }
        reportError(code, detail);
        return null;
      }
    };

    const stream = await requestStream();
    if (!stream) {
      apply({ starting: false });
      return;
    }

    if (!mountedRef.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    streamRef.current = stream;
    const mime = pickRecorderMimeType(preferredMime ?? null);
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (error) {
      teardown();
      reportError('unsupported', error instanceof Error ? error.message : undefined);
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    try {
      recorder.start(1000);
    } catch {
      try {
        recorder.start();
      } catch (error) {
        teardown();
        reportError('unsupported', error instanceof Error ? error.message : undefined);
        return;
      }
    }

    recorderRef.current = recorder;
    recordingRef.current = true;
    startedAtRef.current = now();
    beginLevel(stream);
    apply({ recording: true, starting: false, mimeType: recorder.mimeType || mime });

    tickerRef.current = setInterval(() => {
      const elapsed = now() - startedAtRef.current;
      elapsedRef.current = elapsed;
      if (mountedRef.current) setSnapshot((prev) => ({ ...prev, elapsedMs: elapsed }));
      const limit = optionsRef.current.maxDurationMs;
      if (typeof limit === 'number' && limit > 0 && elapsed >= limit) {
        // AC-S2：到点自动停止且不可续录
        apply({ stoppedByLimit: true });
        void stopRef.current().then((result) => {
          if (mountedRef.current) optionsRef.current.onLimit?.(result);
        });
      }
    }, 100);
  }, [apply, autoGainControl, beginLevel, echoCancellation, noiseSuppression, preferredMime, reportError]);

  const cancel = useCallback(() => {
    recordingRef.current = false;
    stopTickers();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* 已经停了 */
      }
    }
    chunksRef.current = [];
    teardown();
    elapsedRef.current = 0;
    apply({ recording: false, starting: false, elapsedMs: 0, level: 0, stoppedByLimit: false });
  }, [apply]);

  return {
    ...snapshot,
    lastResult,
    start,
    stop,
    cancel,
  };
}

export default useRecorder;
