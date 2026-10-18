/**
 * useTTS —— 考官/听力音频播放（FR-L1、AC-L1b）。
 *
 * 变化点：
 * - 不再自己 `fetch` URL，全部经 `services/api.ts`（AC-X4：端口只有一处定义）。
 * - 支持 `speed` 与 `voice`/`accent`（契约 §1 #39；口音→默认音色映射在 types/ielts）。
 * - 先拿 blob 再播，因此 503 能被识别：`audioUnavailable=true` + 中文「音频不可用，可看原文精读」，
 *   调用方据此显示 transcript 回落而不是白屏（AC-L1b）。
 * - objectURL 在使用后与卸载时 revoke；同一句话的 blob 做小容量缓存，供逐句重听（FR-L4）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTtsAudio, isAbortError, isServiceUnavailable } from '../services/api';
import type { Accent, TtsVoice } from '../types/ielts';

export interface TtsPlayOptions {
  voice?: TtsVoice | null;
  /** 0.75–1.25（FR-L4 倍速区间）。 */
  speed?: number | null;
  accent?: Accent | null;
}

export interface UseTTSOptions extends TtsPlayOptions {
  /** 播放失败回调（含中文文本）。 */
  onError?: (message: string) => void;
}

export interface UseTTSResult {
  playing: boolean;
  /** 正在合成/下载音频。 */
  preparing: boolean;
  error: string | null;
  /** true = 音频依赖不可用（503），界面应给出「看原文精读」入口（AC-L1b）。 */
  audioUnavailable: boolean;
  /** 播放一次；返回是否真的播出了音频（false 时调用方走文本回落）。 */
  play: (text: string, options?: TtsPlayOptions) => Promise<boolean>;
  stop: () => void;
}

/** AC-L1b 指定文案。 */
export const TTS_UNAVAILABLE_TEXT = '音频不可用，可看原文精读模式';

const BLOB_CACHE_LIMIT = 12;
const blobCache = new Map<string, Blob>();

function cacheGet(key: string): Blob | undefined {
  const hit = blobCache.get(key);
  if (hit) {
    // 命中即移到队尾，保持最近使用
    blobCache.delete(key);
    blobCache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, blob: Blob): void {
  blobCache.set(key, blob);
  while (blobCache.size > BLOB_CACHE_LIMIT) {
    const oldest = blobCache.keys().next();
    if (oldest.done) break;
    blobCache.delete(oldest.value);
  }
}

const AUDIO_ERROR_TEXT: Record<number, string> = {
  1: '音频加载被中止',
  2: '网络错误，无法加载音频',
  3: '音频解码失败',
  4: '音频格式不支持或地址无效',
};

export function useTTS(defaults: UseTTSOptions = {}): UseTTSResult {
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUnavailable, setAudioUnavailable] = useState(false);

  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const mountedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      controllerRef.current?.abort();
      releaseAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function releaseAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  const stop = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    releaseAudio();
    setPlaying(false);
    setPreparing(false);
  }, []);

  const play = useCallback(async (text: string, options: TtsPlayOptions = {}): Promise<boolean> => {
    const merged: TtsPlayOptions = {
      voice: options.voice ?? defaultsRef.current.voice ?? null,
      speed: options.speed ?? defaultsRef.current.speed ?? null,
      accent: options.accent ?? defaultsRef.current.accent ?? null,
    };
    const trimmed = text.trim();
    if (!trimmed) {
      setError('没有可朗读的文本');
      return false;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    releaseAudio();
    setPlaying(true);
    setPreparing(true);
    setError(null);
    setAudioUnavailable(false);

    const cacheKey = `${merged.voice ?? merged.accent ?? 'default'}|${merged.speed ?? 1}|${trimmed}`;

    try {
      // 先拿字节流，才能把后端的 503 暴露出来（<audio src> 会把它吞成无信息 onerror）
      let blob = cacheGet(cacheKey);
      if (!blob) {
        blob = await fetchTtsAudio(trimmed, merged, { signal: controller.signal });
        if (blob.size > 0) cacheSet(cacheKey, blob);
      }
      if (!mountedRef.current || generation !== generationRef.current) return false;
      if (!blob.size) throw new Error('语音内容为空');

      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      setPreparing(false);

      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => {
          const code = audio.error?.code ?? 0;
          reject(new Error(AUDIO_ERROR_TEXT[code] ?? '音频播放失败'));
        };
        audio.play().catch((playError: unknown) => {
          reject(new Error(playError instanceof Error ? playError.message : '播放被浏览器拒绝（可能非用户手势触发）'));
        });
      });
      return true;
    } catch (caught: unknown) {
      if (isAbortError(caught) || controller.signal.aborted) return false;
      if (!mountedRef.current || generation !== generationRef.current) return false;
      if (isServiceUnavailable(caught)) {
        setAudioUnavailable(true);
        setError(TTS_UNAVAILABLE_TEXT);
        defaultsRef.current.onError?.(TTS_UNAVAILABLE_TEXT);
      } else {
        const message =
          caught instanceof Error ? caught.message : '语音播放失败，请检查网络后重试';
        setError(message);
        defaultsRef.current.onError?.(message);
      }
      return false;
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        setPreparing(false);
        setPlaying(false);
      }
      releaseAudio();
    }
  }, []);

  return { playing, preparing, error, audioUnavailable, play, stop };
}

export default useTTS;
