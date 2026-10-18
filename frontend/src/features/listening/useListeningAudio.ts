/**
 * useListeningAudio —— 听力音频（契约 §1 #15、AC-L1b）。
 *
 * 关键点：**必须**走 `fetchListeningAudio()` 拿 blob，而不是把 `/audio` 直接塞进 `<audio src>`。
 * `<audio src>` 的 503 会被浏览器吞成无信息的 `onerror`，界面就变成「点了没反应」（CONSTITUTION §3 禁止）。
 * 只有拿到 blob 才知道后端到底行不行，从而给出「音频不可用，可看原文精读模式」的入口。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchListeningAudio } from '../../services/api';
import type { Accent } from '../../types/ielts';

export type ListeningAudioStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export interface UseListeningAudioResult {
  /** 已 revoke 安全的 objectURL；null = 现在没有可播音频 */
  audioUrl: string | null;
  status: ListeningAudioStatus;
  /** 中文可读错误（AC-L1b/AC-S3 一律可读，不给浏览器原文） */
  errorText: string | null;
  /** true = 503/tts_unavailable，界面显示精读入口 */
  unavailable: boolean;
  loading: boolean;
  retry: () => void;
}

export function useListeningAudio(
  setId: string | null,
  accent: Accent | null,
  options: { enabled?: boolean } = {},
): UseListeningAudioResult {
  const enabled = options.enabled ?? true;
  const canFetch = enabled && !!setId;

  const api = useApi<Blob>(
    (request) => (setId ? fetchListeningAudio(setId, accent, request) : Promise.reject(new Error('没有可加载的套题'))),
    [setId, accent],
    { enabled: canFetch },
  );

  const urlRef = useRef<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = api.data;
    if (!blob || blob.size === 0) {
      setAudioUrl(null);
      return;
    }
    let created: string | null = null;
    try {
      created = URL.createObjectURL(blob);
    } catch {
      created = null;
    }
    if (!created) {
      setAudioUrl(null);
      return;
    }
    urlRef.current = created;
    setAudioUrl(created);
    return () => {
      URL.revokeObjectURL(created as string);
      if (urlRef.current === created) urlRef.current = null;
      setAudioUrl(null);
    };
  }, [api.data]);

  const unavailable = useMemo(() => isUnavailableStatus(api.httpStatus, api.errorCode), [api.httpStatus, api.errorCode]);
  const state = useMemo<ListeningAudioStatus>(() => {
    if (api.loading) return 'loading';
    if (!canFetch) return 'idle';
    if (api.data && api.data.size > 0) return 'ready';
    if (unavailable) return 'unavailable';
    if (api.error) return 'error';
    return 'idle';
  }, [api.data, api.error, canFetch, unavailable]);

  return {
    audioUrl,
    status: state,
    errorText: api.error,
    unavailable: state === 'unavailable',
    loading: api.loading,
    retry: () => {
      void api.refetch();
    },
  };
}

/**
 * `useApi` 已把 `ApiError` 拆成 `httpStatus`/`errorCode` 字符串，所以这里按同样的口径判定，
 * 不再伪造实例给 `isServiceUnavailable()`（它只认 `instanceof ApiError`）。
 */
function isUnavailableStatus(status: number | null, code: string | null): boolean {
  if (status === 503) return true;
  return code === 'tts_unavailable' || code === 'audio_unavailable';
}
