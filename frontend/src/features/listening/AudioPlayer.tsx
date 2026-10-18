/**
 * AudioPlayer —— FR-L4 的播放器：播放/暂停、回退 5 秒、倍速 0.75–1.25×、进度条可拖、逐句重听。
 *
 * 约束：
 * - 音频只可能来自 `useListeningAudio()` 给出的 blob objectURL；503 时 `status='unavailable'`，
 *   这里**不渲染** `<audio>`，改为给出精读入口（AC-L1b 不允许白屏）。
 * - 播放状态一律用本地 state 乐观更新 + 元素事件校正：jsdom 与真实浏览器都能测。
 * - 播放中绝不显示任何答案反馈（FR-L4），本组件也不持有答案数据。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Toast, cx } from '../../components/ui';
import { formatClock } from '../../hooks/useTimer';
import { AUDIO_UNAVAILABLE_TEXT, BACK_JUMP_SEC, LISTENING_SPEEDS, TRANSCRIPT_ENTRY_TEXT } from './listeningSets';
import type { ListeningAudioStatus } from './useListeningAudio';

export type AudioPlayerProps = {
  audioUrl: string | null;
  status: ListeningAudioStatus;
  errorText: string | null;
  speed: number;
  onSpeedChange: (speed: number) => void;
  /** 外部（逐句重听）请求跳到某秒：nonce 变一次跳一次 */
  jump?: { sec: number; nonce: number } | null;
  onEnterTranscript?: () => void;
  onRetryAudio?: () => void;
  /** 播放/暂停状态上报，供父级显示「播放中不显示答案」提示 */
  onPlayingChange?: (playing: boolean) => void;
  /** 真实音频时长上报（秒）；逐句重听要用它把估算锚点缩放成实际时间轴。 */
  onDurationChange?: (durationSec: number | null) => void;
  disabled?: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clockOrUnknown(sec: number): string {
  return isFiniteNumber(sec) && sec > 0 ? formatClock(sec) : '—:—';
}

export default function AudioPlayer({
  audioUrl,
  status,
  errorText,
  speed,
  onSpeedChange,
  jump,
  onEnterTranscript,
  onRetryAudio,
  onPlayingChange,
  onDurationChange,
  disabled = false,
}: AudioPlayerProps) {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [elementError, setElementError] = useState<string | null>(null);

  const reportPlaying = useCallback(
    (next: boolean) => {
      setPlaying(next);
      onPlayingChange?.(next);
    },
    [onPlayingChange],
  );

  // 换源即复位，避免上一套题的进度留在界面上。
  useEffect(() => {
    setCurrentSec(0);
    setDurationSec(null);
    setElementError(null);
    reportPlaying(false);
  }, [audioUrl, reportPlaying]);

  // 时长（含复位为 null）上报给父级：逐句重听的时间轴要靠它校准。
  useEffect(() => {
    onDurationChange?.(durationSec);
  }, [durationSec, onDurationChange]);

  const seekTo = useCallback((sec: number) => {
    const element = elementRef.current;
    const safe = Math.max(0, isFiniteNumber(sec) ? sec : 0);
    if (element) {
      try {
        element.currentTime = safe;
      } catch {
        // jsdom / 未加载完成的元素不允许赋值：仍然更新界面时间，按钮不至于「点了没反应」
      }
    }
    setCurrentSec(safe);
  }, []);

  const play = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    reportPlaying(true);
    const result: unknown = element.play();
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch((caught: unknown) => {
        reportPlaying(false);
        setElementError(caught instanceof Error ? `${caught.message}（可能不是用户手势触发）` : '播放被拒绝，请再点一次');
      });
    }
  }, [reportPlaying]);

  const pause = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    try {
      element.pause();
    } catch {
      /* 忽略：本地状态已复位 */
    }
    reportPlaying(false);
  }, [reportPlaying]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [pause, play, playing]);

  // 倍速要作用到已挂载的元素上（含换源后重新挂载的情况）。
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    try {
      element.playbackRate = speed;
    } catch {
      /* 忽略 */
    }
  }, [speed, audioUrl, status]);

  // 逐句重听：nonce 变化才跳，避免每次渲染都打断播放。
  const lastNonceRef = useRef(0);
  useEffect(() => {
    if (!jump || jump.nonce === lastNonceRef.current) return;
    lastNonceRef.current = jump.nonce;
    if (!audioUrl) return;
    seekTo(jump.sec);
    play();
  }, [audioUrl, jump, play, seekTo]);

  if (status === 'unavailable') {
    return (
      <Card
        title="听力音频"
        subtitle="音频合成不可用，但练习不中断"
        actions={<Badge tone="mid" dot>无音频</Badge>}
      >
        <div className="flex flex-col gap-3">
          <Toast tone="warn">{AUDIO_UNAVAILABLE_TEXT}</Toast>
          {errorText ? <p className="text-xs text-ink-secondary">{errorText}</p> : null}
          <div className="flex flex-wrap gap-2">
            {onEnterTranscript ? (
              <Button variant="primary" onClick={onEnterTranscript}>
                {TRANSCRIPT_ENTRY_TEXT}
              </Button>
            ) : null}
            {onRetryAudio ? (
              <Button variant="outline" onClick={onRetryAudio}>
                重试音频
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  const scrubMax = isFiniteNumber(durationSec) && durationSec > 0 ? durationSec : 0;

  return (
    <Card
      title="听力播放器"
      subtitle={status === 'loading' ? '正在加载音频（首次合成会稍慢）…' : '播放中不会显示任何答案（FR-L4）'}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={status === 'ready' ? 'good' : status === 'error' ? 'poor' : 'neutral'} dot>
            {status === 'ready' ? '音频就绪' : status === 'loading' ? '加载中' : status === 'error' ? '音频异常' : '无音频'}
          </Badge>
          <Badge tone="neutral">倍速 {speed}×</Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {audioUrl ? (
          <audio
            ref={elementRef}
            src={audioUrl}
            preload="metadata"
            onPlay={() => reportPlaying(true)}
            onPause={() => reportPlaying(false)}
            onEnded={() => reportPlaying(false)}
            onTimeUpdate={(event) => setCurrentSec(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              const raw = event.currentTarget.duration;
              setDurationSec(isFiniteNumber(raw) ? raw : null);
            }}
            onDurationChange={(event) => {
              const raw = event.currentTarget.duration;
              setDurationSec(isFiniteNumber(raw) ? raw : null);
            }}
            onError={() => setElementError('音频解码或加载失败，可改用「看原文精读」继续练习')}
          />
        ) : null}

        <div className="flex items-baseline gap-2 font-code text-sm">
          <span className="text-ink">{clockOrUnknown(currentSec)}</span>
          <span className="text-ink-muted">/ {clockOrUnknown(durationSec ?? 0)}</span>
          {playing ? <span className="text-xs text-ink-secondary">播放中…</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={playing ? 'default' : 'primary'}
            disabled={disabled || !audioUrl}
            onClick={toggle}
            aria-label={playing ? '暂停播放' : '继续播放'}
          >
            {playing ? '暂停' : '播放'}
          </Button>
          <Button
            size="sm"
            disabled={disabled || !audioUrl}
            onClick={() => seekTo(currentSec - BACK_JUMP_SEC)}
            aria-label={`回退 ${BACK_JUMP_SEC} 秒`}
          >
            回退 {BACK_JUMP_SEC} 秒
          </Button>
          <div className="flex items-center gap-1" role="group" aria-label="倍速">
            {LISTENING_SPEEDS.map((option) => (
              <Button
                key={option}
                size="sm"
                variant={option === speed ? 'primary' : 'default'}
                aria-pressed={option === speed}
                disabled={disabled}
                onClick={() => onSpeedChange(option)}
              >
                {option}×
              </Button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-secondary">进度（可拖动）</span>
          <input
            type="range"
            min={0}
            max={scrubMax || 1}
            step={0.5}
            value={Math.min(currentSec, scrubMax || currentSec)}
            disabled={disabled || !audioUrl}
            aria-label="播放进度"
            onChange={(event) => seekTo(Number(event.currentTarget.value))}
            className={cx('w-full accent-[var(--accent)]')}
          />
        </label>

        {elementError ? <Toast tone="danger">{elementError}</Toast> : null}
        {status === 'error' && errorText ? <Toast tone="danger">{errorText}</Toast> : null}
        {status === 'error' ? (
          <div className="flex flex-wrap gap-2">
            {onEnterTranscript ? (
              <Button size="sm" variant="outline" onClick={onEnterTranscript}>
                {TRANSCRIPT_ENTRY_TEXT}
              </Button>
            ) : null}
            {onRetryAudio ? (
              <Button size="sm" variant="primary" onClick={onRetryAudio}>
                重试音频
              </Button>
            ) : null}
          </div>
        ) : null}
        {!audioUrl && status !== 'error' ? (
          <p className="text-xs text-ink-muted">音频尚未就绪；就绪前播放按钮保持禁用，可直接看原文精读。</p>
        ) : null}
      </div>
    </Card>
  );
}
